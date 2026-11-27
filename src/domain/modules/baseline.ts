import { detId, isConflict, listAll } from "@/lib/db";
import type { Filter, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { featureDefaultFor, getSetting } from "@/lib/core/settings";
import { companyModulesId, legacyModulesFor } from "@/lib/modules/access";
import { CATALOG_VERSION, CONTRACTABLE, MODULE_MAP } from "@/lib/modules/catalog";
import { missingDependencies } from "@/lib/modules/graph";
import { MODULES_CATALOG } from "@/lib/modules/catalog";
import type { CompanyKind, CompanyModuleEntry, CompanyModulesDoc, ControlMode } from "@/lib/modules/types";
import { BusinessError } from "@/lib/core/errors";

/**
 * Migração aditiva: LINHA DE BASE por empresa existente. Nada é removido:
 *  - habilita tudo o que o tipo de empresa já tinha (comportamento anterior) + o que estiver em uso fora do tipo;
 *  - registra o uso real (registros por módulo), a configuração dos recursos e as permissões já concedidas;
 *  - aponta as DIVERGÊNCIAS em que o direito não pode ser determinado com segurança (revisão antes de aplicar o controle);
 *  - grava o estado em modo "legacy" (o controle só passa a valer por decisão explícita: shadow → enforced).
 * Idempotente: empresa que já tem estado não é tocada.
 */

/** Evidência de uso por módulo: tabela (+ filtro) cuja existência de registros mostra que o módulo é usado. */
export const USAGE_EVIDENCE: Record<string, { collection: string; filters?: Filter[] }> = {
  "cadastros.produtos": { collection: "products" },
  "cadastros.clientes": { collection: "customers" },
  "cadastros.fornecedores": { collection: "suppliers" },
  "caixa.operacao": { collection: "cash_sessions" },
  "vendas.pdv": { collection: "sales" },
  "vendas.devolucoes": { collection: "returns" },
  "vendas.documentos": { collection: "sales_documents" },
  "vendas.comissoes": { collection: "titles", filters: [["eq", "originType", "commission"]] },
  "ecommerce.loja": { collection: "stores" },
  "ecommerce.promocoes": { collection: "store_coupons" },
  "ecommerce.banco": { collection: "store_payouts" },
  "ecommerce.canais": { collection: "store_channels" },
  "estoque.transferencias": { collection: "transfers" },
  "estoque.inventario": { collection: "inventories" },
  "estoque.lotes": { collection: "products", filters: [["eq", "lotControl", true]] },
  "compras.pedidos": { collection: "purchase_orders" },
  "compras.cotacoes": { collection: "quotations" },
  "compras.aprovacoes": { collection: "purchase_requests" },
  "compras.recebimento": { collection: "receipts" },
  "financeiro.contas_receber": { collection: "titles", filters: [["eq", "kind", "receivable"]] },
  "financeiro.contas_pagar": { collection: "titles", filters: [["eq", "kind", "payable"]] },
  "financeiro.conciliacao": { collection: "bank_imports" },
  "fiscal.nfce": { collection: "fiscal_documents", filters: [["eq", "model", "nfce"]] },
  "fiscal.nfe": { collection: "fiscal_documents", filters: [["eq", "model", "nfe"]] },
  "fiscal.nfse": { collection: "fiscal_documents", filters: [["eq", "model", "nfse"]] },
  "gestao.metas": { collection: "goals" },
  "contabil.carteira": { collection: "accounting_clients" },
  "contabil.certificados": { collection: "certificate_requests" },
};

export interface Divergence {
  module: string;
  code: "usage_outside_kind" | "feature_on_outside_kind" | "needs_confirmation_in_use" | "dependency_gap";
  message: string;
  evidence?: unknown;
}

const kindOf = (c: Record<string, any> | null): CompanyKind => (c?.kind === "accounting" || c?.kind === "certification" ? c.kind : "retail");

export interface BaselineReport {
  companyId: string;
  kind: CompanyKind;
  modules: string[];
  usage: Record<string, number>;
  features: Record<string, { on: boolean; explicit: boolean }>;
  permissions: Record<string, { roles: number; users: number }>;
  divergences: Divergence[];
}

/** Calcula a linha de base (sem gravar). */
export async function computeBaseline(store: Store, companyId: string): Promise<BaselineReport> {
  const company = await store.get("companies", companyId);
  if (!company) throw new BusinessError("Empresa não encontrada.", "company_not_found");
  const kind = kindOf(company);
  const modules = new Set(legacyModulesFor(kind));
  const usage: Record<string, number> = {};
  const divergences: Divergence[] = [];
  for (const [key, ev] of Object.entries(USAGE_EVIDENCE)) {
    const r = await store.list(ev.collection, { filters: [["eq", "companyId", companyId], ...(ev.filters ?? [])], limit: 1, total: true });
    usage[key] = r.total;
    const def = MODULE_MAP.get(key)!;
    if (r.total > 0 && !def.kinds.includes(kind)) {
      modules.add(key);
      divergences.push({ module: key, code: "usage_outside_kind", message: `${def.name} tem ${r.total} registro(s) mas não faz parte do tipo de empresa "${kind}": mantido habilitado até a revisão.`, evidence: { collection: ev.collection, count: r.total } });
    }
    if (r.total > 0 && def.availability === "needs_confirmation") divergences.push({ module: key, code: "needs_confirmation_in_use", message: `${def.name} está em uso e o recorte comercial ainda precisa de confirmação.`, evidence: { count: r.total } });
  }
  // recursos (configuração) — explícitos na empresa ou pelo padrão do tipo
  const features: Record<string, { on: boolean; explicit: boolean }> = {};
  const settings = await listAll(store, "settings", { filters: [["eq", "companyId", companyId]] });
  for (const m of CONTRACTABLE) {
    for (const f of m.surfaces.features ?? []) {
      if (features[f]) continue;
      const explicit = settings.find((x) => x.key === `feature.${f}` && !x.branchId);
      const anyBranchOn = settings.some((x) => x.key === `feature.${f}` && x.branchId && x.value === true);
      const on = Boolean(await getSetting(store, companyId, null, `feature.${f}`, featureDefaultFor(f, kind))) || anyBranchOn;
      features[f] = { on, explicit: Boolean(explicit) };
      if (on && !m.kinds.includes(kind)) {
        modules.add(m.key);
        if (m.parent) modules.add(m.parent);
        divergences.push({ module: m.key, code: "feature_on_outside_kind", message: `Recurso "${f}" ligado numa empresa do tipo "${kind}", fora do recorte do módulo ${m.name}: mantido habilitado até a revisão.` });
      }
    }
  }
  // permissões concedidas (evidência; a habilitação não altera perfis)
  const roles = await listAll(store, "roles", { filters: [["eq", "companyId", companyId]] });
  const users = await listAll(store, "users", {});
  const permissions: Record<string, { roles: number; users: number }> = {};
  for (const m of CONTRACTABLE) {
    const perms = m.surfaces.permissions ?? [];
    if (!perms.length) continue;
    const rs = roles.filter((r) => (r.actions ?? []).some((a: string) => perms.includes(a)));
    const ids = new Set(rs.map((r) => r.id));
    permissions[m.key] = { roles: rs.length, users: users.filter((u) => (u.companyIds ?? []).includes(companyId) && ids.has(u.roleByCompany?.[companyId])).length };
  }
  // conjunto precisa ser consistente; se o legado tiver um módulo sem a dependência, registra (não remove nada)
  for (const miss of missingDependencies(MODULES_CATALOG, modules)) {
    for (const r of miss.missing) modules.add(r);
    divergences.push({ module: miss.module, code: "dependency_gap", message: `${MODULE_MAP.get(miss.module)?.name} exige ${miss.missing.map((k) => MODULE_MAP.get(k)?.name ?? k).join(", ")}${miss.anyOf ? " (ou um do grupo)" : ""}: dependência acrescentada na linha de base.`, evidence: miss });
  }
  return { companyId, kind, modules: [...modules].sort(), usage, features, permissions, divergences };
}

/** Grava a linha de base e o estado inicial (modo legacy). Idempotente. */
export async function takeBaseline(store: Store, companyId: string, actor = "migração"): Promise<{ created: boolean; report?: BaselineReport }> {
  if (await store.get("company_modules", companyModulesId(companyId))) return { created: false };
  const report = await computeBaseline(store, companyId);
  const now = nowIso();
  const modules: Record<string, CompanyModuleEntry> = Object.fromEntries(report.modules.map((k) => [k, { state: "enabled", since: now, source: "baseline", enabledAt: now, config: null } as CompanyModuleEntry]));
  return writeInitialState(store, companyId, modules, "legacy", { actor, actorType: "migration", reason: `Linha de base da migração (catálogo ${CATALOG_VERSION}): comportamento anterior preservado.` }, report);
}

/**
 * Provisionamento de empresa NOVA: recebe só os módulos selecionados e já nasce com o controle aplicado.
 * Sem seleção, recebe o conjunto padrão do tipo (equivalente ao legado) em modo enforced.
 */
export async function provisionModules(store: Store, companyId: string, selected: string[] | null, actor: string, mode: ControlMode = "enforced") {
  const company = await store.get("companies", companyId);
  const keys = validateSelection(kindOf(company), selected);
  const now = nowIso();
  const modules: Record<string, CompanyModuleEntry> = Object.fromEntries([...keys].map((k) => [k, { state: "enabled", since: now, source: "provisioning", enabledAt: now, config: null } as CompanyModuleEntry]));
  return writeInitialState(store, companyId, modules, mode, { actor, actorType: "provisioning", reason: "Módulos selecionados no provisionamento da empresa." }, null);
}

/** Confere a seleção do provisionamento (existência, tipo de empresa e dependências) — antes de criar a empresa. */
export function validateSelection(kind: CompanyKind, selected: string[] | null): Set<string> {
  const keys = new Set(selected ?? legacyModulesFor(kind));
  for (const k of keys) {
    const d = MODULE_MAP.get(k);
    if (!d || d.availability === "planned" || (d.classification !== "commercial" && d.classification !== "optional_function")) throw new BusinessError(`Módulo inválido para provisionamento: ${k}.`, "unknown_module");
    if (!d.kinds.includes(kind)) throw new BusinessError(`${d.name} não se aplica a empresas do tipo "${kind}".`, "kind_not_supported");
  }
  const miss = missingDependencies(MODULES_CATALOG, keys);
  if (miss.length) throw new BusinessError(`Dependências ausentes no provisionamento: ${miss.map((m) => `${MODULE_MAP.get(m.module)?.name ?? m.module} exige ${[...m.missing.map((x) => MODULE_MAP.get(x)?.name ?? x), ...(m.anyOf ?? []).map((g) => g.join(" ou "))].join(", ")}`).join("; ")}.`, "dependency_missing", miss);
  return keys;
}

async function writeInitialState(store: Store, companyId: string, modules: Record<string, CompanyModuleEntry>, mode: ControlMode, who: { actor: string; actorType: string; reason: string }, report: BaselineReport | null) {
  const now = nowIso();
  const doc: CompanyModulesDoc = { companyId, mode, version: 1, modules, baselineAt: report ? now : null, updatedBy: `${who.actorType}:${who.actor}` };
  try {
    await store.transaction(async (tx) => {
      await tx.create("company_modules", doc as any, companyModulesId(companyId));
      await tx.create("module_changes", { companyId, version: 1, operationId: null, actor: who.actor, actorType: who.actorType, reason: who.reason, changes: { initial: Object.keys(modules) }, before: null, after: { mode, modules }, at: now }, detId("modchg", companyId, 1));
      if (report) {
        await tx.create("module_baselines", { companyId, takenAt: now, kind: report.kind, modules: report.modules, usage: { counts: report.usage, features: report.features, permissions: report.permissions }, divergences: report.divergences, status: report.divergences.length ? "pending_review" : "clean" }, detId("modbase", companyId));
      }
    });
  } catch (e) {
    if (isConflict(e)) return { created: false };
    throw e;
  }
  return { created: true, report: report ?? undefined };
}

/** Linha de base de todas as empresas sem estado (migração em lote; repetível). */
export async function baselineAllCompanies(store: Store) {
  const companies = await listAll(store, "companies");
  const out: { companyId: string; name: string; created: boolean; divergences: number }[] = [];
  for (const c of companies) {
    const r = await takeBaseline(store, c.id);
    out.push({ companyId: c.id, name: c.tradeName || c.name, created: r.created, divergences: r.report?.divergences.length ?? 0 });
  }
  return out;
}

/** Diferença entre o que a linha de base registrou e o que o estado vigente concede (monitoramento pós-migração). */
export async function baselineDrift(store: Store, companyId: string) {
  const base = await store.get("module_baselines", detId("modbase", companyId));
  const cur = await store.get("company_modules", companyModulesId(companyId));
  if (!base || !cur) return null;
  const now = new Set(Object.entries(cur.modules ?? {}).filter(([, e]: any) => e.state === "enabled" || e.state === "scheduled_off").map(([k]) => k));
  const before = new Set<string>(base.modules ?? []);
  return { removed: [...before].filter((k) => !now.has(k)), added: [...now].filter((k) => !before.has(k)), mode: cur.mode };
}
