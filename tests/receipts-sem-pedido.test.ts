import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { setSetting } from "@/lib/core/settings";
import { addDays, today } from "@/lib/dates";
import { roundDiv } from "@/lib/money";
import { buildSchedule } from "@/domain/finance";
import { savePolicy, submitForApproval, decideRequest } from "@/domain/approvals";
import { createOrder, orderBalance } from "@/domain/purchases";
import { createProduct } from "@/domain/products";
import { importNfeXml, confirmReceipt, updateReceipt, createManualReceipt, computeReceipt, confirmBlockers } from "@/domain/receipts";
import { createProductsFromReceipt, planProductsFromReceipt, suggestedPrice, unitFor } from "@/domain/receipt-products";
import { DEFAULT_CFOP_PAIRS, convertCfop, parseCfopPairs, pairProblem } from "@/domain/cfop-entry";
import { buildSampleNfeXml } from "@/domain/nfe-xml";

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let stockist: Ctx;

const MATRIZ_CNPJ = "11222333000181";

/** GTIN-13 válido a partir de 12 dígitos (dígito verificador módulo 10). */
function gtin13(base12: string) {
  const sum = base12.split("").reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + String((10 - (sum % 10)) % 10);
}

const balanceOf = async (skuId: string) => (await listAll(store, "stock_balances", { filters: [["eq", "skuId", skuId], ["eq", "warehouseId", refs.warehouses["matriz-main"].id]] }))[0];

async function approvedOrder(supplierId: string, items: Array<{ skuId: string; qty: number; unitCost: number }>) {
  const o = await createOrder(admin, { supplierId, items, paymentTermId: refs.terms.avista.id });
  await submitForApproval(admin, [o.id]);
  const cur = await store.getOrThrow("purchase_orders", o.id);
  if (cur.status === "in_review") await decideRequest(manager, cur.requestId, "approve");
  return store.getOrThrow("purchase_orders", o.id);
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  const roleManager = (await listAll(store, "roles")).find((r) => r.key === "manager")!;
  await savePolicy(admin, {
    name: "Teste — gestor aprova",
    rules: { tiers: [{ above: 0, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }] }], distinctApprovers: true },
    autoApproveBelow: 0,
    allowSelfApproval: false,
    expiredProposalAction: "warn",
    reviewOnRevision: "relevant",
  });
}, 120000);

describe("COM-03 — entrada sem pedido (lançamento manual)", () => {
  it("gera estoque, custo médio, título e parcelas pelas mesmas regras do recebimento (§14)", async () => {
    const caderno = refs.skus["caderno-u"];
    const caneta = refs.skus["caneta-u"];
    const b1 = await balanceOf(caderno.id);
    const b2 = await balanceOf(caneta.id);
    const term = refs.terms["30-60"];
    const r = await createManualReceipt(stockist, {
      supplierId: refs.suppliers.papel.id, orderIds: [], nfeNumber: "1234", nfeSeries: "1", issueDate: today(), idemKey: "sp-manual-1",
      items: [{ skuId: caderno.id, qty: 10000, unitCost: 1000, discount: 500 }, { skuId: caneta.id, qty: 5000, unitCost: 2000 }],
      freight: 1500, otherExpenses: 300, discount: 200, paymentTermId: term.id,
    });
    expect(r.origin).toBe("manual");
    expect(r.orderLink).toBe("without_order");
    expect(r.orderIds).toEqual([]);
    expect(r.orderCharges).toBeNull();
    // devido = Σ linhas (com desconto da linha) − desconto + frete + outras despesas
    expect(r.productsTotal).toBe(9500 + 10000);
    expect(r.dueTotal).toBe(9500 + 10000 - 200 + 1500 + 300);
    expect(r.divergences).toEqual([]);
    // rateio e custo de entrada idênticos ao cálculo puro do recebimento
    const pure = computeReceipt({ items: r.items, freight: 1500, otherExpenses: 300, discount: 200, invoicedTotal: null, hasXml: false }, []);
    expect(r.items.map((i: any) => i.landedValue)).toEqual(pure.items.map((i) => i.landedValue));
    // parcelas pela condição de pagamento a partir da emissão
    expect(r.installments.map((x: any) => ({ dueDate: x.dueDate, amount: x.amount }))).toEqual(buildSchedule(r.dueTotal, { installments: 2, firstDueDays: 30, intervalDays: 30 }, today()));
    // idempotente pelo formulário
    const again = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [], idemKey: "sp-manual-1", items: [{ skuId: caderno.id, qty: 1000, unitCost: 1 }] });
    expect(again.id).toBe(r.id);

    await expect(confirmReceipt(stockist, r.id)).rejects.toThrow(/conferência física/);
    await updateReceipt(stockist, r.id, { checkAll: true });
    const c = await confirmReceipt(stockist, r.id);
    expect(c.status).toBe("confirmed");
    const it1 = c.items.find((i: any) => i.skuId === caderno.id);
    const a1 = await balanceOf(caderno.id);
    expect(a1.physical).toBe(b1.physical + 10000);
    expect(a1.avgCost).toBe(roundDiv(b1.physical * b1.avgCost + it1.landedValue * 1000, b1.physical + 10000));
    expect((await balanceOf(caneta.id)).physical).toBe(b2.physical + 5000);
    expect((await store.getOrThrow("skus", caderno.id)).costAcquisition).toBe(it1.landedUnitCost);
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", r.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0].total).toBe(c.dueTotal);
    expect(titles[0].documentNumber).toBe("1234-1");
    const inst = await listAll(store, "installments", { filters: [["eq", "titleId", titles[0].id]] });
    expect(inst.map((x) => x.dueDate).sort()).toEqual(buildSchedule(c.dueTotal, { installments: 2, firstDueDays: 30, intervalDays: 30 }, today()).map((x) => x.dueDate));
    expect(inst.reduce((a, x) => a + x.amount, 0)).toBe(c.dueTotal);
    // repetir a conclusão não duplica
    await confirmReceipt(stockist, r.id);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", r.id]] })).toHaveLength(2);
    expect(await listAll(store, "titles", { filters: [["eq", "originId", r.id]] })).toHaveLength(1);
  });

  it("valida itens; inclui e remove itens manuais na conferência; total informado diferente exige justificativa", async () => {
    await expect(createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [], idemKey: "sp-manual-vazio", items: [] })).rejects.toThrow(/ao menos um item/);
    await expect(createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [], idemKey: "sp-manual-desc", items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 100, discount: 500 }] })).rejects.toThrow(/desconto inválido/);
    const r = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [], idemKey: "sp-manual-2", invoicedTotal: 5000, items: [{ skuId: refs.skus["caderno-u"].id, qty: 2000, unitCost: 990 }] });
    expect(r.dueTotal).toBe(1980);
    const u = await updateReceipt(stockist, r.id, { addItems: [{ skuId: refs.skus["caneta-u"].id, qty: 1000, unitCost: 3020 }] });
    expect(u.items).toHaveLength(2);
    expect(u.dueTotal).toBe(5000);
    expect(u.divergences.filter((d: any) => d.kind === "value")).toHaveLength(0);
    const u2 = await updateReceipt(stockist, r.id, { removeItems: [2], checkAll: true });
    expect(u2.items).toHaveLength(1);
    expect(confirmBlockers(u2).join(" ")).toMatch(/difere do valor devido/);
    await expect(updateReceipt(stockist, r.id, { addItems: [{ skuId: refs.skus["caneta-u"].id, qty: 0, unitCost: 100 }] })).rejects.toThrow(/quantidade/);
  });

  it("parâmetro desligado: lançamento manual exige pedido e XML não aceita “sem pedido”", async () => {
    await setSetting(store, refs.company.id, null, "feature.entradaSemPedido", false);
    try {
      await expect(createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [], idemKey: "sp-off", items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 990 }] })).rejects.toThrow(/ao menos um pedido/);
      const xml = buildSampleNfeXml({ number: 8801, issueDate: today(), emitter: { cnpj: "33000167000101", name: "Distribuidora Papel & Cia Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "PC-CAD", xProd: "CADERNO", qCom: 1000, vUnCom: 990 }] });
      await expect(importNfeXml(stockist, { xml, withoutOrder: true })).rejects.toThrow(/desativada/);
    } finally {
      await setSetting(store, refs.company.id, null, "feature.entradaSemPedido", true);
    }
  });
});

describe("COM-03 — XML sem pedido e comportamento com pedido", () => {
  it("XML marcado “sem pedido” não vincula pedido em aberto; com pedido o vínculo e o saldo seguem iguais", async () => {
    const caderno = refs.skus["caderno-u"];
    const o = await approvedOrder(refs.suppliers.papel.id, [{ skuId: caderno.id, qty: 20000, unitCost: 990 }]);
    expect(["approved", "sent"]).toContain(o.status);
    const mk = (n: number) => buildSampleNfeXml({ number: n, issueDate: today(), emitter: { cnpj: "33000167000101", name: "Distribuidora Papel & Cia Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "PC-CAD", cEAN: caderno.barcode, xProd: "CADERNO", qCom: 5000, vUnCom: 990 }], freight: 500, duplicatas: [{ dVenc: addDays(today(), 20) }] });

    // sem pedido: não vincula, sem saldo previsto nem divergência "fora do pedido"
    const before = await balanceOf(caderno.id);
    const rs = await importNfeXml(stockist, { xml: mk(8901), withoutOrder: true });
    expect(rs.orderIds).toEqual([]);
    expect(rs.origin).toBe("xml");
    expect(rs.orderLink).toBe("without_order");
    expect(rs.items[0].expectedQty).toBe(0);
    expect(rs.divergences).toEqual([]);
    expect(rs.dueTotal).toBe(rs.invoicedTotal);
    await updateReceipt(stockist, rs.id, { checkAll: true });
    const cs = await confirmReceipt(stockist, rs.id);
    expect((await balanceOf(caderno.id)).physical).toBe(before.physical + 5000);
    const ts = await store.getOrThrow("titles", cs.payableTitleId);
    expect(ts.total).toBe(cs.dueTotal);
    expect((await listAll(store, "installments", { filters: [["eq", "titleId", ts.id]] })).map((x) => x.dueDate)).toEqual([addDays(today(), 20)]);
    // o pedido continua com todo o saldo
    expect((await orderBalance(store, o.id))[0].remaining).toBe(20000);

    // com pedido (padrão): vincula o pedido em aberto e baixa o saldo como antes
    const rw = await importNfeXml(stockist, { xml: mk(8902) });
    expect(rw.orderIds).toEqual([o.id]);
    expect(rw.orderLink).toBe("with_order");
    expect(rw.items[0].expectedQty).toBe(20000);
    await updateReceipt(stockist, rw.id, { checkAll: true });
    const cw = await confirmReceipt(stockist, rw.id);
    expect(cw.dueTotal).toBe(cs.dueTotal);
    expect((await orderBalance(store, o.id))[0].remaining).toBe(15000);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("partial");

    // lançamento manual com pedido: itens do saldo (inalterado)
    const rm = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeNumber: "777", idemKey: "sp-with-order", items: [{ skuId: refs.skus["caneta-u"].id, qty: 1000, unitCost: 1 }] });
    expect(rm.orderLink).toBe("with_order");
    expect(rm.items).toHaveLength(1);
    expect(rm.items[0].skuId).toBe(caderno.id);
    expect(rm.items[0].receivedQty).toBe(15000);
    expect(rm.orderCharges).toEqual({ auto: true, claimed: [] }); // o XML vinculado ao pedido já trouxe o próprio frete
  });
});

describe("COM-04 — cadastrar produto a partir do item do XML", () => {
  it("prévia, cadastro com fator e código do fornecedor lembrados, sem duplicar GTIN existente", async () => {
    const gNew = gtin13("789100099001");
    const gTaken = gtin13("789100099002");
    const xml = buildSampleNfeXml({
      number: 9301, issueDate: today(), emitter: { cnpj: "33000167000101", name: "Distribuidora Papel & Cia Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" },
      items: [
        { cProd: "PC-AGENDA", cEAN: gNew, xProd: "AGENDA EXECUTIVA 2027", ncm: "48202000", cest: "1902000", uCom: "CX", qCom: 2000, vUnCom: 12000 },
        { cProd: "PC-MARCA", cEAN: gTaken, xProd: "MARCA TEXTO AMARELO", ncm: "96082000", uCom: "UN", qCom: 10000, vUnCom: 250 },
        { cProd: "PC-CLIPS", cEAN: "7891234567890", xProd: "CLIPS 2/0", ncm: "8305", uCom: "UNID", qCom: 3000, vUnCom: 300 },
      ],
    });
    const r = await importNfeXml(stockist, { xml, withoutOrder: true });
    expect(r.items.every((i: any) => !i.skuId)).toBe(true);
    // conversão: 1 caixa = 12 unidades
    await updateReceipt(stockist, r.id, { items: [{ idx: 1, conversionFactor: 12000 }] });
    // o GTIN do segundo item foi cadastrado em outro produto depois da importação
    const other = await createProduct(admin, { type: "product", name: "Marca-texto amarelo (cadastro da loja)", gtin: gTaken, unitCode: "UN" }, { costAcquisition: 200 });
    const otherSku = (await listAll(store, "skus", { filters: [["eq", "productId", other.id]] }))[0];

    await setSetting(store, refs.company.id, null, "pricing.defaultMarginBps", 5000);
    const cur = await store.getOrThrow("receipts", r.id);
    const plan = await planProductsFromReceipt(stockist, cur);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ gtin: gNew, ncm: "48202000", cest: "1902000", unitCode: "CX", existing: null, cost: 1000, price: 2000 });
    expect(plan[1].existing?.skuId).toBe(otherSku.id);
    expect(plan[2]).toMatchObject({ gtin: null, invalidGtin: "7891234567890", ncm: null, unitCode: "UN" });

    const res = await createProductsFromReceipt(stockist, r.id, plan.map((p) => ({ idx: p.idx, unitCode: p.idx === 1 ? "UN" : undefined, price: p.price })));
    expect(res.map((x) => x.action)).toEqual(["created", "linked_existing", "created"]);
    expect(res[1].message).toMatch(/já pertence/);
    // GTIN não duplicado: um único SKU com cada código
    expect(await listAll(store, "skus", { filters: [["eq", "barcode", gTaken]] })).toHaveLength(1);
    expect(await listAll(store, "skus", { filters: [["eq", "barcode", gNew]] })).toHaveLength(1);
    const after = await store.getOrThrow("receipts", r.id);
    expect(after.items.map((i: any) => i.mapping)).toEqual(["created", "barcode", "created"]);
    expect(after.items[1].skuId).toBe(otherSku.id);
    const newProd = await store.getOrThrow("products", res[0].productId);
    expect(newProd).toMatchObject({ name: "AGENDA EXECUTIVA 2027", gtin: gNew, ncm: "48202000", cest: "1902000", unitCode: "UN", supplierId: refs.suppliers.papel.id });
    const newSku = await store.getOrThrow("skus", res[0].skuId);
    expect(newSku.costAcquisition).toBe(1000);
    const price = (await listAll(store, "prices", { filters: [["eq", "skuId", newSku.id]] }))[0];
    expect(price.price).toBe(2000);
    // vínculo lembrado: código do fornecedor + fator
    const sp = (await listAll(store, "supplier_products", { filters: [["eq", "supplierId", refs.suppliers.papel.id], ["eq", "skuId", newSku.id]] }))[0];
    expect(sp).toMatchObject({ supplierCode: "PC-AGENDA", conversionFactor: 12000 });
    const sp2 = (await listAll(store, "supplier_products", { filters: [["eq", "supplierId", refs.suppliers.papel.id], ["eq", "skuId", otherSku.id]] }))[0];
    expect(sp2.supplierCode).toBe("PC-MARCA");

    // repetir não cria outro produto (itens já associados ficam de fora da prévia)
    expect(await planProductsFromReceipt(stockist, after)).toHaveLength(0);
    const count = (await listAll(store, "products")).length;
    await createProductsFromReceipt(stockist, r.id, [{ idx: 1 }]);
    expect((await listAll(store, "products")).length).toBe(count);

    // próxima nota do fornecedor: associação automática pelo código, com o fator lembrado
    const xml2 = buildSampleNfeXml({ number: 9302, issueDate: today(), emitter: { cnpj: "33000167000101", name: "Distribuidora Papel & Cia Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "PC-AGENDA", xProd: "AGENDA EXECUTIVA 2027", uCom: "CX", qCom: 1000, vUnCom: 12000 }] });
    const r2 = await importNfeXml(stockist, { xml: xml2, withoutOrder: true });
    expect(r2.items[0]).toMatchObject({ skuId: newSku.id, mapping: "supplier_code", conversionFactor: 12000, invoicedQty: 12000 });

    // conclusão do recebimento com produtos novos: estoque no produto criado
    await updateReceipt(stockist, r.id, { checkAll: true });
    await confirmReceipt(stockist, r.id);
    expect((await balanceOf(newSku.id)).physical).toBe(24000);
    await setSetting(store, refs.company.id, null, "pricing.defaultMarginBps", 0);
  });

  it("funções auxiliares: unidade e preço sugerido", () => {
    const units = [{ code: "UN" }, { code: "PC" }, { code: "CX" }, { code: "KG" }];
    expect(unitFor("cx", units)).toBe("CX");
    expect(unitFor("PÇ", units)).toBe("PC");
    expect(unitFor("UNID", units)).toBe("UN");
    expect(unitFor("FD", units)).toBe("UN");
    expect(suggestedPrice(1000, 0)).toBeNull();
    // margem sobre o preço de venda (mesma fórmula do motor de preços): 10,01 ÷ (1 − 33,33%)
    expect(suggestedPrice(1001, 3333)).toBe(roundDiv(1001 * 10000, 10000 - 3333));
  });
});

describe("COM-09 — conversor de CFOP", () => {
  it("tabela padrão e validação dos pares", () => {
    expect(convertCfop("5102", DEFAULT_CFOP_PAIRS)).toBe("1102");
    expect(convertCfop("6102", DEFAULT_CFOP_PAIRS)).toBe("2102");
    expect(convertCfop("5405", DEFAULT_CFOP_PAIRS)).toBe("1403");
    expect(convertCfop("6403", DEFAULT_CFOP_PAIRS)).toBe("2403");
    expect(convertCfop("5910", DEFAULT_CFOP_PAIRS)).toBe("1910");
    expect(convertCfop("5949", DEFAULT_CFOP_PAIRS)).toBe("1949");
    expect(convertCfop("5933", DEFAULT_CFOP_PAIRS)).toBeNull();
    expect(convertCfop("5102", null)).toBeNull();
    for (const [from, to] of Object.entries(DEFAULT_CFOP_PAIRS)) expect(pairProblem(from, to)).toBeNull();
    expect(parseCfopPairs("5102=1556\n6102 → 2556; 5.405=1.403")).toEqual({ "5102": "1556", "5405": "1403", "6102": "2556" });
    expect(() => parseCfopPairs("5102=2102")).toThrow(/corresponde a entrada 1xxx/);
    expect(() => parseCfopPairs("1102=5102")).toThrow(/saída/);
    expect(() => parseCfopPairs("5102")).toThrow(/formato/);
  });

  it("aplica os pares por item na importação, mantém 1102/2102 sem par, respeita a tabela editada e o liga/desliga", async () => {
    const mk = (n: number, cfops: string[], uf = "SP") =>
      buildSampleNfeXml({ number: n, issueDate: today(), emitter: { cnpj: "33000167000101", name: "Distribuidora Papel & Cia Ltda", uf }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: cfops.map((c, i) => ({ cProd: `CF-${n}-${i}`, xProd: `ITEM ${i}`, cfop: c, qCom: 1000, vUnCom: 100 })) });
    const r1 = await importNfeXml(stockist, { xml: mk(9401, ["5405", "5102", "5933"]), withoutOrder: true });
    expect(r1.items.map((i: any) => i.entryCfop)).toEqual(["1403", "1102", null]);
    expect(r1.entryCfop).toBe("1102");
    const r2 = await importNfeXml(stockist, { xml: mk(9402, ["5405", "5403"]), withoutOrder: true });
    expect(r2.entryCfop).toBe("1403");
    const r3 = await importNfeXml(stockist, { xml: mk(9403, ["6102", "6949"], "MG"), withoutOrder: true });
    expect(r3.items.map((i: any) => i.entryCfop)).toEqual(["2102", "2949"]);
    const r4 = await importNfeXml(stockist, { xml: mk(9404, ["6933"], "MG"), withoutOrder: true });
    expect(r4.items[0].entryCfop).toBeNull();
    expect(r4.entryCfop).toBe("2102");
    // CFOP do item editável na conferência (com validação)
    const u = await updateReceipt(stockist, r1.id, { items: [{ idx: 3, entryCfop: "1556" }] });
    expect(u.items[2].entryCfop).toBe("1556");
    await expect(updateReceipt(stockist, r1.id, { items: [{ idx: 3, entryCfop: "5102" }] })).rejects.toThrow(/CFOP de entrada/);
    // tabela própria da empresa
    await setSetting(store, refs.company.id, null, "purchase.cfopPairs", { "5102": "1556" });
    const r5 = await importNfeXml(stockist, { xml: mk(9405, ["5102", "5405"]), withoutOrder: true });
    expect(r5.items.map((i: any) => i.entryCfop)).toEqual(["1556", null]);
    // conversor desligado: nenhum item convertido, vale o padrão do recebimento
    await setSetting(store, refs.company.id, null, "feature.conversorCfop", false);
    const r6 = await importNfeXml(stockist, { xml: mk(9406, ["5405"]), withoutOrder: true });
    expect(r6.items[0].entryCfop).toBeNull();
    expect(r6.entryCfop).toBe("1102");
    await setSetting(store, refs.company.id, null, "feature.conversorCfop", true);
    await setSetting(store, refs.company.id, null, "purchase.cfopPairs", DEFAULT_CFOP_PAIRS);
  });
});
