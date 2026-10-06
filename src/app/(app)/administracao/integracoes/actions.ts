"use server";

import { runAction, fstr, fopt, fbool } from "@/lib/server/action";
import { requireAction } from "@/lib/core/ctx";
import { assert } from "@/lib/core/errors";
import { INTEGRATION_CATALOG, requeueJob, runCompanyJobs, saveFiscalIntegration, saveIntegration, testIntegration, STATUS_LABEL, type IntegrationKind } from "@/domain/integrations";
import { getFiscalConfig } from "@/domain/fiscal/service";

const R = ["/administracao/integracoes"];
const scopeOf = (s: { ctx: { branchId: string | null } }, scope: string) => (scope === "company" ? null : s.ctx.branchId);

export async function saveIntegrationAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: R }, async (s) => {
    requireAction(s.ctx, "admin.integrations");
    const kind = fstr(fd, "kind") as IntegrationKind;
    const cat = INTEGRATION_CATALOG[kind];
    assert(cat, "Integração desconhecida.");
    const provider = fstr(fd, "provider");
    const prov = cat.providers.find((p) => p.id === provider);
    assert(prov, "Selecione o provedor.");
    assert(fstr(fd, "connectionName"), "Informe o nome da conexão.");
    const config: Record<string, any> = { connectionName: fstr(fd, "connectionName") };
    for (const k of prov!.config) {
      const v = fstr(fd, `cfg_${k}`);
      if (v) config[k] = /Bps$|Days$/.test(k) ? Number(v.replace(",", ".")) : v;
    }
    const secretRefs: Record<string, string> = {};
    for (const k of prov!.secrets) secretRefs[k] = fstr(fd, `secret_${k}`).toUpperCase();
    await saveIntegration(s.ctx, { kind, branchId: scopeOf(s, fstr(fd, "scope")), provider, environment: fstr(fd, "environment") || "homologacao", config, secretRefs, enabled: fbool(fd, "enabled") });
    return { ok: true as const, message: "Configuração salva — situação: configurada sem teste. Execute o teste para medir a conexão." };
  });
}

export async function saveFiscalIntegrationAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: [...R, "/fiscal/configuracoes"] }, async (s) => {
    const kind = fstr(fd, "kind") as "fiscal_nfe" | "fiscal_nfse";
    const branchId = scopeOf(s, fstr(fd, "scope"));
    const cfg = await getFiscalConfig(s.ctx.store, s.ctx.companyId, branchId);
    await saveFiscalIntegration(s.ctx, branchId, {
      kind,
      provider: fstr(fd, "provider"),
      environment: cfg?.environment ?? "homologacao",
      tokenRef: fstr(fd, "tokenRef").toUpperCase(),
      nfseStandard: fopt(fd, "nfseStandard"),
      cscId: kind === "fiscal_nfe" ? fopt(fd, "cscId") : undefined,
      cscTokenRef: kind === "fiscal_nfe" ? (fopt(fd, "cscTokenRef")?.toUpperCase() ?? null) : undefined,
      enabled: fbool(fd, "enabled"),
      connectionName: fstr(fd, "connectionName"),
    });
    return { ok: true as const, message: "Integração fiscal salva na configuração fiscal da filial — situação: configurada sem teste." };
  });
}

export async function unlinkCredentialAction(kind: IntegrationKind, scope: "branch" | "company") {
  return runAction({ module: "admin", op: "edit", revalidate: R }, async (s) => {
    requireAction(s.ctx, "admin.integrations");
    const branchId = scopeOf(s, scope);
    if (kind === "fiscal_nfe" || kind === "fiscal_nfse") {
      const cfg = await getFiscalConfig(s.ctx.store, s.ctx.companyId, branchId);
      assert(cfg, "Configuração fiscal não cadastrada.");
      await saveFiscalIntegration(s.ctx, branchId, { kind, provider: cfg!.provider, environment: cfg!.environment ?? "homologacao", tokenRef: "", enabled: kind === "fiscal_nfe" ? cfg!.nfeEnabled !== false : cfg!.nfseEnabled !== false });
    } else {
      // registro bruto: também remove vínculos gravados com variável não permitida (que tornam a integração inoperante)
      const { findIntegration } = await import("@/domain/integrations");
      const integ = await findIntegration(s.ctx.store, s.ctx.companyId, branchId, kind);
      assert(integ, "Integração não configurada.");
      const config: Record<string, any> = { ...(integ!.config ?? {}) };
      delete config.baseUrl; // URL base não é mais configurável (endereço oficial do provedor)
      await saveIntegration(s.ctx, { kind, branchId: integ!.branchId ?? null, provider: integ!.provider, environment: integ!.environment, config, secretRefs: {}, enabled: integ!.enabled !== false }, { unlinkSecrets: true });
    }
    return { ok: true as const, message: "Vínculo de credencial removido. A integração não opera até um novo vínculo." };
  });
}

export async function testIntegrationAction(kind: IntegrationKind, scope: "branch" | "company") {
  return runAction({ module: "admin", op: "view", revalidate: R }, async (s) => {
    const r = await testIntegration(s.ctx, kind, scopeOf(s, scope));
    if (!r.ok && r.status !== "configured_untested") return { ok: false as const, error: `${STATUS_LABEL[r.status] ?? r.status}: ${r.message}` };
    return { ok: true as const, message: `${STATUS_LABEL[r.status] ?? r.status}: ${r.message}` };
  });
}

export async function requeueJobAction(jobId: string) {
  return runAction({ module: "admin", op: "edit", revalidate: R }, async (s) => {
    const r = await requeueJob(s.ctx, jobId);
    const x = r[0];
    return { ok: true as const, message: x ? `Tarefa reprocessada: ${x.status === "done" ? "concluída" : x.status === "retry" ? `nova falha — ${x.error ?? ""}` : x.status}` : "Tarefa reenfileirada (será executada pelo agendador)." };
  });
}

export async function runJobsAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: R }, async (s) => {
    const r = await runCompanyJobs(s.ctx, { includeRetry: fbool(fd, "includeRetry") || true });
    const ok = r.results.filter((x) => x.status === "done").length;
    return { ok: true as const, message: r.ran ? `${r.ran} tarefa(s) executada(s): ${ok} concluída(s), ${r.ran - ok} com falha/retentativa.` : "Nenhuma tarefa pendente para executar." };
  });
}
