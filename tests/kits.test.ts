import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import { runDueJobs } from "@/lib/core/jobs";
import { setSetting } from "@/lib/core/settings";
import { searchable } from "@/lib/core/text";
import { openSession } from "@/domain/cash";
import { finalizeSale, prepareSale, cancelSale, processReturn, type FinalizeSaleInput } from "@/domain/sales";
import { availableMap, balanceId, postMovements } from "@/domain/stock";
import { priceScopeKey } from "@/domain/pricing";
import { deleteProduct } from "@/domain/products";
import {
  docKitComponents, kitAvailability, kitAvailableFrom, kitExpand, removeComponent, runAssembly, saveComponent, setComposition,
} from "@/domain/product-components";
import { seed as seedKits } from "@/domain/seed/modules/kits";

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;
let wh: Doc;

const QTY = 1000;
const sku = (k: string) => refs.skus[k].id;
const bal = async (skuId: string) => (await store.get("stock_balances", balanceId(wh.id, skuId))) ?? { physical: 0, reserved: 0, avgCost: 0 };
const avail = async (skuId: string) => (await availableMap(store, refs.branches.matriz.id, [skuId])).get(skuId)?.available ?? 0;

/** Produto de teste com preço na tabela de varejo (o kit tem preço próprio). */
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

/** Kit: 2 cadernos + 1 caixa de canetas, R$ 89,90. */
async function makeKit() {
  const kit = await product("kit-teste", "Kit Teste", 8990);
  await setComposition(admin, kit.product.id, "kit");
  await saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("caderno-u"), qty: 2 * QTY });
  await saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("caneta-u"), qty: QTY });
  return kit;
}

async function sale(input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }, ctx = cashier) {
  return finalizeSale(ctx, { terminalId, ...input });
}
const pix = (amount: number, ref = "E2EKIT") => [{ methodId: refs.methods.pix.id, amount, reference: ref }];

describe("kits e composição (CAD-12/13)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    admin = await refs.ctxFor("admin", "matriz");
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    wh = refs.warehouses["matriz-main"];
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("venda de kit baixa os componentes pelo custo médio e o CMV do item é a soma", async () => {
    // custo médio do caderno: 60 × 9,90 + 20 × 12,90 = 10,65
    await postMovements(admin, [{ warehouseId: wh.id, skuId: sku("caderno-u"), qty: 20 * QTY, type: "manual_in", unitCost: 1290, reason: "teste", idemKey: "kit-test-in" }]);
    expect((await bal(sku("caderno-u"))).avgCost).toBe(1065);
    const kit = await makeKit();
    const cadBefore = await avail(sku("caderno-u"));
    const canBefore = await avail(sku("caneta-u"));
    const s = await sale({ idemKey: "kit-1", items: [{ skuId: kit.sku.id, qty: 2 * QTY }], payments: pix(17980) });
    expect(s.total).toBe(17980);
    // custo por kit = 2 × 10,65 + 21,00 = 42,30 → 2 kits = 84,60
    expect(s.costTotal).toBe(8460);
    const [item] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(item.skuId).toBe(kit.sku.id);
    expect(item.costTotal).toBe(8460);
    expect(item.unitCost).toBe(4230);
    expect(item.components.map((c: any) => [c.skuId, c.qty, c.unitCost])).toEqual([[sku("caderno-u"), 2000, 1065], [sku("caneta-u"), 1000, 2100]]);
    // estoque: componentes baixados, kit sem saldo próprio
    expect(await avail(sku("caderno-u"))).toBe(cadBefore - 4 * QTY);
    expect(await avail(sku("caneta-u"))).toBe(canBefore - 2 * QTY);
    expect(await store.get("stock_balances", balanceId(wh.id, kit.sku.id))).toBeNull();
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originId", s.id]] });
    expect(movs.map((m) => m.type)).toEqual(["sale", "sale"]);
    expect(movs.reduce((a, m) => a + m.totalCost, 0)).toBe(8460);
    // repetição não baixa de novo
    await sale({ idemKey: "kit-1", items: [{ skuId: kit.sku.id, qty: 2 * QTY }], payments: pix(17980) });
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", s.id]] })).toHaveLength(2);
    // fiscal: o kit sai como UM item da NFC-e
    const doc = await store.getOrThrow("fiscal_documents", (await store.getOrThrow("sales", s.id)).fiscalDocumentId);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].skuId).toBe(kit.sku.id);
    // produto comum na mesma venda continua igual (sem retrato de componentes, movimento do próprio SKU)
    const s2 = await sale({ idemKey: "kit-2", items: [{ skuId: kit.sku.id, qty: QTY }, { skuId: sku("bone-u"), qty: QTY }], payments: pix(8990 + 4490) });
    const items2 = await listAll(store, "sale_items", { filters: [["eq", "saleId", s2.id]], orderBy: [{ field: "seq" }] });
    expect(items2[1].components ?? null).toBeNull();
    expect(await store.get("stock_movements", detId("mov", `sale:${s2.id}:2`))).toBeTruthy();
  });

  it("disponível do kit = mínimo(saldo do componente ÷ quantidade)", async () => {
    const kit = await makeKit();
    // caderno 60 ÷ 2 = 30; caneta 18 ÷ 1 = 18 → 18 kits
    const products = new Map([[kit.product.id, await store.getOrThrow("products", kit.product.id)]]);
    const map = await kitAvailability(store, refs.branches.matriz.id, [{ id: kit.sku.id, productId: kit.product.id }], products);
    expect(map.get(kit.sku.id)).toBe(18 * QTY);
    expect(kitAvailableFrom([{ skuId: "a", qty: 1500 }, { skuId: "b", qty: 250 }], new Map([["a", 4000], ["b", 600]]))).toBe(2 * QTY);
    expect(kitAvailableFrom([{ skuId: "a", qty: 1000 }], new Map([["a", -3000]]))).toBe(0);
    // a prévia da venda confere os componentes: 19 kits passam do saldo de canetas
    await expect(prepareSale(cashier, { idemKey: "x", terminalId, items: [{ skuId: kit.sku.id, qty: 19 * QTY }], payments: [] })).rejects.toThrow(/CANETA.*componente de kit/);
    await prepareSale(cashier, { idemKey: "x", terminalId, items: [{ skuId: kit.sku.id, qty: 18 * QTY }], payments: [] });
  });

  it("cancelamento devolve os componentes uma única vez, pelo custo com que saíram", async () => {
    const kit = await makeKit();
    const cad = await bal(sku("caderno-u"));
    const can = await bal(sku("caneta-u"));
    const s = await sale({ idemKey: "kit-c", items: [{ skuId: kit.sku.id, qty: 2 * QTY }], payments: pix(17980) });
    await cancelSale(manager, s.id, "cliente desistiu");
    await cancelSale(manager, s.id, "cliente desistiu"); // repetição
    await runDueJobs(store, { limit: 50 });
    const back = (await listAll(store, "stock_movements", { filters: [["eq", "originId", s.id]] })).filter((m) => m.type === "sale_cancel");
    expect(back.map((m) => [m.skuId, m.qty, m.unitCost]).sort()).toEqual([[sku("caderno-u"), 4000, 990], [sku("caneta-u"), 2000, 2100]].sort());
    expect((await bal(sku("caderno-u"))).physical).toBe(cad.physical);
    expect((await bal(sku("caneta-u"))).physical).toBe(can.physical);
    expect((await bal(sku("caderno-u"))).avgCost).toBe(cad.avgCost);
  });

  it("devolução parcial devolve os componentes proporcionais uma única vez e reverte o custo exato", async () => {
    const kit = await makeKit();
    const cad = await bal(sku("caderno-u"));
    const s = await sale({ idemKey: "kit-r", customerId: refs.customers.maria.id, items: [{ skuId: kit.sku.id, qty: 3 * QTY }], payments: pix(26970) });
    const [line] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    const input = { saleId: s.id, idemKey: "kit-ret-1", reason: "presente repetido", compensation: "store_credit" as const, items: [{ saleItemId: line.id, qty: QTY, condition: "resellable" as const }] };
    const r1 = await processReturn(cashier, input);
    const r1b = await processReturn(cashier, input);
    expect(r1b.id).toBe(r1.id);
    await runDueJobs(store, { limit: 50 });
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originId", r1.id]] });
    expect(movs.map((m) => [m.type, m.skuId, m.qty]).sort()).toEqual([["return", sku("caderno-u"), 2000], ["return", sku("caneta-u"), 1000]].sort());
    expect((await store.getOrThrow("returns", r1.id)).costTotal).toBe(2 * 990 + 2100);
    expect((await bal(sku("caderno-u"))).physical).toBe(cad.physical - 6 * QTY + 2 * QTY);
    // a quantidade devolvível continua controlada pelo item do kit
    await expect(processReturn(cashier, { ...input, idemKey: "kit-ret-2", items: [{ saleItemId: line.id, qty: 3 * QTY, condition: "resellable" }] })).rejects.toThrow(/excede/);
  });

  it("montagem e desmembramento com custo, idempotentes e auditados", async () => {
    const combo = await product("combo-teste", "Combo Teste", 9990);
    await setComposition(admin, combo.product.id, "composite");
    await saveComponent(admin, { productId: combo.product.id, componentSkuId: sku("bone-u"), qty: QTY });
    await saveComponent(admin, { productId: combo.product.id, componentSkuId: sku("cinto-u"), qty: 2 * QTY });
    const bone = await bal(sku("bone-u"));
    const cinto = await bal(sku("cinto-u"));
    const input = { skuId: combo.sku.id, warehouseId: wh.id, qty: 3 * QTY, direction: "assemble" as const, idemKey: "asm-1" };
    const [a, b] = await Promise.all([runAssembly(admin, input), runAssembly(admin, input)]);
    expect([a.applied, b.applied].filter(Boolean)).toHaveLength(1);
    await runAssembly(admin, input); // repetição
    // custo do composto = 1 × 15,00 + 2 × 24,00 = 63,00 por unidade
    expect(a.totalCost).toBe(3 * 6300);
    const c1 = await bal(combo.sku.id);
    expect(c1.physical).toBe(3 * QTY);
    expect(c1.avgCost).toBe(6300);
    expect((await bal(sku("bone-u"))).physical).toBe(bone.physical - 3 * QTY);
    expect((await bal(sku("cinto-u"))).physical).toBe(cinto.physical - 6 * QTY);
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originType", "assembly"]] });
    expect(movs.map((m) => m.type).sort()).toEqual(["assembly_in", "assembly_out", "assembly_out"]);
    expect(await listAll(store, "audit_logs", { filters: [["eq", "action", "stock.assemble"]] })).toHaveLength(1);
    // desmembrar 1: sai o composto pelo médio (63,00) e os componentes voltam com o valor repartido
    const d = await runAssembly(admin, { ...input, qty: QTY, direction: "disassemble", idemKey: "dis-1" });
    expect(d.totalCost).toBe(6300);
    expect(d.components.map((c) => [c.sku, c.qty, c.totalCost])).toEqual([["BONE", 1000, 1500], ["CINTO", 2000, 4800]]);
    expect((await bal(combo.sku.id)).physical).toBe(2 * QTY);
    expect((await bal(sku("bone-u"))).physical).toBe(bone.physical - 2 * QTY);
    expect((await bal(sku("bone-u"))).avgCost).toBe(bone.avgCost);
    // composto sem saldo não desmembra; componente sem saldo não monta
    await expect(runAssembly(admin, { ...input, qty: 5 * QTY, direction: "disassemble", idemKey: "dis-2" })).rejects.toThrow(/Saldo insuficiente/);
    await expect(runAssembly(admin, { ...input, qty: 50 * QTY, idemKey: "asm-2" })).rejects.toThrow(/Saldo insuficiente/);
    expect((await bal(combo.sku.id)).physical).toBe(2 * QTY); // nada gravado na recusa
    // kit não é montado
    const kit = await makeKit();
    await expect(runAssembly(admin, { ...input, skuId: kit.sku.id, idemKey: "asm-kit" })).rejects.toThrow(/Kits não são montados/);
    // o composto é vendido como produto comum, pelo estoque montado
    const s = await sale({ idemKey: "combo-sale", items: [{ skuId: combo.sku.id, qty: QTY }], payments: pix(9990) });
    expect(s.costTotal).toBe(6300);
    expect((await bal(combo.sku.id)).physical).toBe(QTY);
  });

  it("componente sem saldo bloqueia a venda do kit, salvo venda sem saldo permitida", async () => {
    const kit = await product("kit-vela", "Kit Vela", 9900);
    await setComposition(admin, kit.product.id, "kit");
    await saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("vela-u"), qty: QTY });
    await saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("caneca-u"), qty: QTY });
    await expect(sale({ idemKey: "kv-1", items: [{ skuId: kit.sku.id, qty: QTY }], payments: pix(9900) })).rejects.toMatchObject({ code: "insufficient_stock" });
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "sales.allowNegativeStock", true);
    const s = await sale({ idemKey: "kv-1", items: [{ skuId: kit.sku.id, qty: QTY }], payments: pix(9900) });
    expect(s.status).toBe("completed");
    expect((await bal(sku("vela-u"))).physical).toBe(-QTY);
  });

  it("cadastro: kit sem componentes recusado na venda e regras da composição", async () => {
    const kit = await product("kit-vazio", "Kit Vazio", 5000);
    await setComposition(admin, kit.product.id, "kit");
    await expect(sale({ idemKey: "kz-1", items: [{ skuId: kit.sku.id, qty: QTY }], payments: pix(5000) })).rejects.toMatchObject({ code: "kit_without_components" });
    await expect(saveComponent(admin, { productId: kit.product.id, componentSkuId: kit.sku.id, qty: QTY })).rejects.toThrow(/si mesmo/);
    const other = await makeKit();
    await expect(saveComponent(admin, { productId: kit.product.id, componentSkuId: other.sku.id, qty: QTY })).rejects.toThrow(/kit não pode ser componente/);
    await expect(saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("ajuste-u"), qty: QTY })).rejects.toThrow(/Serviços/);
    // o mesmo componente não entra duas vezes (todas as variações + variação específica)
    await saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("meia-u"), qty: QTY });
    await saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("meia-u"), qty: 3 * QTY }); // altera a quantidade
    await expect(saveComponent(admin, { productId: kit.product.id, parentSkuId: kit.sku.id, componentSkuId: sku("meia-u"), qty: QTY })).rejects.toThrow(/já é componente/);
    const rows = await listAll(store, "product_components", { filters: [["eq", "productId", kit.product.id]] });
    expect(rows.map((r) => r.qty)).toEqual([3 * QTY]);
    // produto com saldo não vira kit; produto usado como componente não é excluído
    await expect(setComposition(admin, refs.products["bone"].id, "kit")).rejects.toThrow(/não tem estoque próprio/);
    await expect(deleteProduct(admin, refs.products["meia"].id)).rejects.toThrow(/componente/);
    await removeComponent(admin, rows[0].id);
    expect(await listAll(store, "product_components", { filters: [["eq", "productId", kit.product.id]] })).toHaveLength(0);
    // NF-e com efeito de estoque: o kit movimenta os componentes
    const kits = await docKitComponents(store, [{ seq: 1, skuId: other.sku.id }, { seq: 2, skuId: sku("bone-u") }]);
    expect(Object.keys(kits)).toEqual(["1"]);
    const expanded = kitExpand(kits["1"], 2 * QTY, { warehouseId: wh.id, skuId: other.sku.id, qty: -2 * QTY, type: "manual_out", idemKey: "fd:1" });
    expect(expanded.map((m) => [m.skuId, m.qty, m.idemKey])).toEqual([[sku("caderno-u"), -4000, `fd:1:${sku("caderno-u")}`], [sku("caneta-u"), -2000, `fd:1:${sku("caneta-u")}`]]);
    expect(kitExpand(undefined, QTY, { warehouseId: wh.id, skuId: "x", qty: -QTY, type: "manual_out", idemKey: "fd:2" })).toHaveLength(1);
  });

  it("recurso desligado: kit não é vendido nem montado; cancelamento de venda anterior ainda devolve os componentes", async () => {
    const kit = await makeKit();
    const cad = await bal(sku("caderno-u"));
    const s = await sale({ idemKey: "kf-1", items: [{ skuId: kit.sku.id, qty: QTY }], payments: pix(8990) });
    await setSetting(store, refs.company.id, null, "feature.kits", false);
    await expect(sale({ idemKey: "kf-2", items: [{ skuId: kit.sku.id, qty: QTY }], payments: pix(8990) })).rejects.toMatchObject({ code: "feature_off" });
    await expect(saveComponent(admin, { productId: kit.product.id, componentSkuId: sku("bone-u"), qty: QTY })).rejects.toMatchObject({ code: "feature_off" });
    await expect(runAssembly(admin, { skuId: kit.sku.id, warehouseId: wh.id, qty: QTY, direction: "assemble", idemKey: "kf-asm" })).rejects.toMatchObject({ code: "feature_off" });
    // produtos comuns seguem iguais
    await sale({ idemKey: "kf-3", items: [{ skuId: sku("bone-u"), qty: QTY }], payments: pix(4490) });
    await cancelSale(manager, s.id, "erro de digitação");
    await runDueJobs(store, { limit: 50 });
    expect((await bal(sku("caderno-u"))).physical).toBe(cad.physical);
  });

  it("demonstração idempotente: kit vendido uma vez e composto montado uma vez", async () => {
    const r1 = (await seedKits(refs)) as Record<string, unknown>;
    expect(typeof r1.kitSale).toBe("number");
    expect(r1.assembled).toBe(2);
    await seedKits(refs);
    expect(await listAll(store, "sales", { filters: [["eq", "idemKey", "demo-kit-sale-1"]] })).toHaveLength(1);
    expect((await listAll(store, "stock_movements", { filters: [["eq", "originType", "assembly"]] })).length).toBe(3);
    expect(await listAll(store, "product_components")).toHaveLength(4);
  });
});
