"use server";

import { headers } from "next/headers";
import { runAction, fstr, fopt, fbool } from "@/lib/server/action";
import { createUser, updateUser, setUserStatus, resendInvite, cancelInvite, adminSetPassword, type UserInput } from "@/domain/users";
import { createRole, updateRole, duplicateRole, deleteRole, matrixFromForm } from "@/domain/roles";
import { BusinessError } from "@/lib/core/errors";

async function requestOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

function pctToBps(v: string): number | null {
  if (v === "") return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) throw new BusinessError("Limite de desconto inválido.");
  return Math.round(n * 100);
}

function parseUser(fd: FormData): UserInput {
  return {
    name: fstr(fd, "name"),
    email: fstr(fd, "email"),
    login: fopt(fd, "login"),
    phone: fopt(fd, "phone"),
    roleId: fopt(fd, "roleId"),
    isAdmin: fbool(fd, "isAdmin"),
    companyIds: fd.getAll("companyIds").map(String),
    branchIds: fd.getAll("branchIds").map(String),
    discountLimitBps: fbool(fd, "ownDiscount") ? pctToBps(fstr(fd, "discountPct")) : null,
  };
}

export async function saveUserAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction<any>({ module: "admin", op: id ? "edit" : "create", revalidate: ["/administracao/usuarios"] }, async (s) => {
    const input = parseUser(fd);
    if (id) {
      const u = await updateUser(s.ctx, id, input);
      return { ok: true as const, message: "Usuário atualizado.", redirect: `/administracao/usuarios/${u.id}` };
    }
    const mode = fstr(fd, "mode") === "password" ? "password" : "invite";
    const r = await createUser(s.ctx, { ...input, mode, password: fstr(fd, "password"), origin: await requestOrigin(), idemKey: fstr(fd, "_idem") || undefined });
    if (r.invite) {
      return {
        ok: true as const,
        data: { id: r.user.id, invite: r.invite },
        message: r.invite.delivered ? `Convite enviado por e-mail (${r.invite.channel}).` : "Convite criado. O e-mail não foi enviado — copie o link exibido.",
      };
    }
    return { ok: true as const, data: { id: r.user.id }, message: "Usuário criado com senha inicial.", redirect: `/administracao/usuarios/${r.user.id}` };
  });
}

export async function setUserStatusAction(id: string, status: "active" | "inactive" | "suspended", fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/usuarios/${id}`, "/administracao/usuarios"] }, async (s) => {
    await setUserStatus(s.ctx, id, status, fopt(fd, "reason"));
    return { ok: true as const, message: status === "active" ? "Acesso reativado." : status === "suspended" ? "Acesso suspenso; sessões encerradas." : "Usuário inativado; sessões encerradas." };
  });
}

export async function resendInviteAction(id: string) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/usuarios/${id}`] }, async (s) => {
    const r = await resendInvite(s.ctx, id, await requestOrigin());
    return { ok: true as const, data: { invite: r.invite }, message: r.invite.delivered ? `Convite reenviado por e-mail (${r.invite.channel}).` : "Novo link gerado. O e-mail não foi enviado — copie o link exibido." };
  });
}

export async function cancelInviteAction(id: string) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/usuarios/${id}`] }, async (s) => {
    await cancelInvite(s.ctx, id);
    return { ok: true as const, message: "Convite cancelado; o link deixou de funcionar." };
  });
}

export async function setPasswordAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/usuarios/${id}`] }, async (s) => {
    const pw = fstr(fd, "password");
    if (pw !== fstr(fd, "confirm")) throw new BusinessError("As senhas não conferem.");
    await adminSetPassword(s.ctx, id, pw);
    return { ok: true as const, message: "Senha redefinida. Informe a nova senha ao usuário por um canal seguro." };
  });
}

// ───────────────────────────── perfis

export async function saveRoleAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "admin", op: id ? "edit" : "create", revalidate: ["/administracao/usuarios/perfis"] }, async (s) => {
    const { permissions, actions } = matrixFromForm(fd);
    const input = { name: fstr(fd, "name"), description: fopt(fd, "description"), permissions, actions, discountLimitBps: pctToBps(fstr(fd, "discountPct")) ?? 0, active: fstr(fd, "active") !== "0" };
    const r = id ? await updateRole(s.ctx, id, input, fopt(fd, "reason")) : await createRole(s.ctx, input, { idemKey: fstr(fd, "_idem") || undefined });
    return { ok: true as const, message: id ? "Perfil atualizado. As permissões valem a partir da próxima ação de cada usuário." : "Perfil criado.", redirect: `/administracao/usuarios/perfis/${r.id}` };
  });
}

export async function duplicateRoleAction(id: string, fd: FormData) {
  return runAction({ module: "admin", op: "create", revalidate: ["/administracao/usuarios/perfis"] }, async (s) => {
    const r = await duplicateRole(s.ctx, id, undefined, fstr(fd, "_idem") || undefined);
    return { ok: true as const, message: `Perfil "${r.name}" criado a partir da cópia.`, redirect: `/administracao/usuarios/perfis/${r.id}` };
  });
}

export async function deleteRoleAction(id: string) {
  return runAction({ module: "admin", op: "delete", revalidate: ["/administracao/usuarios/perfis"] }, async (s) => {
    await deleteRole(s.ctx, id);
    return { ok: true as const, message: "Perfil excluído.", redirect: "/administracao/usuarios/perfis" };
  });
}
