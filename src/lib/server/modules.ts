import "server-only";
import { cache } from "react";
import { BusinessError } from "../core/errors";
import type { Ctx } from "../core/ctx";
import type { Store } from "../db/types";
import { actionAllowed, decide, loadCompanyModules } from "../modules/access";
import { MODULE_MAP } from "../modules/catalog";
import { bestLevel, modulesForPath } from "../modules/surfaces";
import type { AccessDecision, AccessLevel, CompanyKind, CompanyModulesDoc } from "../modules/types";

/**
 * Ponto único de controle da habilitação no servidor (telas, server actions, APIs, exportações, páginas públicas).
 * Ordem da regra completa: empresa apta (sessão/unidade ativa) → módulo habilitado → perfil (can/canDo) → escopo (ScopedStore).
 */

export class ModuleUnavailableError extends BusinessError {
  constructor(message: string, readonly decision: AccessDecision) {
    super(message, "module_disabled", { module: decision.module, level: decision.level });
    this.name = "ModuleUnavailableError";
  }
}

/** Estado da empresa — uma leitura por requisição (e 15 s entre requisições pela camada de leitura). */
export const companyModulesCached = cache((store: Store, companyId: string) => loadCompanyModules(store, companyId));

export async function companyModules(ctx: Pick<Ctx, "store" | "companyId">): Promise<CompanyModulesDoc | null> {
  return companyModulesCached(ctx.store, ctx.companyId);
}

const kindOf = (company: Record<string, any> | null | undefined): CompanyKind => (company?.kind === "accounting" || company?.kind === "certification" ? company.kind : "retail");

/** Decisão combinada de uma superfície com um ou vários donos (vale o melhor nível). */
export function combined(doc: CompanyModulesDoc | null, keys: string[], kind: CompanyKind): AccessDecision {
  if (!keys.length) return { level: "full", enforcedLevel: "full", module: "plataforma", mode: doc?.mode ?? "legacy", reason: "Superfície da plataforma." };
  const ds = keys.map((k) => decide(doc, k, kind));
  const level = bestLevel(ds.map((d) => d.level));
  const enforcedLevel = bestLevel(ds.map((d) => d.enforcedLevel));
  const pick = ds.find((d) => d.enforcedLevel === enforcedLevel) ?? ds[0];
  return { ...pick, level, enforcedLevel };
}

export async function moduleDecision(ctx: Pick<Ctx, "store" | "companyId">, company: Record<string, any> | null, keys: string | string[]): Promise<AccessDecision> {
  const doc = await companyModules(ctx);
  return combined(doc, Array.isArray(keys) ? keys : [keys], kindOf(company));
}

export async function pathDecision(ctx: Pick<Ctx, "store" | "companyId">, company: Record<string, any> | null, pathname: string): Promise<AccessDecision & { pattern?: string }> {
  const hit = modulesForPath(pathname);
  const d = await moduleDecision(ctx, company, hit?.modules ?? []);
  return { ...d, pattern: hit?.pattern };
}

// ─── modo shadow: registra o que seria negado (no máximo 1 vez por minuto por empresa/superfície e instância)
const shadowSeen = new Map<string, number>();
export async function recordShadow(ctx: Ctx, d: AccessDecision, surface: string, required: AccessLevel) {
  if (d.mode !== "shadow") return;
  const RANK: Record<AccessLevel, number> = { none: 0, read: 1, drain: 2, full: 3 };
  if (RANK[d.enforcedLevel] >= RANK[required]) return;
  const k = `${ctx.companyId}|${surface}`;
  const now = Date.now();
  if ((shadowSeen.get(k) ?? 0) > now - 60_000) return;
  shadowSeen.set(k, now);
  const { audit } = await import("../core/audit");
  await audit(ctx, { module: "admin", action: "module.shadow_denied", entityType: "module", entityId: d.module, summary: `Controle de módulos (simulação): ${surface} seria negado — ${d.reason}`.slice(0, 480), after: { surface, enforcedLevel: d.enforcedLevel, required }, result: "failure" });
}

/**
 * Server action: exige o módulo no nível necessário. `action` é o nome da função (as listas drainActions/historyActions
 * do catálogo liberam a conclusão de operações em andamento e a correção de histórico).
 */
export async function assertActionModule(ctx: Ctx, company: Record<string, any> | null, keys: string | string[], action?: string) {
  const list = Array.isArray(keys) ? keys : [keys];
  const doc = await companyModules(ctx);
  const kind = kindOf(company);
  const ds = list.map((k) => ({ k, d: decide(doc, k, kind) }));
  const allowedReal = ds.some(({ k, d }) => actionAllowed(d.level, MODULE_MAP.get(k), action));
  const allowedEnforced = ds.some(({ k, d }) => actionAllowed(d.enforcedLevel, MODULE_MAP.get(k), action));
  const first = ds[0]?.d;
  if (!first) return;
  if (!allowedEnforced && first.mode === "shadow") await recordShadow(ctx, { ...first, enforcedLevel: "none" }, `ação ${action ?? list.join("|")}`, "full");
  if (allowedReal) return;
  const worst = ds.find(({ d }) => d.level !== "full")?.d ?? first;
  const { audit } = await import("../core/audit");
  await audit(ctx, { module: "admin", action: "module.denied", entityType: "module", entityId: worst.module, summary: `Ação negada pela habilitação: ${action ?? ""} — ${worst.reason}`.slice(0, 480), result: "failure" });
  throw new ModuleUnavailableError(
    worst.level === "drain"
      ? `${worst.reason} Esta ação não faz parte da conclusão.`
      : worst.level === "read"
        ? `${worst.reason} Para voltar a operar, o módulo precisa ser reativado no contrato.`
        : `${worst.reason} Fale com o responsável pelo contrato para habilitá-lo.`,
    worst,
  );
}

/** Exige o módulo para uma leitura (exportação, API): nível diferente de "none". */
export async function assertReadModule(ctx: Ctx, company: Record<string, any> | null, keys: string[], surface: string): Promise<AccessDecision> {
  const d = await moduleDecision(ctx, company, keys);
  await recordShadow(ctx, d, surface, "read");
  if (d.level === "none") throw new ModuleUnavailableError(d.reason, d);
  return d;
}
