import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { nowIso, today } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { transferBetweenAccounts } from "./finance";

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
  const branchId = requireBranch(ctx);
  const terminal = await ctx.store.getOrThrow("terminals", input.terminalId);
  assert(terminal.branchId === branchId, "Terminal pertence a outra filial.");
  assert(terminal.status === "active", "Terminal inativo.");
  assert(input.openingFund >= 0, "Fundo inicial não pode ser negativo.");
  const existing = await currentSession(ctx, terminal.id);
  if (existing) {
    if (existing.operatorId === ctx.user.id) return existing; // retoma a sessão
    throw new BusinessError(`Já existe caixa aberto neste terminal (operador: ${existing.createdBy === ctx.user.id ? "você" : "outro usuário"}). Feche-o antes de abrir outro.`, "session_open");
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
        amount: input.openingFund, reason: "Fundo de troco", occurredAt: nowIso(), idemKey: `opening:${s.id}`, notes: input.notes ?? null,
      });
      return s;
    });
    await audit(ctx, { module: "cash", action: "session.open", entityType: "cash_session", entityId: session.id, summary: `Caixa nº ${number} aberto no terminal ${terminal.name} com fundo ${(input.openingFund / 100).toFixed(2)}`, related: [`terminal:${terminal.id}`] });
    return session;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Outro caixa foi aberto neste terminal ao mesmo tempo. Atualize a página.", "session_open");
    throw e;
  }
}

export async function addCashMovement(
  ctx: Ctx,
  input: { sessionId: string; type: "supply" | "withdrawal"; amount: number; reason: string; recipient?: string; accountId?: string | null; notes?: string; idemKey: string },
) {
  requireAction(ctx, "cash.withdrawal");
  const s = await ctx.store.getOrThrow("cash_sessions", input.sessionId);
  assert(["open", "reopened"].includes(s.status), "Sessão de caixa não está aberta.");
  assert(input.amount > 0, "Informe um valor positivo.");
  assert(input.reason?.trim(), "Informe o motivo.");
  const id = detId("cashmov", input.idemKey);
  const existing = await ctx.store.get("cash_movements", id);
  if (existing) return existing;
  if (input.type === "withdrawal") {
    const summary = await sessionSummary(ctx, s.id);
    if (input.amount > summary.expected.cash) throw new BusinessError(`Sangria maior que o dinheiro disponível no caixa (${(summary.expected.cash / 100).toFixed(2)}).`, "insufficient_cash");
  }
  const number = await nextNumber(ctx.store, `cashmov:${s.id}`);
  const mov = await ctx.store.create(
    "cash_movements",
    {
      companyId: ctx.companyId, branchId: s.branchId, createdBy: ctx.user.id, sessionId: s.id, number, type: input.type, method: "cash",
      amount: input.type === "withdrawal" ? -input.amount : input.amount, reason: input.reason, recipient: input.recipient ?? null,
      accountId: input.accountId ?? null, occurredAt: nowIso(), idemKey: input.idemKey, notes: input.notes ?? null,
    },
    id,
  );
  // Sangria com destino em conta financeira = transferência (não é despesa). Suprimento vindo de conta idem.
  if (input.accountId) {
    const cashAccount = await cashAccountFor(ctx, s.branchId);
    if (cashAccount) {
      await transferBetweenAccounts(ctx, {
        fromAccountId: input.type === "withdrawal" ? cashAccount.id : input.accountId,
        toAccountId: input.type === "withdrawal" ? input.accountId : cashAccount.id,
        amount: input.amount,
        date: today(),
        description: `${input.type === "withdrawal" ? "Sangria" : "Suprimento"} caixa nº ${s.number} — ${input.reason}`,
        idemKey: `cashmov:${input.idemKey}`,
        kind: input.type === "withdrawal" ? "cash_withdrawal" : "cash_supply",
      });
    }
  }
  await audit(ctx, { module: "cash", action: `cash.${input.type}`, entityType: "cash_session", entityId: s.id, summary: `${input.type === "withdrawal" ? "Sangria" : "Suprimento"} de ${(input.amount / 100).toFixed(2)} — ${input.reason}`, related: [`cash_movement:${mov.id}`] });
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
  const withdrawal = -sum("withdrawal");
  const refunds = -sum("refund");
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

export async function closeSession(
  ctx: Ctx,
  input: { sessionId: string; counted: Record<string, number>; justification?: string; checklist?: Record<string, boolean>; transferToAccountId?: string | null; transferAmount?: number },
) {
  const s = await ctx.store.getOrThrow("cash_sessions", input.sessionId);
  assert(["open", "reopened"].includes(s.status), "Sessão já está fechada.");
  const summary = await sessionSummary(ctx, s.id);
  const expected: Record<string, number> = { cash: summary.expected.cash };
  for (const [k, v] of Object.entries(summary.byMethod)) if (k !== "cash") expected[k] = v.expected;
  const differences: Record<string, number> = {};
  for (const k of new Set([...Object.keys(expected), ...Object.keys(input.counted)])) {
    const d = (input.counted[k] ?? 0) - (expected[k] ?? 0);
    if (d !== 0) differences[k] = d;
  }
  const hasDiff = Object.keys(differences).length > 0;
  if (hasDiff) assert(input.justification?.trim(), "Há divergências entre previsto e informado: registre a justificativa.");
  const history = [...(s.history ?? []), { at: nowIso(), event: "closed", by: ctx.user.name, version: s.version, expected, counted: input.counted, differences }];
  const updated = await ctx.store.update("cash_sessions", s.id, {
    status: "closed",
    closedAt: nowIso(),
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
    summary: `Caixa nº ${s.number} fechado${hasDiff ? " com divergência" : ""}`, after: { expected, counted: input.counted, differences }, reason: input.justification ?? null,
  });
  return updated;
}

/** Reabre: preserva o fechamento anterior no histórico e cria nova versão de conferência. */
export async function reopenSession(ctx: Ctx, sessionId: string, reason: string) {
  requireAction(ctx, "cash.reopen");
  assert(reason?.trim(), "Informe o motivo da reabertura.");
  const s = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assert(s.status === "closed", "Somente caixas fechados podem ser reabertos.");
  const other = await currentSession(ctx, s.terminalId);
  if (other) throw new BusinessError("Há outra sessão aberta neste terminal. Feche-a antes de reabrir esta.", "session_open");
  const history = [...(s.history ?? []), { at: nowIso(), event: "reopened", by: ctx.user.name, reason, previousVersion: s.version }];
  try {
    const updated = await ctx.store.update("cash_sessions", s.id, { status: "reopened", version: (s.version ?? 1) + 1, lockKey: `open:${s.terminalId}`, history, closedAt: null });
    await audit(ctx, { module: "cash", action: "session.reopen", entityType: "cash_session", entityId: s.id, summary: `Caixa nº ${s.number} reaberto (versão ${updated.version})`, reason });
    return updated;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Há outra sessão aberta neste terminal.", "session_open");
    throw e;
  }
}
