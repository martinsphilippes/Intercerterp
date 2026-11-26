import crypto from "node:crypto";

/**
 * Autenticação servidor a servidor do Interos (contrato-interos-erp-v1.md §Autenticação).
 *
 * Credenciais em `INTEROS_CLIENTS` (JSON) — o ERP guarda só o SHA-256 do token, nunca o token:
 *   [{"id":"interos-prod","tokenSha256":"<hex>","scopes":["erp.modules.read","erp.modules.write"]}]
 * Gere com `npx tsx scripts/modules/new-interos-token.ts <id> [escopos]`. Requisição: `Authorization: Bearer <token>`.
 */
export type InterosScope = "erp.modules.read" | "erp.modules.write" | "erp.license.read" | "erp.license.write" | "erp.usage.read";
export const INTEROS_SCOPES: InterosScope[] = ["erp.modules.read", "erp.modules.write", "erp.license.read", "erp.license.write", "erp.usage.read"];

export interface InterosClient {
  id: string;
  tokenSha256: string;
  scopes: InterosScope[];
  /** v2: NOME da variável de ambiente com o segredo HMAC das escritas (o valor nunca fica no JSON) */
  signingSecretEnv?: string | null;
  /** v2: empresas que este cliente pode alterar (ausente = todas) */
  companyIds?: string[] | null;
}

/** Segredo de assinatura do cliente (v2). */
export function signingSecretOf(c: InterosClient): string | null {
  const name = c.signingSecretEnv;
  if (!name || !/^[A-Z][A-Z0-9_]{2,80}$/.test(name)) return null;
  const v = process.env[name];
  return v && v.length >= 32 ? v : null;
}

export function interosClients(): InterosClient[] {
  const raw = process.env.INTEROS_CLIENTS;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((c) => c && typeof c.id === "string" && /^[0-9a-f]{64}$/.test(String(c.tokenSha256 ?? "")))
      .map((c) => ({
        id: c.id, tokenSha256: String(c.tokenSha256), scopes: (Array.isArray(c.scopes) ? c.scopes : []).filter((s: string) => (INTEROS_SCOPES as string[]).includes(s)),
        signingSecretEnv: typeof c.signingSecretEnv === "string" ? c.signingSecretEnv : null,
        companyIds: Array.isArray(c.companyIds) ? c.companyIds.map(String) : null,
      }));
  } catch {
    return [];
  }
}

export type AuthResult = { ok: true; client: InterosClient } | { ok: false; status: 401 | 403 | 503; code: string; message: string };

export function authenticateInteros(authorization: string | null | undefined, required: InterosScope): AuthResult {
  const clients = interosClients();
  if (!clients.length) return { ok: false, status: 503, code: "integration_not_configured", message: "Integração Interos não configurada no ERP (INTEROS_CLIENTS)." };
  const m = /^Bearer\s+([A-Za-z0-9._~-]{32,512})$/.exec(String(authorization ?? "").trim());
  if (!m) return { ok: false, status: 401, code: "unauthenticated", message: "Informe Authorization: Bearer <token>." };
  const digest = crypto.createHash("sha256").update(m[1]).digest();
  // comparação em tempo constante contra todas as credenciais (não revela qual existe)
  let found: InterosClient | null = null;
  for (const c of clients) if (crypto.timingSafeEqual(digest, Buffer.from(c.tokenSha256, "hex")) && !found) found = c;
  if (!found) return { ok: false, status: 401, code: "unauthenticated", message: "Token inválido." };
  if (!found.scopes.includes(required)) return { ok: false, status: 403, code: "insufficient_scope", message: `Escopo exigido: ${required}.` };
  return { ok: true, client: found };
}
