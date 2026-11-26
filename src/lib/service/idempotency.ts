import { detId, isConflict, sha256 } from "../db";
import type { Doc, Store } from "../db/types";

/**
 * Idempotência e trilha das solicitações da interface de serviço (coleção `service_requests`).
 *
 * Cada solicitação que altera dados traz `Idempotency-Key`. O registro é único por (cliente, chave):
 *  - mesma chave e mesmo conteúdo, já concluída → devolve a MESMA resposta (nada é refeito);
 *  - mesma chave com conteúdo diferente → recusa (`idempotencia_conflito`), para um reenvio nunca virar outra operação;
 *  - mesma chave ainda em processamento → recusa temporária (`solicitacao_em_andamento`), para não rodar duas vezes;
 *  - mesma chave que falhou no meio (erro do servidor) → executa de novo: as operações de provisionamento são
 *    retomáveis (cada etapa tem identificador determinístico e só faz o que ainda falta).
 * O registro guarda quem pediu, o quê, quando, quantas tentativas, o resultado e o `requestId` — é a auditoria da chamada.
 */

export const LOCK_MS = 120_000;

export type IdemState = "processando" | "concluida" | "falhou";

export type IdemBegin =
  | { kind: "new" | "resume"; id: string; record: Doc }
  | { kind: "replay"; httpStatus: number; body: unknown; record: Doc }
  | { kind: "conflict"; record: Doc }
  | { kind: "busy"; record: Doc };

/** JSON canônico (chaves ordenadas): o mesmo conteúdo em outra ordem é o mesmo pedido. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function requestFingerprint(method: string, path: string, body: unknown): string {
  return sha256(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`);
}

export function idemRecordId(clientId: string, key: string): string {
  return detId("svcreq", clientId, key);
}

export async function beginIdempotent(
  store: Store,
  input: { clientId: string; key: string; fingerprint: string; operation: string; method: string; path: string; requestId: string; now?: Date },
): Promise<IdemBegin> {
  const id = idemRecordId(input.clientId, input.key);
  const now = input.now ?? new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
  const existing = await store.get("service_requests", id);
  if (!existing) {
    try {
      const record = await store.create(
        "service_requests",
        {
          kind: "mutation", clientId: input.clientId, idempotencyKey: input.key, operation: input.operation, method: input.method, path: input.path,
          requestHash: input.fingerprint, status: "processando" as IdemState, attempts: 1, lockedUntil, firstRequestId: input.requestId, lastRequestId: input.requestId,
          receivedAt: now.toISOString(),
        },
        id,
      );
      return { kind: "new", id, record };
    } catch (e) {
      if (!isConflict(e)) throw e;
      const raced = await store.get("service_requests", id);
      return raced ? classify(raced, input.fingerprint, now) ?? { kind: "busy", record: raced } : { kind: "busy", record: { id } as Doc };
    }
  }
  const verdict = classify(existing, input.fingerprint, now);
  if (verdict) return verdict;
  // falhou no meio, ou o processamento anterior caiu (trava vencida): retoma
  const record = await store.update("service_requests", id, { status: "processando", attempts: (existing.attempts ?? 0) + 1, lockedUntil, lastRequestId: input.requestId });
  return { kind: "resume", id, record };
}

function classify(rec: Doc, fingerprint: string, now: Date): IdemBegin | null {
  if (rec.requestHash !== fingerprint) return { kind: "conflict", record: rec };
  if (rec.status === "concluida") return { kind: "replay", httpStatus: rec.httpStatus ?? 200, body: rec.response ?? null, record: rec };
  if (rec.status === "processando" && rec.lockedUntil && rec.lockedUntil > now.toISOString()) return { kind: "busy", record: rec };
  return null;
}

export async function finishIdempotent(
  store: Store,
  id: string,
  out: { httpStatus: number; body: unknown; companyId?: string | null; outcome: "concluida" | "falhou"; error?: string | null },
) {
  await store.update("service_requests", id, {
    status: out.outcome,
    httpStatus: out.httpStatus,
    response: out.outcome === "concluida" ? out.body : null,
    error: out.error ?? null,
    targetCompanyId: out.companyId ?? null,
    lockedUntil: null,
    completedAt: new Date().toISOString(),
  });
}

/** Consulta (sem alteração): contador diário por cliente, operação e empresa — quem leu dados de qual empresa, e quanto. */
export async function recordRead(store: Store, input: { clientId: string; operation: string; companyId: string | null; requestId: string }) {
  const day = new Date().toISOString().slice(0, 10);
  const id = detId("svcread", input.clientId, input.operation, input.companyId ?? "", day);
  try {
    await store.increment("service_requests", id, "count", 1);
    await store.update("service_requests", id, { lastRequestId: input.requestId, completedAt: new Date().toISOString() });
  } catch {
    try {
      await store.create("service_requests", { kind: "read", clientId: input.clientId, operation: input.operation, targetCompanyId: input.companyId, day, count: 1, firstRequestId: input.requestId, lastRequestId: input.requestId, status: "concluida", receivedAt: new Date().toISOString(), completedAt: new Date().toISOString() }, id);
    } catch (e) {
      if (!isConflict(e)) console.warn("[servico] falha ao registrar a consulta", (e as Error)?.message);
      else await store.increment("service_requests", id, "count", 1).catch(() => undefined);
    }
  }
}
