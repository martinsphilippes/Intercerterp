import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { toLocalDate, today } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import { supplierLabel } from "@/domain/suppliers";
import { pendingInvoiceSettings, pendingState, realizeDueEntries } from "@/domain/pending-invoice";

export const PENDING_STATE_OPTIONS = [
  { value: "open", label: "Aguardando nota (todas)" },
  { value: "overdue", label: "Prazo da nota vencido" },
  { value: "due_soon", label: "Vencendo (dentro da antecedência)" },
  { value: "scheduled", label: "Entradas previstas (a chegar)" },
  { value: "confirmed", label: "Nota confirmada" },
];

/**
 * Consulta única do painel "Compras aguardando nota" (tela, CSV/XLSX e relatório para o contador). Antes de listar,
 * realiza as entradas previstas cuja data/hora já chegou (idempotente — §40).
 */
export async function queryPendingInvoices(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  await realizeDueEntries(ctx.store, ctx.companyId, { branchId: ctx.branchId }).catch(() => null);
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "documentStatus", ["pending_invoice", "confirmed"]], ["ne", "status", "cancelled"]];
  if (ctx.branchId) filters.push(["eq", "branchId", ctx.branchId]);
  if (p.f.supplier) filters.push(["eq", "supplierId", p.f.supplier]);
  const list = await listAll(ctx.store, "receipts", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const supplierIds = [...new Set(list.map((r) => r.supplierId))];
  const suppliers = new Map<string, { name: string; doc: string | null }>();
  for (let i = 0; i < supplierIds.length; i += 100) for (const s of await listAll(ctx.store, "suppliers", { filters: [["eq", "id", supplierIds.slice(i, i + 100)]] })) suppliers.set(s.id, { name: supplierLabel(s), doc: s.doc ?? null });
  const whIds = [...new Set(list.map((r) => r.warehouseId).filter(Boolean))];
  const whs = new Map<string, string>();
  for (let i = 0; i < whIds.length; i += 100) for (const w of await listAll(ctx.store, "warehouses", { filters: [["eq", "id", whIds.slice(i, i + 100)]] })) whs.set(w.id, w.name);
  const branches = new Map((await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).map((b) => [b.id, b.name as string]));
  const lead = new Map<string, number>();
  const ref = today();
  const rows = [];
  for (const r of list) {
    if (!lead.has(r.branchId)) lead.set(r.branchId, (await pendingInvoiceSettings(ctx.store, ctx.companyId, r.branchId)).leadDays);
    const st = pendingState(r, ref, lead.get(r.branchId));
    const sup = suppliers.get(r.supplierId);
    const items = (r.items ?? []).filter((i: any) => !i.ignore);
    rows.push({
      id: r.id as string,
      number: r.number as number,
      status: r.status as string,
      documentStatus: r.documentStatus as string,
      state: st.key,
      stateLabel: st.label,
      stateTone: st.tone,
      supplierId: r.supplierId as string,
      supplierName: sup?.name ?? r.emitter?.name ?? "—",
      supplierDoc: sup?.doc ?? r.emitter?.cnpj ?? null,
      branchName: branches.get(r.branchId) ?? "—",
      warehouseName: whs.get(r.warehouseId) ?? "—",
      entryAt: (r.entryAt ?? r.confirmedAt ?? r.createdAt) as string,
      entryDate: toLocalDate(r.entryAt ?? r.confirmedAt ?? r.createdAt),
      invoiceDueAt: (r.invoiceDueAt ?? null) as string | null,
      daysOpen: st.daysOpen,
      daysToDue: st.daysToDue,
      overdue: st.key === "overdue",
      value: (r.dueTotal ?? 0) as number,
      itemsCount: items.length,
      units: items.reduce((a: number, i: any) => a + (i.receivedQty ?? 0), 0),
      nfeNumber: (r.nfeNumber ?? null) as string | null,
      nfeKey: (r.nfeKey ?? null) as string | null,
      payableTitleId: (r.payableTitleId ?? null) as string | null,
      invoiceConfirmedAt: (r.invoiceConfirmedAt ?? null) as string | null,
      previousValue: (r.invoiceConfirmation?.previousPayable ?? null) as number | null,
      notes: (r.notes ?? null) as string | null,
      searchText: (r.searchText ?? "") as string,
    });
  }
  let out = rows;
  const sf = p.f.situacao || "open";
  if (sf === "open") out = out.filter((r) => r.documentStatus === "pending_invoice");
  else if (sf === "overdue") out = out.filter((r) => r.state === "overdue");
  else if (sf === "due_soon") out = out.filter((r) => r.state === "due_soon");
  else if (sf === "scheduled") out = out.filter((r) => r.state === "scheduled");
  else if (sf === "confirmed") out = out.filter((r) => r.state === "confirmed");
  if (p.f.from) out = out.filter((r) => r.entryDate >= p.f.from);
  if (p.f.to) out = out.filter((r) => r.entryDate <= p.f.to);
  if (p.q) {
    const term = normalizeSearch(p.q);
    const d = onlyDigits(p.q);
    out = out.filter((r) => String(r.number) === p.q.trim() || r.searchText.includes(term) || normalizeSearch(r.supplierName).includes(term) || (d.length >= 4 && ((r.nfeKey ?? "").includes(d) || (r.supplierDoc ?? "").includes(d))));
  }
  return out;
}

export type PendingInvoiceRow = Awaited<ReturnType<typeof queryPendingInvoices>>[number];
