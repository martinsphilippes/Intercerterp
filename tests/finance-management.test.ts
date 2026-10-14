import { describe, it, expect, beforeAll } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { seedDemo } from "@/domain/seed";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, addMonths, monthEnd, monthStart, today } from "@/lib/dates";
import { pct } from "@/lib/money";
import { FEATURE_DEFAULTS, setSetting } from "@/lib/core/settings";
import { ACTIONS_ADDED_TO_TEMPLATES } from "@/lib/auth/role-sync";
import { DEFAULT_ROLES, FIRM_ROLES, SPECIAL_ACTIONS } from "@/lib/permissions";
import { PARAM_MAP } from "@/app/(app)/administracao/parametros/catalog";
import { NAV } from "@/components/shell/nav";
import {
  createAccountEntry, createManualTitle, createTitle, reverseSettlement, saveCostCenter, saveFinCategory, savePaymentMethod, settleInstallment, transferBetweenAccounts, updateTitle,
} from "@/domain/finance";
import { openSession } from "@/domain/cash";
import { finalizeSale } from "@/domain/sales";
import { findFeeRow, normalizeBrand, resolveCardFee, validateFeeTable } from "@/domain/card-fees";
import { parseAcquirerCsv, parseInstallment, sniffAcquirerCsv } from "@/domain/bank/acquirer";
import { applyAcquirerFile, previewAcquirerFile } from "@/domain/card-reconciliation";
import { closeHistory, periodCloseState, setClosedUntil } from "@/domain/period-close";
import { effectiveDreGroup, flattenTree } from "@/domain/chart-of-accounts";
import { agingBucket, computeAging, computeDre } from "@/domain/finance-reports";
import { computeCompetence } from "@/domain/cashflow";
import { reportTotals } from "@/domain/reports";
import { acquirerCsvLine, ACQUIRER_CSV_HEADER } from "@/domain/seed/modules/finance-management";

/** Fase 7 — gestão financeira: taxas de cartão (FIN-24), plano de contas/DRE/aging (FIN-19/22) e fechamento (FIN-21). */

let store: Store;
let refs: DemoRefs;
let fin: Ctx;
let cashier: Ctx;
let seq = 0;

const T0 = today();
const BONE = 4490; // preço do boné (bone-u) na tabela de varejo da demonstração
const insts = (titleId: string) => listAll(store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number", dir: "asc" }] });
const cardTitleOf = async (saleId: string) => (await listAll(store, "titles", { filters: [["eq", "originType", "sale_card"], ["eq", "originId", saleId]] }))[0];
const payOf = async (saleId: string) => (await listAll(store, "sale_payments", { filters: [["eq", "saleId", saleId]] }))[0];

async function cardSale(method: "credito" | "debito", opts: { brand?: string | null; installments?: number; nsu: string; qty?: number }) {
  const qty = opts.qty ?? 1;
  return finalizeSale(cashier, {
    idemKey: `fm-sale-${++seq}`, terminalId: refs.terminals.cx1.id, items: [{ skuId: refs.skus["bone-u"].id, qty: qty * 1000 }],
    payments: [{ methodId: refs.methods[method].id, amount: BONE * qty, installments: opts.installments ?? 1, nsu: opts.nsu, cardBrand: opts.brand ?? null }],
  });
}

async function setFeeTable(method: "credito" | "debito", table: unknown) {
  const m = await store.getOrThrow("payment_methods", refs.methods[method].id);
  return savePaymentMethod(fin, m.id, {
    name: m.name, kind: m.kind, accountId: m.accountId, feeBps: m.feeBps, settlementDays: m.settlementDays, allowsChange: Boolean(m.allowsChange), requiresCustomer: Boolean(m.requiresCustomer),
    availablePdv: m.availablePdv !== false, maxInstallments: m.maxInstallments ?? 1, sortOrder: m.sortOrder, active: m.active !== false, feeTable: table,
  });
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  fin = await refs.ctxFor("finance", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  await openSession(cashier, { terminalId: refs.terminals.cx1.id, openingFund: 0 });
}, 120000);

describe("taxas de cartão por bandeira e parcelas (FIN-24)", () => {
  it("funções puras: bandeira normalizada, linha específica antes da genérica, sem linha = taxa do meio", () => {
    expect(normalizeBrand(" master ")).toBe("MASTERCARD");
    expect(normalizeBrand("Américan Express")).toBe("AMERICANEXPRESS");
    const table = validateFeeTable([
      { brand: "Visa", minInstallments: 2, maxInstallments: 6, feeBps: 400, settlementDays: 30 },
      { brand: "", minInstallments: 2, maxInstallments: 6, feeBps: 500, settlementDays: 45 },
      { brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 200, settlementDays: 15 },
    ], 6);
    expect(findFeeRow(table, "VISA", 3)?.feeBps).toBe(400);
    expect(findFeeRow(table, "Elo", 3)?.feeBps).toBe(500);
    expect(findFeeRow(table, "Elo", 1)).toBeNull();
    expect(resolveCardFee({ feeBps: 309, settlementDays: 30, feeTable: table }, "Elo", 1)).toMatchObject({ feeBps: 309, settlementDays: 30, source: "method" });
    expect(resolveCardFee({ feeBps: 309, settlementDays: 30, feeTable: table }, "Visa", 3, false)).toMatchObject({ feeBps: 309, source: "method" });
    expect(() => validateFeeTable([{ brand: "Visa", minInstallments: 1, maxInstallments: 3, feeBps: 100 }, { brand: "VISA", minInstallments: 3, maxInstallments: 6, feeBps: 200 }], 6)).toThrow(/sobrepostas/);
    expect(() => validateFeeTable([{ brand: "Visa", minInstallments: 1, maxInstallments: 12, feeBps: 100 }], 6)).toThrow(/faixa/);
    expect(() => validateFeeTable([{ brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 2500 }], 6)).toThrow(/20%/);
  });

  it("sem tabela a venda segue a regra atual (taxa e prazo únicos do meio, nenhum campo novo)", async () => {
    const sale = await cardSale("credito", { brand: "Visa", installments: 3, nsu: "100001" });
    const pay = await payOf(sale.id);
    expect(pay.feeAmount).toBe(pct(BONE, 309));
    expect(pay.feeBps ?? null).toBeNull();
    expect(pay.feeRule ?? null).toBeNull();
    const t = await cardTitleOf(sale.id);
    expect((await insts(t.id))[0].dueDate).toBe(addDays(T0, 30));
  });

  it("com tabela: taxa e prazo pela bandeira × parcelas; bandeira sem linha usa a genérica; sem linha nenhuma, a do meio", async () => {
    await setFeeTable("credito", [
      { brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 200, settlementDays: 15 },
      { brand: "Visa", minInstallments: 2, maxInstallments: 6, feeBps: 400, settlementDays: 30 },
      { brand: null, minInstallments: 2, maxInstallments: 6, feeBps: 500, settlementDays: 45 },
    ]);
    const visa3 = await cardSale("credito", { brand: "visa", installments: 3, nsu: "100002" });
    const p1 = await payOf(visa3.id);
    expect(p1.feeAmount).toBe(pct(BONE, 400));
    expect(p1.feeBps).toBe(400);
    expect(p1.feeRule).toMatch(/VISA 2–6x/);
    expect((await insts((await cardTitleOf(visa3.id)).id)).map((i) => i.dueDate)).toEqual([addDays(T0, 30), addMonths(addDays(T0, 30), 1), addMonths(addDays(T0, 30), 2)]);
    const visa1 = await cardSale("credito", { brand: "Visa", installments: 1, nsu: "100003" });
    expect((await payOf(visa1.id)).feeAmount).toBe(pct(BONE, 200));
    expect((await insts((await cardTitleOf(visa1.id)).id))[0].dueDate).toBe(addDays(T0, 15));
    const master2 = await cardSale("credito", { brand: "Master", installments: 2, nsu: "100004" });
    expect((await payOf(master2.id)).feeAmount).toBe(pct(BONE, 500));
    expect((await insts((await cardTitleOf(master2.id)).id))[0].dueDate).toBe(addDays(T0, 45));
    const elo1 = await cardSale("credito", { brand: "Elo", installments: 1, nsu: "100005" });
    const pe = await payOf(elo1.id);
    expect(pe.feeAmount).toBe(pct(BONE, 309));
    expect(pe.feeBps ?? null).toBeNull();
    // a taxa prevista do recebível (cartões, fluxo previsto) vem do pagamento da venda
    expect((await store.getOrThrow("titles", (await cardTitleOf(visa3.id)).id)).notes).toMatch(/tabela VISA/);
  });

  it("recurso desligado: a tabela é ignorada na venda; religado volta a valer", async () => {
    await setSetting(store, fin.companyId, null, "feature.taxasCartao", false);
    try {
      const s = await cardSale("credito", { brand: "Visa", installments: 3, nsu: "100006" });
      expect((await payOf(s.id)).feeAmount).toBe(pct(BONE, 309));
    } finally {
      await setSetting(store, fin.companyId, null, "feature.taxasCartao", true);
    }
    const s2 = await cardSale("credito", { brand: "Visa", installments: 3, nsu: "100007" });
    expect((await payOf(s2.id)).feeAmount).toBe(pct(BONE, 400));
  });

  it("tabela só para cartões e removível (volta à taxa única)", async () => {
    const pix = await store.getOrThrow("payment_methods", refs.methods.pix.id);
    await expect(
      savePaymentMethod(fin, pix.id, { name: pix.name, kind: "pix", accountId: pix.accountId, feeBps: 0, settlementDays: 0, allowsChange: false, requiresCustomer: false, availablePdv: true, maxInstallments: 1, feeTable: [{ brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 100 }] }),
    ).rejects.toThrow(/só para cartões/);
    await setFeeTable("debito", [{ brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 99, settlementDays: 0 }]);
    expect((await store.getOrThrow("payment_methods", refs.methods.debito.id)).feeTable).toHaveLength(1);
  });
});

describe("conciliação com o arquivo da adquirente (FIN-24)", () => {
  let saleA: Doc;
  let saleB: Doc;
  let saleC: Doc;
  let manualTitle: Doc;
  let csv: string;
  const fee = (gross: number) => pct(gross, 99);

  beforeAll(async () => {
    // débito Visa com crédito no mesmo dia (tabela: 0,99% em 0 dia) → recebíveis com previsão hoje
    saleA = await cardSale("debito", { brand: "Visa", nsu: "552001" });
    saleB = await cardSale("debito", { brand: "Visa", nsu: "552002" });
    saleC = await cardSale("debito", { brand: "Visa", nsu: "552003" });
    // recebível de crédito antigo (2x) com NSU no documento: parcela 1 vencida, parcela 2 futura
    manualTitle = await createTitle(fin, {
      kind: "receivable", partyType: "other", partyName: "Adquirente — Cartão de crédito", description: "Recebível de cartão — venda antiga", documentNumber: "000774411", originType: "sale_card",
      issueDate: addDays(T0, -40), competenceDate: addDays(T0, -40), installments: [{ dueDate: addDays(T0, -10), amount: 6000, methodKind: "credit" }, { dueDate: addDays(T0, 20), amount: 6000, methodKind: "credit" }], idemKey: "fm-old-card",
    });
    csv = [
      ACQUIRER_CSV_HEADER,
      acquirerCsvLine({ saleDate: T0, nsu: "552001", brand: "Visa", parcel: "1/1", gross: BONE, fee: fee(BONE), creditDate: T0 }),
      acquirerCsvLine({ saleDate: T0, nsu: "552002", brand: "Visa", parcel: "1/1", gross: BONE, fee: fee(BONE) + 5, creditDate: T0 }),
      acquirerCsvLine({ saleDate: addDays(T0, -40), nsu: "774411", brand: "Mastercard", parcel: "1/2", gross: 6000, fee: 210, creditDate: addDays(T0, -9) }),
      acquirerCsvLine({ saleDate: addDays(T0, -40), nsu: "774411", brand: "Mastercard", parcel: "2/2", gross: 6000, fee: 210, creditDate: addDays(T0, 20) }),
      acquirerCsvLine({ saleDate: T0, nsu: "999999", brand: "Elo", parcel: "1/1", gross: 1000, fee: 13, creditDate: T0 }),
      acquirerCsvLine({ saleDate: T0, nsu: "552003", brand: "Visa", parcel: "1/1", gross: BONE + 100, fee: fee(BONE + 100), creditDate: T0 }),
      acquirerCsvLine({ saleDate: T0, nsu: "552001", brand: "Visa", parcel: "1/1", gross: BONE, fee: fee(BONE), creditDate: T0 }),
      `xx/yy/zzzz;552009;;Visa;1/1;abc;1,00;;${T0}`,
      "Total;;;;;;;;",
    ].join("\r\n");
  });

  it("leitor CSV configurável: colunas pelo cabeçalho, parcela k/n, taxa em % e líquido calculado", () => {
    const sniff = sniffAcquirerCsv(csv);
    expect(sniff.delimiter).toBe(";");
    expect(sniff.guess).toMatchObject({ hasHeader: true, saleDate: 0, nsu: 1, authCode: 2, brand: 3, installments: 4, gross: 5, fee: 6, net: 7, creditDate: 8, decimal: "," });
    const r = parseAcquirerCsv(csv, sniff.guess);
    expect(r.lines).toHaveLength(7);
    expect(r.issues.map((i) => i.status).sort()).toEqual(["info", "invalid"]);
    expect(r.lines[2]).toMatchObject({ nsu: "774411", installment: 1, installments: 2, gross: 6000, fee: 210, net: 5790, creditDate: addDays(T0, -9) });
    expect(parseInstallment("2 de 3")).toEqual({ k: 2, n: 3 });
    expect(parseInstallment("à vista")).toEqual({ k: 1, n: 1 });
    const pctFile = "NSU;Valor bruto;Taxa;Data de crédito\n123;100,00;3,5%;01/02/2026\n";
    const p2 = parseAcquirerCsv(pctFile, sniffAcquirerCsv(pctFile).guess);
    expect(p2.lines[0]).toMatchObject({ gross: 10000, fee: 350, net: 9650, creditDate: "2026-02-01" });
  });

  it("prévia casa por NSU/parcela e lista as divergências sem gravar nada", async () => {
    const before = (await listAll(store, "settlements")).length;
    const pv = await previewAcquirerFile(fin, { accountId: refs.accounts.banco.id, fileName: "adq.csv", data: Buffer.from(csv) });
    const st = pv.matches.map((m) => `${m.nsu}:${m.status}`);
    expect(st).toEqual(["552001:matched", "552002:matched", "774411:matched", "774411:future", "999999:not_found", "552003:divergent", "552001:duplicate"]);
    expect(pv.matches[1].feeDiff).toBe(5);
    expect(pv.matches[1].flags.join(" ")).toMatch(/taxa maior/);
    expect(pv.matches[2].flags.join(" ")).toMatch(/crédito 1 dia\(s\) depois/);
    expect(pv.summary.byStatus.invalid).toBe(1);
    expect((await listAll(store, "settlements")).length).toBe(before);
  });

  it("aplicar baixa os casados com a taxa do arquivo (idempotente) e grava o relatório", async () => {
    const accBefore = (await store.getOrThrow("financial_accounts", refs.accounts.banco.id)).balance;
    const r1 = await applyAcquirerFile(fin, { accountId: refs.accounts.banco.id, fileName: "adq.csv", data: Buffer.from(csv) });
    expect(r1.alreadyImported).toBe(false);
    const sum = r1.import.summary;
    expect(sum.byStatus).toMatchObject({ applied: 3, future: 1, not_found: 1, divergent: 1, duplicate: 1, invalid: 1 });
    const iA = (await insts((await cardTitleOf(saleA.id)).id))[0];
    const iB = (await insts((await cardTitleOf(saleB.id)).id))[0];
    const iC = (await insts((await cardTitleOf(saleC.id)).id))[0];
    const [old1, old2] = await insts(manualTitle.id);
    expect([iA.status, iB.status, iC.status, old1.status, old2.status]).toEqual(["paid", "paid", "open", "paid", "open"]);
    const sB = (await listAll(store, "settlements", { filters: [["eq", "installmentId", iB.id], ["eq", "status", "active"]] }))[0];
    expect(sB.fee).toBe(fee(BONE) + 5);
    expect(sB.date).toBe(T0);
    const sOld = (await listAll(store, "settlements", { filters: [["eq", "installmentId", old1.id]] }))[0];
    expect(sOld.date).toBe(addDays(T0, -9));
    const net = BONE - fee(BONE) + (BONE - fee(BONE) - 5) + (6000 - 210);
    expect((await store.getOrThrow("financial_accounts", refs.accounts.banco.id)).balance - accBefore).toBe(net);
    // reaplicar o mesmo arquivo não duplica
    const count = (await listAll(store, "settlements")).length;
    const r2 = await applyAcquirerFile(fin, { accountId: refs.accounts.banco.id, fileName: "adq-de-novo.csv", data: Buffer.from(csv) });
    expect(r2.alreadyImported).toBe(true);
    expect((await listAll(store, "settlements")).length).toBe(count);
    // outro arquivo com a mesma venda: a parcela aparece como já liquidada
    const other = [ACQUIRER_CSV_HEADER, acquirerCsvLine({ saleDate: T0, nsu: "552001", brand: "Visa", parcel: "1/1", gross: BONE, fee: fee(BONE), creditDate: T0 })].join("\n");
    const r3 = await applyAcquirerFile(fin, { accountId: refs.accounts.banco.id, fileName: "adq-2.csv", data: Buffer.from(other) });
    expect(r3.import.summary.byStatus).toEqual({ already_settled: 1 });
    expect((await listAll(store, "settlements")).length).toBe(count);
    // retentativa de uma importação interrompida: o que este arquivo já baixou é reconhecido, nada é refeito
    await store.update("bank_imports", r1.import.id, { status: "processing" });
    const r4 = await applyAcquirerFile(fin, { accountId: refs.accounts.banco.id, fileName: "adq.csv", data: Buffer.from(csv) });
    expect(r4.alreadyImported).toBe(false);
    expect(r4.import.summary.byStatus.applied).toBe(3);
    expect((await listAll(store, "settlements")).length).toBe(count);
  });
});

describe("plano de contas e centros de custo em hierarquia (FIN-19)", () => {
  it("nível pela hierarquia, código único, sem ciclo, grupo do DRE herdado e limites de nível", async () => {
    const root = await saveFinCategory(fin, null, { name: "Despesas gerais", type: "expense", dreGroup: "Despesas administrativas", code: "9.1", accountingCode: "4.9.1" });
    const child = await saveFinCategory(fin, null, { name: "Copa e limpeza", type: "expense", parentId: root.id, code: "9.1.01" });
    expect(root.level).toBe(1);
    expect(child.level).toBe(2);
    expect(child.dreGroup).toBeNull();
    const cats = await listAll(store, "fin_categories", { filters: [["eq", "companyId", fin.companyId]] });
    const byId = new Map(cats.map((c) => [c.id, c]));
    expect(effectiveDreGroup(child.id, byId as any)).toBe("Despesas administrativas");
    const flat = flattenTree(cats as any[]);
    expect(flat.find((c) => c.id === root.id)?.synthetic).toBe(true);
    expect(flat.findIndex((c) => c.id === root.id)).toBeLessThan(flat.findIndex((c) => c.id === child.id));
    await expect(saveFinCategory(fin, root.id, { name: "Despesas gerais", type: "expense", parentId: child.id })).rejects.toThrow(/ciclo/);
    await expect(saveFinCategory(fin, null, { name: "Outra", type: "expense", code: "9.1" })).rejects.toThrow(/já usado/);
    let parent = child;
    for (let lvl = 3; lvl <= 6; lvl++) parent = await saveFinCategory(fin, null, { name: `Nível ${lvl}`, type: "expense", parentId: parent.id });
    expect(parent.level).toBe(6);
    await expect(saveFinCategory(fin, null, { name: "Nível 7", type: "expense", parentId: parent.id })).rejects.toThrow(/6 níveis/);
    // a subárvore inteira não cabe abaixo de outro nível; mover um ramo curto recalcula o nível dos descendentes
    const top = await saveFinCategory(fin, null, { name: "Grupo superior", type: "expense" });
    await expect(saveFinCategory(fin, root.id, { name: "Despesas gerais", type: "expense", parentId: top.id })).rejects.toThrow(/6 níveis/);
    const a = await saveFinCategory(fin, null, { name: "Ramo A", type: "expense" });
    const b = await saveFinCategory(fin, null, { name: "Ramo B", type: "expense", parentId: a.id });
    await saveFinCategory(fin, a.id, { name: "Ramo A", type: "expense", parentId: top.id });
    expect((await store.getOrThrow("fin_categories", a.id)).level).toBe(2);
    expect((await store.getOrThrow("fin_categories", b.id)).level).toBe(3);
    const c1 = await saveCostCenter(fin, null, { name: "Operações", code: "OP" });
    const c2 = await saveCostCenter(fin, null, { name: "Lojas OP", code: "OP1", parentId: c1.id });
    const c3 = await saveCostCenter(fin, null, { name: "Loja OP 1", code: "OP11", parentId: c2.id });
    expect([c1.level, c2.level, c3.level]).toEqual([1, 2, 3]);
    await expect(saveCostCenter(fin, null, { name: "Nível 4", code: "OP111", parentId: c3.id })).rejects.toThrow(/3 níveis/);
  });
});

describe("aging de contas a receber e a pagar (FIN-22)", () => {
  it("faixas por dias de atraso na data de referência", () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(agingBucket)).toEqual(["current", "current", "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "over90", "over90"]);
  });

  it("saldo em aberto por faixa e por cliente; parcial pelo saldo; cancelado e pago fora", async () => {
    const party = "Cliente do aging (teste)";
    const t = await createManualTitle(fin, {
      kind: "receivable", partyType: "other", partyName: party, description: "Acordo aging", issueDate: addDays(T0, -150), competenceDate: addDays(T0, -150),
      installments: [5, -10, -45, -75, -120].map((d, i) => ({ dueDate: addDays(T0, d), amount: (i + 1) * 1000 })), idemKey: "fm-aging",
    });
    const list = await insts(t.id);
    await settleInstallment(fin, { installmentId: list[1].id, date: T0, principal: 500, accountId: refs.accounts.banco.id, idemKey: "fm-aging-partial" });
    const r = await computeAging(fin, { kind: "receivable", ref: T0 });
    const row = r.rows.find((x) => x.partyName === party)!;
    expect(row.buckets).toEqual({ current: 1000, d1_30: 1500, d31_60: 3000, d61_90: 4000, over90: 5000 });
    expect(row.total).toBe(14500);
    expect(row.maxDaysLate).toBe(120);
    expect(r.totals.total).toBe(Object.values(r.rows).reduce((a, x) => a + x.total, 0));
    // filtro por faixa e data de referência futura (tudo envelhece)
    const late = await computeAging(fin, { kind: "receivable", ref: addDays(T0, 30), bucket: "over90" });
    expect(late.rows.find((x) => x.partyName === party)?.total).toBe(5000 + 4000);
    const pay = await computeAging(fin, { kind: "payable", ref: T0 });
    expect(pay.rows.some((x) => x.partyName === party)).toBe(false);
  });
});

describe("fechamento de período financeiro (FIN-21)", () => {
  const closeAt = addDays(T0, -10);
  let oldSettlement: Doc;
  let oldTitle: Doc;

  it("desligado por padrão: nada é verificado e fechar é recusado", async () => {
    expect(FEATURE_DEFAULTS.fechamentoPeriodo).toBe(false);
    expect(await periodCloseState(store, fin.companyId)).toEqual({ enabled: false, closedUntil: null });
    await expect(setClosedUntil(fin, { date: closeAt })).rejects.toThrow(/desligado/);
    oldTitle = await createManualTitle(fin, {
      kind: "receivable", partyType: "other", partyName: "Cliente retroativo", description: "Serviço antigo", issueDate: addDays(T0, -30), competenceDate: addDays(T0, -30),
      installments: [{ dueDate: addDays(T0, -20), amount: 10000 }, { dueDate: addDays(T0, -15), amount: 10000 }], idemKey: "fm-close-old",
    });
    const [i1] = await insts(oldTitle.id);
    oldSettlement = await settleInstallment(fin, { installmentId: i1.id, date: addDays(T0, -12), principal: 10000, accountId: refs.accounts.banco.id, idemKey: "fm-close-old-settle" });
  });

  it("fecha com permissão e recusa lançamentos, baixas, títulos e estornos com data até o fechamento", async () => {
    await setSetting(store, fin.companyId, null, "feature.fechamentoPeriodo", true);
    await expect(setClosedUntil(cashier, { date: closeAt })).rejects.toThrow(/permissão/);
    await expect(setClosedUntil(fin, { date: T0 })).rejects.toThrow(/até ontem/);
    const r = await setClosedUntil(fin, { date: closeAt });
    expect(r).toMatchObject({ changed: true, action: "close", closedUntil: closeAt });
    const closed = /Período financeiro fechado/;
    await expect(createAccountEntry(fin, { accountId: refs.accounts.banco.id, date: addDays(T0, -11), amount: -500, kind: "fee", description: "Tarifa retroativa", idemKey: "fm-c1" })).rejects.toThrow(closed);
    const [, i2] = await insts(oldTitle.id);
    await expect(settleInstallment(fin, { installmentId: i2.id, date: closeAt, principal: 10000, accountId: refs.accounts.banco.id, idemKey: "fm-c2" })).rejects.toThrow(closed);
    await expect(
      createManualTitle(fin, { kind: "payable", partyType: "other", partyName: "Fornecedor X", description: "Despesa retroativa", issueDate: addDays(T0, -20), competenceDate: addDays(T0, -20), installments: [{ dueDate: T0, amount: 100 }], approved: true, idemKey: "fm-c3" }),
    ).rejects.toThrow(closed);
    await expect(reverseSettlement(fin, oldSettlement.id, "teste")).rejects.toThrow(closed);
    await expect(transferBetweenAccounts(fin, { fromAccountId: refs.accounts.banco.id, toAccountId: refs.accounts.pix.id, amount: 100, date: addDays(T0, -11), description: "Transf. retroativa", idemKey: "fm-c4" })).rejects.toThrow(closed);
    await expect(updateTitle(fin, oldTitle.id, { competenceDate: addDays(T0, -5) })).rejects.toThrow(closed);
    // depois do fechamento continua aberto (inclusive a venda do dia)
    await createAccountEntry(fin, { accountId: refs.accounts.banco.id, date: addDays(T0, -9), amount: -500, kind: "fee", description: "Tarifa no período aberto", idemKey: "fm-c5" });
    await settleInstallment(fin, { installmentId: i2.id, date: addDays(T0, -1), principal: 1000, accountId: refs.accounts.banco.id, idemKey: "fm-c6" });
    const s = await cardSale("credito", { brand: "Visa", installments: 1, nsu: "100099" });
    expect(s.status).toBe("completed");
  });

  it("reabertura exige motivo, é auditada e libera o lançamento retroativo", async () => {
    await expect(setClosedUntil(fin, { date: addDays(T0, -20) })).rejects.toThrow(/motivo/);
    const r = await setClosedUntil(fin, { date: addDays(T0, -20), reason: "Ajuste de tarifa pedido pelo contador" });
    expect(r.action).toBe("reopen");
    await createAccountEntry(fin, { accountId: refs.accounts.banco.id, date: addDays(T0, -11), amount: -500, kind: "fee", description: "Tarifa retroativa", idemKey: "fm-c1" });
    await expect(createAccountEntry(fin, { accountId: refs.accounts.banco.id, date: addDays(T0, -25), amount: -500, kind: "fee", description: "Ainda fechado", idemKey: "fm-c7" })).rejects.toThrow(/fechado/);
    await setClosedUntil(fin, { date: null, reason: "Reabertura total" });
    const audits = (await listAll(store, "audit_logs", { filters: [["eq", "entityType", "finance_period"]] })).map((a) => `${a.action}:${a.reason ?? ""}`);
    expect(audits).toEqual(expect.arrayContaining(["period.close:", "period.reopen:Ajuste de tarifa pedido pelo contador", "period.reopen:Reabertura total"]));
    const hist = await closeHistory(store, fin.companyId);
    expect(hist.map((h) => h.action)).toEqual(["reopen", "reopen", "close"]);
    expect(hist[1].userName).toBe(fin.user.name);
    // recurso desligado com data gravada: nada é verificado
    await setClosedUntil(fin, { date: closeAt });
    await setSetting(store, fin.companyId, null, "feature.fechamentoPeriodo", false);
    await createAccountEntry(fin, { accountId: refs.accounts.banco.id, date: addDays(T0, -30), amount: -100, kind: "fee", description: "Com o recurso desligado", idemKey: "fm-c8" });
  });
});

describe("parâmetros, permissões e menu da Fase 7", () => {
  it("recursos no catálogo, padrões, permissão nova nos modelos e itens de menu", () => {
    expect(PARAM_MAP["feature.taxasCartao"]).toMatchObject({ default: true, group: "Recursos" });
    expect(PARAM_MAP["feature.dre"]).toMatchObject({ default: true, group: "Recursos" });
    expect(PARAM_MAP["feature.fechamentoPeriodo"]).toMatchObject({ default: false, scopes: ["company"] });
    expect(FEATURE_DEFAULTS).toMatchObject({ fechamentoPeriodo: false, taxasCartao: true, dre: true });
    expect(SPECIAL_ACTIONS.some((a) => a.key === "finance.close_period")).toBe(true);
    expect(ACTIONS_ADDED_TO_TEMPLATES).toContain("finance.close_period");
    expect(DEFAULT_ROLES.find((r) => r.key === "finance")!.actions).toContain("finance.close_period");
    expect(DEFAULT_ROLES.find((r) => r.key === "admin")!.actions).toContain("finance.close_period");
    expect(DEFAULT_ROLES.find((r) => r.key === "manager")!.actions).not.toContain("finance.close_period");
    expect(FIRM_ROLES.find((r) => r.key === "firm_finance")!.actions).toContain("finance.close_period");
    const items = NAV.flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/relatorios/financeiros")).toMatchObject({ module: "finance", feature: "dre" });
    expect(items.find((i) => i.href === "/financeiro/fechamento")).toMatchObject({ module: "finance", feature: "fechamentoPeriodo" });
    expect(items.find((i) => i.href === "/financeiro/cartoes/adquirente")).toMatchObject({ module: "finance", feature: "taxasCartao" });
  });
});

describe("demonstração e DRE gerencial (FIN-22)", () => {
  it("DRE fecha com a competência para o seed; CMV pelo custo das vendas; tabela de taxas e arquivo da adquirente", async () => {
    const s2 = freshStore();
    const r = await seedDemo(s2, { historyDays: 4 });
    expect(r.done).toBe(true);
    const company = (await listAll(s2, "companies"))[0];
    const finUser = (await listAll(s2, "users")).find((u) => u.email === "financeiro@demo.intercert.local")!;
    const ctx: Ctx = { store: s2, companyId: company.id, branchId: null, user: { id: finUser.id, name: finUser.name, email: finUser.email, isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [company.id] } };
    const from = monthStart(addMonths(T0, -2));
    const to = monthEnd(T0);
    const dre = await computeDre(ctx, { from, to, branchIds: null });
    const comp = await computeCompetence(ctx, { fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7) });
    const compResult = comp.byMonth.reduce((a, m) => a + m.result, 0);
    expect(dre.check.competenceResult).toBe(compResult);
    expect(dre.check.difference).toBe(0);
    const totals = await reportTotals(s2, { companyId: company.id, branchIds: null, from, to });
    expect(dre.check.cmv).toBe(-totals.cmv);
    expect(totals.cmv).toBeGreaterThan(0);
    const sectionSum = dre.sections.reduce((a, s) => a + s.total, 0);
    expect(sectionSum).toBe(dre.subtotals.result.total);
    expect(sectionSum + dre.outside.reduce((a, s) => a + s.total, 0) - dre.check.cmv).toBe(compResult);
    for (const m of dre.months) expect(Object.values(dre.sections).reduce((a, s) => a + (s.months[m.key] ?? 0), 0)).toBe(dre.subtotals.result.months[m.key] ?? 0);
    // compras (grupo CMV) ficam fora do resultado; a subcategoria herda o grupo "Despesas administrativas"
    expect(dre.outside.find((o) => o.key === "__purchases")!.total).toBeLessThan(0);
    const adm = dre.sections.find((s) => s.key === "Despesas administrativas")!;
    expect(adm.lines.find((l) => /Material de escritório/.test(l.label))?.total).toBe(-38790);
    expect(dre.sections.find((s) => s.key === "Receita bruta")!.total).toBeGreaterThan(0);
    // filial: soma das filiais = consolidado (itens com filial)
    const branches = await listAll(s2, "branches");
    const perBranch = await Promise.all(branches.map((b) => computeDre(ctx, { from, to, branchIds: [b.id] })));
    expect(perBranch.every((d) => d.check.difference === 0)).toBe(true);
    // demonstração: tabela de taxas e arquivo de exemplo da adquirente (prévia com casadas e divergências)
    const credit = (await listAll(s2, "payment_methods")).find((m) => m.kind === "credit")!;
    expect(credit.feeTable.length).toBeGreaterThan(0);
    const samples = await listAll(s2, "files", { filters: [["eq", "kind", "acquirer_sample"]] });
    expect(samples).toHaveLength(1);
    const { readFile } = await import("@/lib/core/files");
    const { data } = await readFile(ctx, samples[0].id);
    const bank = (await listAll(s2, "financial_accounts")).find((a) => a.bankCode === "341")!;
    const pv = await previewAcquirerFile({ ...ctx, branchId: (await listAll(s2, "branches"))[0].id }, { accountId: bank.id, fileName: samples[0].name, data: Buffer.from(data) });
    expect(pv.summary.byStatus.not_found).toBe(1);
    expect(pv.matches.length).toBeGreaterThanOrEqual(1);
    expect((await listAll(s2, "bank_imports")).filter((i) => i.kind === "acquirer")).toHaveLength(0);
    // repetir a demonstração não duplica
    await seedDemo(s2, { historyDays: 4 });
    expect(await listAll(s2, "files", { filters: [["eq", "kind", "acquirer_sample"]] })).toHaveLength(1);
    expect((await listAll(s2, "fin_categories")).filter((c) => c.name === "Material de escritório")).toHaveLength(1);
  }, 240000);
});
