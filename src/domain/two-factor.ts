import crypto from "node:crypto";
import { detId, isConflict, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { getAuth } from "@/lib/auth/provider";
import { userRoleIn } from "@/lib/auth/users";
import { openSecret, sealSecret } from "@/lib/auth/secret-box";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, normalizeCode, normalizeRecoveryCode, otpauthUri, verifyTotp } from "@/lib/auth/totp";

/**
 * Autenticação em duas etapas (TOTP — §44, Tela 36).
 *
 *  - Cadastro: segredo novo (160 bits) guardado CIFRADO como pendente; ativa só depois de um código válido. Depois de
 *    ativado, o segredo não é mais exibido. Dez códigos de recuperação de uso único, guardados só como hash.
 *  - Login: depois da senha correta, a sessão do provedor fica guardada cifrada num desafio (`auth_challenges`, 10 min);
 *    o navegador só recebe o cookie de sessão com o código do autenticador (ou de recuperação). Código errado conta
 *    nas mesmas 5 tentativas do bloqueio temporário do login. Perfil com "Exigir autenticação em duas etapas" e usuário
 *    sem cadastro: o desafio é de cadastro (QR code + confirmação) antes de qualquer acesso.
 *  - Desativar exige senha + código (e não é permitido quando o perfil exige); o administrador pode redefinir (auditado).
 */

export const MAX_LOGIN_FAILURES = 5;
export const LOCK_WINDOW_MIN = 15;
export const CHALLENGE_TTL_MIN = 10;
export const TOTP_ISSUER = "Intercert ERP";

// ───────────────────────────── bloqueio por tentativas (compartilhado com a senha)

/** Contador único de tentativas por usuário (qualquer apelido: login ou e-mail); texto normalizado se o usuário não existe. */
export function loginKeyFor(user: { id: string } | null | undefined, text: string) {
  return user ? detId("login", "user", user.id) : detId("login", "text", text.trim().toLowerCase());
}

/** Tentativas inválidas desde o último acesso bem-sucedido, na janela do bloqueio temporário. */
export async function recentLoginFailures(store: Store, loginKey: string, now = Date.now()) {
  const since = new Date(now - LOCK_WINDOW_MIN * 60000).toISOString();
  const recent = await unscoped(store).list("audit_logs", { filters: [["eq", "entityType", "login"], ["eq", "entityId", loginKey], ["gte", "occurredAt", since]], orderBy: [{ field: "occurredAt", dir: "desc" }], limit: MAX_LOGIN_FAILURES + 20 });
  const lastSuccess = recent.items.findIndex((e) => e.result === "success");
  return (lastSuccess === -1 ? recent.items : recent.items.slice(0, lastSuccess)).filter((e) => e.result === "failure").length;
}

/** Registra uma tentativa de acesso (senha ou segunda etapa) no histórico — base do bloqueio. */
export async function logLoginAttempt(store: Store, input: { loginKey: string; result: "success" | "failure" | "pending"; action: string; summary: string; user?: Record<string, any> | null; loginText?: string; ip?: string | null }) {
  const u = input.user;
  await unscoped(store)
    .create("audit_logs", {
      companyId: u?.companyIds?.[0] ?? null, userId: u?.id ?? null, userName: u?.name ?? input.loginText ?? null, module: "admin", action: input.action,
      entityType: "login", entityId: input.loginKey, summary: input.summary.slice(0, 500), result: input.result, ip: input.ip ?? null, occurredAt: nowIso(), related: u ? [`user:${u.id}`] : [],
    })
    .catch(() => undefined);
}

// ───────────────────────────── exigência por perfil

/** O usuário precisa da segunda etapa: 2FA ativo ou algum perfil dele (em qualquer empresa) exige. */
export async function userRequiresTwoFactor(store: Store, u: Doc): Promise<boolean> {
  if (u.isAdmin) return false;
  const companies = [...new Set<string>(u.companyIds ?? [])];
  for (const cid of companies) {
    const role = await userRoleIn(store, u, cid);
    if (role?.requireTwoFactor) return true;
  }
  if (!companies.length && u.roleId) {
    const role = await unscoped(store).get("roles", u.roleId);
    if (role?.requireTwoFactor) return true;
  }
  return false;
}

// ───────────────────────────── verificação do código

/**
 * Confere o código do autenticador (6 dígitos, sem reuso do mesmo intervalo) ou um código de recuperação (consumido).
 * Trava de uso único por id determinístico: duas tentativas simultâneas com o mesmo código não passam as duas.
 */
export async function verifySecondFactor(store: Store, user: Doc, code: string): Promise<{ ok: true; method: "totp" | "recovery"; remaining: number } | { ok: false }> {
  const base = unscoped(store);
  const raw = String(code ?? "").trim();
  const digits = normalizeCode(raw);
  const lock = async (key: string) => {
    try {
      await base.create("operations", { companyId: null, type: "mfa_use", status: "done", entityType: "user", entityId: user.id, createdBy: user.id }, detId("mfa_use", user.id, key));
      return true;
    } catch (e) {
      if (isConflict(e)) return false;
      throw e;
    }
  };
  if (/^[\d\s]+$/.test(raw) && digits.length === 6) {
    const secret = openSecret(user.totpSecretEnc);
    if (!user.totpEnabled || !secret) return { ok: false };
    const step = verifyTotp(secret, digits, { afterStep: user.totpLastStep ?? null });
    if (step == null || !(await lock(`step:${step}`))) return { ok: false };
    await base.update("users", user.id, { totpLastStep: step });
    return { ok: true, method: "totp", remaining: (user.totpRecoveryHashes ?? []).length };
  }
  if (normalizeRecoveryCode(raw).length !== 10) return { ok: false };
  const hash = hashRecoveryCode(raw);
  const hashes: string[] = user.totpRecoveryHashes ?? [];
  if (!user.totpEnabled || !hashes.includes(hash) || !(await lock(`recovery:${hash}`))) return { ok: false };
  const fresh = await base.get("users", user.id);
  const remaining = ((fresh?.totpRecoveryHashes ?? hashes) as string[]).filter((h) => h !== hash);
  await base.update("users", user.id, { totpRecoveryHashes: remaining });
  return { ok: true, method: "recovery", remaining: remaining.length };
}

/** Dados de ativação: segredo cifrado + códigos de recuperação (só o hash é guardado; os códigos vão para a tela uma vez). */
function activation(secret: string, step: number) {
  const codes = generateRecoveryCodes(10);
  return {
    codes,
    patch: { totpEnabled: true, totpSecretEnc: sealSecret(secret), totpPendingEnc: null, totpEnabledAt: nowIso(), totpRecoveryHashes: codes.map(hashRecoveryCode), totpLastStep: step },
  };
}

function enrollmentView(user: Doc, secret: string) {
  return { secret, uri: otpauthUri({ issuer: TOTP_ISSUER, account: user.login || user.email, secret }) };
}

// ───────────────────────────── login em duas etapas

export type ChallengeKind = "verify" | "enroll";

/**
 * Depois da senha correta: decide se há segunda etapa. Sem 2FA ativo e sem perfil exigindo, devolve null (login segue).
 * Senão guarda a sessão do provedor cifrada num desafio e devolve o token (cookie httpOnly) e o tipo.
 */
export async function createLoginChallenge(store: Store, input: { user: Doc; session: { secret: string; expiresAt: string }; persistent: boolean; next?: string | null; loginKey: string; ip?: string | null }): Promise<{ token: string; kind: ChallengeKind } | null> {
  const { user } = input;
  const kind: ChallengeKind | null = user.totpEnabled && user.totpSecretEnc ? "verify" : (await userRequiresTwoFactor(store, user)) ? "enroll" : null;
  if (!kind) return null;
  // um desafio pendente por usuário: os anteriores (abandonados) são descartados com a sessão que guardavam
  for (const old of (await unscoped(store).list("auth_challenges", { filters: [["eq", "userId", user.id]], limit: 20 })).items) await dropChallenge(store, old);
  const token = crypto.randomBytes(32).toString("hex");
  await unscoped(store).create("auth_challenges", {
    tokenHash: sha256(token), userId: user.id, kind, sessionEnc: sealSecret(input.session.secret), sessionExpiresAt: input.session.expiresAt, persistent: input.persistent,
    next: input.next?.slice(0, 300) ?? null, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MIN * 60000).toISOString(), loginKey: input.loginKey,
    pendingSecretEnc: kind === "enroll" ? sealSecret(generateTotpSecret()) : null, ip: input.ip ?? null,
  });
  return { token, kind };
}

/** Desafio válido do token (expirado: descartado, com a sessão do provedor encerrada). */
export async function loadLoginChallenge(store: Store, token: string | null | undefined): Promise<Doc | null> {
  if (!token) return null;
  const base = unscoped(store);
  const ch = (await base.list("auth_challenges", { filters: [["eq", "tokenHash", sha256(token)]], limit: 1 })).items[0] ?? null;
  if (!ch) return null;
  if (ch.expiresAt < nowIso()) {
    await dropChallenge(store, ch);
    return null;
  }
  return ch;
}

/** Descarta o desafio e encerra a sessão do provedor que ele guardava (o cookie nunca foi entregue). */
export async function dropChallenge(store: Store, ch: Doc) {
  const secret = openSecret(ch.sessionEnc);
  await unscoped(store).delete("auth_challenges", ch.id).catch(() => undefined);
  if (secret) await getAuth().logout(secret).catch(() => undefined);
}

/** Dados para a tela da segunda etapa (cadastro: segredo e URI do QR code; nunca depois da ativação). */
export async function challengeView(store: Store, ch: Doc) {
  const user = await unscoped(store).get("users", ch.userId);
  if (!user) return null;
  const pending = ch.kind === "enroll" ? openSecret(ch.pendingSecretEnc) : null;
  return { kind: ch.kind as ChallengeKind, userName: user.name as string, account: (user.login || user.email) as string, enrollment: pending ? enrollmentView(user, pending) : null };
}

export type ChallengeResult =
  | { status: "ok"; user: Doc; session: { secret: string; expiresAt: string }; persistent: boolean; next: string | null; method: "totp" | "recovery" | "enroll"; recoveryCodes?: string[]; remaining?: number }
  | { status: "invalid"; left: number }
  | { status: "locked" | "expired" | "blocked"; message: string };

/**
 * Confere o código do desafio. Código errado registra tentativa inválida (mesmo contador da senha); na 5ª o desafio é
 * descartado e o acesso fica bloqueado pela janela do bloqueio temporário.
 */
export async function completeLoginChallenge(store: Store, token: string, code: string, opts: { ip?: string | null; blockReason?: (u: Doc) => string | null } = {}): Promise<ChallengeResult> {
  const base = unscoped(store);
  const ch = await loadLoginChallenge(store, token);
  if (!ch) return { status: "expired", message: "A etapa de verificação expirou. Entre novamente com usuário e senha." };
  const user = await base.get("users", ch.userId);
  const blocked = !user ? "Usuário inexistente." : opts.blockReason?.(user) ?? null;
  if (!user || blocked) {
    await dropChallenge(store, ch);
    return { status: "blocked", message: blocked ?? "Acesso não liberado." };
  }
  const failures = await recentLoginFailures(store, ch.loginKey);
  if (failures >= MAX_LOGIN_FAILURES) {
    await dropChallenge(store, ch);
    return { status: "locked", message: `Acesso temporariamente bloqueado após ${MAX_LOGIN_FAILURES} tentativas inválidas. Tente novamente em ${LOCK_WINDOW_MIN} minutos.` };
  }
  let method: "totp" | "recovery" | "enroll" | null = null;
  let recoveryCodes: string[] | undefined;
  let remaining: number | undefined;
  if (ch.kind === "enroll") {
    const secret = openSecret(ch.pendingSecretEnc);
    const step = secret ? verifyTotp(secret, code) : null;
    if (secret && step != null) {
      const act = activation(secret, step);
      await base.update("users", user.id, act.patch);
      recoveryCodes = act.codes;
      method = "enroll";
      await audit({ store: base, user: { id: user.id, name: user.name, email: user.email, isAdmin: Boolean(user.isAdmin), permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: user.companyIds ?? [] }, companyId: user.companyIds?.[0] ?? "", branchId: null, ip: opts.ip ?? undefined }, {
        module: "admin", action: "user.2fa_enable", entityType: "user", entityId: user.id, summary: `${user.name} cadastrou o aplicativo autenticador no login (autenticação em duas etapas exigida pelo perfil)`,
      });
    }
  } else {
    const r = await verifySecondFactor(store, user, code);
    if (r.ok) {
      method = r.method;
      remaining = r.remaining;
    }
  }
  if (!method) {
    await logLoginAttempt(store, { loginKey: ch.loginKey, result: "failure", action: "auth.2fa_failed", summary: `Código de verificação inválido para ${user.name} (segunda etapa do login)`, user, ip: opts.ip });
    const left = MAX_LOGIN_FAILURES - failures - 1;
    if (left <= 0) {
      await dropChallenge(store, ch);
      return { status: "locked", message: `Código inválido. Acesso bloqueado por ${LOCK_WINDOW_MIN} minutos.` };
    }
    return { status: "invalid", left };
  }
  const secret = openSecret(ch.sessionEnc);
  await base.delete("auth_challenges", ch.id).catch(() => undefined);
  if (!secret) return { status: "expired", message: "A etapa de verificação expirou. Entre novamente com usuário e senha." };
  if (method === "recovery") {
    await logLoginAttempt(store, { loginKey: ch.loginKey, result: "pending", action: "auth.2fa_recovery_used", summary: `${user.name} entrou com um código de recuperação (restam ${remaining ?? 0})`, user, ip: opts.ip });
  }
  return { status: "ok", user, session: { secret, expiresAt: ch.sessionExpiresAt }, persistent: Boolean(ch.persistent), next: ch.next ?? null, method, recoveryCodes, remaining };
}

// ───────────────────────────── cadastro e gestão pelo próprio usuário

async function selfUser(ctx: Ctx) {
  const u = await unscoped(ctx.store).get("users", ctx.user.id);
  assert(u && u.status === "active", "Usuário não encontrado.");
  return u;
}

/** Situação do 2FA do usuário (sem segredos). */
export function twoFactorState(u: Record<string, any>) {
  return { enabled: Boolean(u.totpEnabled), enabledAt: (u.totpEnabledAt ?? null) as string | null, recoveryLeft: (u.totpRecoveryHashes ?? []).length as number, pending: Boolean(u.totpPendingEnc) && !u.totpEnabled };
}

/** Inicia (ou retoma) o cadastro: segredo pendente cifrado; devolve segredo e URI para o QR code. */
export async function beginTwoFactorSetup(ctx: Ctx, opts: { restart?: boolean } = {}) {
  const u = await selfUser(ctx);
  assert(!u.totpEnabled, "A autenticação em duas etapas já está ativa. Para trocar de aparelho, desative e cadastre de novo.", "already_enabled");
  let secret = opts.restart ? null : openSecret(u.totpPendingEnc);
  if (!secret) {
    secret = generateTotpSecret();
    await unscoped(ctx.store).update("users", u.id, { totpPendingEnc: sealSecret(secret) });
  }
  return enrollmentView(u, secret);
}

/** Confirma o cadastro com um código do aplicativo; devolve os códigos de recuperação (exibidos uma única vez). */
export async function confirmTwoFactorSetup(ctx: Ctx, code: string) {
  const u = await selfUser(ctx);
  assert(!u.totpEnabled, "A autenticação em duas etapas já está ativa.", "already_enabled");
  const secret = openSecret(u.totpPendingEnc);
  assert(secret, "Cadastro não iniciado ou expirado. Gere um novo QR code.", "setup_missing");
  const step = verifyTotp(secret, code);
  if (step == null) throw new BusinessError("Código inválido. Confira a hora do celular e digite o código atual do aplicativo.", "invalid_code");
  const act = activation(secret, step);
  await unscoped(ctx.store).update("users", u.id, act.patch);
  await audit(ctx, { module: "admin", action: "user.2fa_enable", entityType: "user", entityId: u.id, summary: `${u.name} ativou a autenticação em duas etapas (aplicativo autenticador)` });
  return { recoveryCodes: act.codes };
}

async function checkPassword(u: Doc, password: string) {
  assert(password, "Informe sua senha.");
  const auth = getAuth();
  let secret: string | null = null;
  try {
    secret = (await auth.login(u.email, password, false)).secret;
  } catch {
    throw new BusinessError("Senha incorreta.", "invalid_password");
  } finally {
    if (secret) await auth.logout(secret).catch(() => undefined);
  }
}

/** Desativa: exige senha e código (autenticador ou recuperação); recusado quando o perfil exige. */
export async function disableTwoFactor(ctx: Ctx, password: string, code: string) {
  const u = await selfUser(ctx);
  assert(u.totpEnabled, "A autenticação em duas etapas não está ativa.");
  if (await userRequiresTwoFactor(ctx.store, u)) throw new BusinessError("Seu perfil exige a autenticação em duas etapas: ela não pode ser desativada. Para trocar de aparelho, peça ao administrador a redefinição.", "required_by_role");
  await checkPassword(u, password);
  const r = await verifySecondFactor(ctx.store, u, code);
  if (!r.ok) {
    await audit(ctx, { module: "admin", action: "user.2fa_disable", entityType: "user", entityId: u.id, summary: `Tentativa de desativar a autenticação em duas etapas recusada (código inválido)`, result: "failure" });
    throw new BusinessError("Código inválido.", "invalid_code");
  }
  await unscoped(ctx.store).update("users", u.id, { totpEnabled: false, totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpRecoveryHashes: [], totpLastStep: null });
  await audit(ctx, { module: "admin", action: "user.2fa_disable", entityType: "user", entityId: u.id, summary: `${u.name} desativou a autenticação em duas etapas` });
}

/** Gera novos códigos de recuperação (os anteriores deixam de valer); exige um código válido. */
export async function regenerateRecoveryCodes(ctx: Ctx, code: string) {
  const u = await selfUser(ctx);
  assert(u.totpEnabled, "A autenticação em duas etapas não está ativa.");
  const r = await verifySecondFactor(ctx.store, u, code);
  if (!r.ok) throw new BusinessError("Código inválido.", "invalid_code");
  const codes = generateRecoveryCodes(10);
  await unscoped(ctx.store).update("users", u.id, { totpRecoveryHashes: codes.map(hashRecoveryCode) });
  await audit(ctx, { module: "admin", action: "user.2fa_recovery_codes", entityType: "user", entityId: u.id, summary: `${u.name} gerou novos códigos de recuperação da autenticação em duas etapas` });
  return { recoveryCodes: codes };
}

/** Campos que zeram o 2FA (redefinição pelo administrador). */
export const TWO_FACTOR_RESET_PATCH = { totpEnabled: false, totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpRecoveryHashes: [] as string[], totpLastStep: null };
