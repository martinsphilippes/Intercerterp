import crypto from "node:crypto";
import type { Store } from "@/lib/db/types";
import { enqueue, registerJob } from "@/lib/core/jobs";
import { nowIso } from "@/lib/dates";

/**
 * Eventos do ERP para o Interos (contrato v2 §3 "Eventos do ERP para o Interos"): tarefa durável `interos.event` com
 * retentativa exponencial (fila existente), corpo assinado com HMAC-SHA256 no mesmo formato da entrada.
 *
 * Configuração (servidor): INTEROS_EVENTS_URL (destino) e INTEROS_OUTBOUND_SECRET (segredo da assinatura).
 * Sem configuração o evento fica registrado na fila como "não enviado" — nunca bloqueia a operação do ERP.
 */
export type InterosEventType = "license.applied" | "license.rejected" | "license.transition" | "upsell.requested" | "limit.reached" | "sync.stale";

export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Confere `t=<unix>,v1=<hex>` com janela de tempo (proteção contra repetição) e comparação em tempo constante. */
export function verifySignature(secret: string, header: string | null | undefined, body: string, windowSec = 300, nowSec = Math.floor(Date.now() / 1000)): { ok: true; t: number } | { ok: false; reason: string } {
  const m = /^t=(\d{9,12}),v1=([0-9a-f]{64})$/.exec(String(header ?? "").trim());
  if (!m) return { ok: false, reason: "Cabeçalho X-Interos-Signature ausente ou malformado (t=<unix>,v1=<hex>)." };
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > windowSec) return { ok: false, reason: "Assinatura fora da janela de tempo (±5 min): possível repetição." };
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(m[2], "hex");
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return { ok: false, reason: "Assinatura inválida." };
  return { ok: true, t };
}

export async function emitInterosEvent(store: Store, companyId: string, type: InterosEventType, data: Record<string, unknown>, dedupeKey?: string) {
  const at = nowIso();
  const key = dedupeKey ?? `${type}:${companyId}:${at}:${crypto.randomBytes(4).toString("hex")}`;
  return enqueue(store, { type: "interos.event", companyId, dedupeKey: `interos:${key}`, payload: { event: { type, companyId, at, data } }, maxAttempts: 12 });
}

registerJob("interos.event", async (_ctx, payload) => {
  const url = process.env.INTEROS_EVENTS_URL;
  const secret = process.env.INTEROS_OUTBOUND_SECRET;
  if (!url || !secret) return { delivered: false, reason: "not_configured" };
  const body = JSON.stringify({ ...payload.event, eventId: `${payload.event.type}:${payload.event.companyId}:${payload.event.at}` });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-erp-signature": signBody(secret, body), "x-erp-event-type": payload.event.type },
    body,
    signal: AbortSignal.timeout(15000),
  });
  // 2xx entregue; 4xx (exceto 408/429) não adianta repetir; demais → retentativa da fila
  if (res.ok) return { delivered: true, status: res.status };
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return { delivered: false, status: res.status, reason: "rejected_by_interos" };
  throw new Error(`Interos respondeu ${res.status}`);
});
