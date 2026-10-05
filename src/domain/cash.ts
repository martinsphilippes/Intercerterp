import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { nowIso, today } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { transferBetweenAccounts } from "./finance";
import { formatMoney } from "@/lib/money";
import { getSetting } from "@/lib/core/settings";
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";

/**
 * Caixa (Telas 12–14).
 *  - Fundo de troco não é receita; suprimento não é venda; sangria não reduz faturamento.
 *  - Uma única sessão aberta por terminal (chave de trava única).
 *  - Fechamento preserva previsto × informado e divergências; reabertura gera nova versão.
 *  - Dinheiro esperado = fundo + recebimentos em espécie (líquidos de troco) + suprimentos − sangrias − devoluções em espécie.
 */

export const CASH_MOVEMENT_LABEL: Record<string, string> = {
  opening: "Fundo de abertura",
  supply: "Suprimento",
  withdrawal: "Sangria",
  sale: "Recebimento de venda",
  refund: "Devolução ao cliente",
  closing_adjust: "Ajuste de fechamento",
};

export async function currentSession(ctx: Ctx, terminalId: string): Promise<Doc | null> {
  const res = await ctx.store.list("cash_sessions", { filters: [["eq", "terminalId", terminalId], ["eq", "status", ["open", "reopened"]]], limit: 1 });
  return res.items[0] ?? null;
}

export async function openSession(ctx: Ctx, input: { terminalId: string; openingFund: number; peripheralsCheck?: Record<string, any>; notes?: string }) {
  requirePerm(ctx, "cash", "create");
  const branchId = requireBranch(ctx);
  const terminal = await ctx.store.getOrThrow("terminals", input.terminalId);
  assert(terminal.branchId === branchId, "Terminal pertence a outra filial.");
  assert(terminal.status === "active", "Terminal inativo.");
  assert(Number.isInteger(input.openingFund) && input.openingFund >= 0, "Fundo inicial não pode ser negativo.");
  const existing = await currentSession(ctx, terminal.id);
  if (existing) {
    if (existing.operatorId === ctx.user.id) return existing; // retoma a sessão
    const op = await ctx.store.get("users", existing.operatorId);
    throw new BusinessError(`Já existe caixa aberto neste terminal (nº ${existing.number}, operador: ${op?.name ?? "outro usuário"}). Feche-o antes de abrir outro.`, "session_open");
  }
  const number = await nextNumber(ctx.store, `cash:${terminal.id}`);
  const lockKey = `open:${terminal.id}`;
  try {
    const session = await ctx.store.transaction(async (t) => {
      const s = await t.create("cash_sessions", {
        companyId: ctx.companyId,
        branchId,
        createdBy: ctx.user.id,
        terminalId: terminal.id,
        operatorId: ctx.user.id,
        status: "open",
        number,
        openedAt: nowIso(),
        openingFund: input.openingFund,
        version: 1,
        peripheralsCheck: input.peripheralsCheck ?? null,
        lockKey,
        history: [{ at: nowIso(), event: "opened", by: ctx.user.name }],
      });
      await t.create("cash_movements", {
        companyId: ctx.companyId, branchId, createdBy: ctx.user.id, sessionId: s.id, number: 1, type: "opening", method: "cash",
        amount: input.openingFund, reason: "Fundo de troco", occurredAt: nowIso(), idemKey: `opening:${s.id}`, notes: input.notes ?? null, sessionVersion: 1,
      }, detId("cashmov", `opening:${s.id}`));
      return s;
    });
    await audit(ctx, { module: "cash", action: "session.open", entityType: "cash_session", entityId: session.id, summary: `Caixa nº ${number} aberto no terminal ${terminal.name} com fundo ${formatMoney(input.openingFund)}`, after: { openingFund: input.openingFund, peripheralsCheck: input.peripheralsCheck ?? null }, related: [`terminal:${terminal.id}`] });
    return session;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Outro caixa foi aberto neste terminal ao mesmo tempo. Atualize a página.", "session_open");
    throw e;
  }
}

export async function addCashMovement(
  ctx: Ctx,
  input: {
    sessionId: string; type: "supply" | "withdrawal"; amount: number; reason: string; recipient?: string | null; responsibleId?: string | null; accountId?: string | null; notes?: string | null; idemKey: string;
    /** autorização do gerente quando a sangria passa do valor da política `cash.withdrawalApprovalAbove` */
    approval?: SupervisorCredentials | null;
  },
) {
  requireAction(ctx, "cash.withdrawal");
  const id = detId("cashmov", input.idemKey);
  const existing = await ctx.store.get("cash_movements", id);
  if (existing) return existing; // repetição (duplo clique) devolve o mesmo movimento
  const s = await ctx.store.getOrThrow("cash_sessions", input.sessionId);
  assert(s.companyId === ctx.companyId, "Sessão de outra empresa.");
  assert(["open", "reopened"].includes(s.status), "Sessão de caixa não está aberta.");
  assert(Number.isInteger(input.amount) && input.amount > 0, "Informe um valor positivo.");
  assert(input.reason?.trim(), "Informe o motivo.");
  let cashAccount: Doc | null = null;
  if (input.accountId) {
    const acc = await ctx.store.getOrThrow("financial_accounts", input.accountId);
    assert(acc.companyId === ctx.companyId && acc.active !== false, "Conta financeira inválida.");
    cashAccount = await cashAccountFor(ctx, s.branchId);
    assert(cashAccount, "Filial sem conta financeira do tipo Caixa: não é possível registrar a transferência.");
    assert(cashAccount.id !== acc.id, "A conta de origem/destino deve ser diferente da conta Caixa da filial.");
  }
  let responsibleName: string | null = input.recipient?.trim() || null;
  if (input.responsibleId) {
    const r = await ctx.store.get("users", input.responsibleId);
    assert(r && (r.isAdmin || (r.companyIds ?? []).includes(ctx.companyId)), "Responsável inválido.");
    responsibleName = r.name;
  }
  let approver: { id: string; name: string } | null = null;
  if (input.type === "withdrawal") {
    const summary = await sessionSummary(ctx, s.id);
    if (input.amount > summary.expected.cash) throw new BusinessError(`Sangria maior que o dinheiro disponível no caixa (${formatMoney(summary.expected.cash)}).`, "insufficient_cash");
    const limit = Number(await getSetting(ctx.store, ctx.companyId, s.branchId, "cash.withdrawalApprovalAbove", 0)) || 0;
    if (limit > 0 && input.amount > limit) {
      if (!input.approval) throw new BusinessError(`Sangrias acima de ${formatMoney(limit)} exigem autorização adicional do gerente (login e senha).`, "approval_required");
      const a = await verifySupervisor(ctx, input.approval, "cash.reopen", `sangria de ${formatMoney(input.amount)}`);
      assert(a.id !== ctx.user.id, "A autorização adicional deve ser de outro usuário (gerente).", "approval_denied");
      approver = { id: a.id, name: a.name };
    }
  }
  const number = await nextNumber(ctx.store, `cashmov:${s.id}`);
  let mov: Doc;
  try {
    mov = await ctx.store.create(
      "cash_movements",
      {
        companyId: ctx.companyId, branchId: s.branchId, createdBy: ctx.user.id, sessionId: s.id, number, type: input.type, method: "cash",
        amount: input.type === "withdrawal" ? -input.amount : input.amount, reason: input.reason.trim(), recipient: responsibleName,
        responsibleId: input.responsibleId ?? null, approvedBy: approver?.id ?? null,
        accountId: input.accountId ?? null, occurredAt: nowIso(), idemKey: input.idemKey, notes: input.notes?.trim() || null, sessionVersion: s.version ?? 1,
      },
      id,
    );
  } catch (e) {
    if (isConflict(e)) return ctx.store.getOrThrow("cash_movements", id);
    throw e;
  }
  // Sangria com destino em conta financeira = transferência (não é despesa). Suprimento vindo de conta idem.
  if (input.accountId && cashAccount) {
    const tr = await transferBetweenAccounts(ctx, {
      fromAccountId: input.type === "withdrawal" ? cashAccount.id : input.accountId,
      toAccountId: input.type === "withdrawal" ? input.accountId : cashAccount.id,
      amount: input.amount,
      date: today(),
      description: `${input.type === "withdrawal" ? "Sangria" : "Suprimento"} caixa nº ${s.number} — ${input.reason}`,
      idemKey: `cashmov:${input.idemKey}`,
      kind: input.type === "withdrawal" ? "cash_withdrawal" : "cash_supply",
    });
    mov = await ctx.store.update("cash_movements", mov.id, { transferId: tr.id });
  }
  await audit(ctx, {
    module: "cash", action: `cash.${input.type}`, entityType: "cash_session", entityId: s.id,
    summary: `${input.type === "withdrawal" ? "Sangria" : "Suprimento"} nº ${number} de ${formatMoney(input.amount)} — ${input.reason}${responsibleName ? ` (responsável: ${responsibleName})` : ""}${approver ? ` · autorizada por ${approver.name}` : ""}`,
    related: [`cash_movement:${mov.id}`, input.accountId ? `financial_account:${input.accountId}` : ""].filter(Boolean),
  });
  return mov;
}

/** Conta financeira do tipo "caixa" da filial (recebe dinheiro do PDV). */
export async function cashAccountFor(ctx: Ctx, branchId: string) {
  const res = await ctx.store.list("financial_accounts", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchId], ["eq", "kind", "cash"], ["eq", "active", true]], limit: 1 });
  return res.items[0] ?? null;
}

export interface SessionSummary {
  session: Doc;
  byMethod: Record<string, { label: string; expected: number; count: number }>;
  expected: { cash: number };
  movements: Doc[];
  totals: { sales: number; salesCount: number; supply: number; withdrawal: number; refunds: number; change: number; cashSales: number; opening: number };
}

/** Previsto por meio de pagamento (dinheiro físico separado de cartões/Pix). */
export async function sessionSummary(ctx: Ctx, sessionId: string): Promise<SessionSummary> {
  const session = await ctx.store.getOrThrow("cash_sessions", sessionId);
  const movements = await listAll(ctx.store, "cash_movements", { filters: [["eq", "sessionId", sessionId]], orderBy: [{ field: "occurredAt", dir: "asc" }] });
  const sales = await listAll(ctx.store, "sales", { filters: [["eq", "cashSessionId", sessionId], ["eq", "status", ["completed", "cancelled"]]] });
  const saleIds = sales.filter((s) => s.status === "completed").map((s) => s.id);
  const payments: Doc[] = [];
  for (let i = 0; i < saleIds.length; i += 100) {
    payments.push(...(await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleIds.slice(i, i + 100)]] })));
  }
  const byMethod: SessionSummary["byMethod"] = {};
  const labels: Record<string, string> = { cash: "Dinheiro", debit: "Cartão de débito", credit: "Cartão de crédito", pix: "Pix", store_credit: "Vale-crédito", crediario: "Crediário", boleto: "Boleto", voucher: "Voucher", other: "Outros" };
  for (const p of payments) {
    if (p.status === "cancelled" || p.status === "failed") continue;
    const k = p.methodKind;
    byMethod[k] ??= { label: labels[k] ?? p.methodName ?? k, expected: 0, count: 0 };
    byMethod[k].expected += p.amount; // valor aplicado na venda (sem troco)
    byMethod[k].count += 1;
  }
  const sum = (type: string) => movements.filter((m) => m.type === type).reduce((a, m) => a + m.amount, 0);
  const opening = sum("opening");
  const supply = sum("supply");
  const withdrawal = 0 - sum("withdrawal");
  const refunds = 0 - sum("refund");
  const cashSales = sum("sale"); // valor aplicado à venda (já líquido do troco)
  const change = payments.reduce((a, p) => a + (p.change ?? 0), 0);
  const adjust = sum("closing_adjust");
  // Troco não é deduzido novamente: o movimento "sale" registra apenas o valor aplicado.
  const cash = opening + cashSales + supply - withdrawal - refunds + adjust;
  byMethod.cash ??= { label: "Dinheiro", expected: 0, count: 0 };
  const salesCompleted = sales.filter((s) => s.status === "completed");
  return {
    session,
    byMethod,
    expected: { cash },
    movements,
    totals: { sales: salesCompleted.reduce((a, s) => a + s.total, 0), salesCount: salesCompleted.length, supply, withdrawal, refunds, change, cashSales, opening },
  };
}

/** Conferências finais exigidas no fechamento (somente as aplicáveis aos meios movimentados na sessão). */
export function requiredChecklist(summary: SessionSummary) {
  const has = (k: string) => (summary.byMethod[k]?.count ?? 0) > 0;
  return [
    { key: "cashCounted", label: "Dinheiro contado", hint: "Notas, moedas e fundo de troco conferidos.", applies: true },
    { key: "cardsReconciled", label: "Cartões conferidos", hint: "Crédito e débito comparados com os comprovantes/relatório da maquininha.", applies: has("debit") || has("credit") },
    { key: "pixReconciled", label: "Pix conferido", hint: "Transações confirmadas na conta recebedora.", applies: has("pix") },
    { key: "cashDelivered", label: "Numerário entregue", hint: "Valores encaminhados ao responsável ou cofre.", applies: true },
  ].filter((c) => c.applies);
}

/** Apuração sem gravar (conferência cega: o previsto só é revelado depois de informado o contado). */
export async function previewClose(ctx: Ctx, sessionId: string, counted: Record<string, number>) {
  requirePerm(ctx, "cash", "edit");
  const s = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assert(s.companyId === ctx.companyId, "Sessão de outra empresa.");
  const summary = await sessionSummary(ctx, s.id);
  const expected: Record<string, number> = { cash: summary.expected.cash };
  for (const [k, v] of Object.entries(summary.byMethod)) if (k !== "cash") expected[k] = v.expected;
  const differences: Record<string, number> = {};
  for (const k of new Set([...Object.keys(expected), ...Object.keys(counted)])) {
    const d = (counted[k] ?? 0) - (expected[k] ?? 0);
    if (d !== 0) differences[k] = d;
  }
  return { expected, differences };
}

export async function closeSession(
  ctx: Ctx,
  input: { sessionId: string; counted: Record<string, number>; justification?: string | null; checklist?: Record<string, boolean>; transferToAccountId?: string | null; transferAmount?: number; idemKey?: string; blind?: boolean; enforceChecklist?: boolean },
) {
  requirePerm(ctx, "cash", "edit");
  const s = await ctx.store.getOrThrow("cash_sessions", input.sessionId);
  assert(s.companyId === ctx.companyId, "Sessão de outra empresa.");
  if (s.status === "closed") {
    const last = [...(s.history ?? [])].reverse().find((h: any) => h.event === "closed");
    if (input.idemKey && last?.idemKey === input.idemKey) return s; // repetição do mesmo fechamento
  }
  assert(["open", "reopened"].includes(s.status), "Sessão já está fechada.");
  for (const [k, v] of Object.entries(input.counted)) assert(Number.isInteger(v) && v >= 0, `Valor informado inválido para ${k}.`);
  const summary = await sessionSummary(ctx, s.id);
  const expected: Record<string, number> = { cash: summary.expected.cash };
  for (const [k, v] of Object.entries(summary.byMethod)) if (k !== "cash") expected[k] = v.expected;
  const differences: Record<string, number> = {};
  for (const k of new Set([...Object.keys(expected), ...Object.keys(input.counted)])) {
    const d = (input.counted[k] ?? 0) - (expected[k] ?? 0);
    if (d !== 0) differences[k] = d;
  }
  const hasDiff = Object.keys(differences).length > 0;
  if (hasDiff) assert(input.justification?.trim(), "Há divergências entre previsto e informado: registre a justificativa.", "justification_required");
  if (input.enforceChecklist) {
    const missing = requiredChecklist(summary).filter((k) => !input.checklist?.[k.key]);
    assert(missing.length === 0, `Conferências finais pendentes: ${missing.map((m) => m.label).join(", ")}.`, "checklist_pending");
  }
  const closedAt = nowIso();
  const history = [
    ...(s.history ?? []),
    { at: closedAt, event: "closed", by: ctx.user.name, byId: ctx.user.id, version: s.version ?? 1, expected, counted: input.counted, differences, justification: input.justification ?? null, checklist: input.checklist ?? null, totals: summary.totals, idemKey: input.idemKey ?? null, blind: Boolean(input.blind) },
  ];
  const updated = await ctx.store.update("cash_sessions", s.id, {
    status: "closed",
    closedAt,
    closedBy: ctx.user.id,
    expected,
    counted: input.counted,
    differences,
    justification: input.justification ?? null,
    checklist: input.checklist ?? null,
    lockKey: `closed:${s.id}:${s.version}`,
    history,
  });
  // Dinheiro informado (e não o previsto) é o que efetivamente vai para a conta de destino, se escolhida.
  if (input.transferToAccountId && (input.transferAmount ?? 0) > 0) {
    assert((input.transferAmount ?? 0) <= (input.counted.cash ?? 0), "Recolhimento maior que o dinheiro contado.");
    const cashAcc = await cashAccountFor(ctx, s.branchId);
    if (cashAcc && cashAcc.id !== input.transferToAccountId) {
      await transferBetweenAccounts(ctx, {
        fromAccountId: cashAcc.id, toAccountId: input.transferToAccountId, amount: input.transferAmount!, date: today(),
        description: `Recolhimento do fechamento do caixa nº ${s.number}`, idemKey: `close:${s.id}:${s.version}`, kind: "cash_withdrawal",
      });
    }
  }
  await audit(ctx, {
    module: "cash", action: "session.close", entityType: "cash_session", entityId: s.id,
    summary: `Caixa nº ${s.number} fechado (versão ${s.version ?? 1})${hasDiff ? " com divergência: " + Object.entries(differences).map(([k, v]) => `${summary.byMethod[k]?.label ?? k} ${v > 0 ? "+" : ""}${formatMoney(v)}`).join(", ") : " sem divergência"}`,
    after: { expected, counted: input.counted, differences }, reason: input.justification ?? null,
  });
  return updated;
}

/** Reabre: preserva o fechamento anterior no histórico e cria nova versão de conferência. */
export async function reopenSession(ctx: Ctx, sessionId: string, reason: string) {
  requireAction(ctx, "cash.reopen");
  assert(reason?.trim(), "Informe o motivo da reabertura.");
  const s = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assert(s.companyId === ctx.companyId, "Sessão de outra empresa.");
  assert(s.status === "closed", "Somente caixas fechados podem ser reabertos.");
  const other = await currentSession(ctx, s.terminalId);
  if (other) throw new BusinessError("Há outra sessão aberta neste terminal. Feche-a antes de reabrir esta.", "session_open");
  const history = [...(s.history ?? []), { at: nowIso(), event: "reopened", by: ctx.user.name, reason, previousVersion: s.version }];
  try {
    const updated = await ctx.store.update("cash_sessions", s.id, { status: "reopened", version: (s.version ?? 1) + 1, lockKey: `open:${s.terminalId}`, history, closedAt: null, closedBy: null });
    await audit(ctx, { module: "cash", action: "session.reopen", entityType: "cash_session", entityId: s.id, summary: `Caixa nº ${s.number} reaberto (versão ${updated.version})`, reason });
    return updated;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Há outra sessão aberta neste terminal.", "session_open");
    throw e;
  }
}
