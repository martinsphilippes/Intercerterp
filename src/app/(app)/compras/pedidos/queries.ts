import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { dayRange } from "@/lib/dates";
import { branchFilter } from "@/lib/server/lookups";
import { supplierLabel } from "@/domain/suppliers";

export const ORDER_STATUS_GROUPS: Record<string, string[]> = {
  pending: ["draft", "in_review", "adjust"],
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
  if (p.f.from || p.f.to) {
    const r = dayRange(p.f.from || "2000-01-01", p.f.to || "2100-12-31");
    filters.push(["gte", "createdAt", r.start], ["lt", "createdAt", r.end]);
  }
  if (p.q) {
    const n = Number(p.q.replace(/\D/g, ""));
    filters.push(/^\s*\d+\s*$/.test(p.q) ? ["or", [["eq", "number", n], ["contains", "searchText", normalizeSearch(p.q)]]] : ["contains", "searchText", normalizeSearch(p.q)]);
  }
  const orders = await listAll(ctx.store, "purchase_orders", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const branches = new Map((await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).map((b) => [b.id, b.name]));
  const rows = orders.map((o) => ({
    ...o,
    supplierName: supplierLabel(o.supplierSnapshot),
    branchName: branches.get(o.branchId) ?? "—",
    remainingValue: ["approved", "sent", "partial"].includes(o.status) ? Math.max(0, o.total - (o.receivedValue ?? 0)) : 0,
    awaitingSend: o.status === "approved" || (o.status === "sent" && (o.sentInfo?.revision ?? o.revision) < (o.revision ?? 1)),
    overdue: ["approved", "sent", "partial"].includes(o.status) && o.expectedDate && o.expectedDate < new Date().toISOString().slice(0, 10),
  }));
  if (p.f.late === "1") return rows.filter((r) => r.overdue);
  return rows;
}

/** Dados dos seletores do formulário de pedido (fornecedores ativos, depósitos da filial, condições). */
export async function orderFormData(ctx: Ctx) {
  const [suppliers, warehouses, terms] = await Promise.all([
    listAll(ctx.store, "suppliers", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "active"]] }),
    ctx.branchId ? listAll(ctx.store, "warehouses", { filters: [["eq", "branchId", ctx.branchId], ["ne", "status", "inactive"]] }) : Promise.resolve([]),
    listAll(ctx.store, "payment_terms", { filters: [["eq", "companyId", ctx.companyId], ["eq", "active", true]] }),
  ]);
  return {
    suppliers: suppliers.map((s) => ({ value: s.id, label: supplierLabel(s), leadTimeDays: s.leadTimeDays ?? null, paymentTermId: s.paymentTermId ?? null, minOrderValue: s.minOrderValue ?? 0, email: s.email ?? null })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    warehouses: warehouses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((w) => ({ value: w.id, label: `${w.name}${w.kind === "damaged" ? " (avarias)" : ""}` })),
    terms: terms.map((t) => ({ value: t.id, label: t.name, installments: t.installments ?? 1, firstDueDays: t.firstDueDays ?? 0, intervalDays: t.intervalDays ?? 30 })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  };
}
