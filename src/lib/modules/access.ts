import { detId } from "../db/ids";
import type { Store } from "../db/types";
import { CONTRACTABLE, MODULES_CATALOG, MODULE_MAP } from "./catalog";
import { activeComponents, transitiveComponents } from "./graph";
import type { AccessDecision, AccessLevel, CompanyKind, CompanyModulesDoc, ControlMode, ModuleDef } from "./types";

/**
 * Regra de acesso por módulo (habilitação). Puro sobre o estado da empresa: nenhuma consulta além da leitura do registro
 * `company_modules` da própria empresa — alterar uma empresa nunca afeta outra (registro e cache por empresa).
 */

export const companyModulesId = (companyId: string) => detId("cmods", companyId);

/** Estado da empresa (sem registro = modo legado, comportamento anterior). */
export async function loadCompanyModules(store: Store, companyId: string): Promise<CompanyModulesDoc | null> {
  if (!companyId) return null;
  const d = await store.get("company_modules", companyModulesId(companyId));
  return d ? (d as unknown as CompanyModulesDoc) : null;
}

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, drain: 2, full: 3 };
const minLevel = (a: AccessLevel, b: AccessLevel): AccessLevel => (RANK[a] <= RANK[b] ? a : b);

/** Módulos efetivamente ligados (habilitado ou com desligamento agendado). */
export function enabledSet(doc: CompanyModulesDoc | null): Set<string> {
  const out = new Set<string>();
  for (const [k, e] of Object.entries(doc?.modules ?? {})) if (e.state === "enabled" || e.state === "scheduled_off") out.add(k);
  return out;
}

/** Nível que o controle aplicaria (independente do modo). */
export function enforcedLevelOf(doc: CompanyModulesDoc | null, key: string, kind: CompanyKind = "retail", seen = new Set<string>()): AccessLevel {
  const def = MODULE_MAP.get(key);
  if (!def || def.classification === "platform") return "full";
  if (def.classification === "technical") {
    const enabled = enabledSet(doc);
    if (activeComponents(MODULES_CATALOG, enabled).has(key)) return "full";
    // componente usado por módulo em conclusão/histórico: obrigações (ex.: documento fiscal em processamento)
    for (const [k, e] of Object.entries(doc?.modules ?? {})) {
      if (!transitiveComponents(MODULES_CATALOG, k).includes(key)) continue;
      if (e.state === "draining") return "drain";
    }
    return Object.keys(doc?.modules ?? {}).some((k) => transitiveComponents(MODULES_CATALOG, k).includes(key)) ? "read" : "none";
  }
  if (def.availability === "planned") return "none";
  if (!def.kinds.includes(kind)) return "none";
  const e = doc?.modules?.[key];
  let level: AccessLevel = "none";
  if (e) {
    if (e.state === "enabled" || e.state === "scheduled_off") level = "full";
    else if (e.state === "draining") level = "drain";
    else level = (e.history ?? (def.deactivation.afterOff === "hidden" ? "none" : "read")) === "read" ? "read" : "none";
  }
  // função opcional nunca vale mais que o pai
  if (def.parent && !seen.has(def.parent)) {
    seen.add(key);
    level = minLevel(level, enforcedLevelOf(doc, def.parent, kind, seen));
  }
  return level;
}

/** Decisão de acesso considerando o modo de controle da empresa. */
export function decide(doc: CompanyModulesDoc | null, key: string, kind: CompanyKind = "retail"): AccessDecision {
  const mode: ControlMode = doc?.mode ?? "legacy";
  if (mode === "legacy") return { level: "full", enforcedLevel: "full", module: key, mode, reason: "Controle de módulos não ativado para a empresa (comportamento anterior)." };
  const enforcedLevel = enforcedLevelOf(doc, key, kind);
  const reason = reasonFor(doc, key, enforcedLevel);
  return { level: mode === "enforced" ? enforcedLevel : "full", enforcedLevel, module: key, mode, reason };
}

function reasonFor(doc: CompanyModulesDoc | null, key: string, level: AccessLevel): string {
  const def = MODULE_MAP.get(key);
  const name = def?.name ?? key;
  if (level === "full") return `${name}: habilitado.`;
  const e = doc?.modules?.[key];
  if (level === "drain") return `${name}: em desligamento — só é possível concluir as operações em andamento.`;
  if (level === "read") return `${name}: desligado — disponível só para consulta do histórico.`;
  if (def?.availability === "planned") return `${name}: ainda não disponível no ERP.`;
  if (!e && def?.parent && doc?.modules?.[def.parent]?.state !== "enabled") return `${name}: depende de ${MODULE_MAP.get(def.parent)?.name ?? def.parent}, que não está habilitado.`;
  return `${name}: não contratado para esta empresa.`;
}

/** Uma ação (server action pelo nome) pode rodar neste nível? */
export function actionAllowed(level: AccessLevel, def: ModuleDef | undefined, actionName?: string): boolean {
  if (level === "full") return true;
  if (!def || !actionName) return false;
  const d = def.deactivation;
  if (level === "drain") return Boolean(d.drainActions?.includes(actionName) || d.historyActions?.includes(actionName));
  if (level === "read") return Boolean(d.historyActions?.includes(actionName));
  return false;
}

/** Visão completa (todas as entradas) para a interface e o Interos. */
export function accessMap(doc: CompanyModulesDoc | null, kind: CompanyKind = "retail"): Record<string, AccessDecision> {
  return Object.fromEntries(MODULES_CATALOG.map((m) => [m.key, decide(doc, m.key, kind)]));
}

/** Conjunto padrão do modo legado: tudo que o tipo de empresa já tinha. */
export function legacyModulesFor(kind: CompanyKind): string[] {
  return CONTRACTABLE.filter((m) => m.kinds.includes(kind)).map((m) => m.key);
}
