import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { companyUsers, inviteState } from "@/domain/users";
import { unscoped } from "@/lib/db/scoped-store";
import { resolveRoleId } from "@/lib/auth/users";
import { listRoles, roleCoverage, roleUsers } from "@/domain/roles";

/** Consulta única da listagem de usuários (tela e exportação). */
export async function queryUsers(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const [users, roles, branches] = await Promise.all([
    companyUsers(ctx.store, ctx.companyId),
    // todos os perfis (somente leitura) para resolver o perfil de cada usuário NESTA empresa (perfil por empresa)
    listAll(unscoped(ctx.store), "roles"),
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const branchMap = new Map(branches.map((b) => [b.id, b]));
  let rows = users.map((u) => {
    const inv = inviteState(u);
    const ownBranches = (u.branchIds ?? []).filter((b: string) => branchMap.has(b));
    const roleId = u.isAdmin ? null : resolveRoleId(u, ctx.companyId, roleMap, roles);
    const role = roleId ? roleMap.get(roleId) : null;
    return {
      ...u,
      roleId,
      roleName: u.isAdmin ? "Administrador (acesso total)" : (role?.name ?? "Sem perfil nesta empresa"),
      statusKey: inv === "expired" ? "invite_expired" : u.status,
      invite: inv,
      branchesLabel: u.isAdmin || !ownBranches.length ? "Todas as filiais" : ownBranches.map((b: string) => branchMap.get(b)!.name).join(", "),
      effectiveDiscountBps: u.discountLimitBps ?? (u.isAdmin ? 10000 : (role?.discountLimitBps ?? 0)),
      discountSource: u.discountLimitBps != null ? "usuário" : "perfil",
      companiesCount: u.isAdmin ? null : (u.companyIds ?? []).length,
    };
  });
  if (p.q) {
    const q = normalizeSearch(p.q);
    rows = rows.filter((u) => normalizeSearch(`${u.name} ${u.email} ${u.login ?? ""} ${u.phone ?? ""}`).includes(q));
  }
  if (p.f.status) rows = rows.filter((u) => (p.f.status === "invited" ? u.invite === "pending" : p.f.status === "invite_expired" ? u.invite === "expired" : u.status === p.f.status));
  if (p.f.role) rows = rows.filter((u) => u.roleId === p.f.role && !u.isAdmin);
  if (p.f.admin === "1") rows = rows.filter((u) => u.isAdmin);
  if (p.f.branch) rows = rows.filter((u) => u.isAdmin || !(u.branchIds ?? []).length || u.branchIds.includes(p.f.branch));
  if (p.f.access === "never") rows = rows.filter((u) => u.status === "active" && !u.lastAccessAt);
  return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function queryRoles(ctx: Ctx) {
  const roles = await listRoles(ctx.store, ctx.companyId);
  const out = [];
  for (const r of roles) {
    const users = await roleUsers(ctx.store, r.id);
    out.push({ ...r, ...roleCoverage(r), usersCount: users.filter((u) => u.status !== "inactive").length });
  }
  return out;
}
