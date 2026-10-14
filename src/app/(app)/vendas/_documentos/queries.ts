import "server-only";
import { listAll } from "@/lib/db";
import type { Doc, Filter } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, dayRange, today } from "@/lib/dates";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { nameMap } from "@/lib/server/lookups";
import { documentItems, type SalesDocType } from "@/domain/sales-documents";
import { canViewBranch } from "../queries";

export interface DocRow {
  id: string;
  type: SalesDocType;
  number: number;
  status: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  sellerName: string | null;
  branchName: string;
  createdAt: string;
  validUntil: string | null;
  deliveryDate: string | null;
  total: number;
  itemsCount: number;
  qtyTotal: number;
  invoicedQtyTotal: number;
  reservationStatus: string | null;
  expiringSoon: boolean;
}

/** Período padrão da lista: últimos 90 dias (data de criação). */
export function docsPeriod(f: Record<string, string>) {
  const to = f.ate || today();
  const from = f.de || addDays(to, -89);
  return { from, to };
}

/** Consulta única da lista de orçamentos/pedidos (filtros da URL). */
export async function queryDocuments(ctx: Ctx, type: SalesDocType, p: Pick<ListParams, "q" | "f">): Promise<DocRow[]> {
  const { from, to } = docsPeriod(p.f);
  const { start, end } = dayRange(from, to);
  const filters: Filter[] = [["eq", "companyId", ctx.companyId], ["eq", "type", type], ["gte", "createdAt", start], ["lt", "createdAt", end]];
  const branch = ctx.branchId ?? p.f.filial ?? null;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (p.f.situacao) filters.push(["eq", "status", p.f.situacao]);
  if (p.f.cliente) filters.push(["eq", "customerId", p.f.cliente]);
  if (p.f.vendedor) filters.push(["eq", "sellerId", p.f.vendedor]);
  let rows = (await listAll(ctx.store, "sales_documents", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] })).filter((d) => canViewBranch(ctx, d.branchId));
  if (p.q) {
    const q = normalizeSearch(p.q);
    const num = /^\d{1,9}$/.test(p.q.trim()) ? Number(p.q.trim()) : null;
    rows = rows.filter((d) => (num != null && d.number === num) || String(d.searchText ?? "").includes(q) || normalizeSearch(d.customerSnapshot?.name ?? "").includes(q));
  }
  const t = today();
  if (p.f.validade === "vencendo") rows = rows.filter((d) => d.validUntil && d.validUntil >= t && d.validUntil <= addDays(t, 3) && ["draft", "sent", "approved"].includes(d.status));
  if (p.f.reserva) rows = rows.filter((d) => (d.reservationStatus ?? "none") === p.f.reserva);
  const [users, branches] = await Promise.all([nameMap(ctx, "users"), nameMap(ctx, "branches")]);
  return rows.map((d) => ({
    id: d.id,
    type: d.type,
    number: d.number,
    status: d.status,
    customerId: d.customerId ?? null,
    customerName: d.customerSnapshot?.name ?? "Sem cliente",
    customerPhone: d.customerSnapshot?.phone ?? null,
    sellerName: d.sellerId ? (users.get(d.sellerId) ?? null) : null,
    branchName: branches.get(d.branchId) ?? "",
    createdAt: d.createdAt,
    validUntil: d.validUntil ?? null,
    deliveryDate: d.deliveryDate ?? null,
    total: d.total ?? 0,
    itemsCount: d.itemsCount ?? 0,
    qtyTotal: d.qtyTotal ?? 0,
    invoicedQtyTotal: d.invoicedQtyTotal ?? 0,
    reservationStatus: d.reservationStatus ?? null,
    expiringSoon: Boolean(d.type === "quote" && d.validUntil && d.validUntil >= t && d.validUntil <= addDays(t, 3) && ["draft", "sent", "approved"].includes(d.status)),
  }));
}

/** Detalhe: itens, reservas, faturamentos (vendas e NF-e vinculadas) e documentos relacionados. */
export async function documentView(ctx: Ctx, id: string) {
  const doc = await ctx.store.get("sales_documents", id);
  if (!doc || doc.companyId !== ctx.companyId || !canViewBranch(ctx, doc.branchId)) return null;
  const [items, reservations, sales, nfes, bills, users, branch] = await Promise.all([
    documentItems(ctx.store, id),
    listAll(ctx.store, "stock_reservations", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", id]] }),
    listAll(ctx.store, "sales", { filters: [["eq", "salesDocumentId", id]], orderBy: [{ field: "completedAt", dir: "asc" }] }),
    listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", id], ["eq", "model", "nfe"]] }),
    listAll(ctx.store, "operations", { filters: [["eq", "entityType", "sales_document"], ["eq", "entityId", id], ["eq", "type", ["sales_doc.bill", "sales_doc.unbill"]]] }),
    nameMap(ctx, "users"),
    ctx.store.get("branches", doc.branchId),
  ]);
  const related: Doc[] = [];
  for (const rid of [doc.sourceQuoteId, doc.convertedOrderId, doc.duplicatedFrom]) {
    if (!rid) continue;
    const r = await ctx.store.get("sales_documents", rid);
    if (r && r.companyId === ctx.companyId) related.push(r);
  }
  const term = doc.paymentTermId ? await ctx.store.get("payment_terms", doc.paymentTermId) : null;
  const priceTable = doc.priceTableId ? await ctx.store.get("price_tables", doc.priceTableId) : null;
  const unbilled = new Set(bills.filter((b) => b.type === "sales_doc.unbill").map((b) => b.result?.source));
  const billings = bills
    .filter((b) => b.type === "sales_doc.bill")
    .map((b) => ({ id: b.id, source: b.result?.source as string, sourceId: b.result?.sourceId as string, sourceNumber: b.result?.sourceNumber ?? null, at: (b.result?.at ?? b.createdAt) as string, lines: (b.result?.lines ?? []) as Array<{ itemId: string; seq: number; qty: number }>, reversed: unbilled.has(`${b.result?.source}:${b.result?.sourceId}`) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    doc,
    items,
    reservations: reservations.filter((r) => r.status === "active"),
    allReservations: reservations,
    sales,
    nfes: nfes.filter((n) => n.companyId === ctx.companyId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    billings,
    related,
    sellerName: doc.sellerId ? (users.get(doc.sellerId) ?? null) : null,
    createdByName: users.get(doc.createdBy) ?? null,
    branch,
    termName: (term?.name ?? null) as string | null,
    priceTableName: (priceTable?.name ?? null) as string | null,
  };
}
