import "server-only";
import { listAll } from "../db";
import type { Ctx } from "../core/ctx";

/** Opções para seletores (sempre da empresa ativa). */
type Opt = { value: string; label: string };
const byName = (a: Opt, b: Opt) => a.label.localeCompare(b.label, "pt-BR");

async function opts(ctx: Ctx, collection: string, label: (d: any) => string, extra: any[] = []): Promise<Opt[]> {
  const rows = await listAll(ctx.store, collection, { filters: [["eq", "companyId", ctx.companyId], ...extra] });
  return rows.map((r) => ({ value: r.id, label: label(r) })).sort(byName);
}

export const lookups = {
  branches: (ctx: Ctx) => opts(ctx, "branches", (b) => b.name),
  warehouses: (ctx: Ctx, branchId?: string | null) => opts(ctx, "warehouses", (w) => w.name, branchId ? [["eq", "branchId", branchId]] : []),
  categories: (ctx: Ctx) => opts(ctx, "categories", (c) => c.name),
  brands: (ctx: Ctx) => opts(ctx, "brands", (c) => c.name),
  units: async (ctx: Ctx) => (await listAll(ctx.store, "units", { filters: [["eq", "companyId", ctx.companyId]] })).map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })),
  suppliers: (ctx: Ctx) => opts(ctx, "suppliers", (s) => s.tradeName || s.name, [["ne", "status", "inactive"]]),
  customers: (ctx: Ctx) => opts(ctx, "customers", (s) => s.name, [["ne", "status", "inactive"]]),
  priceTables: (ctx: Ctx) => opts(ctx, "price_tables", (p) => p.name, [["eq", "active", true]]),
  paymentTerms: (ctx: Ctx) => opts(ctx, "payment_terms", (p) => p.name, [["eq", "active", true]]),
  paymentMethods: (ctx: Ctx) => opts(ctx, "payment_methods", (p) => p.name, [["eq", "active", true]]),
  accounts: (ctx: Ctx) => opts(ctx, "financial_accounts", (a) => a.name, [["eq", "active", true]]),
  finCategories: (ctx: Ctx, type?: "revenue" | "expense") => opts(ctx, "fin_categories", (c) => c.name, type ? [["eq", "type", type]] : []),
  costCenters: (ctx: Ctx) => opts(ctx, "cost_centers", (c) => (c.code ? `${c.code} — ${c.name}` : c.name)),
  taxGroups: (ctx: Ctx) => opts(ctx, "tax_groups", (c) => c.name),
  terminals: (ctx: Ctx, branchId?: string | null) => opts(ctx, "terminals", (t) => t.name, branchId ? [["eq", "branchId", branchId]] : []),
  roles: (ctx: Ctx) => opts(ctx, "roles", (r) => r.name),
  users: async (ctx: Ctx) => (await listAll(ctx.store, "users")).filter((u) => u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId)).map((u) => ({ value: u.id, label: u.name })).sort(byName),
};

/** Mapa id → nome para exibir referências em listagens. */
export async function nameMap(ctx: Ctx, collection: string, label: (d: any) => string = (d) => d.name): Promise<Map<string, string>> {
  const filters: any[] = collection === "users" ? [] : [["eq", "companyId", ctx.companyId]];
  const rows = await listAll(ctx.store, collection, { filters });
  return new Map(rows.map((r) => [r.id, label(r)]));
}

/** Filtro de filial: no consolidado retorna null (todas as filiais da empresa). */
export function branchFilter(ctx: Ctx): any[] {
  return ctx.branchId ? [["eq", "branchId", ctx.branchId]] : [];
}
