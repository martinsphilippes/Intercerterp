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

// assinatura HMAC no mesmo formato da entrada (`t=<unix>,v1=<hex>`): src/lib/service/signature.ts
export { signBody, verifySignature } from "@/lib/service/signature";
import { signBody } from "@/lib/service/signature";

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
