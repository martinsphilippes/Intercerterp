import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { dayRange, diffDays, today } from "@/lib/dates";
import { branchFilter } from "@/lib/server/lookups";
import { supplierLabel, supplierPerformance } from "@/domain/suppliers";
import { policyPreview } from "@/domain/approvals";
import { purchaseBudget } from "@/domain/purchases";

export const ORDER_STATUS_GROUPS: Record<string, string[]> = {
  pending: ["draft", "in_review", "adjust"],
  drafting: ["draft", "adjust"],
  open: ["approved", "sent", "partial"],
  to_send: ["approved"],
};

/** Consulta única da listagem de pedidos de compra (tela e exportação). */
export async function queryOrders(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId], ...branchFilter(ctx)];
  const st = p.f.status;
  if (st) filters.push(["eq", "status", ORDER_STATUS_GROUPS[st] ?? [st]]);
  if (p.f.supplier) filters.push(["eq", "supplierId", p.f.supplier]);
  if (p.f.origin) filters.push(["eq", "origin", p.f.origin]);
  if (p.f.buyer) filters.push(["eq", "buyerId", p.f.buyer]);
  if (p.f.from || p.f.to) {
    const r = dayRange(p.f.from || "2000-01-01", p.f.to || "2100-12-31");
    filters.push(["gte", "createdAt", r.start], ["lt", "createdAt", r.end]);
  }
  const orders = await listAll(ctx.store, "purchase_orders", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const [branches, users] = await Promise.all([
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] }).then((b) => new Map(b.map((x) => [x.id, x.name]))),
    listAll(ctx.store, "users").then((u) => new Map(u.map((x) => [x.id, x.name as string]))),
  ]);
  const items = new Map<string, Array<{ description: string; qty: number; skuId: string }>>();
  const ids = orders.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 100) {
    for (const it of await listAll(ctx.store, "purchase_order_items", { filters: [["eq", "orderId", ids.slice(i, i + 100)]] })) {
      const arr = items.get(it.orderId) ?? [];
      arr.push({ description: it.description ?? "", qty: it.qty, skuId: it.skuId });
      items.set(it.orderId, arr);
    }
  }
  const t = today();
  let rows = orders.map((o) => {
    const its = items.get(o.id) ?? [];
    return {
      ...o,
      supplierName: supplierLabel(o.supplierSnapshot),
      supplierDoc: o.supplierSnapshot?.doc ?? null,
      branchName: branches.get(o.branchId) ?? "—",
      buyerName: o.buyerId ? users.get(o.buyerId) ?? "—" : users.get(o.createdBy) ?? "—",
      itemsCount: its.length,
      unitsQty: its.reduce((a, i) => a + i.qty, 0),
      itemsText: its.map((i) => i.description).join(" "),
      remainingValue: ["approved", "sent", "partial"].includes(o.status) ? Math.max(0, o.total - (o.receivedValue ?? 0)) : 0,
      awaitingSend: o.status === "approved" || (o.status === "sent" && (o.sentInfo?.revision ?? o.revision) < (o.revision ?? 1)),
      overdue: Boolean(["approved", "sent", "partial"].includes(o.status) && o.expectedDate && o.expectedDate < t),
      daysToExpected: o.expectedDate ? diffDays(t, o.expectedDate) : null,
    };
  });
  if (p.q) {
    const term = normalizeSearch(p.q);
    const num = /^\s*\d+\s*$/.test(p.q) ? Number(p.q) : null;
    rows = rows.filter((r) => r.number === num || normalizeSearch(`${r.searchText ?? ""} ${r.supplierName} ${r.purpose ?? ""} ${r.buyerName} ${r.itemsText}`).includes(term));
  }
  if (p.f.late === "1") rows = rows.filter((r) => r.overdue);
  return rows;
}

/** Dados dos seletores do formulário de pedido (fornecedores ativos, depósitos da filial, condições). */
export async function orderFormData(ctx: Ctx) {
  const [suppliers, warehouses, terms, methods, costCenters, users] = await Promise.all([
    listAll(ctx.store, "suppliers", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "active"]] }),
    ctx.branchId ? listAll(ctx.store, "warehouses", { filters: [["eq", "branchId", ctx.branchId], ["ne", "status", "inactive"]] }) : Promise.resolve([]),
    listAll(ctx.store, "payment_terms", { filters: [["eq", "companyId", ctx.companyId], ["eq", "active", true]] }),
    listAll(ctx.store, "payment_methods", { filters: [["eq", "companyId", ctx.companyId], ["eq", "active", true]] }),
    listAll(ctx.store, "cost_centers", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "users", { filters: [["eq", "status", "active"]] }),
  ]);
  const perf = await supplierPerformance(ctx.store, ctx.companyId, suppliers.map((s) => s.id));
  const [policy, budget] = await Promise.all([policyPreview(ctx.store, ctx.companyId), ctx.branchId ? purchaseBudget(ctx.store, ctx.companyId, ctx.branchId) : Promise.resolve(null)]);
  const termNames = new Map(terms.map((t) => [t.id, t.name]));
  return {
    suppliers: suppliers
      .map((s) => ({
        value: s.id, label: supplierLabel(s), leadTimeDays: s.leadTimeDays ?? null, paymentTermId: s.paymentTermId ?? null, minOrderValue: s.minOrderValue ?? 0, email: s.email ?? null,
        doc: s.doc ?? null, contact: (s.contacts ?? [])[0]?.name ?? null, terms: [s.paymentTermId ? termNames.get(s.paymentTermId) : null, s.paymentTermsText].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ") || null,
        score: perf.get(s.id)?.score ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    methods: methods.filter((m) => !["crediario", "store_credit"].includes(m.kind)).map((m) => ({ value: m.id, label: m.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    costCenters: costCenters.filter((c) => c.active !== false).map((c) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name })),
    policy,
    budget,
    buyers: users.filter((u) => u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId)).map((u) => ({ value: u.id, label: u.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    warehouses: warehouses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((w) => ({ value: w.id, label: `${w.name}${w.kind === "damaged" ? " (avarias)" : ""}` })),
    terms: terms.map((t) => ({ value: t.id, label: t.name, installments: t.installments ?? 1, firstDueDays: t.firstDueDays ?? 0, intervalDays: t.intervalDays ?? 30 })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  };
}
