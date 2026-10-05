import "server-only";
import type { SessionInfo } from "@/lib/server/session";
import { resolvePeriod, type Period, type PeriodPreset, type ReportScope } from "@/domain/reports";
import { qs, sp, type SearchParams } from "@/lib/list";
import { ABC_CRITERIA, getAbcLimits, parseLimits, type AbcCriterion, type AbcLimits } from "@/domain/abc";

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
export function moduleQs(p: Pick<ReportParams, "period" | "single" | "filial">, extra: Record<string, string | number | null | undefined> = {}, range: { from: string; to: string } = p.period) {
  return qs({ de: range.from, ate: range.to, filial: p.single ? p.filial : null, ...extra });
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
