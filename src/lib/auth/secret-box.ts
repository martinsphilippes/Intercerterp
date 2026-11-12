import crypto from "node:crypto";
import { configuredBackend } from "../db";

/**
 * Cifra simétrica de segredos guardados no banco (segredo do autenticador, sessão pendente da segunda etapa):
 * AES-256-GCM com IV aleatório e autenticação. Trocar a chave invalida os segredos cifrados (os usuários refazem o
 * cadastro do autenticador).
 *
 * De onde vem a chave (`secretKeySource`):
 *  - "own": `AUTH_ENCRYPTION_KEY` (qualquer texto longo) — o certo em toda publicação;
 *  - "appwrite": derivada da chave de API do Appwrite, nas instalações antigas — vale só enquanto a variável existir;
 *  - "dev": chave fixa, só em desenvolvimento, testes e na demonstração em memória;
 *  - "missing": publicação com banco de verdade sem nenhuma das duas. Nada é cifrado com uma chave que está no
 *    código-fonte: gravar um segredo falha dizendo o que falta, e o que estava cifrado não abre.
 */
export type SecretKeySource = "own" | "appwrite" | "dev" | "missing";

export function secretKeySource(): SecretKeySource {
  if (process.env.AUTH_ENCRYPTION_KEY) return "own";
  if (process.env.APPWRITE_API_KEY) return "appwrite";
  const backend = configuredBackend();
  return process.env.NODE_ENV === "production" && (backend === "postgres" || backend === "appwrite") ? "missing" : "dev";
}

function key(): Buffer | null {
  const source = secretKeySource();
  if (source === "missing") return null;
  const material = source === "own" ? process.env.AUTH_ENCRYPTION_KEY : source === "appwrite" ? `appwrite:${process.env.APPWRITE_API_KEY}` : "intercert-dev-only-key";
  return crypto.createHash("sha256").update(`intercert-secret-box:${material}`).digest();
}

const b64 = (b: Buffer) => b.toString("base64url");

export function sealSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("Chave de cifra não configurada: defina AUTH_ENCRYPTION_KEY nas variáveis do servidor (protege a autenticação em duas etapas) e publique de novo.");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
}

/** Decifra; devolve null se o texto foi adulterado, a chave mudou ou não há chave configurada. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed?.startsWith("v1.")) return null;
  const k = key();
  if (!k) return null;
  const [, iv, tag, ct] = sealed.split(".");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
