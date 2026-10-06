import type { DemoRefs } from "./base";
import * as products from "./modules/products";
import * as stock from "./modules/stock";
import * as sales from "./modules/sales";
import * as finance from "./modules/finance";
import * as purchases from "./modules/purchases";
import * as fiscal from "./modules/fiscal";
import * as admin from "./modules/admin";
import * as reports from "./modules/reports";
import * as accounting from "./modules/accounting";

/** Cenários de demonstração por módulo (ordem de dependência). */
export async function seedModules(refs: DemoRefs, deadline = Infinity) {
  const out: Record<string, unknown> = {};
  for (const [k, m] of Object.entries({ products, stock, sales, purchases, finance, fiscal, admin, reports, accounting })) {
    if (Date.now() > deadline) return { out, done: false };
    out[k] = await m.seed(refs); // cada módulo é idempotente: reexecutar continua de onde parou
    console.log(`[demo] módulo ${k} pronto`);
  }
  return { out, done: true };
}
