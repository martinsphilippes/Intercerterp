import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { inviteState, isSellerOnly, listedCompanyUsers } from "@/domain/users";
import { unscoped } from "@/lib/db/scoped-store";
import { branchScopeOf, resolveRoleId } from "@/lib/auth/users";
import { listRoles, roleAdministersUsers, roleCoverage, usersByRole } from "@/domain/roles";

/**
 * Consulta única da listagem de usuários (tela e exportação). Multiempresa: só os usuários vinculados à empresa em uso
 * (o administrador da plataforma só aparece para quem é da plataforma); perfil, filiais e cargo são os DESTA empresa.
 */
export async function queryUsers(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const [users, roles, branches] = await Promise.all([
    listedCompanyUsers(ctx),
    // todos os perfis (somente leitura) para resolver o perfil de cada usuário NESTA empresa (perfil por empresa)
    listAll(unscoped(ctx.store), "roles"),
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const branchMap = new Map(branches.map((b) => [b.id, b]));
  // vendedores sem acesso ao sistema (CAD-05) são geridos em Vendas › Vendedores
  let rows = users.filter((u) => !isSellerOnly(u)).map((u) => {
    const inv = inviteState(u);
    // filiais autorizadas NESTA empresa (null = todas)
    const scope = branchScopeOf(u, ctx.companyId);
    const ownBranches = scope === null ? null : scope.filter((b: string) => branchMap.has(b));
    const roleId = u.isAdmin ? null : resolveRoleId(u, ctx.companyId, roleMap, roles);
    const role = roleId ? roleMap.get(roleId) : null;
    return {
      ...u,
      roleId,
      roleName: u.isAdmin ? "Administrador da plataforma (acesso total)" : (role?.name ?? "Sem perfil nesta empresa"),
      jobTitle: ((u.jobTitleByCompany ?? {})[ctx.companyId] as string | undefined) ?? null,
      /** administra os usuários desta empresa (perfil com Administração › Editar e “Gerenciar usuários e perfis”) */
      administers: !u.isAdmin && roleAdministersUsers(role),
      statusKey: inv === "expired" ? "invite_expired" : u.status,
      invite: inv,
      branchIdsHere: ownBranches,
      branchesLabel: u.isAdmin || ownBranches === null ? "Todas as filiais" : ownBranches.length ? ownBranches.map((b: string) => branchMap.get(b)!.name).join(", ") : "Nenhuma filial desta empresa",
      effectiveDiscountBps: u.discountLimitBps ?? (u.isAdmin ? 10000 : (role?.discountLimitBps ?? 0)),
      discountSource: u.discountLimitBps != null ? "usuário" : "perfil",
      companiesCount: u.isAdmin ? null : (u.companyIds ?? []).length,
    };
  });
  if (p.q) {
    const q = normalizeSearch(p.q);
    rows = rows.filter((u) => normalizeSearch(`${u.name} ${u.email} ${u.login ?? ""} ${u.phone ?? ""} ${u.jobTitle ?? ""}`).includes(q));
  }
  if (p.f.status) rows = rows.filter((u) => (p.f.status === "invited" ? u.invite === "pending" : p.f.status === "invite_expired" ? u.invite === "expired" : u.status === p.f.status));
  if (p.f.role) rows = rows.filter((u) => u.roleId === p.f.role && !u.isAdmin);
  // "Administradores": quem administra os usuários desta empresa (e, para a plataforma, os administradores dela)
  if (p.f.admin === "1") rows = rows.filter((u) => u.isAdmin || u.administers);
  if (p.f.branch) rows = rows.filter((u) => u.isAdmin || u.branchIdsHere === null || u.branchIdsHere.includes(p.f.branch));
  if (p.f.access === "never") rows = rows.filter((u) => u.status === "active" && !u.lastAccessAt);
  return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function queryRoles(ctx: Ctx) {
  // usuários e perfis lidos uma única vez (não por perfil)
  const [roles, byRole] = await Promise.all([listRoles(ctx.store, ctx.companyId), usersByRole(ctx.store, ctx.companyId)]);
  return roles.map((r) => ({ ...r, ...roleCoverage(r), usersCount: (byRole.get(r.id) ?? []).filter((u) => u.status !== "inactive").length }));
}
