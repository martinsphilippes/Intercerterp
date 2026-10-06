import "server-only";
import { listAll } from "@/lib/db";
import type { SessionInfo } from "@/lib/server/session";
import { listRoles } from "@/domain/roles";
import { unscoped } from "@/lib/db/scoped-store";
import { manageableCompanyIds } from "@/domain/users";

/**
 * Opções do formulário de usuário: perfis ativos DA EMPRESA EM USO (o perfil vale nesta empresa), empresas e filiais
 * das empresas em que o editor administra usuários (o Store da sessão é restrito à empresa ativa; a leitura das filiais
 * das demais empresas autorizadas é feita explicitamente, só para montar as opções). Vínculos do usuário com as demais
 * empresas/filiais ficam fora do formulário e são preservados no servidor.
 */
export async function userFormOptions(s: SessionInfo) {
  const roles = (await listRoles(s.ctx.store, s.ctx.companyId)).filter((r) => r.active !== false);
  const companyIds = await manageableCompanyIds(s.ctx, s.companies.map((c) => c.id));
  const companies = s.companies.filter((c) => companyIds.has(c.id));
  const branches = (await listAll(unscoped(s.ctx.store), "branches")).filter((b) => companyIds.has(b.companyId));
  return {
    roles: roles.map((r) => ({ value: r.id, label: r.name, discountLimitBps: r.discountLimitBps ?? 0, description: r.description })),
    companies: companies.map((c) => ({ value: c.id, label: c.tradeName || c.name })),
    branches: branches.map((b) => ({ value: b.id, label: `${b.name}${companies.length > 1 ? ` (${companies.find((c) => c.id === b.companyId)?.tradeName ?? ""})` : ""}`, companyId: b.companyId })),
    canGrantAdmin: s.user.isAdmin,
  };
}
