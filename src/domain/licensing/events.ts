import crypto from "node:crypto";
import { after } from "next/server";
import type { Store } from "@/lib/db/types";
import { enqueue, registerJob } from "@/lib/core/jobs";
import { nowIso } from "@/lib/dates";

/**
 * Eventos do ERP para o Interos (contrato v2 §3 "Eventos do ERP para o Interos"): tarefa durável `interos.event` com
 * retentativa exponencial (fila existente), corpo assinado com HMAC-SHA256 no mesmo formato da entrada.
 *
 * Configuração (servidor): INTEROS_EVENTS_URL (destino) e INTEROS_OUTBOUND_SECRET (segredo da assinatura).
 * Sem configuração o evento fica NA FILA como "não enviado" (nunca marcado como entregue) e aparece em GET /v2/errors —
 * nunca bloqueia a operação do ERP. Nesta fase o Interos acompanha pelo histórico de licença (consulta a cada 5 min).
 */
export type InterosEventType = "license.applied" | "license.rejected" | "license.transition" | "upsell.requested" | "limit.reached" | "sync.stale";

// assinatura HMAC no mesmo formato da entrada (`t=<unix>,v1=<hex>`): src/lib/service/signature.ts
export { signBody, verifySignature } from "@/lib/service/signature";
import { signBody } from "@/lib/service/signature";

export async function emitInterosEvent(store: Store, companyId: string, type: InterosEventType, data: Record<string, unknown>, dedupeKey?: string) {
  const at = nowIso();
  const key = dedupeKey ?? `${type}:${companyId}:${at}:${crypto.randomBytes(4).toString("hex")}`;
  const job = await enqueue(store, { type: "interos.event", companyId, dedupeKey: `interos:${key}`, payload: { event: { type, companyId, at, data } }, maxAttempts: 12 });
  deliverSoon(job.id);
  return job;
}

const destinationConfigured = () => Boolean(process.env.INTEROS_EVENTS_URL && process.env.INTEROS_OUTBOUND_SECRET);

/**
 * Entrega NA HORA (pedido do Interos): logo depois de enfileirar, fora do tempo da resposta (`after`), tenta entregar
 * ESTE aviso. Falhou, ou não há destino configurado: fica na fila — novas tentativas pelo executor oportunista, pelas
 * consultas do Interos (`retryDueEventsSoon`) e pela rotina diária.
 */
function deliverSoon(jobId: string) {
  if (!destinationConfigured()) return;
  try {
    after(async () => {
      try {
        const [{ getStore }, { runDueJobs }] = await Promise.all([import("@/lib/db"), import("@/domain/jobs-registry")]);
        await runDueJobs(getStore(), { jobIds: [jobId], limit: 1, deadlineMs: Date.now() + 20_000 });
      } catch (e) {
        console.warn("[interos] entrega imediata do aviso falhou; ele fica na fila", (e as Error)?.message ?? e);
      }
    });
  } catch {
    // fora de uma requisição (rotina, testes): a fila entrega
  }
}

const g = globalThis as unknown as { __interosEventsRetryAt?: number };
/**
 * Novas tentativas dos avisos vencidos a cada consulta do Interos (no máximo a cada 30 s por instância), fora do tempo
 * da resposta: com o Interos consultando a cada 5 minutos, um aviso que falhou não espera a rotina diária.
 */
export function retryDueEventsSoon() {
  if (!destinationConfigured()) return;
  const now = Date.now();
  if (g.__interosEventsRetryAt && now - g.__interosEventsRetryAt < 30_000) return;
  g.__interosEventsRetryAt = now;
  try {
    after(async () => {
      try {
        const [{ getStore }, { runDueJobs }] = await Promise.all([import("@/lib/db"), import("@/domain/jobs-registry")]);
        await runDueJobs(getStore(), { types: ["interos.event"], limit: 20, deadlineMs: Date.now() + 20_000 });
      } catch (e) {
        console.warn("[interos] nova tentativa dos avisos falhou; eles ficam na fila", (e as Error)?.message ?? e);
      }
    });
  } catch {
    // fora de uma requisição: nada a fazer
  }
}

/** Sem destino configurado, o evento fica NA FILA (nova tentativa a cada 6 h) e aparece em GET /v2/errors (correção 10). */
export const UNCONFIGURED_RETRY_MS = 6 * 3600_000;
/** Depois de 30 dias sem destino configurado, o evento vai para "dead" (continua listado em GET /v2/errors). */
export const UNCONFIGURED_MAX_AGE_MS = 30 * 86400_000;

registerJob("interos.event", async (_ctx, payload) => {
  const url = process.env.INTEROS_EVENTS_URL;
  const secret = process.env.INTEROS_OUTBOUND_SECRET;
  if (!url || !secret) {
    // nunca marcado como entregue: fica na fila até o destino existir
    const at = Date.parse(String(payload?.event?.at ?? "")) || Date.now();
    if (Date.now() - at > UNCONFIGURED_MAX_AGE_MS) throw new Error("Destino dos eventos (INTEROS_EVENTS_URL/INTEROS_OUTBOUND_SECRET) não configurado há mais de 30 dias.");
    return { __retryAt: new Date(Date.now() + UNCONFIGURED_RETRY_MS).toISOString(), state: { delivered: false, reason: "not_configured" } };
  }
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
