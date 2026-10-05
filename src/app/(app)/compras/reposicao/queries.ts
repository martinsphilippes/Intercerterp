import "server-only";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, sp, type SearchParams } from "@/lib/list";
import { computeBranchReplenishment, replenishmentSettings } from "@/domain/replenishment";

/** Consulta única do planejamento de reposição (tela e exportação). */
export async function queryReplenishment(ctx: Ctx, params: SearchParams, accessibleBranchIds: string[]) {
  const branchId = sp(params, "branch") || ctx.branchId || accessibleBranchIds[0] || "";
  if (!accessibleBranchIds.includes(branchId)) return { branchId: null, coverageDays: 0, historyDays: 0, all: [], rows: [] };
  const cfg = await replenishmentSettings(ctx.store, ctx.companyId, branchId);
  const coverageDays = Math.max(0, Number(sp(params, "cobertura")) || cfg.coverageDays);
  const historyDays = Math.max(7, Number(sp(params, "historico")) || cfg.historyDays);
  const supplier = sp(params, "supplier");
  const category = sp(params, "category");
  const show = sp(params, "exibir") || "reorder";
  const q = sp(params, "q");
  const skuParam = sp(params, "sku");
  const all = await computeBranchReplenishment(ctx.store, ctx.companyId, { branchId, coverageDays, historyDays, supplierId: supplier || null, categoryId: category || null });
  let rows = all;
  if (show === "reorder") rows = rows.filter((r) => r.suggested > 0 || r.situation === "risk" || r.situation === "incomplete");
  if (show === "risk") rows = rows.filter((r) => r.situation === "risk");
  if (show === "incomplete") rows = rows.filter((r) => r.situation === "incomplete");
  if (skuParam) {
    const hit = all.find((r) => r.skuId === skuParam);
    rows = [...(hit ? [hit] : []), ...rows.filter((r) => r.skuId !== skuParam)];
  }
  if (q) rows = rows.filter((r) => normalizeSearch(`${r.name} ${r.sku}`).includes(normalizeSearch(q)));
  return { branchId, coverageDays, historyDays, supplier, category, show, q, skuParam, all, rows };
}
