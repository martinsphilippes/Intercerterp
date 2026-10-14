import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { addDays, today } from "@/lib/dates";
import { searchable } from "@/lib/core/text";
import { setSetting } from "@/lib/core/settings";
import { openSession } from "@/domain/cash";
import { availableMap, balanceId, postMovements, reserve } from "@/domain/stock";
import { applySaleEffects, cancelSale, finalizeSale, prepareSale, processReturn, returnableItems, type SaleItemInput } from "@/domain/sales";
import { createWarehouse, lifoReturnParts, allocateSplit, setBranchDefaultWarehouse, setWarehouseStatus, updateWarehouse, whTag } from "@/domain/warehouses";
import { transferBetweenWarehouses, cancelTransfer } from "@/domain/transfers";
import { confirmReceipt, createManualReceipt, updateReceipt } from "@/domain/receipts";
import { updateTerminal } from "@/domain/terminals";
import { priceScopeKey } from "@/domain/pricing";
import { saveComponent, setComposition } from "@/domain/product-components";
import { seed as seedLots } from "@/domain/seed/modules/lots";
import { seed as seedWarehouses } from "@/domain/seed/modules/warehouses";

/**
 * §39 — cadastro de depósitos por filial, venda com complemento do almoxarifado, devolução/cancelamento aos
 * depósitos de origem, recebimento no depósito escolhido e transferência entre depósitos da mesma filial.
 */

const QTY = 1000;
let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let cashier: Ctx;
let stockist: Ctx;
let terminalId: string;
let princ: Doc;

const sku = (k: string) => refs.skus[k].id;
const bal = async (warehouseId: string, skuId: string) => (await store.get("stock_balances", balanceId(warehouseId, skuId))) ?? ({ physical: 0, reserved: 0, avgCost: 0, lots: [] } as any);
const phys = async (warehouseId: string, skuId: string) => (await bal(warehouseId, skuId)).physical as number;
const avail = async (skuId: string) => (await availableMap(store, refs.branches.matriz.id, [skuId])).get(skuId)?.available ?? 0;
const movesOf = (originId: string) => listAll(store, "stock_movements", { filters: [["eq", "originId", originId]] });

async function stockIn(warehouseId: string, skuId: string, qty: number, unitCost: number, key: string, lot?: { lot: string; expiry: string }) {
  await postMovements(admin, [{ warehouseId, skuId, qty, type: "manual_in", unitCost, reason: "teste", idemKey: key, ...(lot ? { lot: lot.lot, lotExpiry: lot.expiry } : {}) }]);
}

/** Zera o disponível do SKU no depósito principal (saída manual do físico). */
async function emptyPrinc(skuId: string, key: string) {
  const p = await phys(princ.id, skuId);
  if (p > 0) await postMovements(admin, [{ warehouseId: princ.id, skuId, qty: -p, type: "manual_out", reason: "teste", idemKey: key }]);
}

async function sell(idemKey: string, items: SaleItemInput[], extra: Record<string, any> = {}) {
  const prep = await prepareSale(cashier, { idemKey, terminalId, items, payments: [] });
  const total = prep.calc.total;
  return finalizeSale(cashier, { idemKey, terminalId, items, payments: [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }], ...extra });
}

async function almox(code = "ALM", priority = 2) {
  return createWarehouse(manager, refs.branches.matriz.id, { name: `Almoxarifado ${code}`, code, type: "storage", salePriority: priority }, { idemKey: `wh-${code}` });
}

/** Produto simples com preço (para kits e cenários com saldo controlado). */
async function product(key: string, name: string, price: number) {
  const base = { companyId: refs.company.id, createdBy: refs.users.admin.id };
  const ref = refs.products["caderno"];
  const p = await refs.seeder.put("products", key, {
    ...base, type: "product", code: key.toUpperCase(), name, unitCode: "UN", categoryId: ref.categoryId, active: true, availablePdv: true, hasVariants: false, variantAxes: [],
    ncm: "48202000", origin: "0", taxGroupId: ref.taxGroupId, searchText: searchable(name, key), status: "active",
  });
  const k = await refs.seeder.put("skus", `${key}-u`, { ...base, productId: p.id, sku: key.toUpperCase(), attributes: {}, name, unitCode: "UN", active: true, costAcquisition: 0, costAdditional: 0, costTotal: 0, searchText: searchable(name, key) });
  await refs.seeder.put("prices", `varejo-${key}`, { ...base, priceTableId: refs.priceTables.varejo.id, skuId: k.id, productId: p.id, scopeKey: priceScopeKey(refs.priceTables.varejo.id, k.id, null, null), price, maxDiscountBps: 1000 });
  return { product: p, sku: k };
}

beforeEach(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  terminalId = refs.terminals.cx1.id;
  princ = refs.warehouses["matriz-main"];
  await openSession(cashier, { terminalId, openingFund: 10000 });
});

describe("cálculos puros da divisão por depósito", () => {
  it("baixa: principal primeiro, complementos na ordem, falta no principal; devolução na ordem inversa", () => {
    const pool = new Map([["P", 2000], ["A", 5000], ["B", 1000]]);
    expect(allocateSplit(4000, "P", ["A", "B"], pool)).toEqual([{ warehouseId: "P", qty: 2000 }, { warehouseId: "A", qty: 2000 }]);
    expect(allocateSplit(5000, "P", ["A", "B"], pool)).toEqual([{ warehouseId: "P", qty: 1000 }, { warehouseId: "A", qty: 3000 }, { warehouseId: "B", qty: 1000 }]);
    expect(pool.get("P")).toBe(-1000); // só o principal fica negativo (venda sem saldo permitida)
    const split = [{ warehouseId: "P", qty: 2000 }, { warehouseId: "A", qty: 3000 }];
    expect(lifoReturnParts(split, 0, 2000)).toEqual([{ warehouseId: "A", qty: 2000 }]);
    expect(lifoReturnParts(split, 2000, 2000)).toEqual([{ warehouseId: "A", qty: 1000 }, { warehouseId: "P", qty: 1000 }]);
    expect(lifoReturnParts(split, 4000, 1000)).toEqual([{ warehouseId: "P", qty: 1000 }]);
  });
});

describe("§39 — cadastro de depósitos", () => {
  it("gerente cadastra e edita; código único na filial; caixa recusado; auditado", async () => {
    const w = await almox();
    expect(w).toMatchObject({ code: "ALM", kind: "available", purpose: "storage", salePriority: 2, status: "active", branchId: refs.branches.matriz.id });
    // reenvio do mesmo formulário: mesmo depósito
    expect((await almox()).id).toBe(w.id);
    await expect(createWarehouse(manager, refs.branches.matriz.id, { name: "Outro", code: "alm", type: "sale" })).rejects.toThrow(/código ALM/);
    // o mesmo código em outra filial é permitido
    const shop = await createWarehouse(admin, refs.branches.shopping.id, { name: "Almox Shopping", code: "ALM", type: "storage" });
    expect(shop.branchId).toBe(refs.branches.shopping.id);
    await expect(createWarehouse(cashier, refs.branches.matriz.id, { name: "X", code: "X1", type: "sale" })).rejects.toThrow(/permissão/);
    await expect(createWarehouse(stockist, refs.branches.matriz.id, { name: "X", code: "X1", type: "sale" })).rejects.toThrow(/permissão/);
    await expect(createWarehouse(manager, refs.branches.matriz.id, { name: "X", code: "X1", type: "damaged" })).rejects.toThrow(/avarias/);
    await expect(createWarehouse(manager, refs.branches.matriz.id, { name: "X", code: "X 1", type: "sale" })).rejects.toThrow(/Código/);
    const e = await updateWarehouse(manager, w.id, { name: "Almoxarifado central", code: "ALM", type: "storage", salePriority: 3, notes: "Fundos da loja" });
    expect(e).toMatchObject({ name: "Almoxarifado central", salePriority: 3, notes: "Fundos da loja" });
    await expect(updateWarehouse(manager, w.id, { name: "x", code: "PRINC", type: "storage" })).rejects.toThrow(/código PRINC/);
    await expect(updateWarehouse(cashier, w.id, { name: "x", code: "ALM", type: "storage" })).rejects.toThrow(/permissão/);
    // avarias do sistema não muda de tipo
    await expect(updateWarehouse(manager, refs.warehouses["matriz-damaged"].id, { name: "Avarias", code: "AVARIA", type: "sale" })).rejects.toThrow(/avarias/);
    await expect(updateWarehouse(manager, w.id, { name: "x", code: "ALM", type: "damaged" })).rejects.toThrow(/avarias/);
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityId", w.id]] });
    expect(logs.map((l) => l.action).sort()).toEqual(["warehouse.create", "warehouse.update"]);
  });

  it("travas da desativação: saldo, reservado, padrão da filial/terminal, avarias e último depósito de venda", async () => {
    const w = await almox();
    await stockIn(w.id, sku("caderno-u"), 2 * QTY, 1000, "t-in");
    await expect(setWarehouseStatus(manager, w.id, "inactive")).rejects.toThrow(/ainda tem estoque.*físico 2/);
    // reservado sem físico (reserva de pedido permitida sem saldo)
    await postMovements(admin, [{ warehouseId: w.id, skuId: sku("caderno-u"), qty: -2 * QTY, type: "manual_out", reason: "t", idemKey: "t-out" }]);
    await reserve(admin, { warehouseId: w.id, skuId: sku("caneta-u"), qty: QTY, originType: "sales_document", originId: "x", idemKey: "t-rsv", allowNegative: true });
    await expect(setWarehouseStatus(manager, w.id, "inactive")).rejects.toThrow(/reservado 1/);
    await store.update("stock_balances", balanceId(w.id, sku("caneta-u")), { reserved: 0 });
    // padrão da filial e avarias
    await expect(setWarehouseStatus(manager, princ.id, "inactive")).rejects.toThrow(/padrão da filial/);
    await expect(setWarehouseStatus(manager, refs.warehouses["matriz-damaged"].id, "inactive")).rejects.toThrow(/avarias/);
    // padrão de terminal
    const loja = await createWarehouse(manager, refs.branches.matriz.id, { name: "Loja 2", code: "LOJA2", type: "sale" });
    const t = await store.getOrThrow("terminals", refs.terminals.cx2.id);
    await updateTerminal(admin, t.id, { ...(t as any), defaultWarehouseId: loja.id });
    await expect(setWarehouseStatus(manager, loja.id, "inactive")).rejects.toThrow(/terminal/);
    // terminal só aceita depósito de venda/almoxarifado ativo
    const uso = await createWarehouse(manager, refs.branches.matriz.id, { name: "Uso e consumo", code: "USO", type: "consumption" });
    await expect(updateTerminal(admin, t.id, { ...(t as any), defaultWarehouseId: uso.id })).rejects.toThrow(/venda ou almoxarifado/);
    await expect(setBranchDefaultWarehouse(manager, uso.id)).rejects.toThrow(/venda ou almoxarifado/);
    // depósito vazio, sem reserva, que não é padrão: desativa e reativa (auditado)
    expect((await setWarehouseStatus(manager, w.id, "inactive", "não usamos mais")).status).toBe("inactive");
    expect((await setWarehouseStatus(manager, w.id, "active")).status).toBe("active");
    await expect(setWarehouseStatus(cashier, w.id, "inactive")).rejects.toThrow(/permissão/);
  });

  it("toda filial mantém um depósito de venda ativo; padrão da filial troca e não pode virar uso e consumo", async () => {
    // PRINC é o único de venda: não vira almoxarifado
    await expect(updateWarehouse(manager, princ.id, { name: princ.name, code: "PRINC", type: "storage" })).rejects.toThrow(/ao menos um depósito de venda/);
    const v2 = await createWarehouse(manager, refs.branches.matriz.id, { name: "Vitrine", code: "VIT", type: "sale" });
    // com outro de venda, PRINC vira almoxarifado (mesma natureza: continua no disponível, mesmo com saldo)
    expect((await updateWarehouse(manager, princ.id, { name: princ.name, code: "PRINC", type: "storage" })).purpose).toBe("storage");
    await expect(setWarehouseStatus(manager, v2.id, "inactive")).rejects.toThrow(/ao menos um depósito de venda/);
    // padrão da filial não vira uso e consumo
    await expect(updateWarehouse(manager, princ.id, { name: princ.name, code: "PRINC", type: "consumption" })).rejects.toThrow(/padrão da filial/);
    // troca do padrão da filial
    await setBranchDefaultWarehouse(manager, v2.id);
    expect((await store.getOrThrow("branches", refs.branches.matriz.id)).defaultWarehouseId).toBe(v2.id);
    expect((await store.getOrThrow("warehouses", v2.id)).isDefault).toBe(true);
    expect((await store.getOrThrow("warehouses", princ.id)).isDefault).toBe(false);
    // natureza muda só sem saldo: PRINC tem estoque (e é padrão dos terminais)
    await expect(updateWarehouse(manager, princ.id, { name: princ.name, code: "PRINC", type: "consumption" })).rejects.toThrow(/terminal|saldo/);
  });
});

describe("§39 — disponível e venda com complemento", () => {
  it("almoxarifado entra no disponível; uso e consumo não", async () => {
    const before = await avail(sku("caderno-u"));
    const w = await almox();
    const uso = await createWarehouse(manager, refs.branches.matriz.id, { name: "Uso e consumo", code: "USO", type: "consumption" });
    await stockIn(w.id, sku("caderno-u"), 5 * QTY, 1000, "a-in");
    await stockIn(uso.id, sku("caderno-u"), 7 * QTY, 1000, "u-in");
    expect(await avail(sku("caderno-u"))).toBe(before + 5 * QTY);
  });

  it("venda que cabe no depósito do terminal grava como antes; a que não cabe completa do almoxarifado (idempotente)", async () => {
    const w = await almox();
    const cad = sku("caderno-u");
    await stockIn(w.id, cad, 5 * QTY, 1000, "a-in");
    // cabe no principal: sem divisão, uma saída com a chave de sempre
    const s1 = await sell("fit-1", [{ skuId: cad, qty: QTY }]);
    const [i1] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s1.id]] });
    expect(i1.warehouseSplit ?? null).toBeNull();
    expect(i1.warehouseId).toBe(princ.id);
    const m1 = await movesOf(s1.id);
    expect(m1.map((m) => [m.warehouseId, m.qty, m.idemKey])).toEqual([[princ.id, -QTY, `sale:${s1.id}:1`]]);
    // não cabe: P do principal + 3 do almoxarifado
    const p = await phys(princ.id, cad);
    const s2 = await sell("split-1", [{ skuId: cad, qty: p + 3 * QTY }]);
    const [i2] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s2.id]] });
    expect(i2.warehouseId).toBe(princ.id);
    expect(i2.warehouseSplit).toEqual([{ warehouseId: princ.id, qty: p }, { warehouseId: w.id, qty: 3 * QTY }]);
    const m2 = await movesOf(s2.id);
    expect(m2.map((m) => [m.warehouseId, m.qty, m.idemKey]).sort()).toEqual(
      [[princ.id, -p, `sale:${s2.id}:1`], [w.id, -3 * QTY, `sale:${s2.id}:1:${whTag(w.id)}`]].sort(),
    );
    expect(await phys(princ.id, cad)).toBe(0);
    expect(await phys(w.id, cad)).toBe(2 * QTY);
    // repetir a conclusão e os efeitos não lança de novo
    const again = await finalizeSale(cashier, { idemKey: "split-1", terminalId, items: [{ skuId: cad, qty: p + 3 * QTY }], payments: [] });
    expect(again.id).toBe(s2.id);
    await store.update("sales", s2.id, { effectsStatus: "pending" });
    await applySaleEffects({ ...cashier }, s2.id, false);
    expect((await movesOf(s2.id)).length).toBe(2);
    expect(await phys(w.id, cad)).toBe(2 * QTY);
    // sem saldo no total (venda sem saldo desligada): recusa como sempre
    await expect(sell("split-2", [{ skuId: cad, qty: 3 * QTY }])).rejects.toThrow(/Estoque insuficiente/);
  });

  it("ordem de baixa pela prioridade; depósito inativo não completa; reservado não é usado; sem saldo só o principal fica negativo", async () => {
    const cad = sku("caderno-u");
    const a = await almox("ALM", 3);
    const b = await almox("ALB", 2);
    await stockIn(a.id, cad, 2 * QTY, 1000, "a-in");
    await stockIn(b.id, cad, 2 * QTY, 1000, "b-in");
    await emptyPrinc(cad, "p-out");
    // reserva de 1 no ALB (pedido de venda): não é consumida pela venda
    await reserve(admin, { warehouseId: b.id, skuId: cad, qty: QTY, originType: "sales_document", originId: "doc-x", idemKey: "rsv-b" });
    const s = await sell("prio-1", [{ skuId: cad, qty: 2 * QTY }]);
    const [it] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(it.warehouseSplit).toEqual([{ warehouseId: b.id, qty: QTY }, { warehouseId: a.id, qty: QTY }]);
    // venda sem saldo permitida: complementa o que houver, o resto deixa o principal negativo
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "sales.allowNegativeStock", true);
    const s2 = await sell("neg-1", [{ skuId: cad, qty: 3 * QTY }]);
    const [it2] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s2.id]] });
    expect(it2.warehouseSplit).toEqual([{ warehouseId: princ.id, qty: 2 * QTY }, { warehouseId: a.id, qty: QTY }]);
    expect(await phys(princ.id, cad)).toBe(-2 * QTY);
    expect(await phys(a.id, cad)).toBe(0);
    expect(await phys(b.id, cad)).toBe(QTY);
  });

  it("devolução parcial (ordem inversa da baixa) e total; cancelamento devolve cada parte ao depósito de origem", async () => {
    const cad = sku("caderno-u");
    const w = await almox();
    await stockIn(w.id, cad, 5 * QTY, 1000, "a-in");
    await emptyPrinc(cad, "p-out");
    await stockIn(princ.id, cad, 2 * QTY, 990, "p-in");
    const s = await sell("ret-1", [{ skuId: cad, qty: 5 * QTY }], { customerId: refs.customers.maria.id });
    const [line] = await returnableItems(store, s.id);
    expect(line.warehouseSplit).toEqual([{ warehouseId: princ.id, qty: 2 * QTY }, { warehouseId: w.id, qty: 3 * QTY }]);
    expect(await phys(w.id, cad)).toBe(2 * QTY);
    // 1ª devolução (2): volta toda ao almoxarifado (último de onde a venda tirou)
    const r1 = await processReturn(cashier, { saleId: s.id, idemKey: "r1", reason: "sobrou", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 2 * QTY, condition: "resellable" }] });
    expect(r1.lines[0].parts).toEqual([{ warehouseId: w.id, fromWarehouseId: w.id, qty: 2 * QTY }]);
    expect(await phys(w.id, cad)).toBe(4 * QTY);
    expect(await phys(princ.id, cad)).toBe(0);
    // 2ª (2): 1 completa o almoxarifado e 1 volta ao principal
    await processReturn(cashier, { saleId: s.id, idemKey: "r2", reason: "sobrou", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 2 * QTY, condition: "resellable" }] });
    expect(await phys(w.id, cad)).toBe(5 * QTY);
    expect(await phys(princ.id, cad)).toBe(QTY);
    // 3ª (resto, avariado): vai para avarias, com a origem da parte (principal)
    const r3 = await processReturn(cashier, { saleId: s.id, idemKey: "r3", reason: "quebrou", compensation: "store_credit", items: [{ saleItemId: line.id, qty: QTY, condition: "damaged" }] });
    const dmg = refs.warehouses["matriz-damaged"].id;
    expect(r3.lines[0].parts).toEqual([{ warehouseId: dmg, fromWarehouseId: princ.id, qty: QTY }]);
    expect(await phys(dmg, cad)).toBe(QTY);
    const rm = await listAll(store, "stock_movements", { filters: [["eq", "originType", "return"]] });
    expect(rm.every((m) => m.sourceMovementId)).toBe(true);
    // idempotência: repetir a devolução não lança de novo
    await processReturn(cashier, { saleId: s.id, idemKey: "r1", reason: "sobrou", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 2 * QTY, condition: "resellable" }] });
    expect((await listAll(store, "stock_movements", { filters: [["eq", "originType", "return"]] })).length).toBe(rm.length);

    // cancelamento: cada parte volta ao seu depósito
    await emptyPrinc(cad, "p-out-2");
    await stockIn(princ.id, cad, QTY, 990, "p-in-2");
    const s2 = await sell("cancel-1", [{ skuId: cad, qty: 3 * QTY }]);
    expect(await phys(princ.id, cad)).toBe(0);
    expect(await phys(w.id, cad)).toBe(3 * QTY);
    await cancelSale(manager, s2.id, "desistiu");
    expect(await phys(princ.id, cad)).toBe(QTY);
    expect(await phys(w.id, cad)).toBe(5 * QTY);
    const cm = (await movesOf(s2.id)).filter((m) => m.type === "sale_cancel");
    expect(cm.map((m) => [m.warehouseId, m.qty, m.sourceMovementId]).sort()).toEqual(
      [[princ.id, QTY, detId("mov", `sale:${s2.id}:1`)], [w.id, 2 * QTY, detId("mov", `sale:${s2.id}:1:${whTag(w.id)}`)]].sort(),
    );
  });

  it("kit: divisão por componente, devolução parcial dos componentes na ordem inversa", async () => {
    const w = await almox();
    const a = await product("cmp-a", "Componente A", 1000);
    const b = await product("cmp-b", "Componente B", 1000);
    const kit = await product("kit-wh", "Kit Depósitos", 5000);
    await setComposition(admin, kit.product.id, "kit");
    await saveComponent(admin, { productId: kit.product.id, componentSkuId: a.sku.id, qty: 2 * QTY });
    await saveComponent(admin, { productId: kit.product.id, componentSkuId: b.sku.id, qty: QTY });
    await stockIn(princ.id, a.sku.id, QTY, 300, "ka-p");
    await stockIn(w.id, a.sku.id, 10 * QTY, 300, "ka-w");
    await stockIn(princ.id, b.sku.id, 10 * QTY, 200, "kb-p");
    const s = await sell("kit-1", [{ skuId: kit.sku.id, qty: 2 * QTY }], { customerId: refs.customers.maria.id });
    const [it] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(it.warehouseSplit ?? null).toBeNull();
    const ca = it.components.find((c: any) => c.skuId === a.sku.id);
    const cb = it.components.find((c: any) => c.skuId === b.sku.id);
    expect(ca.warehouseSplit).toEqual([{ warehouseId: princ.id, qty: QTY }, { warehouseId: w.id, qty: 3 * QTY }]);
    expect(cb.warehouseSplit ?? null).toBeNull();
    expect(await phys(princ.id, a.sku.id)).toBe(0);
    expect(await phys(w.id, a.sku.id)).toBe(7 * QTY);
    expect(await phys(princ.id, b.sku.id)).toBe(8 * QTY);
    expect((await movesOf(s.id)).length).toBe(3);
    // devolve 1 kit: os 2 componentes A voltam ao almoxarifado
    await processReturn(cashier, { saleId: s.id, idemKey: "kr1", reason: "x", compensation: "store_credit", items: [{ saleItemId: it.id, qty: QTY, condition: "resellable" }] });
    expect(await phys(w.id, a.sku.id)).toBe(9 * QTY);
    expect(await phys(princ.id, a.sku.id)).toBe(0);
    // devolve o outro: 1 A ao almoxarifado, 1 ao principal
    await processReturn(cashier, { saleId: s.id, idemKey: "kr2", reason: "x", compensation: "store_credit", items: [{ saleItemId: it.id, qty: QTY, condition: "resellable" }] });
    expect(await phys(w.id, a.sku.id)).toBe(10 * QTY);
    expect(await phys(princ.id, a.sku.id)).toBe(QTY);
    expect(await phys(princ.id, b.sku.id)).toBe(10 * QTY);
  });

  it("lote: FEFO dentro de cada depósito; cancelamento volta aos lotes e depósitos de origem", async () => {
    await seedLots(refs);
    const iog = (await listAll(store, "skus", { filters: [["eq", "sku", "IOGURTE"]] }))[0];
    const w = await almox();
    await stockIn(w.id, iog.id, 5 * QTY, 189, "l-d", { lot: "L-D", expiry: addDays(today(), 90) });
    await stockIn(w.id, iog.id, 2 * QTY, 189, "l-c", { lot: "L-C", expiry: addDays(today(), 5) });
    const p = await phys(princ.id, iog.id);
    const s = await sell("lot-1", [{ skuId: iog.id, qty: p + 3 * QTY }]);
    const out = (await movesOf(s.id)).find((m) => m.warehouseId === w.id)!;
    expect(out.lots.map((l: any) => [l.lot, l.qty])).toEqual([["L-C", -2 * QTY], ["L-D", -QTY]]);
    expect((await bal(w.id, iog.id)).lots.map((l: any) => [l.lot, l.qty])).toEqual([["L-D", 4 * QTY]]);
    await cancelSale(manager, s.id, "desistiu");
    const after = (await bal(w.id, iog.id)).lots.map((l: any) => [l.lot, l.qty]).sort();
    expect(after).toEqual([["L-C", 2 * QTY], ["L-D", 5 * QTY]]);
    expect(await phys(princ.id, iog.id)).toBe(p);
  });
});

describe("§39 — recebimento no depósito escolhido", () => {
  it("entra no depósito escolhido; avarias e depósito desativado recusados", async () => {
    const w = await almox();
    const uso = await createWarehouse(manager, refs.branches.matriz.id, { name: "Uso e consumo", code: "USO", type: "consumption" });
    const cad = sku("caderno-u");
    const base = { supplierId: refs.suppliers.papel.id, orderIds: [], nfeNumber: "9001", nfeSeries: "1", issueDate: today(), items: [{ skuId: cad, qty: 4 * QTY, unitCost: 800 }] };
    await expect(createManualReceipt(stockist, { ...base, idemKey: "rc-0", warehouseId: refs.warehouses["matriz-damaged"].id })).rejects.toThrow(/avarias/);
    const r = await createManualReceipt(stockist, { ...base, idemKey: "rc-1", warehouseId: w.id });
    expect(r.warehouseId).toBe(w.id);
    const princBefore = await phys(princ.id, cad);
    await updateReceipt(stockist, r.id, { checkAll: true });
    await confirmReceipt(stockist, r.id);
    expect(await phys(w.id, cad)).toBe(4 * QTY);
    expect(await phys(princ.id, cad)).toBe(princBefore);
    // conferência troca para uso e consumo; depósito desativado depois da escolha bloqueia a conclusão
    const r2 = await createManualReceipt(stockist, { ...base, nfeNumber: "9002", idemKey: "rc-2" });
    expect(r2.warehouseId).toBe(princ.id); // padrão da filial
    await updateReceipt(stockist, r2.id, { warehouseId: uso.id, checkAll: true });
    await setWarehouseStatus(manager, uso.id, "inactive");
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/desativado/);
    await expect(updateReceipt(stockist, r2.id, { warehouseId: refs.warehouses["matriz-damaged"].id })).rejects.toThrow(/avarias/);
    await setWarehouseStatus(manager, uso.id, "active");
    await confirmReceipt(stockist, r2.id);
    expect(await phys(uso.id, cad)).toBe(4 * QTY);
  });
});

describe("§39 — transferência entre depósitos da mesma filial", () => {
  it("imediata, pelo custo médio, sem consumir o reservado, idempotente e auditada", async () => {
    const w = await almox();
    const cad = sku("caderno-u");
    await stockIn(w.id, cad, 2 * QTY, 1500, "w-in");
    const src = await bal(princ.id, cad);
    const t = await transferBetweenWarehouses(stockist, { fromWarehouseId: princ.id, toWarehouseId: w.id, items: [{ skuId: cad, qty: 3 * QTY }], reason: "Abastecer o depósito" }, { idemKey: "wt-1" });
    expect(t).toMatchObject({ kind: "warehouse", status: "received", fromBranchId: refs.branches.matriz.id, toBranchId: refs.branches.matriz.id, fromWarehouseId: princ.id, toWarehouseId: w.id, reason: "Abastecer o depósito" });
    expect(await phys(princ.id, cad)).toBe(src.physical - 3 * QTY);
    expect(await phys(w.id, cad)).toBe(5 * QTY);
    // custo médio do destino: (2 × 15,00 + 3 × médio da origem) ÷ 5
    expect((await bal(w.id, cad)).avgCost).toBe(Math.round((2 * 1500 + 3 * src.avgCost) / 5));
    expect(t.items[0].unitCost).toBe(src.avgCost);
    const movs = await movesOf(t.id);
    expect(movs.map((m) => m.type).sort()).toEqual(["transfer_in", "transfer_out"]);
    // idempotente
    const again = await transferBetweenWarehouses(stockist, { fromWarehouseId: princ.id, toWarehouseId: w.id, items: [{ skuId: cad, qty: 3 * QTY }], reason: "Abastecer o depósito" }, { idemKey: "wt-1" });
    expect(again.id).toBe(t.id);
    expect((await movesOf(t.id)).length).toBe(2);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "entityId", t.id]] })).map((l) => l.action)).toEqual(["transfer.warehouse"]);
    // não há etapas a executar sobre ela
    await expect(cancelTransfer(manager, t.id, "x")).rejects.toThrow(/concluída na hora/);
    // reservado não é transferido
    const free = (await phys(w.id, cad)) - QTY;
    await reserve(admin, { warehouseId: w.id, skuId: cad, qty: free, originType: "sales_document", originId: "doc-y", idemKey: "rsv-w" });
    await expect(transferBetweenWarehouses(stockist, { fromWarehouseId: w.id, toWarehouseId: princ.id, items: [{ skuId: cad, qty: 2 * QTY }], reason: "x" }, { idemKey: "wt-2" })).rejects.toThrow(/reservado/);
    expect(await store.get("transfers", detId("transfer", refs.company.id, "warehouse", "wt-2"))).toBeNull();
    // mesmo depósito, motivo e permissão
    await expect(transferBetweenWarehouses(stockist, { fromWarehouseId: w.id, toWarehouseId: w.id, items: [{ skuId: cad, qty: QTY }], reason: "x" }, { idemKey: "wt-3" })).rejects.toThrow(/diferentes/);
    await expect(transferBetweenWarehouses(stockist, { fromWarehouseId: w.id, toWarehouseId: princ.id, items: [{ skuId: cad, qty: QTY }], reason: " " }, { idemKey: "wt-4" })).rejects.toThrow(/motivo/);
    await expect(transferBetweenWarehouses(cashier, { fromWarehouseId: w.id, toWarehouseId: princ.id, items: [{ skuId: cad, qty: QTY }], reason: "x" }, { idemKey: "wt-5" })).rejects.toThrow(/permissão/);
  });

  it("lote escolhido ou FEFO: o destino recebe os mesmos lotes", async () => {
    await seedLots(refs);
    const iog = (await listAll(store, "skus", { filters: [["eq", "sku", "IOGURTE"]] }))[0];
    const w = await almox();
    await transferBetweenWarehouses(stockist, { fromWarehouseId: princ.id, toWarehouseId: w.id, items: [{ skuId: iog.id, qty: 3 * QTY, lot: "L-B" }, { skuId: iog.id, qty: 2 * QTY }], reason: "Reserva" }, { idemKey: "wl-1" });
    const dest = (await bal(w.id, iog.id)).lots.map((l: any) => [l.lot, l.qty]).sort();
    expect(dest).toEqual([["L-A", 2 * QTY], ["L-B", 3 * QTY]]);
    const src = Object.fromEntries((await bal(princ.id, iog.id)).lots.map((l: any) => [l.lot, l.qty]));
    expect(src).toEqual({ "L-A": 22 * QTY, "L-B": 33 * QTY });
    await expect(transferBetweenWarehouses(stockist, { fromWarehouseId: w.id, toWarehouseId: princ.id, items: [{ skuId: iog.id, qty: 4 * QTY, lot: "L-B" }], reason: "x" }, { idemKey: "wl-2" })).rejects.toThrow(/lote L-B/);
  });
});

describe("§39 — demonstração", () => {
  it("cria o Almoxarifado da Matriz com saldo de 2 produtos, sem duplicar", async () => {
    await seedWarehouses(refs);
    await seedWarehouses(refs);
    const whs = (await listAll(store, "warehouses", { filters: [["eq", "branchId", refs.branches.matriz.id]] })).filter((w) => w.purpose === "storage");
    expect(whs).toHaveLength(1);
    expect(whs[0]).toMatchObject({ name: "Almoxarifado", salePriority: 2, kind: "available" });
    const bals = (await listAll(store, "stock_balances", { filters: [["eq", "warehouseId", whs[0].id]] })).filter((b) => b.physical > 0);
    expect(bals).toHaveLength(2);
  });
});
