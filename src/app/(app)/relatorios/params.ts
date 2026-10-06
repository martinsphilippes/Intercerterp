import "server-only";
import type { SessionInfo } from "@/lib/server/session";
import { resolvePeriod, type Period, type PeriodPreset, type ReportScope } from "@/domain/reports";
import { qs, sp, type SearchParams } from "@/lib/list";
import { ABC_CRITERIA, getAbcLimits, parseLimits, type AbcCriterion, type AbcLimits } from "@/domain/abc";
import { can } from "@/lib/permissions";

export interface ReportParams {
  period: Period;
  error?: string;
  /** valor do filtro de filial ("todas" ou id) */
  filial: string;
  branchIds: string[];
  single: boolean;
  branchName: string;
  branchOptions: Array<{ value: string; label: string }>;
  scope: ReportScope;
}

/**
 * Período e filial a partir da URL — usados igualmente pelo painel, gerenciais, ABC e exportações.
 * Filial: padrão = contexto atual; no consolidado, todas as filiais acessíveis (com resultado por unidade).
 */
export function resolveReportParams(s: SessionInfo, params: SearchParams, fallback: Exclude<PeriodPreset, "personalizado"> = "mes"): ReportParams {
  const { period, error } = resolvePeriod({ periodo: sp(params, "periodo"), de: sp(params, "de"), ate: sp(params, "ate") }, fallback);
  const accessible = [...s.branches].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  const requested = sp(params, "filial");
  let filial = requested === "todas" ? "todas" : accessible.some((b) => b.id === requested) ? requested : s.ctx.branchId && accessible.some((b) => b.id === s.ctx.branchId) ? s.ctx.branchId : "todas";
  if (accessible.length === 1) filial = accessible[0].id;
  const branchIds = filial === "todas" ? accessible.map((b) => b.id) : [filial];
  const single = filial !== "todas";
  const branchName = single ? (accessible.find((b) => b.id === filial)?.name ?? "") : accessible.length > 1 ? "Todas as filiais (consolidado)" : (accessible[0]?.name ?? "");
  const branchOptions = [...(accessible.length > 1 ? [{ value: "todas", label: "Todas as filiais (consolidado)" }] : []), ...accessible.map((b) => ({ value: b.id, label: String(b.name) }))];
  return { period, error, filial, branchIds, single, branchName, branchOptions, scope: { companyId: s.ctx.companyId, branchIds, from: period.from, to: period.to } };
}

/** Parâmetros de período/filial para links a outros módulos (ex.: /vendas?de=…&ate=…&filial=…). */
export function moduleQs(p: Pick<ReportParams, "single" | "filial"> & { period: { from: string; to: string } }, extra: Record<string, string | number | null | undefined> = {}, range: { from: string; to: string } = p.period) {
  return qs({ de: range.from, ate: range.to, filial: p.single ? p.filial : null, ...extra });
}

type Scope = Pick<ReportParams, "single" | "filial">;

/**
 * As listagens operacionais de Vendas, Devoluções, Contas a receber/pagar e Fluxo de caixa mostram a filial do
 * CONTEXTO da sessão (o filtro de filial da URL só vale no contexto consolidado). O link de detalhamento para elas
 * só reproduz o recorte do indicador quando o contexto é consolidado ou é a própria filial do recorte.
 */
export function contextShowsScope(s: Pick<SessionInfo, "ctx">, p: Scope): boolean {
  return !s.ctx.branchId || (p.single && p.filial === s.ctx.branchId);
}

/** Listagens fiscais: filial explícita no link tem precedência; "todas as filiais" só no contexto consolidado. */
export function fiscalShowsScope(s: Pick<SessionInfo, "ctx">, p: Scope): boolean {
  return p.single || !s.ctx.branchId;
}

/** Listagem de vendas do recorte (período + filial + filtros), ou null quando o contexto atual não abre esse recorte. */
export function salesListHref(s: Pick<SessionInfo, "ctx">, p: Scope & { period: { from: string; to: string } }, extra: Record<string, string | number | null | undefined> = {}, range: { from: string; to: string } = p.period, path = "/vendas") {
  return contextShowsScope(s, p) ? `${path}${moduleQs(p, extra, range)}` : null;
}

/**
 * Operações que compõem os totais comerciais do recorte quando a listagem de vendas não abre o recorte no contexto
 * atual: filial → resultado detalhado por filial (vendas e devoluções); todas → resultado por unidade.
 * Exige acesso aos relatórios gerenciais; sem acesso, null.
 */
export function commercialOpsHref(s: Pick<SessionInfo, "user">, p: Scope, range: { from: string; to: string }) {
  if (!can(s.user, "reports")) return null;
  return p.single ? `/relatorios/gerenciais/filial/${p.filial}${qs({ de: range.from, ate: range.to })}` : `/relatorios/gerenciais${qs({ de: range.from, ate: range.to, filial: "todas" })}`;
}

/** Preserva período e filial ao navegar entre telas de análise. */
export function reportQs(params: SearchParams, extra: Record<string, string | number | null | undefined> = {}) {
  const keep: SearchParams = {};
  for (const k of ["periodo", "de", "ate", "filial"]) if (params[k]) keep[k] = params[k];
  return qs(extra, keep);
}

export const MANAGERIAL_TABS = [
  { key: "dia", label: "Por dia" },
  { key: "categoria", label: "Por categoria" },
  { key: "operador", label: "Por operador" },
  { key: "pagamento", label: "Por meio de pagamento" },
] as const;

// ───────────────────────────── Curva ABC


export interface AbcParams extends ReportParams {
  criterion: AbcCriterion;
  categoryId: string | null;
  klass: "A" | "B" | "C" | "sem" | null;
  limits: AbcLimits;
  companyLimits: AbcLimits;
  customLimits: boolean;
  limitsError?: string;
}

/** Parâmetros da curva ABC (mesmos na tela, no detalhe do produto e na exportação). */
export async function resolveAbcParams(s: SessionInfo, params: SearchParams): Promise<AbcParams> {
  const rp = resolveReportParams(s, params, "mes");
  const crit = sp(params, "criterio") as AbcCriterion;
  const criterion = ABC_CRITERIA.some((c) => c.key === crit) ? crit : "receita";
  const cat = sp(params, "categoria");
  const k = sp(params, "classe");
  const companyLimits = await getAbcLimits(s.ctx.store, s.ctx.companyId, rp.single ? rp.filial : null);
  const pl = parseLimits(sp(params, "la") || undefined, sp(params, "lb") || undefined, companyLimits);
  return {
    ...rp,
    criterion,
    categoryId: cat || null,
    klass: k === "A" || k === "B" || k === "C" || k === "sem" ? k : null,
    limits: pl.limits,
    companyLimits,
    customLimits: pl.custom,
    limitsError: pl.error,
  };
}
