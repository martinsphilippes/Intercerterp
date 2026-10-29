import crypto from "node:crypto";

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) com o `crypto` do Node — sem dependência nova.
 * Padrão dos aplicativos autenticadores: HMAC-SHA-1, intervalo de 30 s, 6 dígitos; aceita o intervalo anterior e o
 * seguinte (janela ±1) para tolerar diferença de relógio. Segredo em Base32 (RFC 4648, sem "=").
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Segredo Base32 inválido.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

/** HOTP (RFC 4226): truncamento dinâmico do HMAC do contador (8 bytes big-endian). */
export function hotp(key: Buffer, counter: number, digits = 6, algorithm: TotpAlgorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(algorithm, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const TOTP_STEP_SECONDS = 30;

/** Número do intervalo de 30 s do instante (ms). */
export function totpStep(nowMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(nowMs / 1000 / stepSeconds);
}

/** Código TOTP do instante (ms) para a chave bruta. */
export function totp(key: Buffer, nowMs: number, opts: { digits?: number; algorithm?: TotpAlgorithm; stepSeconds?: number } = {}): string {
  return hotp(key, totpStep(nowMs, opts.stepSeconds), opts.digits ?? 6, opts.algorithm ?? "sha1");
}

/** Só os dígitos do código digitado (aceita "123 456"). */
export function normalizeCode(code: string | null | undefined): string {
  return String(code ?? "").replace(/\D/g, "");
}

/**
 * Confere o código (6 dígitos) contra o segredo Base32 na janela ±`window` intervalos. Devolve o intervalo aceito ou
 * null. `afterStep`: último intervalo já aceito — códigos desse intervalo ou anteriores são recusados (sem reuso).
 */
export function verifyTotp(secretB32: string, code: string, opts: { now?: number; window?: number; afterStep?: number | null } = {}): number | null {
  const c = normalizeCode(code);
  if (c.length !== 6) return null;
  const key = base32Decode(secretB32);
  const current = totpStep(opts.now ?? Date.now());
  const w = opts.window ?? 1;
  for (let d = -w; d <= w; d++) {
    const step = current + d;
    if (opts.afterStep != null && step <= opts.afterStep) continue;
    const expected = hotp(key, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

/** Segredo novo de 160 bits (recomendação do RFC 4226), em Base32. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** URI de cadastro lida pelos aplicativos autenticadores (QR code). */
export function otpauthUri(input: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const q = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Segredo agrupado de 4 em 4 para digitação manual. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Códigos de recuperação de uso único (formato xxxxx-xxxxx, sem caracteres ambíguos). */
export function generateRecoveryCodes(n = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    const bytes = crypto.randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    codes.add(`${chars.slice(0, 5)}-${chars.slice(5)}`);
  }
  return [...codes];
}

/** Forma canônica do código de recuperação (minúsculas, sem espaços nem hífen) — base do hash guardado. */
export function normalizeRecoveryCode(code: string | null | undefined): string {
  return String(code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(`intercert-recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}
