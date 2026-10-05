import crypto from "node:crypto";

/** Identificador aleatório compatível com Appwrite (≤ 36 chars, [a-zA-Z0-9]). */
export function newId(): string {
  return crypto.randomBytes(10).toString("hex");
}

/**
 * Identificador determinístico derivado das partes informadas.
 * Usado para idempotência: o mesmo efeito de uma operação sempre recebe o mesmo id,
 * de modo que repetições geram conflito em vez de duplicação.
 */
export function detId(...parts: Array<string | number | null | undefined>): string {
  return crypto.createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32);
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
