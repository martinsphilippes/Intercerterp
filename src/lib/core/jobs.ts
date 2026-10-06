import { detId, isConflict, listAll } from "../db";
import type { Store } from "../db/types";
import { nowIso } from "../dates";
import { systemCtx, type Ctx } from "./ctx";

/**
 * Tarefas duráveis (outbox). Toda operação que precisa de efeito externo
 * (emissão fiscal, consulta de cobrança, notificações, backups) grava uma tarefa
 * com chave de deduplicação; o executor processa com retentativas e recuo exponencial.
 */

export type JobHandler = (ctx: Ctx, payload: any) => Promise<any>;
const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export interface EnqueueInput {
  type: string;
  payload: Record<string, any>;
  dedupeKey: string;
  companyId?: string | null;
  runAt?: string;
  maxAttempts?: number;
  createdBy?: string;
}

export async function enqueue(store: Store, input: EnqueueInput) {
  const id = detId("job", input.dedupeKey);
  try {
    return await store.create(
      "jobs",
      {
        companyId: input.companyId ?? null,
        type: input.type,
        payload: input.payload,
        status: "pending",
        runAt: input.runAt ?? nowIso(),
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 8,
        dedupeKey: input.dedupeKey,
        createdBy: input.createdBy ?? null,
      },
      id,
    );
  } catch (e) {
    if (isConflict(e)) {
      const existing = await store.get("jobs", id);
      // reativa tarefa concluída/morta somente se explicitamente reenfileirada com nova chave
      return existing!;
    }
    throw e;
  }
}

/** Reenfileira uma tarefa existente (retentativa manual). */
export async function requeue(store: Store, jobId: string) {
  // mantém a contagem de tentativas: a reivindicação usa (job, tentativa) — zerar colidiria com reivindicações anteriores
  const job = await store.getOrThrow("jobs", jobId);
  return store.update("jobs", jobId, { status: "pending", runAt: nowIso(), lastError: null, maxAttempts: (job.attempts ?? 0) + 8, finishedAt: null });
}

function backoffMs(attempt: number) {
  return Math.min(60 * 60 * 1000, 15000 * 2 ** (attempt - 1));
}

const LOCK_MS = 10 * 60 * 1000;

/**
 * Processa tarefas vencidas. Cada tentativa é reivindicada por um registro único (evita execução dupla).
 * Tarefas que ficaram "running" além do prazo de trava (executor interrompido, timeout da função)
 * são retomadas na próxima execução. `deadlineMs` limita o tempo do lote (funções serverless).
 */
export async function runDueJobs(store: Store, opts: { limit?: number; types?: string[]; jobIds?: string[]; deadlineMs?: number } = {}) {
  const now = nowIso();
  const due: any = ["or", [
    ["and", [["eq", "status", ["pending", "retry"]], ["lte", "runAt", now]]],
    ["and", [["eq", "status", "running"], ["lt", "lockedUntil", now]]],
  ]];
  const filters: any[] = [due];
  if (opts.types) filters.push(["eq", "type", opts.types]);
  if (opts.jobIds) filters.push(["eq", "id", opts.jobIds]);
  const res = await store.list("jobs", { filters, orderBy: [{ field: "runAt", dir: "asc" }], limit: opts.limit ?? 20 });
  const results: Array<{ id: string; type: string; status: string; error?: string }> = [];
  for (const job of res.items) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const attempt = (job.attempts ?? 0) + 1;
    try {
      await store.create("operations", { type: "job_claim", status: "running", entityType: "job", entityId: job.id }, detId("claim", job.id, attempt));
    } catch (e) {
      if (isConflict(e)) continue; // outro executor já pegou esta tentativa
      throw e;
    }
    try {
      await store.update("jobs", job.id, { status: "running", attempts: attempt, lockedUntil: new Date(Date.now() + LOCK_MS).toISOString() });
    } catch (e: any) {
      results.push({ id: job.id, type: job.type, status: "skipped", error: `Falha ao reivindicar: ${e?.message ?? e}` });
      continue;
    }
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`Sem executor registrado para tarefa ${job.type}`);
      const ctx = systemCtx(store, job.companyId ?? "", job.payload?.branchId ?? null);
      const result = await handler(ctx, job.payload ?? {});
      if (result && typeof result === "object" && result.__retryAt) {
        await store.update("jobs", job.id, { status: "retry", runAt: result.__retryAt, result: result.state ?? null, attempts: attempt, lockedUntil: null });
        results.push({ id: job.id, type: job.type, status: "retry" });
      } else {
        await store.update("jobs", job.id, { status: "done", result: result ?? null, finishedAt: nowIso(), lastError: null, lockedUntil: null });
        results.push({ id: job.id, type: job.type, status: "done" });
      }
    } catch (e: any) {
      const dead = attempt >= (job.maxAttempts ?? 8);
      try {
        await store.update("jobs", job.id, {
          status: dead ? "dead" : "retry",
          lastError: String(e?.message ?? e).slice(0, 4000),
          runAt: new Date(Date.now() + backoffMs(attempt)).toISOString(),
          finishedAt: dead ? nowIso() : null,
          lockedUntil: null,
        });
      } catch (e2) {
        console.error("[jobs] falha ao registrar erro da tarefa", job.id, e2);
      }
      results.push({ id: job.id, type: job.type, status: dead ? "dead" : "retry", error: String(e?.message ?? e) });
      if (dead && job.companyId) {
        const { notify } = await import("./notify");
        await notify(store, {
          companyId: job.companyId,
          type: "integration_failure",
          priority: "high",
          title: `Tarefa falhou definitivamente: ${job.type}`,
          body: String(e?.message ?? e).slice(0, 500),
          link: `/administracao/integracoes?tarefa=${job.id}`,
          originType: "job",
          originId: job.id,
          occurrenceKey: `job:${job.id}`,
          audience: { action: "admin.integrations" },
        }).catch(() => undefined);
      }
    }
  }
  return results;
}

/** Tarefa travada: "running" com trava vencida (executor interrompido). */
export function isStale(job: { status?: string; lockedUntil?: string | null }) {
  return job.status === "running" && Boolean(job.lockedUntil) && job.lockedUntil! < nowIso();
}

/** Retorna tarefas por origem (para mostrar pendências nas telas). */
export async function jobsFor(store: Store, dedupePrefix: string) {
  const all = await listAll(store, "jobs", { filters: [["startsWith", "dedupeKey", dedupePrefix]] }, 200);
  return all;
}
