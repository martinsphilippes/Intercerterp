import crypto from "node:crypto";
import { Account, AppwriteException, Client, ID, Query, Users } from "node-appwrite";
import { appwriteConfig, configuredBackend, detId, findOne, getStore, sha256 } from "../db";
import type { Store } from "../db/types";

/**
 * Autenticação:
 *  - Backend Appwrite: usuários no Appwrite Auth (sessão por e-mail/senha; recuperação por e-mail do Appwrite).
 *  - Backend local/memória (desenvolvimento e testes): hash scrypt e sessões na coleção "sessions".
 * O perfil do ERP (empresa, filiais, perfil de acesso) fica sempre na coleção "users".
 */

export interface AuthProvider {
  readonly kind: "appwrite" | "local";
  createUser(email: string, password: string, name: string): Promise<string>;
  setPassword(authId: string, password: string): Promise<void>;
  setBlocked(authId: string, blocked: boolean): Promise<void>;
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
  readonly kind = "local" as const;
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

  async setBlocked() {
    /* status controlado na coleção users */
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
    if (!sent.delivered) console.info(`[auth] link de recuperação (canal de e-mail não configurado): ${link}`);
    return { delivered: sent.delivered, channel: sent.channel, devLink: process.env.NODE_ENV !== "production" && !sent.delivered ? link : undefined };
  }

  async completeRecovery({ userId, secret, password }: { userId: string; secret: string; password: string }) {
    const u = await this.store().get("users", userId);
    if (!u || u.resetTokenHash !== sha256(secret) || !u.resetExpiresAt || u.resetExpiresAt < new Date().toISOString()) throw new Error("invalid_token");
    await this.store().update("users", u.id, { passwordHash: hashPassword(password), resetTokenHash: null, resetExpiresAt: null });
  }
}

class AppwriteAuth implements AuthProvider {
  readonly kind = "appwrite" as const;
  private admin() {
    const c = appwriteConfig();
    return new Client().setEndpoint(c.endpoint).setProject(c.projectId).setKey(c.apiKey);
  }
  private sessionClient(secret: string) {
    const c = appwriteConfig();
    return new Client().setEndpoint(c.endpoint).setProject(c.projectId).setSession(secret);
  }

  async createUser(email: string, password: string, name: string) {
    const users = new Users(this.admin());
    try {
      const u = await users.create({ userId: ID.unique(), email: email.toLowerCase(), password, name });
      return u.$id;
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 409) {
        const list = await users.list({ queries: [Query.equal("email", email.toLowerCase())] });
        const found = list.users[0];
        if (found) {
          await users.updatePassword({ userId: found.$id, password });
          return found.$id;
        }
      }
      throw e;
    }
  }

  async setPassword(authId: string, password: string) {
    await new Users(this.admin()).updatePassword({ userId: authId, password });
  }

  async setBlocked(authId: string, blocked: boolean) {
    await new Users(this.admin()).updateStatus({ userId: authId, status: !blocked });
  }

  async login(email: string, password: string) {
    const account = new Account(this.admin());
    try {
      const s = await account.createEmailPasswordSession({ email: email.toLowerCase(), password });
      return { secret: s.secret, authId: s.userId, expiresAt: s.expire };
    } catch (e) {
      if (e instanceof AppwriteException && (e.code === 401 || e.code === 400)) throw new Error("invalid_credentials");
      throw e;
    }
  }

  private cache = new Map<string, { authId: string; until: number }>();

  async verify(secret: string) {
    const key = sha256(secret);
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.authId;
    try {
      const u = await new Account(this.sessionClient(secret)).get();
      if (!u.status) return null;
      this.cache.set(key, { authId: u.$id, until: Date.now() + 60000 });
      return u.$id;
    } catch {
      return null;
    }
  }

  async logout(secret: string) {
    this.cache.delete(sha256(secret));
    try {
      await new Account(this.sessionClient(secret)).deleteSession({ sessionId: "current" });
    } catch {
      /* sessão já expirada */
    }
  }

  async requestRecovery(email: string, resetUrl: string) {
    // O Appwrite envia o e-mail de recuperação pelo SMTP do projeto (Appwrite Cloud possui envio próprio).
    try {
      await new Account(this.admin()).createRecovery({ email: email.toLowerCase(), url: resetUrl });
      return { delivered: true, channel: "appwrite" };
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 404) return { delivered: false, channel: "none" };
      throw e;
    }
  }

  async completeRecovery({ userId, secret, password }: { userId: string; secret: string; password: string }) {
    await new Account(this.admin()).updateRecovery({ userId, secret, password });
  }
}

const g = globalThis as unknown as { __intercertAuth?: AuthProvider };

export function getAuth(): AuthProvider {
  g.__intercertAuth ??= configuredBackend() === "appwrite" ? new AppwriteAuth() : new LocalAuth(getStore);
  return g.__intercertAuth;
}

export function setAuth(a: AuthProvider) {
  g.__intercertAuth = a;
}

export { hashPassword, verifyPassword, detId };
