import "server-only";
import { listAll } from "@/lib/db";
import type { SessionInfo } from "@/lib/server/session";
import { listRoles } from "@/domain/roles";

/** Opções do formulário de usuário (perfis ativos da empresa, empresas e filiais acessíveis). */
export async function userFormOptions(s: SessionInfo) {
  const roles = (await listRoles(s.ctx.store, s.ctx.companyId)).filter((r) => r.active !== false);
  const companyIds = new Set(s.companies.map((c) => c.id));
  const branches = (await listAll(s.ctx.store, "branches")).filter((b) => companyIds.has(b.companyId));
  return {
    roles: roles.map((r) => ({ value: r.id, label: r.name, discountLimitBps: r.discountLimitBps ?? 0, description: r.description })),
    companies: s.companies.map((c) => ({ value: c.id, label: c.tradeName || c.name })),
    branches: branches.map((b) => ({ value: b.id, label: `${b.name}${s.companies.length > 1 ? ` (${s.companies.find((c) => c.id === b.companyId)?.tradeName ?? ""})` : ""}`, companyId: b.companyId })),
    canGrantAdmin: s.user.isAdmin,
  };
}
