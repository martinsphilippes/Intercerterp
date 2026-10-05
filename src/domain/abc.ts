import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { getSetting, DEFAULT_SETTINGS } from "@/lib/core/settings";
import { roundDiv } from "@/lib/money";
import { emptyTotals, loadFacts, skuRows, totalsOf, type Line, type ReportScope, type SkuRow, type Totals } from "./reports";

/**
 * Curva ABC (Tela 45) sobre a MESMA base dos relatórios gerenciais (`loadFacts`).
 *
 * Política (documentada na tela):
 *  1. Base = itens com valor POSITIVO no critério (receita líquida — padrão; quantidade líquida; ou lucro bruto).
 *     Itens com valor ≤ 0 ficam fora da base e são listados à parte ("sem receita no período").
 *  2. Ordenação: valor desc; desempate pela maior quantidade líquida; depois SKU em ordem alfabética crescente.
 *  3. Classificação pelo acumulado ANTERIOR à inclusão do item: acumulado anterior < limite A → A;
 *     < limite B → B; senão C. O item que cruza o limite fica na classe que estava sendo preenchida.
 *  4. Participação e acumulado são sempre sobre o total da base inteira — filtrar por classe NÃO recalcula o denominador.
 *  5. Reconciliação: total do recorte no critério = base da curva + itens fora da base (≤ 0).
 */

export type AbcCriterion = "receita" | "quantidade" | "margem";
export type AbcClass = "A" | "B" | "C";

export const ABC_CRITERIA: Array<{ key: AbcCriterion; label: string; unit: "money" | "qty" }> = [
  { key: "receita", label: "Receita líquida", unit: "money" },
  { key: "quantidade", label: "Quantidade líquida", unit: "qty" },
  { key: "margem", label: "Lucro bruto (margem)", unit: "money" },
];

export interface AbcLimits {
  /** limite da classe A em bps (8000 = 80%) */
  a: number;
  /** limite da classe B em bps (9500 = 95%) */
  b: number;
}

export async function getAbcLimits(store: Store, companyId: string, branchId: string | null): Promise<AbcLimits> {
  const a = Number(await getSetting(store, companyId, branchId, "abc.limitA", DEFAULT_SETTINGS["abc.limitA"]));
  const b = Number(await getSetting(store, companyId, branchId, "abc.limitB", DEFAULT_SETTINGS["abc.limitB"]));
  return validLimits({ a, b }) ? { a, b } : { a: DEFAULT_SETTINGS["abc.limitA"], b: DEFAULT_SETTINGS["abc.limitB"] };
}

export function validLimits(l: AbcLimits) {
  return Number.isInteger(l.a) && Number.isInteger(l.b) && l.a > 0 && l.a < l.b && l.b <= 10000;
}

/** Limites informados na tela (percentuais, ex.: "80" ou "82,5") para o recorte; senão os parâmetros. */
export function parseLimits(la: string | undefined, lb: string | undefined, defaults: AbcLimits): { limits: AbcLimits; custom: boolean; error?: string } {
  if (!la && !lb) return { limits: defaults, custom: false };
  const toBps = (v: string | undefined, d: number) => {
    if (!v) return d;
    const n = Number(String(v).replace("%", "").replace(",", ".").trim());
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const limits = { a: toBps(la, defaults.a), b: toBps(lb, defaults.b) };
  if (!validLimits(limits)) return { limits: defaults, custom: false, error: "Limites inválidos: informe 0 < A < B ≤ 100%. Usando os parâmetros da empresa." };
  return { limits, custom: limits.a !== defaults.a || limits.b !== defaults.b };
}

export interface Ranked<T> {
  row: T;
  value: number;
  rank: number;
  /** participação do item sobre a base inteira (bps) */
  shareBps: number;
  /** acumulado antes do item (valor e bps) */
  cumBefore: number;
  cumBeforeBps: number;
  /** acumulado incluindo o item (valor e bps) */
  cumAfter: number;
  cumAfterBps: number;
  klass: AbcClass;
}

export interface ClassSummary {
  count: number;
  value: number;
  shareBps: number;
}

export interface Classification<T> {
  base: Ranked<T>[];
  excluded: Array<{ row: T; value: number }>;
  baseTotal: number;
  excludedTotal: number;
  /** total do recorte no critério = base + excluídos */
  total: number;
  classes: Record<AbcClass, ClassSummary>;
}

/** Classificação pura (testável): ver política no topo do arquivo. */
export function classifyAbc<T>(rows: T[], acc: { value: (r: T) => number; qty: (r: T) => number; sku: (r: T) => string }, limits: AbcLimits): Classification<T> {
  const withValue = rows.map((row) => ({ row, value: acc.value(row) }));
  const positive = withValue.filter((x) => x.value > 0);
  const excluded = withValue.filter((x) => !(x.value > 0)).sort((a, b) => a.value - b.value || acc.sku(a.row).localeCompare(acc.sku(b.row), "pt-BR"));
  positive.sort((a, b) => b.value - a.value || acc.qty(b.row) - acc.qty(a.row) || (acc.sku(a.row) < acc.sku(b.row) ? -1 : acc.sku(a.row) > acc.sku(b.row) ? 1 : 0));
  const baseTotal = positive.reduce((a, x) => a + x.value, 0);
  const excludedTotal = excluded.reduce((a, x) => a + x.value, 0);
  const classes: Record<AbcClass, ClassSummary> = { A: { count: 0, value: 0, shareBps: 0 }, B: { count: 0, value: 0, shareBps: 0 }, C: { count: 0, value: 0, shareBps: 0 } };
  let cum = 0;
  const base: Ranked<T>[] = positive.map((x, i) => {
    const before = cum;
    // comparação exata em inteiros: before/baseTotal < limite/10000
    const klass: AbcClass = before * 10000 < limits.a * baseTotal ? "A" : before * 10000 < limits.b * baseTotal ? "B" : "C";
    cum += x.value;
    classes[klass].count += 1;
    classes[klass].value += x.value;
    return {
      row: x.row,
      value: x.value,
      rank: i + 1,
      shareBps: roundDiv(x.value * 10000, baseTotal),
      cumBefore: before,
      cumBeforeBps: roundDiv(before * 10000, baseTotal),
      cumAfter: cum,
      cumAfterBps: roundDiv(cum * 10000, baseTotal),
      klass,
    };
  });
  for (const k of ["A", "B", "C"] as const) classes[k].shareBps = baseTotal > 0 ? roundDiv(classes[k].value * 10000, baseTotal) : 0;
  return { base, excluded, baseTotal, excludedTotal, total: baseTotal + excludedTotal, classes };
}

export interface AbcRow extends SkuRow {
  productName: string | null;
  categoryName: string | null;
  /** SKU ativo sem nenhuma venda/devolução no recorte */
  noMovement: boolean;
}

export interface AbcReport {
  scope: ReportScope;
  criterion: AbcCriterion;
  categoryId: string | null;
  limits: AbcLimits;
  classification: Classification<AbcRow>;
  /** totais do recorte (mesma base e critério dos gerenciais, com o filtro de categoria) */
  totals: Totals;
  /** receita líquida: base da curva + itens fora da base */
  revenue: { total: number; base: number; excluded: number };
}

export function criterionValue(r: Totals, c: AbcCriterion): number {
  return c === "quantidade" ? r.qtyNet : c === "margem" ? r.grossProfit : r.netRevenue;
}

export function filterLines(lines: Line[], categoryId: string | null) {
  return categoryId ? lines.filter((l) => (categoryId === "__none__" ? !l.categoryId : l.categoryId === categoryId)) : lines;
}

export async function abcReport(store: Store, scope: ReportScope, opts: { criterion?: AbcCriterion; categoryId?: string | null; limits: AbcLimits; includeNoMovement?: boolean }): Promise<AbcReport> {
  const criterion = opts.criterion ?? "receita";
  const categoryId = opts.categoryId ?? null;
  const facts = await loadFacts(store, scope);
  const lines = filterLines(facts.lines, categoryId);
  const [products, categories, skus] = await Promise.all([
    listAll(store, "products", { filters: [["eq", "companyId", scope.companyId]] }),
    listAll(store, "categories", { filters: [["eq", "companyId", scope.companyId]] }),
    opts.includeNoMovement === false ? Promise.resolve([]) : listAll(store, "skus", { filters: [["eq", "companyId", scope.companyId]] }),
  ]);
  const prodById = new Map(products.map((p) => [p.id, p]));
  const catName = new Map(categories.map((c) => [c.id, c.name as string]));
  const rows: AbcRow[] = skuRows(lines).map((r) => ({ ...r, productName: r.productId ? (prodById.get(r.productId)?.name ?? null) : null, categoryName: r.categoryId ? (catName.get(r.categoryId) ?? null) : null, noMovement: false }));
  // SKUs ativos sem movimento no recorte também ficam "sem receita no período"
  const seen = new Set(rows.map((r) => r.skuId));
  for (const s of skus) {
    if (seen.has(s.id) || s.active === false) continue;
    const p = prodById.get(s.productId);
    if (!p || p.active === false || p.status === "inactive") continue;
    if (categoryId && (categoryId === "__none__" ? Boolean(p.categoryId) : p.categoryId !== categoryId)) continue;
    rows.push({ ...emptyTotals(), id: s.id, skuId: s.id, productId: p.id, sku: s.sku, description: s.name ?? p.name, unitCode: s.unitCode ?? p.unitCode ?? null, categoryId: p.categoryId ?? null, productName: p.name, categoryName: p.categoryId ? (catName.get(p.categoryId) ?? null) : null, noMovement: true });
  }
  const classification = classifyAbc(rows, { value: (r) => criterionValue(r, criterion), qty: (r) => r.qtyNet, sku: (r) => r.sku }, opts.limits);
  const totals = totalsOf(lines);
  const baseRevenue = classification.base.reduce((a, x) => a + x.row.netRevenue, 0);
  return {
    scope,
    criterion,
    categoryId,
    limits: opts.limits,
    classification,
    totals,
    revenue: { total: totals.netRevenue, base: baseRevenue, excluded: totals.netRevenue - baseRevenue },
  };
}

/** Composição de um SKU no recorte (vendas e devoluções que formam o valor na curva). */
export async function abcProductLines(store: Store, scope: ReportScope, skuId: string, categoryId: string | null = null) {
  const facts = await loadFacts(store, scope);
  const lines = filterLines(facts.lines, categoryId).filter((l) => l.skuId === skuId);
  return { lines, totals: totalsOf(lines), returns: facts.returns };
}
