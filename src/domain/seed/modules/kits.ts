import { detId } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { QTY } from "@/lib/money";
import { searchable } from "@/lib/core/text";
import { BusinessError } from "@/lib/core/errors";
import { priceScopeKey } from "../../pricing";
import type { DemoRefs } from "../base";

/**
 * Demonstração da Fase 6 — kits e composição (CAD-12/13), idempotente (ids determinísticos e chaves de operação):
 *  - KIT "Kit Escolar" (2 cadernos + 1 caixa de canetas) com preço próprio, vendido uma vez no PDV da Matriz
 *    (o estoque baixa os componentes; o custo do item = soma dos custos médios);
 *  - COMPOSTO "Combo Acessórios (montado)" (1 boné + 1 cinto) com estoque próprio, montado na Matriz.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const store = sd.store;
  const { saveComponent, setComposition, runAssembly, planAssembly } = await import("../../product-components");
  const admin = await refs.ctxFor("admin", "matriz");
  const out: Record<string, unknown> = {};
  const base = { companyId: refs.company.id, isDemo: true, createdBy: refs.users.admin.id };
  const ref = refs.products["caderno"];

  const define = async (key: string, name: string, code: string, price: number, cost: number, catKey: string, ncm: string): Promise<{ product: Doc; sku: Doc }> => {
    const product = await sd.put("products", key, {
      ...base, type: "product", code, name, description: `${name} — produto de demonstração (Fase 6).`, gtin: null, unitCode: "UN",
      categoryId: refs.categories[catKey]?.id ?? ref.categoryId ?? null, brandId: ref.brandId ?? null, supplierId: null, active: true, availablePdv: true, availableEcommerce: false,
      hasVariants: false, variantAxes: [], ncm, origin: "0", taxGroupId: ref.taxGroupId ?? null, searchText: searchable(name, code), status: "active",
    });
    const sku = await sd.put("skus", `${key}-u`, {
      ...base, productId: product.id, sku: code, barcode: null, attributes: {}, name, unitCode: "UN", active: true, costAcquisition: cost, costAdditional: 0, costTotal: cost, searchText: searchable(name, code),
    });
    await sd.put("prices", `varejo-${key}-u`, { ...base, priceTableId: refs.priceTables.varejo.id, skuId: sku.id, productId: product.id, scopeKey: priceScopeKey(refs.priceTables.varejo.id, sku.id, null, null), price, maxDiscountBps: 1000 });
    if (refs.priceTables.atacado) await sd.put("prices", `atacado-${key}-u`, { ...base, priceTableId: refs.priceTables.atacado.id, skuId: sku.id, productId: product.id, scopeKey: priceScopeKey(refs.priceTables.atacado.id, sku.id, null, null), price: Math.round(price * 0.9), maxDiscountBps: 500 });
    return { product, sku };
  };
  const component = async (product: Doc, skuKey: string, qty: number) => {
    const comp = refs.skus[skuKey];
    if (!comp) return;
    if (await store.get("product_components", detId("pcomp", product.id, "*", comp.id))) return;
    await saveComponent(admin, { productId: product.id, componentSkuId: comp.id, qty });
  };

  // KIT — vendido como um item; baixa os componentes na venda
  const kit = await define("kit-escolar", "Kit Escolar (2 cadernos + canetas)", "KIT-ESCOLAR", 8990, 0, "Papelaria", "48202000");
  if ((await store.getOrThrow("products", kit.product.id)).composition !== "kit") await setComposition(admin, kit.product.id, "kit");
  await component(kit.product, "caderno-u", 2 * QTY);
  await component(kit.product, "caneta-u", QTY);
  out.kit = kit.sku.sku;

  // venda de demonstração do kit no caixa aberto da Matriz (idempotente pela chave)
  const { finalizeSale } = await import("../../sales");
  const { currentSession, openSession } = await import("../../cash");
  const cashier = await refs.ctxFor("cashier", "matriz");
  const terminalId = refs.terminals.cx1.id;
  if (!(await store.get("sales", detId("sale", "demo-kit-sale-1")))) {
    try {
      if (!(await currentSession(cashier, terminalId))) await openSession(cashier, { terminalId, openingFund: 20000 });
      const sale = await finalizeSale(cashier, { idemKey: "demo-kit-sale-1", terminalId, items: [{ skuId: kit.sku.id, qty: QTY }], payments: [{ methodId: refs.methods.pix.id, amount: 8990, reference: "E2EDEMOKIT0001" }], notes: "Venda de kit (demonstração): baixa de 2 cadernos e 1 caixa de canetas" });
      out.kitSale = sale.number;
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e;
      out.kitSale = `não registrada: ${e.message}`; // sem saldo dos componentes na demonstração: segue sem a venda
    }
  }

  // COMPOSTO — estoque próprio, montado a partir dos componentes
  const combo = await define("combo-acessorios", "Combo Acessórios (montado)", "COMBO-ACESS", 9990, 0, "Acessórios", "65050090");
  if ((await store.getOrThrow("products", combo.product.id)).composition !== "composite") await setComposition(admin, combo.product.id, "composite");
  await component(combo.product, "bone-u", QTY);
  await component(combo.product, "cinto-u", QTY);
  out.composite = combo.sku.sku;
  const wh = refs.warehouses["matriz-main"];
  if (!(await store.get("operations", detId("asm", "demo-assembly-combo-1")))) {
    // monta até 2 unidades, conforme o disponível dos componentes
    const plan = await planAssembly(admin, { skuId: combo.sku.id, warehouseId: wh.id, qty: QTY, direction: "assemble" });
    const units = Math.min(2, ...plan.lines.map((l) => Math.floor(Math.max(0, l.available) / l.moveQty)));
    if (units >= 1) {
      const r = await runAssembly(admin, { skuId: combo.sku.id, warehouseId: wh.id, qty: units * QTY, direction: "assemble", idemKey: "demo-assembly-combo-1", notes: "Montagem de demonstração" });
      out.assembled = r.qty / QTY;
    }
  }
  return out;
}
