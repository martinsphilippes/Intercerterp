import type { DemoRefs } from "./base";
import * as products from "./modules/products";
import * as stock from "./modules/stock";
import * as sales from "./modules/sales";
import * as finance from "./modules/finance";
import * as purchases from "./modules/purchases";
import * as fiscal from "./modules/fiscal";
import * as admin from "./modules/admin";
import * as reports from "./modules/reports";

/** Cenários de demonstração por módulo (ordem de dependência). */
export async function seedModules(refs: DemoRefs) {
  const out: Record<string, unknown> = {};
  for (const [k, m] of Object.entries({ products, stock, sales, purchases, finance, fiscal, admin, reports })) {
    out[k] = await m.seed(refs);
  }
  return out;
}
