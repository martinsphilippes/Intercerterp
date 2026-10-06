import { detId, isConflict, listAll } from "../db";
import type { Doc, Store } from "../db/types";
import { unscoped } from "../db/scoped-store";
import { ROLE_TEMPLATES, SPECIAL_ACTIONS } from "../permissions";
import { sanitize } from "../core/audit";
import { nowIso } from "../dates";

/**
 * Sincronização dos perfis de SISTEMA com os modelos padrão (DEFAULT_ROLES).
 *
 * Quando o modelo de um perfil de sistema passa a ter uma operação nova, os perfis já gravados (demonstração e
 * instalações existentes) a recebem — sem remover nada do que o administrador configurou. Cada perfil guarda as
 * operações do modelo já aplicadas (`templateActions`): só o que é novo no modelo desde a última sincronização é
 * acrescentado, então uma operação que o administrador retirou depois não volta. Idempotente e auditada.
 */

/**
 * Operações acrescentadas aos modelos depois da primeira versão. Perfis ainda sem registro do modelo aplicado
 * recebem só estas (as demais operações do modelo já existiam quando o perfil foi criado; se faltam, foi o
 * administrador quem as retirou).
 */
export const ACTIONS_ADDED_TO_TEMPLATES: string[] = ["customer.credit_limit"];

const ORDER = SPECIAL_ACTIONS.map((a) => a.key as string);
const rank = (a: string) => (ORDER.indexOf(a) === -1 ? ORDER.length : ORDER.indexOf(a));

/** O que falta aplicar ao perfil (null = nada a fazer). */
export function templateSyncPlan(role: Record<string, any> | null | undefined): { missing: string[]; templateActions: string[] } | null {
  if (!role?.system || !role.key) return null;
  const tpl = ROLE_TEMPLATES.find((t) => t.key === role.key);
  if (!tpl) return null;
  const tplActions = [...tpl.actions] as string[];
  // sem registro (campo ausente, nulo ou lista vazia — colunas de lista podem voltar vazias): perfil anterior à sincronização
  const applied: string[] | null = Array.isArray(role.templateActions) && role.templateActions.length ? role.templateActions : null;
  if (applied && applied.length === tplActions.length && tplActions.every((a) => applied.includes(a))) return null;
  const candidates = applied ? tplActions.filter((a) => !applied.includes(a)) : tplActions.filter((a) => ACTIONS_ADDED_TO_TEMPLATES.includes(a));
  const have = new Set<string>(role.actions ?? []);
  return { missing: candidates.filter((a) => !have.has(a)), templateActions: tplActions };
}

/** Aplica ao perfil as operações novas do modelo (se houver) e registra o modelo aplicado. */
export async function syncRoleTemplate(store: Store, role: Doc): Promise<Doc> {
  const plan = templateSyncPlan(role);
  if (!plan) return role;
  const base = unscoped(store);
  const actions = [...new Set<string>([...(role.actions ?? []), ...plan.missing])].sort((a, b) => rank(a) - rank(b));
  const after = await base.update("roles", role.id, { actions, templateActions: plan.templateActions });
  if (plan.missing.length) {
    const labels = plan.missing.map((a) => SPECIAL_ACTIONS.find((x) => x.key === a)?.label ?? a);
    // id determinístico (perfil + operações acrescentadas + modelo aplicado): sincronizações concorrentes do mesmo perfil
    // (várias requisições lendo o perfil ao mesmo tempo) gravam um único registro de auditoria
    const auditId = detId("audit", "role.template_sync", role.id, [...plan.missing].sort().join(","), [...plan.templateActions].sort().join(","));
    try {
      await base.create(
        "audit_logs",
        {
          companyId: role.companyId ?? null, branchId: null, userId: "system", userName: "Sistema", userRole: "Administrador",
          module: "admin", action: "role.template_sync", entityType: "role", entityId: role.id,
          summary: `Perfil de sistema "${role.name}" recebeu operação(ões) nova(s) do modelo padrão: ${labels.join(", ")} (nada do que foi configurado foi removido)`,
          before: sanitize({ actions: role.actions ?? [] }), after: sanitize({ actions }), reason: null, result: "success", ip: null,
          occurredAt: nowIso(), operationId: null, related: [`role:${role.id}`],
        },
        auditId,
      );
    } catch (e) {
      // já registrado por outra sincronização concorrente; outras falhas de auditoria não derrubam o acesso
      if (!isConflict(e)) console.error("[audit] falha ao registrar sincronização de perfil", e);
    }
  }
  return after;
}

/** Sincroniza todos os perfis de sistema (de uma empresa ou da instalação). Devolve quantos perfis ganharam operações. */
export async function syncSystemRoles(store: Store, companyId?: string | null): Promise<number> {
  const base = unscoped(store);
  const roles = await listAll(base, "roles", { filters: companyId ? [["eq", "companyId", companyId], ["eq", "system", true]] : [["eq", "system", true]] });
  let changed = 0;
  for (const r of roles) {
    const plan = templateSyncPlan(r);
    if (!plan) continue;
    await syncRoleTemplate(base, r);
    if (plan.missing.length) changed++;
  }
  return changed;
}
