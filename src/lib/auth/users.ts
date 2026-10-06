import { findOne } from "../db";
import type { Doc, Store } from "../db/types";
import type { CtxUser } from "../core/ctx";
import { ScopedStore, unscoped } from "../db/scoped-store";
import { syncRoleTemplate, templateSyncPlan } from "./role-sync";

/**
 * Perfil por empresa: o vínculo usuário × empresa define o perfil (`roleByCompany[companyId]`).
 * Sem vínculo explícito, vale o perfil legado (`roleId`) quando ele é da própria empresa; se o perfil legado é um
 * perfil de sistema de outra empresa, usa-se o perfil de sistema equivalente (mesma chave) DESTA empresa —
 * assim cada empresa controla as permissões dentro dela e nenhuma empresa altera o acesso em outra.
 */
export function resolveRoleId(u: Record<string, any>, companyId: string, rolesById: Map<string, Doc>, rolesOfCompany: Doc[] = []): string | null {
  if (!companyId) return u.roleId ?? null;
  const explicit = (u.roleByCompany ?? {})[companyId];
  if (explicit) {
    const r = rolesById.get(explicit);
    return r && (r.companyId === companyId || r.companyId == null) ? r.id : null;
  }
  const legacy = u.roleId ? rolesById.get(u.roleId) : null;
  if (!legacy) return null;
  if (legacy.companyId === companyId || legacy.companyId == null) return legacy.id;
  if (legacy.system && legacy.key) return rolesOfCompany.find((r) => r.companyId === companyId && r.system && r.key === legacy.key)?.id ?? null;
  return null;
}

/** Perfil efetivo do usuário na empresa (null = sem perfil nesta empresa). */
export async function userRoleIn(store: Store, u: Record<string, any>, companyId: string): Promise<Doc | null> {
  const base = unscoped(store);
  const ids = [...new Set([(u.roleByCompany ?? {})[companyId], u.roleId].filter(Boolean) as string[])];
  const rolesById = new Map<string, Doc>();
  for (const id of ids) {
    const r = await base.get("roles", id);
    if (r) rolesById.set(id, r);
  }
  const legacy = u.roleId ? rolesById.get(u.roleId) : null;
  let rolesOfCompany: Doc[] = [];
  if (!(u.roleByCompany ?? {})[companyId] && legacy && legacy.companyId !== companyId && legacy.system && legacy.key) {
    rolesOfCompany = (await base.list("roles", { filters: [["eq", "companyId", companyId], ["eq", "key", legacy.key]], limit: 5 })).items;
  }
  const id = resolveRoleId(u, companyId, rolesById, rolesOfCompany);
  return id ? (rolesById.get(id) ?? rolesOfCompany.find((r) => r.id === id) ?? null) : null;
}

/**
 * Monta o usuário do contexto a partir do cadastro e do perfil de acesso NA EMPRESA informada
 * (sem empresa explícita: a empresa do Store restrito, ou o perfil legado).
 */
export async function toCtxUser(store: Store, u: Doc, companyId?: string | null): Promise<CtxUser> {
  const cid = companyId ?? (store instanceof ScopedStore ? store.companyId : null);
  let role = cid ? await userRoleIn(store, u, cid) : u.roleId ? await store.get("roles", u.roleId) : null;
  // perfil de sistema com operações novas no modelo padrão: aplica (idempotente, auditado); falha não bloqueia o acesso
  if (role && templateSyncPlan(role)) role = await syncRoleTemplate(store, role).catch(() => role);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isAdmin: Boolean(u.isAdmin),
    roleId: role?.id ?? null,
    roleKey: role?.key ?? null,
    roleName: u.isAdmin ? "Administrador" : (role?.name ?? null),
    permissions: role?.permissions ?? {},
    actions: role?.actions ?? [],
    discountLimitBps: u.discountLimitBps ?? role?.discountLimitBps ?? 0,
    branchIds: u.branchIds ?? [],
    companyIds: u.companyIds ?? [],
  };
}

export async function findUserByLogin(store: Store, login: string): Promise<Doc | null> {
  const v = login.trim().toLowerCase();
  if (v.includes("@")) return findOne(store, "users", [["eq", "email", v]]);
  return findOne(store, "users", [["eq", "login", v]]);
}

export async function findUserByAuthId(store: Store, authId: string): Promise<Doc | null> {
  return findOne(store, "users", [["eq", "authId", authId]]);
}

/** Empresas e filiais acessíveis ao usuário (inclui inativas — use `unitBlockReason` para saber se podem ser selecionadas). */
export async function accessibleUnits(store: Store, u: Doc) {
  const { listAll } = await import("../db");
  const base = unscoped(store);
  const [allCompanies, allBranches] = await Promise.all([listAll(base, "companies"), listAll(base, "branches")]);
  const companies = allCompanies.filter((c) => u.isAdmin || (u.companyIds ?? []).includes(c.id));
  const branches = allBranches.filter(
    (b) => companies.some((c) => c.id === b.companyId) && (u.isAdmin || !(u.branchIds?.length) || u.branchIds.includes(b.id)),
  );
  return { companies, branches };
}

/**
 * Motivo para a unidade não poder ser usada como contexto de trabalho (null = pode).
 * Empresa inativa: nada é selecionável. Filial inativa: só o consolidado da empresa (somente consulta).
 */
export function unitBlockReason(company: Doc | Record<string, any> | null | undefined, branch: Doc | Record<string, any> | null | undefined): string | null {
  if (company && company.status === "inactive") return `Empresa ${company.tradeName || company.name} inativa: não pode ser selecionada nem operar. Um administrador pode reativá-la em Administração → Empresas.`;
  if (branch && branch.status === "inactive") return `Filial ${branch.name} inativa: não pode ser selecionada nem operar. Consulte seus movimentos pelo consolidado da empresa ou peça a reativação.`;
  return null;
}
