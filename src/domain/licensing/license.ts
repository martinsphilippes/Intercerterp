import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { BusinessError } from "@/lib/core/errors";
import { loadCompanyModules } from "@/lib/modules/access";
import { MODULE_MAP } from "@/lib/modules/catalog";
import { applyChanges, companyOrThrow, simulateChanges, VersionConflictError, type ModuleChange, type Simulation } from "../modules/changes";
import { takeBaseline } from "../modules/baseline";
import { desiredByUnit, licenseSnapshotSchema, resolveCode, resolveDisplays, unitByCode, type DisplayMode, type ItemIssue, type LicenseSnapshot } from "./effective";
import { emitInterosEvent } from "./events";
import { UNITS_V2 } from "@/lib/modules/units-v2.generated";

/**
 * Aplicação do retrato de licença (Interos v2) sobre o runtime de habilitação (company_modules).
 *  - versão monotônica: retrato com versão ≤ aplicada é ignorado (repetição ou fora de ordem) e devolve a vigente;
 *  - trava por empresa: dois retratos da mesma empresa nunca se aplicam ao mesmo tempo;
 *  - homologação: unidade não vendável (integração externa pendente) não é ligada para quem não tinha; quem já tinha mantém;
 *  - o lote resultante passa pelas mesmas regras de dependência e desligamento do runtime (applyChanges).
 */

export const licenseId = (companyId: string) => detId("license", companyId);
export type LicenseSource = "push" | "pull" | "local";

export interface LicensePlan {
  companyId: string;
  licenseVersion: number;
  appliedVersion: number;
  stale: boolean;
  changes: ModuleChange[];
  rejectedItems: ItemIssue[];
  warnings: ItemIssue[];
  /** Por chave v1; `display` = como a unidade aparece quando desligada (a escolha dela ou o padrão da empresa). */
  effective: Record<string, { unit: string; on: boolean; state: string; notice?: string; display?: DisplayMode }>;
  companyState: string;
  companyNotice?: string;
  nextTransitionAt: string | null;
  simulation: Omit<Simulation, "entries"> | null;
  valid: boolean;
  /**
   * Unidades ainda não vendáveis que a empresa JÁ TINHA (chaves v1): continuam dela. O teto da empresa (suspensa,
   * somente leitura, vigência vencida) desliga também essas unidades, e elas voltam quando o teto sai. Só um item
   * `inactive` explícito encerra o direito.
   */
  preservedAccess: string[];
  /** modo de controle que será aplicado (null = mantém o atual; o pedido pode ter ficado pendente de revisão) */
  controlMode: "legacy" | "shadow" | "enforced" | null;
}

export function parseSnapshot(body: unknown, companyId: string): LicenseSnapshot {
  const r = licenseSnapshotSchema.safeParse(body);
  if (!r.success) throw new BusinessError(`Retrato de licença inválido: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, "invalid_request", r.error.issues.slice(0, 20));
  if (r.data.companyId !== companyId) throw new BusinessError("companyId do retrato difere da rota.", "invalid_request");
  return r.data;
}

/** Planeja a aplicação (nada é gravado). */
export async function planLicense(store: Store, companyId: string, snapshot: LicenseSnapshot, now = new Date()): Promise<LicensePlan> {
  await companyOrThrow(store, companyId);
  const lic = await store.get("company_licenses", licenseId(companyId));
  const appliedVersion = lic?.licenseVersion ?? 0;
  const doc = await loadCompanyModules(store, companyId);
  const { desired, issues, nextAt, cap } = desiredByUnit(snapshot, now);
  const rejectedItems: ItemIssue[] = issues.filter((i) => i.reason === "unknown_code" || i.reason === "not_contractable");
  const warnings: ItemIssue[] = issues.filter((i) => !rejectedItems.includes(i));
  const changes: ModuleChange[] = [];
  const effective: LicensePlan["effective"] = {};
  const isOn = (k: string) => ["enabled", "scheduled_off"].includes(doc?.modules?.[k]?.state ?? "");
  // filiais autorizadas (correção 11): aplicadas na sessão (fora da lista = só consulta); aqui só a conferência
  if (snapshot.branches?.mode === "list") {
    const own = new Set((await listAll(store, "branches", { filters: [["eq", "companyId", companyId]] })).map((b) => b.id));
    const unknown = (snapshot.branches.branchIds ?? []).filter((b) => !own.has(b));
    if (unknown.length) warnings.push({ code: "-", reason: "unknown_branch", message: `Filial(is) que não existe(m) nesta empresa: ${unknown.join(", ")} (ignorada(s)).` });
    if (!(snapshot.branches.branchIds ?? []).some((b) => own.has(b))) warnings.push({ code: "-", reason: "no_branch_allowed", message: "Nenhuma filial da empresa está autorizada: todas ficam só em consulta." });
  }
  // direito preservado (unidade não vendável que a empresa já tinha): o que estava registrado + o que está ligado agora
  const preserved = new Set<string>((lic?.preservedAccess as string[] | undefined) ?? []);
  const notSellable = (key: string) => UNITS_V2.find((x) => x.v1Key === key)?.sellable === false;
  for (const [key, entry] of Object.entries(doc?.modules ?? {})) if (["enabled", "scheduled_off"].includes(entry.state) && notSellable(key)) preserved.add(key);
  // só um item "inactive" explícito encerra o direito (fim do contrato daquela unidade)
  for (const it of snapshot.items) if (it.state === "inactive") for (const u of resolveCodeUnits(it.code)) { const k = unitByCode(u)?.v1Key; if (k) preserved.delete(k); }
  // unidades licenciadas
  for (const [code, eff] of desired) {
    const unit = unitByCode(code)!;
    const key = unit.v1Key;
    if (!key || !MODULE_MAP.has(key)) continue;
    effective[key] = { unit: code, on: eff.on, state: eff.state, notice: eff.notice };
    // ativação agendada de uma unidade JÁ ligada: continua ligada até a data — agendar nunca desliga (correção 8)
    if (!eff.on && eff.state === "activation_scheduled" && isOn(key)) {
      effective[key] = { unit: code, on: true, state: "active", notice: "Ativação agendada de uma unidade já ligada: continua ligada (a data não desliga nada)." };
      continue;
    }
    if (eff.on && !isOn(key)) {
      if (!unit.sellable && !preserved.has(key)) {
        // decisão do titular: dependente de integração externa só é liberada depois da homologação
        rejectedItems.push({ code, reason: "not_homologated", message: `${unit.name}: ainda depende de homologação da integração externa (${unit.devStatus}); não pode ser ativado para esta empresa.` });
        effective[key] = { ...effective[key], on: false };
        continue;
      }
      if (!unit.sellable) warnings.push({ code, reason: "preserved_access", message: `${unit.name}: acesso que a empresa já tinha, restabelecido.` });
      changes.push({ module: key, action: "enable", ...(eff.config ? { config: eff.config } : {}) });
    } else if (eff.on && isOn(key) && !unit.sellable) {
      warnings.push({ code, reason: "preserved_access", message: `${unit.name}: acesso existente preservado (unidade ainda não homologada para venda nova).` });
    } else if (!eff.on && isOn(key)) changes.push({ module: key, action: "disable", history: eff.history });
  }
  // unidades ligadas no ERP que o retrato não inclui: não contratadas
  for (const [key, entry] of Object.entries(doc?.modules ?? {})) {
    if (effective[key] || !["enabled", "scheduled_off"].includes(entry.state)) continue;
    const def = MODULE_MAP.get(key);
    if (!def || (def.classification !== "commercial" && def.classification !== "optional_function")) continue;
    // unidade ainda não homologada para venda: o Interos não a lista; quem já tem mantém (decisão do titular)
    const u = UNIT_CODE_BY_KEY.get(key);
    if (u && preserved.has(key)) {
      if (!cap.allowOn) {
        // o teto da empresa vale para TODAS as unidades, inclusive as preservadas (correção 2): empresa suspensa,
        // somente leitura ou com a vigência vencida não emite NF-e, NFC-e, NFS-e nem usa o banco ou os canais.
        // O direito continua registrado e a unidade volta quando o teto sair.
        effective[key] = { unit: u, on: false, state: cap.state, notice: cap.notice ?? "Empresa sem operação liberada pelo contrato: acesso preservado volta com a reativação." };
        changes.push({ module: key, action: "disable", history: "read" });
        continue;
      }
      effective[key] = { unit: u, on: true, state: "active", notice: "Acesso preservado (unidade aguardando homologação para venda)." };
      warnings.push({ code: u, reason: "preserved_access", message: `${def.name}: acesso existente preservado; a unidade ainda não é vendável e só desliga com o teto da empresa ou inativação explícita.` });
      continue;
    }
    effective[key] = { unit: unitByV1KeyCode(key), on: false, state: "inactive" };
    changes.push({ module: key, action: "disable", history: "read" });
  }
  // direito preservado desligado pelo teto: volta quando a empresa sai da suspensão, do somente leitura ou da vigência
  // vencida — desde que as dependências dele estejam ligadas (ou sendo ligadas) no mesmo lote
  const willBeOn = (k: string) => effective[k] ? effective[k].on : isOn(k) && !changes.some((c) => c.module === k && c.action === "disable");
  const depsOk = (k: string) => {
    const def = MODULE_MAP.get(k) as any;
    return (def?.requires ?? []).every(willBeOn) && (def?.requiresAny ?? []).every((group: string[]) => group.some(willBeOn));
  };
  if (cap.allowOn) {
    for (const key of preserved) {
      if (effective[key] || isOn(key) || !MODULE_MAP.has(key)) continue;
      if (!depsOk(key)) {
        // a dependência saiu do contrato: o direito preservado acaba junto (como no desligamento em cascata)
        preserved.delete(key);
        continue;
      }
      const u = unitByV1KeyCode(key);
      effective[key] = { unit: u, on: true, state: "active", notice: "Acesso preservado restabelecido." };
      warnings.push({ code: u, reason: "preserved_access", message: `${MODULE_MAP.get(key)!.name}: acesso que a empresa já tinha, restabelecido com a reativação.` });
      changes.push({ module: key, action: "enable" });
    }
  }
  let simulation: LicensePlan["simulation"] = null;
  let mode = snapshot.controlMode ?? undefined;
  // passar a "enforced" com divergência aberta exige revisão REAL (pessoa nomeada em baselineReview) — o modo sozinho
  // nunca marca as divergências como revisadas (correção 9). Sem revisão: as unidades valem, o controle fica como está.
  const reviewed = Boolean(snapshot.baselineReview?.reviewedBy);
  if (doc && mode === "enforced" && doc.mode !== "enforced" && !reviewed) {
    const baseline = await store.get("module_baselines", detId("modbase", companyId));
    const open = ((baseline?.divergences as unknown[] | undefined) ?? []).length;
    if (open && baseline?.status !== "reviewed") {
      warnings.push({ code: "-", reason: "review_required", message: `Controle "enforced" não aplicado: há ${open} divergência(s) da linha de base sem revisão. Envie baselineReview (quem revisou) junto com controlMode "enforced" depois de revisá-las.` });
      mode = undefined;
    }
  }
  if (doc && (changes.length || (mode && mode !== doc.mode))) {
    // cascata: o que não foi listado (ou foi preservado) acompanha a dependência desligada; o que o Interos listou
    // como ativo e ficaria sem dependência recusa o retrato (consistência explícita)
    const { entries: _e, ...sim } = await simulateChanges(store, { companyId, changes, mode, cascade: true, reviewDivergences: reviewed }, doc);
    void _e;
    simulation = sim;
    for (const e of sim.errors) rejectedItems.push({ code: e.module ? unitByV1KeyCode(e.module) : "-", reason: e.code === "kind_not_supported" ? "kind_not_supported" : "dependency_missing", message: e.message });
    for (const imp of sim.impacts.filter((i) => i.cascadedFrom)) {
      const explicit = [...desired.entries()].some(([u, eff]) => eff.on && unitByCode(u)?.v1Key === imp.module);
      if (explicit) rejectedItems.push({ code: unitByV1KeyCode(imp.module), reason: "dependency_missing", message: `${imp.name} foi licenciado como ativo, mas depende de ${MODULE_MAP.get(imp.cascadedFrom!)?.name ?? imp.cascadedFrom}, que o retrato desliga.` });
      else {
        // desligado em cascata porque a dependência saiu do contrato: o direito preservado (se havia) acaba junto
        if (cap.allowOn) preserved.delete(imp.module);
        effective[imp.module] = { unit: unitByV1KeyCode(imp.module), on: false, state: "inactive", notice: `Desligado junto com ${MODULE_MAP.get(imp.cascadedFrom!)?.name ?? imp.cascadedFrom}.` };
        warnings.push({ code: unitByV1KeyCode(imp.module), reason: "preserved_access", message: `${imp.name} desligado em cascata com ${imp.cascadedFrom}.` });
      }
    }
  }
  // exibição por unidade (fase A): a escolha da unidade ou o padrão da empresa; não liga nem desliga nada
  const displays = resolveDisplays(withCurrentDisplays(snapshot, lic).displays);
  rejectedItems.push(...displays.rejected);
  warnings.push(...displays.warnings);
  const fallback = defaultDisplayOf(snapshot.display ?? lic?.display ?? null, doc);
  for (const [key, entry] of Object.entries(effective)) entry.display = displays.byKey.get(key) ?? fallback;
  return {
    companyId, licenseVersion: snapshot.licenseVersion, appliedVersion, stale: snapshot.licenseVersion <= appliedVersion, changes, rejectedItems, warnings, effective,
    companyState: cap.state, companyNotice: cap.notice, nextTransitionAt: nextAt, simulation,
    valid: !rejectedItems.some((r) => r.reason === "dependency_missing" || r.reason === "kind_not_supported"),
    preservedAccess: [...preserved].sort(),
    controlMode: mode ?? null,
  };
}

/** Unidades comerciais de um código do retrato (alias, incluído e módulo resolvidos). */
function resolveCodeUnits(code: string): string[] {
  return resolveCode(code).units;
}

const UNIT_CODE_BY_KEY = new Map(UNITS_V2.filter((u) => u.v1Key).map((u) => [u.v1Key!, u.code]));
const unitByV1KeyCode = (key: string) => UNIT_CODE_BY_KEY.get(key) ?? key;
/** Mudança com o código comercial v2 (`code`, a referência do contrato) e a chave interna (`module`). */
const changeWithCode = (c: ModuleChange) => ({ code: UNIT_CODE_BY_KEY.get(c.module) ?? null, module: c.module, action: c.action, ...(c.history ? { history: c.history } : {}) });

// ─── trava por empresa (incremento atômico com limite) ─────────────────────────────────────────────────────────────
const LOCK_STALE_MS = 2 * 60 * 1000;
async function ensureLicenseDoc(store: Store, companyId: string): Promise<Doc> {
  const id = licenseId(companyId);
  const ex = await store.get("company_licenses", id);
  if (ex) return ex;
  try {
    return await store.create("company_licenses", { companyId, licenseVersion: 0, display: null, lock: 0 }, id);
  } catch (e) {
    if (isConflict(e)) return (await store.get("company_licenses", id))!;
    throw e;
  }
}
async function withLicenseLock<R>(store: Store, companyId: string, fn: () => Promise<R>): Promise<R> {
  const doc = await ensureLicenseDoc(store, companyId);
  if ((doc.lock ?? 0) >= 1 && doc.lockedAt && Date.now() - Date.parse(doc.lockedAt) > LOCK_STALE_MS) await store.update("company_licenses", doc.id, { lock: 0 });
  try {
    await store.increment("company_licenses", doc.id, "lock", 1, { max: 1 });
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Outra aplicação de licença desta empresa está em andamento. Tente novamente em instantes.", "license_busy");
    throw e;
  }
  await store.update("company_licenses", doc.id, { lockedAt: nowIso() });
  try {
    return await fn();
  } finally {
    await store.update("company_licenses", doc.id, { lock: 0, lockedAt: null }).catch(() => undefined);
  }
}

export interface ApplyLicenseResult {
  status: "applied" | "rejected" | "stale" | "duplicate";
  appliedVersion: number;
  plan: LicensePlan | null;
  runtimeVersion: number | null;
}

/** Aplica um retrato (push do Interos ou pull da reconciliação). Idempotente por (empresa, versão). */
export async function applyLicense(store: Store, companyId: string, raw: unknown, meta: { clientId: string; eventId?: string | null; source: LicenseSource; actor?: string }): Promise<ApplyLicenseResult> {
  const snapshot = parseSnapshot(raw, companyId);
  const histId = detId("lichist", companyId, snapshot.licenseVersion);
  const prior = await store.get("license_history", histId);
  if (prior) {
    // retrato repetido também confirma que o Interos e o ERP estão de acordo (base do sync.stale)
    await noteConfirmation(store, companyId);
    return { ...(prior.result as ApplyLicenseResult), status: prior.status === "applied" ? "duplicate" : prior.status };
  }
  return withLicenseLock(store, companyId, async () => {
    const lic = await store.get("company_licenses", licenseId(companyId));
    const applied = lic?.licenseVersion ?? 0;
    if (snapshot.licenseVersion <= applied) {
      const result: ApplyLicenseResult = { status: "stale", appliedVersion: applied, plan: null, runtimeVersion: null };
      await recordHistory(store, histId, companyId, snapshot, "stale", meta, result);
      await noteConfirmation(store, companyId);
      return result;
    }
    if (!(await loadCompanyModules(store, companyId))) await takeBaseline(store, companyId, "licença");
    // retrato sem `displays` (Interos sem a fase A, ou de volta a uma versão anterior) mantém as escolhas por unidade
    const full = withCurrentDisplays(snapshot, lic);
    let plan: LicensePlan | null = null;
    let runtimeVersion: number | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      plan = await planLicense(store, companyId, full);
      if (!plan.valid) {
        const result: ApplyLicenseResult = { status: "rejected", appliedVersion: applied, plan, runtimeVersion: null };
        await recordHistory(store, histId, companyId, full, "rejected", meta, result);
        await emitInterosEvent(store, companyId, "license.rejected", { licenseVersion: snapshot.licenseVersion, rejectedItems: plan.rejectedItems });
        return result;
      }
      const doc = await loadCompanyModules(store, companyId);
      const mode = plan.controlMode ?? undefined;
      if (!plan.changes.length && (!mode || mode === doc?.mode)) {
        runtimeVersion = doc?.version ?? null;
        break;
      }
      const review = snapshot.baselineReview?.reviewedBy ? { name: snapshot.baselineReview.reviewedBy, notes: snapshot.baselineReview.notes ?? null } : null;
      try {
        const r = await applyChanges(store, { companyId, changes: plan.changes, mode, cascade: true, reviewDivergences: Boolean(review) }, {
          actor: meta.actor ?? meta.clientId, actorType: "interos", reason: `Licença v${snapshot.licenseVersion} (${meta.source})`, operationId: histId, expectedVersion: doc?.version ?? null, reviewer: review,
        });
        runtimeVersion = r.version;
        break;
      } catch (e) {
        if (e instanceof VersionConflictError && attempt < 2) continue;
        throw e;
      }
    }
    await store.update("company_licenses", licenseId(companyId), {
      licenseVersion: snapshot.licenseVersion, snapshot: full, commercialStatus: snapshot.commercialStatus, display: snapshot.display ?? lic?.display ?? null,
      limits: snapshot.limits ?? null, effective: plan!.effective, rejectedItems: plan!.rejectedItems, warnings: plan!.warnings, appliedAt: nowIso(), preservedAccess: plan!.preservedAccess,
      appliedRuntimeVersion: runtimeVersion, nextTransitionAt: plan!.nextTransitionAt, clientId: meta.clientId, lastSnapshotAt: nowIso(), lastConfirmedAt: nowIso(), staleNotifiedAt: null,
    });
    // contrato amplo (provisionamento) passa a ser a tradução da licença: menu, telas, recursos e Torre seguem o retrato
    await syncContractFromLicense(store, companyId, meta.clientId);
    const result: ApplyLicenseResult = { status: "applied", appliedVersion: snapshot.licenseVersion, plan, runtimeVersion };
    await recordHistory(store, histId, companyId, full, "applied", meta, result);
    await emitInterosEvent(store, companyId, "license.applied", { licenseVersion: snapshot.licenseVersion, runtimeVersion, rejectedItems: plan!.rejectedItems, warnings: plan!.warnings.map((w) => w.reason) });
    return result;
  });
}

/**
 * Confirmação do Interos (retrato recebido, consulta do Interos ou pull bem-sucedido): é dela que o sync.stale conta,
 * não da última licença NOVA — o Interos só manda licença quando algo muda. Grava no máximo uma vez por hora.
 */
export async function noteConfirmation(store: Store, companyId: string, now = new Date()) {
  const id = licenseId(companyId);
  const lic = await store.get("company_licenses", id).catch(() => null);
  if (!lic) return;
  if (lic.lastConfirmedAt && now.getTime() - Date.parse(lic.lastConfirmedAt) < 3600_000) return;
  await store.update("company_licenses", id, { lastConfirmedAt: now.toISOString(), staleNotifiedAt: null }).catch(() => undefined);
}

/**
 * Uma referência só (pendência 4): com licença v2, o contrato amplo da empresa (`company.contract`, que restringe
 * perfis e recursos) é DERIVADO dos itens licenciados — módulo amplo contratado = alguma unidade dele licenciada (em
 * qualquer estado, menos inactive) ou com direito preservado. Suspenso continua contratado: a consulta do histórico
 * fica; quem bloqueia a operação é a habilitação dos módulos.
 */
async function syncContractFromLicense(store: Store, companyId: string, clientId: string) {
  const company = await store.get("companies", companyId);
  if (!company) return;
  const { contractedAreas } = await import("../tenancy/contracted");
  const { CONTRACT_MODULES } = await import("../tenancy/contract");
  const { setSetting } = await import("@/lib/core/settings");
  const areas = await contractedAreas(store, company);
  if (!areas) return;
  const modules = [...areas].sort();
  const prev = company.contract && Array.isArray(company.contract.modules) ? company.contract : null;
  if (prev && prev.source === "licenca" && JSON.stringify(prev.modules) === JSON.stringify(modules)) return;
  await store.update("companies", companyId, { contract: { ...(prev ?? {}), modules, source: "licenca", updatedAt: nowIso(), updatedBy: `interos:${clientId}` } });
  // recursos governados pelo contrato (ex.: comércio digital) acompanham
  for (const m of CONTRACT_MODULES) for (const f of m.features) await setSetting(store, companyId, null, `feature.${f}`, modules.includes(m.key), `interos:${clientId}`);
}

async function recordHistory(store: Store, id: string, companyId: string, snapshot: LicenseSnapshot, status: string, meta: { clientId: string; eventId?: string | null; source: LicenseSource }, result: ApplyLicenseResult) {
  try {
    await store.create("license_history", { companyId, licenseVersion: snapshot.licenseVersion, status, source: meta.source, clientId: meta.clientId, eventId: meta.eventId ?? null, snapshot, result: JSON.parse(JSON.stringify(result)), at: nowIso() }, id);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
}

/**
 * Manutenção local (rotina diária e sob demanda): reaplica o retrato vigente no instante atual — fim de teste e
 * carência, agendamentos de ativação/suspensão e fim de vigência acontecem sem depender do Interos.
 */
export async function maintainLicense(store: Store, companyId: string, now = new Date()) {
  const first = await store.get("company_licenses", licenseId(companyId));
  if (!first?.snapshot || !(first.licenseVersion > 0)) return { skipped: "no_license" };
  return withLicenseLock(store, companyId, async () => {
    // relido DENTRO da trava: um retrato novo aplicado entre a leitura e a trava não pode ser desfeito pelo antigo
    const lic = await store.get("company_licenses", licenseId(companyId));
    if (!lic?.snapshot || !(lic.licenseVersion > 0)) return { skipped: "no_license" };
    const snapshot = lic.snapshot as LicenseSnapshot;
    const plan = await planLicense(store, companyId, { ...snapshot, controlMode: null }, now);
    let runtimeVersion: number | null = null;
    if (plan.changes.length) {
      // transição local: desligar uma unidade leva junto os dependentes (cascata), registrada como "system"
      const r = await applyChanges(store, { companyId, changes: plan.changes, cascade: true }, { actor: "rotina de licença", actorType: "system", reason: `Transição local da licença v${snapshot.licenseVersion} (${plan.companyState})` });
      runtimeVersion = r.version;
      // cada mudança com o código comercial da unidade (07.01) além da chave interna (vendas.pdv)
      await emitInterosEvent(store, companyId, "license.transition", { licenseVersion: snapshot.licenseVersion, changes: plan.changes.map(changeWithCode), companyState: plan.companyState });
    }
    // transição local registrada no histórico da licença (o Interos acompanha pelo GET .../license/history)
    const transitions = plan.changes.length
      ? [...(((lic.transitions as unknown[]) ?? []) as unknown[]), { at: now.toISOString(), licenseVersion: snapshot.licenseVersion, companyState: plan.companyState, changes: plan.changes.map(changeWithCode), runtimeVersion }].slice(-100)
      : undefined;
    await store.update("company_licenses", lic.id, { effective: plan.effective, nextTransitionAt: plan.nextTransitionAt, preservedAccess: plan.preservedAccess, ...(transitions ? { transitions } : {}), ...(runtimeVersion ? { appliedRuntimeVersion: runtimeVersion } : {}) });
    return { changes: plan.changes.length, companyState: plan.companyState, nextTransitionAt: plan.nextTransitionAt };
  });
}

/**
 * `displays` AUSENTE no retrato mantém as escolhas por unidade vigentes (Interos sem a fase A, ou de volta a uma versão
 * anterior, não apaga o que foi escolhido); `[]` ou null limpa. O padrão da empresa (`display`) já segue a mesma regra.
 */
function withCurrentDisplays(snapshot: LicenseSnapshot, lic: Doc | null | undefined): LicenseSnapshot {
  const prev = (lic?.snapshot as LicenseSnapshot | undefined)?.displays;
  return snapshot.displays === undefined && prev?.length ? { ...snapshot, displays: prev } : snapshot;
}

/** Unidade que pode aparecer com cadeado ou "contratar": contratável, disponível e do tipo da empresa. */
export function contractableFor(kind: string): (moduleKey: string) => boolean {
  return (moduleKey) => {
    const d = MODULE_MAP.get(moduleKey);
    return Boolean(d && d.availability !== "planned" && (d.kinds as readonly string[]).includes(kind) && (d.classification === "commercial" || d.classification === "optional_function"));
  };
}

/** Padrão sem escolha do Interos: oculto para clientes atuais; oportunidade para empresa criada pelo provisionamento. */
function defaultDisplayOf(chosen: string | null | undefined, doc: Awaited<ReturnType<typeof loadCompanyModules>>): DisplayMode {
  if (chosen) return chosen as DisplayMode;
  return doc && Object.values(doc.modules ?? {}).some((e) => e.source === "provisioning") ? "upsell" : "hidden";
}

/** Modo de exibição PADRÃO da empresa para o que está desligado (vale para a unidade sem escolha própria). */
export async function displayMode(store: Store, companyId: string): Promise<DisplayMode> {
  const lic = await store.get("company_licenses", licenseId(companyId));
  if (lic?.display) return lic.display as DisplayMode;
  return defaultDisplayOf(null, await loadCompanyModules(store, companyId));
}

/**
 * Exibição de cada unidade desligada (fase A): a escolhida para ela no retrato vigente (`displays`) ou o padrão da
 * empresa. Uma leitura só; o resultado responde por chave v1 (menu, página "módulo indisponível", pedido de contratação).
 */
export async function displayResolver(store: Store, companyId: string): Promise<(moduleKey: string) => DisplayMode> {
  const lic = await store.get("company_licenses", licenseId(companyId));
  const fallback = lic?.display ? (lic.display as DisplayMode) : defaultDisplayOf(null, await loadCompanyModules(store, companyId));
  const { byKey } = resolveDisplays((lic?.snapshot as LicenseSnapshot | undefined)?.displays);
  return (moduleKey) => byKey.get(moduleKey) ?? fallback;
}

export async function licenseStatus(store: Store, companyId: string) {
  const company = await companyOrThrow(store, companyId);
  const lic = await store.get("company_licenses", licenseId(companyId));
  const doc = await loadCompanyModules(store, companyId);
  // escolhas por unidade aplicadas (código comercial → exibição), como o Interos enviou depois de resolvidas
  const { byKey } = resolveDisplays((lic?.snapshot as LicenseSnapshot | undefined)?.displays);
  const displays = UNITS_V2.filter((u) => u.v1Key && byKey.has(u.v1Key)).map((u) => ({ code: u.code, display: byKey.get(u.v1Key!)! }));
  return {
    companyId, companyName: company.tradeName || company.name, appliedVersion: lic?.licenseVersion ?? 0, commercialStatus: lic?.commercialStatus ?? null,
    display: lic?.display ? (lic.display as DisplayMode) : defaultDisplayOf(null, doc), displays, limits: lic?.limits ?? null, effective: lic?.effective ?? null, rejectedItems: lic?.rejectedItems ?? [],
    warnings: lic?.warnings ?? [], appliedAt: lic?.appliedAt ?? null, nextTransitionAt: lic?.nextTransitionAt ?? null,
    runtime: { mode: doc?.mode ?? "legacy", version: doc?.version ?? 0 },
    sync: { lastSnapshotAt: lic?.lastSnapshotAt ?? null, lastSyncAt: lic?.lastSyncAt ?? null, lastSyncResult: lic?.lastSyncResult ?? null },
  };
}
