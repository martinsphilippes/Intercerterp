import { detId, isConflict, listAll, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { BusinessError } from "@/lib/core/errors";
import { applyChanges, finalizePendingDeactivations, type ChangeSetInput } from "./changes";
import { takeBaseline } from "./baseline";

/**
 * Operações recebidas do Interos (aplicar lote): idempotência por (cliente, Idempotency-Key), estado confirmado pelo
 * ERP e agendamento. A MESMA chave com o MESMO corpo devolve o resultado da mesma operação; com corpo diferente é recusada.
 *
 * Estados: processing → applied | rejected | scheduled → applied | rejected | cancelled.
 */

export type OperationStatus = "processing" | "applied" | "rejected" | "scheduled" | "cancelled";

export interface ApplyRequest extends Omit<ChangeSetInput, "companyId"> {
  expectedVersion?: number | null;
  reason: string;
  /** aplicação agendada (ISO); ausente ou passado = imediata */
  effectiveAt?: string | null;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export const operationId = (clientId: string, idemKey: string) => detId("modop", clientId, idemKey);

export function publicOperation(op: Doc) {
  return {
    operationId: op.id, companyId: op.companyId, status: op.status as OperationStatus, kind: op.kind, actor: op.actor, reason: op.reason,
    idempotencyKey: op.idempotencyKey, versionBefore: op.versionBefore ?? null, versionAfter: op.versionAfter ?? null, scheduledFor: op.scheduledFor ?? null,
    createdAt: op.createdAt, finishedAt: op.finishedAt ?? null, result: op.result ?? null, error: op.error ?? null,
  };
}

export class IdempotencyMismatchError extends BusinessError {
  constructor() {
    super("Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova para uma operação diferente.", "idempotency_mismatch");
  }
}

/** Registra e executa (ou agenda) a aplicação de um lote. Repetição devolve a mesma operação. */
export async function submitApply(store: Store, input: { clientId: string; idempotencyKey: string; companyId: string; actor: string; request: ApplyRequest }): Promise<{ op: Doc; replayed: boolean }> {
  const { clientId, idempotencyKey, companyId, actor, request } = input;
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) throw new BusinessError("Idempotency-Key inválida (8 a 200 caracteres: letras, números, . _ : -).", "idempotency_key_invalid");
  if (!request.reason?.trim()) throw new BusinessError("Informe o motivo (reason).", "reason_required");
  if (!actor.trim()) throw new BusinessError("Informe o ator (X-Interos-Actor).", "actor_required");
  const requestHash = sha256(stable({ companyId, request }));
  const id = operationId(clientId, idempotencyKey);
  const existing = await store.get("module_operations", id);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyMismatchError();
    return { op: existing, replayed: true };
  }
  const scheduled = Boolean(request.effectiveAt && request.effectiveAt > nowIso());
  let op: Doc;
  try {
    op = await store.create("module_operations", {
      companyId, idempotencyKey, requestHash, clientId, kind: "apply", status: scheduled ? "scheduled" : "processing", actor, reason: request.reason,
      request, scheduledFor: scheduled ? request.effectiveAt : null,
    }, id);
  } catch (e) {
    if (!isConflict(e)) throw e;
    const again = (await store.get("module_operations", id))!;
    if (again.requestHash !== requestHash) throw new IdempotencyMismatchError();
    return { op: again, replayed: true };
  }
  if (scheduled) return { op, replayed: false };
  return { op: await execute(store, op), replayed: false };
}

async function execute(store: Store, op: Doc): Promise<Doc> {
  const req = op.request as ApplyRequest;
  try {
    const r = await applyChanges(store, { companyId: op.companyId, changes: req.changes ?? [], mode: req.mode, cascade: req.cascade, reviewDivergences: req.reviewDivergences }, {
      actor: op.actor, actorType: "interos", reason: op.reason, operationId: op.id,
      // agendada: a versão é conferida na execução contra a vigente (a esperada vale para a aplicação imediata)
      expectedVersion: op.status === "scheduled" ? null : req.expectedVersion ?? null,
    });
    const { entries: _entries, ...sim } = r.simulation;
    void _entries;
    return store.update("module_operations", op.id, { status: "applied", versionBefore: r.simulation.version, versionAfter: r.version, result: { simulation: sim, changeId: r.changeId }, finishedAt: nowIso(), error: null });
  } catch (e: any) {
    if (e instanceof BusinessError) return store.update("module_operations", op.id, { status: "rejected", error: { code: e.code, message: e.message, details: e.details ?? null }, finishedAt: nowIso() });
    // falha inesperada: a operação volta a "processing" com o erro e pode ser reenviada com a mesma chave
    await store.update("module_operations", op.id, { error: { code: "unexpected", message: String(e?.message ?? e) } }).catch(() => undefined);
    throw e;
  }
}

/** Repetição de uma operação que ficou em "processing" por falha inesperada (mesma chave, mesmo corpo). */
export async function resumeIfStuck(store: Store, op: Doc): Promise<Doc> {
  if (op.status !== "processing") return op;
  return execute(store, op);
}

export async function cancelScheduled(store: Store, opId: string, actor: string) {
  const op = await store.get("module_operations", opId);
  if (!op) throw new BusinessError("Operação não encontrada.", "not_found");
  if (op.status !== "scheduled") throw new BusinessError("Só operação agendada pode ser cancelada.", "invalid_state");
  return store.update("module_operations", opId, { status: "cancelled", finishedAt: nowIso(), error: { code: "cancelled", message: `Cancelada por ${actor}` } });
}

/**
 * Manutenção diária e sob demanda (rotina modules.maintenance): linha de base das empresas sem estado (modo legacy,
 * nada muda), operações agendadas vencidas e conclusão de desligamentos sem pendências.
 */
export async function runModulesMaintenance(store: Store, companyId: string) {
  const baseline = await takeBaseline(store, companyId);
  const due = await listAll(store, "module_operations", { filters: [["eq", "companyId", companyId], ["eq", "status", "scheduled"], ["lte", "scheduledFor", nowIso()]] });
  const executed: string[] = [];
  for (const op of due) {
    await execute(store, op);
    executed.push(op.id);
  }
  const finalize = await finalizePendingDeactivations(store, companyId);
  return { baselineCreated: baseline.created, scheduledExecuted: executed, ...finalize };
}
