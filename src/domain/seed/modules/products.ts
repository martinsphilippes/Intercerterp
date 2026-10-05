import type { DemoRefs } from "../base";
import { addDays, today } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/core/settings";
import { createProduct, postInitialBalance, saveSkuCosts, saveUnitConversion } from "../../products";
import { savePrice } from "../../pricing";

/**
 * Demonstração do módulo de produtos (idempotente):
 *  - "Vela Aromática" com saldo inicial e SEM histórico de vendas;
 *  - rascunho sem NCM ("Incompleto") e item com ST sem CEST ("Revisar") já existente (fone);
 *  - preço promocional com vigência, custo com adicionais (histórico) e conversão CX → UN.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const companyId = refs.company.id;
  const ctx = await refs.ctxFor("admin", "matriz");
  const out: Record<string, unknown> = {};

  // produto sem vendas, com saldo inicial identificado (uma vez por saldo)
  const vela = refs.skus["vela-u"];
  if (vela) {
    const mov = await postInitialBalance(ctx, { warehouseId: refs.warehouses["matriz-main"].id, skuId: vela.id, qty: 9000, unitCost: vela.costTotal ?? 1600 }).catch((e) => ({ skipped: e.message }));
    out.vela = (mov as any)?.id ?? mov;
  }
  // rascunho incompleto (sem NCM), idempotente pelo idemKey
  const draft = await createProduct(ctx, { type: "product", draft: true, code: "GARRAFA500", name: "Garrafa Térmica 500 ml", unitCode: "UN", categoryId: refs.categories["Casa"].id, availablePdv: true, availableEcommerce: true }, { idemKey: "demo-product-garrafa", costAcquisition: 2500, price: 5990, wholesalePrice: 4990, wholesaleMinQty: 6000 });
  out.draft = draft.id;

  if (!(await getSetting(store, companyId, null, "demo.products.v1", false))) {
    const caneca = refs.skus["caneca-u"];
    const from = addDays(today(), -2);
    await savePrice(ctx, { priceTableId: refs.priceTables.varejo.id, skuId: caneca.id, price: 2990, validFrom: from, validTo: addDays(from, 12), maxDiscountBps: 500, reason: "Promoção da semana (demonstração)" });
    const camisetas = Object.keys(refs.skus).filter((k) => k.startsWith("camiseta-"));
    if (camisetas.length) {
      const first = refs.skus[camisetas[0]];
      await saveSkuCosts(ctx, first.id, { costAcquisition: 1890, additionalCosts: [{ name: "Frete", amount: 120 }, { name: "Embalagem", amount: 35 }], reason: "Rateio de frete e embalagem (demonstração)", applyToAllVariants: true });
    }
    await saveUnitConversion(ctx, { productId: refs.products.caneta.id, fromUnit: "CX", toUnit: "UN", factor: 50000 }).catch(() => undefined);
    await setSetting(store, companyId, null, "demo.products.v1", true);
    out.extras = "created";
  }
  return out;
}
