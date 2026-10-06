import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { nowIso, today } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { assertUsableAccount, transferBetweenAccounts } from "./finance";
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

/**
 * Escrita em sessão de caixa: somente na filial ativa (não no consolidado) e, quando mexe na gaveta,
 * pelo próprio operador da sessão ou por quem tem a permissão de supervisão do caixa ("Reabrir caixa").
 */
export function assertSessionScope(ctx: Ctx, s: Doc, opts: { drawer?: boolean } = {}) {
  assert(s.companyId === ctx.companyId, "Sessão de outra empresa.");
  const branchId = requireBranch(ctx);
  assert(s.branchId === branchId, "Sessão de caixa de outra filial: selecione a filial da sessão para operar.", "branch_mismatch");
  if (opts.drawer) assert(s.operatorId === ctx.user.id || canDo(ctx.user, "cash.reopen"), "Somente o operador desta sessão (ou um supervisor de caixa) pode movimentar ou fechar esta gaveta.", "not_session_operator");
}

/** Conferência cega ativa para a filial da sessão (parâmetro do servidor — nunca vem do formulário). */
export async function blindCloseEnabled(ctx: Ctx, branchId: string) {
  return Boolean(await getSetting(ctx.store, ctx.companyId, branchId, "cash.blindClose", false));
}

/**
 * Situação da contagem cega da versão atual da sessão: "none" (não registrada), "valid" ou "stale" — o previsto
 * mudou depois da contagem (venda, cancelamento, suprimento, sangria ou devolução registrados depois): a contagem
 * não vale mais e precisa ser refeita (a anterior fica preservada em `blindCount.superseded`).
 */
export function blindCountState(s: Doc, expectedNow: Record<string, number>): "none" | "valid" | "stale" {
  const bc = s.blindCount;
  if (!bc || bc.version !== (s.version ?? 1)) return "none";
  if (!bc.expected) return "valid"; // contagem registrada antes do controle de recontagem
  const keys = new Set([...Object.keys(bc.expected), ...Object.keys(expectedNow)]);
  for (const k of keys) if ((bc.expected[k] ?? 0) !== (expectedNow[k] ?? 0)) return "stale";
  return "valid";
}

/**
 * O previsto de uma sessão aberta só é exibido quando a conferência cega está desligada, quando a contagem
 * desta versão já foi registrada (e continua válida: nada mudou no previsto depois dela), ou para supervisores de caixa.
 */
export async function expectedVisible(ctx: Ctx, s: Doc, blind?: boolean) {
  if (!["open", "reopened"].includes(s.status)) return true;
  if (canDo(ctx.user, "cash.reopen")) return true;
  const isBlind = blind ?? (await blindCloseEnabled(ctx, s.branchId));
  if (!isBlind) return true;
  if (s.blindCount?.version !== (s.version ?? 1)) return false;
  return blindCountState(s, expectedOf(await sessionSummary(ctx, s.id))) === "valid";
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
  assertSessionScope(ctx, s, { drawer: true });
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
  const showExpected = await expectedVisible(ctx, s);
  const insufficient = (cash: number) => new BusinessError(showExpected ? `Sangria maior que o dinheiro disponível no caixa (${formatMoney(cash)}).` : "Sangria maior que o dinheiro disponível no caixa.", "insufficient_cash");
  if (input.type === "withdrawal") {
    const summary = await sessionSummary(ctx, s.id);
    if (input.amount > summary.expected.cash) throw insufficient(summary.expected.cash);
    const limit = Number(await getSetting(ctx.store, ctx.companyId, s.branchId, "cash.withdrawalApprovalAbove", 0)) || 0;
    if (limit > 0 && input.amount > limit) {
      if (!input.approval) throw new BusinessError(`Sangrias acima de ${formatMoney(limit)} exigem autorização adicional do gerente (login e senha).`, "approval_required");
      const a = await verifySupervisor(ctx, input.approval, "cash.reopen", `sangria de ${formatMoney(input.amount)}`);
      assert(a.id !== ctx.user.id, "A autorização adicional deve ser de outro usuário (gerente).", "approval_denied");
      approver = { id: a.id, name: a.name };
    }
  }
  const number = await nextNumber(ctx.store, `cashmov:${s.id}`);
  const data = {
    companyId: ctx.companyId, branchId: s.branchId, createdBy: ctx.user.id, sessionId: s.id, number, type: input.type, method: "cash",
    amount: input.type === "withdrawal" ? -input.amount : input.amount, reason: input.reason.trim(), recipient: responsibleName,
    responsibleId: input.responsibleId ?? null, approvedBy: approver?.id ?? null,
    accountId: input.accountId ?? null, occurredAt: nowIso(), idemKey: input.idemKey, notes: input.notes?.trim() || null, sessionVersion: s.version ?? 1,
  };
  let mov: Doc;
  let reused = false;
  if (input.type === "withdrawal") {
    // Sangrias da mesma sessão são serializadas: cada uma grava a trava nº (sangrias já registradas + 1) na mesma
    // transação do movimento. Duas sangrias simultâneas disputam a mesma trava; a perdedora relê o dinheiro disponível.
    mov = await retryOnConflict(async () => {
      const again = await ctx.store.get("cash_movements", id);
      if (again) {
        reused = true;
        return again;
      }
      const summary = await sessionSummary(ctx, s.id);
      if (input.amount > summary.expected.cash) throw insufficient(summary.expected.cash);
      const n = summary.movements.filter((m) => m.type === "withdrawal").length;
      await ctx.store.transaction(async (t) => {
        await t.create("operations", { companyId: ctx.companyId, type: "cash_withdrawal_lock", status: "done", entityType: "cash_session", entityId: s.id, createdBy: ctx.user.id }, detId("cashwd", s.id, n + 1));
        await t.create("cash_movements", data, id);
      });
      return ctx.store.getOrThrow("cash_movements", id);
    });
  } else {
    try {
      mov = await ctx.store.create("cash_movements", data, id);
    } catch (e) {
      if (isConflict(e)) return ctx.store.getOrThrow("cash_movements", id);
      throw e;
    }
  }
  if (reused) return mov;
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

/** Previsto por meio de pagamento (dinheiro = saldo esperado da gaveta). */
export function expectedOf(summary: SessionSummary) {
  const expected: Record<string, number> = { cash: summary.expected.cash };
  for (const [k, v] of Object.entries(summary.byMethod)) if (k !== "cash") expected[k] = v.expected;
  return expected;
}

function differencesOf(expected: Record<string, number>, counted: Record<string, number>) {
  const differences: Record<string, number> = {};
  for (const k of new Set([...Object.keys(expected), ...Object.keys(counted)])) {
    const d = (counted[k] ?? 0) - (expected[k] ?? 0);
    if (d !== 0) differences[k] = d;
  }
  return differences;
}

function validCounted(counted: Record<string, number>) {
  assert(counted && typeof counted === "object", "Informe os valores contados.");
  for (const [k, v] of Object.entries(counted)) assert(Number.isInteger(v) && v >= 0, `Valor informado inválido para ${k}.`);
  return counted;
}

/**
 * Apuração sem fechar. Na conferência cega (parâmetro do servidor `cash.blindClose`), a primeira apuração de cada
 * versão da sessão REGISTRA a contagem informada (com o previsto daquele instante); só então o previsto é revelado.
 * Apurações seguintes devolvem a contagem já registrada (não é possível recontar depois de ver o previsto) e o
 * fechamento usa essa contagem — exceto se o previsto mudou depois dela (venda/movimento posterior): aí a contagem
 * deixa de valer, o previsto volta a ficar oculto e uma nova contagem é exigida (a anterior fica preservada).
 */
export async function previewClose(ctx: Ctx, sessionId: string, counted: Record<string, number>) {
  requirePerm(ctx, "cash", "edit");
  const s = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assertSessionScope(ctx, s, { drawer: true });
  assert(["open", "reopened"].includes(s.status), "Sessão de caixa não está aberta.");
  const blind = await blindCloseEnabled(ctx, s.branchId);
  const version = s.version ?? 1;
  let used = validCounted(counted);
  // previsto calculado ANTES de registrar a contagem: movimento gravado depois deste ponto invalida a contagem
  const summary = await sessionSummary(ctx, s.id);
  const expected = expectedOf(summary);
  let recount = false;
  if (blind) {
    const state = blindCountState(s, expected);
    if (state === "valid") used = s.blindCount.counted ?? {};
    else {
      recount = state === "stale";
      const prev = s.blindCount;
      const superseded = recount ? [...(prev.superseded ?? []), { counted: prev.counted ?? {}, expected: prev.expected ?? null, at: prev.at ?? null, by: prev.by ?? null, byName: prev.byName ?? null }] : [];
      await ctx.store.update("cash_sessions", s.id, { blindCount: { version, counted: used, expected, at: nowIso(), by: ctx.user.id, byName: ctx.user.name, superseded } });
      await audit(ctx, {
        module: "cash", action: "session.blind_count", entityType: "cash_session", entityId: s.id,
        summary: recount
          ? `Nova contagem cega registrada no caixa nº ${s.number} (versão ${version}): houve vendas ou movimentos depois da contagem anterior (preservada no histórico)`
          : `Contagem cega registrada no caixa nº ${s.number} (versão ${version}) antes da revelação do previsto`,
        after: { counted: used },
        before: recount ? { counted: prev.counted ?? {} } : null,
      });
    }
  }
  return { expected, differences: differencesOf(expected, used), counted: used, blind, recount };
}

/** Recolhimento registrado no último fechamento e ainda não transferido (fechamento interrompido). */
export async function pendingCloseTransfer(ctx: Ctx, s: Doc): Promise<{ toAccountId: string; fromAccountId: string; amount: number; idemKey: string } | null> {
  if (s.status !== "closed") return null;
  const last = [...(s.history ?? [])].reverse().find((h: any) => h.event === "closed");
  const tr = last?.transfer;
  if (!tr?.idemKey) return null;
  if (await ctx.store.get("fin_transfers", detId("fintransfer", tr.idemKey))) return null;
  return tr;
}

async function completeCloseTransfer(ctx: Ctx, s: Doc) {
  const tr = await pendingCloseTransfer(ctx, s);
  if (!tr) return null;
  try {
    await assertUsableAccount(ctx, tr.toAccountId);
  } catch (e) {
    if (e instanceof BusinessError) throw new BusinessError(`Recolhimento pendente: ${e.message} Reative a conta ou registre a transferência no Financeiro.`, e.code ?? "invalid_account");
    throw e;
  }
  return transferBetweenAccounts(ctx, {
    fromAccountId: tr.fromAccountId, toAccountId: tr.toAccountId, amount: tr.amount, date: today(),
    description: `Recolhimento do fechamento do caixa nº ${s.number}`, idemKey: tr.idemKey, kind: "cash_withdrawal",
  });
}

/** Conclui o recolhimento de um fechamento interrompido (idempotente). */
export async function retryCloseTransfer(ctx: Ctx, sessionId: string) {
  requirePerm(ctx, "cash", "edit");
  const s = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assertSessionScope(ctx, s, { drawer: true });
  const tr = await completeCloseTransfer(ctx, s);
  assert(tr, "Não há recolhimento pendente nesta sessão.");
  return tr;
}

export async function closeSession(
  ctx: Ctx,
  input: { sessionId: string; counted: Record<string, number>; justification?: string | null; checklist?: Record<string, boolean>; transferToAccountId?: string | null; transferAmount?: number; idemKey?: string; enforceChecklist?: boolean },
) {
  requirePerm(ctx, "cash", "edit");
  const s = await ctx.store.getOrThrow("cash_sessions", input.sessionId);
  assertSessionScope(ctx, s, { drawer: true });
  if (s.status === "closed") {
    const last = [...(s.history ?? [])].reverse().find((h: any) => h.event === "closed");
    if (input.idemKey && last?.idemKey === input.idemKey) {
      // repetição do mesmo fechamento: conclui o recolhimento que tenha ficado pendente
      await completeCloseTransfer(ctx, s);
      return ctx.store.getOrThrow("cash_sessions", s.id);
    }
  }
  assert(["open", "reopened"].includes(s.status), "Sessão já está fechada.");
  const version = s.version ?? 1;
  const blind = await blindCloseEnabled(ctx, s.branchId);
  const summary = await sessionSummary(ctx, s.id);
  const expected = expectedOf(summary);
  let counted: Record<string, number>;
  if (blind) {
    // conferência cega: vale a contagem registrada antes da revelação do previsto (nunca a do formulário)
    const state = blindCountState(s, expected);
    assert(state !== "none", "Conferência cega: informe a contagem e clique em “Apurar diferenças” antes de fechar.", "blind_count_required");
    assert(state === "valid", "Houve vendas ou movimentos neste caixa depois da contagem cega: conte novamente e clique em “Apurar diferenças” antes de fechar.", "blind_count_stale");
    counted = validCounted(s.blindCount.counted ?? {});
  } else counted = validCounted(input.counted);
  const differences = differencesOf(expected, counted);
  const hasDiff = Object.keys(differences).length > 0;
  if (hasDiff) assert(input.justification?.trim(), "Há divergências entre previsto e informado: registre a justificativa.", "justification_required");
  if (input.enforceChecklist) {
    const missing = requiredChecklist(summary).filter((k) => !input.checklist?.[k.key]);
    assert(missing.length === 0, `Conferências finais pendentes: ${missing.map((m) => m.label).join(", ")}.`, "checklist_pending");
  }
  // Recolhimento: tudo o que pode falhar é validado ANTES de fechar a sessão
  let transfer: { fromAccountId: string; toAccountId: string; amount: number; idemKey: string } | null = null;
  if (input.transferToAccountId && (input.transferAmount ?? 0) > 0) {
    const amount = input.transferAmount!;
    assert(Number.isInteger(amount) && amount > 0, "Valor do recolhimento inválido.");
    assert(amount <= (counted.cash ?? 0), `Recolhimento (${formatMoney(amount)}) maior que o dinheiro contado (${formatMoney(counted.cash ?? 0)}).`, "transfer_over_counted");
    let target: Doc;
    try {
      target = await assertUsableAccount(ctx, input.transferToAccountId);
    } catch (e) {
      if (e instanceof BusinessError) throw new BusinessError(`Conta de destino do recolhimento inválida: ${e.message}`, e.code ?? "invalid_account");
      throw e;
    }
    const cashAcc = await cashAccountFor(ctx, s.branchId);
    assert(cashAcc, "Filial sem conta financeira do tipo Caixa: não é possível registrar o recolhimento. Cadastre em Financeiro → Contas.");
    assert(cashAcc.id !== target.id, "A conta de destino do recolhimento deve ser diferente da conta Caixa da filial.");
    transfer = { fromAccountId: cashAcc.id, toAccountId: target.id, amount, idemKey: `close:${s.id}:${version}` };
  }
  const closedAt = nowIso();
  const history = [
    ...(s.history ?? []),
    {
      at: closedAt, event: "closed", by: ctx.user.name, byId: ctx.user.id, version, expected, counted, differences, justification: input.justification ?? null, checklist: input.checklist ?? null,
      totals: summary.totals, idemKey: input.idemKey ?? null, blind, blindCount: blind ? s.blindCount : null, transfer,
    },
  ];
  await ctx.store.update("cash_sessions", s.id, {
    status: "closed",
    closedAt,
    closedBy: ctx.user.id,
    expected,
    counted,
    differences,
    justification: input.justification ?? null,
    checklist: input.checklist ?? null,
    lockKey: `closed:${s.id}:${s.version}`,
    history,
  });
  await audit(ctx, {
    module: "cash", action: "session.close", entityType: "cash_session", entityId: s.id,
    summary: `Caixa nº ${s.number} fechado (versão ${version})${blind ? " em conferência cega" : ""}${hasDiff ? " com divergência: " + Object.entries(differences).map(([k, v]) => `${summary.byMethod[k]?.label ?? k} ${v > 0 ? "+" : ""}${formatMoney(v)}`).join(", ") : " sem divergência"}${transfer ? ` · recolhimento ${formatMoney(transfer.amount)}` : ""}`,
    after: { expected, counted, differences, transfer }, reason: input.justification ?? null,
  });
  // Dinheiro informado (e não o previsto) é o que efetivamente vai para a conta de destino. Idempotente pela chave
  // do fechamento: se falhar aqui, repetir o fechamento (ou "Concluir recolhimento" na sessão) completa a transferência.
  if (transfer) await completeCloseTransfer(ctx, await ctx.store.getOrThrow("cash_sessions", s.id));
  return ctx.store.getOrThrow("cash_sessions", s.id);
}

/** Reabre: preserva o fechamento anterior no histórico e cria nova versão de conferência. */
export async function reopenSession(ctx: Ctx, sessionId: string, reason: string) {
  requireAction(ctx, "cash.reopen");
  assert(reason?.trim(), "Informe o motivo da reabertura.");
  const s = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assertSessionScope(ctx, s);
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
