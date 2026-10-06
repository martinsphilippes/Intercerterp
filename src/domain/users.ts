import crypto from "node:crypto";
import { detId, findOne, isConflict, listAll, sha256 } from "@/lib/db";
import { NotFoundError, type Doc, type Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { sendEmail } from "@/lib/core/email";
import { getSetting } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";
import { DEFAULT_TZ, nowIso } from "@/lib/dates";
import { getAuth } from "@/lib/auth/provider";
import { findUserByLogin, toCtxUser, userRoleIn } from "@/lib/auth/users";
import { resolveOccurrence } from "@/lib/core/notify";
import { can, canDo } from "@/lib/permissions";
import { auditedGuard } from "./roles";

/**
 * Usuários (Tela 36): cadastro, acesso direto ou convite, situação (ativo/inativo/suspenso),
 * perfil, empresas/filiais vinculadas e limite de desconto individual.
 *
 * Regras:
 *  - convite: token aleatório (somente o hash é gravado) com validade; link /convite/<token>;
 *    envio pelo canal de e-mail configurado com resultado real; sem canal, o link é exibido ao administrador;
 *  - suspensão/inativação bloqueia o login (no Appwrite Auth também via setBlocked) e encerra sessões locais;
 *  - nunca deixar a instalação sem administrador ativo (último administrador protegido, também sob concorrência:
 *    a gravação é conferida depois de feita e desfeita se deixar o sistema sem administrador);
 *  - alcance do gestor: só gerencia usuários vinculados à empresa em uso; quem não é administrador não gerencia
 *    administradores, não concede administrador, só vincula às empresas em que também administra usuários e não altera
 *    o próprio vínculo/perfil; vínculos do usuário com empresas fora do alcance do gestor são preservados;
 *  - perfil por empresa: o perfil escolhido vale na empresa em uso (`roleByCompany`); os perfis nas demais empresas
 *    do usuário não mudam.
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
  if (admins.filter((a) => a.id !== user.id).length === 0) throw lastAdminError(user, what);
}

function lastAdminError(user: Doc, what: string) {
  return new BusinessError(`Operação bloqueada: ${user.name} é o último administrador ativo. ${what} deixaria o sistema sem administrador. Conceda acesso de administrador a outro usuário antes.`, "last_admin");
}

/**
 * Usuário-alvo de uma ação administrativa. Precisa estar vinculado à empresa em uso (administradores globais aparecem
 * em todas); quem não é administrador não gerencia o cadastro, a senha nem a situação de um administrador.
 */
async function loadManagedUser(ctx: Ctx, id: string): Promise<Doc> {
  const u = await ctx.store.get("users", id);
  if (!u || !(u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId))) throw new NotFoundError("users", id);
  if (u.isAdmin && !ctx.user.isAdmin) throw new PermissionError("Somente administradores podem gerenciar o cadastro, a senha ou a situação de outro administrador.");
  return u;
}

/**
 * Empresas (dentre as informadas) em que o editor administra usuários: acesso à empresa + perfil daquela empresa com
 * admin/editar e "admin.users" (na empresa em uso, a guarda da operação já conferiu). Administradores: todas.
 */
export async function manageableCompanyIds(ctx: Ctx, companyIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (ctx.user.isAdmin) return new Set(ids);
  const out = new Set<string>();
  const me = ctx.user.id !== "system" ? await unscoped(ctx.store).get("users", ctx.user.id) : null;
  for (const c of ids) {
    if (!(ctx.user.companyIds ?? []).includes(c)) continue;
    if (c === ctx.companyId) {
      out.add(c);
      continue;
    }
    const u = me ? await toCtxUser(ctx.store, me, c) : null;
    if (u && can(u, "admin", "edit") && canDo(u, "admin.users")) out.add(c);
  }
  return out;
}

/**
 * O gestor só altera vínculos (inclusão ou remoção) de empresas em que ele mesmo administra usuários
 * (acesso à empresa + perfil daquela empresa com admin/editar e "admin.users"). Administradores: todas.
 */
async function assertCanManageCompanies(ctx: Ctx, companyIds: string[]) {
  if (ctx.user.isAdmin) return;
  const ok = await manageableCompanyIds(ctx, companyIds);
  for (const c of new Set(companyIds)) {
    if (!(ctx.user.companyIds ?? []).includes(c)) throw new PermissionError("Empresa fora do seu acesso: você só pode vincular usuários às empresas a que tem acesso.");
    if (!ok.has(c)) throw new PermissionError("Seu perfil na outra empresa não permite gerenciar usuários: o vínculo com ela não pode ser alterado por você.");
  }
}

/**
 * Senha, situação, convite, e-mail/login e limite de desconto valem em TODAS as empresas do usuário: quem não é
 * administrador só os altera se administra usuários em todas as empresas vinculadas ao alvo.
 */
async function assertManagesWholeUser(ctx: Ctx, u: Doc, what: string) {
  if (ctx.user.isAdmin) return;
  const companies = [...new Set<string>(u.companyIds ?? [])];
  const ok = await manageableCompanyIds(ctx, companies);
  const outside = companies.filter((c) => !ok.has(c));
  if (!outside.length) return;
  const names = (await Promise.all(outside.map((c) => unscoped(ctx.store).get("companies", c)))).map((c, i) => (c ? c.tradeName || c.name : outside[i]));
  throw new PermissionError(
    `${what}: ${u.name} também tem acesso a ${outside.length === 1 ? "uma empresa" : `${outside.length} empresas`} em que você não administra usuários (${names.join(", ")}). Peça a um administrador ou a quem administra usuários em todas as empresas dele.`,
  );
}

/** Mapa empresa → perfil explícito com o perfil efetivo atual de cada empresa (congela o que hoje vem do perfil legado). */
async function materializeRoles(store: Store, u: Record<string, any>, companyIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of companyIds) {
    const r = await userRoleIn(store, u, c);
    if (r) out[c] = r.id;
  }
  return out;
}

async function validateInput(ctx: Ctx, input: UserInput, selfId?: string) {
  assert(input.name?.trim(), "Informe o nome.");
  const email = input.email?.trim().toLowerCase();
  assert(email && EMAIL_RE.test(email), "Informe um e-mail válido.");
  const login = input.login?.trim().toLowerCase() || null;
  if (login) assert(/^[a-z0-9._-]{3,40}$/.test(login), "Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).");
  if (input.isAdmin && !ctx.user.isAdmin) throw new BusinessError("Somente administradores podem conceder acesso de administrador.", "forbidden");
  const dupEmail = await findOne(ctx.store, "users", [["eq", "email", email]]);
  if (dupEmail && dupEmail.id !== selfId) throw new BusinessError(`E-mail já usado pelo usuário ${dupEmail.name}.`, "duplicate");
  if (login) {
    const dupLogin = await findOne(ctx.store, "users", [["eq", "login", login]]);
    if (dupLogin && dupLogin.id !== selfId) throw new BusinessError(`Login já usado pelo usuário ${dupLogin.name}.`, "duplicate");
  }
  const companyIds = [...new Set(input.companyIds.filter(Boolean))];
  assert(input.isAdmin || companyIds.length > 0, "Vincule o usuário a pelo menos uma empresa.");
  // o perfil escolhido é da empresa em uso: o usuário precisa estar vinculado a ela
  assert(input.isAdmin || companyIds.includes(ctx.companyId), "O usuário precisa continuar vinculado à empresa em uso (o perfil escolhido vale nela). Para remover o vínculo com esta empresa, use Empresas → Usuários a partir de outra empresa ou inative o usuário.");
  // leitura de cadastro (empresas/filiais de qualquer empresa) para validar os vínculos
  const base = unscoped(ctx.store);
  const companies = await listAll(base, "companies");
  for (const c of companyIds) assert(companies.some((x) => x.id === c), "Empresa inválida.");
  const branches = await listAll(base, "branches");
  const branchIds = [...new Set(input.branchIds.filter(Boolean))];
  for (const b of branchIds) {
    const br = branches.find((x) => x.id === b);
    assert(br, "Filial inválida.");
    assert(input.isAdmin || companyIds.includes(br.companyId), `A filial ${br.name} não pertence às empresas vinculadas.`);
  }
  if (input.roleId) {
    const role = await base.get("roles", input.roleId);
    assert(role, "Perfil inválido.");
    assert(role.companyId === ctx.companyId, "Perfil de outra empresa: escolha um perfil da empresa em uso.");
    assert(role.active !== false, "Perfil inativo.");
  } else {
    assert(input.isAdmin, "Selecione o perfil de acesso.");
  }
  if (input.discountLimitBps != null) assert(Number.isInteger(input.discountLimitBps) && input.discountLimitBps >= 0 && input.discountLimitBps <= 10000, "Limite de desconto deve estar entre 0% e 100%.");
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
    html: `<p>Olá, ${user.name}.</p><p>${ctx.user.name} convidou você para acessar o ERP de <b>${companyName}</b>.</p><p>Para definir sua senha e ativar o acesso, abra: <a href="${link}">${link}</a></p><p>O convite expira em ${new Date(expiresAt).toLocaleString("pt-BR", { timeZone: DEFAULT_TZ })}.</p>`,
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
  await assertCanManageCompanies(ctx, data.companyIds);
  // perfil por empresa: o escolhido vale na empresa em uso; nas demais vinculadas, o perfil de sistema equivalente
  const roleByCompany = data.isAdmin || !data.roleId ? {} : { ...(await materializeRoles(ctx.store, { roleId: data.roleId }, data.companyIds)), [ctx.companyId]: data.roleId };
  if (input.mode === "password") {
    assert((input.password ?? "").length >= 8, "A senha inicial deve ter ao menos 8 caracteres.");
    let user: Doc;
    try {
      user = await ctx.store.create("users", { ...data, roleByCompany, status: "active", createdBy: ctx.user.id }, id);
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
    user = await ctx.store.create("users", { ...data, roleByCompany, status: "invited", inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, invitedBy: ctx.user.id, createdBy: ctx.user.id }, id);
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

const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export async function updateUser(ctx: Ctx, id: string, input: UserInput) {
  await guard(ctx, "edit", `alterar usuário ${input.email}`, id);
  const before = await loadManagedUser(ctx, id);
  const base = unscoped(ctx.store);
  const currentRole = before.isAdmin ? null : await userRoleIn(ctx.store, before, ctx.companyId);
  let merged: UserInput = { ...input };
  if (!ctx.user.isAdmin) {
    // alcance do gestor = empresas em que ele administra usuários (admin/editar + "admin.users" no perfil DAQUELA empresa).
    // Vínculos com empresas (e filiais delas) fora desse alcance são preservados — merge no servidor; incluir filial de
    // empresa fora do alcance é recusado.
    const inputCompanies = input.companyIds.filter(Boolean);
    const manageable = await manageableCompanyIds(ctx, [...(before.companyIds ?? []), ...inputCompanies]);
    const branchCompany = new Map((await listAll(base, "branches")).map((b) => [b.id, b.companyId as string]));
    const inScope = (b: string) => manageable.has(branchCompany.get(b) ?? "");
    const keptCompanies = (before.companyIds ?? []).filter((c: string) => !manageable.has(c));
    const keptBranches = (before.branchIds ?? []).filter((b: string) => !inScope(b));
    const addedOutside = input.branchIds.filter((b) => b && !inScope(b) && !(before.branchIds ?? []).includes(b) && branchCompany.has(b));
    if (addedOutside.length) throw new PermissionError("Filial de empresa em que você não administra usuários: o acesso a ela não pode ser alterado por você.");
    merged = {
      ...input,
      companyIds: [...new Set([...inputCompanies, ...keptCompanies])],
      branchIds: [...new Set([...input.branchIds.filter((b) => b && (inScope(b) || !branchCompany.has(b))), ...keptBranches])],
    };
    // dados de acesso e limite de desconto valem em todas as empresas do usuário
    const emailChanged = (input.email?.trim().toLowerCase() ?? "") !== (before.email ?? "");
    const loginChanged = (input.login?.trim().toLowerCase() || null) !== (before.login ?? null);
    if (emailChanged || loginChanged) await assertManagesWholeUser(ctx, before, "Alterar e-mail ou login");
    if ((input.discountLimitBps ?? null) !== (before.discountLimitBps ?? null)) await assertManagesWholeUser(ctx, before, "Alterar o limite de desconto");
    if (id === ctx.user.id) {
      const changed =
        !sameSet([...new Set(merged.companyIds.filter(Boolean))], before.companyIds ?? []) ||
        !sameSet([...new Set(merged.branchIds.filter(Boolean))], before.branchIds ?? []) ||
        (merged.roleId || null) !== (currentRole?.id ?? null) ||
        (merged.discountLimitBps ?? null) !== (before.discountLimitBps ?? null);
      if (changed) throw new PermissionError("Você não pode alterar o próprio vínculo, perfil ou limite de desconto. Peça a outro gestor de usuários.");
    }
  }
  const data = await validateInput(ctx, merged, id);
  const added = data.companyIds.filter((c) => !(before.companyIds ?? []).includes(c));
  const removed = (before.companyIds ?? []).filter((c: string) => !data.companyIds.includes(c));
  await assertCanManageCompanies(ctx, [...added, ...removed]);
  // perfil por empresa: só o perfil da empresa em uso muda; os das outras empresas ficam explícitos e preservados
  const others = data.companyIds.filter((c) => c !== ctx.companyId);
  const roleByCompany: Record<string, string> = data.isAdmin ? { ...(before.roleByCompany ?? {}) } : await materializeRoles(ctx.store, before, others);
  if (!data.isAdmin) {
    for (const c of Object.keys(roleByCompany)) if (!data.companyIds.includes(c)) delete roleByCompany[c];
    if (data.roleId) roleByCompany[ctx.companyId] = data.roleId;
  }
  const legacy = before.roleId ? await base.get("roles", before.roleId) : null;
  // perfil legado (roleId): segue o perfil desta empresa quando era daqui (ou não havia); se é de outra empresa vinculada, fica
  const roleId = legacy && legacy.companyId !== ctx.companyId && data.companyIds.includes(legacy.companyId) ? before.roleId : data.roleId;
  const patch = { ...data, roleId, roleByCompany };

  if (before.isAdmin && !data.isAdmin) {
    if (!ctx.user.isAdmin) throw new BusinessError("Somente administradores podem revogar acesso de administrador.", "forbidden");
    await assertNotLastAdmin(ctx.store, before, "Remover o acesso de administrador");
    // rebaixamento primeiro e conferido depois de gravado (dois administradores rebaixando um ao outro ao mesmo tempo)
    await ctx.store.update("users", id, { isAdmin: false, roleId, roleByCompany });
    if (before.status === "active" && (await activeAdmins(ctx.store)).length === 0) {
      await ctx.store.update("users", id, { isAdmin: true, roleId: before.roleId ?? null, roleByCompany: before.roleByCompany ?? null });
      throw lastAdminError(before, "Remover o acesso de administrador");
    }
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
      if (before.isAdmin && !data.isAdmin) await ctx.store.update("users", id, { isAdmin: true, roleId: before.roleId ?? null, roleByCompany: before.roleByCompany ?? null });
      throw new BusinessError(`O serviço de autenticação recusou a alteração: ${e?.message ?? e}`, "auth_failed");
    }
  }
  const after = await ctx.store.update("users", id, patch);
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit(ctx, { module: "admin", action: "user.update", entityType: "user", entityId: id, summary: `Cadastro/acesso de ${after.name} alterado`, before: d.before, after: d.after, related: [currentRole?.id, data.roleId].filter(Boolean).map((r) => `role:${r}`) });
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
  const u = await loadManagedUser(ctx, id);
  assert(u.id !== ctx.user.id, "Você não pode alterar a situação do seu próprio acesso.");
  await assertManagesWholeUser(ctx, u, "Alterar a situação do acesso");
  if (status === "suspended") assert(reason?.trim(), "Informe o motivo da suspensão.");
  if (status === u.status) return u;
  const what = status === "suspended" ? "Suspender" : "Inativar";
  if (status !== "active") await assertNotLastAdmin(ctx.store, u, what);
  const auth = getAuth();
  let after: Doc;
  if (status === "active") {
    if (!u.authId) throw new BusinessError("Este usuário ainda não definiu senha. Reenvie o convite para que ele ative o acesso.", "no_credentials");
    await auth.setBlocked(u.authId, false);
    after = await ctx.store.update("users", id, { status: "active", suspendedReason: null, suspendedAt: null });
  } else {
    after = await ctx.store.update("users", id, { status, suspendedReason: reason?.trim() || null, suspendedAt: status === "suspended" ? nowIso() : null, inviteTokenHash: null, inviteExpiresAt: null });
    // conferência depois da gravação: sob concorrência (dois administradores suspendendo um ao outro), desfaz e recusa
    if (u.isAdmin && u.status === "active" && (await activeAdmins(ctx.store)).length === 0) {
      await ctx.store.update("users", id, { status: u.status, suspendedReason: u.suspendedReason ?? null, suspendedAt: u.suspendedAt ?? null, inviteTokenHash: u.inviteTokenHash ?? null, inviteExpiresAt: u.inviteExpiresAt ?? null });
      throw lastAdminError(u, what);
    }
    if (u.authId) await auth.setBlocked(u.authId, true);
  }
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
  const u = await loadManagedUser(ctx, id);
  await assertManagesWholeUser(ctx, u, "Reenviar o convite");
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
  const u = await loadManagedUser(ctx, id);
  await assertManagesWholeUser(ctx, u, "Cancelar o convite");
  assert(u.status === "invited", "Não há convite pendente para este usuário.");
  const after = await ctx.store.update("users", id, { status: "inactive", inviteTokenHash: null, inviteExpiresAt: null });
  await audit(ctx, { module: "admin", action: "user.invite_cancel", entityType: "user", entityId: id, summary: `Convite de ${u.name} cancelado (link invalidado)` });
  return after;
}

/** Administrador define nova senha (ex.: usuário esqueceu e não há canal de e-mail). */
export async function adminSetPassword(ctx: Ctx, id: string, password: string) {
  await guard(ctx, "edit", "redefinir senha de usuário", id);
  assert(password.length >= 8, "A senha deve ter ao menos 8 caracteres.");
  const u = await loadManagedUser(ctx, id);
  await assertManagesWholeUser(ctx, u, "Redefinir a senha");
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
  await audit({ store, user: await toCtxUser(store, after, u.companyIds?.[0] ?? null), companyId: u.companyIds?.[0] ?? "", branchId: null }, { module: "admin", action: "user.invite_accept", entityType: "user", entityId: u.id, summary: `${u.name} aceitou o convite e definiu a senha (primeiro acesso)` });
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
    await audit({ store, user: await toCtxUser(store, user, user.companyIds?.[0] ?? null), companyId: user.companyIds?.[0] ?? "", branchId: null, ip }, { module: "admin", action: "auth.login_failed", entityType: "user", entityId: user.id, summary: `Tentativa de login recusada para ${user.name}: ${why}`, result: "failure" });
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
