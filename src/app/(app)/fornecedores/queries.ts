import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { onlyDigits } from "@/lib/core/text";
import { addMonths, monthStart, today } from "@/lib/dates";
import { supplierPerformance } from "@/domain/suppliers";

/** Consulta única da listagem de fornecedores (tela e exportação). */
export async function querySuppliers(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.personType) filters.push(["eq", "personType", p.f.personType]);
  if (p.f.category) filters.push(["eq", "category", p.f.category]);
  let suppliers = await listAll(ctx.store, "suppliers", { filters, orderBy: [{ field: "name", dir: "asc" }] });
  if (p.q) {
    // busca por razão social/fantasia/CNPJ/código/e-mail, contato e produto fornecido (nome, SKU ou código do fornecedor)
    const term = normalizeSearch(p.q);
    const d = onlyDigits(p.q);
    const bySku = new Set<string>();
    const skus = await ctx.store.list("skus", { filters: [["eq", "companyId", ctx.companyId], ["or", [["contains", "searchText", term], ["eq", "sku", p.q.toUpperCase()]]]], limit: 200, total: false });
    const skuIds = skus.items.map((k) => k.id);
    const sps = skuIds.length ? await listAll(ctx.store, "supplier_products", { filters: [["eq", "skuId", skuIds]] }) : [];
    for (const sp of sps) bySku.add(sp.supplierId);
    for (const sp of await listAll(ctx.store, "supplier_products", { filters: [["eq", "companyId", ctx.companyId], ["startsWith", "supplierCode", p.q.trim()]] })) bySku.add(sp.supplierId);
    suppliers = suppliers.filter((sup) => (sup.searchText ?? "").includes(term) || (d.length >= 5 && (sup.doc ?? "").startsWith(d)) || bySku.has(sup.id) || (sup.contacts ?? []).some((c: any) => normalizeSearch(`${c.name ?? ""} ${c.email ?? ""}`).includes(term)));
  }
  const [orders, receipts, installments, products] = await Promise.all([
    listAll(ctx.store, "purchase_orders", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["approved", "sent", "partial", "draft", "in_review", "adjust"]]] }),
    listAll(ctx.store, "receipts", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "confirmed"]] }),
    listAll(ctx.store, "installments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "payable"], ["eq", "status", ["open", "partial"]], ["notNull", "partyId"]] }),
    listAll(ctx.store, "supplier_products", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  const t = today();
  type Agg = { openOrders: number; openOrdersValue: number; pendingOrders: number; purchased: number; purchasedMonth: number; receiptsMonth: number; lastPurchase: string | null; lastDoc: string | null; lastReceiptId: string | null; payable: number; payableCount: number; overdue: number; products: number };
  const empty = (): Agg => ({ openOrders: 0, openOrdersValue: 0, pendingOrders: 0, purchased: 0, purchasedMonth: 0, receiptsMonth: 0, lastPurchase: null, lastDoc: null, lastReceiptId: null, payable: 0, payableCount: 0, overdue: 0, products: 0 });
  const agg = new Map<string, Agg>();
  const get = (id: string) => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = empty()));
    return a;
  };
  const month = t.slice(0, 7);
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
    if ((r.confirmedAt ?? "").slice(0, 7) === month) {
      a.purchasedMonth += r.dueTotal ?? 0;
      a.receiptsMonth++;
    }
    if (!a.lastPurchase || r.confirmedAt > a.lastPurchase) {
      a.lastPurchase = r.confirmedAt;
      a.lastDoc = r.nfeNumber ? `NF-e ${r.nfeNumber}` : `Receb. nº ${r.number}`;
      a.lastReceiptId = r.id;
    }
  }
  for (const i of installments) {
    const a = get(i.partyId);
    a.payable += i.balance;
    a.payableCount++;
    if (i.dueDate < t) a.overdue += i.balance;
  }
  for (const sp of products) get(sp.supplierId).products++;
  const perf = await supplierPerformance(ctx.store, ctx.companyId);
  const rows = suppliers.map((s) => {
    const a = agg.get(s.id) ?? empty();
    const pf = perf.get(s.id);
    return { ...s, label: s.tradeName || s.name, city: s.addresses?.[0]?.cityName ?? null, uf: s.addresses?.[0]?.uf ?? null, ...a, score: pf?.score ?? null, onTimeRate: pf?.onTimeRate ?? null, conformityRate: pf?.conformityRate ?? null };
  });
  if (p.f.open === "orders") return rows.filter((r) => r.openOrders > 0);
  if (p.f.open === "payable") return rows.filter((r) => r.payable > 0);
  return rows;
}

/** Prazo médio negociado (dias, ponderado pelo valor das parcelas) dos pedidos criados no mês e no mês anterior. */
export async function negotiatedTerm(ctx: Ctx) {
  const start = monthStart(today());
  const prevStart = addMonths(start, -1);
  const orders = await listAll(ctx.store, "purchase_orders", { filters: [["eq", "companyId", ctx.companyId], ["gte", "createdAt", `${prevStart}T00:00:00.000Z`], ["ne", "status", "cancelled"]] });
  const avg = (list: any[]) => {
    let w = 0;
    let sum = 0;
    for (const o of list) for (const p of o.installmentsPlan ?? []) {
      w += p.amount;
      sum += p.amount * p.days;
    }
    return w ? Math.round(sum / w) : null;
  };
  const cur = orders.filter((o) => o.createdAt.slice(0, 10) >= start);
  const prev = orders.filter((o) => o.createdAt.slice(0, 10) < start);
  return { current: avg(cur), previous: avg(prev), orders: cur.length };
}
