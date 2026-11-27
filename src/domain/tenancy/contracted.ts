import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { CONTRACT_MODULE_V1_KEYS, contractModuleOfV1Key, contractOf } from "./contract";

/**
 * O que a empresa CONTRATOU, em módulos amplos (pdv, vendas, estoque, compras, financeiro, fiscal, relatórios,
 * comércio digital, gestão contábil, rede) — uma única resposta para a Torre de Controle e as consultas (correção 6).
 *
 * Fonte, nesta ordem (a unidade v2 é a referência — pendência 4):
 *  1. licença v2 aplicada: os itens do retrato (qualquer estado, menos `inactive`) e o direito preservado;
 *  2. controle de módulos ligado (`shadow`/`enforced`): as chaves habilitadas, em conclusão ou agendadas;
 *  3. contrato do provisionamento (`PUT /empresas/{id}/modulos`);
 *  4. nada disso (empresa anterior ao multiempresa): tudo — `null`.
 * Suspensão não tira um módulo do contrato: suspenso continua contratado (a Torre mostra o histórico).
 */
export async function contractedAreas(store: Store, company: Doc): Promise<Set<string> | null> {
  const base = unscoped(store);
  const { licenseId } = await import("../licensing/license");
  const lic = await base.get("company_licenses", licenseId(company.id));
  if (lic?.snapshot && lic.licenseVersion > 0) {
    const { resolveCode, unitByCode } = await import("../licensing/effective");
    const out = new Set<string>();
    for (const it of (lic.snapshot.items ?? []) as Array<{ code: string; state: string }>) {
      if (it.state === "inactive") continue;
      for (const u of resolveCode(it.code).units) {
        const area = contractModuleOfV1Key(unitByCode(u)?.v1Key ?? "");
        if (area) out.add(area);
      }
    }
    for (const k of (lic.preservedAccess as string[] | undefined) ?? []) {
      const area = contractModuleOfV1Key(k);
      if (area) out.add(area);
    }
    return out;
  }
  const { companyModulesId } = await import("@/lib/modules/access");
  const mods = await base.get("company_modules", companyModulesId(company.id));
  if (mods && mods.mode !== "legacy") {
    const out = new Set<string>();
    for (const [k, e] of Object.entries((mods.modules ?? {}) as Record<string, { state?: string }>)) {
      if (!["enabled", "scheduled_off", "draining"].includes(e.state ?? "")) continue;
      const area = contractModuleOfV1Key(k);
      if (area) out.add(area);
    }
    return out;
  }
  const contract = contractOf(company);
  return contract ? new Set(contract.modules.filter((m) => m in CONTRACT_MODULE_V1_KEYS)) : null;
}

/** Algum dos módulos amplos está contratado? (`areas` null = tudo) */
export function anyContracted(areas: Set<string> | null, ...keys: string[]): boolean {
  return !areas || keys.some((k) => areas.has(k));
}
