import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { addDays, addMonths, diffDays, formatDate, today } from "@/lib/dates";
import { allocate, formatMoney, pct, roundDiv, splitInstallments } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { reopenOccurrence, resolveOccurrence } from "@/lib/core/notify";
import { getSetting } from "@/lib/core/settings";
import { enqueue } from "@/lib/core/jobs";

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

/**
 * Valor parcelado com os juros da condição de pagamento (% sobre o total, em bps): total + total × juros%,
 * arredondado em centavos (half-up). Sem juros, devolve o próprio total.
 */
export function termFinancedTotal(total: number, interestBps: number | null | undefined): number {
  return interestBps && interestBps > 0 ? total + pct(total, interestBps) : total;
}

/**
 * Gera vencimentos a partir de uma condição de pagamento.
 * `opts.interestBps` (opcional, explícito): aplica os juros da condição ao total antes de dividir as parcelas
 * (ver termFinancedTotal). Sem a opção, o total é dividido como informado.
 */
export function buildSchedule(total: number, term: { installments: number; firstDueDays: number; intervalDays: number } | null, base = today(), opts?: { interestBps?: number | null }): InstallmentInput[] {
  const n = Math.max(1, term?.installments ?? 1);
  const parts = splitInstallments(termFinancedTotal(total, opts?.interestBps), n);
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
  /** já nasce conciliado (lançamento de diferença/tarifa criado pela própria conciliação) */
  reconciliationId?: string | null;
}

/**
 * Lança na conta com sequência (concorrência segura). Deve rodar dentro de transação `t`.
 * `cache` permite vários lançamentos na mesma conta numa transação.
 */
export async function postEntry(ctx: Ctx, t: Store, e: EntryInput, cache = new Map<string, Doc>()): Promise<Doc> {
  const id = detId("entry", e.idemKey);
  const existing = await ctx.store.get("account_entries", id);
  if (existing) return existing;
  const acc = cache.get(e.accountId) ?? (e.accountId ? await ctx.store.get("financial_accounts", e.accountId) : null);
  // toda movimentação (baixa, estorno, transferência, avulso) só entra em conta da empresa ativa
  assert(acc && acc.companyId === ctx.companyId, "Conta financeira inválida: selecione uma conta desta empresa.", "invalid_account");
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
      reconciled: Boolean(e.reconciliationId),
      reconciliationId: e.reconciliationId ?? null,
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

/**
 * Conta financeira utilizável para movimentar: existe, é da empresa ativa e está ativa.
 * Use antes de gravar anexos/arquivos para recusar cedo uma conta inválida (postEntry confere de novo).
 */
export async function assertUsableAccount(ctx: Ctx, accountId: string | null | undefined): Promise<Doc> {
  const acc = accountId ? await ctx.store.get("financial_accounts", accountId) : null;
  assert(acc && acc.companyId === ctx.companyId, "Selecione uma conta financeira válida desta empresa.", "invalid_account");
  assert(acc.active !== false, `A conta ${acc.name} está inativa. Selecione uma conta ativa.`, "inactive_account");
  return acc;
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

  let reused = false;
  const run = async (t: Store) => {
    // repetição concorrente com a mesma chave: devolve a baixa já gravada
    const done = await ctx.store.get("settlements", sid);
    if (done) {
      reused = true;
      return done;
    }
    const inst = await ctx.store.getOrThrow("installments", input.installmentId);
    const title = await ctx.store.getOrThrow("titles", inst.titleId);
    assert(title.companyId === ctx.companyId && inst.companyId === ctx.companyId, "Título de outra empresa.");
    assert(title.status !== "cancelled", "Título cancelado não pode ser baixado.");
    // parcela quitada cai na regra de saldo (over_settlement) logo abaixo
    assert(
      inst.status !== "renegotiated" && inst.status !== "cancelled",
      inst.status === "renegotiated" ? `A parcela ${inst.number} foi renegociada: registre o recebimento no título da renegociação.` : `A parcela ${inst.number} está cancelada.`,
      "installment_not_open",
    );
    if (title.kind === "payable" && !input.skipApprovalCheck) {
      assert(title.approvalStatus !== "pending", "Conta a pagar ainda não autorizada. Autorize a obrigação antes do pagamento.", "payable_not_approved");
    }
    assert(input.principal <= inst.balance, `Valor principal (${input.principal / 100}) maior que o saldo da parcela (${inst.balance / 100}).`, "over_settlement");
    const sign = inst.kind === "receivable" ? 1 : -1;
    const total = input.principal - discount + interest + fine;
    const seq = inst.seq + 1;
    // cache compartilhado: no Appwrite as leituras não enxergam escritas da própria transação (sequência da conta)
    const cache = new Map<string, Doc>();
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
    }, cache);
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
      }, cache);
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

  let settlement: Doc;
  try {
    settlement = tx ? await run(tx) : await retryOnConflict(() => ctx.store.transaction(run));
  } catch (e) {
    // cancelamento/renegociação gravado entre a leitura e o commit: o limite do saldo (ou a sequência) recusa a baixa
    if (!tx && isConflict(e)) {
      const inst = await ctx.store.get("installments", input.installmentId);
      const title = inst ? await ctx.store.get("titles", inst.titleId) : null;
      if (title?.status === "cancelled" || inst?.status === "cancelled") throw new BusinessError("Título cancelado não pode ser baixado.", "title_cancelled");
      if (inst?.status === "renegotiated") throw new BusinessError(`A parcela ${inst.number} foi renegociada por outra operação. Atualize a tela.`, "installment_not_open");
    }
    throw e;
  }
  if (!tx && !reused) {
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
    if (inst?.status === "paid") {
      await resolveOccurrence(ctx.store, `overdue:${inst.id}`);
      await resolveOccurrence(ctx.store, `payable_due:${inst.id}`);
    }
  }
  return settlement;
}

export async function refreshTitleStatus(store: Store, titleId: string) {
  const title = await store.getOrThrow("titles", titleId);
  if (title.status === "cancelled") return title;
  const insts = await listAll(store, "installments", { filters: [["eq", "titleId", titleId]] });
  const live = insts.filter((i) => i.status !== "cancelled" && i.status !== "renegotiated");
  const balance = live.reduce((a, i) => a + i.balance, 0);
  const total = live.reduce((a, i) => a + i.amount, 0);
  const renegotiated = insts.some((i) => i.status === "renegotiated");
  const status = balance === 0 ? (renegotiated && !live.some((i) => i.paid > 0) ? "renegotiated" : "paid") : balance < total || renegotiated ? "partial" : "open";
  if (title.status !== status || title.balance !== balance) return store.update("titles", titleId, { status, balance });
  return title;
}

/**
 * Título gerado pela renegociação que incluiu a parcela (marcador "renegotiation" mais recente na sequência da parcela;
 * dados antigos sem marcador: único título de renegociação ativo do título original).
 */
export async function renegotiationTitleOf(ctx: Ctx, inst: Doc): Promise<Doc | null> {
  const marks = await listAll(ctx.store, "settlements", { filters: [["eq", "installmentId", inst.id], ["eq", "kind", "renegotiation"]], orderBy: [{ field: "seq", dir: "desc" }] });
  for (const m of marks) {
    const t = m.operationId ? await ctx.store.get("titles", m.operationId) : null;
    if (t && t.companyId === ctx.companyId) return t;
  }
  const legacy = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", inst.titleId]] })).filter((t) => t.companyId === ctx.companyId && t.status !== "cancelled");
  return legacy.length === 1 ? legacy[0] : null;
}

/**
 * Regra: baixa de parcela renegociada/cancelada não é estornada diretamente — reabrir a parcela cobraria a dívida
 * em duplicidade (o saldo já foi transferido ao título da renegociação). Desfaça antes a renegociação.
 */
async function assertInstallmentReversible(ctx: Ctx, inst: Doc) {
  if (inst.status === "renegotiated") {
    const nt = await renegotiationTitleOf(ctx, inst);
    throw new BusinessError(
      `A parcela ${inst.number} foi renegociada${nt ? ` no título nº ${nt.number}` : ""}; estornar esta baixa reabriria a dívida em duplicidade. Desfaça antes a renegociação${nt ? ` (no título nº ${nt.number}, estornando eventuais recebimentos dele)` : ""} e então estorne a baixa.`,
      "installment_renegotiated",
    );
  }
  if (inst.status === "cancelled") throw new BusinessError(`A parcela ${inst.number} está cancelada; a baixa não pode ser estornada.`, "installment_cancelled");
}

/** Estorna uma baixa: recompõe o saldo e gera lançamento inverso vinculado. */
export async function reverseSettlement(ctx: Ctx, settlementId: string, reason: string, tx?: Store) {
  assert(reason?.trim(), "Informe o motivo do estorno.");
  const s = await ctx.store.getOrThrow("settlements", settlementId);
  // antes de qualquer outra leitura: não revela o estado de baixas de outra empresa
  assert(s.companyId === ctx.companyId, "Baixa de outra empresa.", "cross_company");
  if (s.status === "reversed") return s;
  assert(s.kind === "settlement", "Somente baixas podem ser estornadas.");
  const entry = s.accountEntryId ? await ctx.store.get("account_entries", s.accountEntryId) : null;
  assert(!entry || entry.companyId === ctx.companyId, "Lançamento de outra empresa.", "cross_company");
  if (entry?.reconciled) throw new BusinessError("A baixa está conciliada com o extrato. Desfaça a conciliação antes de estornar.", "reconciled");
  const feeEntryCheck = s.fee > 0 ? await ctx.store.get("account_entries", settlementFeeEntryId(s)) : null;
  if (feeEntryCheck?.reconciled) throw new BusinessError("A tarifa desta baixa está conciliada com o extrato. Desfaça a conciliação antes de estornar.", "reconciled");
  await assertInstallmentReversible(ctx, await ctx.store.getOrThrow("installments", s.installmentId));
  let already = false;
  const run = async (t: Store) => {
    // estorno concorrente da mesma baixa: o primeiro vence, o segundo apenas devolve o resultado
    if ((await ctx.store.getOrThrow("settlements", s.id)).status === "reversed") {
      already = true;
      return;
    }
    const inst = await ctx.store.getOrThrow("installments", s.installmentId);
    assert(inst.companyId === ctx.companyId, "Parcela de outra empresa.", "cross_company");
    // relido dentro da tentativa: renegociação/cancelamento concorrente grava na mesma sequência (installmentId, seq) e gera conflito
    await assertInstallmentReversible(ctx, inst);
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
    if (s.fee > 0) {
      const feeEntry = await ctx.store.get("account_entries", settlementFeeEntryId(s));
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
  if (already) return ctx.store.getOrThrow("settlements", s.id);
  await refreshTitleStatus(ctx.store, s.titleId);
  await audit(ctx, { module: "finance", action: "settlement.reverse", entityType: "title", entityId: s.titleId, summary: `Estorno de baixa (${(s.total / 100).toFixed(2)})`, reason, related: [`settlement:${s.id}`, `installment:${s.installmentId}`] });
  const inst = await ctx.store.get("installments", s.installmentId);
  if (inst && inst.status !== "paid" && inst.dueDate < today()) await reopenOccurrence(ctx.store, `overdue:${inst.id}`);
  return ctx.store.getOrThrow("settlements", s.id);
}

/** Limite de escritas por transação do Appwrite. */
const TX_LIMIT = 100;

/** Títulos de renegociação vigentes (não cancelados) gerados a partir do título `titleId`. */
export async function liveRenegotiationsOf(ctx: Ctx, titleId: string): Promise<Doc[]> {
  const list = await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", titleId]] });
  return list.filter((t) => t.companyId === ctx.companyId && t.status !== "cancelled").sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

/** Mensagem única (domínio e tela) para título com parcelas renegociadas em título ainda vigente. */
export function renegotiationBlockMessage(titleNumber: number, renegs: ReadonlyArray<Record<string, any>>) {
  const nums = renegs.map((r) => `nº ${r.number}`).join(", ");
  return `Parcelas do título nº ${titleNumber} foram renegociadas (título ${nums}). Desfaça antes a renegociação ${nums} (no título da renegociação, estornando eventuais recebimentos dele) e então cancele este título.`;
}

export interface CancelTitleOptions {
  /**
   * Cancela também, em cascata, os títulos de renegociação vigentes gerados a partir deste título (e os das
   * renegociações deles), desde que nenhum tenha recebimento ativo. Uso: extinção da dívida de origem
   * (ex.: cancelamento da venda). Sem a opção, o cancelamento é recusado enquanto houver renegociação vigente.
   */
  cascadeRenegotiations?: boolean;
}

/**
 * Cancela título sem baixas ativas (ex.: venda cancelada).
 * Concorrência com baixa: o saldo do título é lido ANTES de conferir as baixas e zerado com decremento limitado a 0 —
 * uma baixa gravada depois da leitura reduz o saldo e faz o decremento violar o limite (o cancelamento é recusado);
 * uma baixa que tente gravar depois do cancelamento viola o mesmo limite (saldo 0) e é recusada.
 * Renegociação: título com parcela renegociada em título de renegociação vigente NÃO é cancelado (regra segura:
 * o saldo devido está no título novo e cancelá-lo em silêncio apagaria uma dívida acordada) — desfaça antes a
 * renegociação; `opts.cascadeRenegotiations` cancela as renegociações sem recebimento junto. A renegociação
 * concorrente é recusada pelo mesmo limite do saldo (ver renegotiate).
 * Repetir o cancelamento conclui parcelas que tenham ficado pendentes (idempotente).
 */
export async function cancelTitle(ctx: Ctx, id: string, reason: string, opts: CancelTitleOptions = {}) {
  const title = await ctx.store.getOrThrow("titles", id);
  assert(title.companyId === ctx.companyId, "Título de outra empresa.", "cross_company");
  const activeSettlementsOf = (tid: string) => listAll(ctx.store, "settlements", { filters: [["eq", "titleId", tid], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
  const activeSettlements = () => activeSettlementsOf(id);
  const hasSettlements = () => new BusinessError("Título possui baixas ativas. Estorne as baixas antes de cancelar.", "has_settlements");
  const renegBlocked = (rs: Doc[]) => new BusinessError(renegotiationBlockMessage(title.number, rs), "has_renegotiation");
  const instsOf = () => listAll(ctx.store, "installments", { filters: [["eq", "titleId", id]] });
  let changed = false;
  if (title.status !== "cancelled") {
    if ((await activeSettlements()).length) throw hasSettlements();
    let renegs = await liveRenegotiationsOf(ctx, id);
    if (renegs.length && opts.cascadeRenegotiations) {
      for (const r of renegs) {
        if ((await activeSettlementsOf(r.id)).length) {
          throw new BusinessError(`O título nº ${r.number} (renegociação do título nº ${title.number}) possui recebimento(s) ativo(s). Estorne-os antes de cancelar.`, "has_settlements");
        }
      }
      for (const r of renegs) await cancelTitle(ctx, r.id, `${reason} — cancelamento do título original nº ${title.number}`, opts);
      renegs = await liveRenegotiationsOf(ctx, id);
    }
    if (renegs.length) throw renegBlocked(renegs);
    try {
      await retryOnConflict(() =>
        ctx.store.transaction(async (t) => {
          changed = false;
          const cur = await ctx.store.getOrThrow("titles", id);
          if (cur.status === "cancelled") return;
          if ((await activeSettlements()).length) throw hasSettlements();
          const live = await liveRenegotiationsOf(ctx, id);
          if (live.length) throw renegBlocked(live);
          const pending = (await instsOf()).filter((i) => i.status !== "cancelled");
          if (cur.balance > 0) await t.increment("titles", id, "balance", -cur.balance, { min: 0 });
          // títulos muito longos: parcelas concluídas logo abaixo, fora desta transação (baixa já é recusada pelo título cancelado)
          if (pending.length + 2 <= TX_LIMIT) for (const i of pending) await t.update("installments", i.id, { status: "cancelled", balance: 0 });
          await t.update("titles", id, { status: "cancelled", balance: 0, notes: [cur.notes, `Cancelado: ${reason}`].filter(Boolean).join("\n") });
          changed = true;
        }),
      );
    } catch (e) {
      if (isConflict(e)) {
        // baixa ou renegociação gravada entre a leitura e o commit: o limite do saldo recusou o cancelamento
        if ((await activeSettlements()).length) throw hasSettlements();
        const live = await liveRenegotiationsOf(ctx, id);
        if (live.length) throw renegBlocked(live);
        if (e.reason === "bounds") throw new BusinessError(`O título nº ${title.number} foi alterado por outra operação ao mesmo tempo. Atualize a tela e tente novamente.`, "concurrent_change");
      }
      throw e;
    }
  }
  const insts = await instsOf();
  const rest = insts.filter((i) => i.status !== "cancelled");
  for (let k = 0; k < rest.length; k += TX_LIMIT) {
    await ctx.store.transaction(async (t) => {
      for (const i of rest.slice(k, k + TX_LIMIT)) await t.update("installments", i.id, { status: "cancelled", balance: 0 });
    });
  }
  if (!changed) return ctx.store.getOrThrow("titles", id);
  for (const i of insts) {
    await resolveOccurrence(ctx.store, `overdue:${i.id}`);
    await resolveOccurrence(ctx.store, `payable_due:${i.id}`);
  }
  await audit(ctx, { module: "finance", action: "title.cancel", entityType: "title", entityId: id, summary: `Título nº ${title.number} cancelado`, reason });
  return ctx.store.getOrThrow("titles", id);
}

export async function approvePayable(ctx: Ctx, id: string, note?: string) {
  const title = await ctx.store.getOrThrow("titles", id);
  assert(title.companyId === ctx.companyId, "Título inválido: pertence a outra empresa.", "cross_company");
  assert(title.kind === "payable", "Somente contas a pagar exigem autorização.");
  assert(title.status !== "cancelled", "Título cancelado não pode ser autorizado.");
  if (title.approvalStatus === "approved") return title;
  assert(title.status !== "paid", "Título já quitado: não há pagamento a autorizar.");
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
  if (inst.status === "renegotiated") return "renegotiated";
  if (inst.dueDate < ref) return "overdue";
  if (inst.dueDate === ref) return "due_today";
  return "upcoming";
}

// ═════════════════════════════ Extensões do módulo Financeiro (telas 22–25 e cadastros)

/** Id do lançamento de tarifa gerado por uma baixa (determinístico pela chave da baixa). */
export function settlementFeeEntryId(s: Record<string, any>) {
  return detId("entry", `settle-fee:${s.idemKey}`);
}

// ───────────────────────────── Juros e multa por atraso (sugestão editável)

export interface LateChargeParams {
  /** multa única sobre o principal em atraso (bps; 200 = 2%) */
  fineBps: number;
  /** juros simples ao mês, pro rata die base 30 (bps; 100 = 1% a.m.) */
  interestMonthlyBps: number;
  /** dias de tolerância após o vencimento sem encargos */
  graceDays: number;
}

export const LATE_DEFAULTS: LateChargeParams = { fineBps: 200, interestMonthlyBps: 100, graceDays: 0 };

export async function lateChargeParams(store: Store, companyId: string, branchId?: string | null): Promise<LateChargeParams> {
  const v = await getSetting<Partial<LateChargeParams> | null>(store, companyId, branchId ?? null, "finance.late", null);
  return { ...LATE_DEFAULTS, ...(v ?? {}) };
}

/**
 * Sugestão de encargos: atraso = dias entre vencimento e pagamento (acima da tolerância).
 * multa = principal × multa%; juros = principal × juros%a.m. × dias / 30 (arredondamento half-up em centavos).
 */
export function suggestLateCharges(dueDate: string, payDate: string, principal: number, p: LateChargeParams) {
  const daysLate = Math.max(0, diffDays(dueDate, payDate));
  if (daysLate <= p.graceDays || principal <= 0) return { daysLate, fine: 0, interest: 0 };
  return { daysLate, fine: pct(principal, p.fineBps), interest: roundDiv(principal * p.interestMonthlyBps * daysLate, 10000 * 30) };
}

// ───────────────────────────── Títulos manuais

export interface ManualTitleInput {
  kind: TitleKind;
  partyType: "customer" | "supplier" | "other";
  partyId?: string | null;
  partyName?: string | null;
  description: string;
  documentNumber?: string | null;
  issueDate: string;
  competenceDate: string;
  categoryId?: string | null;
  costCenterId?: string | null;
  installments: InstallmentInput[];
  notes?: string | null;
  approved?: boolean;
  idemKey: string;
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function assertOwned(ctx: Ctx, collection: string, id: string | null | undefined, label: string) {
  if (!id) return null;
  const d = await ctx.store.get(collection, id);
  assert(d && d.companyId === ctx.companyId, `${label} inválido(a).`);
  return d;
}

/** Lançamento manual de título a receber/pagar (despesas, serviços avulsos, acordos). */
export async function createManualTitle(ctx: Ctx, input: ManualTitleInput) {
  const branchId = requireBranch(ctx);
  assert(input.description?.trim(), "Informe a descrição do título.");
  assert(isDate(input.issueDate) && isDate(input.competenceDate), "Informe emissão e competência válidas.");
  for (const i of input.installments) assert(isDate(i.dueDate), "Todas as parcelas precisam de vencimento.");
  let partyName = input.partyName?.trim() || null;
  if (input.partyType === "customer") {
    const c = await assertOwned(ctx, "customers", input.partyId, "Cliente");
    assert(c, "Selecione o cliente.");
    partyName = c.name;
  } else if (input.partyType === "supplier") {
    const s = await assertOwned(ctx, "suppliers", input.partyId, "Fornecedor");
    assert(s, "Selecione o fornecedor.");
    partyName = s.tradeName || s.name;
  } else assert(partyName, input.kind === "receivable" ? "Informe o pagador." : "Informe o favorecido.");
  const cat = await assertOwned(ctx, "fin_categories", input.categoryId, "Categoria");
  if (cat) assert(cat.type === (input.kind === "receivable" ? "revenue" : "expense"), input.kind === "receivable" ? "Use uma categoria de receita." : "Use uma categoria de despesa.");
  await assertOwned(ctx, "cost_centers", input.costCenterId, "Centro de custo");
  const title = await createTitle(ctx, {
    kind: input.kind,
    partyType: input.partyType,
    partyId: input.partyType === "other" ? null : input.partyId,
    partyName,
    description: input.description.trim(),
    documentNumber: input.documentNumber?.trim() || null,
    originType: "manual",
    issueDate: input.issueDate,
    competenceDate: input.competenceDate,
    categoryId: input.categoryId || null,
    costCenterId: input.costCenterId || null,
    installments: input.installments,
    approvalStatus: input.kind === "payable" ? (input.approved ? "approved" : "pending") : null,
    notes: input.notes ?? null,
    idemKey: `manual:${input.idemKey}`,
    branchId,
  });
  if (input.kind === "payable" && input.approved && !title.approvedAt) {
    await ctx.store.update("titles", title.id, { approvedBy: ctx.user.id, approvedAt: new Date().toISOString() });
    await audit(ctx, { module: "finance", action: "payable.approve", entityType: "title", entityId: title.id, summary: `Obrigação nº ${title.number} autorizada no lançamento` });
  }
  return title;
}

export interface TitleUpdate {
  description?: string;
  documentNumber?: string | null;
  competenceDate?: string;
  categoryId?: string | null;
  costCenterId?: string | null;
  notes?: string | null;
}

/** Edita dados descritivos do título (valores e parcelas pagas são imutáveis; use estorno/cancelamento). */
export async function updateTitle(ctx: Ctx, id: string, patch: TitleUpdate) {
  const title = await ctx.store.getOrThrow("titles", id);
  assert(title.companyId === ctx.companyId, "Título de outra empresa.");
  assert(title.status !== "cancelled", "Título cancelado não pode ser alterado.");
  if (patch.description !== undefined) assert(patch.description.trim(), "Informe a descrição.");
  if (patch.competenceDate !== undefined) assert(isDate(patch.competenceDate), "Competência inválida.");
  const cat = await assertOwned(ctx, "fin_categories", patch.categoryId, "Categoria");
  if (cat) assert(cat.type === (title.kind === "receivable" ? "revenue" : "expense"), title.kind === "receivable" ? "Use uma categoria de receita." : "Use uma categoria de despesa.");
  await assertOwned(ctx, "cost_centers", patch.costCenterId, "Centro de custo");
  const next: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = typeof v === "string" ? v.trim() || null : v;
  if (next.description === null) delete next.description;
  const d = diff(title, next);
  if (!Object.keys(d.after).length) return title;
  const updated = await ctx.store.update("titles", id, next);
  // dados denormalizados nas parcelas (filtros e fluxo previsto)
  const instPatch: Record<string, any> = {};
  for (const k of ["categoryId", "costCenterId", "competenceDate", "description"]) if (k in d.after) instPatch[k] = next[k];
  if (Object.keys(instPatch).length) {
    for (const i of await listAll(ctx.store, "installments", { filters: [["eq", "titleId", id]] })) await ctx.store.update("installments", i.id, instPatch);
  }
  await audit(ctx, { module: "finance", action: "title.update", entityType: "title", entityId: id, summary: `Título nº ${title.number} alterado`, before: d.before, after: d.after });
  return updated;
}

/** Altera vencimento/nosso número de parcela em aberto. */
export async function updateInstallment(ctx: Ctx, id: string, patch: { dueDate?: string; ourNumber?: string | null }, reason?: string | null) {
  const inst = await ctx.store.getOrThrow("installments", id);
  assert(inst.companyId === ctx.companyId, "Parcela de outra empresa.");
  assert(["open", "partial"].includes(inst.status), "Somente parcelas em aberto podem ser alteradas.");
  const next: Record<string, any> = {};
  if (patch.dueDate !== undefined && patch.dueDate !== inst.dueDate) {
    assert(isDate(patch.dueDate), "Vencimento inválido.");
    assert(reason?.trim(), "Informe o motivo da alteração do vencimento.");
    next.dueDate = patch.dueDate;
  }
  if (patch.ourNumber !== undefined) {
    const raw = patch.ourNumber?.trim() || null;
    const norm = raw ? normalizeOurNumber(raw) : null;
    if (raw) assert(norm, "Nosso número inválido: informe os dígitos do boleto.");
    if ((norm || null) !== (inst.ourNumber || null)) next.ourNumber = norm;
  }
  if (!Object.keys(next).length) return inst;
  const updated = await ctx.store.update("installments", id, next);
  if (next.dueDate && next.dueDate >= today()) await resolveOccurrence(ctx.store, `overdue:${id}`);
  await audit(ctx, {
    module: "finance", action: "installment.update", entityType: "title", entityId: inst.titleId, summary: `Parcela ${inst.number} alterada${next.dueDate ? ` — vencimento ${formatDate(inst.dueDate)} → ${formatDate(next.dueDate)}` : ""}${"ourNumber" in next ? ` — nosso número ${next.ourNumber ?? "removido"}` : ""}`,
    before: { dueDate: inst.dueDate, ourNumber: inst.ourNumber }, after: next, reason: reason ?? null, related: [`installment:${id}`],
  });
  return updated;
}

/** Revoga a autorização de pagamento (somente sem baixas ativas). */
export async function revokePayableApproval(ctx: Ctx, id: string, reason: string) {
  assert(reason?.trim(), "Informe o motivo.");
  const title = await ctx.store.getOrThrow("titles", id);
  assert(title.kind === "payable" && title.companyId === ctx.companyId, "Título inválido.");
  if (title.approvalStatus !== "approved") return title;
  const active = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", id], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
  assert(!active.length, "Há pagamentos registrados. Estorne-os antes de revogar a autorização.");
  const updated = await ctx.store.update("titles", id, { approvalStatus: "pending", approvedBy: null, approvedAt: null });
  await audit(ctx, { module: "finance", action: "payable.revoke", entityType: "title", entityId: id, summary: `Autorização da obrigação nº ${title.number} revogada`, reason });
  return updated;
}

export interface TitleAttachment {
  fileId: string;
  name: string;
  mime?: string | null;
  sizeBytes?: number | null;
  kind?: string | null;
  settlementId?: string | null;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName?: string | null;
}

/** Registra anexo/comprovante (arquivo já salvo em `files`) no título. */
export async function addTitleAttachment(ctx: Ctx, titleId: string, att: Omit<TitleAttachment, "uploadedAt" | "uploadedBy" | "uploadedByName">) {
  const title = await ctx.store.getOrThrow("titles", titleId);
  assert(title.companyId === ctx.companyId, "Título de outra empresa.");
  const list: TitleAttachment[] = Array.isArray(title.attachments) ? title.attachments : [];
  if (list.some((a) => a.fileId === att.fileId)) return title;
  const next = [...list, { ...att, uploadedAt: new Date().toISOString(), uploadedBy: ctx.user.id, uploadedByName: ctx.user.name }];
  const updated = await ctx.store.update("titles", titleId, { attachments: next });
  await audit(ctx, { module: "finance", action: "title.attach", entityType: "title", entityId: titleId, summary: `Anexo "${att.name}" adicionado${att.settlementId ? " (comprovante de baixa)" : ""}`, related: att.settlementId ? [`settlement:${att.settlementId}`] : [] });
  return updated;
}

// ───────────────────────────── Contas financeiras

export type AccountKind = "cash" | "bank" | "wallet";
export const ACCOUNT_KIND_LABEL: Record<string, string> = { cash: "Caixa", bank: "Banco", wallet: "Carteira digital" };

export interface AccountInput {
  name: string;
  kind: AccountKind;
  branchId?: string | null;
  bankCode?: string | null;
  agency?: string | null;
  accountNumber?: string | null;
  pixKey?: string | null;
  initialBalance: number;
  initialBalanceDate: string;
  active?: boolean;
}

export async function saveAccount(ctx: Ctx, id: string | null, input: AccountInput, reason?: string | null) {
  assert(input.name?.trim(), "Informe o nome da conta.");
  assert(["cash", "bank", "wallet"].includes(input.kind), "Tipo de conta inválido.");
  assert(isDate(input.initialBalanceDate), "Informe a data de referência do saldo inicial.");
  assert(Number.isInteger(input.initialBalance), "Saldo inicial inválido.");
  if (input.branchId) await assertOwned(ctx, "branches", input.branchId, "Filial");
  const data = {
    name: input.name.trim(), kind: input.kind, branchId: input.branchId || null, bankCode: input.bankCode?.trim() || null, agency: input.agency?.trim() || null,
    accountNumber: input.accountNumber?.trim() || null, pixKey: input.pixKey?.trim() || null, active: input.active !== false,
  };
  if (!id) {
    const acc = await ctx.store.create("financial_accounts", { ...data, companyId: ctx.companyId, createdBy: ctx.user.id, initialBalance: input.initialBalance, initialBalanceDate: input.initialBalanceDate, balance: input.initialBalance, seq: 0 });
    await audit(ctx, { module: "finance", action: "account.create", entityType: "financial_account", entityId: acc.id, summary: `Conta "${acc.name}" criada (saldo inicial ${formatMoney(input.initialBalance)} em ${formatDate(input.initialBalanceDate)})` });
    return acc;
  }
  const acc = await ctx.store.getOrThrow("financial_accounts", id);
  assert(acc.companyId === ctx.companyId, "Conta de outra empresa.");
  if (data.active === false && acc.active !== false) assert(acc.kind !== "cash" || !(await isCashAccountInUse(ctx, acc)), "Conta de caixa em uso por sessão aberta.");
  const d = diff(acc, data);
  if (Object.keys(d.after).length) {
    await ctx.store.update("financial_accounts", id, data);
    await audit(ctx, { module: "finance", action: "account.update", entityType: "financial_account", entityId: id, summary: `Conta "${data.name}" alterada`, before: d.before, after: d.after });
  }
  if (input.initialBalance !== (acc.initialBalance ?? 0) || input.initialBalanceDate !== acc.initialBalanceDate) {
    await changeInitialBalance(ctx, id, { initialBalance: input.initialBalance, initialBalanceDate: input.initialBalanceDate, reason: reason ?? "" });
  }
  return ctx.store.getOrThrow("financial_accounts", id);
}

async function isCashAccountInUse(ctx: Ctx, acc: Doc) {
  if (!acc.branchId) return false;
  const open = await ctx.store.list("cash_sessions", { filters: [["eq", "branchId", acc.branchId], ["eq", "status", ["open", "reopened"]]], limit: 1, total: false });
  return open.items.length > 0;
}

/**
 * Altera o saldo inicial (e/ou sua data) de forma segura:
 *  - grava um marcador no extrato interno (kind "initial", valor 0) com a MESMA sequência por conta usada
 *    pelos lançamentos — alterações concorrentes com novos lançamentos geram conflito e são reaplicadas;
 *  - saldo atual = novo saldo inicial + Σ lançamentos (diferença aplicada atomicamente na transação);
 *  - "saldo após" de cada lançamento é recalculado (tarefa durável, idempotente).
 * A data de referência não pode ser posterior ao primeiro lançamento da conta.
 */
export async function changeInitialBalance(ctx: Ctx, accountId: string, input: { initialBalance: number; initialBalanceDate: string; reason: string }) {
  assert(input.reason?.trim(), "Informe o motivo da alteração do saldo inicial.");
  assert(isDate(input.initialBalanceDate), "Data de referência inválida.");
  const first = await ctx.store.list("account_entries", { filters: [["eq", "accountId", accountId], ["ne", "kind", "initial"]], orderBy: [{ field: "date", dir: "asc" }], limit: 1, total: false });
  if (first.items[0]) assert(input.initialBalanceDate <= first.items[0].date, `A data do saldo inicial deve ser anterior ou igual ao primeiro lançamento (${formatDate(first.items[0].date)}).`);
  const res = await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      const acc = await ctx.store.getOrThrow("financial_accounts", accountId);
      assert(acc.companyId === ctx.companyId, "Conta de outra empresa.");
      const before = { initialBalance: acc.initialBalance ?? 0, initialBalanceDate: acc.initialBalanceDate };
      if (before.initialBalance === input.initialBalance && before.initialBalanceDate === input.initialBalanceDate) return { acc, changed: false, before };
      const delta = input.initialBalance - before.initialBalance;
      const seq = (acc.seq ?? 0) + 1;
      const balance = (acc.balance ?? 0) + delta;
      const key = `initial:${accountId}:${seq}`;
      await t.create(
        "account_entries",
        {
          companyId: ctx.companyId, branchId: acc.branchId ?? ctx.branchId, createdBy: ctx.user.id, accountId, seq, date: today(), amount: 0, balanceAfter: balance, kind: "initial",
          description: `Saldo inicial alterado: ${formatMoney(before.initialBalance)} em ${formatDate(before.initialBalanceDate)} → ${formatMoney(input.initialBalance)} em ${formatDate(input.initialBalanceDate)} (${input.reason.trim()})`,
          reconciled: false, originType: "initial_balance", originId: accountId, idemKey: key,
        },
        detId("entry", key),
      );
      await t.update("financial_accounts", accountId, { initialBalance: input.initialBalance, initialBalanceDate: input.initialBalanceDate, balance, seq });
      return { acc: { ...acc, balance, seq }, changed: true, before };
    }),
  );
  if (!res.changed) return res.acc;
  await audit(ctx, {
    module: "finance", action: "account.initial_balance", entityType: "financial_account", entityId: accountId,
    summary: `Saldo inicial alterado para ${formatMoney(input.initialBalance)} em ${formatDate(input.initialBalanceDate)}`, before: res.before,
    after: { initialBalance: input.initialBalance, initialBalanceDate: input.initialBalanceDate }, reason: input.reason,
  });
  await enqueue(ctx.store, { type: "finance.account.rebuild", payload: { accountId }, dedupeKey: `acc-rebuild:${accountId}:${res.acc.seq}`, companyId: ctx.companyId, createdBy: ctx.user.id });
  await rebuildRunningBalances(ctx.store, accountId).catch((e) => console.error("[finance] recálculo será concluído pela tarefa", e));
  return ctx.store.getOrThrow("financial_accounts", accountId);
}

/**
 * Recalcula o "saldo após" de cada lançamento (cache de exibição) = saldo inicial + soma acumulada por sequência.
 * Idempotente; não altera valores nem o saldo da conta. Retorna divergência se o saldo da conta não fechar.
 */
export async function rebuildRunningBalances(store: Store, accountId: string) {
  const acc = await store.getOrThrow("financial_accounts", accountId);
  const entries = await listAll(store, "account_entries", { filters: [["eq", "accountId", accountId]], orderBy: [{ field: "seq", dir: "asc" }] });
  let running = acc.initialBalance ?? 0;
  let fixed = 0;
  for (const e of entries) {
    if (e.seq > (acc.seq ?? 0)) break; // lançamentos posteriores à leitura já nasceram corretos
    running += e.amount;
    if (e.balanceAfter !== running) {
      await store.update("account_entries", e.id, { balanceAfter: running });
      fixed++;
    }
  }
  const lastSeqRead = entries.filter((e) => e.seq <= (acc.seq ?? 0)).length;
  return { fixed, entries: lastSeqRead, expected: running, accountBalance: acc.balance ?? 0, divergence: (acc.balance ?? 0) - running };
}

// ───────────────────────────── Lançamentos avulsos (tarifa, ajuste) e estorno

export interface AccountEntryInput {
  accountId: string;
  date: string;
  /** + entrada / − saída */
  amount: number;
  kind: "fee" | "adjustment";
  description: string;
  categoryId?: string | null;
  costCenterId?: string | null;
  idemKey: string;
}

export async function createAccountEntry(ctx: Ctx, input: AccountEntryInput) {
  const branchId = requireBranch(ctx);
  assert(isDate(input.date), "Data inválida.");
  assert(input.date <= today(), "Lançamento não pode ter data futura.");
  assert(input.amount !== 0, "Informe o valor.");
  assert(input.description?.trim(), "Informe a descrição.");
  if (input.kind === "fee") assert(input.amount < 0, "Tarifa é sempre uma saída.");
  const acc = await assertOwned(ctx, "financial_accounts", input.accountId, "Conta");
  await assertOwned(ctx, "fin_categories", input.categoryId, "Categoria");
  await assertOwned(ctx, "cost_centers", input.costCenterId, "Centro de custo");
  const entry = await retryOnConflict(() =>
    ctx.store.transaction((t) =>
      postEntry(ctx, t, {
        accountId: input.accountId, date: input.date, amount: input.amount, kind: input.kind, description: input.description.trim(), categoryId: input.categoryId || null,
        costCenterId: input.costCenterId || null, originType: "manual", idemKey: `manual-entry:${input.idemKey}`, branchId: acc?.branchId ?? branchId,
      }),
    ),
  );
  await audit(ctx, { module: "finance", action: "entry.create", entityType: "account_entry", entityId: entry.id, summary: `Lançamento avulso: ${input.description} (${formatMoney(input.amount)})`, after: { amount: input.amount, kind: input.kind }, related: [`financial_account:${input.accountId}`] });
  return entry;
}

/** Estorna lançamento avulso (tarifa/ajuste) com lançamento inverso vinculado. Baixas usam reverseSettlement. */
export async function reverseEntry(ctx: Ctx, entryId: string, reason: string) {
  assert(reason?.trim(), "Informe o motivo do estorno.");
  const e = await ctx.store.getOrThrow("account_entries", entryId);
  assert(e.companyId === ctx.companyId, "Lançamento de outra empresa.");
  if (e.reversedBy) return ctx.store.getOrThrow("account_entries", e.reversedBy);
  assert(["fee", "adjustment"].includes(e.kind) && !e.settlementId, "Somente lançamentos avulsos podem ser estornados aqui. Baixas são estornadas no título.");
  assert(!e.reconciled, "Lançamento conciliado: desfaça a conciliação antes de estornar.");
  const rev = await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      const r = await postEntry(ctx, t, {
        accountId: e.accountId, date: today(), amount: -e.amount, kind: "reversal", description: `Estorno: ${e.description}`, reversalOf: e.id, categoryId: e.categoryId,
        costCenterId: e.costCenterId, originType: "entry_reversal", originId: e.id, idemKey: `reverse-entry:${e.id}`, branchId: e.branchId,
      });
      await t.update("account_entries", e.id, { reversedBy: r.id });
      return r;
    }),
  );
  await audit(ctx, { module: "finance", action: "entry.reverse", entityType: "account_entry", entityId: e.id, summary: `Estorno do lançamento "${e.description}" (${formatMoney(-e.amount)})`, reason, related: [`financial_account:${e.accountId}`] });
  return rev;
}

// ───────────────────────────── Cadastros auxiliares

export const METHOD_KINDS: Array<{ value: string; label: string }> = [
  { value: "cash", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "debit", label: "Cartão de débito" },
  { value: "credit", label: "Cartão de crédito" },
  { value: "crediario", label: "Crediário próprio" },
  { value: "boleto", label: "Boleto" },
  { value: "store_credit", label: "Vale-crédito" },
  { value: "voucher", label: "Voucher/benefício" },
  { value: "transfer", label: "Transferência/TED" },
  { value: "other", label: "Outro" },
];

export interface PaymentMethodInput {
  name: string;
  kind: string;
  accountId?: string | null;
  feeBps: number;
  settlementDays: number;
  allowsChange: boolean;
  requiresCustomer: boolean;
  availablePdv: boolean;
  maxInstallments: number;
  sortOrder?: number;
  active?: boolean;
}

/** Meios que lançam direto numa conta precisam da conta de destino. */
const DIRECT_KINDS = ["pix", "other", "voucher", "transfer"];

export async function savePaymentMethod(ctx: Ctx, id: string | null, input: PaymentMethodInput) {
  assert(input.name?.trim(), "Informe o nome do meio de pagamento.");
  assert(METHOD_KINDS.some((k) => k.value === input.kind), "Tipo de meio inválido.");
  assert(Number.isInteger(input.feeBps) && input.feeBps >= 0 && input.feeBps <= 2000, "Taxa deve estar entre 0% e 20% (confira a vírgula decimal: 1,5% = um e meio por cento).");
  assert(input.settlementDays >= 0 && input.settlementDays <= 400, "Prazo de liquidação inválido.");
  assert(input.maxInstallments >= 1 && input.maxInstallments <= 48, "Parcelas máximas entre 1 e 48.");
  if (DIRECT_KINDS.includes(input.kind)) assert(input.accountId, "Informe a conta de destino (o valor é lançado direto nela).");
  if (input.allowsChange) assert(input.kind === "cash", "Somente dinheiro admite troco.");
  if (["crediario", "boleto"].includes(input.kind)) assert(input.requiresCustomer, "Crediário e boleto exigem cliente identificado.");
  await assertOwned(ctx, "financial_accounts", input.accountId, "Conta de destino");
  const data = {
    name: input.name.trim(), kind: input.kind, accountId: input.accountId || null, feeBps: input.feeBps, settlementDays: input.settlementDays, allowsChange: input.allowsChange,
    requiresCustomer: input.requiresCustomer, availablePdv: input.availablePdv, maxInstallments: input.kind === "credit" || input.kind === "crediario" ? input.maxInstallments : 1, active: input.active !== false,
    sortOrder: input.sortOrder ?? 99,
  };
  return saveSimple(ctx, "payment_methods", id, data, "Meio de pagamento");
}

export interface PaymentTermInput {
  name: string;
  installments: number;
  firstDueDays: number;
  intervalDays: number;
  interestBps: number;
  kind: "both" | "sale" | "purchase";
  active?: boolean;
}

/**
 * Regra (decisão: avisar, não recusar): os juros da condição são acrescidos SOMENTE em títulos lançados manualmente
 * no Financeiro (Contas a receber/pagar → Novo). Vendas (PDV, crediário, boleto) e compras que usam a condição NÃO
 * acrescentam juros. Recusar juros em condições de venda impediria o uso em títulos manuais a receber (que listam as
 * mesmas condições), por isso o cadastro aceita, mas avisa explicitamente na tela, na listagem e ao salvar.
 */
export function paymentTermInterestNotice(term: { interestBps?: number | null; kind?: string | null }): string | null {
  if (!term.interestBps || term.interestBps <= 0) return null;
  const sale = term.kind !== "purchase";
  const purchase = term.kind !== "sale";
  const who = sale && purchase ? "Vendas (PDV, crediário e boleto) e compras" : sale ? "Vendas (PDV, crediário e boleto)" : "Compras (pedidos e recebimentos)";
  return `Atenção: os juros desta condição só são acrescidos em títulos lançados manualmente no Financeiro. ${who} que usarem esta condição NÃO acrescentam juros.`;
}

export async function savePaymentTerm(ctx: Ctx, id: string | null, input: PaymentTermInput) {
  assert(input.name?.trim(), "Informe o nome da condição.");
  assert(input.installments >= 1 && input.installments <= 60, "Parcelas entre 1 e 60.");
  assert(input.firstDueDays >= 0 && input.firstDueDays <= 365, "1º vencimento entre 0 e 365 dias.");
  assert(input.intervalDays >= 1 && input.intervalDays <= 365, "Intervalo entre 1 e 365 dias.");
  assert(Number.isInteger(input.interestBps) && input.interestBps >= 0 && input.interestBps <= 5000, "Juros da condição devem estar entre 0% e 50% sobre o total.");
  return saveSimple(ctx, "payment_terms", id, { name: input.name.trim(), installments: input.installments, firstDueDays: input.firstDueDays, intervalDays: input.intervalDays, interestBps: input.interestBps, kind: input.kind, active: input.active !== false }, "Condição de parcelamento");
}

export const DRE_GROUPS = ["Receita bruta", "Deduções", "CMV", "Despesas operacionais", "Despesas com pessoal", "Despesas administrativas", "Despesas financeiras", "Receitas financeiras", "Outras receitas", "Outras despesas", "Investimentos"];

export async function saveFinCategory(ctx: Ctx, id: string | null, input: { name: string; type: "revenue" | "expense"; parentId?: string | null; dreGroup?: string | null; active?: boolean }) {
  assert(input.name?.trim(), "Informe o nome da categoria.");
  assert(["revenue", "expense"].includes(input.type), "Tipo inválido.");
  if (input.parentId) {
    assert(input.parentId !== id, "A categoria não pode ser pai de si mesma.");
    const parent = await assertOwned(ctx, "fin_categories", input.parentId, "Categoria pai");
    assert(parent!.type === input.type, "A categoria pai deve ser do mesmo tipo.");
  }
  if (id && input.type) {
    const cur = await ctx.store.get("fin_categories", id);
    if (cur && cur.type !== input.type) {
      const used = await ctx.store.list("titles", { filters: [["eq", "categoryId", id]], limit: 1, total: false });
      assert(!used.items.length, "Categoria já utilizada em títulos: o tipo (receita/despesa) não pode ser alterado.");
    }
  }
  return saveSimple(ctx, "fin_categories", id, { name: input.name.trim(), type: input.type, parentId: input.parentId || null, dreGroup: input.dreGroup || null, active: input.active !== false }, "Categoria financeira");
}

export async function saveCostCenter(ctx: Ctx, id: string | null, input: { name: string; code?: string | null; active?: boolean }) {
  assert(input.name?.trim(), "Informe o nome do centro de custo.");
  if (input.code?.trim()) {
    const dup = await ctx.store.list("cost_centers", { filters: [["eq", "companyId", ctx.companyId], ["eq", "code", input.code.trim()]], limit: 2, total: false });
    assert(!dup.items.some((d) => d.id !== id), `Código ${input.code} já usado em outro centro de custo.`);
  }
  return saveSimple(ctx, "cost_centers", id, { name: input.name.trim(), code: input.code?.trim() || null, active: input.active !== false }, "Centro de custo");
}

async function saveSimple(ctx: Ctx, collection: string, id: string | null, data: Record<string, any>, label: string) {
  if (!id) {
    const doc = await ctx.store.create(collection, { ...data, companyId: ctx.companyId, createdBy: ctx.user.id });
    await audit(ctx, { module: "finance", action: `${collection}.create`, entityType: collection, entityId: doc.id, summary: `${label} "${data.name}" criado(a)`, after: data });
    return doc;
  }
  const cur = await ctx.store.getOrThrow(collection, id);
  assert(cur.companyId === ctx.companyId, "Registro de outra empresa.");
  const d = diff(cur, data);
  if (!Object.keys(d.after).length) return cur;
  const doc = await ctx.store.update(collection, id, data);
  await audit(ctx, { module: "finance", action: `${collection}.update`, entityType: collection, entityId: id, summary: `${label} "${data.name}" alterado(a)`, before: d.before, after: d.after });
  return doc;
}

const ACTIVE_COLLECTIONS = ["financial_accounts", "payment_methods", "payment_terms", "fin_categories", "cost_centers"] as const;

export async function setRecordActive(ctx: Ctx, collection: (typeof ACTIVE_COLLECTIONS)[number], id: string, active: boolean) {
  assert(ACTIVE_COLLECTIONS.includes(collection), "Cadastro inválido.");
  const cur = await ctx.store.getOrThrow(collection, id);
  assert(cur.companyId === ctx.companyId, "Registro de outra empresa.");
  if (cur.active === active) return cur;
  if (collection === "financial_accounts" && !active) assert(cur.kind !== "cash" || !(await isCashAccountInUse(ctx, cur)), "Conta de caixa em uso por sessão aberta.");
  const doc = await ctx.store.update(collection, id, { active });
  await audit(ctx, { module: "finance", action: `${collection}.${active ? "activate" : "deactivate"}`, entityType: collection, entityId: id, summary: `"${cur.name}" ${active ? "reativado(a)" : "inativado(a)"}` });
  return doc;
}

// ───────────────────────────── Recebíveis de cartão: taxa prevista

/**
 * Taxa prevista por parcela do recebível = taxa da venda (sale_payments.feeAmount) rateada pelas parcelas
 * (maior resto); sem pagamento de venda vinculado, aplica a taxa do meio sobre o valor.
 */
export async function cardFeeByInstallment(store: Store, titles: Doc[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = titles.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const pays = await listAll(store, "sale_payments", { filters: [["eq", "titleId", chunk]] });
    const insts = await listAll(store, "installments", { filters: [["eq", "titleId", chunk]], orderBy: [{ field: "number", dir: "asc" }] });
    const byTitle = new Map<string, Doc[]>();
    for (const x of insts) byTitle.set(x.titleId, [...(byTitle.get(x.titleId) ?? []), x]);
    for (const t of titles.filter((x) => chunk.includes(x.id))) {
      const list = byTitle.get(t.id) ?? [];
      const pay = pays.find((p) => p.titleId === t.id);
      const fee = pay?.feeAmount ?? 0;
      const parts = allocate(fee, list.map((x) => x.amount));
      list.forEach((x, k) => out.set(x.id, parts[k] ?? 0));
    }
  }
  return out;
}

/**
 * Forma canônica do nosso número (a mesma que os leitores CNAB devolvem): sem a carteira antes da barra
 * ("109/00054321-5"), sem o dígito verificador após hífen ("12345678-9" → "12345678"), sem espaços/pontuação
 * e sem zeros à esquerda ("00054321" → "54321").
 */
export function normalizeOurNumber(v: string | null | undefined): string {
  let s = String(v ?? "").trim();
  if (s.includes("/")) s = s.slice(s.lastIndexOf("/") + 1);
  s = s.replace(/-\s*[0-9A-Za-z]$/, "").replace(/[^0-9A-Za-z]/g, "");
  return s.replace(/^0+/, "");
}

/** Localiza a parcela a receber de um evento de cobrança: nosso número cadastrado ou "seu número" = nºtítulo/nºparcela. */
export async function findInstallmentByCollectionRef(store: Store, companyId: string, ref: { ourNumber?: string | null; yourNumber?: string | null }) {
  if (ref.ourNumber) {
    const norm = normalizeOurNumber(ref.ourNumber);
    // gravações antigas guardavam o número como digitado (com zeros à esquerda): também procura as formas preenchidas
    const padded = norm && /^\d+$/.test(norm) ? Array.from({ length: Math.max(0, 20 - norm.length) }, (_, k) => norm.padStart(norm.length + k + 1, "0")) : [];
    const variants = [...new Set([ref.ourNumber, norm, ...padded].filter(Boolean))];
    const hit = await store.list("installments", { filters: [["eq", "companyId", companyId], ["eq", "kind", "receivable"], ["eq", "ourNumber", variants]], limit: 1, total: false });
    if (hit.items[0]) return hit.items[0];
  }
  const m = (ref.yourNumber ?? "").trim().match(/^0*(\d+)\s*[/\-.]\s*0*(\d+)$/);
  if (m) {
    const title = await store.list("titles", { filters: [["eq", "companyId", companyId], ["eq", "kind", "receivable"], ["eq", "number", Number(m[1])]], limit: 1, total: false });
    if (title.items[0]) {
      const inst = await store.list("installments", { filters: [["eq", "titleId", title.items[0].id], ["eq", "number", Number(m[2])]], limit: 1, total: false });
      if (inst.items[0]) return inst.items[0];
    }
  }
  return null;
}

/** "Seu número" padrão para boletos do ERP: nº do título/nº da parcela (ex.: 123/2). */
export const collectionYourNumber = (titleNumber: number, instNumber: number) => `${titleNumber}/${instNumber}`;

// ───────────────────────────── Renegociação de crediário (Tela 22 — ação "Negociar")

/**
 * Parcelas selecionadas + novas parcelas por renegociação. Mantém a renegociação (2·sel + novas + 2 escritas) e o
 * seu desfazimento (2·sel + 2·novas + 2 escritas) dentro do limite de 100 escritas por transação do Appwrite.
 */
export const RENEG_MAX_ITEMS = 49;

export interface RenegotiateInput {
  titleId: string;
  installmentIds: string[];
  /** encargos incorporados (juros/multa negociados) */
  charges: number;
  discount: number;
  installments: InstallmentInput[];
  reason: string;
  idemKey: string;
}

/**
 * Renegocia parcelas em aberto de um título a receber: as parcelas escolhidas saem do saldo (status "renegociada",
 * sem movimento em conta) e um NOVO título (origem "renegotiation", vinculado ao original) recebe o valor
 * acordado = Σ saldos + encargos − desconto, no novo cronograma. Tudo numa única transação.
 */
export async function renegotiate(ctx: Ctx, input: RenegotiateInput) {
  const branchId = requireBranch(ctx);
  assert(input.reason?.trim(), "Informe o motivo/condições da renegociação.");
  const ids = (input.installmentIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  assert(ids.length > 0, "Selecione as parcelas a renegociar.");
  // recusa (não corrige em silêncio): o valor acordado foi calculado sobre a lista enviada
  assert(new Set(ids).size === ids.length, "Parcela repetida na seleção. Atualize a tela e selecione as parcelas novamente.", "duplicate_installment");
  assert(input.charges >= 0 && input.discount >= 0, "Encargos e desconto não podem ser negativos.");
  assert(input.installments.length > 0, "Gere as novas parcelas.");
  assert(
    ids.length + input.installments.length <= RENEG_MAX_ITEMS,
    `Renegociação limitada a ${RENEG_MAX_ITEMS} parcelas no total (selecionadas + novas): reduza para no máximo ${Math.max(1, RENEG_MAX_ITEMS - ids.length)} nova(s) parcela(s) ou renegocie em etapas.`,
    "too_many_installments",
  );
  const title = await ctx.store.getOrThrow("titles", input.titleId);
  assert(title.companyId === ctx.companyId && title.kind === "receivable", "Somente títulos a receber podem ser renegociados.");
  assert(title.status !== "cancelled", "Título cancelado não pode ser renegociado.");
  const newId = titleId(`reneg:${input.idemKey}`);
  const existing = await ctx.store.get("titles", newId);
  if (existing) return existing;
  const insts = await Promise.all(ids.map((id) => ctx.store.getOrThrow("installments", id)));
  for (const i of insts) {
    assert(i.titleId === title.id, "Parcela de outro título.");
    assert(["open", "partial"].includes(i.status), `Parcela ${i.number} não está em aberto.`);
  }
  const base = insts.reduce((a, i) => a + i.balance, 0);
  const total = base + input.charges - input.discount;
  assert(total > 0, "Valor renegociado deve ser positivo.");
  const sum = input.installments.reduce((a, i) => a + i.amount, 0);
  assert(sum === total, `As novas parcelas somam ${formatMoney(sum)}, mas o valor renegociado é ${formatMoney(total)}.`);
  for (const i of input.installments) assert(isDate(i.dueDate) && i.amount > 0, "Novas parcelas precisam de vencimento e valor.");
  const cancelledMsg = () => new BusinessError(`O título nº ${title.number} foi cancelado por outra operação; a renegociação não foi registrada.`, "title_cancelled");
  let created: Doc;
  try {
    created = await retryOnConflict(() =>
      ctx.store.transaction(async (t) => {
        if ((await ctx.store.getOrThrow("titles", title.id)).status === "cancelled") throw cancelledMsg();
        for (const i of insts) {
          const cur = await ctx.store.getOrThrow("installments", i.id);
          assert(cur.balance === i.balance && ["open", "partial"].includes(cur.status), "A parcela foi alterada por outra operação. Atualize e tente novamente.");
          const seq = cur.seq + 1;
          // marcador na sequência da parcela (índice único installmentId+seq): baixa/estorno concorrente gera conflito no commit
          // e a operação perdedora relê o estado; também registra qual título recebeu o saldo (operationId)
          const key = `reneg:${input.idemKey}:${cur.id}`;
          await t.create(
            "settlements",
            {
              companyId: ctx.companyId, branchId: title.branchId ?? branchId, createdBy: ctx.user.id, installmentId: cur.id, titleId: title.id, kind: "renegotiation", seq, date: today(),
              principal: 0, interest: 0, fine: 0, discount: 0, fee: 0, total: 0, status: "active", operationId: newId, notes: `Saldo ${formatMoney(cur.balance)} renegociado`, idemKey: key,
            },
            detId("settle", key),
          );
          await t.update("installments", i.id, { status: "renegotiated", balance: 0, seq });
        }
        await t.increment("titles", title.id, "balance", -base, { min: 0 });
        return createTitle(
          ctx,
          {
            kind: "receivable", partyType: title.partyType, partyId: title.partyId, partyName: title.partyName, description: `Renegociação do título nº ${title.number} — ${title.description}`,
            documentNumber: title.documentNumber, originType: "renegotiation", originId: title.id, issueDate: today(), competenceDate: title.competenceDate, categoryId: title.categoryId,
            costCenterId: title.costCenterId, installments: input.installments.map((i) => ({ ...i, methodKind: insts[0].methodKind ?? null })),
            notes: `Parcelas renegociadas: ${insts.map((i) => i.number).join(", ")} (saldo ${formatMoney(base)} + encargos ${formatMoney(input.charges)} − desconto ${formatMoney(input.discount)}). ${input.reason.trim()}`,
            idemKey: `reneg:${input.idemKey}`, branchId: title.branchId ?? branchId,
          },
          t,
        );
      }),
    );
  } catch (e) {
    // cancelamento (ou baixa) gravado entre a leitura e o commit: o limite do saldo do título recusa a renegociação
    if (isConflict(e) && e.reason === "bounds") {
      if ((await ctx.store.get("titles", title.id))?.status === "cancelled") throw cancelledMsg();
      throw new BusinessError("As parcelas ou o saldo do título foram alterados por outra operação ao mesmo tempo. Atualize a tela e tente novamente.", "concurrent_change");
    }
    throw e;
  }
  await refreshTitleStatus(ctx.store, title.id);
  for (const i of insts) await resolveOccurrence(ctx.store, `overdue:${i.id}`);
  await audit(ctx, { module: "finance", action: "title.renegotiate", entityType: "title", entityId: title.id, summary: `Parcelas ${insts.map((i) => i.number).join(", ")} renegociadas → título nº ${created.number} (${formatMoney(total)} em ${input.installments.length} parcela(s))`, reason: input.reason, related: [`title:${created.id}`, ...insts.map((i) => `installment:${i.id}`)] });
  await audit(ctx, { module: "finance", action: "title.create", entityType: "title", entityId: created.id, summary: `Título nº ${created.number} criado por renegociação do título nº ${title.number}`, related: [`title:${title.id}`] });
  return created;
}

/** Parcelas do título original que uma renegociação incluiu (marcadores; dados antigos: todas as renegociadas do título). */
async function renegotiatedInstallments(ctx: Ctx, nt: Doc, orig: Doc): Promise<Doc[]> {
  const marks = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", orig.id], ["eq", "kind", "renegotiation"], ["eq", "operationId", nt.id]] });
  if (marks.length) {
    const ids = [...new Set(marks.map((m) => m.installmentId as string))];
    return Promise.all(ids.map((x) => ctx.store.getOrThrow("installments", x)));
  }
  const siblings = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", orig.id]] })).filter((t) => t.companyId === ctx.companyId && t.status !== "cancelled");
  assert(siblings.length === 1 && siblings[0].id === nt.id, "Renegociação registrada antes do controle por parcela e com outras renegociações do mesmo título: desfaça manualmente (lançamento de ajuste).", "legacy_renegotiation");
  return (await listAll(ctx.store, "installments", { filters: [["eq", "titleId", orig.id]] })).filter((i) => i.status === "renegotiated");
}

/**
 * Desfaz uma renegociação: cancela o título gerado (somente sem recebimentos ativos) e devolve as parcelas originais
 * ao saldo (aberta/parcial, saldo = valor − principal já baixado), recompondo o saldo do título original.
 * Tudo numa transação; marcadores na sequência das parcelas serializam com baixas concorrentes.
 */
export async function undoRenegotiation(ctx: Ctx, renegTitleId: string, reason: string) {
  const branchId = requireBranch(ctx);
  assert(reason?.trim(), "Informe o motivo para desfazer a renegociação.");
  const nt = await ctx.store.getOrThrow("titles", renegTitleId);
  assert(nt.companyId === ctx.companyId, "Título de outra empresa.", "cross_company");
  assert(nt.originType === "renegotiation" && nt.originId, "Este título não foi gerado por renegociação.");
  if (nt.status === "cancelled") return nt;
  const orig = await ctx.store.getOrThrow("titles", nt.originId);
  assert(orig.companyId === ctx.companyId, "Título original de outra empresa.", "cross_company");
  const active = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", nt.id], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
  if (active.length) throw new BusinessError(`O título nº ${nt.number} já possui recebimento(s). Estorne-os antes de desfazer a renegociação.`, "has_settlements");
  if (orig.status === "cancelled") {
    // original já cancelado (dados anteriores à trava do cancelamento): não há saldo a devolver — apenas o título novo é cancelado
    const note = `Renegociação desfeita (título original nº ${orig.number} já cancelado): ${reason.trim()}`;
    await cancelTitle(ctx, nt.id, note.slice(0, 500));
    await audit(ctx, { module: "finance", action: "title.renegotiation_undo", entityType: "title", entityId: nt.id, summary: `Renegociação desfeita: título nº ${nt.number} cancelado (o título original nº ${orig.number} já estava cancelado; nada volta ao saldo)`, reason, related: [`title:${orig.id}`] });
    return ctx.store.getOrThrow("titles", nt.id);
  }
  const origInsts = await renegotiatedInstallments(ctx, nt, orig);
  assert(origInsts.length > 0, "Não foram encontradas as parcelas renegociadas do título original.");
  let already = false;
  let restored: Doc[] = [];
  let newInsts: Doc[] = [];
  await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      already = false;
      const cur = await ctx.store.getOrThrow("titles", nt.id);
      if (cur.status === "cancelled") {
        already = true;
        return;
      }
      newInsts = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", nt.id]], orderBy: [{ field: "number", dir: "asc" }] });
      const live = newInsts.filter((i) => i.status !== "cancelled");
      for (const i of live) {
        if (i.status === "renegotiated") {
          const next = await renegotiationTitleOf(ctx, i);
          throw new BusinessError(`A parcela ${i.number} deste título foi renegociada novamente${next ? ` (título nº ${next.number})` : ""}: desfaça primeiro a renegociação mais recente.`, "renegotiated_again");
        }
        if (i.paid > 0 || i.status !== "open") throw new BusinessError(`O título nº ${nt.number} já possui recebimento(s). Estorne-os antes de desfazer a renegociação.`, "has_settlements");
      }
      const origCur = await Promise.all(origInsts.map((i) => ctx.store.getOrThrow("installments", i.id)));
      for (const i of origCur) assert(i.status === "renegotiated", `A parcela ${i.number} do título nº ${orig.number} não está mais renegociada. Atualize a tela.`);
      assert(2 * (live.length + origCur.length) + 2 <= TX_LIMIT, `Renegociação com muitas parcelas (${live.length + origCur.length}) para desfazer numa única operação. Cancele o título nº ${nt.number} manualmente com lançamento de ajuste.`);
      const day = today();
      const note = `Renegociação desfeita: ${reason.trim()}`;
      for (const i of live) {
        const seq = i.seq + 1;
        const key = `reneg-undo:${nt.id}:${i.id}`;
        await t.create(
          "settlements",
          { companyId: ctx.companyId, branchId: nt.branchId ?? branchId, createdBy: ctx.user.id, installmentId: i.id, titleId: nt.id, kind: "renegotiation_undo", seq, date: day, principal: 0, interest: 0, fine: 0, discount: 0, fee: 0, total: 0, status: "active", operationId: nt.id, notes: note.slice(0, 500), idemKey: key },
          detId("settle", key),
        );
        await t.update("installments", i.id, { status: "cancelled", balance: 0, seq });
      }
      await t.update("titles", nt.id, { status: "cancelled", balance: 0, notes: [cur.notes, note].filter(Boolean).join("\n") });
      let back = 0;
      restored = [];
      for (const i of origCur) {
        const seq = i.seq + 1;
        const balance = i.amount - (i.paid ?? 0);
        const key = `reneg-undo:${nt.id}:${i.id}`;
        await t.create(
          "settlements",
          { companyId: ctx.companyId, branchId: orig.branchId ?? branchId, createdBy: ctx.user.id, installmentId: i.id, titleId: orig.id, kind: "renegotiation_undo", seq, date: day, principal: 0, interest: 0, fine: 0, discount: 0, fee: 0, total: 0, status: "active", operationId: nt.id, notes: note.slice(0, 500), idemKey: key },
          detId("settle", key),
        );
        await t.update("installments", i.id, { status: (i.paid ?? 0) > 0 ? "partial" : "open", balance, seq });
        back += balance;
        restored.push({ ...i, balance });
      }
      if (back > 0) await t.increment("titles", orig.id, "balance", back);
    }),
  );
  if (already) return ctx.store.getOrThrow("titles", nt.id);
  if ((await ctx.store.getOrThrow("titles", orig.id)).status === "cancelled") {
    // título original cancelado em paralelo: as parcelas devolvidas acompanham o cancelamento
    await cancelTitle(ctx, orig.id, "Cancelamento concluído após desfazer renegociação");
    await ctx.store.update("titles", orig.id, { balance: 0 });
  }
  await refreshTitleStatus(ctx.store, orig.id);
  const t0 = today();
  for (const i of newInsts) {
    await resolveOccurrence(ctx.store, `overdue:${i.id}`);
    await resolveOccurrence(ctx.store, `payable_due:${i.id}`);
  }
  for (const i of restored) if (i.dueDate < t0) await reopenOccurrence(ctx.store, `overdue:${i.id}`);
  const nums = restored.map((i) => i.number).join(", ");
  await audit(ctx, { module: "finance", action: "title.renegotiation_undo", entityType: "title", entityId: nt.id, summary: `Renegociação desfeita: título nº ${nt.number} cancelado; parcelas ${nums} do título nº ${orig.number} restauradas`, reason, related: [`title:${orig.id}`, ...restored.map((i) => `installment:${i.id}`)] });
  await audit(ctx, { module: "finance", action: "title.renegotiation_undo", entityType: "title", entityId: orig.id, summary: `Parcelas ${nums} voltaram ao saldo (renegociação nº ${nt.number} desfeita)`, reason, related: [`title:${nt.id}`] });
  return ctx.store.getOrThrow("titles", nt.id);
}

// ───────────────────────────── Aviso de cobrança por e-mail (Tela 22 — "Enviar cobrança")

/** Envia aviso de cobrança ao e-mail do cliente pelo canal configurado; registra o resultado real (entregue ou não). */
export async function sendCollectionNotice(ctx: Ctx, installmentId: string, opts: { to?: string | null; message?: string | null } = {}) {
  const inst = await ctx.store.getOrThrow("installments", installmentId);
  assert(inst.companyId === ctx.companyId && inst.kind === "receivable", "Parcela inválida.");
  assert(["open", "partial"].includes(inst.status), "A parcela não está em aberto.");
  const title = await ctx.store.getOrThrow("titles", inst.titleId);
  const customer = title.partyType === "customer" && title.partyId ? await ctx.store.get("customers", title.partyId) : null;
  const to = (opts.to ?? customer?.email ?? "").trim();
  assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to), "Cliente sem e-mail válido. Informe o destinatário.");
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const late = await lateChargeParams(ctx.store, ctx.companyId, title.branchId);
  const ch = suggestLateCharges(inst.dueDate, today(), inst.balance, late);
  const updated = inst.balance + ch.fine + ch.interest;
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<p>Olá, ${esc(title.partyName ?? "cliente")}.</p>
<p>Consta em aberto a parcela <b>${inst.number}/${title.installmentsCount}</b> de <b>${esc(title.description)}</b>${title.documentNumber ? ` (doc. ${esc(title.documentNumber)})` : ""}, com vencimento em <b>${formatDate(inst.dueDate)}</b>.</p>
<p>Saldo: <b>${formatMoney(inst.balance)}</b>${ch.daysLate > 0 ? ` — ${ch.daysLate} dia(s) em atraso; valor atualizado com multa e juros: <b>${formatMoney(updated)}</b>` : ""}.</p>
${opts.message ? `<p>${esc(opts.message)}</p>` : ""}
<p>Em caso de dúvida ou se o pagamento já foi feito, responda este e-mail ou procure a loja.</p>
<p>${esc(company.tradeName || company.name)}</p>`;
  const { sendEmail } = await import("@/lib/core/email");
  const res = await sendEmail(ctx.companyId, { to, subject: `Aviso de cobrança — parcela ${inst.number}/${title.installmentsCount} — ${company.tradeName || company.name}`, html });
  await audit(ctx, {
    module: "finance", action: "title.collection_notice", entityType: "title", entityId: title.id, result: res.delivered ? "success" : "failure",
    summary: res.delivered ? `Aviso de cobrança da parcela ${inst.number} enviado para ${to} (${res.channel})` : `Aviso de cobrança da parcela ${inst.number} NÃO enviado: ${res.message ?? res.channel}`,
    related: [`installment:${inst.id}`],
  });
  return res;
}
