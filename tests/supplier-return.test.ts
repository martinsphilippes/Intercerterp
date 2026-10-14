import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Store, Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import { setSetting } from "@/lib/core/settings";
import { importNfeXml, confirmReceipt, updateReceipt } from "@/domain/receipts";
import { buildSampleNfeXml } from "@/domain/nfe-xml";
import { approvePayable, settleInstallment } from "@/domain/finance";
import { loadOrigin, saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { cancelDocument, queryDocument } from "@/domain/fiscal/service";
import { computeCompetence } from "@/domain/cashflow";
import { applySupplierReturnFinance, planReturnLines, receiptReturnLedger, receiptReturnsView, supplierReturnCfop } from "@/domain/supplier-returns";

/**
 * COM-11 — devolução a fornecedor a partir do RECEBIMENTO: quantidades devolvíveis, valores proporcionais com
 * fechamento de centavos, CFOP e chave referenciada, estoque e abatimento no contas a pagar uma única vez,
 * crédito com o fornecedor (título já pago), estorno no cancelamento e origem por pedido preservada.
 */

let store: Store;
let refs: DemoRefs;
let ctx: Ctx;
const MATRIZ_CNPJ = "11222333000181";
const TEXTIL_CNPJ = "45997418000153";
let nfeNumber = 88000;

const matriz = () => refs.branches.matriz.id;
const wh = () => refs.warehouses["matriz-main"];
const bal = async (skuKey: string) => (await store.get("stock_balances", detId("bal", wh().id, refs.skus[skuKey].id)))?.physical ?? 0;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  ctx = await refs.ctxFor("admin", "matriz");
}, 120000);

/**
 * Recebimento confirmado com XML de produção: boné (F-BONE, 3 un × R$ 10,00, CFOP do fornecedor configurável) e
 * caneca (3,5 un × R$ 9,99 → R$ 34,97), frete R$ 10,01 e outras despesas R$ 3,00.
 */
async function confirmedReceipt(opts: { dups?: Array<{ dVenc: string }>; cfop?: string; freight?: number; other?: number } = {}) {
  const number = ++nfeNumber;
  const xml = buildSampleNfeXml({
    number,
    issueDate: today(),
    environment: "producao",
    emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" },
    recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" },
    items: [
      { cProd: "F-BONE", xProd: "BONE ABA CURVA", qCom: 3000, vUnCom: 1000, cfop: opts.cfop ?? "5102" },
      { cProd: "X-CANECA", xProd: "CANECA 350ML", qCom: 3500, vUnCom: 999, cfop: opts.cfop ?? "5102" },
    ],
    freight: opts.freight ?? 1001,
    other: opts.other ?? 300,
    duplicatas: opts.dups,
  });
  const r = await importNfeXml(ctx, { xml, orderIds: [] });
  await updateReceipt(ctx, r.id, { items: [{ idx: 1, skuId: refs.skus["bone-u"].id }, { idx: 2, skuId: refs.skus["caneca-u"].id }], checkAll: true });
  const c = await confirmReceipt(ctx, r.id);
  expect(c.status).toBe("confirmed");
  return c;
}

/** Entrada da NF-e a partir do recebimento com as quantidades pedidas por item (idx → qtd); os demais itens saem. */
async function returnInput(receiptId: string, qty: Record<number, number>): Promise<NfeInput> {
  const pre = await loadOrigin(ctx, "receipt", receiptId, matriz());
  expect(pre.blockers).toEqual([]);
  const items = pre.input.items.filter((i) => qty[i.sourceIdx!] != null).map((i) => ({ ...i, qty: qty[i.sourceIdx!] }));
  return { ...pre.input, items };
}

async function authorize(input: NfeInput, idemKey: string) {
  let doc = await saveNfe(ctx, input, { idemKey, transmit: true });
  doc = await queryDocument(ctx, doc.id);
  expect(doc.status).toBe("authorized");
  return doc;
}

const insts = async (titleId: string) => (await listAll(store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number" }] })) as Doc[];
const abatements = async (titleId: string) => listAll(store, "settlements", { filters: [["eq", "titleId", titleId], ["eq", "kind", "abatement"]] });

describe("devolução a fornecedor pelo recebimento — prefill", () => {
  it("itens com quantidade devolvível, chave da NF-e de entrada, fornecedor como destinatário e CFOP 5202", async () => {
    const r = await confirmedReceipt();
    const pre = await loadOrigin(ctx, "receipt", r.id, matriz());
    expect(pre.blockers).toEqual([]);
    expect(pre.effectsLocked).toBe(false);
    expect(pre.input.purpose).toBe("devolucao");
    expect(pre.input.operationType).toBe("saida");
    expect(pre.input.recipient.partyType).toBe("supplier");
    expect(pre.input.recipient.partyId).toBe(r.supplierId);
    expect(pre.input.referencedKeys).toEqual([r.nfeKey]);
    expect(pre.input.items.map((i) => [i.sourceIdx, i.qty, i.cfop])).toEqual([[1, 3000, "5202"], [2, 3500, "5202"]]);
    expect(pre.returnable).toEqual({ 1: { received: 3000, returned: 0, max: 3000 }, 2: { received: 3500, returned: 0, max: 3500 } });
    expect(pre.input.effects.stock).toBe(true);
    expect(pre.input.effects.warehouseId).toBe(r.warehouseId);
  });

  it("CFOP: entrada com ST → 5411/6411; interestadual normal → 6202; CFOP de entrada do item prevalece", () => {
    expect(supplierReturnCfop({ supplierCfop: "5405", entryCfop: "1102", interstate: false })).toBe("5411");
    expect(supplierReturnCfop({ supplierCfop: "6403", entryCfop: "2102", interstate: true })).toBe("6411");
    expect(supplierReturnCfop({ supplierCfop: "6102", entryCfop: "2102", interstate: true })).toBe("6202");
    expect(supplierReturnCfop({ entryCfop: "1403", supplierCfop: "5102", interstate: false })).toBe("5411");
    expect(supplierReturnCfop({ itemEntryCfop: "1102", supplierCfop: "5405", interstate: false })).toBe("5202");
    expect(supplierReturnCfop({ itemEntryCfop: "2403", interstate: true })).toBe("6411");
  });

  it("recebimento com entrada sujeita a ST (CFOP do fornecedor 5405) sugere 5411", async () => {
    const r = await confirmedReceipt({ cfop: "5405" });
    const pre = await loadOrigin(ctx, "receipt", r.id, matriz());
    expect(pre.input.items.map((i) => i.cfop)).toEqual(["5411", "5411"]);
  });

  it("recebimento não concluído ou parâmetro desligado bloqueiam a origem", async () => {
    const xml = buildSampleNfeXml({ number: ++nfeNumber, issueDate: today(), environment: "producao", emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE", qCom: 1000, vUnCom: 1500 }] });
    const draft = await importNfeXml(ctx, { xml, orderIds: [] });
    expect((await loadOrigin(ctx, "receipt", draft.id, matriz())).blockers.join(" ")).toMatch(/não está concluído/);
    const r = await confirmedReceipt();
    await setSetting(store, refs.company.id, null, "feature.devolucaoFornecedor", false);
    try {
      expect((await loadOrigin(ctx, "receipt", r.id, matriz())).blockers.join(" ")).toMatch(/desativada/);
    } finally {
      await setSetting(store, refs.company.id, null, "feature.devolucaoFornecedor", true);
    }
    expect((await loadOrigin(ctx, "receipt", r.id, matriz())).blockers).toEqual([]);
  });
});

describe("devolução parcial e total: valores, estoque e abatimento", () => {
  let r: Doc;
  let titleId: string;
  const docs: Doc[] = [];

  it("parcial: 1 boné — valor proporcional, saída de estoque uma vez, abate a ÚLTIMA parcela", async () => {
    r = await confirmedReceipt({ dups: [{ dVenc: addDays(today(), 30) }, { dVenc: addDays(today(), 60) }] });
    titleId = r.payableTitleId;
    expect(titleId).toBeTruthy();
    const title0 = (await store.get("titles", titleId))!;
    expect(title0.total).toBe(r.dueTotal);
    const it1 = r.items.find((i: any) => i.idx === 1);
    const boneBefore = await bal("bone-u");
    const doc = await authorize(await returnInput(r.id, { 1: 1000 }), "sr-partial-1");
    docs.push(doc);
    const plan = doc.effects.supplierReturn;
    expect(plan.lines).toHaveLength(1);
    const l = plan.lines[0];
    expect(l.product).toBe(Math.round(it1.lineValue / 3));
    expect(l.freight).toBe(Math.round(it1.freightShare / 3));
    expect(l.other).toBe(Math.round(it1.otherShare / 3));
    expect(doc.total).toBe(plan.amount);
    expect(doc.items[0].cfop).toBe("5202");
    expect(doc.service.referencedKeys).toEqual([r.nfeKey]);
    // estoque: um movimento de saída por devolução ao fornecedor, pelo custo médio vigente
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originType", "fiscal_document"], ["eq", "originId", doc.id]] });
    expect(movs.map((m) => [m.type, m.qty])).toEqual([["supplier_return", -1000]]);
    expect(movs[0].unitCost).toBe(movs[0].avgCostAfter);
    expect(await bal("bone-u")).toBe(boneBefore - 1000);
    // abatimento: só a última parcela (maior vencimento), sem lançamento em conta
    const [p1, p2] = await insts(titleId);
    expect(p1.balance).toBe(p1.amount);
    expect(p2.balance).toBe(p2.amount - plan.amount);
    const ab = await abatements(titleId);
    expect(ab).toHaveLength(1);
    expect(ab[0]).toMatchObject({ installmentId: p2.id, principal: plan.amount, discount: plan.amount, total: 0, accountId: null, status: "active" });
    expect((await store.get("titles", titleId))!.balance).toBe(title0.total - plan.amount);
    expect(doc.effects.supplierReturn.result).toMatchObject({ abated: plan.amount, credited: 0 });
    // quantidade devolvida aparece no recebimento
    const view = await receiptReturnsView(store, refs.company.id, r);
    expect(view.rows.find((x) => x.idx === 1)).toMatchObject({ received: 3000, returned: 1000, inProgress: 0, rest: 2000 });
  });

  it("retentativa não abate nem baixa estoque de novo (marcador único; reaplicação após falha)", async () => {
    const doc = docs[0];
    const again = await applySupplierReturnFinance(ctx, doc);
    expect(again).toEqual(doc.effects.supplierReturn.result);
    // simula efeito não marcado como aplicado (falha depois do abatimento) e nova consulta ao provedor
    await store.update("fiscal_documents", doc.id, { effects: { ...doc.effects, appliedAt: null } });
    await queryDocument(ctx, doc.id);
    const cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.effects.appliedAt).toBeTruthy();
    expect(await abatements(titleId)).toHaveLength(1);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originType", "fiscal_document"], ["eq", "originId", doc.id]] })).toHaveLength(1);
    expect((await store.get("titles", titleId))!.balance).toBe(r.dueTotal - doc.total);
  });

  it("bloqueia devolver acima do restante (contando a devolução autorizada)", async () => {
    const pre = await loadOrigin(ctx, "receipt", r.id, matriz());
    expect(pre.returnable![1]).toEqual({ received: 3000, returned: 1000, max: 2000 });
    expect(pre.input.items.find((i) => i.sourceIdx === 1)!.qty).toBe(2000);
    const over = { ...pre.input, items: pre.input.items.map((i) => (i.sourceIdx === 1 ? { ...i, qty: 2001 } : i)) };
    await expect(saveNfe(ctx, over, { idemKey: "sr-over", transmit: false })).rejects.toThrow(/excede o restante devolvível/);
    // item que não é do recebimento
    const foreign = { ...pre.input, items: [{ skuId: refs.skus["caneca-u"].id, qty: 1000, unitPrice: 100, discount: 0 }] };
    await expect(saveNfe(ctx, foreign, { idemKey: "sr-foreign", transmit: false })).rejects.toThrow(/fora do recebimento/);
    // valores enviados pelo formulário são ignorados (vêm do recebimento)
    const forged = { ...pre.input, freight: 999999, items: pre.input.items.map((i) => ({ ...i, unitPrice: 1, discount: 0 })) };
    const d = await saveNfe(ctx, forged, { idemKey: "sr-forged", transmit: false });
    expect(d.total).toBe(d.effects.supplierReturn.amount);
    expect(d.items[0].unitPrice).toBe(r.items[0].unitCost);
    // rascunho em andamento é reaproveitado (uma NF-e em andamento por recebimento)
    const d2 = await saveNfe(ctx, pre.input, { idemKey: "sr-forged-2", transmit: false });
    expect(d2.id).toBe(d.id);
    expect((await loadOrigin(ctx, "receipt", r.id, matriz())).existingDocId).toBe(d.id);
    await cancelDocument(ctx, d.id, "Rascunho de teste descartado pelo usuário");
  });

  it("restante: 2 bonés + 1,5 caneca e depois 2 canecas — centavos fecham com o recebimento e o título zera", async () => {
    const d2 = await authorize(await returnInput(r.id, { 1: 2000, 2: 1500 }), "sr-partial-2");
    const d3 = await authorize(await returnInput(r.id, { 2: 2000 }), "sr-partial-3");
    docs.push(d2, d3);
    for (const d of [d2, d3]) expect(d.total).toBe(d.effects.supplierReturn.amount);
    const all = docs.flatMap((d) => d.effects.supplierReturn.lines);
    for (const it of r.items) {
      const ls = all.filter((l: any) => l.idx === it.idx);
      expect(ls.reduce((a: number, l: any) => a + l.qty, 0)).toBe(it.receivedQty);
      expect(ls.reduce((a: number, l: any) => a + l.product, 0)).toBe(it.lineValue);
      expect(ls.reduce((a: number, l: any) => a + l.freight, 0)).toBe(it.freightShare);
      expect(ls.reduce((a: number, l: any) => a + l.other, 0)).toBe(it.otherShare);
    }
    // soma das NF-e de devolução = valor devido do recebimento = título a pagar (zerado pelos abatimentos)
    expect(docs.reduce((a, d) => a + d.total, 0)).toBe(r.dueTotal);
    const t = (await store.get("titles", titleId))!;
    expect(t.balance).toBe(0);
    expect(t.status).toBe("paid");
    for (const p of await insts(titleId)) expect(p.balance).toBe(0);
    expect(await bal("bone-u")).toBeGreaterThanOrEqual(0);
    // nada mais a devolver
    const pre = await loadOrigin(ctx, "receipt", r.id, matriz());
    expect(pre.blockers.join(" ")).toMatch(/já foram devolvidos/);
    const ledger = await receiptReturnLedger(store, refs.company.id, r.id);
    expect(ledger.get(1)!.qty).toBe(3000);
    expect(ledger.get(2)!.qty).toBe(3500);
  });

  it("competência: o abatimento reduz a despesa da categoria do título a pagar", async () => {
    const m = today().slice(0, 7);
    const c = await computeCompetence(ctx, { fromMonth: m, toMonth: m });
    const row = c.rows.find((x) => x.source === "abatement" && x.type === "expense");
    expect(row).toBeTruthy();
    const abated = (await abatements(titleId)).filter((s) => s.status === "active").reduce((a, s) => a + s.principal, 0);
    expect(abated).toBe(r.dueTotal);
    expect(row!.total).toBeGreaterThanOrEqual(abated);
  });

  it("cancelamento estorna estoque (pelo custo de saída), abatimento e libera a quantidade", async () => {
    const d3 = docs[2];
    const canecaBefore = await bal("caneca-u");
    const out = (await listAll(store, "stock_movements", { filters: [["eq", "originType", "fiscal_document"], ["eq", "originId", d3.id]] }))[0];
    const cancelled = await cancelDocument(ctx, d3.id, "Fornecedor recusou a devolução das canecas");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.effects.reversedAt).toBeTruthy();
    const back = await listAll(store, "stock_movements", { filters: [["eq", "originType", "fiscal_document_cancel"], ["eq", "originId", d3.id]] });
    expect(back.map((m) => [m.type, m.qty, m.unitCost])).toEqual([["supplier_return_cancel", 2000, out.unitCost]]);
    expect(await bal("caneca-u")).toBe(canecaBefore + 2000);
    // abatimento estornado: título volta a ter o valor da NF-e cancelada em aberto
    const t = (await store.get("titles", titleId))!;
    expect(t.balance).toBe(d3.total);
    expect(t.status).toBe("partial");
    const ab = await abatements(titleId);
    expect(ab.filter((s) => s.operationId === d3.id).every((s) => s.status === "reversed")).toBe(true);
    // cancelar de novo não estorna duas vezes
    await cancelDocument(ctx, d3.id, "Fornecedor recusou a devolução das canecas");
    expect((await store.get("titles", titleId))!.balance).toBe(d3.total);
    // a quantidade volta a ser devolvível
    const pre = await loadOrigin(ctx, "receipt", r.id, matriz());
    expect(pre.returnable![2]).toMatchObject({ returned: 1500, max: 2000 });
  });
});

describe("título já pago: crédito com o fornecedor", () => {
  it("devolução após o pagamento gera título a receber do fornecedor; cancelamento cancela o crédito", async () => {
    const r = await confirmedReceipt();
    const title = (await store.get("titles", r.payableTitleId))!;
    await approvePayable(ctx, title.id);
    const [p] = await insts(title.id);
    await settleInstallment(ctx, { installmentId: p.id, date: today(), principal: p.amount, accountId: refs.accounts.banco.id, idemKey: `sr-pay-${p.id}` });
    expect((await store.get("titles", title.id))!.status).toBe("paid");
    const doc = await authorize(await returnInput(r.id, { 1: 1000 }), "sr-paid-1");
    const res = doc.effects.supplierReturn.result;
    expect(res).toMatchObject({ abated: 0, credited: doc.total, unmatched: 0 });
    const credit = (await store.get("titles", res.creditTitleId))!;
    expect(credit).toMatchObject({ kind: "receivable", partyType: "supplier", partyId: r.supplierId, originType: "supplier_return", originId: doc.id, operationId: title.id, total: doc.total, status: "open" });
    expect(await abatements(title.id)).toHaveLength(0);
    // retentativa não cria outro crédito
    await applySupplierReturnFinance(ctx, doc);
    expect(await listAll(store, "titles", { filters: [["eq", "originType", "supplier_return"], ["eq", "originId", doc.id]] })).toHaveLength(1);
    await cancelDocument(ctx, doc.id, "Devolução cancelada antes do envio da mercadoria");
    expect((await store.get("titles", credit.id))!.status).toBe("cancelled");
  });

  it("pagamento parcial: abate o saldo em aberto e credita só o excedente", async () => {
    const r = await confirmedReceipt({ freight: 0, other: 0 });
    const title = (await store.get("titles", r.payableTitleId))!;
    await approvePayable(ctx, title.id);
    const [p] = await insts(title.id);
    // paga tudo menos R$ 5,00
    await settleInstallment(ctx, { installmentId: p.id, date: today(), principal: p.amount - 500, accountId: refs.accounts.banco.id, idemKey: `sr-pay-part-${p.id}` });
    const doc = await authorize(await returnInput(r.id, { 1: 1000 }), "sr-paid-part");
    // 1 boné = R$ 10,00 → R$ 5,00 abatidos + R$ 5,00 de crédito
    expect(doc.total).toBe(1000);
    expect(doc.effects.supplierReturn.result).toMatchObject({ abated: 500, credited: 500 });
    expect((await store.get("titles", title.id))!.balance).toBe(0);
  });
});

describe("cálculo proporcional (unidade)", () => {
  it("fecha os centavos na devolução do restante", () => {
    const items: any[] = [{ idx: 1, skuId: "s", receivedQty: 3000, unitCost: 333, lineValue: 1000, freightShare: 1, otherShare: 2, discountShare: 1, description: "X" }];
    const a = planReturnLines(items, new Map(), [{ idx: 1, qty: 1000 }]);
    expect(a[0]).toMatchObject({ product: 333, freight: 0, other: 1, discount: 0 });
    const led = new Map([[1, { qty: 1000, product: 333, discount: 0, freight: 0, other: 1, value: 334 }]]);
    const b = planReturnLines(items, led, [{ idx: 1, qty: 1000 }]);
    expect(b[0]).toMatchObject({ product: 333, freight: 0, other: 1, discount: 0 });
    const led2 = new Map([[1, { qty: 2000, product: 666, discount: 0, freight: 0, other: 2, value: 668 }]]);
    const c = planReturnLines(items, led2, [{ idx: 1, qty: 1000 }]);
    expect(c[0]).toMatchObject({ product: 334, freight: 1, other: 0, discount: 1, value: 334 });
    expect(() => planReturnLines(items, led2, [{ idx: 1, qty: 1001 }])).toThrow(/excede/);
  });
});

describe("origem pelo pedido de compra continua igual", () => {
  it("pedido de compra: itens recebidos, CFOP 5202, sem abatimento automático", async () => {
    const po = await store.create("purchase_orders", { companyId: refs.company.id, branchId: matriz(), number: 99001, supplierId: refs.suppliers.textil.id, warehouseId: wh().id, status: "received" });
    await store.create("purchase_order_items", { companyId: refs.company.id, branchId: matriz(), orderId: po.id, seq: 1, skuId: refs.skus["bone-u"].id, qty: 2000, receivedQty: 2000, unitCost: 1500, description: "Boné" });
    const pre = await loadOrigin(ctx, "purchase_order", po.id, matriz());
    expect(pre.blockers).toEqual([]);
    expect(pre.input.items.map((i) => [i.qty, i.unitPrice])).toEqual([[2000, 1500]]);
    expect(pre.input.effects.stock).toBe(true);
    const doc = await saveNfe(ctx, pre.input, { idemKey: "sr-po-1", transmit: false });
    expect(doc.items[0].cfop).toBe("5202");
    expect(doc.effects.supplierReturn ?? null).toBeNull();
    expect(doc.effects.stock).toBe(true);
    expect(doc.total).toBe(3000);
  });
});
