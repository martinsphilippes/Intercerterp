import "server-only";
import { listAll } from "@/lib/db";
import type { Doc, Filter } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, dayRange, today } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { nameMap } from "@/lib/server/lookups";
import { PAYMENT_KIND_LABEL } from "@/domain/pricing-calc";

/** Período padrão do histórico: últimos 30 dias (inclui hoje). */
export function salesPeriod(f: Record<string, string>) {
  const to = f.ate || today();
  const from = f.de || addDays(to, -29);
  return { from, to };
}

async function inChunks<T = any>(ctx: Ctx, collection: string, field: string, ids: string[], extra: Filter[] = []): Promise<Doc<T>[]> {
  const out: Doc<T>[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await listAll<T>(ctx.store, collection, { filters: [["eq", field, ids.slice(i, i + 100)], ...extra] })));
  return out;
}

/**
 * Consulta única do histórico de vendas (tela e exportação): período, filial (consolidado = todas),
 * operador, cliente, situação comercial, de pagamento e fiscal, meio de pagamento, origem e devoluções.
 */
export async function querySales(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const { from, to } = salesPeriod(p.f);
  const { start, end } = dayRange(from, to);
  const filters: Filter[] = [["eq", "companyId", ctx.companyId]];
  // vendas de uma sessão de caixa: sem recorte de período (a sessão já delimita)
  if (!(p.f.sessao && !p.f.de && !p.f.ate)) filters.push(["gte", "completedAt", start], ["lt", "completedAt", end]);
  const branch = ctx.branchId ?? p.f.filial ?? null;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (p.f.operador) filters.push(["eq", "operatorId", p.f.operador]);
  if (p.f.cliente) filters.push(["eq", "customerId", p.f.cliente]);
  if (p.f.situacao) filters.push(["eq", "status", p.f.situacao]);
  if (p.f.pagamento) filters.push(["eq", "paymentStatus", p.f.pagamento]);
  if (p.f.fiscal === "pending_any") filters.push(["eq", "fiscalStatus", ["pending", "queued", "processing", "error", "rejected", "contingency"]], ["eq", "status", "completed"]);
  else if (p.f.fiscal) filters.push(["eq", "fiscalStatus", p.f.fiscal]);
  if (p.f.vendedor) filters.push(["eq", "sellerId", p.f.vendedor]);
  if (p.f.origem) filters.push(["eq", "origin", p.f.origem]);
  if (p.f.terminal) filters.push(["eq", "terminalId", p.f.terminal]);
  if (p.f.sessao) filters.push(["eq", "cashSessionId", p.f.sessao]);
  if (p.f.devolucao === "1") filters.push(["gt", "returnedTotal", 0]);
  let sales = await listAll(ctx.store, "sales", { filters, orderBy: [{ field: "completedAt", dir: "desc" }] });
  const docIds = sales.map((s) => s.fiscalDocumentId).filter(Boolean) as string[];
  const docs = await inChunks(ctx, "fiscal_documents", "id", docIds);
  const dmap = new Map(docs.map((d) => [d.id, d]));
  if (p.q) {
    const q = normalizeSearch(p.q);
    const digits = onlyDigits(p.q);
    const num = /^\d{1,9}$/.test(p.q.trim()) ? Number(p.q.trim()) : null;
    sales = sales.filter((s) => {
      if (num != null && s.number === num) return true;
      const d = s.fiscalDocumentId ? dmap.get(s.fiscalDocumentId) : null;
      if (d && ((num != null && d.number === num) || (digits.length >= 20 && String(d.accessKey ?? "").includes(digits)))) return true;
      const c = s.customerSnapshot;
      if (digits.length >= 5 && c?.doc && String(c.doc).startsWith(digits)) return true;
      return Boolean(c?.name && normalizeSearch(c.name).includes(q));
    });
  }
  const payments = await inChunks(ctx, "sale_payments", "saleId", sales.map((s) => s.id));
  const kinds = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  for (const pay of payments) {
    if (!kinds.has(pay.saleId)) kinds.set(pay.saleId, new Set());
    kinds.get(pay.saleId)!.add(pay.methodKind);
    if (!names.has(pay.saleId)) names.set(pay.saleId, new Set());
    names.get(pay.saleId)!.add(pay.methodName ?? PAYMENT_KIND_LABEL[pay.methodKind] ?? pay.methodKind);
  }
  if (p.f.meio) sales = sales.filter((s) => kinds.get(s.id)?.has(p.f.meio));
  const [branches, users, terminals] = await Promise.all([nameMap(ctx, "branches"), nameMap(ctx, "users"), nameMap(ctx, "terminals")]);
  return sales.map((s) => ({
    id: s.id,
    number: s.number as number,
    completedAt: s.completedAt as string,
    branchId: s.branchId as string,
    branchName: branches.get(s.branchId) ?? "—",
    terminalName: s.terminalId ? (terminals.get(s.terminalId) ?? "—") : "—",
    operatorId: s.operatorId as string,
    operatorName: users.get(s.operatorId) ?? "—",
    customerId: (s.customerId ?? null) as string | null,
    customerName: (s.customerSnapshot?.name ?? "Consumidor final") as string,
    customerDoc: (s.customerSnapshot?.doc ?? null) as string | null,
    itemsCount: (s.itemsCount ?? 0) as number,
    subtotal: (s.subtotal ?? 0) as number,
    discountTotal: (s.discountTotal ?? 0) as number,
    surchargeTotal: (s.surchargeTotal ?? 0) as number,
    total: (s.total ?? 0) as number,
    returnedTotal: (s.returnedTotal ?? 0) as number,
    net: ((s.total ?? 0) - (s.returnedTotal ?? 0)) as number,
    costTotal: ((s.costTotal ?? 0) - (s.returnedCost ?? 0)) as number,
    changeAmount: (s.changeAmount ?? 0) as number,
    paymentMethods: [...(names.get(s.id) ?? [])].join(", "),
    paymentKinds: [...(kinds.get(s.id) ?? [])],
    status: s.status as string,
    paymentStatus: s.paymentStatus as string,
    fiscalStatus: s.fiscalStatus as string,
    origin: s.origin as string,
    fiscalDocumentId: (s.fiscalDocumentId ?? null) as string | null,
    fiscalModel: ((s.fiscalDocumentId && dmap.get(s.fiscalDocumentId)?.model) || null) as string | null,
    fiscalNumber: ((s.fiscalDocumentId && dmap.get(s.fiscalDocumentId)?.number) || null) as number | null,
    fiscalSeries: ((s.fiscalDocumentId && dmap.get(s.fiscalDocumentId)?.series) || null) as string | null,
    fiscalSimulated: Boolean(s.fiscalDocumentId && dmap.get(s.fiscalDocumentId)?.isSimulated),
    sellerId: (s.sellerId ?? null) as string | null,
    sellerName: s.sellerId ? (users.get(s.sellerId) ?? null) : null,
    cancelReason: (s.cancelReason ?? null) as string | null,
  }));
}

export type SaleRow = Awaited<ReturnType<typeof querySales>>[number];

/** Totalizadores do recorte: somente vendas concluídas; canceladas à parte. */
export function salesTotals(rows: SaleRow[]) {
  const done = rows.filter((r) => r.status === "completed");
  const cancelled = rows.filter((r) => r.status === "cancelled");
  const sum = (arr: SaleRow[], k: keyof SaleRow) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return {
    count: done.length,
    subtotal: sum(done, "subtotal"),
    discount: sum(done, "discountTotal"),
    surcharge: sum(done, "surchargeTotal"),
    total: sum(done, "total"),
    returned: sum(done, "returnedTotal"),
    net: sum(done, "net"),
    cost: sum(done, "costTotal"),
    cancelledCount: cancelled.length,
    cancelledTotal: sum(cancelled, "total"),
    withReturns: done.filter((r) => r.returnedTotal > 0).length,
  };
}

/** Usuário restrito a filiais só consulta registros das suas filiais (administrador e usuário sem restrição: todas). */
export function canViewBranch(ctx: Ctx, branchId: string | null | undefined) {
  return ctx.user.isAdmin || !(ctx.user.branchIds ?? []).length || (branchId != null && ctx.user.branchIds.includes(branchId));
}

/** Detalhe da venda com todos os efeitos e reversões relacionados. */
export async function saleDetail(ctx: Ctx, id: string) {
  const store = ctx.store;
  const sale = await store.get("sales", id);
  if (!sale || sale.companyId !== ctx.companyId) return null;
  // usuário restrito a filiais: não acessa por URL o detalhe de venda de outra filial
  if (!canViewBranch(ctx, sale.branchId)) return null;
  const [items, payments, titles, returns, cashMovs, stockMovs, docs] = await Promise.all([
    listAll(store, "sale_items", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    listAll(store, "sale_payments", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    listAll(store, "titles", { filters: [["eq", "originId", id]] }),
    listAll(store, "returns", { filters: [["eq", "saleId", id]], orderBy: [{ field: "createdAt", dir: "asc" }] }),
    listAll(store, "cash_movements", { filters: [["eq", "saleId", id]] }),
    listAll(store, "stock_movements", { filters: [["eq", "operationId", id]], orderBy: [{ field: "occurredAt", dir: "asc" }] }),
    listAll(store, "fiscal_documents", { filters: [["eq", "operationId", id]] }),
  ]);
  const returnIds = returns.map((r) => r.id);
  const returnItems = returnIds.length ? await listAll(store, "return_items", { filters: [["eq", "returnId", returnIds]] }) : [];
  const returnTitles = returnIds.length ? await listAll(store, "titles", { filters: [["eq", "originId", returnIds]] }) : [];
  const allTitles = [...titles, ...returnTitles];
  const titleIds = allTitles.map((t) => t.id);
  const installments = titleIds.length ? await listAll(store, "installments", { filters: [["eq", "titleId", titleIds]], orderBy: [{ field: "dueDate" }] }) : [];
  const settlements = titleIds.length ? await listAll(store, "settlements", { filters: [["eq", "titleId", titleIds]], orderBy: [{ field: "date" }] }) : [];
  const entries = await listAll(store, "account_entries", { filters: [["eq", "operationId", id]] });
  const returnEntries = returnIds.length ? await listAll(store, "account_entries", { filters: [["eq", "originId", returnIds]] }) : [];
  const cancelEntries = sale.status === "cancelled" ? await listAll(store, "account_entries", { filters: [["eq", "originType", "sale_cancel"], ["eq", "originId", id]] }) : [];
  const voucherIds = [...new Set([...returns.map((r) => r.creditVoucherId).filter(Boolean), ...payments.map((p) => p.voucherId).filter(Boolean)])] as string[];
  const vouchers = voucherIds.length ? await listAll(store, "credit_vouchers", { filters: [["eq", "id", voucherIds]] }) : [];
  const exchangeSales = returns.filter((r) => r.exchangeSaleId).map((r) => r.exchangeSaleId);
  const linked = exchangeSales.length ? await listAll(store, "sales", { filters: [["eq", "id", exchangeSales]] }) : [];
  const origin = sale.exchangeReturnId ? await store.get("returns", sale.exchangeReturnId) : null;
  const originSale = origin ? await store.get("sales", origin.saleId) : null;
  const session = sale.cashSessionId ? await store.get("cash_sessions", sale.cashSessionId) : null;
  const intents = payments.some((p) => p.intentId) ? await listAll(store, "payment_intents", { filters: [["eq", "saleId", id]] }) : [];
  const docIds = docs.map((d) => d.id);
  const events = docIds.length ? await listAll(store, "fiscal_events", { filters: [["eq", "documentId", docIds]], orderBy: [{ field: "seq", dir: "asc" }] }) : [];
  const accounts = await nameMap(ctx, "financial_accounts");
  const warehouses = await nameMap(ctx, "warehouses");
  return {
    sale, items, payments, titles: allTitles, installments, settlements, returns, returnItems, cashMovs, stockMovs, docs, events, entries: [...entries, ...returnEntries, ...cancelEntries], vouchers,
    linked, origin, originSale, session, intents, accounts, warehouses,
  };
}

/** Consulta única de trocas e devoluções (tela e exportação). */
export async function queryReturns(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const { from, to } = salesPeriod(p.f);
  const { start, end } = dayRange(from, to);
  const filters: Filter[] = [["eq", "companyId", ctx.companyId], ["gte", "createdAt", start], ["lt", "createdAt", end]];
  const branch = ctx.branchId ?? p.f.filial ?? null;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (p.f.tipo) filters.push(["eq", "kind", p.f.tipo]);
  if (p.f.compensacao) filters.push(["eq", "compensation", p.f.compensacao]);
  if (p.f.situacao) filters.push(["eq", "status", p.f.situacao]);
  if (p.f.venda) filters.push(["eq", "saleId", p.f.venda]);
  if (p.f.cliente) filters.push(["eq", "customerId", p.f.cliente]);
  const rows = await listAll(ctx.store, "returns", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] });
  const saleIds = [...new Set(rows.map((r) => r.saleId))];
  const sales = await inChunks(ctx, "sales", "id", saleIds);
  const smap = new Map(sales.map((s) => [s.id, s]));
  const vIds = rows.map((r) => r.creditVoucherId).filter(Boolean) as string[];
  const vouchers = vIds.length ? await inChunks(ctx, "credit_vouchers", "id", vIds) : [];
  const vmap = new Map(vouchers.map((v) => [v.id, v]));
  const [branches, users] = await Promise.all([nameMap(ctx, "branches"), nameMap(ctx, "users")]);
  let out = rows.map((r) => {
    const s = smap.get(r.saleId);
    const v = r.creditVoucherId ? vmap.get(r.creditVoucherId) : null;
    return {
      id: r.id,
      number: r.number as number,
      createdAt: r.createdAt as string,
      branchName: branches.get(r.branchId) ?? "—",
      saleId: r.saleId as string,
      saleNumber: (s?.number ?? null) as number | null,
      customerName: (s?.customerSnapshot?.name ?? "Consumidor final") as string,
      kind: r.kind as string,
      compensation: r.compensation as string,
      refundMethod: (r.refundMethod ?? null) as string | null,
      status: r.status as string,
      reason: r.reason as string,
      itemsTotal: (r.itemsTotal ?? 0) as number,
      abatedAmount: (r.abatedAmount ?? 0) as number,
      compensatedAmount: (r.compensatedAmount ?? r.itemsTotal ?? 0) as number,
      costTotal: (r.costTotal ?? 0) as number,
      voucherCode: (v?.code ?? null) as string | null,
      voucherBalance: (v?.balance ?? null) as number | null,
      exchangeSaleId: (r.exchangeSaleId ?? null) as string | null,
      difference: (r.difference ?? 0) as number,
      fiscalDocumentId: (r.fiscalDocumentId ?? null) as string | null,
      userName: users.get(r.createdBy) ?? "—",
    };
  });
  if (p.q) {
    const q = normalizeSearch(p.q);
    const num = /^\d{1,9}$/.test(p.q.trim()) ? Number(p.q.trim()) : null;
    out = out.filter((r) => (num != null && (r.number === num || r.saleNumber === num)) || normalizeSearch(r.customerName).includes(q) || normalizeSearch(r.reason ?? "").includes(q) || (r.voucherCode ?? "").toLowerCase().includes(q));
  }
  return out;
}

export type ReturnRow = Awaited<ReturnType<typeof queryReturns>>[number];
