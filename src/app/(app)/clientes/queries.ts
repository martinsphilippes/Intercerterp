import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { onlyDigits } from "@/lib/core/text";
import { today, diffDays, startOfLocalDay } from "@/lib/dates";

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
  const stats = new Map<string, { total: number; count: number; last: string; lastValue: number }>();
  for (const s of sales) {
    const cur = stats.get(s.customerId) ?? { total: 0, count: 0, last: "", lastValue: 0 };
    cur.total += s.total - (s.returnedTotal ?? 0);
    cur.count += 1;
    if (s.completedAt > cur.last) {
      cur.last = s.completedAt;
      cur.lastValue = s.total;
    }
    stats.set(s.customerId, cur);
  }
  const open = await listAll(ctx.store, "installments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]], ["notNull", "partyId"]] });
  const balance = new Map<string, number>();
  for (const i of open) balance.set(i.partyId, (balance.get(i.partyId) ?? 0) + i.balance);
  const rows = customers.map((c) => {
    const st = stats.get(c.id);
    const openBalance = balance.get(c.id) ?? 0;
    return {
      ...c, city: c.addresses?.[0]?.cityName ?? null, uf: c.addresses?.[0]?.uf ?? null, totalPurchased: st?.total ?? 0, purchases: st?.count ?? 0,
      ticket: st?.count ? Math.round(st.total / st.count) : 0, lastPurchase: st?.last || null, lastPurchaseValue: st?.lastValue ?? 0, openBalance,
      creditAvailable: c.creditLimit > 0 ? Math.max(0, c.creditLimit - openBalance) : 0, birthdayInDays: daysToBirthday(c.birthDate),
    };
  });
  let out = rows;
  if (p.f.balance === "open") out = out.filter((r) => r.openBalance > 0);
  if (p.f.birthday === "7") out = out.filter((r) => r.birthdayInDays != null && r.birthdayInDays <= 7);
  if (p.f.buyer === "90") {
    const limit = new Date(Date.now() - 90 * 86400000).toISOString();
    out = out.filter((r) => r.lastPurchase && r.lastPurchase >= limit);
  }
  return out;
}

/** Dias até o próximo aniversário (0 = hoje); null sem data de nascimento. */
export function daysToBirthday(birth: string | null | undefined, ref = today()): number | null {
  if (!birth) return null;
  const [, m, d] = birth.split("-").map(Number);
  const [y] = ref.split("-").map(Number);
  let next = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (next < ref) next = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return diffDays(ref, next);
}

/** Indicadores da carteira (mesma base da listagem; critérios explícitos). */
export async function customerKpis(ctx: Ctx) {
  const all = await queryCustomers(ctx, { q: "", f: {} });
  const monthStartIso = new Date(startOfLocalDay(today().slice(0, 8) + "01")).toISOString();
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const recent = await listAll(ctx.store, "sales", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "completed"], ["notNull", "customerId"], ["gte", "completedAt", d30]] });
  const net30 = recent.reduce((a, s) => a + s.total - (s.returnedTotal ?? 0), 0);
  return {
    total: all.length,
    newThisMonth: all.filter((c) => c.createdAt >= monthStartIso).length,
    buyers90: all.filter((c) => c.lastPurchase && c.lastPurchase >= d90).length,
    ticket30: recent.length ? Math.round(net30 / recent.length) : 0,
    sales30: recent.length,
    birthdays7: all.filter((c) => c.birthdayInDays != null && c.birthdayInDays <= 7).length,
  };
}
