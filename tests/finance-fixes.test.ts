import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import fs from "node:fs";
import path from "node:path";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import {
  approvePayable, buildSchedule, cancelTitle, createManualTitle, createTitle, findInstallmentByCollectionRef, normalizeOurNumber, renegotiate, reverseSettlement, settleInstallment,
  termFinancedTotal, transferBetweenAccounts, undoRenegotiation, updateInstallment,
} from "@/domain/finance";
import { importBankFile, settleFromBankTx, undoReconciliation } from "@/domain/reconciliation";
import { computeCashflow, computeCompetence } from "@/domain/cashflow";
import { percentTextToBps } from "@/app/(app)/financeiro/cadastros/percent";

const fx = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));

let refs: DemoRefs;
let ctx: Ctx;
const bal = async (accountId: string) => (await ctx.store.getOrThrow("financial_accounts", accountId)).balance as number;
const insts = (titleId: string) => listAll(ctx.store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number", dir: "asc" }] });
const title = (id: string) => ctx.store.getOrThrow("titles", id);
const other = (): Ctx => ({ ...ctx, companyId: "OTHER" });

function ofx(rows: Array<{ date: string; amount: string; fitid: string; memo: string }>) {
  const body = rows.map((r) => `<STMTTRN><TRNTYPE>${r.amount.startsWith("-") ? "DEBIT" : "CREDIT"}<DTPOSTED>${r.date.replace(/-/g, "")}<TRNAMT>${r.amount}<FITID>${r.fitid}<MEMO>${r.memo}</STMTTRN>`).join("\n");
  return Buffer.from(`OFXHEADER:100\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>341<ACCTID>12345-6</BANKACCTFROM><BANKTRANLIST>\n${body}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);
}

async function receivable(amounts: number[], key: string, categoryId: string | null = refs.finCategories.servicos.id, due?: string[]) {
  return createManualTitle(ctx, {
    kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: `Serviço ${key}`, issueDate: today(), competenceDate: today(),
    categoryId, installments: amounts.map((amount, i) => ({ amount, dueDate: due?.[i] ?? addDays(today(), 30 * (i + 1)) })), idemKey: key,
  });
}

async function otherAccount() {
  return ctx.store.create("financial_accounts", { companyId: "OTHER", name: "Conta da outra empresa", kind: "bank", balance: 0, seq: 0, initialBalance: 0, initialBalanceDate: today(), active: true });
}

beforeEach(async () => {
  const store = freshStore();
  refs = await seedBase(store);
  ctx = await refs.ctxFor("finance", "matriz");
});

describe("isolamento por empresa nas baixas, estornos e autorizações", () => {
  it("baixa recusa conta financeira de outra empresa e não altera o saldo dela", async () => {
    const t = await receivable([10000], "x-acc");
    const [i] = await insts(t.id);
    const acc = await otherAccount();
    await expect(settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 10000, accountId: acc.id, idemKey: "x-acc-s" })).rejects.toThrow(/Conta financeira inválida/);
    expect((await ctx.store.getOrThrow("financial_accounts", acc.id)).balance).toBe(0);
    expect(await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", acc.id]] })).toHaveLength(0);
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ paid: 0, balance: 10000, status: "open" });
    // mesma proteção em todos os chamadores de postEntry (transferência)
    await expect(transferBetweenAccounts(ctx, { fromAccountId: refs.accounts.banco.id, toAccountId: acc.id, amount: 100, date: today(), description: "x", idemKey: "x-tr" })).rejects.toThrow(/Conta financeira inválida/);
    expect((await ctx.store.getOrThrow("financial_accounts", acc.id)).balance).toBe(0);
  });

  it("estorno e cancelamento com contexto de outra empresa são recusados sem efeito", async () => {
    const t = await receivable([10000], "x-rev");
    const [i] = await insts(t.id);
    const bank = refs.accounts.banco.id;
    const s = await settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 10000, accountId: bank, idemKey: "x-rev-s" });
    const before = await bal(bank);
    await expect(reverseSettlement(other(), s.id, "fraude")).rejects.toThrow(/outra empresa/);
    expect((await ctx.store.getOrThrow("settlements", s.id)).status).toBe("active");
    expect(await bal(bank)).toBe(before);
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ paid: 10000, balance: 0, status: "paid" });
    const t2 = await receivable([5000], "x-cancel");
    await expect(cancelTitle(other(), t2.id, "x")).rejects.toThrow(/outra empresa/);
    expect((await title(t2.id)).status).toBe("open");
  });

  it("autorização de conta a pagar confere a empresa e recusa título cancelado", async () => {
    const p = await createManualTitle(ctx, { kind: "payable", partyType: "other", partyName: "Fornecedor X", description: "Serviço", issueDate: today(), competenceDate: today(), installments: [{ amount: 5000, dueDate: today() }], idemKey: "x-pay" });
    await expect(approvePayable(other(), p.id)).rejects.toThrow(/outra empresa/);
    expect((await title(p.id)).approvalStatus).toBe("pending");
    await cancelTitle(ctx, p.id, "lançado em duplicidade");
    await expect(approvePayable(ctx, p.id)).rejects.toThrow(/cancelado/);
    expect((await title(p.id)).approvalStatus).toBe("pending");
  });
});

describe("renegociação: estorno, concorrência, duplicidade e desfazer", () => {
  it("estorno de baixa de parcela renegociada é recusado; depois de desfazer a renegociação, o estorno fecha os valores", async () => {
    const t = await receivable([10000], "rn-rev");
    const [i] = await insts(t.id);
    const bank = refs.accounts.banco.id;
    const s = await settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 4000, accountId: bank, idemKey: "rn-rev-s" });
    const nt = await renegotiate(ctx, { titleId: t.id, installmentIds: [i.id], charges: 0, discount: 0, installments: [{ amount: 6000, dueDate: addDays(today(), 30) }], reason: "acordo", idemKey: "rn-rev-n" });
    expect(nt.total).toBe(6000);
    const bankBefore = await bal(bank);
    await expect(reverseSettlement(ctx, s.id, "cheque devolvido")).rejects.toThrow(/renegociada no título nº \d+.*Desfaça antes a renegociação/);
    // nada mudou: dívida total continua R$ 100,00 (R$ 40 pagos + R$ 60 no título novo)
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ status: "renegotiated", balance: 0, paid: 4000 });
    expect((await title(t.id)).balance).toBe(0);
    expect((await title(nt.id)).balance).toBe(6000);
    expect((await ctx.store.getOrThrow("settlements", s.id)).status).toBe("active");
    expect(await bal(bank)).toBe(bankBefore);
    // desfaz a renegociação → parcela volta parcial com o saldo anterior → estorno permitido
    await undoRenegotiation(ctx, nt.id, "acordo lançado errado");
    expect(await title(nt.id)).toMatchObject({ status: "cancelled", balance: 0 });
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ status: "partial", balance: 6000, paid: 4000 });
    expect(await title(t.id)).toMatchObject({ balance: 6000, status: "partial" });
    await reverseSettlement(ctx, s.id, "cheque devolvido");
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ status: "open", balance: 10000, paid: 0 });
    expect(await title(t.id)).toMatchObject({ balance: 10000, status: "open" });
    expect((await insts(nt.id)).every((x) => x.status === "cancelled" && x.balance === 0)).toBe(true);
    expect(await bal(bank)).toBe(bankBefore - 4000);
  });

  it("renegociação concorrente com baixa da mesma parcela: só uma é gravada e a dívida nunca dobra", async () => {
    for (const round of [1, 2, 3]) {
      const t = await receivable([10000, 10000], `rn-conc-${round}`);
      const [i1] = await insts(t.id);
      const results = await Promise.allSettled([
        settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 4000, accountId: refs.accounts.banco.id, idemKey: `rn-conc-s-${round}` }),
        renegotiate(ctx, { titleId: t.id, installmentIds: [i1.id], charges: 0, discount: 0, installments: [{ amount: 10000, dueDate: addDays(today(), 30) }], reason: "acordo", idemKey: `rn-conc-n-${round}` }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const cur = await ctx.store.getOrThrow("installments", i1.id);
      const reneg = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", t.id]] })).filter((x) => x.status !== "cancelled");
      // valor da parcela 1 = pago + saldo + renegociado = R$ 100,00 exatamente
      const renegotiated = reneg.reduce((a, x) => a + x.total, 0);
      expect(cur.paid + cur.balance + renegotiated).toBe(10000);
      if (results[0].status === "fulfilled") expect(cur).toMatchObject({ status: "partial", paid: 4000, balance: 6000 });
      else expect(cur).toMatchObject({ status: "renegotiated", paid: 0, balance: 0 });
    }
  });

  it("baixa gravada entre a conferência e o commit do cancelamento: o cancelamento é recusado", async () => {
    // injeta a baixa logo depois da leitura (desatualizada) das baixas ativas feita pelo cancelamento
    const raceCtx = (nth: number, inject: () => Promise<unknown>): Ctx => {
      let calls = 0;
      const base = ctx.store as any;
      const store = new Proxy(base, {
        get(target, prop) {
          if (prop === "list")
            return async (collection: string, opts: any) => {
              const res = await target.list(collection, opts);
              if (collection === "settlements" && (opts?.filters ?? []).some((f: any) => f[1] === "titleId") && ++calls === nth) await inject();
              return res;
            };
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      return { ...ctx, store };
    };
    const points = process.env.MEMORY_TX_MODE === "deferred" ? [1, 2] : [1];
    for (const nth of points) {
      const t = await receivable([10000, 10000], `cx-race-${nth}`);
      const [i1] = await insts(t.id);
      const inject = () => settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 4000, accountId: refs.accounts.banco.id, idemKey: `cx-race-s-${nth}` });
      await expect(cancelTitle(raceCtx(nth, inject), t.id, "duplicado")).rejects.toThrow(/baixas ativas/);
      expect(await title(t.id)).toMatchObject({ status: "partial", balance: 16000 });
      expect(await ctx.store.getOrThrow("installments", i1.id)).toMatchObject({ status: "partial", balance: 6000 });
    }
  });

  it("cancelamento concorrente com baixa: só um vence e o título nunca fica cancelado com baixa ativa", async () => {
    for (const round of [1, 2, 3]) {
      const t = await receivable([10000, 10000], `cx-conc-${round}`);
      const [i1] = await insts(t.id);
      const results = await Promise.allSettled([
        settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 4000, accountId: refs.accounts.banco.id, idemKey: `cx-conc-s-${round}` }),
        cancelTitle(ctx, t.id, "duplicado"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const tt = await title(t.id);
      const active = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", t.id], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
      if (tt.status === "cancelled") {
        expect(active).toHaveLength(0);
        expect((await insts(t.id)).every((x) => x.status === "cancelled" && x.balance === 0)).toBe(true);
      } else {
        expect(active).toHaveLength(1);
        expect(tt.balance).toBe(16000);
        expect((results[1] as PromiseRejectedResult).reason.message).toMatch(/baixas ativas/);
      }
    }
  });

  it("ids de parcela repetidos são recusados (sem dobrar o saldo renegociado)", async () => {
    const t = await receivable([5000], "rn-dup");
    const [i] = await insts(t.id);
    await expect(
      renegotiate(ctx, { titleId: t.id, installmentIds: [i.id, i.id], charges: 0, discount: 0, installments: [{ amount: 10000, dueDate: addDays(today(), 30) }], reason: "x", idemKey: "rn-dup-n" }),
    ).rejects.toThrow(/repetida/);
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ status: "open", balance: 5000 });
    expect((await title(t.id)).balance).toBe(5000);
    expect(await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", t.id]] })).toHaveLength(0);
  });

  it("desfazer renegociação: recusado com recebimento no título novo; cancela o novo e restaura as parcelas quando permitido", async () => {
    const t = await receivable([10000, 8000, 6000], "rn-undo");
    const [i1, i2, i3] = await insts(t.id);
    await settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 10000, accountId: refs.accounts.banco.id, idemKey: "rn-undo-s1" });
    await settleInstallment(ctx, { installmentId: i2.id, date: today(), principal: 3000, accountId: refs.accounts.banco.id, idemKey: "rn-undo-s2" });
    const nt = await renegotiate(ctx, { titleId: t.id, installmentIds: [i2.id, i3.id], charges: 1000, discount: 0, installments: [{ amount: 6000, dueDate: addDays(today(), 30) }, { amount: 6000, dueDate: addDays(today(), 60) }], reason: "acordo", idemKey: "rn-undo-n" });
    expect(await title(t.id)).toMatchObject({ balance: 0 });
    const [n1] = await insts(nt.id);
    const sn = await settleInstallment(ctx, { installmentId: n1.id, date: today(), principal: 1000, accountId: refs.accounts.banco.id, idemKey: "rn-undo-sn" });
    await expect(undoRenegotiation(ctx, nt.id, "erro")).rejects.toThrow(/recebimento/);
    await reverseSettlement(ctx, sn.id, "erro");
    await undoRenegotiation(ctx, nt.id, "condições digitadas erradas");
    expect(await title(nt.id)).toMatchObject({ status: "cancelled", balance: 0 });
    expect(await ctx.store.getOrThrow("installments", i2.id)).toMatchObject({ status: "partial", balance: 5000, paid: 3000 });
    expect(await ctx.store.getOrThrow("installments", i3.id)).toMatchObject({ status: "open", balance: 6000, paid: 0 });
    expect(await title(t.id)).toMatchObject({ balance: 11000, status: "partial" });
    // repetir é idempotente; a parcela restaurada volta a aceitar baixa
    await undoRenegotiation(ctx, nt.id, "repetição");
    expect((await title(t.id)).balance).toBe(11000);
    await settleInstallment(ctx, { installmentId: i3.id, date: today(), principal: 6000, accountId: refs.accounts.banco.id, idemKey: "rn-undo-s3" });
    expect((await title(t.id)).balance).toBe(5000);
  });
});

describe("conciliação: baixar parcela de novo após desfazer", () => {
  it("depois de desfazer a conciliação e estornar, 'Baixar parcela' na mesma linha cria baixa nova e concilia", async () => {
    const bank = refs.accounts.banco.id;
    const t1 = await receivable([10000], "bt-1");
    const t2 = await receivable([20000], "bt-2");
    const [a] = await insts(t1.id);
    const [b] = await insts(t2.id);
    const imp = await importBankFile(ctx, { accountId: bank, fileName: "e.ofx", data: ofx([{ date: today(), amount: "100.00", fitid: "BT1", memo: "DEPOSITO" }]) });
    const tx = (await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp.import.id]] }))[0];
    const r1 = await settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: a.id, principal: 10000 });
    expect(r1.reconciliation.status).toBe("active");
    // desfaz sem estornar: outra parcela é recusada; a mesma parcela reaproveita a baixa ativa e concilia de novo
    await undoReconciliation(ctx, r1.reconciliation.id, "conferência");
    await expect(settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: b.id, principal: 10000 })).rejects.toThrow(/já gerou a baixa da parcela/);
    const again = await settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: a.id, principal: 10000 });
    expect(again.reused).toBe(true);
    expect(again.settlement.id).toBe(r1.settlement.id);
    expect(again.reconciliation.id).not.toBe(r1.reconciliation.id);
    expect(again.reconciliation.status).toBe("active");
    // desfaz + estorna → baixa outra parcela: efetivamente baixa e concilia
    await undoReconciliation(ctx, again.reconciliation.id, "parcela errada");
    await reverseSettlement(ctx, r1.settlement.id, "parcela errada");
    const before = await bal(bank);
    const r2 = await settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: b.id, principal: 10000 });
    expect(r2.reused).toBe(false);
    expect(r2.settlement.id).not.toBe(r1.settlement.id);
    expect(r2.settlement).toMatchObject({ status: "active", installmentId: b.id });
    expect(r2.reconciliation.status).toBe("active");
    expect(await ctx.store.getOrThrow("installments", b.id)).toMatchObject({ status: "partial", balance: 10000 });
    expect(await ctx.store.getOrThrow("installments", a.id)).toMatchObject({ status: "open", balance: 10000 });
    expect(await ctx.store.getOrThrow("bank_transactions", tx.id)).toMatchObject({ status: "reconciled", settlementId: r2.settlement.id, installmentId: b.id });
    expect(await bal(bank)).toBe(before + 10000);
    // repetição (duplo clique) devolve o mesmo resultado
    const r3 = await settleFromBankTx(ctx, { bankTxId: tx.id, installmentId: b.id, principal: 10000 });
    expect(r3.settlement.id).toBe(r2.settlement.id);
  });
});

describe("relatórios do financeiro", () => {
  it("competência: tarifa de baixa estornada deixa de contar como despesa", async () => {
    const m = today().slice(0, 7);
    const base = await computeCompetence(ctx, { fromMonth: m, toMonth: m });
    const exp0 = base.byMonth[0].expense;
    const t = await receivable([10000], "cp-fee");
    const [i] = await insts(t.id);
    const s = await settleInstallment(ctx, { installmentId: i.id, date: today(), principal: 10000, fee: 350, accountId: refs.accounts.banco.id, idemKey: "cp-fee-s" });
    expect((await computeCompetence(ctx, { fromMonth: m, toMonth: m })).byMonth[0].expense).toBe(exp0 - 350);
    await reverseSettlement(ctx, s.id, "estorno");
    const after = await computeCompetence(ctx, { fromMonth: m, toMonth: m });
    expect(after.byMonth[0].expense).toBe(exp0);
    expect(after.byMonth[0].result).toBe(base.byMonth[0].result + 10000);
    // a categoria de tarifas fecha em zero (o estorno não cai na categoria de receita do título)
    const fees = after.rows.find((r) => r.type === "expense" && r.categoryId === refs.finCategories.tarifas.id);
    expect(fees?.total ?? 0).toBe(0);
  });

  it("detalhamento por categoria: 'Sem categoria' e categoria padrão de vendas listam as parcelas que formam o número", async () => {
    const { queryCashflowMovements, queryInstallments } = await import("@/app/(app)/financeiro/queries");
    const due = addDays(today(), 5);
    await receivable([7700], "cat-none", null, [due]);
    // título de venda sem categoria → categoria padrão de vendas
    await createTitle(ctx, { kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: "Venda nº 999", originType: "sale", installments: [{ amount: 4400, dueDate: due }], idemKey: "cat-sale" });
    const f = { from: today(), to: addDays(today(), 10), granularity: "day" as const, branchId: null };
    const none = await computeCashflow(ctx, { ...f, categoryId: "none" });
    expect(none.totals.forecastIn).toBe(7700);
    const sales = await computeCashflow(ctx, { ...f, categoryId: refs.finCategories.vendas.id });
    expect(sales.totals.forecastIn).toBe(4400);
    const pf = { from: f.from, to: f.to };
    const movNone = await queryCashflowMovements(ctx, { q: "", f: { ...pf, category: "none" } });
    expect(movNone.rows.filter((r) => r.status === "forecast").map((r) => r.amount)).toEqual([7700]);
    const movSales = await queryCashflowMovements(ctx, { q: "", f: { ...pf, category: refs.finCategories.vendas.id } });
    expect(movSales.rows.filter((r) => r.status === "forecast").map((r) => r.amount)).toEqual([4400]);
    const listSales = await queryInstallments(ctx, "receivable", { q: "", f: { category: refs.finCategories.vendas.id, compFrom: today(), compTo: today(), competence: "1" } });
    expect(listSales.map((r) => r.amount)).toEqual([4400]);
    const listNone = await queryInstallments(ctx, "receivable", { q: "", f: { category: "none", compFrom: today(), compTo: today() } });
    expect(listNone.map((r) => r.amount)).toEqual([7700]);
  });
});

describe("cadastros e cobrança", () => {
  it("percentual aceita ponto ou vírgula decimal", () => {
    expect(percentTextToBps("1.5")).toBe(150);
    expect(percentTextToBps("1,5")).toBe(150);
    expect(percentTextToBps("0.5")).toBe(50);
    expect(percentTextToBps("2,99")).toBe(299);
    expect(percentTextToBps("1.234,5")).toBe(123450);
    expect(percentTextToBps("")).toBe(0);
    expect(percentTextToBps("1.2.3")).toBeNull();
  });

  it("juros da condição de parcelamento são aplicados ao valor parcelado quando informados", () => {
    expect(termFinancedTotal(30000, 500)).toBe(31500);
    expect(termFinancedTotal(30000, 0)).toBe(30000);
    const sched = buildSchedule(30000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-01-10", { interestBps: 500 });
    expect(sched.map((x) => x.amount)).toEqual([10500, 10500, 10500]);
    expect(buildSchedule(30000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-01-10").reduce((a, x) => a + x.amount, 0)).toBe(30000);
    expect(buildSchedule(10001, { installments: 3, firstDueDays: 0, intervalDays: 30 }, "2026-01-10", { interestBps: 333 }).reduce((a, x) => a + x.amount, 0)).toBe(10001 + 333);
  });

  it("nosso número com zeros à esquerda casa com o retorno CNAB", async () => {
    expect(normalizeOurNumber("00054321")).toBe("54321");
    expect(normalizeOurNumber("109/00054321-5")).toBe("54321");
    expect(normalizeOurNumber(" 12.345.678-9 ")).toBe("12345678");
    const t = await receivable([20000], "cnab-zero", refs.finCategories.servicos.id, [addDays(today(), -5)]);
    const [i] = await insts(t.id);
    await updateInstallment(ctx, i.id, { ourNumber: "00054321" });
    expect((await ctx.store.getOrThrow("installments", i.id)).ourNumber).toBe("54321");
    const imp = await importBankFile(ctx, { accountId: refs.accounts.banco.id, fileName: "itau.ret", data: fx("retorno-cobranca-itau.cnab400.ret") });
    const tx = (await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", imp.import.id], ["eq", "kind", "collection"]] }))[0];
    expect(tx.installmentId).toBe(i.id);
    // gravação antiga (com zeros) também é localizada
    await ctx.store.update("installments", i.id, { ourNumber: "00054321" });
    expect((await findInstallmentByCollectionRef(ctx.store, ctx.companyId, { ourNumber: "54321" }))?.id).toBe(i.id);
  });
});
