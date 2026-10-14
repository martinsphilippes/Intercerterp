import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx, CtxUser } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { canDo } from "@/lib/permissions";
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";
import { OVERDUE_DEFAULTS, OVERDUE_KEYS, normalizePolicy, overdueBlockMessage, overdueBlocks, overdueText, summarizeOverdue, type OverdueParams, type OverdueStatus } from "./overdue";

/**
 * Inadimplência na venda (VEN-07) — avaliação central no servidor. As regras (tolerância, valor mínimo, política)
 * estão em `./overdue` (puro); aqui ficam a leitura dos parâmetros, a consulta das parcelas e a liberação auditada.
 */

/** Parâmetros efetivos (filial → empresa → padrão). Recurso desligado (`feature.inadimplencia`) = política "none". */
export async function overdueParams(store: Store, companyId: string, branchId: string | null | undefined): Promise<OverdueParams> {
  const enabled = await isFeatureOn(store, companyId, branchId, "inadimplencia", true);
  if (!enabled) return { enabled, policy: "none", graceDays: OVERDUE_DEFAULTS.graceDays, minAmount: OVERDUE_DEFAULTS.minAmount };
  const [policy, grace, min] = await Promise.all([
    getSetting<string>(store, companyId, branchId, OVERDUE_KEYS.policy, OVERDUE_DEFAULTS.policy),
    getSetting<number>(store, companyId, branchId, OVERDUE_KEYS.graceDays, OVERDUE_DEFAULTS.graceDays),
    getSetting<number>(store, companyId, branchId, OVERDUE_KEYS.minAmount, OVERDUE_DEFAULTS.minAmount),
  ]);
  return { enabled, policy: normalizePolicy(policy), graceDays: Math.max(0, Math.trunc(Number(grace) || 0)), minAmount: Math.max(0, Math.trunc(Number(min) || 0)) };
}

/** Parcelas a receber em aberto do(s) cliente(s) — mesma consulta usada no limite de crédito. */
export async function openReceivablesOf(store: Store, companyId: string, customerIds: string[]): Promise<Doc[]> {
  if (!customerIds.length) return [];
  return listAll(store, "installments", { filters: [["eq", "companyId", companyId], ["eq", "partyId", customerIds], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
}

/** Situação de inadimplência de um cliente segundo os parâmetros da filial. */
export async function customerOverdueStatus(store: Store, companyId: string, branchId: string | null | undefined, customerId: string, ref = today()): Promise<OverdueStatus> {
  const params = await overdueParams(store, companyId, branchId);
  return summarizeOverdue(await openReceivablesOf(store, companyId, [customerId]), params, ref);
}

export interface OverdueRelease {
  /** motivo da liberação (obrigatório) */
  reason?: string | null;
  /** autorização de outro usuário no terminal (login/senha); ausente = o próprio operador libera, se tiver a permissão */
  approval?: SupervisorCredentials | null;
}

export interface OverdueCheck {
  status: OverdueStatus;
  deferred: boolean;
  /** a política bloquearia esta venda (e ela só segue com liberação) */
  blocked: boolean;
  releasedBy: CtxUser | null;
  reason: string | null;
}

/**
 * Aplica a política na conclusão da venda (chamada por `finalizeSale` antes de gravar). Sem inadimplência, ou com a
 * política que não alcança esta venda, devolve null (nenhum efeito). Bloqueio sem liberação → erro `overdue_block`;
 * liberação exige motivo e a ação especial `sale.overdue_override` (do operador ou de quem autoriza com login/senha).
 */
export async function checkSaleOverdue(ctx: Ctx, input: { branchId: string; customerId: string; deferred: boolean; release?: OverdueRelease | null }): Promise<OverdueCheck | null> {
  const params = await overdueParams(ctx.store, ctx.companyId, input.branchId);
  if (params.policy === "none") return null;
  // avisar: só a venda a prazo é registrada; bloquear a prazo: venda à vista nem consulta
  if ((params.policy === "warn" || params.policy === "block_deferred") && !input.deferred) return null;
  const status = summarizeOverdue(await openReceivablesOf(ctx.store, ctx.companyId, [input.customerId]), params, today());
  if (!status.delinquent) return null;
  if (!overdueBlocks(status, input.deferred)) return { status, deferred: input.deferred, blocked: false, releasedBy: null, reason: null };
  const release = input.release;
  if (!release) throw new BusinessError(overdueBlockMessage(status), "overdue_block");
  const reason = (release.reason ?? "").trim();
  assert(reason.length >= 5, "Informe o motivo da liberação da venda para cliente inadimplente (mínimo 5 caracteres).", "overdue_reason");
  let approver: CtxUser;
  if (release.approval?.login) approver = await verifySupervisor(ctx, release.approval, "sale.overdue_override", "venda para cliente inadimplente");
  else if (canDo(ctx.user, "sale.overdue_override")) approver = ctx.user;
  else throw new BusinessError("Liberar venda para cliente inadimplente exige a permissão “Liberar venda para cliente inadimplente”: peça a autorização (login e senha) de um usuário que a tenha.", "overdue_override_denied");
  return { status, deferred: input.deferred, blocked: true, releasedBy: approver, reason: reason.slice(0, 500) };
}

/** Registro no histórico, depois do commit da venda: liberação (bloqueio superado) ou aviso (venda a prazo a inadimplente). */
export async function auditSaleOverdue(ctx: Ctx, check: OverdueCheck, sale: { id: string; number: number }, customer: { id: string; name: string }) {
  const st = check.status;
  const facts = { customerId: customer.id, policy: st.policy, overdueTotal: st.total, overdueInstallments: st.count, maxDaysLate: st.maxDaysLate, graceDays: st.graceDays, minAmount: st.minAmount, deferred: check.deferred };
  if (check.blocked) {
    const by = check.releasedBy!;
    await audit(ctx, {
      module: "sales", action: "sale.overdue_release", entityType: "sale", entityId: sale.id,
      summary: `Venda nº ${sale.number} liberada para cliente inadimplente (${customer.name} — ${overdueText(st)}) por ${by.name}${by.id !== ctx.user.id ? ` a pedido de ${ctx.user.name}` : ""}`,
      reason: check.reason, after: { ...facts, releasedBy: by.id, releasedByName: by.name }, related: [`customer:${customer.id}`],
    });
    return;
  }
  await audit(ctx, {
    module: "sales", action: "sale.overdue_warning", entityType: "sale", entityId: sale.id,
    summary: `Venda a prazo nº ${sale.number} concluída para cliente com ${formatMoney(st.total)} vencido (${customer.name}, ${st.maxDaysLate} dia(s) de atraso) — política “avisar”`,
    after: facts, related: [`customer:${customer.id}`],
  });
}
