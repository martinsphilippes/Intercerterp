import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { addDays, today } from "@/lib/dates";
import { QTY } from "@/lib/money";
import { featureDefault, isFeatureOn, setSetting } from "@/lib/core/settings";
import { openSession } from "@/domain/cash";
import { adjustStock, balanceId, availableMap, postMovements } from "@/domain/stock";
import { cancelCart, cartToSaleInput, createCart, parkCart, releaseExpiredPresales, resumeCart, saveCart } from "@/domain/carts";
import { cartTotals } from "@/domain/cart-calc";
import { cancelSale, finalizeSale, processReturn, returnableItems, type FinalizeSaleInput } from "@/domain/sales";
import { createTransfer, receiveTransfer, shipTransfer } from "@/domain/transfers";
import { concludeInventory, createInventory, saveCounts } from "@/domain/inventory";
import { confirmReceipt, createManualReceipt, importNfeXml, updateReceipt } from "@/domain/receipts";
import { buildSampleNfeXml, parseNfeXml } from "@/domain/nfe-xml";
import { getFiscalConfig, toProviderPayload } from "@/domain/fiscal/service";
import { balanceLots, listLots, lotExpiryOccurrence, lotsFromLedger, notifyLotExpiry, setLotControl } from "@/domain/lots";
import { allocateBack, allocateExit, lotsTotal, targetSplit, unlottedQty } from "@/domain/lot-calc";
import { applyScan, emptyScan, findScanItem, parseScanInput, scanTotal, setScanCount, undoScan } from "@/domain/count-scan";
import { seed as seedLots } from "@/domain/seed/modules/lots";

/**
 * Fase 6 — lotes e validades (EST-02), reserva de estoque na pré-venda (VEN-03) e bipagem na contagem (EST-04).
 * Demonstração: "Iogurte Natural 170 g" com lotes L-A (vence em 10 dias) e L-B (vence em 60 dias) na Matriz.
 */

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;
let iogurte: Doc;

const wh = () => refs.warehouses["matriz-main"].id;
const lotsOf = async (warehouseId = wh(), skuId = iogurte.id) => {
  const b = await balanceLots(store, warehouseId, skuId);
  return { ...b, map: Object.fromEntries(b.lots.map((l) => [l.lot, l.qty])) };
};
/** saldo por lote coerente: Σ lotes + sem lote = físico, e os lotes do saldo = reconstrução pelos movimentos */
async function expectCoherent(warehouseId = wh(), skuId = iogurte.id) {
  const b = await store.getOrThrow("stock_balances", balanceId(warehouseId, skuId));
  const lots = b.lots ?? [];
  expect(lotsTotal(lots) + unlottedQty(b.physical, lots)).toBe(b.physical);
  const ledger = await lotsFromLedger(store, warehouseId, skuId);
  expect(ledger.map((l) => [l.lot, l.qty])).toEqual(lots.map((l: any) => [l.lot, l.qty]));
}

async function sellIogurte(idemKey: string, qty: number, lot?: string | null, ctx = cashier) {
  const total = 449 * (qty / QTY);
  return finalizeSale(ctx, { idemKey, terminalId, items: [{ skuId: iogurte.id, qty, ...(lot ? { lot } : {}) }], payments: [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }] } as FinalizeSaleInput);
}

beforeEach(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  terminalId = refs.terminals.cx1.id;
  await openSession(cashier, { terminalId, openingFund: 10000 });
  await seedLots(refs);
  iogurte = (await listAll(store, "skus", { filters: [["eq", "sku", "IOGURTE"]] }))[0];
});

describe("cálculos puros de lote", () => {
  it("FEFO, lote preferido, vencidos por último, sem lote e saída sem saldo", () => {
    const lots = [
      { lot: "B", expiry: "2026-12-01", qty: 5000 },
      { lot: "A", expiry: "2026-11-01", qty: 3000 },
      { lot: "V", expiry: "2026-01-01", qty: 2000 },
    ];
    expect(allocateExit(lots, 12000, 4000, null, "2026-10-14")).toEqual([{ lot: "A", expiry: "2026-11-01", mfg: null, qty: 3000 }, { lot: "B", expiry: "2026-12-01", mfg: null, qty: 1000 }]);
    expect(allocateExit(lots, 12000, 2000, "B", "2026-10-14").map((p) => [p.lot, p.qty])).toEqual([["B", 2000]]);
    // 3 + 5 nos lotes válidos, 2 sem lote (12 − 10), depois o vencido, depois sem saldo
    expect(allocateExit(lots, 12000, 14000, null, "2026-10-14").map((p) => [p.lot, p.qty])).toEqual([["A", 3000], ["B", 5000], [null, 4000], ["V", 2000]]);
    expect(allocateBack([{ lot: "A", qty: -3000 }, { lot: "B", qty: -1000 }], [{ lot: "A", qty: 2500 }], 2000).map((p) => [p.lot, p.qty])).toEqual([["A", 500], ["B", 1000], [null, 500]]);
    expect(targetSplit([{ lot: "A", expiry: null, qty: 3000 }], [{ lot: "A", qty: 1000 }, { lot: "C", qty: 4000 }], 1000).map((p) => [p.lot, p.qty])).toEqual([["A", -2000], ["C", 4000], [null, -1000]]);
  });
});

describe("EST-02 — lotes e validades", () => {
  it("demonstração idempotente: 2 lotes de validades diferentes, saldo por lote igual à reconstrução pelos movimentos", async () => {
    await seedLots(refs);
    const l = await lotsOf();
    expect(l.physical).toBe(60 * QTY);
    expect(l.lots.map((x) => [x.lot, x.qty, x.expiry])).toEqual([["L-A", 24 * QTY, addDays(today(), 10)], ["L-B", 36 * QTY, addDays(today(), 60)]]);
    expect(l.unlotted).toBe(0);
    await expectCoherent();
  });

  it("entrada por lote (ajuste e recebimento por XML com rastro), sem lote vira saldo sem lote", async () => {
    await adjustStock(admin, { warehouseId: wh(), skuId: iogurte.id, type: "manual_in", qty: 5 * QTY, unitCost: 190, reason: "Entrada avulsa", idemKey: "in-c", lot: "L-C", lotExpiry: addDays(today(), 5) });
    await adjustStock(admin, { warehouseId: wh(), skuId: iogurte.id, type: "manual_in", qty: 2 * QTY, unitCost: 190, reason: "Sem lote", idemKey: "in-nolot" });
    let l = await lotsOf();
    expect(l.map["L-C"]).toBe(5 * QTY);
    expect(l.unlotted).toBe(2 * QTY);
    // XML com dois lotes no item (grupo rastro) → dois lotes no estoque; o primeiro preenche a conferência
    const xml = buildSampleNfeXml({ number: 7001, issueDate: today(), emitter: { cnpj: "33000167000101", name: "Laticínios" }, recipient: { cnpj: "11222333000181", name: "Intercert" }, items: [{ cProd: "IOG", cEAN: iogurte.barcode, xProd: "IOGURTE", qCom: 10 * QTY, vUnCom: 190 }] })
      .replace("<indTot>1</indTot></prod>", `<indTot>1</indTot><rastro><nLote>X-1</nLote><qLote>4.000</qLote><dFab>${addDays(today(), -3)}</dFab><dVal>${addDays(today(), 40)}</dVal></rastro><rastro><nLote>X-2</nLote><qLote>6.000</qLote><dFab>${addDays(today(), -1)}</dFab><dVal>${addDays(today(), 50)}</dVal></rastro></prod>`);
    expect(parseNfeXml(xml).items[0].rastro.map((r) => [r.nLote, r.qLote])).toEqual([["X-1", 4 * QTY], ["X-2", 6 * QTY]]);
    const r = await importNfeXml(admin, { xml, withoutOrder: true });
    expect(r.items[0].lot).toBe("X-1");
    expect(r.items[0].expiry).toBe(addDays(today(), 40));
    if (!r.items[0].skuId) await updateReceipt(admin, r.id, { items: [{ idx: 1, skuId: iogurte.id }] });
    await updateReceipt(admin, r.id, { checkAll: true });
    await confirmReceipt(admin, r.id);
    l = await lotsOf();
    expect(l.map["X-1"]).toBe(4 * QTY);
    expect(l.map["X-2"]).toBe(6 * QTY);
    expect(l.lots.find((x) => x.lot === "X-1")?.mfg).toBe(addDays(today(), -3));
    await expectCoherent();
  });

  it("recebimento manual de produto com controle exige o lote (recurso ligado); digitado na conferência entra no lote", async () => {
    const r = await createManualReceipt(admin, { supplierId: refs.suppliers.papel.id, orderIds: [], idemKey: "rc-lot", items: [{ skuId: iogurte.id, qty: 12 * QTY, unitCost: 180 }] });
    await updateReceipt(admin, r.id, { checkAll: true });
    await expect(confirmReceipt(admin, r.id)).rejects.toThrow(/Informe o lote/);
    await updateReceipt(admin, r.id, { items: [{ idx: 1, lot: "L-D", expiry: addDays(today(), 90) }] });
    await confirmReceipt(admin, r.id);
    const mov = (await listAll(store, "stock_movements", { filters: [["eq", "originId", r.id]] }))[0];
    expect(mov.lot).toBe("L-D");
    expect(mov.lotExpiry).toBe(addDays(today(), 90));
    expect((await lotsOf()).map["L-D"]).toBe(12 * QTY);
  });

  it("venda baixa por FEFO; lote escolhido no PDV; NFC-e e NF-e levam o rastro; devolução e cancelamento voltam ao lote", async () => {
    const s1 = await sellIogurte("v-fefo", 30 * QTY);
    let l = await lotsOf();
    expect(l.map).toEqual({ "L-B": 30 * QTY }); // 24 do L-A (vence antes) + 6 do L-B
    const mov = await store.getOrThrow("stock_movements", detId("mov", `sale:${s1.id}:1`));
    expect(mov.lots.map((p: any) => [p.lot, p.qty])).toEqual([["L-A", -24 * QTY], ["L-B", -6 * QTY]]);
    // rastro no item da NFC-e (e no payload do provedor)
    const doc = await store.getOrThrow("fiscal_documents", (await store.getOrThrow("sales", s1.id)).fiscalDocumentId);
    expect(doc.items[0].rastro.map((r: any) => [r.nLote, r.qLote, r.dVal])).toEqual([["L-A", 24 * QTY, addDays(today(), 10)], ["L-B", 6 * QTY, addDays(today(), 60)]]);
    const payload = toProviderPayload(doc, await store.getOrThrow("companies", refs.company.id), await store.get("branches", doc.branchId), await getFiscalConfig(store, refs.company.id, doc.branchId));
    expect(payload.items[0].rastros[0]).toMatchObject({ numero_lote: "L-A", quantidade_lote: 24, data_validade: addDays(today(), 10) });
    // devolução de 4: volta ao lote de onde saiu primeiro (L-A)
    const [line] = await returnableItems(store, s1.id);
    await processReturn(cashier, { saleId: s1.id, idemKey: "dev-1", reason: "vencido", compensation: "refund", refundMethod: "cash", terminalId, items: [{ saleItemId: line.id, qty: 4 * QTY, condition: "resellable" }] });
    l = await lotsOf();
    expect(l.map).toEqual({ "L-A": 4 * QTY, "L-B": 30 * QTY });
    await expectCoherent();

    // lote escolhido: 5 do L-B mesmo com L-A disponível
    const s2 = await sellIogurte("v-lot", 5 * QTY, "L-B");
    l = await lotsOf();
    expect(l.map).toEqual({ "L-A": 4 * QTY, "L-B": 25 * QTY });
    expect((await listAll(store, "sale_items", { filters: [["eq", "saleId", s2.id]] }))[0].lot).toBe("L-B");
    // lote escolhido sem saldo suficiente / inexistente / vencido são recusados
    await expect(sellIogurte("v-lot-x", 5 * QTY, "L-A")).rejects.toThrow(/lote L-A com saldo 4/);
    await expect(sellIogurte("v-lot-y", 1 * QTY, "NAO-EXISTE")).rejects.toThrow(/sem saldo no depósito/);
    await adjustStock(admin, { warehouseId: wh(), skuId: iogurte.id, type: "manual_in", qty: 3 * QTY, unitCost: 190, reason: "Lote vencido", idemKey: "in-v", lot: "L-V", lotExpiry: addDays(today(), -2) });
    await expect(sellIogurte("v-lot-z", 1 * QTY, "L-V")).rejects.toThrow(/vencido/);
    // FEFO automático não vende o vencido enquanto houver lote válido
    await sellIogurte("v-fefo2", 6 * QTY);
    l = await lotsOf();
    expect(l.map).toEqual({ "L-V": 3 * QTY, "L-B": 23 * QTY });

    // cancelamento devolve exatamente os lotes da venda
    await cancelSale(manager, s2.id, "desistiu");
    l = await lotsOf();
    expect(l.map).toEqual({ "L-V": 3 * QTY, "L-B": 28 * QTY });
    await expectCoherent();
  });

  it("transferência leva os lotes; inventário por lote leva os lotes às quantidades contadas", async () => {
    const shopping = await refs.ctxFor("stockist", "shopping");
    const matriz = await refs.ctxFor("stockist", "matriz");
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: iogurte.id, qty: 30 * QTY }] }, { idemKey: "tr-lot" });
    await shipTransfer(matriz, t.id);
    expect((await lotsOf()).map).toEqual({ "L-B": 30 * QTY });
    const dest = refs.warehouses["shopping-main"].id;
    await receiveTransfer(shopping, t.id, { idemKey: "rcv-lot", lines: [{ skuId: iogurte.id, receivedQty: 28 * QTY, damagedQty: 2 * QTY }] });
    expect((await lotsOf(dest)).map).toEqual({ "L-A": 24 * QTY, "L-B": 4 * QTY });
    expect((await lotsOf(refs.warehouses["shopping-damaged"].id)).map).toEqual({ "L-B": 2 * QTY });
    await expectCoherent(dest);

    // inventário na Matriz: contados 20 do L-B e 3 de um lote achado na contagem (L-N); total 23 (esperado 30)
    const inv = await createInventory(manager, { warehouseId: wh(), scope: "category", categoryId: (await store.getOrThrow("products", iogurte.productId)).categoryId }, { idemKey: "inv-lot" });
    await saveCounts(manager, inv.id, [{ skuId: iogurte.id, qty: 23 * QTY, lots: [{ lot: "L-B", qty: 20 * QTY }, { lot: "L-N", expiry: addDays(today(), 15), qty: 3 * QTY }] }]);
    const c = await store.getOrThrow("inventory_counts", detId("invcount", inv.id, iogurte.id));
    expect(c.countedQty).toBe(23 * QTY);
    expect(c.difference).toBe(-7 * QTY);
    await concludeInventory(manager, inv.id);
    const l = await lotsOf();
    expect(l.physical).toBe(23 * QTY);
    expect(l.map).toEqual({ "L-N": 3 * QTY, "L-B": 20 * QTY });
    expect(l.unlotted).toBe(0);
    await expectCoherent();
  });

  it("inventário sem diferença no total reclassifica os lotes (movimento de quantidade zero)", async () => {
    const inv = await createInventory(manager, { warehouseId: wh(), scope: "category", categoryId: (await store.getOrThrow("products", iogurte.productId)).categoryId }, { idemKey: "inv-zero" });
    await saveCounts(manager, inv.id, [{ skuId: iogurte.id, qty: 60 * QTY, lots: [{ lot: "L-A", qty: 20 * QTY }, { lot: "L-B", qty: 40 * QTY }] }]);
    await concludeInventory(manager, inv.id);
    const l = await lotsOf();
    expect(l.physical).toBe(60 * QTY);
    expect(l.map).toEqual({ "L-A": 20 * QTY, "L-B": 40 * QTY });
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originType", "inventory"], ["eq", "originId", inv.id]] });
    expect(movs).toHaveLength(1);
    expect(movs[0].qty).toBe(0);
    expect((await store.getOrThrow("inventories", inv.id)).summary.itemsAdjusted).toBe(0);
    await expectCoherent();
  });

  it("alerta diário: lote a vencer e vencido geram uma ocorrência cada (idempotente); zerado ou recurso desligado resolve", async () => {
    await adjustStock(admin, { warehouseId: wh(), skuId: iogurte.id, type: "manual_in", qty: 2 * QTY, unitCost: 190, reason: "Vencido", idemKey: "in-venc", lot: "L-V", lotExpiry: addDays(today(), -1) });
    const r1 = await notifyLotExpiry(store, refs.company.id);
    expect(r1.lots).toBe(2); // L-A (10 dias ≤ 30) e L-V (vencido); L-B (60 dias) fora
    const notifs = async (status = "open") => (await listAll(store, "notifications", { filters: [["eq", "companyId", refs.company.id], ["eq", "occurrenceStatus", status]] })).filter((n) => String(n.occurrenceKey).startsWith("lot_expiry:"));
    const keys = new Set((await notifs()).map((n) => n.occurrenceKey));
    const balId = balanceId(wh(), iogurte.id);
    expect(keys).toEqual(new Set([lotExpiryOccurrence({ balanceId: balId, lot: "L-A" }, "expiring"), lotExpiryOccurrence({ balanceId: balId, lot: "L-V" }, "expired")]));
    const count = (await notifs()).length;
    await notifyLotExpiry(store, refs.company.id);
    expect((await notifs()).length).toBe(count); // sem duplicar
    // perda do lote vencido zera o lote → ocorrência resolvida
    await adjustStock(admin, { warehouseId: wh(), skuId: iogurte.id, type: "loss", qty: 2 * QTY, reason: "Descarte de vencido", idemKey: "loss-v", lot: "L-V" });
    expect((await lotsOf()).map["L-V"]).toBeUndefined();
    await notifyLotExpiry(store, refs.company.id);
    expect(new Set((await notifs()).map((n) => n.occurrenceKey))).toEqual(new Set([lotExpiryOccurrence({ balanceId: balId, lot: "L-A" }, "expiring")]));
    // relatório de validades
    expect((await listLots(store, refs.company.id, { alertDays: 30, status: "attention" })).map((r) => r.lot)).toEqual(["L-A"]);
    // recurso desligado: nada avisado e ocorrências resolvidas
    await setSetting(store, refs.company.id, null, "feature.lotes", false);
    expect((await notifyLotExpiry(store, refs.company.id)).lots).toBe(0);
    expect(await notifs()).toHaveLength(0);
  });
});

describe("VEN-03 — reserva de estoque na pré-venda", () => {
  const caneca = () => refs.skus["caneca-u"];
  const available = async () => (await availableMap(store, refs.branches.matriz.id, [caneca().id])).get(caneca().id)!.available;
  const active = async (cartId: string) => listAll(store, "stock_reservations", { filters: [["eq", "originType", "cart"], ["eq", "originId", cartId], ["eq", "status", "active"]] });
  async function parkedCart(qty = 3 * QTY) {
    const cart = await createCart(cashier, terminalId);
    await saveCart(cashier, cart.id, { items: [{ skuId: caneca().id, qty, listPrice: 3490 }] });
    const { parked } = await parkCart(cashier, cart.id, "Cliente balcão");
    return parked;
  }

  it("desligado (padrão): pré-venda não reserva — comportamento atual", async () => {
    const before = await available();
    const p = await parkedCart();
    expect(p.reservation.enabled).toBe(false);
    expect(await active(p.id)).toHaveLength(0);
    expect(await available()).toBe(before);
  });

  it("ligado: reserva ao salvar, consumida na conclusão da venda (a própria reserva conta como disponível)", async () => {
    await setSetting(store, refs.company.id, null, "feature.reservaPreVenda", true);
    const before = await available();
    const p = await parkedCart(before); // reserva todo o disponível
    expect((await active(p.id)).reduce((a, r) => a + r.qty, 0)).toBe(before);
    expect(await available()).toBe(0);
    // outro atendimento não consegue vender a caneca reservada
    await expect(finalizeSale(cashier, { idemKey: "outra", terminalId, items: [{ skuId: caneca().id, qty: QTY }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 3490 }] })).rejects.toThrow(/Estoque insuficiente/);
    const resumed = await resumeCart(cashier, p.id, terminalId);
    const total = cartTotals(resumed as any).total;
    const sale = await finalizeSale(cashier, cartToSaleInput(resumed, [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }]));
    expect(sale.status).toBe("completed");
    expect(await active(p.id)).toHaveLength(0);
    const all = await listAll(store, "stock_reservations", { filters: [["eq", "originType", "cart"], ["eq", "originId", p.id]] });
    expect(all.every((r) => r.status === "consumed")).toBe(true);
    const bal = await store.getOrThrow("stock_balances", balanceId(wh(), caneca().id));
    expect(bal.reserved).toBe(0);
    expect(bal.physical).toBe(0);
  });

  it("ligado: cancelamento e expiração liberam; reserva parcial quando falta disponível", async () => {
    await setSetting(store, refs.company.id, null, "feature.reservaPreVenda", true);
    const before = await available();
    const p1 = await parkedCart(2 * QTY);
    expect(await available()).toBe(before - 2 * QTY);
    await cancelCart(cashier, p1.id, "desistiu");
    expect(await active(p1.id)).toHaveLength(0);
    expect(await available()).toBe(before);

    const p2 = await parkedCart(before + 5 * QTY); // mais que o disponível: reserva parcial
    expect(p2.reservation.shortage[0].missing).toBe(5 * QTY);
    expect(await available()).toBe(0);
    // ainda dentro da validade: a rotina não libera
    expect((await releaseExpiredPresales(store, refs.company.id)).released).toBe(0);
    const later = new Date(Date.parse(p2.expiresAt) + 60000).toISOString();
    expect((await releaseExpiredPresales(store, refs.company.id, later)).released).toBe(1);
    expect(await active(p2.id)).toHaveLength(0);
    expect(await available()).toBe(before);
    expect((await store.getOrThrow("carts", p2.id)).status).toBe("parked"); // continua na gaveta (expirada)
  });
});

describe("EST-04 — bipagem na contagem", () => {
  it("cada leitura soma 1 (ou a quantidade informada), acumula por item, desfaz e corrige", () => {
    const items = [{ skuId: "a", sku: "CAD", barcode: "789001" }, { skuId: "b", sku: "CAN", barcode: "789002", extraBarcodes: ["DUN-14"] }];
    expect(findScanItem(items, "789002")?.skuId).toBe("b");
    expect(findScanItem(items, "DUN-14")?.skuId).toBe("b");
    expect(findScanItem(items, "cad")?.skuId).toBe("a");
    expect(findScanItem(items, "000")).toBeNull();
    expect(parseScanInput("6*789001")).toEqual({ code: "789001", qty: 6 * QTY });
    expect(parseScanInput("2,5x789001")).toEqual({ code: "789001", qty: 2500 });
    expect(parseScanInput("789001")).toEqual({ code: "789001", qty: null });
    let s = emptyScan();
    s = applyScan(s, "a");
    s = applyScan(s, "a");
    s = applyScan(s, "b", 6 * QTY);
    s = applyScan(s, "a");
    expect(s.counts).toEqual({ a: 3 * QTY, b: 6 * QTY });
    s = undoScan(s);
    expect(s.counts.a).toBe(2 * QTY);
    s = setScanCount(s, "b", 4 * QTY); // correção
    expect(s.counts.b).toBe(4 * QTY);
    s = undoScan(s);
    expect(s.counts.b).toBe(6 * QTY);
    expect(scanTotal(s, "a", 5 * QTY, "add")).toBe(7 * QTY);
    expect(scanTotal(s, "a", 5 * QTY, "replace")).toBe(2 * QTY);
    expect(applyScan(s, "a", 0)).toBe(s);
  });
});

describe("parâmetros e produto sem controle de lote", () => {
  it("padrões: lotes e reserva da pré-venda desligados, bipagem ligada; controle de lote exige o recurso", async () => {
    expect(featureDefault("lotes")).toBe(false);
    expect(featureDefault("reservaPreVenda")).toBe(false);
    expect(featureDefault("bipagemContagem")).toBe(true);
    expect(featureDefault("documentoComercial")).toBe(true);
    const fresh = freshStore();
    const r2 = await seedBase(fresh);
    expect(await isFeatureOn(fresh, r2.company.id, null, "lotes", featureDefault("lotes"))).toBe(false);
    const a2 = await r2.ctxFor("admin", "matriz");
    await expect(setLotControl(a2, r2.products.caneca.id, true)).rejects.toThrow(/desligado/);
  });

  it("produto sem controle: movimentos sem divisão por lote e saldo sem lotes (comportamento atual); lote do PDV ignorado", async () => {
    const caneca = refs.skus["caneca-u"];
    const s = await finalizeSale(cashier, { idemKey: "sem-lote", terminalId, items: [{ skuId: caneca.id, qty: QTY, lot: "QUALQUER" }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 3490 }] });
    const mov = await store.getOrThrow("stock_movements", detId("mov", `sale:${s.id}:1`));
    expect(mov.lots ?? null).toBeNull();
    expect(mov.lot).toBeNull();
    expect((await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] }))[0].lot ?? null).toBeNull();
    const bal = await store.getOrThrow("stock_balances", balanceId(wh(), caneca.id));
    expect(bal.lots ?? null).toBeNull();
    // ajuste manual com lote informativo continua só informativo
    await postMovements(admin, [{ warehouseId: wh(), skuId: caneca.id, qty: QTY, type: "manual_in", idemKey: "info-lot", lot: "INFO", lotExpiry: "2027-01-01" }]);
    const m2 = await store.getOrThrow("stock_movements", detId("mov", "info-lot"));
    expect(m2.lot).toBe("INFO");
    expect(m2.lots ?? null).toBeNull();
    expect((await store.getOrThrow("stock_balances", balanceId(wh(), caneca.id))).lots ?? null).toBeNull();
  });

  it("recurso desligado: lote escolhido no PDV é ignorado (FEFO) e desligar o controle exige lotes zerados", async () => {
    await expect(setLotControl(admin, iogurte.productId, false)).rejects.toThrow(/saldo em lotes/);
    await setSetting(store, refs.company.id, null, "feature.lotes", false);
    const s = await sellIogurte("off-lot", 2 * QTY, "L-B");
    expect((await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] }))[0].lot ?? null).toBeNull();
    expect((await lotsOf()).map).toEqual({ "L-A": 22 * QTY, "L-B": 36 * QTY });
    await expectCoherent();
  });
});
