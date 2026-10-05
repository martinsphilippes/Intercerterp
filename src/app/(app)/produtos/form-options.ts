import "server-only";
import { listAll } from "@/lib/db";
import type { SessionInfo } from "@/lib/server/session";
import { lookups } from "@/lib/server/lookups";
import { canDo, can } from "@/lib/permissions";
import { ORIGINS, categoryPath, companyRegime, cstOptionsFor } from "@/domain/products";
import { defaultPriceTableId } from "@/domain/pricing";
import type { ProductFormOptions } from "./product-form";

/** Opções dos seletores do cadastro de produto (sempre da empresa ativa). */
export async function productFormOptions(s: SessionInfo): Promise<ProductFormOptions> {
  const ctx = s.ctx;
  const [units, cats, brands, suppliers, taxGroups, warehouses, tableId] = await Promise.all([
    listAll(ctx.store, "units", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] }),
    lookups.brands(ctx),
    lookups.suppliers(ctx),
    listAll(ctx.store, "tax_groups", { filters: [["eq", "companyId", ctx.companyId]] }),
    ctx.branchId ? listAll(ctx.store, "warehouses", { filters: [["eq", "branchId", ctx.branchId], ["eq", "kind", "available"]] }) : Promise.resolve([]),
    defaultPriceTableId(ctx.store, ctx.companyId),
  ]);
  const regime = companyRegime(s.company);
  const table = tableId ? await ctx.store.get("price_tables", tableId) : null;
  return {
    units: units.filter((u) => u.status !== "inactive").map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })),
    categories: cats.filter((c) => c.status !== "inactive").map((c) => ({ value: c.id, label: categoryPath(cats, c.id) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    brands,
    suppliers,
    taxGroups: taxGroups
      .filter((t) => t.active !== false)
      .map((t) => ({ value: t.id, label: t.name, detail: `CFOP ${t.cfopInternal ?? "—"}/${t.cfopInterstate ?? "—"} · ${regime === "simples" ? "CSOSN" : "CST"} ${t.cstCsosn ?? "—"}${t.icmsRateBps ? ` · ICMS ${t.icmsRateBps / 100}%` : ""}` })),
    origins: ORIGINS,
    cstOptions: cstOptionsFor(regime),
    regimeLabel: regime === "simples" ? "Simples Nacional (CSOSN)" : "Regime normal (CST)",
    warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
    canStock: canDo(s.user, "stock.adjust") || can(s.user, "stock", "create"),
    branchName: s.branch?.name ?? null,
    defaultTableName: table?.name ?? null,
  };
}
