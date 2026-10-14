import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { diffDays, nowIso, today } from "@/lib/dates";
import { allocate, formatBps, formatMoney, pct } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import { notify } from "@/lib/core/notify";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { nextNumber } from "@/lib/core/numbering";
import { cashAccountFor, currentSession } from "./cash";
import { assertUsableAccount, lateChargeParams, reversalPostCommit, reverseSettlement, settleInstallment, settlementPostCommit, suggestLateCharges } from "./finance";
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";

/**
 * Recebimento de parcelas do crediário / contas a receber no PDV (VEN-10, Fase 4).
 *
 *  - A baixa é a do Financeiro (`settleInstallment`); o estorno é `reverseSettlement`. Nada de baixa própria do PDV.
 *  - Cada parcela recebida gera, na MESMA transação da baixa, um movimento de caixa `type = "receivable"` na sessão
 *    aberta do terminal (com `settlementId`). Dinheiro entra no dinheiro esperado; cartão/Pix no previsto do meio
 *    (`sessionSummary`). O estorno lança, na mesma transação do estorno da baixa, o movimento inverso (valor negativo).
 *  - Um recebimento (várias parcelas, inclusive de clientes distintos) é um registro em `operations`
 *    (`type = "pdv_receivable"`, id determinístico pela chave do formulário): repetir a chave nunca baixa duas vezes e
 *    conclui o que tenha ficado pendente.
 *  - Encargos de atraso = `lateChargeParams` + `suggestLateCharges` (mesma regra do Financeiro), calculados no
 *    servidor; desconto opcional limitado ao limite de desconto do operador (acima: "Aprovar desconto acima do limite").
 *  - Caixa aberto por outro operador: mesma política da venda (`cash.operatorMismatch`).
 *  - Liga/desliga: parâmetro `feature.recebimentoPdv` (padrão ligado).
 */

export const PDV_RECEIVABLE_FLAG = "recebimentoPdv";
export const PDV_RECEIVABLE_OP = "pdv_receivable";
/** parcelas por recebimento (cada parcela é uma transação própria; o limite mantém a tela e o recibo legíveis) */
export const PDV_RECEIVABLE_MAX_ITEMS = 20;
/** meios aceitos no recebimento de parcelas no caixa */
export const PDV_RECEIVABLE_KINDS = ["cash", "pix", "debit", "credit", "other"] as const;

const KIND_LABEL: Record<string, string> = { cash: "Dinheiro", pix: "Pix", debit: "Cartão de débito", credit: "Cartão de crédito", other: "Outros" };

export async function pdvReceivableEnabled(ctx: Ctx, branchId?: string | null) {
  return isFeatureOn(ctx.store, ctx.companyId, branchId ?? ctx.branchId, PDV_RECEIVABLE_FLAG, true);
}

export interface OpenInstallment {
  id: string;
  titleId: string;
  titleNumber: number;
  description: string;
  number: number;
  count: number;
  customerId: string | null;
  partyName: string;
  dueDate: string;
  overdue: boolean;
  daysLate: number;
  balance: number;
  fine: number;
  interest: number;
  /** saldo + multa + juros na data de hoje */
  updated: number;
}

/** Parcela recebível no PDV: título a receber vigente (não cartão), da empresa, com saldo. */
function receivableInPdv(ctx: Ctx, inst: Doc, title: Doc | null | undefined) {
  return Boolean(
    title && inst.companyId === ctx.companyId && title.companyId === ctx.companyId && inst.kind === "receivable" && ["open", "partial"].includes(inst.status) && inst.balance > 0 &&
      title.status !== "cancelled" && title.originType !== "sale_card",
  );
}

async function withCharges(ctx: Ctx, insts: Doc[], titles: Map<string, Doc>): Promise<OpenInstallment[]> {
  const params = await lateChargeParams(ctx.store, ctx.companyId, ctx.branchId);
  const ref = today();
  return insts
    .map((i) => {
      const t = titles.get(i.titleId)!;
      const c = suggestLateCharges(i.dueDate, ref, i.balance, params);
      return {
        id: i.id, titleId: t.id, titleNumber: t.number, description: t.description, number: i.number, count: t.installmentsCount ?? 1, customerId: t.partyType === "customer" ? (t.partyId ?? null) : null,
        partyName: t.partyName ?? "—", dueDate: i.dueDate, overdue: i.dueDate < ref, daysLate: Math.max(0, diffDays(i.dueDate, ref)), balance: i.balance, fine: c.fine, interest: c.interest, updated: i.balance + c.fine + c.interest,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.titleNumber - b.titleNumber || a.number - b.number);
}

/** Parcelas a receber em aberto do cliente com o valor atualizado hoje — vencidas primeiro (vencimento mais antigo). */
export async function openInstallmentsForCustomer(ctx: Ctx, customerId: string): Promise<OpenInstallment[]> {
  requirePerm(ctx, "pdv", "create");
  const customer = await ctx.store.get("customers", customerId);
  assert(customer && customer.companyId === ctx.companyId, "Cliente não encontrado.", "not_found");
  const insts = await listAll(ctx.store, "installments", { filters: [["eq", "partyId", customerId], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
  const titles = new Map<string, Doc>();
  for (const id of new Set(insts.map((i) => i.titleId as string))) {
    const t = await ctx.store.get("titles", id);
    if (t) titles.set(id, t);
  }
  return withCharges(ctx, insts.filter((i) => receivableInPdv(ctx, i, titles.get(i.titleId))), titles);
}

/** Meios de pagamento aceitos no recebimento (dinheiro, cartão, Pix, outros) com o motivo quando indisponível. */
export async function receivableMethods(ctx: Ctx) {
  const branchId = requireBranch(ctx);
  const methods = await listAll(ctx.store, "payment_methods", { filters: [["eq", "companyId", ctx.companyId], ["eq", "active", true]] });
  const cashAcc = await cashAccountFor(ctx, branchId);
  return methods
    .filter((m) => (PDV_RECEIVABLE_KINDS as readonly string[]).includes(m.kind) && m.availablePdv !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((m) => ({
      id: m.id as string,
      name: m.name as string,
      kind: m.kind as string,
      feeBps: (m.kind === "debit" || m.kind === "credit" ? (m.feeBps ?? 0) : 0) as number,
      disabledReason:
        m.kind === "cash"
          ? cashAcc ? null : "Filial sem conta financeira do tipo Caixa (Financeiro → Contas)."
          : m.accountId ? null : "Meio sem conta financeira vinculada (Financeiro → Cadastros → Meios de pagamento).",
    }));
}

type MismatchPolicy = "allow" | "warn" | "block";

/** Mesma política da venda (`cash.operatorMismatch`): o recebimento entra na gaveta de quem abriu o caixa. */
async function operatorPolicy(ctx: Ctx, session: Doc): Promise<MismatchPolicy> {
  if (session.operatorId === ctx.user.id || canDo(ctx.user, "cash.reopen")) return "allow";
  const p = await getSetting<string>(ctx.store, ctx.companyId, session.branchId, "cash.operatorMismatch", "warn");
  return p === "block" || p === "allow" ? p : "warn";
}

function assertPolicy(policy: MismatchPolicy, what: string) {
  if (policy === "block") {
    throw new BusinessError(`O caixa deste terminal foi aberto por outro operador. Para ${what}, use um terminal com o seu próprio caixa aberto (Caixa → Abertura) ou peça a um supervisor.`, "cash_operator_mismatch");
  }
}

async function warnMismatch(ctx: Ctx, session: Doc, summary: string, related: string[]) {
  await audit(ctx, { module: "cash", action: "receivable.operator_mismatch", entityType: "cash_session", entityId: session.id, summary, related });
  // um aviso por sessão e operador (mesma ocorrência da venda)
  await notify(ctx.store, {
    companyId: ctx.companyId, branchId: session.branchId, type: "cash", priority: "high",
    title: `${ctx.user.name} está operando no caixa nº ${session.number ?? "—"}, aberto por outro operador`,
    body: "Vendas e recebimentos de parcelas entram na gaveta de quem abriu o caixa. Confira o fechamento ou peça para cada operador abrir o próprio caixa (parâmetro em Administração → Parâmetros → Caixa).",
    link: `/caixa/${session.id}`, originType: "cash_session", originId: session.id, occurrenceKey: `cash-operator:${session.id}:${ctx.user.id}`,
    audience: { action: "cash.reopen" },
  }).catch(() => 0);
}

export interface PdvReceiptItem {
  installmentId: string;
  titleId: string;
  titleNumber: number;
  number: number;
  count: number;
  description: string;
  customerId: string | null;
  partyName: string;
  dueDate: string;
  daysLate: number;
  principal: number;
  fine: number;
  interest: number;
  discount: number;
  fee: number;
  total: number;
  settlementIdem: string;
  settlementId: string;
  /** situação de execução: pendente até a baixa (e o movimento de caixa) ser gravada */
  done?: boolean;
  error?: string | null;
}

export interface ReceiveInput {
  terminalId: string;
  installmentIds: string[];
  methodId: string;
  /** dinheiro entregue pelo cliente (troco = recebido − total); demais meios: ignorado */
  received?: number | null;
  /** desconto total do recebimento (rateado entre as parcelas pelo principal) */
  discount?: number;
  /** autorização de supervisor para desconto acima do limite do operador */
  approval?: SupervisorCredentials | null;
  /** NSU/autorização do cartão ou identificador do Pix */
  reference?: string | null;
  idemKey: string;
}

export const receiptOpId = (idemKey: string) => detId("pdvrec", idemKey);

/**
 * Recebe parcelas no caixa aberto do terminal. Idempotente pela chave: a repetição devolve o mesmo recebimento e conclui
 * baixas que tenham ficado pendentes (cada parcela = baixa + movimento de caixa na mesma transação).
 */
export async function receiveInstallments(ctx: Ctx, input: ReceiveInput): Promise<Doc> {
  requirePerm(ctx, "pdv", "create");
  requireAction(ctx, "pdv.receive_installments");
  const branchId = requireBranch(ctx);
  assert(input.idemKey?.trim(), "Chave da operação ausente: atualize a tela.");
  const opId = receiptOpId(input.idemKey);
  let op = await ctx.store.get("operations", opId);
  if (op) assert(op.companyId === ctx.companyId && op.type === PDV_RECEIVABLE_OP, "Operação inválida.");
  if (!op) op = await planReceipt(ctx, branchId, opId, input);
  if (op.status !== "pending") return op;
  return executeReceipt(ctx, op);
}

async function planReceipt(ctx: Ctx, branchId: string, opId: string, input: ReceiveInput): Promise<Doc> {
  assert(await pdvReceivableEnabled(ctx, branchId), "O recebimento de parcelas no PDV está desativado nesta filial (Administração → Parâmetros → Recursos).", "feature_off");
  const terminal = await ctx.store.getOrThrow("terminals", input.terminalId);
  assert(terminal.companyId === ctx.companyId && terminal.branchId === branchId, "Terminal de outra filial.", "branch_mismatch");
  const session = await currentSession(ctx, terminal.id);
  assert(session, "Abra o caixa deste terminal antes de receber parcelas.", "cash_closed");
  assertPolicy(await operatorPolicy(ctx, session), "receber parcelas");

  const ids = [...new Set(input.installmentIds ?? [])];
  assert(ids.length > 0, "Selecione ao menos uma parcela.");
  assert(ids.length === (input.installmentIds ?? []).length, "Parcela repetida no recebimento.");
  assert(ids.length <= PDV_RECEIVABLE_MAX_ITEMS, `No máximo ${PDV_RECEIVABLE_MAX_ITEMS} parcelas por recebimento.`);

  // ── meio de pagamento e conta de destino (validados antes de qualquer gravação)
  const method = await ctx.store.get("payment_methods", input.methodId);
  assert(method && method.companyId === ctx.companyId && method.active !== false, "Meio de pagamento inválido.");
  assert((PDV_RECEIVABLE_KINDS as readonly string[]).includes(method.kind), `${method.name} não pode ser usado para receber parcelas no caixa (use dinheiro, cartão ou Pix).`, "method_not_allowed");
  let accountId: string;
  if (method.kind === "cash") {
    const cashAcc = await cashAccountFor(ctx, branchId);
    assert(cashAcc, "Filial sem conta financeira do tipo Caixa: cadastre em Financeiro → Contas.", "invalid_account");
    accountId = cashAcc.id;
  } else {
    assert(method.accountId, `${method.name} não tem conta financeira vinculada: vincule em Financeiro → Cadastros → Meios de pagamento.`, "invalid_account");
    accountId = (await assertUsableAccount(ctx, method.accountId)).id;
  }

  // ── parcelas e encargos (regra única do Financeiro)
  const insts: Doc[] = [];
  const titles = new Map<string, Doc>();
  for (const id of ids) {
    const inst = await ctx.store.get("installments", id);
    assert(inst && inst.companyId === ctx.companyId, "Parcela não encontrada.", "not_found");
    if (!titles.has(inst.titleId)) {
      const t = await ctx.store.get("titles", inst.titleId);
      if (t) titles.set(t.id, t);
    }
    const t = titles.get(inst.titleId);
    assert(t?.originType !== "sale_card", "Recebível de cartão é liquidado em Financeiro → Cartões.", "card_receivable");
    assert(receivableInPdv(ctx, inst, t), `A parcela ${inst.number}${t ? ` do título nº ${t.number}` : ""} não está em aberto (paga, renegociada ou cancelada). Atualize a lista.`, "installment_not_open");
    insts.push(inst);
  }
  const open = await withCharges(ctx, insts, titles);
  const gross = open.reduce((a, i) => a + i.updated, 0);
  const principalSum = open.reduce((a, i) => a + i.balance, 0);
  const discount = Math.round(input.discount ?? 0);
  assert(Number.isInteger(discount) && discount >= 0, "Desconto inválido.");
  assert(discount <= principalSum, "O desconto não pode ser maior que o saldo das parcelas.");
  let approver: { id: string; name: string } | null = null;
  if (discount > 0) {
    const bps = Math.round((discount * 10000) / gross);
    const limit = ctx.user.discountLimitBps ?? 0;
    if (bps > limit && !canDo(ctx.user, "sale.discount_over_limit")) {
      if (!input.approval?.login) throw new BusinessError(`Desconto de ${formatBps(bps)} acima do seu limite (${formatBps(limit)}): peça a autorização de um supervisor.`, "discount_over_limit");
      const a = await verifySupervisor(ctx, input.approval, "sale.discount_over_limit", `desconto de ${formatMoney(discount)} no recebimento de parcelas`);
      approver = { id: a.id, name: a.name };
    }
  }
  const shares = allocate(discount, open.map((i) => i.balance));
  const items: PdvReceiptItem[] = open.map((i, k) => {
    const total = i.balance - shares[k] + i.fine + i.interest;
    const settlementIdem = `pdvrec:${opId}:${i.id}`;
    return {
      installmentId: i.id, titleId: i.titleId, titleNumber: i.titleNumber, number: i.number, count: i.count, description: i.description, customerId: i.customerId, partyName: i.partyName,
      dueDate: i.dueDate, daysLate: i.daysLate, principal: i.balance, fine: i.fine, interest: i.interest, discount: shares[k],
      fee: method.kind === "debit" || method.kind === "credit" ? pct(total, method.feeBps ?? 0) : 0, total, settlementIdem, settlementId: detId("settle", settlementIdem), done: false,
    };
  });
  const total = items.reduce((a, i) => a + i.total, 0);
  assert(total > 0, "Nada a receber.");
  let received = total;
  if (method.kind === "cash" && input.received != null) {
    received = Math.round(input.received);
    assert(received >= total, `Valor recebido (${formatMoney(received)}) menor que o total (${formatMoney(total)}).`, "insufficient_received");
  }
  const number = await nextNumber(ctx.store, `pdvrec:${ctx.companyId}`);
  const customers = [...new Set(items.map((i) => i.partyName))];
  try {
    return await ctx.store.create(
      "operations",
      {
        companyId: ctx.companyId, type: PDV_RECEIVABLE_OP, status: "pending", entityType: "cash_session", entityId: session.id, createdBy: ctx.user.id, error: null,
        result: {
          number, branchId, terminalId: terminal.id, sessionId: session.id, sessionNumber: session.number, sessionVersion: session.version ?? 1, operatorName: ctx.user.name,
          at: nowIso(), date: today(), methodId: method.id, methodKind: method.kind, methodName: method.name, accountId, reference: input.reference?.trim() || null,
          items, total, gross, discount, fines: items.reduce((a, i) => a + i.fine, 0), interest: items.reduce((a, i) => a + i.interest, 0), fee: items.reduce((a, i) => a + i.fee, 0),
          received, change: received - total, customers, approvedBy: approver?.id ?? null, approvedByName: approver?.name ?? null, mismatch: session.operatorId !== ctx.user.id,
        },
      },
      opId,
    );
  } catch (e) {
    // mesma chave gravada por outra requisição (duplo clique): segue com a operação já registrada
    if (isConflict(e)) return ctx.store.getOrThrow("operations", opId);
    throw e;
  }
}

/** Grava as baixas pendentes do recebimento (baixa + movimento de caixa por parcela, na mesma transação). */
async function executeReceipt(ctx: Ctx, op: Doc): Promise<Doc> {
  const r = op.result;
  const session = await ctx.store.getOrThrow("cash_sessions", r.sessionId);
  const items: PdvReceiptItem[] = r.items.map((i: PdvReceiptItem) => ({ ...i }));
  const policy = await operatorPolicy(ctx, session);
  const pending = items.some((i) => !i.done);
  if (pending) {
    assert(["open", "reopened"].includes(session.status), `O caixa nº ${session.number} foi fechado antes da conclusão do recebimento nº ${r.number}. Confira o recebimento no Financeiro.`, "cash_closed");
    assertPolicy(policy, "receber parcelas");
  }
  let failure: string | null = null;
  for (const item of items) {
    if (item.done) continue;
    const movId = detId("cashmov", `pdvrec:${item.settlementId}`);
    const flag = { created: false };
    try {
      await retryOnConflict(async () => {
        flag.created = false;
        // repetição/concorrência: a baixa e o movimento nascem juntos — se a baixa existe, a parcela está concluída
        if (await ctx.store.get("settlements", item.settlementId)) return;
        await ctx.store.transaction(async (t) => {
          await settleInstallment(
            ctx,
            {
              installmentId: item.installmentId, date: r.date, principal: item.principal, interest: item.interest, fine: item.fine, discount: item.discount, fee: item.fee,
              methodId: r.methodId, methodKind: r.methodKind, accountId: r.accountId, reference: r.reference, notes: `Recebimento nº ${r.number} no PDV (caixa nº ${r.sessionNumber})`,
              operationId: op.id, idemKey: item.settlementIdem,
            },
            t,
          );
          await t.create(
            "cash_movements",
            {
              companyId: ctx.companyId, branchId: session.branchId, createdBy: ctx.user.id, sessionId: session.id, number: 0, type: "receivable", method: r.methodKind, amount: item.total,
              reason: `Recebimento nº ${r.number} — parc. ${item.number}/${item.count} do título nº ${item.titleNumber} (${item.partyName})`, settlementId: item.settlementId,
              occurredAt: nowIso(), idemKey: `pdvrec:${item.settlementId}`, sessionVersion: session.version ?? 1,
            },
            movId,
          );
          flag.created = true;
        });
      });
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e; // falha técnica: a repetição conclui o que faltou
      failure = `Parcela ${item.number} do título nº ${item.titleNumber}: ${e.message}`;
      item.error = e.message;
      break;
    }
    item.done = true;
    if (flag.created) await settlementPostCommit(ctx, await ctx.store.getOrThrow("settlements", item.settlementId));
  }
  const done = items.filter((i) => i.done);
  const status = failure ? (done.length ? "partial" : "failed") : "done";
  const total = done.reduce((a, i) => a + i.total, 0);
  const updated = await ctx.store.update("operations", op.id, { status, error: failure, result: { ...r, items, doneTotal: total } });
  await audit(ctx, {
    module: "cash", action: status === "done" ? "receivable.receive" : "receivable.receive_partial", entityType: "cash_session", entityId: session.id,
    summary: `Recebimento nº ${r.number} no PDV — ${done.length} parcela(s), ${formatMoney(total)} em ${r.methodName}${r.discount ? ` (desconto ${formatMoney(r.discount)}${r.approvedByName ? `, autorizado por ${r.approvedByName}` : ""})` : ""}${r.methodKind === "cash" && r.change ? ` · troco ${formatMoney(r.change)}` : ""}${failure ? ` · INCOMPLETO: ${failure}` : ""}`,
    after: { total, items: done.map((i) => ({ installmentId: i.installmentId, total: i.total })) },
    related: [...new Set(done.map((i) => `title:${i.titleId}`)), ...done.map((i) => `settlement:${i.settlementId}`)],
    operationId: op.id,
    result: failure ? "failure" : undefined,
  });
  if (policy === "warn") await warnMismatch(ctx, session, `Recebimento nº ${r.number} (${formatMoney(total)}) registrado por ${ctx.user.name} no caixa nº ${session.number ?? "—"}, aberto por outro operador`, [`operation:${op.id}`]);
  if (failure) {
    throw new BusinessError(
      done.length
        ? `Recebimento nº ${r.number} concluído parcialmente: ${done.length} de ${items.length} parcela(s) (${formatMoney(total)}). ${failure}. Devolva ao cliente o valor não recebido e confira o recibo.`
        : `Recebimento não registrado. ${failure}`,
      "receivable_partial",
    );
  }
  return updated;
}

/** Recebimentos registrados numa sessão de caixa (pelos movimentos da sessão), do mais recente para o mais antigo. */
export async function sessionReceipts(ctx: Ctx, sessionId: string) {
  const session = await ctx.store.getOrThrow("cash_sessions", sessionId);
  assert(session.companyId === ctx.companyId, "Sessão de outra empresa.");
  const movs = await listAll(ctx.store, "cash_movements", { filters: [["eq", "sessionId", sessionId]] });
  const opIds = new Set<string>();
  for (const m of movs) {
    if (m.type !== "receivable" || m.amount <= 0 || !m.settlementId) continue;
    const st = await ctx.store.get("settlements", m.settlementId);
    if (st?.operationId) opIds.add(st.operationId);
  }
  const ops: Doc[] = [];
  for (const id of opIds) {
    const op = await ctx.store.get("operations", id);
    if (op && op.type === PDV_RECEIVABLE_OP && op.companyId === ctx.companyId) ops.push(op);
  }
  return ops.sort((a, b) => String(b.result?.at ?? "").localeCompare(String(a.result?.at ?? "")));
}

/**
 * Estorno de um recebimento no PDV: somente na mesma sessão de caixa, ainda aberta. Cada baixa é estornada
 * (`reverseSettlement`, que recompõe o saldo da parcela) junto com o movimento de caixa inverso, na mesma transação.
 * Idempotente: repetir não estorna duas vezes e conclui o que tenha ficado pendente.
 * Permissão "Estornar recebimento de parcelas no PDV" ou autorização de um supervisor que a tenha.
 */
export async function reverseReceipt(ctx: Ctx, input: { receiptId: string; reason: string; approval?: SupervisorCredentials | null }): Promise<Doc> {
  requirePerm(ctx, "pdv", "create");
  const branchId = requireBranch(ctx);
  const reason = input.reason?.trim();
  assert(reason, "Informe o motivo do estorno.");
  const op = await ctx.store.get("operations", input.receiptId);
  assert(op && op.companyId === ctx.companyId && op.type === PDV_RECEIVABLE_OP, "Recebimento não encontrado.", "not_found");
  if (op.status === "reversed") return op;
  let approver: { id: string; name: string } | null = null;
  if (!canDo(ctx.user, "pdv.reverse_receipt")) {
    if (!input.approval?.login) throw new BusinessError("Estornar recebimento exige a permissão “Estornar recebimento de parcelas no PDV” ou a autorização de um supervisor.", "approval_required");
    const a = await verifySupervisor(ctx, input.approval, "pdv.reverse_receipt", `estorno do recebimento nº ${op.result?.number}`);
    approver = { id: a.id, name: a.name };
  }
  const r = op.result;
  const session = await ctx.store.getOrThrow("cash_sessions", r.sessionId);
  assert(session.branchId === branchId, "Recebimento de outra filial: selecione a filial do caixa.", "branch_mismatch");
  assert(
    ["open", "reopened"].includes(session.status),
    `O caixa nº ${session.number} deste recebimento já foi fechado: o estorno no PDV só é feito com a mesma sessão aberta. Use Financeiro → Contas a receber (estorno da baixa) e registre a saída de dinheiro no caixa atual, se houver.`,
    "cash_closed",
  );
  const policy = await operatorPolicy(ctx, session);
  assertPolicy(policy, "estornar recebimentos");
  const items: PdvReceiptItem[] = (r.items ?? []).filter((i: PdvReceiptItem) => i.done);
  for (const item of items) {
    const movId = detId("cashmov", `pdvrec-rev:${item.settlementId}`);
    const before = await ctx.store.get("settlements", item.settlementId);
    if (!before) continue;
    const flag = { reversed: false };
    await retryOnConflict(async () => {
      flag.reversed = false;
      if (await ctx.store.get("cash_movements", movId)) return; // estorno desta parcela já concluído
      const cur = await ctx.store.getOrThrow("settlements", item.settlementId);
      await ctx.store.transaction(async (t) => {
        if (cur.status !== "reversed") {
          await reverseSettlement(ctx, cur.id, `Estorno no PDV do recebimento nº ${r.number}: ${reason}`, t);
          flag.reversed = true;
        }
        await t.create(
          "cash_movements",
          {
            companyId: ctx.companyId, branchId: session.branchId, createdBy: ctx.user.id, sessionId: session.id, number: 0, type: "receivable", method: r.methodKind, amount: -item.total,
            reason: `Estorno do recebimento nº ${r.number} — parc. ${item.number}/${item.count} do título nº ${item.titleNumber} (${item.partyName})`, settlementId: item.settlementId,
            occurredAt: nowIso(), idemKey: `pdvrec-rev:${item.settlementId}`, sessionVersion: session.version ?? 1, approvedBy: approver?.id ?? null, notes: reason,
          },
          movId,
        );
      });
    });
    if (flag.reversed) await reversalPostCommit(ctx, before, `Estorno no PDV do recebimento nº ${r.number}: ${reason}`);
  }
  const total = items.reduce((a, i) => a + i.total, 0);
  const updated = await ctx.store.update("operations", op.id, {
    status: "reversed",
    result: { ...r, reversal: { at: nowIso(), by: ctx.user.id, byName: ctx.user.name, reason, approvedBy: approver?.id ?? null, approvedByName: approver?.name ?? null, total } },
  });
  await audit(ctx, {
    module: "cash", action: "receivable.reverse", entityType: "cash_session", entityId: session.id,
    summary: `Estorno do recebimento nº ${r.number} no PDV — ${items.length} parcela(s), ${formatMoney(total)} em ${r.methodName}${approver ? ` · autorizado por ${approver.name}` : ""}`,
    reason, related: [...new Set(items.map((i) => `title:${i.titleId}`)), ...items.map((i) => `settlement:${i.settlementId}`)], operationId: op.id,
  });
  if (policy === "warn") await warnMismatch(ctx, session, `Estorno do recebimento nº ${r.number} (${formatMoney(total)}) por ${ctx.user.name} no caixa nº ${session.number ?? "—"}, aberto por outro operador`, [`operation:${op.id}`]);
  return updated;
}

/**
 * Baixa feita no PDV com o caixa ainda aberto: o estorno precisa passar pelo PDV (devolve o valor pela gaveta).
 * Usado pelo estorno de baixa do Financeiro.
 */
export async function assertNotOpenPdvReceipt(ctx: Ctx, settlementId: string) {
  const st = await ctx.store.get("settlements", settlementId);
  if (!st?.operationId) return;
  const op = await ctx.store.get("operations", st.operationId);
  if (!op || op.type !== PDV_RECEIVABLE_OP || op.companyId !== ctx.companyId) return;
  const session = await ctx.store.get("cash_sessions", op.result?.sessionId);
  if (session && ["open", "reopened"].includes(session.status)) {
    throw new BusinessError(`Esta baixa foi recebida no PDV (recebimento nº ${op.result?.number}, caixa nº ${session.number} ainda aberto): estorne pelo PDV (Receber parcelas → Recebidos neste caixa) para que o valor saia da gaveta.`, "pdv_receipt_open");
  }
}

export const RECEIVABLE_KIND_LABEL = KIND_LABEL;
