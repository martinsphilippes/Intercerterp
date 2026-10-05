import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import {
  approvePayable, changeInitialBalance, createAccountEntry, createManualTitle, reverseSettlement, settleInstallment, suggestLateCharges, transferBetweenAccounts,
  updateInstallment, rebuildRunningBalances, accountBalanceAt, LATE_DEFAULTS, cancelTitle, reverseEntry,
} from "@/domain/finance";
import { importBankFile, reconcile, settleFromBankTx, suggestedSettlement, suggestMatches, undoReconciliation } from "@/domain/reconciliation";
import { computeCashflow, computeCompetence, entrySide } from "@/domain/cashflow";
import { notifyFinanceDue } from "@/domain/routines/finance";
import { openSession } from "@/domain/cash";
import { finalizeSale, settleCardReceivable } from "@/domain/sales";

const fx = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));

let refs: DemoRefs;
let ctx: Ctx;
const bal = async (accountId: string) => (await ctx.store.getOrThrow("financial_accounts", accountId)).balance as number;
const insts = (titleId: string) => listAll(ctx.store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number", dir: "asc" }] });

function ofx(rows: Array<{ date: string; amount: string; fitid: string; memo: string; doc?: string }>) {
  const body = rows.map((r) => `<STMTTRN><TRNTYPE>${r.amount.startsWith("-") ? "DEBIT" : "CREDIT"}<DTPOSTED>${r.date.replace(/-/g, "")}<TRNAMT>${r.amount}<FITID>${r.fitid}${r.doc ? `<CHECKNUM>${r.doc}` : ""}<MEMO>${r.memo}</STMTTRN>`).join("\n");
  return Buffer.from(`OFXHEADER:100\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>341<ACCTID>12345-6</BANKACCTFROM><BANKTRANLIST>\n${body}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);
}

async function receivable(amounts: number[], dueDates: string[], key: string) {
  return createManualTitle(ctx, {
    kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: `Serviço ${key}`, issueDate: today(), competenceDate: today(),
    categoryId: refs.finCategories.servicos.id, installments: amounts.map((amount, i) => ({ amount, dueDate: dueDates[i] })), idemKey: key,
  });
}

beforeEach(async () => {
  const store = freshStore();
  refs = await seedBase(store);
  ctx = await refs.ctxFor("finance", "matriz");
});

describe("contas a receber/pagar — baixas", () => {
  it("venda a prazo → parcelas → baixa parcial → conciliação sem nova entrada → estorno bloqueado até desconciliar", async () => {
    const cashier = await refs.ctxFor("admin", "matriz");
    await openSession(cashier, { terminalId: refs.terminals.cx1.id, openingFund: 0 });
    const sale = await finalizeSale(cashier, {
      idemKey: "t-sale-1", terminalId: refs.terminals.cx1.id, customerId: refs.customers.maria.id, items: [{ skuId: refs.skus["tenis-40"].id, qty: 1000 }],
      payments: [{ methodId: refs.methods.crediario.id, amount: 27990, paymentTermId: refs.terms["crediario-3x"].id }],
    });
    const title = (await listAll(ctx.store, "titles", { filters: [["eq", "originId", sale.id], ["eq", "originType", "sale"]] }))[0];
    expect(title.total).toBe(27990);
    const parts = await insts(title.id);
    expect(parts.map((p) => p.amount)).toEqual([9330, 9330, 9330]);
    const bank = refs.accounts.banco.id;
    const before = await bal(bank);
    const s = await settleInstallment(ctx, { installmentId: parts[0].id, date: today(), principal: 5000, accountId: bank, idemKey: "t-partial" });
    expect(await bal(bank)).toBe(before + 5000);
    const afterSettle = await ctx.store.getOrThrow("installments", parts[0].id);
    expect(afterSettle).toMatchObject({ paid: 5000, balance: 4330, status: "partial" });
    expect((await ctx.store.getOrThrow("titles", title.id)).status).toBe("partial");

    // extrato com o crédito → conciliação 1:1
    const imp = await importBankFile(ctx, { accountId: bank, fileName: "e.ofx", data: ofx([{ date: today(), amount: "50.00", fitid: "F1", memo: "DEPOSITO MARIA" }]) });
    const tx = (await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp.import.id]] }))[0];
    const entriesBefore = (await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]] })).length;
    const sugg = suggestMatches([tx], await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]] }), { windowDays: 5 });
    expect(sugg.get(tx.id)?.[0]).toMatchObject({ entryIds: [s.accountEntryId], difference: 0 });
    // sugestão não confirma nada
    expect((await ctx.store.getOrThrow("account_entries", s.accountEntryId)).reconciled).toBe(false);
    const rec = await reconcile(ctx, { accountId: bank, bankTxIds: [tx.id], entryIds: [s.accountEntryId], idemKey: "t-rec-1" });
    expect(rec.allocations).toEqual([{ bankTxId: tx.id, entryId: s.accountEntryId, amount: 5000 }]);
    expect(await bal(bank)).toBe(before + 5000); // conciliação não movimenta saldo
    expect((await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]] })).length).toBe(entriesBefore);
    expect((await ctx.store.getOrThrow("installments", parts[0].id)).balance).toBe(4330); // saldo remanescente preservado
    // estorno bloqueado (conciliado) → desfaz conciliação → estorna
    await expect(reverseSettlement(ctx, s.id, "erro de digitação")).rejects.toThrow(/Desfaça a conciliação/);
    await undoReconciliation(ctx, rec.id, "conferência");
    expect((await ctx.store.getOrThrow("bank_transactions", tx.id)).status).toBe("pending");
    expect((await ctx.store.getOrThrow("settlements", s.id)).status).toBe("active"); // desconciliar não apaga a baixa
    await reverseSettlement(ctx, s.id, "erro de digitação");
    expect(await bal(bank)).toBe(before);
    expect(await ctx.store.getOrThrow("installments", parts[0].id)).toMatchObject({ paid: 0, balance: 9330, status: "open" });
  });

  it("duas baixas concorrentes do mesmo saldo nunca excedem o saldo; repetição com a mesma chave é idempotente", async () => {
    const t = await receivable([10000], [today()], "conc");
    const [inst] = await insts(t.id);
    const bank = refs.accounts.banco.id;
    const before = await bal(bank);
    const results = await Promise.allSettled([
      settleInstallment(ctx, { installmentId: inst.id, date: today(), principal: 10000, accountId: bank, idemKey: "a" }),
      settleInstallment(ctx, { installmentId: inst.id, date: today(), principal: 10000, accountId: bank, idemKey: "b" }),
      settleInstallment(ctx, { installmentId: inst.id, date: today(), principal: 6000, accountId: refs.accounts.pix.id, idemKey: "c" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").every((r: any) => /maior que o saldo/.test(r.reason.message))).toBe(true);
    const after = await ctx.store.getOrThrow("installments", inst.id);
    expect(after.paid).toBeLessThanOrEqual(10000);
    expect(after.balance).toBeGreaterThanOrEqual(0);
    const active = await listAll(ctx.store, "settlements", { filters: [["eq", "installmentId", inst.id]] });
    expect(active.reduce((a, x) => a + x.principal, 0)).toBe(after.paid);
    // parciais concorrentes que somadas excedem: no máximo o saldo
    const t2 = await receivable([10000], [today()], "conc2");
    const [i2] = await insts(t2.id);
    const r2 = await Promise.allSettled([6000, 6000, 6000].map((p, k) => settleInstallment(ctx, { installmentId: i2.id, date: today(), principal: p, accountId: bank, idemKey: `p${k}` })));
    expect(r2.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect((await ctx.store.getOrThrow("installments", i2.id)).balance).toBe(4000);
    // idempotência
    const again = await Promise.all([1, 2].map(() => settleInstallment(ctx, { installmentId: i2.id, date: today(), principal: 1000, accountId: bank, idemKey: "same" })));
    expect(again[0].id).toBe(again[1].id);
    expect((await ctx.store.getOrThrow("installments", i2.id)).balance).toBe(3000);
    expect(await bal(bank)).toBe(before + (ok[0] as any).value.total * ((ok[0] as any).value.accountId === bank ? 1 : 0) + 6000 + 1000);
  });

  it("estorno recompõe saldo da parcela, do título e da conta com lançamento inverso vinculado", async () => {
    const t = await receivable([20000, 10000], [addDays(today(), -10), addDays(today(), 20)], "rev");
    const [i1] = await insts(t.id);
    const bank = refs.accounts.banco.id;
    const before = await bal(bank);
    const s = await settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 20000, interest: 150, fine: 400, discount: 0, fee: 200, accountId: bank, idemKey: "r1" });
    expect(s.total).toBe(20550);
    expect(await bal(bank)).toBe(before + 20550 - 200);
    expect((await ctx.store.getOrThrow("titles", t.id)).balance).toBe(10000);
    await expect(reverseSettlement(ctx, s.id, "")).rejects.toThrow(/motivo/);
    await reverseSettlement(ctx, s.id, "cheque devolvido");
    expect(await bal(bank)).toBe(before);
    expect(await ctx.store.getOrThrow("installments", i1.id)).toMatchObject({ paid: 0, balance: 20000, status: "open", interest: 0, fine: 0 });
    expect(await ctx.store.getOrThrow("titles", t.id)).toMatchObject({ balance: 30000, status: "open" });
    const revs = await listAll(ctx.store, "account_entries", { filters: [["eq", "settlementId", s.id], ["eq", "kind", "reversal"]] });
    expect(revs.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-20550, 200]);
    expect(revs.find((r) => r.amount === -20550)!.reversalOf).toBe(s.accountEntryId);
    expect((await ctx.store.getOrThrow("settlements", s.id)).status).toBe("reversed");
    // título com baixa ativa não cancela; sem baixas, cancela
    await settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 100, accountId: bank, idemKey: "r2" });
    await expect(cancelTitle(ctx, t.id, "x")).rejects.toThrow(/baixas ativas/);
  });

  it("contas a pagar: autorização separada do pagamento; sugestão de juros/multa editável", async () => {
    const t = await createManualTitle(ctx, {
      kind: "payable", partyType: "supplier", partyId: refs.suppliers.papel.id, description: "Material de escritório", documentNumber: "NF 991", issueDate: today(), competenceDate: today(),
      categoryId: refs.finCategories.aluguel.id, installments: [{ amount: 50000, dueDate: today() }], idemKey: "pay1",
    });
    expect(t.approvalStatus).toBe("pending");
    const [i] = await insts(t.id);
    await expect(settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 50000, accountId: refs.accounts.banco.id, idemKey: "pp" })).rejects.toThrow(/não autorizada/);
    await approvePayable(ctx, t.id);
    const s = await settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 50000, interest: 1000, discount: 500, accountId: refs.accounts.banco.id, idemKey: "pp" });
    expect(s.total).toBe(50500);
    expect((await ctx.store.getOrThrow("account_entries", s.accountEntryId)).amount).toBe(-50500);
    await expect(createManualTitle(ctx, { kind: "payable", partyType: "other", partyName: "X", description: "Y", issueDate: today(), competenceDate: today(), categoryId: refs.finCategories.vendas.id, installments: [{ amount: 1, dueDate: today() }], idemKey: "bad" })).rejects.toThrow(/despesa/);
    // juros simples pro rata (1% a.m.) + multa 2% sobre o principal pago
    expect(suggestLateCharges("2026-09-01", "2026-10-01", 100000, LATE_DEFAULTS)).toEqual({ daysLate: 30, fine: 2000, interest: 1000 });
    expect(suggestLateCharges("2026-09-01", "2026-09-16", 33333, LATE_DEFAULTS)).toEqual({ daysLate: 15, fine: 667, interest: 167 });
    expect(suggestLateCharges("2026-09-01", "2026-09-01", 100000, LATE_DEFAULTS)).toEqual({ daysLate: 0, fine: 0, interest: 0 });
    expect(suggestLateCharges("2026-09-01", "2026-09-03", 100000, { ...LATE_DEFAULTS, graceDays: 3 }).fine).toBe(0);
  });
});

describe("fluxo de caixa", () => {
  it("realizado = soma dos lançamentos não-transferência; transferências fora do resultado; saldo posicionado na data", async () => {
    const bank = refs.accounts.banco.id;
    const pix = refs.accounts.pix.id;
    const t = await receivable([30000], [today()], "cf1");
    const [i] = await insts(t.id);
    await settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 30000, accountId: pix, idemKey: "cf-s1" });
    const p = await createManualTitle(ctx, { kind: "payable", partyType: "other", partyName: "Imobiliária", description: "Aluguel", issueDate: today(), competenceDate: today(), categoryId: refs.finCategories.aluguel.id, installments: [{ amount: 12000, dueDate: today() }], approved: true, idemKey: "cf-p" });
    const [pi] = await insts(p.id);
    await settleInstallment(ctx, { installmentId: pi.id, date: today(), principal: 12000, accountId: bank, idemKey: "cf-s2" });
    await transferBetweenAccounts(ctx, { fromAccountId: pix, toAccountId: bank, amount: 25000, date: today(), description: "Pix → banco", idemKey: "cf-tr" });
    await createAccountEntry(ctx, { accountId: bank, date: today(), amount: -990, kind: "fee", description: "Tarifa", categoryId: refs.finCategories.tarifas.id, idemKey: "cf-fee" });
    // previsto
    await receivable([7000], [addDays(today(), 3)], "cf-fut");
    await createManualTitle(ctx, { kind: "payable", partyType: "other", partyName: "Fornecedor", description: "Boleto futuro", issueDate: today(), competenceDate: today(), installments: [{ amount: 4000, dueDate: addDays(today(), 5) }], idemKey: "cf-fut-p" });

    const from = addDays(today(), -2);
    const to = addDays(today(), 10);
    const cf = await computeCashflow(ctx, { from, to, granularity: "day", branchId: null });
    const entries = (await listAll(ctx.store, "account_entries", { filters: [["between", "date", from, to]] })).filter((e) => !["transfer_in", "transfer_out", "initial"].includes(e.kind));
    expect(cf.totals.realizedIn + cf.totals.realizedOut).toBe(entries.reduce((a, e) => a + e.amount, 0));
    expect(cf.totals.realizedIn).toBe(30000);
    expect(cf.totals.realizedOut).toBe(-12000 - 990);
    expect(cf.totals.transfersIn).toBe(25000);
    expect(cf.totals.transfersOut).toBe(-25000);
    expect(cf.totals.forecastIn).toBe(7000);
    expect(cf.totals.forecastOut).toBe(-4000);
    const initial = Object.values(refs.accounts).reduce((a, x) => a + x.initialBalance, 0);
    expect(cf.opening).toBe(initial);
    expect(cf.totals.closing).toBe(initial + 30000 - 12990 + 7000 - 4000);
    // por conta: transferência move saldo sem ser receita/despesa
    const cfPix = await computeCashflow(ctx, { from, to, granularity: "week", accountId: pix, branchId: null });
    expect(cfPix.totals.realizedIn).toBe(30000);
    expect(cfPix.totals.transfersOut).toBe(-25000);
    expect(cfPix.forecastAvailable).toBe(false);
    expect(cfPix.totals.closing).toBe(5000);
    // categoria
    const cfCat = await computeCashflow(ctx, { from, to, granularity: "month", categoryId: refs.finCategories.tarifas.id, branchId: null });
    expect(cfCat.totals.realizedOut).toBe(-990);
    expect(cfCat.showBalance).toBe(false);
    // estorno reduz o lado original
    expect(entrySide({ kind: "reversal", amount: -500 })).toBe("in");
    // competência: títulos pela competência + lançamentos diretos
    const comp = await computeCompetence(ctx, { fromMonth: today().slice(0, 7), toMonth: today().slice(0, 7) });
    const rev = comp.byMonth[0].revenue;
    expect(rev).toBe(30000 + 7000);
    expect(comp.byMonth[0].expense).toBe(-12000 - 4000 - 990);
  });

  it("saldo inicial: alteração após lançamentos recalcula de forma coerente e concorrente", async () => {
    const bank = refs.accounts.banco.id;
    await createAccountEntry(ctx, { accountId: bank, date: today(), amount: -1000, kind: "fee", description: "Tarifa 1", idemKey: "ib1" });
    const initial = refs.accounts.banco.initialBalance;
    await expect(changeInitialBalance(ctx, bank, { initialBalance: 100, initialBalanceDate: addDays(today(), 1), reason: "x" })).rejects.toThrow(/anterior ou igual/);
    await Promise.all([
      changeInitialBalance(ctx, bank, { initialBalance: initial + 5000, initialBalanceDate: refs.accounts.banco.initialBalanceDate, reason: "saldo conferido com o banco" }),
      createAccountEntry(ctx, { accountId: bank, date: today(), amount: -200, kind: "fee", description: "Tarifa 2", idemKey: "ib2" }),
    ]);
    const acc = await ctx.store.getOrThrow("financial_accounts", bank);
    const entries = await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]], orderBy: [{ field: "seq", dir: "asc" }] });
    expect(acc.balance).toBe(initial + 5000 + entries.reduce((a, e) => a + e.amount, 0));
    expect(entries.some((e) => e.kind === "initial" && e.amount === 0)).toBe(true);
    const rb = await rebuildRunningBalances(ctx.store, bank);
    expect(rb.divergence).toBe(0);
    expect(entries.map((e) => e.seq)).toEqual(entries.map((_, k) => k + 1));
    const last = (await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]], orderBy: [{ field: "seq", dir: "desc" }] }))[0];
    expect(last.balanceAfter).toBe(acc.balance);
    expect(await accountBalanceAt(ctx.store, bank, today())).toBe(acc.balance);
    // lançamento avulso estornável
    const fee = entries.find((e) => e.description === "Tarifa 1")!;
    await reverseEntry(ctx, fee.id, "tarifa indevida");
    expect(await bal(bank)).toBe(acc.balance + 1000);
  });
});

describe("conciliação", () => {
  it("1:N e N:1 com valores alocados, diferença como tarifa e desconciliação sem apagar lançamentos", async () => {
    const bank = refs.accounts.banco.id;
    const t = await receivable([10000, 5000, 8000], [today(), today(), today()], "rc");
    const [a, b, c] = await insts(t.id);
    const sa = await settleInstallment(ctx, { installmentId: a.id, date: today(), principal: 10000, accountId: bank, idemKey: "rc-a" });
    const sb = await settleInstallment(ctx, { installmentId: b.id, date: today(), principal: 5000, accountId: bank, idemKey: "rc-b" });
    const sc = await settleInstallment(ctx, { installmentId: c.id, date: today(), principal: 8000, accountId: bank, idemKey: "rc-c" });
    const imp = await importBankFile(ctx, {
      accountId: bank, fileName: "x.ofx",
      data: ofx([
        { date: today(), amount: "149.50", fitid: "L1", memo: "DEP AGRUPADO" },
        { date: today(), amount: "30.00", fitid: "L2", memo: "PARTE 1" },
        { date: today(), amount: "50.00", fitid: "L3", memo: "PARTE 2" },
        { date: today(), amount: "-8.90", fitid: "L4", memo: "TARIFA DOC" },
      ]),
    });
    const txs = await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp.import.id]], orderBy: [{ field: "lineNo", dir: "asc" }] });
    const [l1, l2, l3, l4] = txs;
    const balBefore = await bal(bank);
    // 1:N com diferença (149,50 vs 150,00) exige lançar diferença
    await expect(reconcile(ctx, { accountId: bank, bankTxIds: [l1.id], entryIds: [sa.accountEntryId, sb.accountEntryId], idemKey: "x1" })).rejects.toThrow(/Diferença de/);
    const r1 = await reconcile(ctx, { accountId: bank, bankTxIds: [l1.id], entryIds: [sa.accountEntryId, sb.accountEntryId], adjustment: { categoryId: refs.finCategories.tarifas.id }, idemKey: "x1b" });
    expect(r1.difference).toBe(-50);
    expect(r1.allocations.map((x: any) => x.amount)).toEqual([10000, 5000, -50]);
    expect(await bal(bank)).toBe(balBefore - 50); // só o lançamento explícito da diferença movimenta
    const feeEntry = await ctx.store.getOrThrow("account_entries", r1.feeEntryId);
    expect(feeEntry).toMatchObject({ kind: "fee", amount: -50, reconciled: true, categoryId: refs.finCategories.tarifas.id });
    // N:1 (30 + 50 = 80)
    const r2 = await reconcile(ctx, { accountId: bank, bankTxIds: [l2.id, l3.id], entryIds: [sc.accountEntryId], idemKey: "x2" });
    expect(r2.allocations).toEqual([
      { bankTxId: l2.id, entryId: sc.accountEntryId, amount: 3000 },
      { bankTxId: l3.id, entryId: sc.accountEntryId, amount: 5000 },
    ]);
    // item já conciliado não entra em outra conciliação (nem concorrente)
    await expect(reconcile(ctx, { accountId: bank, bankTxIds: [l4.id], entryIds: [sc.accountEntryId], idemKey: "x3" })).rejects.toThrow(/conciliado/);
    const conc = await Promise.allSettled([
      reconcile(ctx, { accountId: bank, bankTxIds: [l4.id], entryIds: [], adjustment: { categoryId: refs.finCategories.tarifas.id }, idemKey: "y1" }),
      reconcile(ctx, { accountId: bank, bankTxIds: [l4.id], entryIds: [], adjustment: { categoryId: refs.finCategories.tarifas.id }, idemKey: "y2" }),
    ]);
    expect(conc.filter((r) => r.status === "fulfilled").length).toBe(1);
    await expect(reconcile(ctx, { accountId: bank, bankTxIds: [l2.id, l3.id], entryIds: [sa.accountEntryId, sb.accountEntryId], idemKey: "nn" })).rejects.toThrow(/N:N/);
    // desconciliar
    const entriesCount = (await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]] })).length;
    await undoReconciliation(ctx, r1.id, "agrupamento errado");
    expect((await ctx.store.getOrThrow("account_entries", sa.accountEntryId)).reconciled).toBe(false);
    expect((await ctx.store.getOrThrow("account_entries", r1.feeEntryId)).reconciled).toBe(false);
    expect((await ctx.store.getOrThrow("bank_transactions", l1.id)).status).toBe("pending");
    expect((await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]] })).length).toBe(entriesCount);
    expect((await ctx.store.getOrThrow("settlements", sa.id)).status).toBe("active");
    // após desconciliar, pode conciliar de novo (1:N agora com a tarifa já lançada)
    const r3 = await reconcile(ctx, { accountId: bank, bankTxIds: [l1.id], entryIds: [sa.accountEntryId, sb.accountEntryId, r1.feeEntryId], idemKey: "x4" });
    expect(r3.difference).toBe(0);
  });

  it("baixa a partir do retorno CNAB 400 (nosso número) cria a baixa e já concilia; extrato baixa conta a pagar", async () => {
    const bank = refs.accounts.banco.id;
    const t = await receivable([20000], [addDays(today(), -5)], "cnab");
    const [i] = await insts(t.id);
    await updateInstallment(ctx, i.id, { ourNumber: "54321" });
    const imp = await importBankFile(ctx, { accountId: bank, fileName: "itau.ret", data: fx("retorno-cobranca-itau.cnab400.ret") });
    const tx = (await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp.import.id], ["eq", "kind", "collection"]] }))[0];
    expect(tx.installmentId).toBe(i.id);
    const sug = suggestedSettlement(tx, i);
    expect(sug).toEqual({ principal: 20000, interest: 0, fine: 0, discount: 500, fee: 180 });
    await expect(settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: i.id, ...sug, fee: 0 })).rejects.toThrow(/resultam em/);
    const before = await bal(bank);
    const res = await settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: i.id, ...sug });
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ status: "paid", balance: 0, discount: 500 });
    expect(await bal(bank)).toBe(before + tx.amount);
    expect((await ctx.store.getOrThrow("bank_transactions", tx.id))).toMatchObject({ status: "reconciled", settlementId: res.settlement.id });
    expect(res.reconciliation.kind).toBe("collection");
    expect(res.reconciliation.entryIds).toHaveLength(2);
    // repetição devolve o mesmo resultado
    const again = await settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: i.id, ...sug });
    expect(again.settlement.id).toBe(res.settlement.id);
    // extrato: débito baixa conta a pagar autorizada
    const p = await createManualTitle(ctx, { kind: "payable", partyType: "other", partyName: "Energia", description: "Conta de luz", issueDate: today(), competenceDate: today(), installments: [{ amount: 68000, dueDate: today() }], approved: true, idemKey: "luz" });
    const [pi] = await insts(p.id);
    const imp2 = await importBankFile(ctx, { accountId: bank, fileName: "e.ofx", data: ofx([{ date: today(), amount: "-680.00", fitid: "LUZ", memo: "DEB AUT ENERGIA" }]) });
    const tx2 = (await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp2.import.id]] }))[0];
    await expect(settleFromBankTx(ctx, { bankTxId: tx2.id, installmentId: i.id, principal: 1 })).rejects.toThrow(/créditos/);
    await settleFromBankTx(ctx, { bankTxId: tx2.id, installmentId: pi.id, ...suggestedSettlement(tx2, pi) });
    expect((await ctx.store.getOrThrow("installments", pi.id)).status).toBe("paid");
  });
});

describe("recebíveis de cartão e rotinas", () => {
  it("liquidação de recebível de cartão com taxa e notificações de vencidos/a pagar hoje", async () => {
    const admin = await refs.ctxFor("admin", "matriz");
    await openSession(admin, { terminalId: refs.terminals.cx1.id, openingFund: 0 });
    const sale = await finalizeSale(admin, { idemKey: "card-1", terminalId: refs.terminals.cx1.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.debito.id, amount: 4490, nsu: "1" }] });
    const ct = (await listAll(ctx.store, "titles", { filters: [["eq", "originId", sale.id], ["eq", "originType", "sale_card"]] }))[0];
    const [ci] = await insts(ct.id);
    const bank = refs.accounts.banco.id;
    const before = await bal(bank);
    await settleCardReceivable(ctx, { installmentId: ci.id, accountId: bank, date: today(), fee: 58 });
    expect(await bal(bank)).toBe(before + 4490 - 58);
    expect((await ctx.store.getOrThrow("installments", ci.id)).status).toBe("paid");

    const overdue = await receivable([1000], [addDays(today(), -3)], "ov");
    const [oi] = await insts(overdue.id);
    const pay = await createManualTitle(ctx, { kind: "payable", partyType: "other", partyName: "Fornecedor", description: "Boleto do dia", issueDate: today(), competenceDate: today(), installments: [{ amount: 3000, dueDate: today() }], approved: true, idemKey: "due" });
    const [pi] = await insts(pay.id);
    const r1 = await notifyFinanceDue(ctx.store, ctx.companyId);
    expect(r1.overdueNotifications).toBeGreaterThan(0);
    expect(r1.payableNotifications).toBeGreaterThan(0);
    const again = await notifyFinanceDue(ctx.store, ctx.companyId);
    expect(again.overdueNotifications + again.payableNotifications).toBe(0); // idempotente
    const occ = (k: string) => listAll(ctx.store, "notifications", { filters: [["eq", "occurrenceKey", k]] });
    expect((await occ(`overdue:${oi.id}`)).every((n) => n.occurrenceStatus === "open")).toBe(true);
    await settleInstallment(ctx, { installmentId: oi.id, date: today(), principal: 1000, accountId: bank, idemKey: "ov-s" });
    await settleInstallment(ctx, { installmentId: pi.id, date: today(), principal: 3000, accountId: bank, idemKey: "due-s" });
    expect((await occ(`overdue:${oi.id}`)).every((n) => n.occurrenceStatus === "resolved")).toBe(true);
    expect((await occ(`payable_due:${pi.id}`)).every((n) => n.occurrenceStatus === "resolved")).toBe(true);
  });
});

describe("demonstração do financeiro", () => {
  it("carrega extrato OFX, retorno CNAB, título vencido e é repetível sem duplicar", async () => {
    const store = freshStore();
    const { seedDemo } = await import("@/domain/seed");
    const r1: any = await seedDemo(store, { historyDays: 4 });
    expect(r1.modules.finance.ofxImport).toBeTruthy();
    const imports1 = await listAll(store, "bank_imports");
    const txs1 = await listAll(store, "bank_transactions");
    expect(imports1.length).toBe(2);
    expect(txs1.filter((t) => t.kind === "statement").length).toBeGreaterThanOrEqual(3);
    const tarifa = txs1.find((t) => t.description.includes("TARIFA"));
    expect(tarifa?.status).toBe("pending");
    expect(txs1.filter((t) => t.status === "reconciled").length).toBe(1);
    const cnab = txs1.find((t) => t.kind === "collection");
    expect(cnab?.installmentId).toBeTruthy();
    const overdue = (await listAll(store, "titles", { filters: [["eq", "idemKey", "manual:demo-fin-overdue"]] }))[0];
    expect(overdue.status).toBe("open");
    await seedDemo(store, { historyDays: 4 });
    expect((await listAll(store, "bank_imports")).length).toBe(imports1.length);
    expect((await listAll(store, "bank_transactions")).length).toBe(txs1.length);
  }, 120000);
});

/**
 * Armazenamento com a semântica do Appwrite: dentro da transação as leituras NÃO enxergam as escritas
 * pendentes (aplicadas só no commit, atômicas). Pega erros de sequência/cache que o banco em memória mascara.
 */
class IsolatedStore {
  readonly backend = "memory" as const;
  constructor(private base: any) {}
  get(c: string, id: string) { return this.base.get(c, id); }
  getOrThrow(c: string, id: string) { return this.base.getOrThrow(c, id); }
  list(c: string, o?: any) { return this.base.list(c, o); }
  create(c: string, d: any, id?: string) { return this.base.create(c, d, id); }
  update(c: string, id: string, p: any) { return this.base.update(c, id, p); }
  delete(c: string, id: string) { return this.base.delete(c, id); }
  increment(c: string, id: string, f: string, by: number, b?: any) { return this.base.increment(c, id, f, by, b); }
  async transaction<R>(fn: (tx: any) => Promise<R>): Promise<R> {
    const ops: Array<(s: any) => Promise<unknown>> = [];
    const now = new Date().toISOString();
    const tx: any = {
      backend: "memory",
      get: (c: string, id: string) => this.base.get(c, id),
      getOrThrow: (c: string, id: string) => this.base.getOrThrow(c, id),
      list: (c: string, o?: any) => this.base.list(c, o),
      create: async (c: string, d: any, id?: string) => {
        const docId = id ?? Math.random().toString(16).slice(2);
        ops.push((s) => s.create(c, d, docId));
        return { id: docId, createdAt: now, updatedAt: now, ...d };
      },
      update: async (c: string, id: string, p: any) => {
        ops.push((s) => s.update(c, id, p));
        return { ...(await this.base.get(c, id)), ...p };
      },
      delete: async (c: string, id: string) => void ops.push((s) => s.delete(c, id)),
      increment: async (c: string, id: string, f: string, by: number, b?: any) => {
        ops.push((s) => s.increment(c, id, f, by, b));
        const cur = await this.base.get(c, id);
        return { ...cur, [f]: (cur?.[f] ?? 0) + by };
      },
    };
    tx.transaction = (f: any) => f(tx);
    const result = await fn(tx);
    await this.base.transaction(async (t: any) => {
      for (const op of ops) await op(t);
    });
    return result;
  }
}

describe("semântica de transação do Appwrite (leituras isoladas)", () => {
  it("baixa com tarifa, estorno, conciliação com diferença, renegociação e saldo inicial funcionam", async () => {
    const iso = new IsolatedStore(ctx.store);
    const c: Ctx = { ...ctx, store: iso as any };
    const bank = refs.accounts.banco.id;
    const before = (await ctx.store.getOrThrow("financial_accounts", bank)).balance;
    const t = await createManualTitle(c, { kind: "receivable", partyType: "customer", partyId: refs.customers.joao.id, description: "Iso", issueDate: today(), competenceDate: today(), installments: [{ amount: 10000, dueDate: today() }, { amount: 5000, dueDate: addDays(today(), 30) }], idemKey: "iso" });
    const [i1, i2] = await insts(t.id);
    const s = await settleInstallment(c, { installmentId: i1.id, date: today(), principal: 10000, interest: 100, fee: 250, accountId: bank, idemKey: "iso-s" });
    const acc = await ctx.store.getOrThrow("financial_accounts", bank);
    expect(acc.balance).toBe(before + 10100 - 250);
    const seqs = (await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", bank]], orderBy: [{ field: "seq", dir: "asc" }] })).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, k) => k + 1));
    await reverseSettlement(c, s.id, "teste");
    expect((await ctx.store.getOrThrow("financial_accounts", bank)).balance).toBe(before);
    const s2 = await settleInstallment(c, { installmentId: i1.id, date: today(), principal: 10000, accountId: bank, idemKey: "iso-s2" });
    const imp = await importBankFile(c, { accountId: bank, fileName: "i.ofx", data: ofx([{ date: today(), amount: "99.10", fitid: "ISO1", memo: "DEP" }]) });
    const tx = (await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp.import.id]] }))[0];
    const rec = await reconcile(c, { accountId: bank, bankTxIds: [tx.id], entryIds: [s2.accountEntryId], adjustment: { categoryId: refs.finCategories.tarifas.id }, idemKey: "iso-r" });
    expect(rec.difference).toBe(-90);
    await undoReconciliation(c, rec.id, "teste");
    const { renegotiate } = await import("@/domain/finance");
    const nt = await renegotiate(c, { titleId: t.id, installmentIds: [i2.id], charges: 300, discount: 0, installments: [{ amount: 2650, dueDate: addDays(today(), 30) }, { amount: 2650, dueDate: addDays(today(), 60) }], reason: "acordo", idemKey: "iso-n" });
    expect((await ctx.store.getOrThrow("installments", i2.id)).status).toBe("renegotiated");
    expect((await ctx.store.getOrThrow("titles", t.id)).status).toBe("paid");
    expect((await insts(nt.id)).map((x) => x.amount)).toEqual([2650, 2650]);
    await changeInitialBalance(c, bank, { initialBalance: refs.accounts.banco.initialBalance + 100, initialBalanceDate: refs.accounts.banco.initialBalanceDate, reason: "teste" });
    const rb = await rebuildRunningBalances(ctx.store, bank);
    expect(rb.divergence).toBe(0);
    await transferBetweenAccounts(c, { fromAccountId: bank, toAccountId: refs.accounts.pix.id, amount: 1000, date: today(), description: "t", idemKey: "iso-t" });
    expect((await rebuildRunningBalances(ctx.store, bank)).divergence).toBe(0);
  });
});
