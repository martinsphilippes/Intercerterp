import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import type { Store } from "@/lib/db/types";
import { BusinessError } from "@/lib/core/errors";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { CATALOG_VERSION } from "@/lib/modules/catalog";
import { authenticateInteros, clientReaches, signingSecretsOf, type InterosClient, type InterosScope } from "@/lib/integrations/interos-auth";
import { verifySignature } from "@/lib/service/signature";

/** Utilitários das rotas /api/interos/v1 (contrato-interos-erp-v1.md). */
export const API_VERSION = "v1";

const STATUS: Record<string, number> = {
  invalid_request: 400, reason_required: 400, actor_required: 400, idempotency_key_required: 400, idempotency_key_invalid: 400,
  company_not_allowed: 403,
  company_not_found: 404, not_found: 404, operation_not_found: 404,
  version_conflict: 409, idempotency_mismatch: 409, invalid_state: 409,
  changes_rejected: 422, baseline_required: 422, unknown_module: 422, kind_not_supported: 422, dependency_missing: 422,
};

export function ok(data: unknown, init: { status?: number; headers?: Record<string, string>; requestId: string }) {
  return NextResponse.json({ data, meta: { apiVersion: API_VERSION, catalogVersion: CATALOG_VERSION, requestId: init.requestId } }, { status: init.status ?? 200, headers: { "Cache-Control": "no-store", "X-Request-Id": init.requestId, ...(init.headers ?? {}) } });
}

export function fail(status: number, code: string, message: string, requestId: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details: details ?? null }, meta: { apiVersion: API_VERSION, requestId } }, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}

export interface InterosRequest {
  client: InterosClient;
  store: Store;
  requestId: string;
}

/** Autentica, prepara o Store (acesso administrativo explícito, por empresa informada na rota) e converte erros. */
export async function handle(req: Request, scope: InterosScope, fn: (r: InterosRequest) => Promise<Response>): Promise<Response> {
  const requestId = req.headers.get("x-request-id")?.slice(0, 80) || crypto.randomUUID();
  const auth = authenticateInteros(req.headers.get("authorization"), scope);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message, requestId);
  // credencial com segredo de assinatura: toda gravação vai assinada (mesmo formato e regra das outras APIs)
  if (req.method !== "GET" && req.method !== "HEAD" && auth.client.signingSecretEnvs.length) {
    const secrets = signingSecretsOf(auth.client);
    if (!secrets.length) return fail(503, "signing_not_configured", "Segredo de assinatura desta credencial ausente no ERP.", requestId);
    const header = req.headers.get("x-interos-signature");
    const raw = await req.clone().text();
    const checks = secrets.map((secret) => verifySignature(secret, header, raw));
    const bad = checks.find((c) => !c.ok);
    if (!checks.some((c) => c.ok)) return fail(401, header ? "signature_invalid" : "signature_required", bad && !bad.ok ? bad.reason : "Assinatura inválida.", requestId);
  }
  try {
    await ensureBootstrap();
    return await fn({ client: auth.client, store: unscoped(getStore()), requestId });
  } catch (e: any) {
    if (e instanceof BusinessError) return fail(STATUS[e.code] ?? 422, e.code, e.message, requestId, e.details);
    console.error("[interos] erro inesperado", e);
    return fail(500, "internal_error", "Erro interno no ERP. A operação pode ser repetida com a mesma Idempotency-Key.", requestId);
  }
}

export async function readJson(req: Request): Promise<any> {
  const raw = await req.text();
  if (raw.length > 256 * 1024) throw new BusinessError("Corpo acima de 256 KB.", "invalid_request");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BusinessError("JSON inválido.", "invalid_request");
  }
}

/** Valida e normaliza o lote recebido. */
export function parseChangeSet(body: any) {
  const changes = body?.changes ?? [];
  if (!Array.isArray(changes) || changes.length > 200) throw new BusinessError("changes deve ser uma lista (até 200 itens).", "invalid_request");
  for (const c of changes) {
    if (!c || typeof c.module !== "string" || !["enable", "disable"].includes(c.action)) throw new BusinessError('Cada alteração precisa de "module" e "action" ("enable" | "disable").', "invalid_request");
    if (c.history != null && !["read", "none"].includes(c.history)) throw new BusinessError('history deve ser "read" ou "none".', "invalid_request");
    if (c.config != null && (typeof c.config !== "object" || Array.isArray(c.config))) throw new BusinessError("config deve ser um objeto.", "invalid_request");
  }
  if (body?.mode != null && !["legacy", "shadow", "enforced"].includes(body.mode)) throw new BusinessError('mode deve ser "legacy", "shadow" ou "enforced".', "invalid_request");
  if (!changes.length && body?.mode == null) throw new BusinessError("Informe ao menos uma alteração ou o modo de controle.", "invalid_request");
  return {
    changes: changes.map((c: any) => ({ module: c.module, action: c.action, ...(c.history ? { history: c.history } : {}), ...(c.config !== undefined ? { config: c.config } : {}) })),
    ...(body?.mode ? { mode: body.mode } : {}),
    cascade: Boolean(body?.cascade),
    reviewDivergences: Boolean(body?.reviewDivergences),
  };
}

/** Empresa da rota: formato válido e alcançada pela credencial (`empresas` em INTEROS_CREDENCIAIS) — senão 403. */
export function companyIdParam(client: InterosClient, v: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new BusinessError("Identificador de empresa inválido.", "invalid_request");
  if (!clientReaches(client, v)) throw new BusinessError("Esta credencial não pode operar esta empresa.", "company_not_allowed");
  return v;
}
