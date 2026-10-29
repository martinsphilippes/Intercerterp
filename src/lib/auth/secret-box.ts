import crypto from "node:crypto";

/**
 * Cifra simétrica de segredos guardados no banco (segredo do autenticador, sessão pendente da segunda etapa):
 * AES-256-GCM com IV aleatório e autenticação. Chave: `AUTH_ENCRYPTION_KEY` (recomendada; qualquer texto longo) ou,
 * sem ela, derivada da chave de API do Appwrite (`APPWRITE_API_KEY`) — trocar a chave invalida os segredos
 * cifrados (os usuários refazem o cadastro do autenticador). Sem nenhuma das duas (desenvolvimento e testes),
 * usa uma chave fixa de desenvolvimento.
 */

function key(): Buffer {
  const material = process.env.AUTH_ENCRYPTION_KEY || (process.env.APPWRITE_API_KEY ? `appwrite:${process.env.APPWRITE_API_KEY}` : "intercert-dev-only-key");
  return crypto.createHash("sha256").update(`intercert-secret-box:${material}`).digest();
}

const b64 = (b: Buffer) => b.toString("base64url");

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
}

/** Decifra; devolve null se o texto foi adulterado ou a chave mudou. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed?.startsWith("v1.")) return null;
  const [, iv, tag, ct] = sealed.split(".");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
