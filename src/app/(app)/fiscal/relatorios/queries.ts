import "server-only";
import type { Ctx } from "@/lib/core/ctx";
import type { Doc } from "@/lib/db/types";
import { addMonths, monthEnd, monthStart, today, diffDays, addDays } from "@/lib/dates";
import { sp, type SearchParams } from "@/lib/list";
import { DOC_STATUS_LABEL, MODEL_LABEL } from "@/domain/fiscal/service";
import { cancellations, isNonRevenueOut, isReturnIn, isRevenue, normalizeFilter, outputBook, PENDING_STATES, periodDocuments, rejections, revenueAmount, servicesSummary, summaryByCfop, taxesByNcm, type FiscalReportFilter } from "@/domain/fiscal/reports";
import { docRows } from "@/domain/fiscal/export";

/** Filtro dos relatórios: `period` (AAAA-MM) tem precedência; senão De/Até; padrão = mês corrente. */
export function reportFilter(ctx: Ctx, params: SearchParams): FiscalReportFilter & { period: string | null } {
  const period = sp(params, "period");
  const branch = ctx.branchId ? undefined : sp(params, "branch") || undefined;
  if (/^\d{4}-\d{2}$/.test(period)) {
    const from = `${period}-01`;
    const end = monthEnd(from);
    return { ...normalizeFilter({ from, to: end > today() ? today() : end, branch, model: sp(params, "model"), sim: sp(params, "sim") }), period };
  }
  const f = normalizeFilter({ from: sp(params, "from"), to: sp(params, "to"), branch, model: sp(params, "model"), sim: sp(params, "sim") });
  return { ...f, period: sp(params, "from") ? null : f.from.slice(0, 7) };
}

/** Período anterior de mesma duração (comparação). */
export function previousFilter(f: FiscalReportFilter): FiscalReportFilter {
  if (f.from.endsWith("-01") && (f.to === monthEnd(f.from) || f.to === today())) {
    const pf = addMonths(f.from, -1);
    const sameDay = f.to === today() && f.to !== monthEnd(f.from);
    const pt = sameDay ? addDays(pf, diffDays(f.from, f.to)) : monthEnd(pf);
    return { ...f, from: pf, to: pt > monthEnd(pf) ? monthEnd(pf) : pt };
  }
  const len = diffDays(f.from, f.to) + 1;
  return { ...f, from: addDays(f.from, -len), to: addDays(f.from, -1) };
}

export function monthOptions(n = 13) {
  const t = monthStart(today());
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return Array.from({ length: n }, (_, i) => {
    const d = addMonths(t, -i);
    return { value: d.slice(0, 7), label: `${names[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}` };
  });
}

export async function bookRows(ctx: Ctx, params: SearchParams) {
  const f = reportFilter(ctx, params);
  return outputBook(await periodDocuments(ctx, f)).map((r) => ({ ...r, modelLabel: MODEL_LABEL[r.model] }));
}
export async function ncmRows(ctx: Ctx, params: SearchParams) {
  return taxesByNcm(await periodDocuments(ctx, reportFilter(ctx, params)));
}
export async function cfopRows(ctx: Ctx, params: SearchParams) {
  return summaryByCfop(await periodDocuments(ctx, reportFilter(ctx, params)));
}
export async function serviceRows(ctx: Ctx, params: SearchParams) {
  return servicesSummary(await periodDocuments(ctx, reportFilter(ctx, params)));
}
export async function cancelRows(ctx: Ctx, params: SearchParams) {
  return (await cancellations(ctx, reportFilter(ctx, params))).map((r) => ({ ...r, modelLabel: MODEL_LABEL[r.model], simLabel: r.simulated ? "SIMULAÇÃO" : "" }));
}
export async function rejectRows(ctx: Ctx, params: SearchParams) {
  return (await rejections(ctx, reportFilter(ctx, params))).map((r) => ({ ...r, modelLabel: MODEL_LABEL[r.model], numberOrRef: r.number ?? r.ref, statusLabel: DOC_STATUS_LABEL[r.status], currentLabel: DOC_STATUS_LABEL[r.currentStatus] }));
}

/** Documentos do período (detalhe conciliável dos totais) com o critério escolhido. */
export async function periodDocRows(ctx: Ctx, params: SearchParams) {
  const f = reportFilter(ctx, params);
  const docs = await periodDocuments(ctx, f);
  const crit = sp(params, "crit");
  // mesmos critérios dos totais (summarize): o detalhamento concilia com os indicadores
  const filtered = docs.filter((d) => {
    if (crit === "revenue") return isRevenue(d);
    if (crit === "nonrevenue") return isNonRevenueOut(d);
    if (crit === "returns") return isReturnIn(d);
    if (crit === "pending") return PENDING_STATES.includes(d.status);
    if (crit === "issued") return ["authorized", "cancelled"].includes(d.status);
    if (crit) return d.status === crit;
    return true;
  });
  return docRows(filtered).map((d): Record<string, any> & { id: string } => ({ ...d, approxTax: d.totals?.approxTax ?? 0, icms: d.totals?.icms ?? 0, iss: d.service?.iss ?? 0, revenueValue: revenueAmount(d as Doc) }));
}
