import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { setSetting } from "@/lib/core/settings";
import { readFile } from "@/lib/core/files";
import { addDays, monthStart, today } from "@/lib/dates";
import { roundDiv } from "@/lib/money";
import { buildSampleNfeXml, parseNfeXml } from "@/domain/nfe-xml";
import { buildSampleCteXml, parseCteXml } from "@/domain/cte-xml";
import { computeReceipt, confirmReceipt, importNfeXml, updateReceipt } from "@/domain/receipts";
import { createNoStockEntry } from "@/domain/no-stock-entries";
import { importCteXml } from "@/domain/freight-cte";
import { entriesBook, receiptItemLines } from "@/domain/fiscal/entries";
import { outputBook, periodDocuments, summarize, summaryByCfop, taxesByNcm } from "@/domain/fiscal/reports";
import { BOOK_COLS, buildAccountingPackage, csv } from "@/domain/fiscal/export";
import { createTitle, settleInstallment, reverseSettlement } from "@/domain/finance";
import { saveIntegration, testIntegration } from "@/domain/integrations";
import { dominioEntries, dominioFileLines, generateDominioFile, saveAccountingCodes } from "@/domain/accounting/dominio";

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let stockist: Ctx;
const MATRIZ = "11222333000181";
const t0 = today();
const fAll = () => ({ from: monthStart(t0), to: t0, branchId: null as string | null, includeSimulated: true });
let outputBefore: { summary: unknown; book: unknown; cfop: unknown; ncm: unknown; docs: number };

const balanceOf = async (skuId: string) => (await listAll(store, "stock_balances", { filters: [["eq", "skuId", skuId], ["eq", "warehouseId", refs.warehouses["matriz-main"].id]] }))[0];

/** Saídas (faturamento e relatórios) calculadas a partir de fiscal_documents. */
async function outputs() {
  const ctx = { ...admin, branchId: null };
  const f = fAll();
  const docs = await periodDocuments(ctx, f);
  return { summary: summarize(docs, f), book: outputBook(docs), cfop: summaryByCfop(docs), ncm: taxesByNcm(docs), docs: (await listAll(store, "fiscal_documents")).length };
}

beforeAll(async () => {
  store = freshStore();
  await seedDemo(store, { historyDays: 3 });
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  outputBefore = await outputs();
}, 300000);

/** NF-e de compra do regime normal: ICMS próprio, IPI e ICMS-ST, dois CFOP de saída do fornecedor. */
function taxedXml(number: number, items?: Array<{ sku: string; q: number; v: number }>) {
  const camiseta = refs.skus["camiseta-m-preta"];
  const bone = refs.skus["bone-u"];
  const list = items ?? [
    { sku: "camiseta-m-preta", q: 10, v: 2000 },
    { sku: "bone-u", q: 5, v: 1600 },
  ];
  return buildSampleNfeXml({
    number,
    issueDate: t0,
    emitter: { cnpj: refs.suppliers.textil.doc, name: refs.suppliers.textil.name, ie: "110042490999" },
    recipient: { cnpj: MATRIZ, name: refs.company.name },
    items: list.map((it, i) => {
      const gross = it.q * it.v;
      const sku = it.sku === "bone-u" ? bone : camiseta;
      return i === 0
        ? { cProd: `T-${it.sku}`, cEAN: sku.barcode, xProd: sku.name, cfop: "5102", qCom: it.q * 1000, vUnCom: it.v, icms: { vBC: gross, pICMS: 1800, vICMS: roundDiv(gross * 1800, 10000) }, ipi: { vBC: gross, pIPI: 500, vIPI: roundDiv(gross * 500, 10000) } }
        : { cProd: `T-${it.sku}`, cEAN: sku.barcode, xProd: sku.name, cfop: "5405", qCom: it.q * 1000, vUnCom: it.v, icms: { vBC: gross, pICMS: 1800, vICMS: roundDiv(gross * 1800, 10000), vBCST: gross * 2, pICMSST: 1800, vICMSST: 900 } };
    }),
    freight: 1000,
  });
}

let taxedReceiptId = "";

describe("FIS-24 — totais do XML guardados no recebimento (aditivo)", () => {
  it("parser lê base/ICMS/IPI/ST por item e nos totais; o recebimento guarda sem mudar o cálculo", async () => {
    const xml = taxedXml(91001);
    const n = parseNfeXml(xml);
    expect(n.items[0].tax).toMatchObject({ icmsGroup: "ICMS00", cst: "00", vBC: 20000, pICMS: 1800, vICMS: 3600, vIPI: 1000, pIPI: 500 });
    expect(n.items[1].tax).toMatchObject({ icmsGroup: "ICMS10", vICMSST: 900, vBCST: 16000 });
    expect(n.totals).toMatchObject({ vBC: 28000, vICMS: 5040, vBCST: 16000, vST: 900, vIPI: 1000, vProd: 28000, vFrete: 1000 });
    expect(n.totals.vNF).toBe(28000 + 1000 + 1000 + 900);

    const r = await importNfeXml(stockist, { xml, withoutOrder: true, allowHomologation: true });
    taxedReceiptId = r.id;
    expect(r.items[0].fiscal).toMatchObject({ vProd: 20000, vBC: 20000, vICMS: 3600, vIPI: 1000, cst: "00" });
    expect(r.items[1].fiscal).toMatchObject({ vICMSST: 900, vBCST: 16000 });
    expect(r.emitter.totals).toMatchObject({ vBC: 28000, vICMS: 5040, vNF: 30900 });
    // cálculo do recebimento inalterado: outras despesas = IPI + ST (+ seguro/outras) e devido pelo computeReceipt puro
    expect(r.otherExpenses).toBe(1000 + 900);
    const pure = computeReceipt({ items: r.items, freight: r.freight, otherExpenses: r.otherExpenses, discount: 0, invoicedTotal: r.invoicedTotal, hasXml: true }, []);
    expect(r.dueTotal).toBe(pure.dueTotal);
    expect(r.items.map((i: any) => i.landedValue)).toEqual(pure.items.map((i) => i.landedValue));
    // CFOP de entrada pelo conversor (5102 → 1102; 5405 → 1403)
    expect(r.items.map((i: any) => i.entryCfop)).toEqual(["1102", "1403"]);
    await updateReceipt(stockist, r.id, { checkAll: true });
    const c = await confirmReceipt(stockist, r.id);
    expect(c.status).toBe("confirmed");
  });
});

describe("FIS-24 — livro de entradas", () => {
  it("por CFOP a partir dos recebimentos do seed e do teste; documento soma o vNF", async () => {
    const book = await entriesBook(admin, { from: t0, to: t0 });
    const mine = book.rows.filter((r) => r.sourceId === taxedReceiptId);
    expect(mine.map((r) => r.cfop)).toEqual(["1102", "1403"]);
    expect(mine.reduce((a, r) => a + r.value, 0)).toBe(30900);
    const c1102 = mine.find((r) => r.cfop === "1102")!;
    expect(c1102).toMatchObject({ icmsBase: 20000, icms: 3600, ipi: 1000, st: 0, emitterDoc: refs.suppliers.textil.doc, uf: "SP", modelLabel: "NF-e", number: "91001" });
    expect(c1102.exemptOther).toBe(c1102.value - c1102.icmsBase);
    expect(mine.find((r) => r.cfop === "1403")).toMatchObject({ icmsBase: 8000, icms: 1440, st: 900, stBase: 16000 });
    // recebimentos do seed: NF-e 4711 por XML (Simples, sem ICMS) e nota manual 88012 (sem XML: valor do lançamento)
    const seedXml = (await listAll(store, "receipts")).find((r) => r.nfeNumber === "4711")!;
    const seedRows = book.rows.filter((r) => r.sourceId === seedXml.id);
    expect(seedRows.length).toBeGreaterThan(0);
    expect(seedRows.reduce((a, r) => a + r.value, 0)).toBe(seedXml.emitter.totals.vNF);
    expect(seedRows.every((r) => r.icms === 0)).toBe(true);
    const manual = (await listAll(store, "receipts")).find((r) => r.nfeNumber === "88012")!;
    expect(book.rows.filter((r) => r.sourceId === manual.id).reduce((a, r) => a + r.value, 0)).toBe(manual.dueTotal);
    // totais por CFOP fecham com as linhas
    for (const g of book.byCfop) {
      const rows = book.rows.filter((r) => r.cfop === g.cfop);
      expect(g.value).toBe(rows.reduce((a, r) => a + r.value, 0));
      expect(g.icms).toBe(rows.reduce((a, r) => a + r.icms, 0));
    }
    expect(book.totals.value).toBe(book.rows.reduce((a, r) => a + r.value, 0));
    // recebimento em conferência do seed (NF-e 88047) aparece como pendente, fora do livro
    const wide = await entriesBook(admin, { from: addDays(t0, -3), to: t0 });
    expect(wide.pendingReceipts.some((p) => p.nfeNumber === "88047")).toBe(true);
    expect(wide.rows.some((r) => r.number === "88047")).toBe(false);
  });

  it("recebimento importado antes dos valores por item: totais do XML rateados pelos itens", () => {
    const r = { xmlFileId: "x", entryCfop: "1102", emitter: { totals: { vNF: 11500, vFrete: 1000, vOutro: 0, vSeg: 0, vIPI: 500, vST: 0, vBC: 10000, vICMS: 1200, vBCST: 0 } }, items: [{ invoicedValue: 6000, entryCfop: "1102" }, { invoicedValue: 4000, entryCfop: "1403" }] } as any;
    const lines = receiptItemLines(r);
    expect(lines.reduce((a, l) => a + l.value, 0)).toBe(11500);
    expect(lines.map((l) => l.icms)).toEqual([720, 480]);
  });

  it("nota de entrada sem estoque: sem movimento nem custo, com título, idempotente e no livro", async () => {
    const before = (await listAll(store, "stock_movements")).length;
    const n = await createNoStockEntry(stockist, {
      idemKey: "nse-1", supplierId: refs.suppliers.papel.id, docModel: "other", number: "555", series: "1", issueDate: t0, cfop: "1556",
      description: "Material de limpeza", total: 12345, icmsBase: 10000, icms: 1800, paymentTermId: refs.terms["30"].id,
    });
    expect(n).toMatchObject({ status: "confirmed", entryKind: "no_stock", pricingStatus: "not_applicable" });
    expect(n.effects).toEqual({ updateStock: false, updateCost: false, createPayable: true });
    expect((await listAll(store, "stock_movements")).length).toBe(before);
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", n.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0].total).toBe(12345);
    // repetir o envio não duplica
    const again = await createNoStockEntry(stockist, { idemKey: "nse-1", supplierId: refs.suppliers.papel.id, docModel: "other", number: "555", cfop: "1556", description: "Material de limpeza", total: 12345 });
    expect(again.id).toBe(n.id);
    expect(await listAll(store, "titles", { filters: [["eq", "originId", n.id]] })).toHaveLength(1);
    // serviço tomado (NFS-e) sem CFOP
    const s = await createNoStockEntry(stockist, { idemKey: "nse-2", supplierId: refs.suppliers.papel.id, docModel: "nfse", number: "77", issueDate: t0, description: "Manutenção do ar-condicionado", total: 25000, createPayable: false });
    expect(s.payableTitleId ?? null).toBeNull();
    const book = await entriesBook(admin, { from: t0, to: t0 });
    expect(book.rows.find((r) => r.sourceId === n.id)).toMatchObject({ source: "no_stock", cfop: "1556", value: 12345, icmsBase: 10000, icms: 1800 });
    expect(book.rows.find((r) => r.sourceId === s.id)).toMatchObject({ cfop: "", value: 25000 });
    expect(book.byCfop.find((g) => g.cfop === "")?.label).toMatch(/serviço tomado/);
    // validações
    await expect(createNoStockEntry(stockist, { idemKey: "nse-3", supplierId: refs.suppliers.papel.id, docModel: "other", number: "1", description: "x", total: 100 })).rejects.toThrow(/CFOP/);
    await expect(createNoStockEntry(stockist, { idemKey: "nse-4", supplierId: refs.suppliers.papel.id, docModel: "other", number: "1", cfop: "5102", description: "x", total: 100 })).rejects.toThrow(/inválido/);
  });
});

describe("COM-10 — CT-e de entrada", () => {
  it("parser do XML de exemplo", () => {
    const xml = buildSampleCteXml({ number: 321, issueDate: t0, emitter: { cnpj: "19131243000197", name: "Rápido Transportes Ltda" }, sender: { cnpj: refs.suppliers.textil.doc, name: "Têxtil" }, recipient: { cnpj: MATRIZ, name: "Loja" }, total: 15000, icms: { vBC: 15000, pICMS: 1200, vICMS: 1800 }, nfeKeys: ["35261045997418000153550010000047111100047110"], duplicatas: [{ dVenc: addDays(t0, 15), vDup: 15000 }] });
    const c = parseCteXml(xml);
    expect(c.key).toHaveLength(44);
    expect(c.key.slice(20, 22)).toBe("57");
    expect(c).toMatchObject({ number: "321", series: "1", cfop: "5353", total: 15000, received: 15000, modal: "01", authorized: true, environment: "homologacao" });
    expect(c.icms).toMatchObject({ group: "ICMS00", cst: "00", vBC: 15000, pICMS: 1200, vICMS: 1800 });
    expect(c.tomador.role).toBe("3");
    expect(c.tomador.party.cnpj).toBe(MATRIZ);
    expect(c.emitter).toMatchObject({ cnpj: "19131243000197", name: "Rápido Transportes Ltda" });
    expect(c.nfeKeys).toEqual(["35261045997418000153550010000047111100047110"]);
    expect(c.duplicatas).toEqual([{ nDup: "001", dVenc: addDays(t0, 15), vDup: 15000 }]);
    expect(() => parseCteXml(buildSampleNfeXml({ number: 1, issueDate: t0, emitter: { cnpj: MATRIZ, name: "x" }, recipient: { cnpj: MATRIZ, name: "y" }, items: [{ cProd: "1", xProd: "x", qCom: 1000, vUnCom: 100 }] }))).toThrow(/não é um CT-e/);
  });

  it("vinculado a recebimento em conferência e a recebimento concluído: rateio no custo, ajuste documentado e título à transportadora", async () => {
    // recebimento em conferência (mesmos produtos)
    const draft = await importNfeXml(stockist, { xml: taxedXml(91002, [{ sku: "camiseta-m-preta", q: 4, v: 2000 }, { sku: "bone-u", q: 6, v: 1500 }]), withoutOrder: true, allowHomologation: true });
    const confirmed = await store.getOrThrow("receipts", taxedReceiptId);
    const dueBefore = draft.dueTotal;
    const landedBefore = draft.items.map((i: any) => i.landedValue);
    const bone = refs.skus["bone-u"];
    const balBone = await balanceOf(bone.id);
    const xml = buildSampleCteXml({ number: 4501, issueDate: t0, emitter: { cnpj: "19131243000197", name: "Rápido Transportes Ltda" }, sender: { cnpj: refs.suppliers.textil.doc, name: "Têxtil" }, recipient: { cnpj: MATRIZ, name: refs.company.name }, total: 10000, icms: { vBC: 10000, pICMS: 1200, vICMS: 1200 }, nfeKeys: [confirmed.nfeKey, draft.nfeKey] });
    const cte = await importCteXml(admin, { xml, allowHomologation: true });
    expect(cte.status).toBe("registered");
    expect(cte.entryCfop).toBe("1353");
    // rateio entre os recebimentos pelo valor dos produtos
    const total = confirmed.productsTotal + draft.productsTotal;
    const aConf = cte.allocations.find((a: any) => a.receiptId === confirmed.id)!;
    const aDraft = cte.allocations.find((a: any) => a.receiptId === draft.id)!;
    expect(aConf.amount + aDraft.amount).toBe(10000);
    expect(Math.abs(aConf.amount - roundDiv(10000 * confirmed.productsTotal, total))).toBeLessThanOrEqual(1);
    expect(aDraft.mode).toBe("cost");
    expect(aConf.mode).toBe("adjustment");
    // transportadora cadastrada a partir do XML e marcada
    const carrier = await store.getOrThrow("suppliers", cte.carrierId);
    expect(carrier).toMatchObject({ isCarrier: true, doc: "19131243000197" });
    // título a pagar à transportadora, idempotente pelo CT-e
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "freight_cte"], ["eq", "originId", cte.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ kind: "payable", partyId: carrier.id, total: 10000 });
    // conferência: frete no custo de entrada, devido ao fornecedor inalterado
    const d2 = await store.getOrThrow("receipts", draft.id);
    expect(d2.cteFreight).toBe(aDraft.amount);
    expect(d2.dueTotal).toBe(dueBefore);
    expect(d2.items.reduce((a: number, i: any) => a + (i.cteShare ?? 0), 0)).toBe(aDraft.amount);
    expect(d2.items.map((i: any, k: number) => i.landedValue - landedBefore[k])).toEqual(d2.items.map((i: any) => i.cteShare));
    await updateReceipt(stockist, draft.id, { checkAll: true });
    const dc = await confirmReceipt(stockist, draft.id);
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", draft.id]] });
    expect(movs.reduce((a, m) => a + m.totalCost, 0)).toBe(dc.dueTotal + aDraft.amount);
    const payable = await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", draft.id]] });
    expect(payable[0].total).toBe(dueBefore);
    // concluído: ajuste de custo das unidades ainda em estoque (movimento de quantidade zero)
    const adj = await listAll(store, "stock_movements", { filters: [["eq", "originType", "freight_cte"], ["eq", "originId", cte.id]] });
    expect(adj.length).toBeGreaterThan(0);
    expect(adj.every((m) => m.type === "cost_adjust" && m.qty === 0)).toBe(true);
    const absorbed = aConf.adjustments.reduce((a: number, x: any) => a + x.absorbed, 0);
    expect(absorbed + aConf.adjustments.reduce((a: number, x: any) => a + x.notAbsorbed, 0)).toBe(aConf.amount);
    expect(adj.reduce((a, m) => a + m.totalCost, 0)).toBe(absorbed);
    const boneAdj = adj.find((m) => m.skuId === bone.id)!;
    expect(boneAdj.balanceAfter).toBe(boneAdj.balanceBefore);
    expect(boneAdj.avgCostAfter).toBe(roundDiv(boneAdj.balanceBefore * (balBone.avgCost) + boneAdj.totalCost * 1000, boneAdj.balanceBefore));
    // repetir a importação não duplica nada
    const nMov = (await listAll(store, "stock_movements")).length;
    await expect(importCteXml(admin, { xml, allowHomologation: true })).rejects.toThrow(/já foi lançado/);
    expect(await listAll(store, "inbound_ctes")).toHaveLength(1);
    expect(await listAll(store, "titles", { filters: [["eq", "originType", "freight_cte"]] })).toHaveLength(1);
    expect((await listAll(store, "stock_movements")).length).toBe(nMov);
    // CT-e no livro de entradas (CFOP 1353, ICMS da prestação)
    const book = await entriesBook(admin, { from: t0, to: t0 });
    expect(book.rows.find((r) => r.source === "cte")).toMatchObject({ model: "57", cfop: "1353", value: 10000, icmsBase: 10000, icms: 1200, emitterDoc: "19131243000197" });
  });

  it("frete CIF (tomador remetente) é recusado; sem recebimento é recusado", async () => {
    const base = { issueDate: t0, emitter: { cnpj: "19131243000197", name: "Rápido Transportes Ltda" }, sender: { cnpj: refs.suppliers.textil.doc, name: "Têxtil" }, recipient: { cnpj: MATRIZ, name: "Loja" }, total: 5000 };
    await expect(importCteXml(admin, { xml: buildSampleCteXml({ ...base, number: 4502, tomador: 0, nfeKeys: [] }), allowHomologation: true })).rejects.toThrow(/CIF/);
    await expect(importCteXml(admin, { xml: buildSampleCteXml({ ...base, number: 4503, nfeKeys: [] }), allowHomologation: true })).rejects.toThrow(/Nenhum recebimento/);
  });
});

describe("FIS-21 — pacote contábil com XMLs de entrada; saídas inalteradas", () => {
  it("faturamento e relatórios de saída não mudam com as entradas", async () => {
    expect(await outputs()).toEqual(outputBefore);
  });

  it("pacote inclui xml-entradas e o livro de entradas; desligado, volta ao de antes", async () => {
    const ctx = { ...admin, branchId: null };
    const f = fAll();
    const pkg = await buildAccountingPackage(ctx, f);
    const zip = await JSZip.loadAsync((await readFile(ctx, pkg.fileId)).data);
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.startsWith("xml-entradas/nfe/"))).toBe(true);
    expect(names.some((n) => n.startsWith("xml-entradas/cte/"))).toBe(true);
    expect(names).toContain("relatorios/livro-registro-entradas.csv");
    expect(names).toContain("relatorios/entradas-por-cfop.csv");
    expect(pkg.entryXmlCount).toBe(names.filter((n) => n.startsWith("xml-entradas/") && !n.endsWith("/")).length);
    const entries = await zip.file("relatorios/livro-registro-entradas.csv")!.async("string");
    expect(entries).toContain("91001");
    expect(entries).toContain("CT-e");
    // saídas: mesmo livro de antes
    const docs = await periodDocuments(ctx, f);
    expect(await zip.file("relatorios/livro-registro-saidas.csv")!.async("string")).toBe(csv(BOOK_COLS, outputBook(docs).map((r) => ({ ...r, modelLabel: { nfe: "NF-e", nfce: "NFC-e", nfse: "NFS-e" }[r.model] ?? r.model }))));
    expect(await zip.file("LEIA-ME.txt")!.async("string")).toMatch(/ENTRADAS/);
    // XMLs de saída não se misturam com os de entrada
    expect(names.filter((n) => n.startsWith("xml/")).some((n) => n.includes("91001"))).toBe(false);
    await setSetting(store, refs.company.id, null, "feature.livroEntradas", false);
    const off = await buildAccountingPackage(ctx, f);
    const offNames = Object.keys((await JSZip.loadAsync((await readFile(ctx, off.fileId)).data)).files);
    expect(offNames.some((n) => n.startsWith("xml-entradas/"))).toBe(false);
    expect(offNames).not.toContain("relatorios/livro-registro-entradas.csv");
    expect(off.xmlCount).toBe(pkg.xmlCount);
    await setSetting(store, refs.company.id, null, "feature.livroEntradas", true);
  });
});

describe("CTB-02 — exportação para a Domínio", () => {
  it("gera linhas e campos no layout, com estorno invertido e pendências de conta; mesmo período = mesmo arquivo", async () => {
    const cfg = {
      dominioCompanyCode: "123", regime: "competencia", separator: ";", historyCode: "15", accountSuppliers: "2101", accountCustomers: "1121", accountCash: "1101",
      accountDefaultExpense: "4999", accountDefaultRevenue: "3999", accountInterestPaid: "4501", accountInterestReceived: "3501", accountDiscountObtained: "3502", accountDiscountGranted: "4502", accountBankFees: "4503",
    };
    await expect(generateDominioFile(admin, { from: "2025-01-01", to: "2025-01-31" })).rejects.toThrow(/Configure o layout/);
    await expect(saveIntegration(admin, { kind: "accounting_dominio", branchId: null, provider: "dominio_txt", config: { ...cfg, separator: "a" } })).rejects.toThrow(/Separador/);
    await saveIntegration(admin, { kind: "accounting_dominio", branchId: null, provider: "dominio_txt", config: cfg });
    expect((await testIntegration(admin, "accounting_dominio", null)).ok).toBe(true);
    await saveAccountingCodes(admin, { categories: { [refs.finCategories.aluguel.id]: "4110" }, accounts: { [refs.accounts.banco.id]: "1111" } });
    const pay = await createTitle(admin, { kind: "payable", partyType: "supplier", partyId: refs.suppliers.papel.id, partyName: "Papel & Cia", description: "Aluguel janeiro", documentNumber: "ALG-01", originType: "manual", issueDate: "2025-01-05", categoryId: refs.finCategories.aluguel.id, installments: [{ dueDate: "2025-01-10", amount: 100000 }], approvalStatus: "approved", idemKey: "dom-pay-1", branchId: refs.branches.matriz.id });
    const instP = (await listAll(store, "installments", { filters: [["eq", "titleId", pay.id]] }))[0];
    const sp = await settleInstallment(admin, { installmentId: instP.id, date: "2025-01-12", principal: 100000, interest: 300, fine: 200, discount: 1000, accountId: refs.accounts.banco.id, idemKey: "dom-settle-1", skipApprovalCheck: true });
    const rec = await createTitle(admin, { kind: "receivable", partyType: "customer", partyName: "Cliente X", description: "Serviço", originType: "manual", issueDate: "2025-01-06", categoryId: refs.finCategories.servicos.id, installments: [{ dueDate: "2025-01-20", amount: 50000 }], idemKey: "dom-rec-1", branchId: refs.branches.matriz.id });
    const instR = (await listAll(store, "installments", { filters: [["eq", "titleId", rec.id]] }))[0];
    const sr = await settleInstallment(admin, { installmentId: instR.id, date: "2025-01-20", principal: 50000, accountId: refs.accounts.banco.id, idemKey: "dom-settle-2" });
    await reverseSettlement(admin, sr.id, "Cheque devolvido");
    const r = await dominioEntries(admin, { from: "2025-01-01", to: "2025-01-31", branchId: refs.branches.matriz.id });
    const byOrigin = (id: string) => r.lines.filter((l) => l.origin.id === id);
    expect(byOrigin(pay.id)).toEqual([expect.objectContaining({ date: "2025-01-05", debit: "4110", credit: "2101", amount: 100000, document: "ALG-01", history: "15" })]);
    expect(byOrigin(rec.id)).toEqual([expect.objectContaining({ debit: "1121", credit: "3999", amount: 50000 })]);
    expect(byOrigin(sp.id).map((l) => [l.debit, l.credit, l.amount])).toEqual([["2101", "1111", 99000], ["2101", "3502", 1000], ["4501", "1111", 500]]);
    // recebimento no período da baixa; o estorno (feito hoje) sai invertido no período do estorno
    const recv = r.lines.filter((l) => l.origin.id === sr.id);
    expect(recv.map((l) => [l.origin.type, l.debit, l.credit, l.amount])).toEqual([["settlement", "1111", "1121", 50000]]);
    const now = await dominioEntries(admin, { from: t0, to: t0, branchId: refs.branches.matriz.id });
    expect(now.lines.filter((l) => l.origin.id === sr.id).map((l) => [l.origin.type, l.date, l.debit, l.credit, l.amount])).toEqual([["reversal", t0, "1121", "1111", 50000]]);
    expect(r.pending).toHaveLength(0);
    // arquivo: 7 campos por linha, data DD/MM/AAAA e valor com vírgula
    const fileLines = dominioFileLines(r.lines, r.config);
    expect(fileLines).toHaveLength(r.lines.length);
    for (const l of fileLines) expect(l.split(";")).toHaveLength(7);
    expect(fileLines).toContain("05/01/2025;4110;2101;1000,00;15;Provisão a pagar título nº " + pay.number + " doc. ALG-01 - Papel & Cia;ALG-01");
    // idempotência: mesmo período, mesmo conteúdo
    const g1 = await generateDominioFile(admin, { from: "2025-01-01", to: "2025-01-31", branchId: refs.branches.matriz.id });
    const g2 = await generateDominioFile(admin, { from: "2025-01-01", to: "2025-01-31", branchId: refs.branches.matriz.id });
    const b1 = (await readFile(admin, g1.fileId)).data;
    const b2 = (await readFile(admin, g2.fileId)).data;
    expect(b1.equals(b2)).toBe(true);
    expect(b1.toString("latin1").split("\r\n").filter(Boolean)).toEqual(fileLines);
    expect(g1.lines).toBe(r.lines.length);
    const logs = await listAll(store, "integration_logs", { filters: [["eq", "kind", "accounting_dominio"], ["eq", "action", "export_file"]] });
    expect(logs.length).toBe(2);
    // sem conta: linha com campo vazio e pendência
    const r2 = await dominioEntries(admin, { from: "2025-01-01", to: "2025-01-31", branchId: refs.branches.matriz.id }, { ...r.config, accountSuppliers: "" });
    expect(r2.pending.length).toBeGreaterThan(0);
    expect(r2.pending[0].missing.join(" ")).toMatch(/Fornecedores/);
    // regime de caixa: só baixas, com a conta da categoria
    const caixa = await dominioEntries(admin, { from: "2025-01-01", to: "2025-01-31", branchId: refs.branches.matriz.id }, { ...r.config, regime: "caixa" });
    expect(caixa.lines.some((l) => l.origin.type === "title")).toBe(false);
    expect(caixa.lines.find((l) => l.origin.id === sp.id)).toMatchObject({ debit: "4110", credit: "1111", amount: 99000 });
  });
});
