import { findOne } from "../db";
import type { Doc, Store } from "../db/types";
import type { CtxUser } from "../core/ctx";

/** Monta o usuário do contexto a partir do perfil do ERP e do perfil de acesso. */
export async function toCtxUser(store: Store, u: Doc): Promise<CtxUser> {
  const role = u.roleId ? await store.get("roles", u.roleId) : null;
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

/** Empresas e filiais acessíveis ao usuário. */
export async function accessibleUnits(store: Store, u: Doc) {
  const { listAll } = await import("../db");
  const companies = (await listAll(store, "companies")).filter((c) => u.isAdmin || (u.companyIds ?? []).includes(c.id));
  const branches = (await listAll(store, "branches")).filter(
    (b) => companies.some((c) => c.id === b.companyId) && (u.isAdmin || !(u.branchIds?.length) || u.branchIds.includes(b.id)),
  );
  return { companies, branches };
}
