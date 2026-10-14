import "server-only";
import { listAll } from "@/lib/db";
import { sp, type SearchParams } from "@/lib/list";
import { today } from "@/lib/dates";
import type { SessionInfo } from "@/lib/server/session";
import { AGING_BUCKETS, type AgingBucket } from "@/domain/finance-reports";
import { resolveReportParams, type ReportParams } from "../params";

export type FinanceTab = "dre" | "receber" | "pagar";

export interface FinanceReportParams extends ReportParams {
  aba: FinanceTab;
  /** data de referência do aging (padrão: hoje) */
  ref: string;
  faixa: AgingBucket | null;
  /** filiais para os serviços: null = empresa inteira (todas as filiais acessíveis são todas as da empresa) */
  domainBranchIds: string[] | null;
}

/** Parâmetros dos relatórios financeiros (tela, impressão e CSV usam os mesmos). */
export async function financeReportParams(s: SessionInfo, params: SearchParams): Promise<FinanceReportParams> {
  const rp = resolveReportParams(s, params, "mes");
  const a = sp(params, "aba");
  const aba: FinanceTab = a === "receber" || a === "pagar" ? a : "dre";
  const r = sp(params, "ref");
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(r) ? r : today();
  const f = sp(params, "faixa");
  const faixa = AGING_BUCKETS.some((b) => b.key === f) ? (f as AgingBucket) : null;
  let domainBranchIds: string[] | null = rp.branchIds;
  if (!rp.single) {
    const all = await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] });
    if (all.every((b) => rp.branchIds.includes(b.id))) domainBranchIds = null;
  }
  return { ...rp, aba, ref, faixa, domainBranchIds };
}
