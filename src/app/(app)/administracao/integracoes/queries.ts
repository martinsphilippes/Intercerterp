import "server-only";
import { detId } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { diagnose, INTEGRATION_CATALOG, integrationJobs, secretStatus, STATUS_LABEL, type IntegrationKind } from "@/domain/integrations";
import { getFiscalConfig } from "@/domain/fiscal/service";

export const KIND_META: Record<IntegrationKind, { abbr: string; category: string }> = {
  pix: { abbr: "PX", category: "Pagamentos" },
  card_tef: { abbr: "TF", category: "Pagamentos" },
  fiscal_nfe: { abbr: "FE", category: "Fiscal" },
  fiscal_nfse: { abbr: "FS", category: "Fiscal" },
  bank: { abbr: "BC", category: "Financeiro" },
  accounting: { abbr: "CT", category: "Contabilidade" },
  email: { abbr: "EM", category: "Comunicação" },
};

export const CATEGORIES = ["Pagamentos", "Fiscal", "Financeiro", "Contabilidade", "Comunicação"];

export interface IntegrationOverview {
  kind: IntegrationKind;
  label: string;
  description: string;
  category: string;
  abbr: string;
  configured: boolean;
  enabled: boolean;
  scope: "branch" | "company" | null;
  provider: string | null;
  providerLabel: string | null;
  environment: string | null;
  simulated: boolean;
  status: string;
  statusLabel: string;
  message: string | null;
  diagnosis: string;
  lastTestAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  secrets: ReturnType<typeof secretStatus>;
  pendingJobs: number;
  record: Doc | null;
  fiscalConfig: Doc | null;
}

/** Situação efetiva de cada integração para a filial (registro da filial ou da empresa); fiscal vem de fiscal_configs. */
export async function integrationOverview(ctx: Ctx, kind: IntegrationKind): Promise<IntegrationOverview> {
  const cat = INTEGRATION_CATALOG[kind];
  const meta = KIND_META[kind];
  const branchRec = ctx.branchId ? await ctx.store.get("integrations", detId("integration", `${ctx.companyId}|${ctx.branchId}|${kind}`)) : null;
  const companyRec = await ctx.store.get("integrations", detId("integration", `${ctx.companyId}|*|${kind}`));
  const record = branchRec ?? companyRec;
  const jobs = await integrationJobs(ctx, kind, ["retry", "dead"]);
  if (kind === "fiscal_nfe" || kind === "fiscal_nfse") {
    const cfg = await getFiscalConfig(ctx.store, ctx.companyId, ctx.branchId);
    const provider = cfg?.provider ?? null;
    const prov = cat.providers.find((p) => p.id === provider);
    const secrets = secretStatus(kind, provider, provider === "focusnfe" ? { token: cfg?.tokenRef === "" ? "" : (cfg?.tokenRef ?? "FOCUSNFE_TOKEN") } : {});
    const status = !cfg ? "not_configured" : (cfg.connectionStatus ?? "configured_untested");
    const enabled = !cfg ? false : kind === "fiscal_nfe" ? cfg.nfeEnabled !== false || cfg.nfceEnabled !== false : cfg.nfseEnabled !== false;
    return {
      kind, label: cat.label, description: cat.description, category: meta.category, abbr: meta.abbr,
      configured: Boolean(cfg), enabled, scope: cfg ? ((cfg.branchId ?? null) === ctx.branchId && ctx.branchId ? "branch" : "company") : null,
      provider, providerLabel: prov?.label ?? provider, environment: cfg?.environment ?? null, simulated: provider === "simulated",
      status, statusLabel: STATUS_LABEL[status] ?? status, message: cfg?.lastTestResult ?? null,
      diagnosis: diagnose(status, cfg?.lastTestResult, secrets), lastTestAt: cfg?.lastTestAt ?? null,
      lastRunAt: record?.lastRunAt ?? null, lastRunStatus: record?.lastRunStatus ?? null, secrets, pendingJobs: jobs.length, record, fiscalConfig: cfg,
    };
  }
  const provider = record?.provider ?? null;
  const prov = cat.providers.find((p) => p.id === provider);
  const secrets = secretStatus(kind, provider, record?.secretRefs);
  const enabled = Boolean(record) && record!.enabled !== false;
  const status = !record ? "not_configured" : (record.status ?? "configured_untested");
  return {
    kind, label: cat.label, description: cat.description, category: meta.category, abbr: meta.abbr,
    configured: Boolean(record), enabled, scope: record ? (record.branchId ? "branch" : "company") : null,
    provider, providerLabel: prov?.label ?? provider, environment: record?.environment ?? null, simulated: Boolean(prov?.simulated),
    status, statusLabel: STATUS_LABEL[status] ?? status, message: record?.lastTestMessage ?? null,
    diagnosis: diagnose(status, record?.lastTestMessage, secrets), lastTestAt: record?.lastTestAt ?? null,
    lastRunAt: record?.lastRunAt ?? null, lastRunStatus: record?.lastRunStatus ?? null, secrets, pendingJobs: jobs.length, record, fiscalConfig: null,
  };
}

export async function allOverviews(ctx: Ctx) {
  return Promise.all((Object.keys(INTEGRATION_CATALOG) as IntegrationKind[]).map((k) => integrationOverview(ctx, k)));
}
