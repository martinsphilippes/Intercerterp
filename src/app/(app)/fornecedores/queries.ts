import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { onlyDigits } from "@/lib/core/text";
import { today } from "@/lib/dates";

/** Consulta única da listagem de fornecedores (tela e exportação). */
export async function querySuppliers(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.personType) filters.push(["eq", "personType", p.f.personType]);
  if (p.q) {
    const d = onlyDigits(p.q);
    filters.push(d.length >= 5 ? ["or", [["contains", "searchText", normalizeSearch(p.q)], ["startsWith", "doc", d]]] : ["contains", "searchText", normalizeSearch(p.q)]);
  }
  const suppliers = await listAll(ctx.store, "suppliers", { filters, orderBy: [{ field: "name", dir: "asc" }] });
  const [orders, receipts, installments, products] = await Promise.all([
    listAll(ctx.store, "purchase_orders", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["approved", "sent", "partial", "draft", "in_review", "adjust"]]] }),
    listAll(ctx.store, "receipts", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "confirmed"]] }),
    listAll(ctx.store, "installments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "payable"], ["eq", "status", ["open", "partial"]], ["notNull", "partyId"]] }),
    listAll(ctx.store, "supplier_products", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  const t = today();
  const agg = new Map<string, { openOrders: number; openOrdersValue: number; pendingOrders: number; purchased: number; lastPurchase: string | null; payable: number; overdue: number; products: number }>();
  const get = (id: string) => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = { openOrders: 0, openOrdersValue: 0, pendingOrders: 0, purchased: 0, lastPurchase: null, payable: 0, overdue: 0, products: 0 }));
    return a;
  };
  for (const o of orders) {
    const a = get(o.supplierId);
    if (["approved", "sent", "partial"].includes(o.status)) {
      a.openOrders++;
      a.openOrdersValue += Math.max(0, o.total - (o.receivedValue ?? 0));
    } else a.pendingOrders++;
  }
  for (const r of receipts) {
    const a = get(r.supplierId);
    a.purchased += r.dueTotal ?? r.total ?? 0;
    if (!a.lastPurchase || r.confirmedAt > a.lastPurchase) a.lastPurchase = r.confirmedAt;
  }
  for (const i of installments) {
    const a = get(i.partyId);
    a.payable += i.balance;
    if (i.dueDate < t) a.overdue += i.balance;
  }
  for (const sp of products) get(sp.supplierId).products++;
  const rows = suppliers.map((s) => {
    const a = agg.get(s.id) ?? { openOrders: 0, openOrdersValue: 0, pendingOrders: 0, purchased: 0, lastPurchase: null, payable: 0, overdue: 0, products: 0 };
    return { ...s, label: s.tradeName || s.name, city: s.addresses?.[0]?.cityName ?? null, uf: s.addresses?.[0]?.uf ?? null, ...a };
  });
  if (p.f.open === "orders") return rows.filter((r) => r.openOrders > 0);
  if (p.f.open === "payable") return rows.filter((r) => r.payable > 0);
  return rows;
}
