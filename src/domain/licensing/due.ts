import { unscoped } from "@/lib/db/scoped-store";
import type { Store } from "@/lib/db/types";
import { BusinessError } from "@/lib/core/errors";

/**
 * Transições vencidas aplicadas NA HORA (correção 3 da homologação com o Interos).
 *
 * Fim de teste e de carência, ativação e suspensão agendadas, fim de vigência, operações de módulos agendadas e
 * desligamentos em conclusão não esperam a rotina diária. A primeira requisição da empresa depois do instante aplica:
 * tela, ação, vitrine ou leitura do Interos (licença, sincronização, histórico, módulos). A rotina diária continua como
 * rede de segurança para empresas sem movimento.
 *
 * Nunca derruba a requisição: com outra aplicação em andamento (`license_busy`) ou qualquer falha, segue com o estado
 * gravado e a próxima requisição tenta de novo.
 */
const DRAIN_CHECK_MS = 5 * 60_000;
const drainChecked = new Map<string, number>();

export async function applyDueTransitions(store: Store, companyId: string, now = new Date()): Promise<{ license: boolean; operations: boolean; drains: boolean }> {
  const out = { license: false, operations: false, drains: false };
  if (!companyId) return out;
  const base = unscoped(store);
  try {
    const { licenseId, maintainLicense } = await import("./license");
    const lic = await base.get("company_licenses", licenseId(companyId));
    if (lic?.nextTransitionAt && Date.parse(lic.nextTransitionAt) <= now.getTime()) {
      await maintainLicense(base, companyId, now);
      out.license = true;
    }
    const due = await base.list("module_operations", { filters: [["eq", "companyId", companyId], ["eq", "status", "scheduled"], ["lte", "scheduledFor", now.toISOString()]], limit: 1 });
    if (due.items.length) {
      const { runModulesMaintenance } = await import("../modules/operations");
      await runModulesMaintenance(base, companyId);
      out.operations = true;
    }
    // desligamento em conclusão (drain): confere as pendências no máximo a cada 5 min por empresa e instância
    const last = drainChecked.get(companyId) ?? 0;
    if (now.getTime() - last >= DRAIN_CHECK_MS) {
      const doc = await base.get("company_modules", (await import("@/lib/modules/access")).companyModulesId(companyId));
      const draining = Object.values((doc?.modules ?? {}) as Record<string, { state?: string }>).some((e) => e.state === "draining" || e.state === "scheduled_off");
      drainChecked.set(companyId, now.getTime());
      if (draining) {
        const { finalizePendingDeactivations } = await import("../modules/changes");
        out.drains = (await finalizePendingDeactivations(base, companyId)).finalized.length > 0;
      }
    }
  } catch (e) {
    if (!(e instanceof BusinessError && e.code === "license_busy")) console.warn(`[licença] transição vencida não aplicada agora (${companyId}): ${(e as Error)?.message ?? e}`);
  }
  return out;
}

/** Só para testes: esquece quando os desligamentos em conclusão foram conferidos. */
export function resetDueTransitionChecks() {
  drainChecked.clear();
}
