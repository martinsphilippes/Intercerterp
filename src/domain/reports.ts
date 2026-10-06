import { detId, listAll } from "@/lib/db";
import type { Doc, Filter, Store } from "@/lib/db/types";
import { DEFAULT_TZ, addDays, dayRange, diffDays, formatDate, monthEnd, monthStart, toLocalDate, today } from "@/lib/dates";
import { marginBps, roundDiv } from "@/lib/money";
import { PAYMENT_KIND_LABEL } from "./pricing-calc";

/**
 * Serviço ÚNICO de métricas comerciais (Telas 03, 44, 45 e visão 11).
 * Painel do gestor, relatórios gerenciais, detalhe por filial, curva ABC e metas usam
 * exatamente a mesma base (`loadFacts`) e os mesmos critérios (`totalsOf`).
 *
 * Definições (documentadas na tela em "Como calculamos"):
 *  - Receita líquida comercial = valor bruto dos itens − descontos + acréscimos − devoluções elegíveis do período.
 *    Vendas canceladas não entram. Frete e impostos não são receita de produto (não compõem os itens).
 *  - CMV = custo histórico registrado nos itens vendidos (sale_items.costTotal) − custo revertido pelas devoluções
 *    (return_items.costTotal).
 *  - Margem bruta = (receita líquida − CMV) / receita líquida; receita ≤ 0 → "sem receita". Agregados sempre pelos totais.
 *  - Ticket médio = receita líquida / nº de vendas concluídas no recorte.
 *  - Devoluções entram na data do movimento da devolução (e na filial onde foram registradas),
 *    mesmo que a venda original seja anterior ao recorte. Devolução com efeitos ainda pendentes (itens devolvidos não
 *    gravados pela tarefa durável) entra pelas linhas do próprio documento, na data de registro.
 *  - Intervalo técnico [00:00 do 1º dia, 00:00 do dia seguinte ao último) no fuso da empresa (America/Sao_Paulo).
 */

// ───────────────────────────── Períodos

export type PeriodPreset = "hoje" | "7d" | "mes" | "mes-anterior" | "personalizado";

export const PERIOD_PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "mes-anterior", label: "Mês anterior" },
  { key: "personalizado", label: "Personalizado" },
];

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
  /** quantidade de dias de calendário (inclusive) */
  days: number;
  label: string;
}

/** Limite de segurança para períodos personalizados (desempenho). */
export const MAX_PERIOD_DAYS = 400;

export function periodLabel(from: string, to: string) {
  return from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`;
}

function mk(preset: PeriodPreset, from: string, to: string): Period {
  return { preset, from, to, days: diffDays(from, to) + 1, label: periodLabel(from, to) };
}

export function periodFromPreset(preset: Exclude<PeriodPreset, "personalizado">, ref = today()): Period {
  switch (preset) {
    case "hoje":
      return mk(preset, ref, ref);
    case "7d":
      return mk(preset, addDays(ref, -6), ref);
    case "mes":
      // mês corrente até hoje (dias futuros não têm movimento e distorceriam a comparação)
      return mk(preset, monthStart(ref), ref);
    case "mes-anterior": {
      const prevEnd = addDays(monthStart(ref), -1);
      return mk(preset, monthStart(prevEnd), prevEnd);
    }
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (ISO_DATE.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
  }
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? validDate(`${m[3]}-${m[2]}-${m[1]}`) : null;
}

/** Período a partir da URL (`periodo`, `de`, `ate`). Datas inválidas caem no padrão com mensagem. */
export function resolvePeriod(input: { periodo?: string | null; de?: string | null; ate?: string | null }, fallback: Exclude<PeriodPreset, "personalizado"> = "mes", ref = today()): { period: Period; error?: string } {
  const preset = (input.periodo ?? "") as PeriodPreset;
  const de = validDate(input.de);
  const ate = validDate(input.ate);
  if (preset && preset !== "personalizado" && PERIOD_PRESETS.some((p) => p.key === preset)) return { period: periodFromPreset(preset as Exclude<PeriodPreset, "personalizado">, ref) };
  if (de || ate) {
    if ((input.de && !de) || (input.ate && !ate)) return { period: periodFromPreset(fallback, ref), error: "Data inválida no período personalizado. Use o formato dd/mm/aaaa." };
    const from = de ?? ate!;
    const to = ate ?? de!;
    if (from > to) return { period: periodFromPreset(fallback, ref), error: "A data inicial é posterior à data final." };
    if (diffDays(from, to) + 1 > MAX_PERIOD_DAYS) return { period: periodFromPreset(fallback, ref), error: `Período personalizado limitado a ${MAX_PERIOD_DAYS} dias.` };
    return { period: mk("personalizado", from, to) };
  }
  return { period: periodFromPreset(fallback, ref) };
}

/** Período anterior equivalente: imediatamente antes, com a MESMA quantidade de dias. */
export function previousPeriod(p: { from: string; days: number }): Period {
  const to = addDays(p.from, -1);
  const from = addDays(to, -(p.days - 1));
  return mk("personalizado", from, to);
}

/** Mês (AAAA-MM) → intervalo de datas. */
export function monthBounds(period: string) {
  const from = `${period}-01`;
  return { from, to: monthEnd(from), days: diffDays(from, monthEnd(from)) + 1 };
}

// ───────────────────────────── Recorte

export interface ReportScope {
  companyId: string;
  /** filiais do recorte; null = todas as filiais da empresa */
  branchIds: string[] | null;
  from: string;
  to: string;
}

function baseFilters(scope: ReportScope, dateField: string): Filter[] {
  const { start, end } = dayRange(scope.from, scope.to);
  const f: Filter[] = [["eq", "companyId", scope.companyId], ["gte", dateField, start], ["lt", dateField, end]];
  if (scope.branchIds) f.push(["eq", "branchId", scope.branchIds.length ? scope.branchIds : ["__none__"]]);
  return f;
}

async function byIds(store: Store, collection: string, ids: string[]): Promise<Map<string, Doc>> {
  const out = new Map<string, Doc>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const rows = await listAll(store, collection, { filters: [["eq", "id", uniq.slice(i, i + 100)]] });
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

/** Hora local (0–23) de um instante. */
export function localHour(iso: string, tz = DEFAULT_TZ): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return Number(h) % 24;
}

// ───────────────────────────── Fatos (linhas de venda e de devolução)

export interface Line {
  kind: "sale" | "return";
  /** id do item (sale_items ou return_items) */
  id: string;
  /** venda (kind=sale) ou devolução (kind=return) */
  docId: string;
  docNumber: number | null;
  saleId: string;
  saleNumber: number | null;
  /** instante da venda original (para devoluções: pode ser anterior ao recorte) */
  saleAt: string | null;
  branchId: string;
  at: string;
  date: string;
  skuId: string;
  productId: string | null;
  sku: string | null;
  description: string | null;
  unitCode: string | null;
  categoryId: string | null;
  operatorId: string | null;
  customerId: string | null;
  /** quantidade em milésimos (vendida ou devolvida, sempre positiva) */
  qty: number;
  gross: number;
  discount: number;
  surcharge: number;
  /** valor líquido da linha (venda: total do item; devolução: valor devolvido) */
  total: number;
  /** custo histórico (venda) ou custo revertido (devolução) */
  cost: number;
}

export interface Facts {
  scope: ReportScope;
  /** vendas concluídas no recorte */
  sales: Doc[];
  /** vendas canceladas com data no recorte (não entram nos totais; exibidas para conferência) */
  cancelled: Doc[];
  lines: Line[];
  /** documentos de devolução com movimento no recorte (elegíveis) */
  returns: Map<string, Doc>;
  /** vendas originais das devoluções (podem ser anteriores ao recorte) */
  originSales: Map<string, Doc>;
}

/** Devoluções que reduzem a receita: concluídas ou em processamento de estorno (a mercadoria já voltou). */
export const ELIGIBLE_RETURN_STATUSES = ["completed", "processing"];

export async function loadFacts(store: Store, scope: ReportScope): Promise<Facts> {
  const salesAll = await listAll(store, "sales", { filters: baseFilters(scope, "completedAt") });
  const sales = salesAll.filter((s) => s.status === "completed");
  const cancelled = salesAll.filter((s) => s.status === "cancelled");
  const completedIds = new Set(sales.map((s) => s.id));
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const items = (await listAll(store, "sale_items", { filters: baseFilters(scope, "completedAt") })).filter((i) => completedIds.has(i.saleId));

  const lines: Line[] = items.map((i) => {
    const sale = saleById.get(i.saleId)!;
    return {
      kind: "sale",
      id: i.id,
      docId: i.saleId,
      docNumber: sale.number ?? null,
      saleId: i.saleId,
      saleNumber: sale.number ?? null,
      saleAt: sale.completedAt,
      branchId: i.branchId ?? sale.branchId,
      at: i.completedAt ?? sale.completedAt,
      date: toLocalDate(i.completedAt ?? sale.completedAt),
      skuId: i.skuId,
      productId: i.productId ?? null,
      sku: i.sku ?? null,
      description: i.description ?? null,
      unitCode: i.unitCode ?? null,
      categoryId: i.categoryId ?? null,
      operatorId: sale.operatorId ?? null,
      customerId: sale.customerId ?? null,
      qty: i.qty ?? 0,
      gross: i.grossTotal ?? 0,
      discount: (i.itemDiscount ?? 0) + (i.globalDiscount ?? 0),
      surcharge: i.surcharge ?? 0,
      total: i.total ?? 0,
      cost: i.costTotal ?? 0,
    };
  });

  // Devoluções: data e filial do MOVIMENTO (return_items.completedAt), venda original pode ser anterior.
  // Devolução já gravada com efeitos pendentes (a tarefa `return.effects` ainda não gravou todos os return_items): a
  // mercadoria já voltou e a venda já foi abatida — as linhas faltantes vêm do próprio documento (returns.lines), na data
  // de registro (a mesma que a tarefa grava em return_items.completedAt), com o id determinístico do item a ser gravado.
  // Lidas ANTES dos itens: item gravado entre as duas leituras aparece nos itens e não é duplicado.
  const pending = (await listAll(store, "returns", { filters: [...baseFilters(scope, "createdAt"), ["eq", "effectsStatus", "pending"]] })).filter(
    (r) => ELIGIBLE_RETURN_STATUSES.includes(r.status) && Array.isArray(r.lines) && r.lines.length > 0,
  );
  const retItems = await listAll(store, "return_items", { filters: baseFilters(scope, "completedAt") });
  const returnsAll = await byIds(store, "returns", retItems.map((r) => r.returnId));
  const returns = new Map([...returnsAll].filter(([, r]) => ELIGIBLE_RETURN_STATUSES.includes(r.status)));
  const eligibleItems = retItems.filter((r) => returns.has(r.returnId));
  const written = new Set(retItems.map((r) => `${r.returnId}:${r.saleItemId}`));
  for (const ret of pending) {
    for (const l of ret.lines as Array<Record<string, any>>) {
      if (written.has(`${ret.id}:${l.saleItemId}`)) continue;
      if (!returns.has(ret.id)) returns.set(ret.id, ret);
      eligibleItems.push({
        id: detId("retitem", ret.id, l.saleItemId), createdAt: ret.createdAt, updatedAt: ret.updatedAt, returnId: ret.id, saleId: ret.saleId, saleItemId: l.saleItemId,
        skuId: l.skuId, qty: l.qty, total: l.total, costTotal: l.costTotal, branchId: ret.branchId, completedAt: ret.createdAt,
      });
    }
  }
  const originItems = await byIds(store, "sale_items", eligibleItems.map((r) => r.saleItemId));
  const originSales = await byIds(store, "sales", eligibleItems.map((r) => r.saleId ?? originItems.get(r.saleItemId)?.saleId));
  for (const r of eligibleItems) {
    const ret = returns.get(r.returnId)!;
    const si = originItems.get(r.saleItemId);
    const saleId = r.saleId ?? si?.saleId ?? ret.saleId;
    const sale = originSales.get(saleId);
    lines.push({
      kind: "return",
      id: r.id,
      docId: r.returnId,
      docNumber: ret.number ?? null,
      saleId,
      saleNumber: sale?.number ?? null,
      saleAt: sale?.completedAt ?? null,
      branchId: r.branchId ?? ret.branchId,
      at: r.completedAt ?? ret.completedAt ?? ret.createdAt,
      date: toLocalDate(r.completedAt ?? ret.completedAt ?? ret.createdAt),
      skuId: r.skuId,
      productId: si?.productId ?? null,
      sku: si?.sku ?? null,
      description: si?.description ?? null,
      unitCode: si?.unitCode ?? null,
      categoryId: si?.categoryId ?? null,
      operatorId: sale?.operatorId ?? null,
      customerId: ret.customerId ?? sale?.customerId ?? null,
      qty: r.qty ?? 0,
      gross: 0,
      discount: 0,
      surcharge: 0,
      total: r.total ?? 0,
      cost: r.costTotal ?? 0,
    });
  }
  return { scope, sales, cancelled, lines, returns, originSales };
}

// ───────────────────────────── Totais

export interface Totals {
  /** valor bruto dos itens vendidos (preço × quantidade) */
  gross: number;
  /** descontos (no item + rateio do desconto global) */
  discounts: number;
  /** acréscimos */
  surcharges: number;
  /** vendas antes das devoluções = bruto − descontos + acréscimos */
  salesNet: number;
  /** devoluções/estornos comerciais com movimento no período */
  returns: number;
  /** receita líquida comercial */
  netRevenue: number;
  costSold: number;
  costReturned: number;
  cmv: number;
  grossProfit: number;
  /** null = sem receita (receita ≤ 0) */
  marginBps: number | null;
  salesCount: number;
  returnsCount: number;
  /** null = sem vendas concluídas no recorte */
  ticket: number | null;
  qtySold: number;
  qtyReturned: number;
  qtyNet: number;
}

export function emptyTotals(): Totals {
  return { gross: 0, discounts: 0, surcharges: 0, salesNet: 0, returns: 0, netRevenue: 0, costSold: 0, costReturned: 0, cmv: 0, grossProfit: 0, marginBps: null, salesCount: 0, returnsCount: 0, ticket: null, qtySold: 0, qtyReturned: 0, qtyNet: 0 };
}

/** Totais pelas SOMAS (nunca média de margens/tickets das partes). */
export function totalsOf(lines: Line[]): Totals {
  const t = emptyTotals();
  const saleIds = new Set<string>();
  const returnIds = new Set<string>();
  for (const l of lines) {
    if (l.kind === "sale") {
      t.gross += l.gross;
      t.discounts += l.discount;
      t.surcharges += l.surcharge;
      t.costSold += l.cost;
      t.qtySold += l.qty;
      saleIds.add(l.saleId);
    } else {
      t.returns += l.total;
      t.costReturned += l.cost;
      t.qtyReturned += l.qty;
      returnIds.add(l.docId);
    }
  }
  t.salesNet = t.gross - t.discounts + t.surcharges;
  t.netRevenue = t.salesNet - t.returns;
  t.cmv = t.costSold - t.costReturned;
  t.grossProfit = t.netRevenue - t.cmv;
  t.marginBps = marginBps(t.netRevenue, t.cmv);
  t.salesCount = saleIds.size;
  t.returnsCount = returnIds.size;
  t.ticket = t.salesCount > 0 ? roundDiv(t.netRevenue, t.salesCount) : null;
  t.qtyNet = t.qtySold - t.qtyReturned;
  return t;
}

export function groupTotals<K extends string>(lines: Line[], key: (l: Line) => K | null): Map<K | "__none__", Totals> {
  const groups = new Map<K | "__none__", Line[]>();
  for (const l of lines) {
    const k = key(l) ?? "__none__";
    const arr = groups.get(k);
    if (arr) arr.push(l);
    else groups.set(k, [l]);
  }
  return new Map([...groups].map(([k, ls]) => [k, totalsOf(ls)]));
}

/** Variação relativa em bps; null quando não há base (anterior = 0). */
export function variationBps(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return roundDiv((cur - prev) * 10000, Math.abs(prev));
}

/** Indicadores de um recorte — usado pelo PAINEL, pelas METAS e pelos GERENCIAIS (mesma base). */
export async function reportTotals(store: Store, scope: ReportScope): Promise<Totals> {
  return totalsOf((await loadFacts(store, scope)).lines);
}

/** Data local do primeiro movimento comercial registrado (para orientar a escolha do período). */
export async function firstMovementDate(store: Store, companyId: string, branchIds: string[] | null): Promise<string | null> {
  const filters: Filter[] = [["eq", "companyId", companyId], ["notNull", "completedAt"]];
  if (branchIds) filters.push(["eq", "branchId", branchIds.length ? branchIds : ["__none__"]]);
  const res = await store.list("sales", { filters, orderBy: [{ field: "completedAt", dir: "asc" }], limit: 1, total: false });
  return res.items[0]?.completedAt ? toLocalDate(res.items[0].completedAt) : null;
}

// ───────────────────────────── Nomes (empresa ativa)

export async function nameMaps(store: Store, companyId: string) {
  const [branches, categories, users] = await Promise.all([
    listAll(store, "branches", { filters: [["eq", "companyId", companyId]] }),
    listAll(store, "categories", { filters: [["eq", "companyId", companyId]] }),
    listAll(store, "users"),
  ]);
  return {
    branches: new Map(branches.map((b) => [b.id, b.name as string])),
    categories: new Map(categories.map((c) => [c.id, c.name as string])),
    users: new Map(users.map((u) => [u.id, u.name as string])),
  };
}

// ───────────────────────────── Séries temporais

export interface SeriesPoint {
  key: string;
  label: string;
  /** data/hora do período atual (AAAA-MM-DD ou hora) */
  date: string;
  current: number;
  /** data correspondente no período anterior */
  previousDate: string | null;
  previous: number | null;
  salesCount: number;
}

/** Evolução da receita líquida: por dia (ou por hora quando o recorte é de um único dia). */
export function revenueSeries(cur: Line[], period: { from: string; to: string; days: number }, prev?: { lines: Line[]; from: string } | null): { granularity: "day" | "hour"; points: SeriesPoint[] } {
  if (period.days === 1) {
    const byHour = (ls: Line[]) => groupTotals(ls, (l) => String(localHour(l.at)));
    const c = byHour(cur);
    const p = prev ? byHour(prev.lines) : null;
    const points: SeriesPoint[] = [];
    for (let h = 0; h < 24; h++) {
      const ct = c.get(String(h));
      points.push({ key: String(h), label: `${String(h).padStart(2, "0")}h`, date: `${period.from} ${String(h).padStart(2, "0")}:00`, current: ct?.netRevenue ?? 0, previousDate: prev ? `${prev.from} ${String(h).padStart(2, "0")}:00` : null, previous: p ? (p.get(String(h))?.netRevenue ?? 0) : null, salesCount: ct?.salesCount ?? 0 });
    }
    // recorta horas sem movimento nas pontas (mantém o comércio legível)
    const active = points.map((x, i) => (x.current || x.previous ? i : -1)).filter((i) => i >= 0);
    const lo = active.length ? Math.min(active[0], 8) : 8;
    const hi = active.length ? Math.max(active[active.length - 1], 20) : 20;
    return { granularity: "hour", points: points.slice(lo, hi + 1) };
  }
  const c = groupTotals(cur, (l) => l.date);
  const p = prev ? groupTotals(prev.lines, (l) => l.date) : null;
  const points: SeriesPoint[] = [];
  for (let i = 0; i < period.days; i++) {
    const d = addDays(period.from, i);
    const pd = prev ? addDays(prev.from, i) : null;
    const ct = c.get(d);
    points.push({ key: d, label: formatDate(d).slice(0, 5), date: d, current: ct?.netRevenue ?? 0, previousDate: pd, previous: p && pd ? (p.get(pd)?.netRevenue ?? 0) : null, salesCount: ct?.salesCount ?? 0 });
  }
  return { granularity: "day", points };
}

// ───────────────────────────── Painel do gestor (Tela 03)

/** Indicadores comerciais do painel: recorte atual, período anterior equivalente e evolução. */
export async function commercialOverview(store: Store, scope: ReportScope) {
  const days = diffDays(scope.from, scope.to) + 1;
  const pp = previousPeriod({ from: scope.from, days });
  const previousScope: ReportScope = { ...scope, from: pp.from, to: pp.to };
  const [facts, prevFacts] = await Promise.all([loadFacts(store, scope), loadFacts(store, previousScope)]);
  return {
    totals: totalsOf(facts.lines),
    previous: totalsOf(prevFacts.lines),
    previousScope,
    series: revenueSeries(facts.lines, { from: scope.from, to: scope.to, days }, { lines: prevFacts.lines, from: previousScope.from }),
    cancelled: { count: facts.cancelled.length, total: facts.cancelled.reduce((a, s) => a + (s.total ?? 0), 0) },
    facts,
  };
}

// ───────────────────────────── Relatório gerencial (Tela 44)

export interface Row extends Totals {
  id: string;
  label: string;
  href?: string | null;
}

export interface PaymentRow {
  id: string;
  label: string;
  kind: "payment" | "return";
  amount: number;
  count: number;
}

export interface ManagerialReport {
  scope: ReportScope;
  totals: Totals;
  previous: Totals | null;
  previousScope: ReportScope | null;
  byBranch: Row[];
  byDay: Row[];
  byCategory: Row[];
  byOperator: Row[];
  /** totais do período anterior por filial (comparação por unidade) */
  previousByBranch: Map<string, Totals>;
  cancelled: { count: number; total: number };
  series: ReturnType<typeof revenueSeries>;
}

export async function managerialReport(store: Store, scope: ReportScope, opts: { compare?: boolean; branchIds?: string[] } = {}): Promise<ManagerialReport> {
  const facts = await loadFacts(store, scope);
  const names = await nameMaps(store, scope.companyId);
  const totals = totalsOf(facts.lines);
  const days = diffDays(scope.from, scope.to) + 1;
  let previous: Totals | null = null;
  let previousScope: ReportScope | null = null;
  let prevFacts: Facts | null = null;
  if (opts.compare !== false) {
    const pp = previousPeriod({ from: scope.from, days });
    previousScope = { ...scope, from: pp.from, to: pp.to };
    prevFacts = await loadFacts(store, previousScope);
    previous = totalsOf(prevFacts.lines);
  }
  // resultado por unidade: todas as filiais do recorte, inclusive sem movimento
  const branchIds = opts.branchIds ?? scope.branchIds ?? [...names.branches.keys()];
  const perBranch = groupTotals(facts.lines, (l) => l.branchId);
  const byBranch: Row[] = branchIds
    .map((id) => ({ ...(perBranch.get(id) ?? emptyTotals()), id, label: names.branches.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const perDay = groupTotals(facts.lines, (l) => l.date);
  const byDay: Row[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(scope.from, i);
    byDay.push({ ...(perDay.get(d) ?? emptyTotals()), id: d, label: formatDate(d) });
  }
  const byCategory: Row[] = [...groupTotals(facts.lines, (l) => l.categoryId)]
    .map(([id, t]) => ({ ...t, id, label: id === "__none__" ? "Sem categoria" : (names.categories.get(id) ?? "Categoria removida") }))
    .sort((a, b) => b.netRevenue - a.netRevenue);
  const byOperator: Row[] = [...groupTotals(facts.lines, (l) => l.operatorId)]
    .map(([id, t]) => ({ ...t, id, label: id === "__none__" ? "Não identificado" : (names.users.get(id) ?? "Usuário removido") }))
    .sort((a, b) => b.netRevenue - a.netRevenue);
  return {
    scope,
    totals,
    previous,
    previousScope,
    byBranch,
    byDay,
    byCategory,
    byOperator,
    previousByBranch: prevFacts ? (groupTotals(prevFacts.lines, (l) => l.branchId) as Map<string, Totals>) : new Map(),
    cancelled: { count: facts.cancelled.length, total: facts.cancelled.reduce((a, s) => a + (s.total ?? 0), 0) },
    series: revenueSeries(facts.lines, { from: scope.from, to: scope.to, days }, prevFacts ? { lines: prevFacts.lines, from: previousScope!.from } : null),
  };
}

export const RETURN_FORM_LABEL: Record<string, string> = {
  store_credit: "Devolução — vale-crédito",
  exchange: "Devolução — troca",
  cash: "Devolução — reembolso em dinheiro",
  pix: "Devolução — reembolso por Pix",
  account: "Devolução — reembolso em conta",
  card_reversal: "Devolução — estorno no cartão",
  refund: "Devolução — reembolso",
  abatement: "Devolução — abatimento do título a prazo",
  absorbed: "Devolução — coberta por desconto concedido no recebimento",
};

/**
 * Quebra por meio de pagamento: valores aplicados nas vendas concluídas (somam as vendas antes das devoluções)
 * e devoluções do período pela forma de compensação. Pagamentos − devoluções = receita líquida.
 * Devolução de venda a prazo (crediário): a parte abatida do título (`returns.abatedAmount`) não sai do caixa nem vira
 * vale — fica na linha "abatimento do título a prazo"; a parte coberta por desconto concedido na baixa do título (nem
 * abatida nem compensada: valor devolvido − abatido − `returns.compensatedAmount`) também não é reembolsada — fica na
 * linha "coberta por desconto concedido no recebimento"; só o compensado ao cliente vai para a forma de compensação.
 * Devoluções antigas (sem abatimento/compensado registrados): tudo na forma de compensação.
 */
export async function paymentBreakdown(store: Store, scope: ReportScope): Promise<{ rows: PaymentRow[]; paymentsTotal: number; returnsTotal: number; netRevenue: number }> {
  const facts = await loadFacts(store, scope);
  const ids = facts.sales.map((s) => s.id);
  const pays: Doc[] = [];
  for (let i = 0; i < ids.length; i += 100) pays.push(...(await listAll(store, "sale_payments", { filters: [["eq", "saleId", ids.slice(i, i + 100)]] })));
  const map = new Map<string, PaymentRow>();
  const counted = new Map<string, Set<string>>();
  for (const p of pays) {
    const key = `pay:${p.methodKind}`;
    const row = map.get(key) ?? { id: key, label: PAYMENT_KIND_LABEL[p.methodKind] ?? p.methodName ?? p.methodKind, kind: "payment" as const, amount: 0, count: 0 };
    row.amount += p.amount ?? 0;
    const set = counted.get(key) ?? new Set<string>();
    set.add(p.saleId);
    counted.set(key, set);
    row.count = set.size;
    map.set(key, row);
  }
  const t = totalsOf(facts.lines);
  const addReturn = (form: string, docId: string, amount: number) => {
    const key = `ret:${form}`;
    const row = map.get(key) ?? { id: key, label: RETURN_FORM_LABEL[form] ?? `Devolução — ${form}`, kind: "return" as const, amount: 0, count: 0 };
    row.amount += amount;
    const set = counted.get(key) ?? new Set<string>();
    set.add(docId);
    counted.set(key, set);
    row.count = set.size;
    map.set(key, row);
  };
  // por DOCUMENTO de devolução (as linhas de uma devolução têm a mesma data e filial)
  const returnTotals = new Map<string, number>();
  for (const l of facts.lines) if (l.kind === "return") returnTotals.set(l.docId, (returnTotals.get(l.docId) ?? 0) + l.total);
  for (const [docId, total] of returnTotals) {
    const ret = facts.returns.get(docId)!;
    const form = ret.compensation === "refund" ? (ret.refundMethod ?? "refund") : (ret.compensation ?? "refund");
    // limitado ao valor das linhas: abatido + absorvido + compensado = valor devolvido (mantém pagamentos − devoluções = receita líquida)
    const abated = Math.min(Math.max(ret.abatedAmount ?? 0, 0), Math.max(total, 0));
    const rest = total - abated;
    const compensated = ret.compensatedAmount == null || rest <= 0 ? rest : Math.min(Math.max(ret.compensatedAmount, 0), rest);
    const absorbed = rest - compensated;
    if (abated > 0) addReturn("abatement", docId, abated);
    if (absorbed > 0) addReturn("absorbed", docId, absorbed);
    if (compensated !== 0 || (abated === 0 && absorbed === 0)) addReturn(form, docId, compensated);
  }
  const rows = [...map.values()].sort((a, b) => (a.kind === b.kind ? b.amount - a.amount : a.kind === "payment" ? -1 : 1));
  const paymentsTotal = rows.filter((r) => r.kind === "payment").reduce((a, r) => a + r.amount, 0);
  const returnsTotal = rows.filter((r) => r.kind === "return").reduce((a, r) => a + r.amount, 0);
  return { rows, paymentsTotal, returnsTotal, netRevenue: t.netRevenue };
}

// ───────────────────────────── Detalhe por filial (visão 11)

export interface SaleOp {
  id: string;
  number: number | null;
  at: string;
  operatorId: string | null;
  operatorName: string;
  customerName: string | null;
  itemsCount: number;
  gross: number;
  discounts: number;
  surcharges: number;
  total: number;
  cost: number;
  marginBps: number | null;
}

export interface ReturnOp {
  id: string;
  number: number | null;
  at: string;
  saleId: string;
  saleNumber: number | null;
  saleAt: string | null;
  /** venda original anterior ao início do recorte */
  priorSale: boolean;
  kind: string;
  compensation: string | null;
  status: string;
  itemsCount: number;
  total: number;
  cost: number;
}

/** Operações que compõem os totais de UMA filial no recorte (mesmo critério do resumo). */
export async function branchOperations(store: Store, scope: ReportScope) {
  const facts = await loadFacts(store, scope);
  const names = await nameMaps(store, scope.companyId);
  const saleOps = new Map<string, SaleOp>();
  const saleById = new Map(facts.sales.map((s) => [s.id, s]));
  const returnOps = new Map<string, ReturnOp>();
  const { start } = dayRange(scope.from, scope.to);
  for (const l of facts.lines) {
    if (l.kind === "sale") {
      const s = saleById.get(l.saleId)!;
      const op = saleOps.get(l.saleId) ?? {
        id: l.saleId, number: s.number ?? null, at: s.completedAt, operatorId: s.operatorId ?? null, operatorName: s.operatorId ? (names.users.get(s.operatorId) ?? "—") : "—",
        customerName: s.customerSnapshot?.name ?? null, itemsCount: 0, gross: 0, discounts: 0, surcharges: 0, total: 0, cost: 0, marginBps: null,
      };
      op.itemsCount += 1;
      op.gross += l.gross;
      op.discounts += l.discount;
      op.surcharges += l.surcharge;
      op.total += l.gross - l.discount + l.surcharge;
      op.cost += l.cost;
      saleOps.set(l.saleId, op);
    } else {
      const r = facts.returns.get(l.docId)!;
      const op = returnOps.get(l.docId) ?? {
        id: l.docId, number: r.number ?? null, at: l.at, saleId: l.saleId, saleNumber: l.saleNumber, saleAt: l.saleAt,
        priorSale: Boolean(l.saleAt && new Date(l.saleAt).getTime() < new Date(start).getTime()), kind: r.kind ?? "return", compensation: r.compensation ?? null, status: r.status,
        itemsCount: 0, total: 0, cost: 0,
      };
      op.itemsCount += 1;
      op.total += l.total;
      op.cost += l.cost;
      returnOps.set(l.docId, op);
    }
  }
  const sales = [...saleOps.values()].map((o) => ({ ...o, marginBps: marginBps(o.total, o.cost) })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const returns = [...returnOps.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { facts, totals: totalsOf(facts.lines), sales, returns, cancelled: facts.cancelled };
}

// ───────────────────────────── Agregado por SKU (curva ABC)

export interface SkuRow extends Totals {
  id: string;
  skuId: string;
  productId: string | null;
  sku: string;
  description: string;
  unitCode: string | null;
  categoryId: string | null;
}

export function skuRows(lines: Line[]): SkuRow[] {
  const meta = new Map<string, Line>();
  for (const l of lines) {
    const m = meta.get(l.skuId);
    // prefere metadados de uma linha de venda (snapshot do item)
    if (!m || (m.kind === "return" && l.kind === "sale")) meta.set(l.skuId, l);
  }
  return [...groupTotals(lines, (l) => l.skuId)].map(([skuId, t]) => {
    const m = meta.get(skuId)!;
    return { ...t, id: skuId, skuId, productId: m.productId, sku: m.sku ?? skuId, description: m.description ?? m.sku ?? skuId, unitCode: m.unitCode, categoryId: m.categoryId };
  });
}

/** Mês corrente (AAAA-MM) e intervalo até hoje. */
export function currentMonth(ref = today()) {
  return ref.slice(0, 7);
}

export { monthStart, monthEnd };
