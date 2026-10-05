import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { addDays, diffDays, formatMonth, monthEnd, monthStart, today } from "@/lib/dates";
import { roundDiv } from "@/lib/money";
import type { Ctx } from "@/lib/core/ctx";
import { getSetting } from "@/lib/core/settings";
import { cardFeeByInstallment } from "./finance";

/**
 * Fluxo de caixa (Tela 24).
 *  - Realizado: lançamentos em conta (account_entries) pela data de liquidação; transferências entre contas
 *    ficam à parte (não são receita/despesa); estornos reduzem o lado do lançamento original.
 *  - Previsto: parcelas em aberto (saldo) pelo vencimento a partir de hoje; recebíveis de cartão líquidos da taxa prevista.
 *  - Saldo inicial posicionado na data: saldo inicial da conta (se a data de referência for anterior) + lançamentos anteriores.
 *  - Competência: títulos pela data de competência + lançamentos diretos (sem título) pela data.
 */

export type Granularity = "day" | "week" | "month";
export type Side = "in" | "out" | "transfer" | "skip";

export interface CashflowFilter {
  from: string;
  to: string;
  granularity: Granularity;
  accountId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  /** null = consolidado (todas as filiais) */
  branchId?: string | null;
  includeOverdue?: boolean;
}

/** Lado do lançamento no resultado. Estorno conta no lado do original (reduz entradas ou saídas). */
export function entrySide(e: { kind: string; amount: number }): Side {
  if (e.kind === "initial" || e.amount === 0) return "skip";
  if (e.kind === "transfer_in" || e.kind === "transfer_out") return "transfer";
  const signed = e.kind === "reversal" ? -e.amount : e.amount;
  return signed > 0 ? "in" : "out";
}

export interface CategoryDefaults {
  sales: string | null;
  purchases: string | null;
  fees: string | null;
}

export async function categoryDefaults(store: Store, companyId: string): Promise<CategoryDefaults> {
  const [sales, purchases, fees] = await Promise.all([
    getSetting<string | null>(store, companyId, null, "finance.category.sales", null),
    getSetting<string | null>(store, companyId, null, "finance.category.purchases", null),
    getSetting<string | null>(store, companyId, null, "finance.category.fees", null),
  ]);
  return { sales, purchases, fees };
}

const SALE_ORIGINS = ["sale", "sale_card", "sale_payment", "sale_cancel"];
const PURCHASE_ORIGINS = ["purchase", "purchase_order", "receipt", "purchase_receipt"];

/** Categoria efetiva: a do lançamento/parcela → tarifas (lançamento de tarifa) → a do título → padrão por origem (vendas, compras). */
export function resolveCategory(rec: Record<string, any>, title: Doc | null | undefined, d: CategoryDefaults): string | null {
  if (rec.categoryId) return rec.categoryId;
  if (rec.kind === "fee") return d.fees; // tarifa/taxa nunca herda a categoria de receita do título
  if (title?.categoryId) return title.categoryId;
  const origin = title?.originType ?? rec.originType ?? "";
  if (SALE_ORIGINS.includes(origin)) return d.sales;
  if (PURCHASE_ORIGINS.includes(origin)) return d.purchases;
  return null;
}

async function titlesByIds(store: Store, ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Doc>();
  for (let i = 0; i < uniq.length; i += 100) for (const t of await listAll(store, "titles", { filters: [["eq", "id", uniq.slice(i, i + 100)]] })) map.set(t.id, t);
  return map;
}

export interface BucketDef {
  key: string;
  label: string;
  from: string;
  to: string;
}

const WEEKDAY = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

export function buildBuckets(from: string, to: string, g: Granularity): BucketDef[] {
  const out: BucketDef[] = [];
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 1000) {
    let end: string;
    let label: string;
    let key: string;
    if (g === "day") {
      end = cur;
      key = cur;
      label = dm(cur);
    } else if (g === "week") {
      const toSunday = (7 - WEEKDAY(cur)) % 7;
      end = addDays(cur, toSunday);
      if (end > to) end = to;
      key = `w:${cur}`;
      label = cur === end ? dm(cur) : `${dm(cur)}–${dm(end)}`;
    } else {
      end = monthEnd(cur);
      if (end > to) end = to;
      key = cur.slice(0, 7);
      label = formatMonth(key);
    }
    out.push({ key, label, from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

export interface CashflowBucket extends BucketDef {
  realizedIn: number;
  realizedOut: number;
  transfersIn: number;
  transfersOut: number;
  forecastIn: number;
  forecastOut: number;
  /** saldos iniciais de contas abertas dentro do período */
  openings: number;
  /** saldo projetado ao fim do período do grupo */
  balance: number;
  future: boolean;
}

export interface CategoryRow {
  categoryId: string;
  realizedIn: number;
  realizedOut: number;
  forecastIn: number;
  forecastOut: number;
}

export interface CashflowResult {
  filter: CashflowFilter;
  today: string;
  opening: number;
  /** saldo inicial projetado quando o período começa no futuro */
  openingProjected: number;
  showBalance: boolean;
  forecastAvailable: boolean;
  buckets: CashflowBucket[];
  totals: {
    realizedIn: number;
    realizedOut: number;
    net: number;
    transfersIn: number;
    transfersOut: number;
    forecastIn: number;
    forecastOut: number;
    overdueIn: number;
    overdueOut: number;
    closing: number;
    entries: number;
    forecastItems: number;
  };
  byCategory: CategoryRow[];
  accounts: Array<{ id: string; name: string; kind: string; branchId: string | null; active: boolean; opening: number; inflow: number; outflow: number; transfers: number; closing: number; current: number; forecast: number }>;
  /** previsto sem conta definida (meio de pagamento sem conta de destino, contas a pagar sem conta) */
  forecastUnassigned: number;
}

/** Conta provável de uma parcela prevista: conta de destino do meio de pagamento do mesmo tipo (quando cadastrada). */
export async function methodAccountMap(store: Store, companyId: string) {
  const methods = await listAll(store, "payment_methods", { filters: [["eq", "companyId", companyId], ["eq", "active", true]], orderBy: [{ field: "sortOrder", dir: "asc" }] });
  const map = new Map<string, string>();
  for (const m of methods) if (m.accountId && !map.has(m.kind)) map.set(m.kind, m.accountId);
  return map;
}


export async function computeCashflow(ctx: Ctx, f: CashflowFilter): Promise<CashflowResult> {
  const store = ctx.store;
  const t0 = today();
  const defaults = await categoryDefaults(store, ctx.companyId);
  const allAccounts = await listAll(store, "financial_accounts", { filters: [["eq", "companyId", ctx.companyId]] });
  // filial: contas da filial + contas compartilhadas (sem filial), com saldo e lançamentos integrais
  const accounts = allAccounts.filter((a) => (!f.accountId || a.id === f.accountId) && (!f.branchId || !a.branchId || a.branchId === f.branchId));
  const accIds = new Set(accounts.map((a) => a.id));
  const showBalance = !f.categoryId && !f.costCenterId;

  // lançamentos desde o início do período (para resultado e para posicionar o saldo pelo saldo atual)
  const sinceFrom = await listAll(store, "account_entries", { filters: [["eq", "companyId", ctx.companyId], ["gte", "date", f.from]], orderBy: [{ field: "date", dir: "asc" }] });
  const scopedSince = sinceFrom.filter((e) => accIds.has(e.accountId));
  const inPeriod = scopedSince.filter((e) => e.date <= f.to);
  const titles = await titlesByIds(store, inPeriod.map((e) => e.titleId));
  const passCat = (e: Doc, title?: Doc | null) => (!f.categoryId || resolveCategory(e, title, defaults) === f.categoryId) && (!f.costCenterId || (e.costCenterId ?? title?.costCenterId ?? null) === f.costCenterId);

  // saldo inicial por conta na data `from`
  const accountRows = new Map<string, CashflowResult["accounts"][number]>();
  let opening = 0;
  for (const a of accounts) {
    const after = scopedSince.filter((e) => e.accountId === a.id).reduce((sum, e) => sum + e.amount, 0);
    // saldo inicial vale a partir do início do dia de referência
    const initialAfter = a.initialBalanceDate && a.initialBalanceDate > f.from ? (a.initialBalance ?? 0) : 0;
    const op = (a.balance ?? 0) - after - initialAfter;
    opening += op;
    accountRows.set(a.id, { id: a.id, name: a.name, kind: a.kind, branchId: a.branchId ?? null, active: a.active !== false, opening: op, inflow: 0, outflow: 0, transfers: 0, closing: op, current: a.balance ?? 0, forecast: 0 });
  }

  const buckets: CashflowBucket[] = buildBuckets(f.from, f.to, f.granularity).map((b) => ({ ...b, realizedIn: 0, realizedOut: 0, transfersIn: 0, transfersOut: 0, forecastIn: 0, forecastOut: 0, openings: 0, balance: 0, future: b.from > t0 }));
  const bucketOf = (d: string) => buckets.find((b) => d >= b.from && d <= b.to);
  // contas cujo saldo inicial é posterior ao início do período: entra no saldo no dia de referência
  for (const a of accounts) {
    if (!a.initialBalanceDate || a.initialBalanceDate <= f.from || a.initialBalanceDate > f.to) continue;
    const b = bucketOf(a.initialBalanceDate);
    if (b) b.openings += a.initialBalance ?? 0;
    const row = accountRows.get(a.id);
    if (row) row.closing += a.initialBalance ?? 0;
  }
  const cats = new Map<string, CategoryRow>();
  const cat = (id: string | null) => {
    const k = id ?? "";
    if (!cats.has(k)) cats.set(k, { categoryId: k, realizedIn: 0, realizedOut: 0, forecastIn: 0, forecastOut: 0 });
    return cats.get(k)!;
  };
  const totals = { realizedIn: 0, realizedOut: 0, net: 0, transfersIn: 0, transfersOut: 0, forecastIn: 0, forecastOut: 0, overdueIn: 0, overdueOut: 0, closing: 0, entries: 0, forecastItems: 0 };

  for (const e of inPeriod) {
    const side = entrySide(e);
    if (side === "skip") continue;
    const b = bucketOf(e.date);
    const row = accountRows.get(e.accountId);
    if (row) row.closing += e.amount;
    if (side === "transfer") {
      if (row) row.transfers += e.amount;
      if (f.categoryId || f.costCenterId) continue;
      totals.entries++;
      if (e.amount > 0) {
        totals.transfersIn += e.amount;
        if (b) b.transfersIn += e.amount;
      } else {
        totals.transfersOut += e.amount;
        if (b) b.transfersOut += e.amount;
      }
      continue;
    }
    const title = e.titleId ? titles.get(e.titleId) : null;
    if (row) {
      if (side === "in") row.inflow += e.amount;
      else row.outflow += e.amount;
    }
    if (!passCat(e, title)) continue;
    totals.entries++;
    const c = cat(resolveCategory(e, title, defaults));
    if (side === "in") {
      totals.realizedIn += e.amount;
      c.realizedIn += e.amount;
      if (b) b.realizedIn += e.amount;
    } else {
      totals.realizedOut += e.amount;
      c.realizedOut += e.amount;
      if (b) b.realizedOut += e.amount;
    }
  }
  totals.net = totals.realizedIn + totals.realizedOut;

  // previsto: parcelas em aberto (sem conta definida → só sem filtro de conta)
  const forecastAvailable = !f.accountId;
  let projectedBeforeFrom = 0;
  let forecastUnassigned = 0;
  if (forecastAvailable) {
    const mAcc = await methodAccountMap(store, ctx.companyId);
    const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "status", ["open", "partial"]], ["lte", "dueDate", f.to]];
    if (f.branchId) filters.push(["eq", "branchId", f.branchId]);
    const open = await listAll(store, "installments", { filters });
    const otitles = await titlesByIds(store, open.map((i) => i.titleId));
    const cardTitles = [...otitles.values()].filter((t) => t.originType === "sale_card");
    const fees = cardTitles.length ? await cardFeeByInstallment(store, cardTitles) : new Map<string, number>();
    for (const i of open) {
      const title = otitles.get(i.titleId);
      if (!title || title.status === "cancelled") continue;
      if (!passCat({ categoryId: i.categoryId, costCenterId: i.costCenterId, kind: "", originType: title.originType } as any, title)) continue;
      let value = i.balance;
      if (title.originType === "sale_card") value -= roundDiv((fees.get(i.id) ?? 0) * i.balance, Math.max(1, i.amount));
      const signed = i.kind === "receivable" ? value : -value;
      const overdue = i.dueDate < t0;
      if (overdue) {
        if (signed > 0) totals.overdueIn += signed;
        else totals.overdueOut += signed;
        if (!f.includeOverdue) continue;
      }
      const date = overdue ? t0 : i.dueDate;
      if (date < f.from) {
        projectedBeforeFrom += signed;
        continue;
      }
      if (date > f.to) continue;
      const b = bucketOf(date);
      totals.forecastItems++;
      const accRow = i.kind === "receivable" && i.methodKind ? accountRows.get(mAcc.get(i.methodKind) ?? "") : undefined;
      if (accRow) accRow.forecast += signed;
      else forecastUnassigned += signed;
      const c = cat(resolveCategory({ categoryId: i.categoryId, kind: "", originType: title.originType }, title, defaults));
      if (signed > 0) {
        totals.forecastIn += signed;
        c.forecastIn += signed;
        if (b) b.forecastIn += signed;
      } else {
        totals.forecastOut += signed;
        c.forecastOut += signed;
        if (b) b.forecastOut += signed;
      }
    }
  }
  const openingProjected = opening + (f.from > t0 ? projectedBeforeFrom : 0);
  let running = openingProjected;
  for (const b of buckets) {
    running += b.openings + b.realizedIn + b.realizedOut + b.transfersIn + b.transfersOut + b.forecastIn + b.forecastOut;
    b.balance = running;
  }
  totals.closing = running;
  return {
    filter: f,
    today: t0,
    opening,
    openingProjected,
    showBalance,
    forecastAvailable,
    buckets,
    totals,
    byCategory: [...cats.values()].sort((a, b) => Math.abs(b.realizedIn + b.realizedOut) - Math.abs(a.realizedIn + a.realizedOut)),
    accounts: [...accountRows.values()],
    forecastUnassigned,
  };
}

// ───────────────────────────── Competência

export interface CompetenceFilter {
  fromMonth: string; // AAAA-MM
  toMonth: string;
  branchId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
}

export interface CompetenceRow {
  categoryId: string;
  type: "revenue" | "expense";
  months: Record<string, number>;
  total: number;
}

/**
 * Regime de competência: títulos (exceto cancelados) pelo total na data de competência — a receber = receita,
 * a pagar = despesa; lançamentos diretos sem título (vendas à vista, cancelamentos, devoluções, tarifas) pela data.
 * Encargos de baixa (juros/multa/desconto) não entram (são financeiros, vistos no realizado).
 */
export async function computeCompetence(ctx: Ctx, f: CompetenceFilter) {
  const store = ctx.store;
  const from = `${f.fromMonth}-01`;
  const to = monthEnd(`${f.toMonth}-01`);
  const defaults = await categoryDefaults(store, ctx.companyId);
  const months: string[] = [];
  for (let m = from; m <= to; m = addDays(monthEnd(m), 1)) months.push(m.slice(0, 7));
  const tf: any[] = [["eq", "companyId", ctx.companyId], ["between", "competenceDate", from, to], ["ne", "status", "cancelled"]];
  if (f.branchId) tf.push(["eq", "branchId", f.branchId]);
  const titles = (await listAll(store, "titles", { filters: tf })).filter((t) => t.status !== "cancelled");
  const ef: any[] = [["eq", "companyId", ctx.companyId], ["between", "date", from, to]];
  if (f.branchId) ef.push(["eq", "branchId", f.branchId]);
  const entries = (await listAll(store, "account_entries", { filters: ef })).filter((e) => {
    const side = entrySide(e);
    if (side === "skip" || side === "transfer") return false;
    if (e.kind === "fee") return true; // tarifas (inclusive de baixas/cartão) são despesa do período
    return !e.titleId && !e.settlementId;
  });
  const etitles = await titlesByIds(store, entries.map((e) => e.titleId));
  const rows = new Map<string, CompetenceRow>();
  const add = (categoryId: string | null, type: "revenue" | "expense", month: string, v: number) => {
    const k = `${type}|${categoryId ?? ""}`;
    if (!rows.has(k)) rows.set(k, { categoryId: categoryId ?? "", type, months: {}, total: 0 });
    const r = rows.get(k)!;
    r.months[month] = (r.months[month] ?? 0) + v;
    r.total += v;
  };
  let titleCount = 0;
  let entryCount = 0;
  for (const t of titles) {
    if (t.originType === "renegotiation") continue; // receita já reconhecida no título original
    const c = resolveCategory({ categoryId: t.categoryId, kind: "", originType: t.originType }, t, defaults);
    if (f.categoryId && c !== f.categoryId) continue;
    if (f.costCenterId && t.costCenterId !== f.costCenterId) continue;
    titleCount++;
    add(c, t.kind === "receivable" ? "revenue" : "expense", t.competenceDate.slice(0, 7), t.kind === "receivable" ? t.total : -t.total);
  }
  for (const e of entries) {
    const title = e.titleId ? etitles.get(e.titleId) : null;
    const c = resolveCategory(e, title, defaults);
    if (f.categoryId && c !== f.categoryId) continue;
    if (f.costCenterId && e.costCenterId !== f.costCenterId) continue;
    entryCount++;
    add(c, entrySide(e) === "in" ? "revenue" : "expense", e.date.slice(0, 7), e.amount);
  }
  const list = [...rows.values()].sort((a, b) => (a.type === b.type ? Math.abs(b.total) - Math.abs(a.total) : a.type === "revenue" ? -1 : 1));
  const byMonth = months.map((m) => {
    const revenue = list.filter((r) => r.type === "revenue").reduce((s, r) => s + (r.months[m] ?? 0), 0);
    const expense = list.filter((r) => r.type === "expense").reduce((s, r) => s + (r.months[m] ?? 0), 0);
    return { month: m, label: formatMonth(m), revenue, expense, result: revenue + expense };
  });
  return { months, byMonth, rows: list, titleCount, entryCount, from, to };
}

export function periodDefaults(ref = today()) {
  return { from: monthStart(ref), to: monthEnd(ref) };
}

export const daysBetween = (a: string, b: string) => diffDays(a, b);
