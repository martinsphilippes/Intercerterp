import { searchable } from "@/lib/core/text";
import { priceScopeKey } from "../../pricing";
import { postMovements } from "../../stock";
import type { DemoRefs } from "../base";

/**
 * Demonstração da balança etiquetadora (PDV-06/CAD-16) — idempotente (ids determinísticos do seeder):
 *  - categoria "Frios e padaria (balança)" com 2 produtos vendidos em KG, PLU 101 e 102, habilitados para a carga;
 *  - preço por kg na tabela Varejo, validade, tara e informação nutricional; 20 kg de saldo inicial na Matriz.
 * Etiquetas de exemplo (formato padrão "2 CCCC 0 VVVVVV D", peso): ver SCALE_DEMO_LABELS e docs/regras-assumidas.md §30.
 */
export const SCALE_DEMO_LABELS = {
  /** Queijo mussarela (PLU 101), 0,750 kg → 0,750 × R$ 49,90 = R$ 37,43 */
  mussarela750g: "2010100007500",
  /** Pão francês (PLU 102), 0,412 kg → 0,412 × R$ 16,90 = R$ 6,96 */
  pao412g: "2010200004126",
};

export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const companyId = refs.company.id;
  const base = { companyId, isDemo: true };
  const category = await sd.put("categories", "frios-padaria", { ...base, name: "Frios e padaria (balança)", status: "active" });
  const tg = await sd.store.get("tax_groups", sd.id("tax_groups", "simples-102"));
  const defs = [
    {
      key: "mussarela-kg", name: "Queijo Mussarela Fatiado (kg)", plu: 101, ncm: "04061010", cost: 2890, price: 4990, shelfLifeDays: 10, tare: 5,
      nutrition: { portion: "30 g", kcal: 91, carbs: 0.9, proteins: 6.6, totalFat: 6.9, saturatedFat: 4.1, transFat: 0, fiber: 0, sodium: 174 },
    },
    {
      key: "pao-frances-kg", name: "Pão Francês (kg)", plu: 102, ncm: "19052090", cost: 690, price: 1690, shelfLifeDays: 1, tare: 0,
      nutrition: { portion: "50 g", kcal: 150, carbs: 29.3, proteins: 4.7, totalFat: 1.6, saturatedFat: 0.4, transFat: 0, fiber: 1.2, sodium: 324 },
    },
  ];
  const admin = await refs.ctxFor("admin", "matriz");
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const code = d.key.toUpperCase();
    const product = await sd.put("products", d.key, {
      ...base, type: "product", code, name: d.name, description: `${d.name} — vendido na balança etiquetadora (demonstração).`, gtin: null, unitCode: "KG",
      categoryId: category.id, active: true, availablePdv: true, availableEcommerce: false, hasVariants: false, variantAxes: [], ncm: d.ncm, origin: "0", taxGroupId: tg?.id ?? null,
      searchText: searchable(d.name, d.key, String(d.plu)), status: "active",
      plu: d.plu, shelfLifeDays: d.shelfLifeDays, scaleTare: d.tare, nutrition: d.nutrition, scaleEnabled: true,
    });
    const sku = await sd.put("skus", `${d.key}-u`, {
      ...base, productId: product.id, sku: code, barcode: null, attributes: {}, name: d.name, unitCode: "KG", active: true, costAcquisition: d.cost, costAdditional: 0, costTotal: d.cost,
      searchText: searchable(d.name, code),
    });
    await sd.put("prices", `varejo-${d.key}-u`, {
      ...base, priceTableId: refs.priceTables.varejo.id, skuId: sku.id, productId: product.id, scopeKey: priceScopeKey(refs.priceTables.varejo.id, sku.id, null, null), price: d.price, maxDiscountBps: 1000,
    });
    const wh = refs.warehouses["matriz-main"];
    await postMovements(admin, [{ warehouseId: wh.id, skuId: sku.id, qty: 20000, type: "initial", unitCost: d.cost, originType: "seed", reason: "Saldo inicial (demonstração da balança)", idemKey: `seed-initial:${wh.id}:${sku.id}`, occurredAt: new Date(Date.now() - 5 * 86400000).toISOString() }]);
    out[d.key] = { plu: d.plu, skuId: sku.id };
  }
  return { ...out, labels: SCALE_DEMO_LABELS };
}
