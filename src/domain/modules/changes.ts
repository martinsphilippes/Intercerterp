import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { BusinessError } from "@/lib/core/errors";
import { accessMap, companyModulesId, enabledSet, loadCompanyModules } from "@/lib/modules/access";
import { CATALOG_VERSION, MODULES_CATALOG, MODULE_MAP } from "@/lib/modules/catalog";
import { dependentsOf, missingDependencies, transitiveRequires } from "@/lib/modules/graph";
import type { CompanyKind, CompanyModuleEntry, CompanyModuleState, CompanyModulesDoc, ControlMode } from "@/lib/modules/types";
import { evaluateBlockers, type BlockerResult } from "./blockers";

/**
 * Alterações de módulos de UMA empresa: simulação de impacto, aplicação atômica com controle de versão, desligamento
 * com conclusão/agendamento, reativação preservando configuração e histórico. Toda leitura e gravação usa o
 * `companyId` da empresa-alvo: a alteração de uma empresa nunca toca o registro de outra.
 */

export type ChangeAction = "enable" | "disable";

export interface ModuleChange {
  module: string;
  action: ChangeAction;
  /** depois de desligado: consulta histórica ("read", padrão da política) ou oculto ("none") */
  history?: "read" | "none";
  /** configuração específica do módulo (preservada na reativação) */
  config?: Record<string, unknown> | null;
}

export interface ChangeSetInput {
  companyId: string;
  changes: ModuleChange[];
  /** troca do modo de controle (lançamento gradual) */
  mode?: ControlMode;
  /** desliga também os dependentes habilitados (sem isso, dependente ligado recusa o desligamento) */
  cascade?: boolean;
  /** divergências da linha de base revisadas por quem aplica (exigido para passar a "enforced" com divergências abertas) */
  reviewDivergences?: boolean;
}

export interface ApplyContext {
  actor: string;
  actorType: "interos" | "platform_admin" | "provisioning" | "migration" | "system";
  reason: string;
  operationId?: string | null;
  /** versão esperada do registro da empresa (controle de edição concorrente); ausente = sem conferência */
  expectedVersion?: number | null;
  /** quem revisou as divergências da linha de base (pessoa, nunca o cliente de serviço) e a observação dela */
  reviewer?: { name: string; notes?: string | null } | null;
}

export interface ModuleImpact {
  module: string;
  name: string;
  action: ChangeAction;
  from: CompanyModuleState | "absent";
  to: CompanyModuleState;
  policy?: string;
  blockers: BlockerResult[];
  obligations: string[];
  /** dependentes que também mudam (cascata) */
  cascadedFrom?: string;
  /** integrações opcionais de módulos que seguem ligados e deixam de funcionar */
  integrationsAffected: { module: string; effect: string }[];
  requires: string[];
  dependents: string[];
}

export interface SimulationIssue {
  code: string;
  module?: string;
  message: string;
  details?: unknown;
}

export interface Simulation {
  companyId: string;
  catalogVersion: string;
  version: number;
  mode: ControlMode;
  nextMode: ControlMode;
  valid: boolean;
  impacts: ModuleImpact[];
  errors: SimulationIssue[];
  warnings: SimulationIssue[];
  /** estado resultante (chave → estado) */
  resulting: Record<string, CompanyModuleState>;
  /** entradas resultantes completas (uso interno da aplicação; não publicado na API) */
  entries: Record<string, CompanyModuleEntry>;
}

const kindOf = (c: Doc | null): CompanyKind => (c?.kind === "accounting" || c?.kind === "certification" ? c.kind : "retail");

export async function companyOrThrow(store: Store, companyId: string): Promise<Doc> {
  const c = await store.get("companies", companyId);
  if (!c) throw new BusinessError("Empresa não encontrada no ERP.", "company_not_found");
  return c;
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

/** Simula o conjunto de alterações (nada é gravado). */
export async function simulateChanges(store: Store, input: ChangeSetInput, existing?: CompanyModulesDoc | null): Promise<Simulation> {
  const company = await companyOrThrow(store, input.companyId);
  const kind = kindOf(company);
  const doc = existing === undefined ? await loadCompanyModules(store, input.companyId) : existing;
  const errors: SimulationIssue[] = [];
  const warnings: SimulationIssue[] = [];
  const impacts: ModuleImpact[] = [];
  const mods: Record<string, CompanyModuleEntry> = JSON.parse(JSON.stringify(doc?.modules ?? {}));
  const mode = doc?.mode ?? "legacy";
  const nextMode = input.mode ?? mode;
  if (!doc) errors.push({ code: "baseline_required", message: "A empresa ainda não tem linha de base de módulos: rode a migração (linha de base) antes de alterar." });
  if (company.status === "inactive") warnings.push({ code: "company_inactive", message: "Empresa inativa no ERP: a habilitação é gravada, mas ninguém opera até a reativação da empresa." });

  // expansão da cascata de desligamento
  const changes: (ModuleChange & { cascadedFrom?: string })[] = [...input.changes];
  const seenKeys = new Set<string>();
  for (const c of changes) {
    if (seenKeys.has(c.module)) errors.push({ code: "duplicate_change", module: c.module, message: `Módulo ${c.module} aparece mais de uma vez no lote.` });
    seenKeys.add(c.module);
  }
  if (input.cascade) {
    // ponto fixo: desliga quem ficaria sem dependência obrigatória (inclusive grupos "basta um" sem alternativa ligada)
    const on = enabledSet({ companyId: input.companyId, mode, version: 0, modules: mods });
    for (const c of input.changes) if (c.action === "disable") on.delete(c.module); else on.add(c.module);
    for (let guard = 0; guard < 100; guard++) {
      const miss = missingDependencies(MODULES_CATALOG, on).filter((m) => !seenKeys.has(m.module));
      if (!miss.length) break;
      for (const m of miss) {
        const from = [...m.missing, ...(m.anyOf ?? []).flat()].find((k) => seenKeys.has(k)) ?? m.missing[0];
        changes.push({ module: m.module, action: "disable", cascadedFrom: from });
        seenKeys.add(m.module);
        on.delete(m.module);
      }
    }
  }

  for (const c of changes) {
    const def = MODULE_MAP.get(c.module);
    if (!def) {
      errors.push({ code: "unknown_module", module: c.module, message: `Módulo inexistente no catálogo ${CATALOG_VERSION}: ${c.module}.` });
      continue;
    }
    if (def.classification === "platform" || def.classification === "technical") {
      errors.push({ code: "not_contractable", module: c.module, message: `${def.name} é ${def.classification === "platform" ? "recurso obrigatório da plataforma" : "componente técnico compartilhado"}: não é ligado nem desligado por contrato.` });
      continue;
    }
    if (def.availability === "planned") {
      errors.push({ code: "module_planned", module: c.module, message: `${def.name} ainda não existe no ERP (lacuna documentada): não pode ser habilitado.` });
      continue;
    }
    if (c.action === "enable" && !def.kinds.includes(kind)) {
      errors.push({ code: "kind_not_supported", module: c.module, message: `${def.name} não se aplica a empresas do tipo "${kind}".` });
      continue;
    }
    if (def.availability === "needs_confirmation" && c.action === "enable") warnings.push({ code: "needs_confirmation", module: c.module, message: `${def.name}: recorte ainda em confirmação (${def.notes ?? "ver catálogo"}).` });
    const prev = mods[c.module];
    const from: CompanyModuleState | "absent" = prev?.state ?? "absent";
    const now = nowIso();
    let to: CompanyModuleState;
    let blockers: BlockerResult[] = [];
    if (c.action === "enable") {
      to = "enabled";
      // reativação: reaproveita a configuração e o histórico válidos (nada foi apagado no desligamento)
      mods[c.module] = { ...(prev ?? {}), state: "enabled", since: prev?.state === "enabled" ? prev.since : now, source: prev?.source ?? "interos", enabledAt: prev?.state === "enabled" ? prev.enabledAt ?? now : now, drainUntil: null, config: c.config !== undefined ? c.config : prev?.config ?? null, reason: null } as CompanyModuleEntry;
      if (prev?.state === "enabled") warnings.push({ code: "no_change", module: c.module, message: `${def.name} já está habilitado.` });
    } else {
      if (!prev || prev.state === "disabled") {
        warnings.push({ code: "no_change", module: c.module, message: `${def.name} já está desligado.` });
        to = "disabled";
        if (prev && c.history) mods[c.module] = { ...prev, history: c.history };
      } else {
        blockers = await evaluateBlockers(store, input.companyId, def.deactivation.blockers ?? []);
        const p = def.deactivation;
        if (p.mode === "immediate" || !blockers.length) to = "disabled";
        else to = p.mode === "drain" ? "draining" : "scheduled_off";
        const history = c.history ?? (p.afterOff === "hidden" ? "none" : "read");
        mods[c.module] = { ...prev, state: to, since: now, drainUntil: to === "draining" ? addDays(p.drainDays ?? 30) : null, history, disabledAt: to === "disabled" ? now : prev.disabledAt ?? null };
      }
    }
    // integrações opcionais de quem segue ligado
    const integrationsAffected = c.action === "disable"
      ? MODULES_CATALOG.filter((m) => (m.optionalIntegrations ?? []).some((i) => i.module === c.module)).filter((m) => mods[m.key]?.state === "enabled").map((m) => ({ module: m.key, effect: m.optionalIntegrations!.find((i) => i.module === c.module)!.effect }))
      : [];
    impacts.push({
      module: c.module, name: def.name, action: c.action, from, to, policy: c.action === "disable" ? def.deactivation.mode : undefined, blockers,
      obligations: c.action === "disable" ? def.deactivation.obligations ?? [] : [], cascadedFrom: c.cascadedFrom, integrationsAffected,
      requires: transitiveRequires(MODULES_CATALOG, c.module), dependents: dependentsOf(MODULES_CATALOG, c.module),
    });
  }

  // consistência do conjunto resultante (dependências obrigatórias e grupos "basta um")
  const after: CompanyModulesDoc = { companyId: input.companyId, mode: nextMode, version: doc?.version ?? 0, modules: mods };
  const enabled = enabledSet(after);
  for (const miss of missingDependencies(MODULES_CATALOG, enabled)) {
    const changed = changes.some((c) => c.module === miss.module || miss.missing.includes(c.module) || (miss.anyOf ?? []).flat().includes(c.module));
    if (!changed) {
      // inconsistência herdada (linha de base): avisa, não impede outras alterações
      warnings.push({ code: "inherited_inconsistency", module: miss.module, message: `${MODULE_MAP.get(miss.module)?.name}: dependências ausentes já antes deste lote.`, details: miss });
      continue;
    }
    const names = miss.missing.map((k) => MODULE_MAP.get(k)?.name ?? k);
    const isDisable = changes.some((c) => c.action === "disable" && (miss.missing.includes(c.module) || (miss.anyOf ?? []).flat().includes(c.module)));
    errors.push({
      code: isDisable ? "dependents_enabled" : "dependency_missing",
      module: miss.module,
      message: isDisable
        ? `${MODULE_MAP.get(miss.module)?.name} continua habilitado e depende de ${[...names, ...(miss.anyOf ?? []).map((g) => g.map((k) => MODULE_MAP.get(k)?.name ?? k).join(" ou "))].join(", ")}. Desligue-o no mesmo lote ou use a cascata.`
        : `${MODULE_MAP.get(miss.module)?.name} exige ${[...names, ...(miss.anyOf ?? []).map((g) => g.map((k) => MODULE_MAP.get(k)?.name ?? k).join(" ou "))].join(", ")} habilitado(s) no mesmo lote.`,
      details: miss,
    });
  }

  // passar a aplicar o controle: divergências da linha de base precisam estar revisadas
  if (nextMode === "enforced" && mode !== "enforced") {
    const baseline = await store.get("module_baselines", detId("modbase", input.companyId));
    const open = (baseline?.divergences ?? []).length && baseline?.status !== "reviewed";
    if (open && !input.reviewDivergences) errors.push({ code: "divergences_open", message: `Há ${(baseline!.divergences as unknown[]).length} divergência(s) da linha de base sem revisão: revise-as (reviewDivergences) antes de aplicar o controle.`, details: baseline!.divergences });
  }

  const resulting = Object.fromEntries(Object.entries(mods).map(([k, e]) => [k, e.state]));
  return { companyId: input.companyId, catalogVersion: CATALOG_VERSION, version: doc?.version ?? 0, mode, nextMode, valid: errors.length === 0, impacts, errors, warnings, resulting, entries: mods };
}

export class VersionConflictError extends BusinessError {
  constructor(current: number, expected: number | null | undefined) {
    super(`O registro de módulos da empresa mudou (versão atual ${current}, esperada ${expected}). Consulte o estado e simule de novo.`, "version_conflict", { currentVersion: current, expectedVersion: expected });
  }
}

export class ChangeRejectedError extends BusinessError {
  constructor(readonly simulation: Simulation) {
    super(simulation.errors.map((e) => e.message).join(" "), "changes_rejected", { errors: simulation.errors });
  }
}

/**
 * Aplica o lote de forma atômica: confere a versão, revalida o lote inteiro (dependências consistentes), grava o novo
 * estado e uma linha de histórico com índice único (empresa, versão) — duas aplicações concorrentes na mesma versão:
 * uma vence, a outra recebe conflito de versão.
 */
export async function applyChanges(store: Store, input: ChangeSetInput, ctx: ApplyContext): Promise<{ simulation: Simulation; version: number; changeId: string }> {
  const doc = await loadCompanyModules(store, input.companyId);
  if (!doc) throw new BusinessError("A empresa ainda não tem linha de base de módulos.", "baseline_required");
  if (ctx.expectedVersion != null && ctx.expectedVersion !== doc.version) throw new VersionConflictError(doc.version, ctx.expectedVersion);
  if (!ctx.reason?.trim()) throw new BusinessError("Informe o motivo da alteração.", "reason_required");
  const sim = await simulateChanges(store, input, doc);
  if (!sim.valid) throw new ChangeRejectedError(sim);
  const next = doc.version + 1;
  const now = nowIso();
  const source: CompanyModuleEntry["source"] = ctx.actorType === "interos" ? "interos" : ctx.actorType === "provisioning" ? "provisioning" : ctx.actorType === "platform_admin" ? "platform_admin" : "baseline";
  const changed = new Set(sim.impacts.map((i) => i.module));
  const modules: Record<string, CompanyModuleEntry> = Object.fromEntries(Object.entries(sim.entries).map(([k, e]) => [k, changed.has(k) ? { ...e, source, reason: ctx.reason } : e]));
  const changeId = detId("modchg", input.companyId, next);
  try {
    await store.transaction(async (tx) => {
      await tx.create("module_changes", {
        companyId: input.companyId, version: next, operationId: ctx.operationId ?? null, actor: ctx.actor, actorType: ctx.actorType, reason: ctx.reason,
        changes: { requested: input.changes, cascade: Boolean(input.cascade), mode: input.mode ?? null, impacts: sim.impacts }, before: { mode: doc.mode, modules: doc.modules }, after: { mode: sim.nextMode, modules }, at: now,
      }, changeId);
      await tx.update("company_modules", companyModulesId(input.companyId), { mode: sim.nextMode, version: next, modules, updatedBy: `${ctx.actorType}:${ctx.actor}` });
      if (input.reviewDivergences) {
        const bid = detId("modbase", input.companyId);
        if (await tx.get("module_baselines", bid)) await tx.update("module_baselines", bid, { status: "reviewed", reviewedBy: (ctx.reviewer?.name ?? `${ctx.actorType}:${ctx.actor}`).slice(0, 200), reviewedAt: now, ...(ctx.reviewer?.notes ? { notes: ctx.reviewer.notes.slice(0, 2000) } : {}) });
      }
    });
  } catch (e) {
    if (isConflict(e)) {
      const cur = await loadCompanyModules(store, input.companyId);
      throw new VersionConflictError(cur?.version ?? doc.version, ctx.expectedVersion ?? doc.version);
    }
    throw e;
  }
  // trilha de auditoria da empresa
  await store.create("audit_logs", {
    companyId: input.companyId, branchId: null, userId: null, userName: `${ctx.actorType}:${ctx.actor}`.slice(0, 200), module: "admin", action: "modules.apply", entityType: "company_modules",
    entityId: companyModulesId(input.companyId), summary: `Módulos alterados (versão ${next}): ${sim.impacts.map((i) => `${i.name} → ${i.to}`).join("; ")}${input.mode && input.mode !== doc.mode ? `; controle ${doc.mode} → ${input.mode}` : ""}`.slice(0, 500),
    reason: ctx.reason.slice(0, 500), result: "success", occurredAt: now, operationId: ctx.operationId ?? null, related: [], after: { impacts: sim.impacts.map((i) => ({ module: i.module, from: i.from, to: i.to })) },
  }).catch(() => undefined);
  return { simulation: sim, version: next, changeId };
}

/**
 * Conclusão dos desligamentos (rotina diária e sob demanda): módulo em conclusão ou agendado desliga quando as
 * pendências acabam. Passado o prazo de conclusão com pendências, NÃO desliga (obrigações não são interrompidas):
 * avisa e segue em conclusão.
 */
export async function finalizePendingDeactivations(store: Store, companyId: string): Promise<{ finalized: string[]; overdue: string[] }> {
  const doc = await loadCompanyModules(store, companyId);
  if (!doc) return { finalized: [], overdue: [] };
  const finalized: string[] = [];
  const overdue: string[] = [];
  for (const [k, e] of Object.entries(doc.modules)) {
    if (e.state !== "draining" && e.state !== "scheduled_off") continue;
    const def = MODULE_MAP.get(k);
    const blockers = await evaluateBlockers(store, companyId, def?.deactivation.blockers ?? []);
    if (!blockers.length) finalized.push(k);
    else if (e.drainUntil && e.drainUntil < nowIso()) overdue.push(k);
  }
  if (finalized.length) {
    // os dependentes já foram tratados no lote original; aqui só concluímos o que estava em transição
    const now = nowIso();
    const modules = { ...doc.modules };
    for (const k of finalized) modules[k] = { ...modules[k], state: "disabled", since: now, drainUntil: null, disabledAt: now };
    const next = doc.version + 1;
    try {
      await store.transaction(async (tx) => {
        await tx.create("module_changes", { companyId, version: next, operationId: null, actor: "rotina", actorType: "system", reason: "Conclusão do desligamento: sem pendências em andamento.", changes: { finalized }, before: { mode: doc.mode, modules: doc.modules }, after: { mode: doc.mode, modules }, at: now }, detId("modchg", companyId, next));
        await tx.update("company_modules", companyModulesId(companyId), { version: next, modules, updatedBy: "system:rotina" });
      });
    } catch (e) {
      if (!isConflict(e)) throw e;
      return { finalized: [], overdue }; // outra alteração no meio: a próxima execução conclui
    }
  }
  return { finalized, overdue };
}

/** Situação completa de uma empresa (Interos e tela de administração). */
export async function companyModulesStatus(store: Store, companyId: string) {
  const company = await companyOrThrow(store, companyId);
  const kind = kindOf(company);
  const doc = await loadCompanyModules(store, companyId);
  const access = accessMap(doc, kind);
  const readiness = await configurationReadiness(store, companyId, doc);
  const baseline = await store.get("module_baselines", detId("modbase", companyId));
  const modules = MODULES_CATALOG.filter((m) => m.classification === "commercial" || m.classification === "optional_function").map((m) => {
    const e = doc?.modules?.[m.key];
    return {
      module: m.key, name: m.name, state: e?.state ?? ("absent" as const), since: e?.since ?? null, source: e?.source ?? null, drainUntil: e?.drainUntil ?? null, history: e?.history ?? null,
      config: e?.config ?? null, access: access[m.key].level, accessIfEnforced: access[m.key].enforcedLevel, configuration: readiness[m.key] ?? { ready: true, missing: [] },
    };
  });
  return {
    companyId, companyName: company.tradeName || company.name, companyKind: kind, companyStatus: company.status ?? "active", operational: company.status !== "inactive",
    mode: doc?.mode ?? "legacy", version: doc?.version ?? 0, catalogVersion: CATALOG_VERSION, baseline: baseline ? { takenAt: baseline.takenAt, status: baseline.status, divergences: baseline.divergences ?? [] } : null,
    modules,
  };
}

/** Pré-requisitos de configuração dos módulos habilitados (o ERP informa; a emissão em si já recusa sem configuração). */
export async function configurationReadiness(store: Store, companyId: string, doc: CompanyModulesDoc | null): Promise<Record<string, { ready: boolean; missing: string[] }>> {
  const out: Record<string, { ready: boolean; missing: string[] }> = {};
  const has = async (collection: string, filters: any[]) => (await store.list(collection, { filters: [["eq", "companyId", companyId], ...filters], limit: 1 })).items.length > 0;
  const checks: Record<string, () => Promise<boolean>> = {
    terminal: () => has("terminals", [["ne", "status", "inactive"]]),
    "fiscal.config": async () => (await listAll(store, "fiscal_configs", { filters: [["eq", "companyId", companyId]] })).some((c) => c.nfeEnabled || c.nfceEnabled),
    "fiscal.nfse": () => has("integrations", [["eq", "kind", "fiscal_nfse"]]),
    "store.published": () => has("stores", [["eq", "status", "published"]]),
  };
  for (const [k, e] of Object.entries(doc?.modules ?? {})) {
    if (e.state !== "enabled") continue;
    const def = MODULE_MAP.get(k);
    const missing: string[] = [];
    for (const p of def?.configPrereqs ?? []) if (checks[p.key] && !(await checks[p.key]())) missing.push(p.description);
    out[k] = { ready: missing.length === 0, missing };
  }
  return out;
}

export async function moduleHistory(store: Store, companyId: string, limit = 50) {
  const res = await store.list("module_changes", { filters: [["eq", "companyId", companyId]], orderBy: [{ field: "version", dir: "desc" }], limit });
  return res.items.map((c) => ({ version: c.version, at: c.at, actor: c.actor, actorType: c.actorType, reason: c.reason, operationId: c.operationId, changes: c.changes }));
}
