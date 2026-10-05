"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getStore } from "@/lib/db";
import { getAuth } from "@/lib/auth/provider";
import { accessibleUnits, findUserByLogin, findUserByAuthId, toCtxUser } from "@/lib/auth/users";
import { SESSION_COOKIE, UNIT_COOKIE, getSession } from "@/lib/server/session";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import type { ActionResult } from "@/lib/server/action";
import { ensureBootstrap } from "@/lib/server/bootstrap";

const secure = process.env.NODE_ENV === "production";
const MAX_FAILED = 5;
const LOCK_WINDOW_MIN = 15;

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
  // Bloqueio temporário após tentativas inválidas (registradas no histórico de auditoria)
  const { detId } = await import("@/lib/db");
  const loginKey = detId("login", login.toLowerCase());
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60000).toISOString();
  const recent = await store.list("audit_logs", { filters: [["eq", "entityType", "login"], ["eq", "entityId", loginKey], ["gte", "occurredAt", since]], orderBy: [{ field: "occurredAt", dir: "desc" }], limit: MAX_FAILED + 1 });
  const lastSuccess = recent.items.findIndex((e) => e.result === "success");
  const failures = (lastSuccess === -1 ? recent.items : recent.items.slice(0, lastSuccess)).filter((e) => e.result === "failure").length;
  if (failures >= MAX_FAILED) return { ok: false, error: `Acesso temporariamente bloqueado após ${MAX_FAILED} tentativas inválidas. Tente novamente em ${LOCK_WINDOW_MIN} minutos ou recupere a senha.` };
  const logAttempt = async (result: "success" | "failure", summary: string, u?: any) =>
    store
      .create("audit_logs", {
        companyId: u?.companyIds?.[0] ?? null, userId: u?.id ?? null, userName: u?.name ?? login, module: "admin", action: result === "success" ? "auth.login" : "auth.login_failed",
        entityType: "login", entityId: loginKey, summary, result, ip: ip ?? null, occurredAt: new Date().toISOString(), related: u ? [`user:${u.id}`] : [],
      })
      .catch(() => undefined);
  const user = await findUserByLogin(store, login);
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
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.secret, { httpOnly: true, sameSite: "lax", secure, path: "/", ...(persistent ? { expires: new Date(session.expiresAt) } : {}) });
  await store.update("users", user.id, { lastAccessAt: nowIso(), ...(user.firstAccessAt ? {} : { firstAccessAt: nowIso() }) });
  const { companies, branches } = await accessibleUnits(store, user);
  const pref = await store.get("user_prefs", (await import("@/lib/db")).detId("pref", user.id, "lastUnit"));
  let unit: string | null = null;
  if (pref?.value && typeof pref.value === "string") {
    const [c, b] = pref.value.split(":");
    if (companies.some((x) => x.id === c) && (b === "all" || branches.some((x) => x.id === b))) unit = pref.value;
  }
  if (!unit && companies.length === 1 && branches.filter((b) => b.companyId === companies[0].id).length === 1) unit = `${companies[0].id}:${branches.find((b) => b.companyId === companies[0].id)!.id}`;
  await logAttempt("success", `Login de ${user.name}`, user);
  void toCtxUser;
  void audit;
  if (unit) {
    jar.set(UNIT_COOKIE, unit, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
    return { ok: true, redirect: String(fd.get("next") || "/dashboard") };
  }
  return { ok: true, redirect: "/selecionar-unidade" };
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
  if (branchId !== "all" && !allBranches.some((b) => b.id === branchId && b.companyId === companyId)) return { ok: false, error: "Filial não permitida." };
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
