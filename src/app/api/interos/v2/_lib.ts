import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getStore, isConflict, sha256 } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import type { Store } from "@/lib/db/types";
import { BusinessError } from "@/lib/core/errors";
import { nowIso } from "@/lib/dates";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { CATALOG_V2_VERSION } from "@/lib/modules/units-v2.generated";
import { authenticateInteros, signingSecretOf, type InterosClient, type InterosScope } from "@/lib/integrations/interos-auth";
import { verifySignature } from "@/domain/licensing/events";

/** Utilitários das rotas /api/interos/v2 (docs/INTEGRATIONS/INTEROS/contrato-interos-erp-v2.md). */
export const API_VERSION = "v2";

const STATUS: Record<string, number> = {
  invalid_request: 400, signature_required: 401, signature_invalid: 401, event_id_required: 400, company_not_found: 404, not_found: 404,
  company_not_allowed: 403, event_replay_mismatch: 409, license_busy: 409, signing_not_configured: 503,
};

export function ok(data: unknown, init: { status?: number; headers?: Record<string, string>; requestId: string }) {
  return NextResponse.json({ data, meta: { apiVersion: API_VERSION, catalogVersion: CATALOG_V2_VERSION, requestId: init.requestId } }, { status: init.status ?? 200, headers: { "Cache-Control": "no-store", "X-Request-Id": init.requestId, ...(init.headers ?? {}) } });
}
export function fail(status: number, code: string, message: string, requestId: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details: details ?? null }, meta: { apiVersion: API_VERSION, requestId } }, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

export interface V2Request {
  client: InterosClient;
  store: Store;
  requestId: string;
}

export async function handle(req: Request, scope: InterosScope, fn: (r: V2Request) => Promise<Response>): Promise<Response> {
  const requestId = req.headers.get("x-request-id")?.slice(0, 80) || crypto.randomUUID();
  const auth = authenticateInteros(req.headers.get("authorization"), scope);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message, requestId);
  try {
    await ensureBootstrap();
    return await fn({ client: auth.client, store: unscoped(getStore()), requestId });
  } catch (e: any) {
    if (e instanceof BusinessError) return fail(STATUS[e.code] ?? 422, e.code, e.message, requestId, e.details);
    console.error("[interos v2] erro inesperado", e);
    return fail(500, "internal_error", "Erro interno no ERP. Reenvie o mesmo evento (mesmo X-Interos-Event-Id).", requestId);
  }
}

export function companyParam(client: InterosClient, v: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new BusinessError("Identificador de empresa inválido.", "invalid_request");
  if (client.companyIds && !client.companyIds.includes(v)) throw new BusinessError("Esta credencial não pode operar esta empresa.", "company_not_allowed");
  return v;
}

/**
 * Escrita assinada e protegida contra repetição: confere HMAC (janela ±5 min) e registra o X-Interos-Event-Id.
 * Mesmo Event-Id + mesmo corpo → devolve a resposta original; corpo diferente → 409.
 */
export async function signedWrite(req: Request, r: V2Request, companyId: string, fn: (body: unknown, eventId: string) => Promise<{ status: number; data: unknown; headers?: Record<string, string> }>): Promise<Response> {
  const raw = await req.text();
  if (raw.length > 512 * 1024) throw new BusinessError("Corpo acima de 512 KB.", "invalid_request");
  const secret = signingSecretOf(r.client);
  if (!secret) throw new BusinessError("Segredo de assinatura não configurado para este cliente (signingSecretEnv).", "signing_not_configured");
  const sig = verifySignature(secret, req.headers.get("x-interos-signature"), raw);
  if (!sig.ok) throw new BusinessError(sig.reason, req.headers.get("x-interos-signature") ? "signature_invalid" : "signature_required");
  const eventId = req.headers.get("x-interos-event-id")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(eventId)) throw new BusinessError("Cabeçalho X-Interos-Event-Id obrigatório (8 a 200 caracteres).", "event_id_required");
  const hash = sha256(raw);
  const id = sha256(`${r.client.id}|${eventId}`).slice(0, 32);
  const prior = await r.store.get("interos_events", id);
  if (prior) {
    if (prior.requestHash !== hash) throw new BusinessError("X-Interos-Event-Id já usado com outro conteúdo.", "event_replay_mismatch");
    if (prior.status) return ok(prior.response, { requestId: r.requestId, status: prior.status, headers: { "Idempotent-Replayed": "true" } });
  } else {
    try {
      await r.store.create("interos_events", { clientId: r.client.id, eventId, requestHash: hash, status: 0, response: null, at: nowIso(), companyId }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  let body: unknown;
  try {
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    throw new BusinessError("JSON inválido.", "invalid_request");
  }
  const out = await fn(body, eventId);
  await r.store.update("interos_events", id, { status: out.status, response: JSON.parse(JSON.stringify(out.data)) });
  return ok(out.data, { requestId: r.requestId, status: out.status, headers: { "Idempotent-Replayed": "false", ...(out.headers ?? {}) } });
}
