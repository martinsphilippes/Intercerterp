import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { addDays, addMonths, today } from "@/lib/dates";
import { splitInstallments } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { resolveOccurrence } from "@/lib/core/notify";

/**
 * Financeiro:
 *  - Título (receber/pagar) com parcelas; saldo da parcela = valor − principal baixado.
 *  - Baixa: principal reduz o saldo; valor movimentado = principal − desconto + juros + multa.
 *  - Toda movimentação em conta é um lançamento com sequência única por conta (extrato interno).
 *  - Estorno gera lançamentos inversos vinculados, nunca apaga o original.
 *  - Conciliação apenas vincula lançamentos existentes a transações bancárias.
 */

export type TitleKind = "receivable" | "payable";

export interface InstallmentInput {
  dueDate: string;
  amount: number;
  methodKind?: string;
}

export interface CreateTitleInput {
  kind: TitleKind;
  partyType?: "customer" | "supplier" | "other";
  partyId?: string | null;
  partyName?: string | null;
  description: string;
  documentNumber?: string | null;
  originType: string;
  originId?: string | null;
  operationId?: string | null;
  issueDate?: string;
  competenceDate?: string;
  categoryId?: string | null;
  costCenterId?: string | null;
  installments: InstallmentInput[];
  approvalStatus?: "pending" | "approved" | null;
  notes?: string | null;
  idemKey: string;
  branchId?: string | null;
}

/** Gera vencimentos a partir de uma condição de pagamento. */
export function buildSchedule(total: number, term: { installments: number; firstDueDays: number; intervalDays: number } | null, base = today()): InstallmentInput[] {
  const n = Math.max(1, term?.installments ?? 1);
  const parts = splitInstallments(total, n);
  const first = term?.firstDueDays ?? 0;
  const interval = term?.intervalDays ?? 30;
  return parts.map((amount, i) => ({
    amount,
    dueDate: interval === 30 && first % 30 === 0 ? addMonths(base, first / 30 + i) : addDays(base, first + interval * i),
  }));
}

export const titleId = (idemKey: string) => detId("title", idemKey);

/** Cria título e parcelas (idempotente pela idemKey). Pode participar de transação externa. */
export async function createTitle(ctx: Ctx, input: CreateTitleInput, tx?: Store): Promise<Doc> {
  const id = titleId(input.idemKey);
  const existing = await ctx.store.get("titles", id);
  if (existing) return existing;
  assert(input.installments.length > 0, "Informe ao menos uma parcela.");
  const total = input.installments.reduce((a, b) => a + b.amount, 0);
  assert(total > 0, "O valor do título deve ser maior que zero.");
  for (const i of input.installments) assert(i.amount > 0, "Parcelas devem ter valor positivo.");
  const number = await nextNumber(ctx.store, `title:${input.kind}:${ctx.companyId}`);
  const issueDate = input.issueDate ?? today();
  const base = {
    companyId: ctx.companyId,
    branchId: input.branchId ?? ctx.branchId,
    createdBy: ctx.user.id,
  };
  const run = async (t: Store) => {
    const title = await t.create(
      "titles",
      {
        ...base,
        kind: input.kind,
        number,
        partyType: input.partyType ?? null,
        partyId: input.partyId ?? null,
        partyName: input.partyName ?? null,
        description: input.description,
        documentNumber: input.documentNumber ?? null,
        originType: input.originType,
        originId: input.originId ?? null,
        operationId: input.operationId ?? null,
        issueDate,
        competenceDate: input.competenceDate ?? issueDate,
        categoryId: input.categoryId ?? null,
        costCenterId: input.costCenterId ?? null,
        total,
        balance: total,
        installmentsCount: input.installments.length,
        status: "open",
        approvalStatus: input.kind === "payable" ? (input.approvalStatus ?? "pending") : null,
        notes: input.notes ?? null,
        idemKey: input.idemKey,
      },
      id,
    );
    for (const [i, inst] of input.installments.entries()) {
      await t.create(
        "installments",
        {
          ...base,
          titleId: id,
          kind: input.kind,
          number: i + 1,
          dueDate: inst.dueDate,
          competenceDate: input.competenceDate ?? issueDate,
          amount: inst.amount,
          interest: 0,
          fine: 0,
          discount: 0,
          paid: 0,
          balance: inst.amount,
          status: "open",
          seq: 0,
          partyId: input.partyId ?? null,
          partyName: input.partyName ?? null,
          categoryId: input.categoryId ?? null,
          costCenterId: input.costCenterId ?? null,
          methodKind: inst.methodKind ?? null,
          description: input.description,
        },
        detId("inst", id, i + 1),
      );
    }
    return title;
  };
  try {
    const title = tx ? await run(tx) : await ctx.store.transaction(run);
    if (!tx) {
      await audit(ctx, {
        module: "finance",
        action: "title.create",
        entityType: "title",
        entityId: id,
        summary: `${input.kind === "receivable" ? "Título a receber" : "Título a pagar"} nº ${number} criado (${input.installments.length} parcela(s))`,
        after: { total, originType: input.originType, originId: input.originId },
        related: input.originId ? [`${input.originType}:${input.originId}`] : [],
      });
    }
    return title;
  } catch (e) {
    if (isConflict(e)) {
      const again = await ctx.store.get("titles", id);
      if (again) return again;
    }
    throw e;
  }
}

// ───────────────────────────── Lançamentos em conta

export interface EntryInput {
  accountId: string;
  date: string;
  amount: number; // + entrada, − saída
  kind: "receipt" | "payment" | "transfer_in" | "transfer_out" | "fee" | "adjustment" | "initial" | "cash_supply" | "cash_withdrawal" | "reversal" | "card_settlement";
  description: string;
  titleId?: string | null;
  installmentId?: string | null;
  settlementId?: string | null;
  transferId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  reversalOf?: string | null;
  operationId?: string | null;
  originType?: string | null;
  originId?: string | null;
  idemKey: string;
  branchId?: string | null;
}

/**
 * Lança na conta com sequência (concorrência segura). Deve rodar dentro de transação `t`.
 * `cache` permite vários lançamentos na mesma conta numa transação.
 */
export async function postEntry(ctx: Ctx, t: Store, e: EntryInput, cache = new Map<string, Doc>()): Promise<Doc> {
  const id = detId("entry", e.idemKey);
  const existing = await ctx.store.get("account_entries", id);
  if (existing) return existing;
  const acc = cache.get(e.accountId) ?? (await ctx.store.getOrThrow("financial_accounts", e.accountId));
  assert(acc.active !== false, `Conta ${acc.name} está inativa.`);
  const seq = (acc.seq ?? 0) + 1;
  const balanceAfter = (acc.balance ?? 0) + e.amount;
  const entry = await t.create(
    "account_entries",
    {
      companyId: ctx.companyId,
      branchId: e.branchId ?? acc.branchId ?? ctx.branchId,
      createdBy: ctx.user.id,
      accountId: e.accountId,
      seq,
      date: e.date,
      amount: e.amount,
      balanceAfter,
      kind: e.kind,
      description: e.description,
      titleId: e.titleId ?? null,
      installmentId: e.installmentId ?? null,
      settlementId: e.settlementId ?? null,
      transferId: e.transferId ?? null,
      categoryId: e.categoryId ?? null,
      costCenterId: e.costCenterId ?? null,
      reconciled: false,
      reversalOf: e.reversalOf ?? null,
      operationId: e.operationId ?? null,
      originType: e.originType ?? null,
      originId: e.originId ?? null,
      idemKey: e.idemKey,
    },
    id,
  );
  await t.update("financial_accounts", e.accountId, { seq, balance: balanceAfter });
  cache.set(e.accountId, { ...acc, seq, balance: balanceAfter });
  return entry;
}

/** Lançamento avulso (tarifa, ajuste) com auditoria. */
export async function createManualEntry(ctx: Ctx, input: Omit<EntryInput, "idemKey"> & { idemKey?: string }) {
  const idemKey = input.idemKey ?? `manual:${ctx.user.id}:${Date.now()}:${Math.random()}`;
  const entry = await retryOnConflict(() => ctx.store.transaction((t) => postEntry(ctx, t, { ...input, idemKey })));
  await audit(ctx, { module: "finance", action: "entry.create", entityType: "account_entry", entityId: entry.id, summary: `Lançamento ${input.description}`, after: { amount: input.amount, accountId: input.accountId } });
  return entry;
}

// ───────────────────────────── Baixas

export interface SettleInput {
  installmentId: string;
  date: string;
  principal: number;
  interest?: number;
  fine?: number;
  discount?: number;
  fee?: number;
  methodId?: string | null;
  methodKind?: string | null;
  accountId: string;
  reference?: string | null;
  notes?: string | null;
  attachmentFileId?: string | null;
  operationId?: string | null;
  idemKey: string;
  /** quando true não exige autorização prévia do título a pagar */
  skipApprovalCheck?: boolean;
}

export async function settleInstallment(ctx: Ctx, input: SettleInput, tx?: Store): Promise<Doc> {
  const sid = detId("settle", input.idemKey);
  const existing = await ctx.store.get("settlements", sid);
  if (existing) return existing;
  assert(input.principal > 0, "Informe o valor principal da baixa.");
  const interest = input.interest ?? 0;
  const fine = input.fine ?? 0;
  const discount = input.discount ?? 0;
  const fee = input.fee ?? 0;
  assert(interest >= 0 && fine >= 0 && discount >= 0 && fee >= 0, "Acréscimos e descontos não podem ser negativos.");
  assert(discount <= input.principal, "Desconto maior que o principal.");

  const run = async (t: Store) => {
    const inst = await ctx.store.getOrThrow("installments", input.installmentId);
    const title = await ctx.store.getOrThrow("titles", inst.titleId);
    assert(title.companyId === ctx.companyId, "Título de outra empresa.");
    assert(title.status !== "cancelled", "Título cancelado não pode ser baixado.");
    if (title.kind === "payable" && !input.skipApprovalCheck) {
      assert(title.approvalStatus !== "pending", "Conta a pagar ainda não autorizada. Autorize a obrigação antes do pagamento.", "payable_not_approved");
    }
    assert(input.principal <= inst.balance, `Valor principal (${input.principal / 100}) maior que o saldo da parcela (${inst.balance / 100}).`, "over_settlement");
    const sign = inst.kind === "receivable" ? 1 : -1;
    const total = input.principal - discount + interest + fine;
    const seq = inst.seq + 1;
    const entry = await postEntry(ctx, t, {
      accountId: input.accountId,
      date: input.date,
      amount: sign * total,
      kind: inst.kind === "receivable" ? "receipt" : "payment",
      description: `${inst.kind === "receivable" ? "Recebimento" : "Pagamento"} ${title.description} (parc. ${inst.number}/${title.installmentsCount})`,
      titleId: title.id,
      installmentId: inst.id,
      settlementId: sid,
      categoryId: inst.categoryId,
      costCenterId: inst.costCenterId,
      operationId: input.operationId,
      originType: "settlement",
      originId: sid,
      idemKey: `settle:${input.idemKey}`,
      branchId: title.branchId,
    });
    let feeEntryId: string | null = null;
    if (fee > 0) {
      const feeEntry = await postEntry(ctx, t, {
        accountId: input.accountId,
        date: input.date,
        amount: -fee,
        kind: "fee",
        description: `Tarifa/taxa sobre ${title.description}`,
        titleId: title.id,
        installmentId: inst.id,
        settlementId: sid,
        operationId: input.operationId,
        originType: "settlement",
        originId: sid,
        idemKey: `settle-fee:${input.idemKey}`,
        branchId: title.branchId,
      });
      feeEntryId = feeEntry.id;
    }
    const settlement = await t.create(
      "settlements",
      {
        companyId: ctx.companyId,
        branchId: title.branchId,
        createdBy: ctx.user.id,
        installmentId: inst.id,
        titleId: title.id,
        kind: "settlement",
        seq,
        date: input.date,
        principal: input.principal,
        interest,
        fine,
        discount,
        fee,
        total,
        methodId: input.methodId ?? null,
        methodKind: input.methodKind ?? null,
        accountId: input.accountId,
        accountEntryId: entry.id,
        reference: input.reference ?? null,
        notes: [input.notes, feeEntryId ? `tarifa:${feeEntryId}` : null].filter(Boolean).join(" | ") || null,
        attachmentFileId: input.attachmentFileId ?? null,
        status: "active",
        operationId: input.operationId ?? null,
        idemKey: input.idemKey,
      },
      sid,
    );
    const paid = inst.paid + input.principal;
    const balance = inst.amount - paid;
    await t.update("installments", inst.id, {
      paid,
      balance,
      interest: inst.interest + interest,
      fine: inst.fine + fine,
      discount: inst.discount + discount,
      status: balance === 0 ? "paid" : "partial",
      seq,
      lastSettlementAt: input.date,
    });
    await t.increment("titles", title.id, "balance", -input.principal, { min: 0 });
    return settlement;
  };

  const settlement = tx ? await run(tx) : await retryOnConflict(() => ctx.store.transaction(run));
  if (!tx) {
    await refreshTitleStatus(ctx.store, settlement.titleId);
    await audit(ctx, {
      module: "finance",
      action: "settlement.create",
      entityType: "title",
      entityId: settlement.titleId,
      summary: `Baixa de ${(settlement.total / 100).toFixed(2)} (principal ${(settlement.principal / 100).toFixed(2)})`,
      after: { principal: settlement.principal, interest, fine, discount, fee, accountId: input.accountId },
      related: [`installment:${input.installmentId}`, `settlement:${settlement.id}`],
      operationId: input.operationId,
    });
    const inst = await ctx.store.get("installments", input.installmentId);
    if (inst?.status === "paid") await resolveOccurrence(ctx.store, `overdue:${inst.id}`);
  }
  return settlement;
}

export async function refreshTitleStatus(store: Store, titleId: string) {
  const title = await store.getOrThrow("titles", titleId);
  if (title.status === "cancelled") return title;
  const insts = await listAll(store, "installments", { filters: [["eq", "titleId", titleId]] });
  const balance = insts.reduce((a, i) => a + (i.status === "cancelled" ? 0 : i.balance), 0);
  const total = insts.reduce((a, i) => a + (i.status === "cancelled" ? 0 : i.amount), 0);
  const status = balance === 0 ? "paid" : balance < total ? "partial" : "open";
  if (title.status !== status || title.balance !== balance) return store.update("titles", titleId, { status, balance });
  return title;
}

/** Estorna uma baixa: recompõe o saldo e gera lançamento inverso vinculado. */
export async function reverseSettlement(ctx: Ctx, settlementId: string, reason: string, tx?: Store) {
  assert(reason?.trim(), "Informe o motivo do estorno.");
  const s = await ctx.store.getOrThrow("settlements", settlementId);
  if (s.status === "reversed") return s;
  assert(s.kind === "settlement", "Somente baixas podem ser estornadas.");
  const entry = s.accountEntryId ? await ctx.store.get("account_entries", s.accountEntryId) : null;
  if (entry?.reconciled) throw new BusinessError("A baixa está conciliada com o extrato. Desfaça a conciliação antes de estornar.", "reconciled");
  const run = async (t: Store) => {
    const inst = await ctx.store.getOrThrow("installments", s.installmentId);
    const seq = inst.seq + 1;
    const cache = new Map<string, Doc>();
    if (entry) {
      await postEntry(ctx, t, {
        accountId: entry.accountId,
        date: today(),
        amount: -entry.amount,
        kind: "reversal",
        description: `Estorno: ${entry.description}`,
        titleId: s.titleId,
        installmentId: s.installmentId,
        settlementId: s.id,
        reversalOf: entry.id,
        categoryId: entry.categoryId,
        costCenterId: entry.costCenterId,
        originType: "settlement_reversal",
        originId: s.id,
        idemKey: `reverse:${s.id}`,
        branchId: entry.branchId,
      }, cache);
    }
    if (s.fee > 0 && s.notes?.includes("tarifa:")) {
      const feeEntryId = s.notes.split("tarifa:")[1]?.split(" ")[0];
      const feeEntry = feeEntryId ? await ctx.store.get("account_entries", feeEntryId) : null;
      if (feeEntry && !feeEntry.reconciled) {
        await postEntry(ctx, t, {
          accountId: feeEntry.accountId, date: today(), amount: -feeEntry.amount, kind: "reversal", description: `Estorno: ${feeEntry.description}`,
          titleId: s.titleId, settlementId: s.id, reversalOf: feeEntry.id, originType: "settlement_reversal", originId: s.id, idemKey: `reverse-fee:${s.id}`, branchId: feeEntry.branchId,
        }, cache);
      }
    }
    await t.create(
      "settlements",
      {
        companyId: ctx.companyId, branchId: s.branchId, createdBy: ctx.user.id, installmentId: s.installmentId, titleId: s.titleId,
        kind: "reversal", seq, date: today(), principal: -s.principal, interest: -s.interest, fine: -s.fine, discount: -s.discount,
        fee: -s.fee, total: -s.total, methodId: s.methodId, methodKind: s.methodKind, accountId: s.accountId, status: "active",
        notes: reason, idemKey: `reversal:${s.id}`, operationId: s.operationId,
      },
      detId("settle", `reversal:${s.id}`),
    );
    await t.update("settlements", s.id, { status: "reversed", reversedAt: new Date().toISOString(), reversedBy: ctx.user.id, reversalReason: reason });
    const paid = inst.paid - s.principal;
    const balance = inst.amount - paid;
    await t.update("installments", inst.id, {
      paid,
      balance,
      interest: inst.interest - s.interest,
      fine: inst.fine - s.fine,
      discount: inst.discount - s.discount,
      status: paid === 0 ? "open" : "partial",
      seq,
    });
    await t.increment("titles", s.titleId, "balance", s.principal);
  };
  if (tx) await run(tx);
  else await retryOnConflict(() => ctx.store.transaction(run));
  await refreshTitleStatus(ctx.store, s.titleId);
  await audit(ctx, { module: "finance", action: "settlement.reverse", entityType: "title", entityId: s.titleId, summary: `Estorno de baixa (${(s.total / 100).toFixed(2)})`, reason, related: [`settlement:${s.id}`] });
  return ctx.store.getOrThrow("settlements", s.id);
}

/** Cancela título sem baixas ativas (ex.: venda cancelada). */
export async function cancelTitle(ctx: Ctx, id: string, reason: string) {
  const title = await ctx.store.getOrThrow("titles", id);
  if (title.status === "cancelled") return title;
  const active = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", id], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
  if (active.length) throw new BusinessError("Título possui baixas ativas. Estorne as baixas antes de cancelar.", "has_settlements");
  const insts = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", id]] });
  await ctx.store.transaction(async (t) => {
    for (const i of insts) await t.update("installments", i.id, { status: "cancelled", balance: 0 });
    await t.update("titles", id, { status: "cancelled", balance: 0, notes: [title.notes, `Cancelado: ${reason}`].filter(Boolean).join("\n") });
  });
  for (const i of insts) await resolveOccurrence(ctx.store, `overdue:${i.id}`);
  await audit(ctx, { module: "finance", action: "title.cancel", entityType: "title", entityId: id, summary: `Título nº ${title.number} cancelado`, reason });
  return ctx.store.getOrThrow("titles", id);
}

export async function approvePayable(ctx: Ctx, id: string, note?: string) {
  const title = await ctx.store.getOrThrow("titles", id);
  assert(title.kind === "payable", "Somente contas a pagar exigem autorização.");
  if (title.approvalStatus === "approved") return title;
  const updated = await ctx.store.update("titles", id, { approvalStatus: "approved", approvedBy: ctx.user.id, approvedAt: new Date().toISOString() });
  await audit(ctx, { module: "finance", action: "payable.approve", entityType: "title", entityId: id, summary: `Obrigação nº ${title.number} conferida/autorizada para pagamento`, reason: note ?? null });
  return updated;
}

/** Transferência entre contas: dois lançamentos que não contam como receita/despesa. */
export async function transferBetweenAccounts(ctx: Ctx, input: { fromAccountId: string; toAccountId: string; amount: number; date: string; description: string; idemKey: string; kind?: "transfer" | "cash_withdrawal" | "cash_supply" }) {
  assert(input.fromAccountId !== input.toAccountId, "Contas de origem e destino devem ser diferentes.");
  assert(input.amount > 0, "Valor deve ser positivo.");
  const id = detId("fintransfer", input.idemKey);
  const existing = await ctx.store.get("fin_transfers", id);
  if (existing) return existing;
  const res = await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      const cache = new Map<string, Doc>();
      const tr = await t.create(
        "fin_transfers",
        { companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, amount: input.amount, date: input.date, description: input.description, status: "active", idemKey: input.idemKey },
        id,
      );
      await postEntry(ctx, t, { accountId: input.fromAccountId, date: input.date, amount: -input.amount, kind: "transfer_out", description: input.description, transferId: id, originType: input.kind ?? "transfer", originId: id, idemKey: `tr-out:${input.idemKey}` }, cache);
      await postEntry(ctx, t, { accountId: input.toAccountId, date: input.date, amount: input.amount, kind: "transfer_in", description: input.description, transferId: id, originType: input.kind ?? "transfer", originId: id, idemKey: `tr-in:${input.idemKey}` }, cache);
      return tr;
    }),
  );
  await audit(ctx, { module: "finance", action: "transfer.create", entityType: "fin_transfer", entityId: id, summary: `Transferência ${input.description}`, after: input });
  return res;
}

/** Saldo de uma conta numa data (pelo extrato interno). */
export async function accountBalanceAt(store: Store, accountId: string, date: string) {
  const acc = await store.getOrThrow("financial_accounts", accountId);
  const entries = await listAll(store, "account_entries", { filters: [["eq", "accountId", accountId], ["lte", "date", date]] });
  const movement = entries.reduce((a, e) => a + e.amount, 0);
  const initialApplies = !acc.initialBalanceDate || acc.initialBalanceDate <= date;
  return (initialApplies ? acc.initialBalance ?? 0 : 0) + movement;
}

/** Status de vencimento para listagem. */
export function dueState(inst: { status: string; dueDate: string; balance: number }, ref = today()) {
  if (inst.status === "paid") return "paid";
  if (inst.status === "cancelled") return "cancelled";
  if (inst.dueDate < ref) return "overdue";
  if (inst.dueDate === ref) return "due_today";
  return "upcoming";
}
