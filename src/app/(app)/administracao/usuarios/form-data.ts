import "server-only";
import { listAll } from "@/lib/db";
import type { SessionInfo } from "@/lib/server/session";
import { assertAssignable, listRoles } from "@/domain/roles";
import { manageableCompanyIds } from "@/domain/users";

/** O editor pode atribuir este perfil? (multiempresa: só perfis cujo acesso ele mesmo tem nesta empresa) */
export async function canAssignRole(s: SessionInfo, role: Record<string, any> | null | undefined): Promise<boolean> {
  if (!role) return true;
  try {
    await assertAssignable(s.ctx, role);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opções do formulário de usuário: perfis ativos DA EMPRESA EM USO (o perfil vale nesta empresa; os que vão além do
 * acesso do editor aparecem desabilitados), empresas em que o editor administra usuários e as filiais DESTA empresa
 * (multiempresa: a atribuição de filiais vale por empresa; quem acessa só algumas filiais só concede as dele). Vínculos
 * do usuário com as demais empresas/filiais ficam fora do formulário e são preservados no servidor.
 */
export async function userFormOptions(s: SessionInfo) {
  const roles = (await listRoles(s.ctx.store, s.ctx.companyId)).filter((r) => r.active !== false);
  const companyIds = await manageableCompanyIds(s.ctx, s.companies.map((c) => c.id));
  const companies = s.companies.filter((c) => companyIds.has(c.id));
  const mine = s.user.isAdmin || !(s.user.branchIds ?? []).length ? null : new Set(s.user.branchIds);
  const branches = (await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] })).filter((b) => !mine || mine.has(b.id));
  const roleOptions = await Promise.all(
    roles.map(async (r) => {
      const assignable = await canAssignRole(s, r);
      return { value: r.id, label: assignable ? r.name : `${r.name} (acima do seu acesso)`, disabled: !assignable, discountLimitBps: r.discountLimitBps ?? 0, description: r.description };
    }),
  );
  return {
    roles: roleOptions,
    companies: companies.map((c) => ({ value: c.id, label: c.tradeName || c.name })),
    branches: branches.map((b) => ({ value: b.id, label: `${b.name}${b.status === "inactive" ? " (inativa)" : ""}`, companyId: b.companyId as string })),
    canGrantAdmin: s.user.isAdmin,
    /** o editor acessa só algumas filiais desta empresa (só concede as dele; não libera “todas”) */
    editorRestricted: Boolean(mine),
  };
}
