import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getStore } from "../db";
import { getAuth } from "../auth/provider";
import { accessibleUnits, findUserByAuthId, toCtxUser } from "../auth/users";
import type { Ctx } from "../core/ctx";
import { can, type Crud, type ModuleKey } from "../permissions";
import { ensureBootstrap } from "./bootstrap";
import { scopeStore } from "../db/scoped-store";

export const SESSION_COOKIE = "ic_session";
export const UNIT_COOKIE = "ic_unit";

export interface SessionInfo {
  ctx: Ctx;
  user: Awaited<ReturnType<typeof toCtxUser>>;
  company: Record<string, any>;
  branch: Record<string, any> | null;
  companies: Record<string, any>[];
  branches: Record<string, any>[];
  consolidated: boolean;
  canConsolidate: boolean;
}

/** Sessão do usuário autenticado (ou null). Cacheada por requisição. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  await ensureBootstrap();
  const jar = await cookies();
  const secret = jar.get(SESSION_COOKIE)?.value;
  if (!secret) return null;
  const store = getStore();
  const authId = await getAuth().verify(secret);
  if (!authId) return null;
  const userDoc = await findUserByAuthId(store, authId);
  if (!userDoc || userDoc.status !== "active") return null;
  const { companies, branches } = await accessibleUnits(store, userDoc);
  if (companies.length === 0) return null;
  const unit = jar.get(UNIT_COOKIE)?.value ?? "";
  const [cid, bid] = unit.split(":");
  // empresa/filial inativa não é contexto de trabalho (volta para a seleção de unidade)
  const company = companies.find((c) => c.id === cid && c.status !== "inactive") ?? null;
  const companyBranches = company ? branches.filter((b) => b.companyId === company.id) : [];
  const branch = bid && bid !== "all" ? (companyBranches.find((b) => b.id === bid && b.status !== "inactive") ?? null) : null;
  // Consolidado só para quem acessa todas as filiais (usuário restrito escolhe uma filial)
  const canConsolidate = Boolean(userDoc.isAdmin) || !(userDoc.branchIds ?? []).length;
  const consolidated = bid === "all" && canConsolidate;
  // perfil da empresa ativa (perfil por empresa)
  const user = await toCtxUser(store, userDoc, company?.id ?? null);
  const h = await headers();
  if (!company || (!branch && !consolidated)) {
    // contexto incompleto: as páginas internas redirecionam para a seleção de unidade
    return {
      ctx: { store, user, companyId: company?.id ?? "", branchId: null, ip: h.get("x-forwarded-for") ?? undefined },
      user,
      company: company ?? {},
      branch: null,
      companies,
      branches,
      consolidated: false,
      canConsolidate,
    };
  }
  return {
    ctx: { store: scopeStore(store, company.id), user, companyId: company.id, branchId: branch?.id ?? null, ip: h.get("x-forwarded-for")?.split(",")[0] ?? undefined },
    user,
    company,
    branch,
    companies,
    branches: companyBranches,
    consolidated,
    canConsolidate,
  };
});

/** Exige sessão com empresa/filial definida; redireciona quando ausente. */
export async function requireSession(module?: ModuleKey, op: Crud = "view"): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.ctx.companyId || (!s.branch && !s.consolidated)) redirect("/selecionar-unidade");
  if (module && !can(s.user, module, op)) redirect("/sem-permissao");
  return s;
}
