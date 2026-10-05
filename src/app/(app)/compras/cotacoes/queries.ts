import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { today } from "@/lib/dates";
import { branchFilter } from "@/lib/server/lookups";
import { evaluateSelection, type QuoteItem } from "@/domain/purchase-calc";
import { toQuoteProposals } from "@/domain/quotations";
import { supplierLabel } from "@/domain/suppliers";

/** Consulta única da listagem de cotações (tela e exportação). */
export async function queryQuotations(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId], ...branchFilter(ctx)];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.origin) filters.push(["eq", "origin", p.f.origin]);
  const list = await listAll(ctx.store, "quotations", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const ids = list.map((q) => q.id);
  const proposals: any[] = [];
  for (let i = 0; i < ids.length; i += 100) proposals.push(...(await listAll(ctx.store, "quotation_proposals", { filters: [["eq", "quotationId", ids.slice(i, i + 100)]] })));
  const suppliers = new Map((await listAll(ctx.store, "suppliers", { filters: [["eq", "companyId", ctx.companyId]] })).map((s) => [s.id, supplierLabel(s)]));
  const ref = today();
  let rows = list.map((q) => {
    const props = proposals.filter((p) => p.quotationId === q.id);
    const assign = Object.fromEntries(Object.entries(q.selection?.items ?? {}).map(([k, v]: any) => [k, v.supplierId]));
    const ev = evaluateSelection(q.items as QuoteItem[], toQuoteProposals(props, suppliers), assign, ref);
    return {
      ...q,
      itemsCount: (q.items ?? []).length,
      suppliersCount: (q.supplierIds ?? []).length,
      proposalsCount: props.length,
      expiredCount: props.filter((p) => p.validUntil && p.validUntil < ref).length,
      supplierNames: (q.supplierIds ?? []).map((id: string) => suppliers.get(id) ?? "—").join(", "),
      selectedTotal: ev.groups.length ? ev.grandTotal : null,
      selectedSuppliers: ev.groups.length,
    };
  });
  if (p.q) {
    const t = normalizeSearch(p.q);
    rows = rows.filter((r) => String(r.number) === p.q.trim() || normalizeSearch(`${r.title ?? ""} ${r.supplierNames} ${(r.items ?? []).map((i: any) => `${i.description} ${i.sku}`).join(" ")}`).includes(t));
  }
  return rows;
}
