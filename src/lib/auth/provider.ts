import crypto from "node:crypto";
import { detId, findOne, getStore, listAll, sha256 } from "../db";
import type { Store } from "../db/types";

/**
 * Autenticação própria do ERP (Postgres em produção; local/memória em desenvolvimento e testes): senha com hash scrypt
 * em `users.passwordHash` e sessões na tabela "sessions" (o navegador guarda o segredo; o banco, só o hash dele).
 * O perfil do ERP (empresa, filiais, perfil de acesso) fica na mesma coleção "users"; situação (ativo, suspenso,
 * inativo) também — o bloqueio do acesso é conferido nela.
 */

export interface AuthProvider {
  createUser(email: string, password: string, name: string): Promise<string>;
  setPassword(authId: string, password: string): Promise<void>;
  login(email: string, password: string, persistent: boolean): Promise<{ secret: string; authId: string; expiresAt: string }>;
  verify(secret: string): Promise<string | null>;
  logout(secret: string): Promise<void>;
  /** Envia recuperação pelo mecanismo configurado; retorna como foi tratada. */
  requestRecovery(email: string, resetUrl: string): Promise<{ delivered: boolean; channel: string; devLink?: string }>;
  completeRecovery(params: { userId: string; secret: string; password: string }): Promise<void>;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, saltHex, hashHex] = stored.split("$");
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

class LocalAuth implements AuthProvider {
  constructor(private store: () => Store) {}

  async createUser(email: string, password: string) {
    const u = await findOne(this.store(), "users", [["eq", "email", email.toLowerCase()]]);
    if (u) await this.store().update("users", u.id, { passwordHash: hashPassword(password) });
    return `local:${email.toLowerCase()}`;
  }

  async setPassword(authId: string, password: string) {
    const u = await findOne(this.store(), "users", [["eq", "authId", authId]]);
    if (u) await this.store().update("users", u.id, { passwordHash: hashPassword(password) });
  }

  async login(email: string, password: string, persistent: boolean) {
    const u = await findOne(this.store(), "users", [["eq", "email", email.toLowerCase()]]);
    if (!u || !verifyPassword(password, u.passwordHash)) throw new Error("invalid_credentials");
    const secret = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + (persistent ? 30 : 1) * 86400000).toISOString();
    await this.store().create("sessions", { userId: u.id, tokenHash: sha256(secret), expiresAt, persistent });
    return { secret, authId: u.authId ?? `local:${u.email}`, expiresAt };
  }

  async verify(secret: string) {
    const s = await findOne(this.store(), "sessions", [["eq", "tokenHash", sha256(secret)]]);
    if (!s || s.expiresAt < new Date().toISOString()) return null;
    const u = await this.store().get("users", s.userId);
    // "encerrar todas as sessões": vale só o que foi emitido depois do instante registrado
    if (u?.sessionsValidAfter && String(s.createdAt ?? "") < u.sessionsValidAfter) return null;
    return u?.authId ?? null;
  }

  async logout(secret: string) {
    const s = await findOne(this.store(), "sessions", [["eq", "tokenHash", sha256(secret)]]);
    if (s) await this.store().delete("sessions", s.id);
  }

  async requestRecovery(email: string, resetUrl: string) {
    const u = await findOne(this.store(), "users", [["eq", "email", email.toLowerCase()]]);
    if (!u) return { delivered: false, channel: "none" };
    const secret = crypto.randomBytes(24).toString("hex");
    await this.store().update("users", u.id, { resetTokenHash: sha256(secret), resetExpiresAt: new Date(Date.now() + 3600000).toISOString() });
    const link = `${resetUrl}?userId=${u.id}&secret=${secret}`;
    const { sendEmail } = await import("../core/email");
    const sent = await sendEmail(u.companyIds?.[0] ?? null, { to: u.email, subject: "Recuperação de senha — Intercert ERP", html: `<p>Para definir uma nova senha, acesse: <a href="${link}">${link}</a></p><p>O link expira em 1 hora.</p>` });
    // o link é uma credencial: só aparece no log fora de produção (em produção, sem canal de e-mail, quem redefine é o administrador)
    if (!sent.delivered && process.env.NODE_ENV !== "production") console.info(`[auth] link de recuperação (canal de e-mail não configurado): ${link}`);
    return { delivered: sent.delivered, channel: sent.channel, devLink: process.env.NODE_ENV !== "production" && !sent.delivered ? link : undefined };
  }

  async completeRecovery({ userId, secret, password }: { userId: string; secret: string; password: string }) {
    const u = await this.store().get("users", userId);
    if (!u || u.resetTokenHash !== sha256(secret) || !u.resetExpiresAt || u.resetExpiresAt < new Date().toISOString()) throw new Error("invalid_token");
    // senha nova: as sessões abertas antes (inclusive as de quem conhecia a senha anterior) deixam de valer
    await this.store().update("users", u.id, { passwordHash: hashPassword(password), resetTokenHash: null, resetExpiresAt: null, sessionsValidAfter: new Date().toISOString() });
    for (const s of await listAll(this.store(), "sessions", { filters: [["eq", "userId", u.id]] })) await this.store().delete("sessions", s.id);
  }
}

const g = globalThis as unknown as { __intercertAuth?: AuthProvider };

export function getAuth(): AuthProvider {
  g.__intercertAuth ??= new LocalAuth(getStore);
  return g.__intercertAuth;
}

export function setAuth(a: AuthProvider) {
  g.__intercertAuth = a;
}

export { hashPassword, verifyPassword, detId };
