import crypto from "node:crypto";
import { detId, findOne, isConflict, listAll, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { sendEmail } from "@/lib/core/email";
import { getSetting } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";
import { nowIso } from "@/lib/dates";
import { getAuth } from "@/lib/auth/provider";
import { findUserByLogin } from "@/lib/auth/users";
import { resolveOccurrence } from "@/lib/core/notify";
import { auditedGuard } from "./roles";

/**
 * Usuários (Tela 36): cadastro, acesso direto ou convite, situação (ativo/inativo/suspenso),
 * perfil, empresas/filiais vinculadas e limite de desconto individual.
 *
 * Regras:
 *  - convite: token aleatório (somente o hash é gravado) com validade; link /convite/<token>;
 *    envio pelo canal de e-mail configurado com resultado real; sem canal, o link é exibido ao administrador;
 *  - suspensão/inativação bloqueia o login (no Appwrite Auth também via setBlocked) e encerra sessões locais;
 *  - nunca deixar a instalação sem administrador ativo (último administrador protegido).
 */

export type UserStatus = "active" | "invited" | "inactive" | "suspended";

export interface UserInput {
  name: string;
  email: string;
  login?: string | null;
  phone?: string | null;
  roleId?: string | null;
  isAdmin?: boolean;
  companyIds: string[];
  branchIds: string[];
  /** null = herda o limite do perfil */
  discountLimitBps?: number | null;
}

export const DEFAULT_INVITE_DAYS = 7;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function guard(ctx: Ctx, op: "create" | "edit", summary: string, entityId?: string | null) {
  await auditedGuard(
    ctx,
    () => {
      requirePerm(ctx, "admin", op);
      requireAction(ctx, "admin.users");
    },
    { action: `user.${op}`, entityType: "user", entityId, summary },
  );
}

export function inviteState(u: { status?: string | null; inviteExpiresAt?: string | null } & Record<string, any>): "pending" | "expired" | null {
  if (u.status !== "invited") return null;
  return u.inviteExpiresAt && u.inviteExpiresAt < nowIso() ? "expired" : "pending";
}

/** Usuários com acesso à empresa (administradores enxergam todas). */
export async function companyUsers(store: Store, companyId: string) {
  const all = await listAll(store, "users");
  return all.filter((u) => u.isAdmin || (u.companyIds ?? []).includes(companyId));
}

/** Administradores ativos (acesso total) — usados na proteção do último administrador. */
export async function activeAdmins(store: Store) {
  return listAll(store, "users", { filters: [["eq", "isAdmin", true], ["eq", "status", "active"]] });
}

async function assertNotLastAdmin(store: Store, user: Doc, what: string) {
  if (!user.isAdmin || user.status !== "active") return;
  const admins = await activeAdmins(store);
  if (admins.filter((a) => a.id !== user.id).length === 0) {
    throw new BusinessError(`Operação bloqueada: ${user.name} é o último administrador ativo. ${what} deixaria o sistema sem administrador. Conceda acesso de administrador a outro usuário antes.`, "last_admin");
  }
}

async function validateInput(ctx: Ctx, input: UserInput, selfId?: string) {
  assert(input.name?.trim(), "Informe o nome.");
  const email = input.email?.trim().toLowerCase();
  assert(email && EMAIL_RE.test(email), "Informe um e-mail válido.");
  const login = input.login?.trim().toLowerCase() || null;
  if (login) assert(/^[a-z0-9._-]{3,40}$/.test(login), "Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).");
  const dupEmail = await findOne(ctx.store, "users", [["eq", "email", email]]);
  if (dupEmail && dupEmail.id !== selfId) throw new BusinessError(`E-mail já usado pelo usuário ${dupEmail.name}.`, "duplicate");
  if (login) {
    const dupLogin = await findOne(ctx.store, "users", [["eq", "login", login]]);
    if (dupLogin && dupLogin.id !== selfId) throw new BusinessError(`Login já usado pelo usuário ${dupLogin.name}.`, "duplicate");
  }
  const companyIds = [...new Set(input.companyIds.filter(Boolean))];
  assert(input.isAdmin || companyIds.length > 0, "Vincule o usuário a pelo menos uma empresa.");
  const companies = await listAll(ctx.store, "companies");
  for (const c of companyIds) assert(companies.some((x) => x.id === c), "Empresa inválida.");
  const branches = await listAll(ctx.store, "branches");
  const branchIds = [...new Set(input.branchIds.filter(Boolean))];
  for (const b of branchIds) {
    const br = branches.find((x) => x.id === b);
    assert(br, "Filial inválida.");
    assert(input.isAdmin || companyIds.includes(br.companyId), `A filial ${br.name} não pertence às empresas vinculadas.`);
  }
  if (input.roleId) {
    const role = await ctx.store.get("roles", input.roleId);
    assert(role, "Perfil inválido.");
    assert(role.active !== false, "Perfil inativo.");
  } else {
    assert(input.isAdmin, "Selecione o perfil de acesso.");
  }
  if (input.discountLimitBps != null) assert(Number.isInteger(input.discountLimitBps) && input.discountLimitBps >= 0 && input.discountLimitBps <= 10000, "Limite de desconto deve estar entre 0% e 100%.");
  if (input.isAdmin && !ctx.user.isAdmin) throw new BusinessError("Somente administradores podem conceder acesso de administrador.", "forbidden");
  return {
    name: input.name.trim(),
    email,
    login,
    phone: onlyDigits(input.phone) || null,
    roleId: input.roleId || null,
    isAdmin: Boolean(input.isAdmin),
    companyIds,
    branchIds,
    discountLimitBps: input.discountLimitBps ?? null,
  };
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function sendInvite(ctx: Ctx, user: Doc, token: string, origin: string, expiresAt: string) {
  const link = `${origin.replace(/\/$/, "")}/convite/${token}`;
  const company = await ctx.store.get("companies", ctx.companyId);
  const companyName = company?.tradeName || company?.name || "Intercert ERP";
  const sent = await sendEmail(ctx.companyId, {
    to: user.email,
    subject: `Convite de acesso — ${companyName}`,
    html: `<p>Olá, ${user.name}.</p><p>${ctx.user.name} convidou você para acessar o ERP de <b>${companyName}</b>.</p><p>Para definir sua senha e ativar o acesso, abra: <a href="${link}">${link}</a></p><p>O convite expira em ${new Date(expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p>`,
  });
  const delivery = sent.delivered ? `Entregue ao provedor (${sent.channel}) em ${nowIso()}` : `Não enviado: ${sent.message ?? sent.channel}`;
  return { link, delivered: sent.delivered, channel: sent.channel, message: sent.message ?? null, delivery };
}

export interface InviteResult {
  link: string;
  delivered: boolean;
  channel: string;
  message: string | null;
  expiresAt: string;
}

/** Cria o usuário com senha inicial (acesso direto) ou convite com token e validade. */
export async function createUser(
  ctx: Ctx,
  input: UserInput & { mode: "password" | "invite"; password?: string; origin?: string; idemKey?: string },
): Promise<{ user: Doc; invite?: InviteResult }> {
  await guard(ctx, "create", `criar usuário ${input.email}`);
  const id = input.idemKey ? detId("user", input.idemKey) : undefined;
  if (id) {
    const prev = await ctx.store.get("users", id);
    if (prev) return { user: prev };
  }
  const data = await validateInput(ctx, input);
  if (input.mode === "password") {
    assert((input.password ?? "").length >= 8, "A senha inicial deve ter ao menos 8 caracteres.");
    let user: Doc;
    try {
      user = await ctx.store.create("users", { ...data, status: "active", createdBy: ctx.user.id }, id);
    } catch (e) {
      if (isConflict(e)) throw new BusinessError("E-mail já cadastrado.", "duplicate");
      throw e;
    }
    try {
      const authId = await getAuth().createUser(data.email, input.password!, data.name);
      user = await ctx.store.update("users", user.id, { authId });
    } catch (e: any) {
      await ctx.store.delete("users", user.id);
      throw new BusinessError(`Não foi possível criar a credencial no serviço de autenticação: ${e?.message ?? e}`, "auth_failed");
    }
    await audit(ctx, { module: "admin", action: "user.create", entityType: "user", entityId: user.id, summary: `Usuário ${user.name} criado com acesso direto (senha inicial definida pelo administrador)`, after: { ...data }, related: user.roleId ? [`role:${user.roleId}`] : [] });
    return { user };
  }
  const days = await getSetting<number>(ctx.store, ctx.companyId, null, "users.inviteExpiryDays", DEFAULT_INVITE_DAYS);
  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  let user: Doc;
  try {
    user = await ctx.store.create("users", { ...data, status: "invited", inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, invitedBy: ctx.user.id, createdBy: ctx.user.id }, id);
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("E-mail já cadastrado.", "duplicate");
    throw e;
  }
  const r = await sendInvite(ctx, user, token, input.origin ?? "", expiresAt);
  user = await ctx.store.update("users", user.id, { inviteSentAt: nowIso(), inviteDelivery: r.delivery });
  await audit(ctx, {
    module: "admin", action: "user.invite", entityType: "user", entityId: user.id,
    summary: `Convite criado para ${user.name} (${r.delivered ? `e-mail entregue ao provedor ${r.channel}` : "e-mail não enviado — link exibido ao administrador"})`,
    after: { ...data, inviteExpiresAt: expiresAt, delivery: r.delivery }, result: "success", related: user.roleId ? [`role:${user.roleId}`] : [],
  });
  return { user, invite: { link: r.link, delivered: r.delivered, channel: r.channel, message: r.message, expiresAt } };
}

export async function updateUser(ctx: Ctx, id: string, input: UserInput) {
  await guard(ctx, "edit", `alterar usuário ${input.email}`, id);
  const before = await ctx.store.getOrThrow("users", id);
  const data = await validateInput(ctx, input, id);
  if (before.isAdmin && !data.isAdmin) {
    if (!ctx.user.isAdmin) throw new BusinessError("Somente administradores podem revogar acesso de administrador.", "forbidden");
    await assertNotLastAdmin(ctx.store, before, "Remover o acesso de administrador");
  }
  const auth = getAuth();
  if (auth.kind === "appwrite" && before.authId && (data.email !== before.email || data.name !== before.name)) {
    const { Client, Users } = await import("node-appwrite");
    const { appwriteConfig } = await import("@/lib/db");
    const c = appwriteConfig();
    const users = new Users(new Client().setEndpoint(c.endpoint).setProject(c.projectId).setKey(c.apiKey));
    try {
      if (data.email !== before.email) await users.updateEmail({ userId: before.authId, email: data.email });
      if (data.name !== before.name) await users.updateName({ userId: before.authId, name: data.name });
    } catch (e: any) {
      throw new BusinessError(`O serviço de autenticação recusou a alteração: ${e?.message ?? e}`, "auth_failed");
    }
  }
  const after = await ctx.store.update("users", id, data);
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit(ctx, { module: "admin", action: "user.update", entityType: "user", entityId: id, summary: `Cadastro/acesso de ${after.name} alterado`, before: d.before, after: d.after, related: [before.roleId, after.roleId].filter(Boolean).map((r) => `role:${r}`) });
  }
  return after;
}

async function endLocalSessions(store: Store, userId: string) {
  const sessions = await listAll(store, "sessions", { filters: [["eq", "userId", userId]] });
  for (const s of sessions) await store.delete("sessions", s.id);
  return sessions.length;
}

/** Ativa, inativa ou suspende (com motivo). Suspensão e inativação bloqueiam o login imediatamente. */
export async function setUserStatus(ctx: Ctx, id: string, status: "active" | "inactive" | "suspended", reason?: string | null) {
  await guard(ctx, "edit", `alterar situação de usuário para ${status}`, id);
  const u = await ctx.store.getOrThrow("users", id);
  assert(u.id !== ctx.user.id, "Você não pode alterar a situação do seu próprio acesso.");
  if (status === "suspended") assert(reason?.trim(), "Informe o motivo da suspensão.");
  if (status === u.status) return u;
  if (status !== "active") await assertNotLastAdmin(ctx.store, u, status === "suspended" ? "Suspender" : "Inativar");
  const auth = getAuth();
  let patch: Record<string, any>;
  if (status === "active") {
    if (!u.authId) throw new BusinessError("Este usuário ainda não definiu senha. Reenvie o convite para que ele ative o acesso.", "no_credentials");
    patch = { status: "active", suspendedReason: null, suspendedAt: null };
    await auth.setBlocked(u.authId, false);
  } else {
    patch = { status, suspendedReason: reason?.trim() || null, suspendedAt: status === "suspended" ? nowIso() : null, inviteTokenHash: null, inviteExpiresAt: null };
    if (u.authId) await auth.setBlocked(u.authId, true);
  }
  const after = await ctx.store.update("users", id, patch);
  const ended = status !== "active" ? await endLocalSessions(ctx.store, id) : 0;
  const label = { active: "reativado", inactive: "inativado", suspended: "suspenso" }[status];
  await audit(ctx, {
    module: "admin", action: `user.${status === "active" ? "activate" : status === "inactive" ? "deactivate" : "suspend"}`, entityType: "user", entityId: id,
    summary: `Acesso de ${u.name} ${label}${ended ? ` (${ended} sessão(ões) encerrada(s))` : ""}`, before: { status: u.status }, after: { status }, reason: reason?.trim() || null,
  });
  return after;
}

/** Gera novo token (o anterior deixa de valer) e reenvia o convite. Também reativa convite cancelado/expirado. */
export async function resendInvite(ctx: Ctx, id: string, origin: string): Promise<{ user: Doc; invite: InviteResult }> {
  await guard(ctx, "edit", "reenviar convite", id);
  const u = await ctx.store.getOrThrow("users", id);
  assert(!u.authId || u.status === "invited", "Este usuário já ativou o acesso; use “Definir nova senha” se ele esqueceu a senha.");
  assert(u.status !== "suspended", "Usuário suspenso: reative antes de reenviar o convite.");
  const days = await getSetting<number>(ctx.store, ctx.companyId, null, "users.inviteExpiryDays", DEFAULT_INVITE_DAYS);
  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  await ctx.store.update("users", id, { status: "invited", inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt });
  const r = await sendInvite(ctx, u, token, origin, expiresAt);
  const user = await ctx.store.update("users", id, { inviteSentAt: nowIso(), inviteDelivery: r.delivery, invitedBy: ctx.user.id });
  await audit(ctx, { module: "admin", action: "user.invite_resend", entityType: "user", entityId: id, summary: `Convite reenviado para ${u.name} (${r.delivered ? `entregue ao provedor ${r.channel}` : "link exibido ao administrador"}); token anterior invalidado`, after: { inviteExpiresAt: expiresAt, delivery: r.delivery } });
  return { user, invite: { link: r.link, delivered: r.delivered, channel: r.channel, message: r.message, expiresAt } };
}

export async function cancelInvite(ctx: Ctx, id: string) {
  await guard(ctx, "edit", "cancelar convite", id);
  const u = await ctx.store.getOrThrow("users", id);
  assert(u.status === "invited", "Não há convite pendente para este usuário.");
  const after = await ctx.store.update("users", id, { status: "inactive", inviteTokenHash: null, inviteExpiresAt: null });
  await audit(ctx, { module: "admin", action: "user.invite_cancel", entityType: "user", entityId: id, summary: `Convite de ${u.name} cancelado (link invalidado)` });
  return after;
}

/** Administrador define nova senha (ex.: usuário esqueceu e não há canal de e-mail). */
export async function adminSetPassword(ctx: Ctx, id: string, password: string) {
  await guard(ctx, "edit", "redefinir senha de usuário", id);
  assert(password.length >= 8, "A senha deve ter ao menos 8 caracteres.");
  const u = await ctx.store.getOrThrow("users", id);
  assert(u.status === "active", "Somente usuários ativos podem ter a senha redefinida.");
  const auth = getAuth();
  if (u.authId) {
    if (auth.kind === "local") await auth.createUser(u.email, password, u.name);
    else await auth.setPassword(u.authId, password);
  } else {
    const authId = await auth.createUser(u.email, password, u.name);
    await ctx.store.update("users", id, { authId });
  }
  await endLocalSessions(ctx.store, id);
  await audit(ctx, { module: "admin", action: "user.password_reset", entityType: "user", entityId: id, summary: `Senha de ${u.name} redefinida pelo administrador (sessões encerradas)` });
}

/** Primeiro acesso por convite: valida o token, cria a credencial e ativa o usuário. */
export async function acceptInvite(store: Store, token: string, password: string) {
  assert(password.length >= 8, "A senha deve ter ao menos 8 caracteres.");
  const u = await findOne(store, "users", [["eq", "inviteTokenHash", sha256(token)]]);
  if (!u || u.status !== "invited" || (u.inviteExpiresAt && u.inviteExpiresAt < nowIso())) throw new BusinessError("Convite inválido ou expirado.", "invalid_invite");
  const auth = getAuth();
  const authId = u.authId ?? (await auth.createUser(u.email, password, u.name));
  if (u.authId) await auth.setPassword(u.authId, password);
  if (auth.kind === "local") await auth.createUser(u.email, password, u.name);
  const after = await store.update("users", u.id, { authId, status: "active", inviteTokenHash: null, inviteExpiresAt: null, firstAccessAt: nowIso() });
  const { toCtxUser } = await import("@/lib/auth/users");
  await audit({ store, user: await toCtxUser(store, after), companyId: u.companyIds?.[0] ?? "", branchId: null }, { module: "admin", action: "user.invite_accept", entityType: "user", entityId: u.id, summary: `${u.name} aceitou o convite e definiu a senha (primeiro acesso)` });
  await resolveOccurrence(store, `user:${u.id}:invite`).catch(() => 0);
  return after;
}

/** Motivo de bloqueio de login pela situação do cadastro (null = permitido). */
export function loginBlockReason(u: { status?: string | null; suspendedReason?: string | null } & Record<string, any>): string | null {
  if (u.status === "suspended") return `Acesso suspenso${u.suspendedReason ? `: ${u.suspendedReason}` : ""}. Procure o administrador.`;
  if (u.status === "inactive") return "Usuário inativo. Procure o administrador.";
  if (u.status === "invited") return "Convite pendente: use o link de primeiro acesso enviado ao seu e-mail.";
  if (u.status !== "active") return "Acesso não liberado.";
  return null;
}

/** Autenticação com as mesmas regras da tela de login (situação do cadastro + credencial). */
export async function authenticate(store: Store, login: string, password: string, persistent = false, ip?: string) {
  const user = await findUserByLogin(store, login);
  if (!user) throw new BusinessError("Usuário ou senha inválidos.", "invalid_credentials");
  const attempt = async (why: string) => {
    const { toCtxUser } = await import("@/lib/auth/users");
    await audit({ store, user: await toCtxUser(store, user), companyId: user.companyIds?.[0] ?? "", branchId: null, ip }, { module: "admin", action: "auth.login_failed", entityType: "user", entityId: user.id, summary: `Tentativa de login recusada para ${user.name}: ${why}`, result: "failure" });
  };
  const blocked = loginBlockReason(user);
  if (blocked) {
    await attempt(blocked);
    throw new BusinessError(blocked, "login_blocked");
  }
  try {
    const session = await getAuth().login(user.email, password, persistent);
    return { user, session };
  } catch (e: any) {
    if (e?.message === "invalid_credentials") {
      await attempt("senha incorreta");
      throw new BusinessError("Usuário ou senha inválidos.", "invalid_credentials");
    }
    throw e;
  }
}

/** Indicadores da tela de usuários. */
export async function userStats(store: Store, companyId: string) {
  const users = await companyUsers(store, companyId);
  return {
    total: users.length,
    active: users.filter((u) => u.status === "active").length,
    invited: users.filter((u) => inviteState(u) === "pending").length,
    expired: users.filter((u) => inviteState(u) === "expired").length,
    suspended: users.filter((u) => u.status === "suspended").length,
    inactive: users.filter((u) => u.status === "inactive").length,
    admins: users.filter((u) => u.isAdmin && u.status === "active").length,
    neverAccessed: users.filter((u) => u.status === "active" && !u.lastAccessAt).length,
  };
}
