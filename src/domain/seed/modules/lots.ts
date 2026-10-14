import { QTY } from "@/lib/money";
import { addDays, today } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/core/settings";
import { priceScopeKey } from "../../pricing";
import { searchable } from "@/lib/core/text";
import type { DemoRefs } from "../base";

/**
 * Demonstração da Fase 6 — lotes e validades (EST-02), idempotente (ids e chaves determinísticos):
 *  - liga `feature.lotes` na empresa de demonstração (somente se ainda não definido);
 *  - produto perecível "Iogurte Natural 170 g" com controle de lote, preço e saldo na Matriz em 2 lotes:
 *    L-A (vence em 10 dias → aparece "a vencer" no relatório e no alerta) e L-B (vence em 60 dias).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const store = sd.store;
  const companyId = refs.company.id;
  const base = { companyId, isDemo: true };
  if ((await getSetting(store, companyId, null, "feature.lotes", null)) == null) await setSetting(store, companyId, null, "feature.lotes", true);
  const category = await sd.put("categories", "Alimentos", { ...base, name: "Alimentos", status: "active" });
  const brand = await sd.put("brands", "Laticínios Serra", { ...base, name: "Laticínios Serra", status: "active" });
  const product = await sd.put("products", "iogurte", {
    ...base, type: "product", code: "IOGURTE", name: "Iogurte Natural 170 g", description: "Iogurte natural integral — produto perecível com controle de lote (demonstração).", gtin: "7891000900014", unitCode: "UN",
    categoryId: category.id, brandId: brand.id, supplierId: null, active: true, availablePdv: true, availableEcommerce: false, hasVariants: false, variantAxes: [], ncm: "04039000", origin: "0",
    taxGroupId: refs.products.caneca?.taxGroupId ?? null, searchText: searchable("Iogurte Natural 170 g", "iogurte", "7891000900014", "Alimentos"), status: "active", lotControl: true,
  });
  if (!product.lotControl) await store.update("products", product.id, { lotControl: true });
  const sku = await sd.put("skus", "iogurte-u", {
    ...base, productId: product.id, sku: "IOGURTE", barcode: "7891000900014", attributes: {}, name: "Iogurte Natural 170 g", unitCode: "UN", active: true, costAcquisition: 189, costAdditional: 0, costTotal: 189,
    searchText: searchable("Iogurte Natural 170 g", "IOGURTE", "7891000900014"),
  });
  const table = refs.priceTables.varejo;
  await sd.put("prices", "varejo-iogurte-u", { ...base, priceTableId: table.id, skuId: sku.id, productId: product.id, scopeKey: priceScopeKey(table.id, sku.id, null, null), price: 449, maxDiscountBps: 1000 });
  const { postMovements } = await import("../../stock");
  const admin = await refs.ctxFor("admin", "matriz");
  const wh = refs.warehouses["matriz-main"];
  const d = today();
  await postMovements(admin, [
    { warehouseId: wh.id, skuId: sku.id, qty: 24 * QTY, type: "manual_in", unitCost: 189, originType: "seed", reason: "Entrada de demonstração — lote L-A", idemKey: "seed-lot:iogurte:L-A", lot: "L-A", lotExpiry: addDays(d, 10), lotMfg: addDays(d, -20) },
    { warehouseId: wh.id, skuId: sku.id, qty: 36 * QTY, type: "manual_in", unitCost: 189, originType: "seed", reason: "Entrada de demonstração — lote L-B", idemKey: "seed-lot:iogurte:L-B", lot: "L-B", lotExpiry: addDays(d, 60), lotMfg: addDays(d, -2) },
  ]);
  return { product: product.code, lots: ["L-A", "L-B"] };
}
