import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { onlyDigits } from "@/lib/core/text";

/** Consulta única usada pela tela e pela exportação (mesmos filtros e critérios). */
export async function queryCustomers(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.personType) filters.push(["eq", "personType", p.f.personType]);
  if (p.f.vip === "1") filters.push(["eq", "vip", true]);
  if (p.f.seller) filters.push(["eq", "sellerId", p.f.seller]);
  if (p.q) {
    const d = onlyDigits(p.q);
    filters.push(d.length >= 5 ? ["or", [["contains", "searchText", normalizeSearch(p.q)], ["startsWith", "doc", d]]] : ["contains", "searchText", normalizeSearch(p.q)]);
  }
  const customers = await listAll(ctx.store, "customers", { filters, orderBy: [{ field: "name", dir: "asc" }] });
  // indicadores do relacionamento a partir das operações reais
  const sales = await listAll(ctx.store, "sales", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "completed"], ["notNull", "customerId"]] });
  const stats = new Map<string, { total: number; count: number; last: string }>();
  for (const s of sales) {
    const cur = stats.get(s.customerId) ?? { total: 0, count: 0, last: "" };
    cur.total += s.total - (s.returnedTotal ?? 0);
    cur.count += 1;
    if (s.completedAt > cur.last) cur.last = s.completedAt;
    stats.set(s.customerId, cur);
  }
  const open = await listAll(ctx.store, "installments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]], ["notNull", "partyId"]] });
  const balance = new Map<string, number>();
  for (const i of open) balance.set(i.partyId, (balance.get(i.partyId) ?? 0) + i.balance);
  const rows = customers.map((c) => {
    const st = stats.get(c.id);
    return { ...c, city: c.addresses?.[0]?.cityName ?? null, uf: c.addresses?.[0]?.uf ?? null, totalPurchased: st?.total ?? 0, purchases: st?.count ?? 0, ticket: st?.count ? Math.round(st.total / st.count) : 0, lastPurchase: st?.last || null, openBalance: balance.get(c.id) ?? 0 };
  });
  if (p.f.balance === "open") return rows.filter((r) => r.openBalance > 0);
  return rows;
}
