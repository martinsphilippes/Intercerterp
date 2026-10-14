import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { addDays, diffDays, formatMonth, monthEnd, today } from "@/lib/dates";
import type { Ctx } from "@/lib/core/ctx";
import { competenceItems, type CompetenceItem } from "./cashflow";
import { effectiveDreGroup, codedName } from "./chart-of-accounts";
import { loadFacts } from "./reports";

/**
 * FIN-22 — Relatórios financeiros: DRE gerencial por competência e aging de contas a receber/pagar.
 * Uma única função de consulta por relatório, usada pela tela, pela impressão (?print=1) e pelo CSV.
 */

// ───────────────────────────── DRE gerencial

/** Grupos do DRE (mesmos nomes de `DRE_GROUPS` das categorias) na ordem de apresentação. */
export const DRE_SECTIONS = [
  { key: "Receita bruta", label: "Receita bruta", stage: "revenue" },
  { key: "Deduções", label: "(−) Deduções da receita", stage: "revenue" },
  { key: "CMV", label: "(−) CMV — custo das mercadorias vendidas", stage: "cost" },
  { key: "Despesas operacionais", label: "(−) Despesas operacionais", stage: "opex" },
  { key: "Despesas com pessoal", label: "(−) Despesas com pessoal", stage: "opex" },
  { key: "Despesas administrativas", label: "(−) Despesas administrativas", stage: "opex" },
  { key: "Outras despesas", label: "(−) Outras despesas", stage: "opex" },
  { key: "Receitas financeiras", label: "(+) Receitas financeiras", stage: "financial" },
  { key: "Despesas financeiras", label: "(−) Despesas financeiras", stage: "financial" },
  { key: "Outras receitas", label: "(+) Outras receitas", stage: "financial" },
] as const;

/** Fora do resultado: compras de mercadorias (vão para o estoque; o CMV vem do custo das vendas) e investimentos. */
export const DRE_OUTSIDE = [
  { key: "__purchases", label: "Compras de mercadorias (grupo CMV — entram no estoque)" },
  { key: "__investments", label: "Investimentos" },
] as const;

const SALE_ORIGINS = ["sale", "sale_card", "sale_payment", "sale_cancel"];
const PURCHASE_ORIGINS = ["purchase", "purchase_order", "receipt", "purchase_receipt"];
const RETURNS_LINE = "__returns";

export interface DreLine {
  key: string;
  label: string;
  categoryId: string | null;
  months: Record<string, number>;
  total: number;
}

export interface DreSection {
  key: string;
  label: string;
  lines: DreLine[];
  months: Record<string, number>;
  total: number;
}

export interface DreSubtotal {
  key: "netRevenue" | "grossProfit" | "operating" | "result";
  label: string;
  months: Record<string, number>;
  total: number;
}

export interface DreReport {
  from: string;
  to: string;
  months: Array<{ key: string; label: string }>;
  sections: DreSection[];
  subtotals: Record<DreSubtotal["key"], DreSubtotal>;
  outside: DreSection[];
  /** conferência com a visão "Competência" do fluxo de caixa */
  check: { competenceResult: number; outsideTotal: number; cmv: number; result: number; difference: number };
  counts: { items: number; unclassified: number };
}

/**
 * Grupo do DRE de um item da competência:
 *  - devolução de venda (abatimento do título a receber ou devolução paga em conta) → Deduções;
 *  - grupo da categoria (ou do ancestral mais próximo) — "CMV" e "Investimentos" ficam fora do resultado;
 *  - sem grupo: receita de venda → Receita bruta; outra receita → Outras receitas; tarifa → Despesas financeiras;
 *    compra de mercadoria → fora do resultado; demais despesas → Outras despesas.
 */
export function dreGroupOf(it: CompetenceItem, cats: Map<string, Doc>): { group: string; line: string | null } {
  if ((it.from === "abatement" && it.titleKind === "receivable") || (it.from === "entry" && it.originType === "return")) return { group: "Deduções", line: RETURNS_LINE };
  const g = effectiveDreGroup(it.categoryId, cats as Map<string, any>);
  if (g === "CMV") return { group: "__purchases", line: null };
  if (g === "Investimentos") return { group: "__investments", line: null };
  if (g && DRE_SECTIONS.some((s) => s.key === g)) return { group: g, line: null };
  if (it.type === "revenue") return { group: SALE_ORIGINS.includes(it.originType ?? "") ? "Receita bruta" : "Outras receitas", line: null };
  if (it.fee) return { group: "Despesas financeiras", line: null };
  if (PURCHASE_ORIGINS.includes(it.originType ?? "")) return { group: "__purchases", line: null };
  return { group: "Outras despesas", line: null };
}

export function monthsBetween(from: string, to: string) {
  const out: Array<{ key: string; label: string }> = [];
  for (let m = `${from.slice(0, 7)}-01`; m <= to; m = addDays(monthEnd(m), 1)) out.push({ key: m.slice(0, 7), label: formatMonth(m.slice(0, 7)) });
  return out;
}

const addTo = (rec: Record<string, number>, k: string, v: number) => (rec[k] = (rec[k] ?? 0) + v);

/**
 * DRE gerencial por competência (FIN-22) entre `from` e `to`.
 * Receita e despesas = itens da competência (`competenceItems`, a mesma base da visão "Competência" do fluxo de caixa),
 * classificados pelo grupo do DRE do plano de contas; CMV = custo registrado nas vendas do período − custo das
 * devoluções (mesma regra dos relatórios gerenciais). Compras (grupo CMV) e investimentos ficam fora do resultado.
 * Conferência: resultado = resultado da competência − itens fora do resultado − CMV (diferença sempre zero).
 */
export async function computeDre(ctx: Ctx, f: { from: string; to: string; branchIds?: string[] | null }): Promise<DreReport> {
  const single = f.branchIds && f.branchIds.length === 1 ? f.branchIds[0] : null;
  const { items: raw } = await competenceItems(ctx, { from: f.from, to: f.to, branchId: single });
  const items = !single && f.branchIds ? raw.filter((i) => !i.branchId || f.branchIds!.includes(i.branchId)) : raw;
  const cats = new Map((await listAll(ctx.store, "fin_categories", { filters: [["eq", "companyId", ctx.companyId]] })).map((c) => [c.id, c]));
  const months = monthsBetween(f.from, f.to);
  const sections = new Map<string, DreSection>();
  for (const s of [...DRE_SECTIONS, ...DRE_OUTSIDE]) sections.set(s.key, { key: s.key, label: s.label, lines: [], months: {}, total: 0 });
  let unclassified = 0;
  const lineOf = (sec: DreSection, key: string, label: string, categoryId: string | null) => {
    let l = sec.lines.find((x) => x.key === key);
    if (!l) {
      l = { key, label, categoryId, months: {}, total: 0 };
      sec.lines.push(l);
    }
    return l;
  };
  for (const it of items) {
    const { group, line } = dreGroupOf(it, cats);
    if (!effectiveDreGroup(it.categoryId, cats as Map<string, any>) && line !== RETURNS_LINE) unclassified++;
    const sec = sections.get(group)!;
    const cat = it.categoryId ? cats.get(it.categoryId) : null;
    const l = line === RETURNS_LINE ? lineOf(sec, RETURNS_LINE, "Devoluções de vendas", null) : lineOf(sec, it.categoryId ?? "__none__", cat ? codedName(cat as any) : "Sem categoria", it.categoryId);
    const m = it.date.slice(0, 7);
    addTo(l.months, m, it.amount);
    l.total += it.amount;
    addTo(sec.months, m, it.amount);
    sec.total += it.amount;
  }
  // CMV: custo histórico das vendas − custo das devoluções (data de cada movimento), pela mesma base dos gerenciais
  const facts = await loadFacts(ctx.store, { companyId: ctx.companyId, branchIds: f.branchIds ?? null, from: f.from, to: f.to });
  const cmvSec = sections.get("CMV")!;
  const sold = lineOf(cmvSec, "__cost_sold", "Custo das mercadorias vendidas", null);
  const returned = lineOf(cmvSec, "__cost_returned", "(+) Custo das devoluções", null);
  for (const l of facts.lines) {
    const m = l.date.slice(0, 7);
    const v = l.kind === "sale" ? -l.cost : l.cost;
    const target = l.kind === "sale" ? sold : returned;
    addTo(target.months, m, v);
    target.total += v;
    addTo(cmvSec.months, m, v);
    cmvSec.total += v;
  }
  if (!returned.total && !Object.values(returned.months).some(Boolean)) cmvSec.lines = cmvSec.lines.filter((x) => x !== returned);
  for (const s of sections.values()) s.lines.sort((a, b) => (a.key === RETURNS_LINE ? 1 : b.key === RETURNS_LINE ? -1 : Math.abs(b.total) - Math.abs(a.total)));

  const sum = (keys: string[]) => {
    const out: Record<string, number> = {};
    let total = 0;
    for (const k of keys) {
      const s = sections.get(k)!;
      for (const [m, v] of Object.entries(s.months)) addTo(out, m, v);
      total += s.total;
    }
    return { months: out, total };
  };
  const keysUpTo = (stages: string[]) => DRE_SECTIONS.filter((s) => stages.includes(s.stage)).map((s) => s.key);
  const sub = (key: DreSubtotal["key"], label: string, stages: string[]): DreSubtotal => ({ key, label, ...sum(keysUpTo(stages)) });
  const subtotals = {
    netRevenue: sub("netRevenue", "(=) Receita líquida", ["revenue"]),
    grossProfit: sub("grossProfit", "(=) Lucro bruto", ["revenue", "cost"]),
    operating: sub("operating", "(=) Resultado operacional", ["revenue", "cost", "opex"]),
    result: sub("result", "(=) Resultado do período (antes de IRPJ/CSLL)", ["revenue", "cost", "opex", "financial"]),
  };
  const outside = DRE_OUTSIDE.map((o) => sections.get(o.key)!);
  const competenceResult = items.reduce((a, i) => a + i.amount, 0);
  const outsideTotal = outside.reduce((a, s) => a + s.total, 0);
  const cmv = cmvSec.total;
  const expected = competenceResult - outsideTotal + cmv;
  return {
    from: f.from,
    to: f.to,
    months,
    sections: DRE_SECTIONS.map((s) => sections.get(s.key)!),
    subtotals,
    outside,
    check: { competenceResult, outsideTotal, cmv, result: subtotals.result.total, difference: subtotals.result.total - expected },
    counts: { items: items.length, unclassified },
  };
}

/** Linhas planas do DRE (CSV/impressão): seções, linhas e subtotais na ordem de apresentação. */
export function dreRows(r: DreReport): Array<{ level: number; kind: "section" | "line" | "subtotal" | "outside"; label: string; months: Record<string, number>; total: number }> {
  const out: ReturnType<typeof dreRows> = [];
  const push = (s: DreSection, kind: "section" | "outside") => {
    out.push({ level: 1, kind, label: s.label, months: s.months, total: s.total });
    for (const l of s.lines) out.push({ level: 2, kind: "line", label: l.label, months: l.months, total: l.total });
  };
  for (const s of r.sections) {
    push(s, "section");
    if (s.key === "Deduções") out.push({ level: 0, kind: "subtotal", label: r.subtotals.netRevenue.label, months: r.subtotals.netRevenue.months, total: r.subtotals.netRevenue.total });
    if (s.key === "CMV") out.push({ level: 0, kind: "subtotal", label: r.subtotals.grossProfit.label, months: r.subtotals.grossProfit.months, total: r.subtotals.grossProfit.total });
    if (s.key === "Outras despesas") out.push({ level: 0, kind: "subtotal", label: r.subtotals.operating.label, months: r.subtotals.operating.months, total: r.subtotals.operating.total });
  }
  out.push({ level: 0, kind: "subtotal", label: r.subtotals.result.label, months: r.subtotals.result.months, total: r.subtotals.result.total });
  for (const s of r.outside) push(s, "outside");
  return out;
}

// ───────────────────────────── Aging (contas a receber e a pagar)

export const AGING_BUCKETS = [
  { key: "current", label: "A vencer", min: Number.NEGATIVE_INFINITY, max: 0 },
  { key: "d1_30", label: "1 a 30 dias", min: 1, max: 30 },
  { key: "d31_60", label: "31 a 60 dias", min: 31, max: 60 },
  { key: "d61_90", label: "61 a 90 dias", min: 61, max: 90 },
  { key: "over90", label: "Mais de 90 dias", min: 91, max: Number.POSITIVE_INFINITY },
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number]["key"];

/** Faixa pelo atraso em dias na data de referência (≤ 0 = a vencer, inclusive vencendo no dia). */
export function agingBucket(daysLate: number): AgingBucket {
  return AGING_BUCKETS.find((b) => daysLate >= b.min && daysLate <= b.max)!.key;
}

export interface AgingItem {
  installmentId: string;
  titleId: string;
  titleNumber: number | null;
  number: number;
  installments: number;
  partyKey: string;
  partyName: string;
  description: string;
  originType: string | null;
  dueDate: string;
  daysLate: number;
  bucket: AgingBucket;
  balance: number;
  branchId: string | null;
}

export interface AgingRow {
  partyKey: string;
  partyName: string;
  buckets: Record<AgingBucket, number>;
  total: number;
  count: number;
  maxDaysLate: number;
}

export interface AgingReport {
  kind: "receivable" | "payable";
  ref: string;
  totals: Record<AgingBucket, number> & { total: number; overdue: number };
  counts: Record<AgingBucket, number>;
  rows: AgingRow[];
  items: AgingItem[];
}

const emptyBuckets = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingBucket, number>;

/**
 * Aging (FIN-22): saldo em aberto das parcelas (abertas e parciais de títulos não cancelados) por faixa de atraso
 * na data de referência — a vencer, 1–30, 31–60, 61–90 e mais de 90 dias —, total por cliente/fornecedor.
 * Posição pelo saldo atual de cada parcela (não reconstrói saldos passados). Filial pela filial do título.
 */
export async function computeAging(ctx: Ctx, f: { kind: "receivable" | "payable"; ref?: string; branchIds?: string[] | null; bucket?: AgingBucket | null }): Promise<AgingReport> {
  const ref = f.ref ?? today();
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "kind", f.kind], ["eq", "status", ["open", "partial"]]];
  if (f.branchIds?.length === 1) filters.push(["eq", "branchId", f.branchIds[0]]);
  const insts = (await listAll(ctx.store, "installments", { filters })).filter((i) => (i.balance ?? 0) > 0 && (!f.branchIds || f.branchIds.includes(i.branchId)));
  const titleIds = [...new Set(insts.map((i) => i.titleId))];
  const titles = new Map<string, Doc>();
  for (let i = 0; i < titleIds.length; i += 100) for (const t of await listAll(ctx.store, "titles", { filters: [["eq", "id", titleIds.slice(i, i + 100)]] })) titles.set(t.id, t);
  const totals = { ...emptyBuckets(), total: 0, overdue: 0 };
  const counts = emptyBuckets();
  const rows = new Map<string, AgingRow>();
  const items: AgingItem[] = [];
  for (const i of insts) {
    const t = titles.get(i.titleId);
    if (!t || t.status === "cancelled") continue;
    const daysLate = diffDays(i.dueDate, ref);
    const bucket = agingBucket(daysLate);
    if (f.bucket && bucket !== f.bucket) continue;
    const partyName = String(t.partyName ?? i.partyName ?? (f.kind === "receivable" ? "Sem cliente" : "Sem fornecedor"));
    const partyKey = t.partyId ? `${t.partyType ?? "party"}:${t.partyId}` : `name:${partyName.toLowerCase()}`;
    items.push({
      installmentId: i.id, titleId: t.id, titleNumber: t.number ?? null, number: i.number, installments: t.installmentsCount ?? 1, partyKey, partyName, description: String(t.description ?? ""),
      originType: t.originType ?? null, dueDate: i.dueDate, daysLate, bucket, balance: i.balance, branchId: i.branchId ?? t.branchId ?? null,
    });
    totals[bucket] += i.balance;
    totals.total += i.balance;
    if (daysLate > 0) totals.overdue += i.balance;
    counts[bucket]++;
    const row = rows.get(partyKey) ?? { partyKey, partyName, buckets: emptyBuckets(), total: 0, count: 0, maxDaysLate: Number.NEGATIVE_INFINITY };
    row.buckets[bucket] += i.balance;
    row.total += i.balance;
    row.count++;
    row.maxDaysLate = Math.max(row.maxDaysLate, daysLate);
    rows.set(partyKey, row);
  }
  items.sort((a, b) => b.daysLate - a.daysLate || a.partyName.localeCompare(b.partyName, "pt-BR"));
  return { kind: f.kind, ref, totals, counts, rows: [...rows.values()].sort((a, b) => b.total - a.total), items };
}
