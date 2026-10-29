"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getStore } from "@/lib/db";
import { getAuth } from "@/lib/auth/provider";
import { accessibleUnits, findUserByLogin, findUserByAuthId, toCtxUser, unitBlockReason } from "@/lib/auth/users";
import { safeNextPath } from "@/lib/auth/redirect";
import { MFA_COOKIE, SESSION_COOKIE, UNIT_COOKIE, getSession } from "@/lib/server/session";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import type { ActionResult } from "@/lib/server/action";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { CHALLENGE_TTL_MIN, LOCK_WINDOW_MIN, MAX_LOGIN_FAILURES, completeLoginChallenge, createLoginChallenge, dropChallenge, loadLoginChallenge, logLoginAttempt, loginKeyFor, recentLoginFailures } from "@/domain/two-factor";

const secure = process.env.NODE_ENV === "production";
const MAX_FAILED = MAX_LOGIN_FAILURES;

async function rememberUnit(userId: string, value: string) {
  const store = getStore();
  const { detId } = await import("@/lib/db");
  const id = detId("pref", userId, "lastUnit");
  const existing = await store.get("user_prefs", id);
  if (existing) await store.update("user_prefs", id, { value });
  else await store.create("user_prefs", { userId, key: "lastUnit", value }, id).catch(() => undefined);
}

export async function loginAction(fd: FormData): Promise<ActionResult> {
  await ensureBootstrap();
  const login = String(fd.get("login") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const persistent = fd.get("remember") === "on";
  if (!login || !password) return { ok: false, error: "Informe usuário/e-mail e senha." };
  const store = getStore();
  const h0 = await headers();
  const ip = h0.get("x-forwarded-for")?.split(",")[0] ?? undefined;
  // Bloqueio temporário após tentativas inválidas (registradas no histórico de auditoria): contador único por usuário
  // (qualquer apelido: login ou e-mail; texto normalizado quando o usuário não existe), compartilhado com a segunda etapa
  const userForKey = await findUserByLogin(store, login);
  const loginKey = loginKeyFor(userForKey, login);
  const failures = await recentLoginFailures(store, loginKey);
  if (failures >= MAX_FAILED) return { ok: false, error: `Acesso temporariamente bloqueado após ${MAX_FAILED} tentativas inválidas. Tente novamente em ${LOCK_WINDOW_MIN} minutos ou recupere a senha.` };
  const logAttempt = async (result: "success" | "failure", summary: string, u?: any) =>
    logLoginAttempt(store, { loginKey, result, action: result === "success" ? "auth.login" : "auth.login_failed", summary, user: u ?? null, loginText: login, ip: ip ?? null });
  const user = userForKey;
  if (!user) {
    await logAttempt("failure", `Tentativa de login inválida (usuário inexistente: ${login.slice(0, 60)})`);
    return { ok: false, error: "Usuário ou senha inválidos." };
  }
  if (user.status === "inactive" || user.status === "suspended") {
    await logAttempt("failure", `Login recusado para ${user.name}: usuário ${user.status === "suspended" ? "suspenso" : "inativo"}`, user);
    return { ok: false, error: user.status === "suspended" ? `Acesso suspenso${user.suspendedReason ? `: ${user.suspendedReason}` : ""}. Procure o administrador.` : "Usuário inativo. Procure o administrador." };
  }
  if (user.status === "invited") {
    await logAttempt("failure", `Login recusado para ${user.name}: convite pendente`, user);
    return { ok: false, error: "Convite pendente: use o link de primeiro acesso enviado ao seu e-mail." };
  }
  let session;
  try {
    session = await getAuth().login(user.email, password, persistent);
  } catch (e: any) {
    if (e.message === "invalid_credentials") {
      await logAttempt("failure", `Senha inválida para ${user.name}`, user);
      const left = MAX_FAILED - failures - 1;
      return { ok: false, error: left > 0 ? `Usuário ou senha inválidos. ${left} tentativa(s) restante(s) antes do bloqueio temporário.` : `Usuário ou senha inválidos. Acesso bloqueado por ${LOCK_WINDOW_MIN} minutos.` };
    }
    console.error("[login]", e);
    return { ok: false, error: "Serviço de autenticação indisponível. Tente novamente em instantes." };
  }
  // §44: autenticação em duas etapas — a sessão fica guardada (cifrada) até o código; "manter conectado" não pula a etapa
  const challenge = await createLoginChallenge(store, { user, session, persistent, next: String(fd.get("next") ?? ""), loginKey, ip: ip ?? null });
  if (challenge) {
    await logLoginAttempt(store, { loginKey, result: "pending", action: "auth.password_ok", summary: `Senha correta de ${user.name} — aguardando ${challenge.kind === "enroll" ? "o cadastro do aplicativo autenticador (exigido pelo perfil)" : "o código de verificação"}`, user, ip: ip ?? null });
    const jar = await cookies();
    jar.set(MFA_COOKIE, challenge.token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: CHALLENGE_TTL_MIN * 60 });
    return { ok: true, redirect: "/login/duas-etapas" };
  }
  return { ok: true, redirect: await finishLogin(user, session, persistent, fd.get("next"), logAttempt) };
}

/** Sessão aceita (senha e, se houver, segunda etapa): cookies de sessão e de unidade, último acesso e registro do login. */
async function finishLogin(user: Record<string, any>, session: { secret: string; expiresAt: string }, persistent: boolean, next: unknown, logAttempt: (result: "success", summary: string, u?: any) => Promise<unknown>, summary?: string) {
  const store = getStore();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.secret, { httpOnly: true, sameSite: "lax", secure, path: "/", ...(persistent ? { expires: new Date(session.expiresAt) } : {}) });
  await store.update("users", user.id, { lastAccessAt: nowIso(), ...(user.firstAccessAt ? {} : { firstAccessAt: nowIso() }) });
  const { companies, branches } = await accessibleUnits(store, user as any);
  const pref = await store.get("user_prefs", (await import("@/lib/db")).detId("pref", user.id, "lastUnit"));
  let unit: string | null = null;
  // unidade lembrada ou única: somente empresa e filial ativas (inativas não são contexto de trabalho)
  const activeCompanies = companies.filter((c) => !unitBlockReason(c, null));
  const activeBranches = branches.filter((b) => activeCompanies.some((c) => c.id === b.companyId) && !unitBlockReason(null, b));
  if (pref?.value && typeof pref.value === "string") {
    const [c, b] = pref.value.split(":");
    const canAll = Boolean(user.isAdmin) || !(user.branchIds ?? []).length;
    if (activeCompanies.some((x) => x.id === c) && ((b === "all" && canAll) || activeBranches.some((x) => x.id === b && x.companyId === c))) unit = pref.value;
  }
  if (!unit && activeCompanies.length === 1 && activeBranches.length === 1) unit = `${activeCompanies[0].id}:${activeBranches[0].id}`;
  await logAttempt("success", summary ?? `Login de ${user.name}`, user);
  void toCtxUser;
  void audit;
  if (unit) {
    jar.set(UNIT_COOKIE, unit, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
    return safeNextPath(next);
  }
  return "/selecionar-unidade";
}

/**
 * §44 — segunda etapa do login: código do aplicativo autenticador (ou de recuperação) ou confirmação do cadastro
 * exigido pelo perfil. Código errado conta nas tentativas do bloqueio temporário.
 */
export async function verifyTwoFactorLoginAction(fd: FormData): Promise<ActionResult<{ recoveryCodes?: string[]; next?: string; remaining?: number }>> {
  await ensureBootstrap();
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  const code = String(fd.get("code") ?? "");
  if (!code.trim()) return { ok: false, error: "Informe o código." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? null;
  const store = getStore();
  const { loginBlockReason } = await import("@/domain/users");
  const r = await completeLoginChallenge(store, token ?? "", code, { ip, blockReason: loginBlockReason });
  if (r.status === "invalid") return { ok: false, error: `Código inválido. ${r.left} tentativa(s) restante(s) antes do bloqueio temporário.`, code: "invalid_code" };
  if (r.status !== "ok") {
    jar.delete(MFA_COOKIE);
    return { ok: false, error: r.message, code: r.status };
  }
  jar.delete(MFA_COOKIE);
  const loginKey = loginKeyFor(r.user as any, r.user.email);
  const logAttempt = (result: "success", summary: string, u?: any) => logLoginAttempt(store, { loginKey, result, action: "auth.login", summary, user: u ?? r.user, ip });
  const how = r.method === "enroll" ? "cadastro do autenticador confirmado" : r.method === "recovery" ? `código de recuperação (restam ${r.remaining ?? 0})` : "código do autenticador";
  const target = await finishLogin(r.user, r.session, r.persistent, r.next, logAttempt, `Login de ${r.user.name} (duas etapas: ${how})`);
  // cadastro: os códigos de recuperação aparecem uma única vez antes de seguir para o sistema
  if (r.recoveryCodes) return { ok: true, data: { recoveryCodes: r.recoveryCodes, next: target } };
  return { ok: true, redirect: target, ...(r.method === "recovery" ? { message: `Código de recuperação usado. Restam ${r.remaining ?? 0}.` } : {}) };
}

/** Volta ao login: descarta a segunda etapa pendente (a sessão guardada é encerrada). */
export async function cancelTwoFactorLoginAction(): Promise<ActionResult> {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  const ch = await loadLoginChallenge(getStore(), token);
  if (ch) await dropChallenge(getStore(), ch);
  jar.delete(MFA_COOKIE);
  return { ok: true, redirect: "/login" };
}

export async function logoutAction() {
  const jar = await cookies();
  const secret = jar.get(SESSION_COOKIE)?.value;
  if (secret) await getAuth().logout(secret);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function switchUnitAction(companyId: string, branchId: string) {
  const s = await getSession();
  if (!s) redirect("/login");
  const company = s.companies.find((c) => c.id === companyId);
  const allBranches = (await accessibleUnits(getStore(), (await getStore().get("users", s.user.id))!)).branches;
  if (!company) return { ok: false, error: "Empresa não permitida." };
  const companyBlocked = unitBlockReason(company, null);
  if (companyBlocked) return { ok: false, error: companyBlocked };
  if (branchId === "all" && !s.canConsolidate) return { ok: false, error: "O contexto consolidado exige acesso a todas as filiais. Escolha uma filial." };
  const branch = branchId !== "all" ? allBranches.find((b) => b.id === branchId && b.companyId === companyId) : null;
  if (branchId !== "all" && !branch) return { ok: false, error: "Filial não permitida." };
  const branchBlocked = unitBlockReason(null, branch);
  if (branchBlocked) return { ok: false, error: branchBlocked };
  const value = `${companyId}:${branchId}`;
  const jar = await cookies();
  jar.set(UNIT_COOKIE, value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
  await rememberUnit(s.user.id, value);
  return { ok: true };
}

export async function selectUnitAction(fd: FormData): Promise<ActionResult> {
  const v = String(fd.get("unit") ?? "");
  const [c, b] = v.split(":");
  const r = await switchUnitAction(c, b);
  if (!r.ok) return { ok: false, error: r.error ?? "Seleção inválida." };
  return { ok: true, redirect: "/dashboard" };
}

export async function requestRecoveryAction(fd: FormData): Promise<ActionResult> {
  const login = String(fd.get("login") ?? "").trim();
  if (!login) return { ok: false, error: "Informe seu usuário ou e-mail." };
  const store = getStore();
  const user = await findUserByLogin(store, login);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  // resposta neutra (não revela se o e-mail existe)
  const neutral = "Se o usuário existir, as instruções de recuperação foram encaminhadas pelo canal configurado.";
  if (!user) return { ok: true, message: neutral };
  try {
    const r = await getAuth().requestRecovery(user.email, `${origin}/redefinir-senha`);
    if (!r.delivered) {
      return {
        ok: true,
        message: r.devLink
          ? `Canal de e-mail não configurado. Link de recuperação (somente ambiente de desenvolvimento): ${r.devLink}`
          : "O envio de e-mail não está configurado nesta instalação. Solicite ao administrador a redefinição da sua senha.",
      };
    }
  } catch (e: any) {
    console.error("[recovery]", e);
    return { ok: false, error: "Não foi possível solicitar a recuperação agora. Tente novamente ou contate o suporte." };
  }
  return { ok: true, message: neutral };
}

export async function completeRecoveryAction(fd: FormData): Promise<ActionResult> {
  const userId = String(fd.get("userId") ?? "");
  const secret = String(fd.get("secret") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password.length < 8) return { ok: false, error: "A senha deve ter ao menos 8 caracteres." };
  if (password !== confirm) return { ok: false, error: "As senhas não conferem." };
  try {
    await getAuth().completeRecovery({ userId, secret, password });
  } catch {
    return { ok: false, error: "Link inválido ou expirado. Solicite uma nova recuperação." };
  }
  return { ok: true, message: "Senha redefinida. Entre com a nova senha.", redirect: "/login" };
}

/** Primeiro acesso por convite: define senha e ativa o usuário (auditado no domínio). */
export async function acceptInviteAction(fd: FormData): Promise<ActionResult> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ok: false, error: "As senhas não conferem." };
  try {
    const { acceptInvite } = await import("@/domain/users");
    await acceptInvite(getStore(), token, password);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Convite inválido ou expirado." };
  }
  return { ok: true, message: "Acesso ativado. Entre com seu e-mail e a nova senha.", redirect: "/login" };
}

export async function currentUserAuthId() {
  const jar = await cookies();
  const secret = jar.get(SESSION_COOKIE)?.value;
  if (!secret) return null;
  const authId = await getAuth().verify(secret);
  return authId ? findUserByAuthId(getStore(), authId) : null;
}
