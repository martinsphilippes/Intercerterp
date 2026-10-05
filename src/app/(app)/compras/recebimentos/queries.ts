import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { dayRange } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import { branchFilter } from "@/lib/server/lookups";
import { supplierLabel } from "@/domain/suppliers";

/** Consulta única da listagem de recebimentos (tela e exportação). */
export async function queryReceipts(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId], ...branchFilter(ctx)];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  else filters.push(["ne", "status", "cancelled"]);
  if (p.f.supplier) filters.push(["eq", "supplierId", p.f.supplier]);
  const list = await listAll(ctx.store, "receipts", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const suppliers = new Map((await listAll(ctx.store, "suppliers", { filters: [["eq", "companyId", ctx.companyId]] })).map((s) => [s.id, supplierLabel(s)]));
  const orderIds = [...new Set(list.flatMap((r) => r.orderIds ?? []))];
  const orders = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += 100) for (const o of await listAll(ctx.store, "purchase_orders", { filters: [["eq", "id", orderIds.slice(i, i + 100)]] })) orders.set(o.id, o.number);
  let rows = list.map((r) => {
    const items = (r.items ?? []).filter((i: any) => !i.ignore);
    return {
      ...r,
      supplierName: suppliers.get(r.supplierId) ?? r.emitter?.name ?? "—",
      orderNumbers: (r.orderIds ?? []).map((id: string) => ({ id, number: orders.get(id) })),
      itemsCount: items.length,
      receivedUnits: items.reduce((a: number, i: any) => a + (i.receivedQty ?? 0), 0),
      divergenceCount: (r.divergences ?? []).length,
      date: r.confirmedAt ?? r.createdAt,
      hasXml: Boolean(r.xmlFileId),
    };
  });
  if (p.f.from || p.f.to) {
    const rg = dayRange(p.f.from || "2000-01-01", p.f.to || "2100-12-31");
    rows = rows.filter((r) => r.date >= rg.start && r.date < rg.end);
  }
  if (p.f.divergence === "1") rows = rows.filter((r) => r.divergenceCount > 0);
  if (p.q) {
    const term = normalizeSearch(p.q);
    const d = onlyDigits(p.q);
    rows = rows.filter((r) => String(r.number) === p.q.trim() || (r.searchText ?? "").includes(term) || normalizeSearch(r.supplierName).includes(term) || (d.length >= 4 && ((r.nfeKey ?? "").includes(d) || (r.nfeNumber ?? "") === String(Number(d)))));
  }
  return rows;
}
