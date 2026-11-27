import crypto from "node:crypto";

/**
 * Assinatura HMAC-SHA256 das gravações entre o Interos e o ERP (`X-Interos-Signature`, e `X-ERP-Signature` nos eventos
 * do ERP para o Interos): `t=<unix>,v1=<hex de HMAC(segredo, "<t>.<corpo>")>`, com janela de ±5 min contra repetição.
 * O mesmo formato vale para as três APIs (docs/interos/credenciais.md).
 */
export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Confere `t=<unix>,v1=<hex>` com janela de tempo (proteção contra repetição) e comparação em tempo constante. */
export function verifySignature(secret: string, header: string | null | undefined, body: string, windowSec = 300, nowSec = Math.floor(Date.now() / 1000)): { ok: true; t: number } | { ok: false; reason: string } {
  const m = /^t=(\d{9,12}),v1=([0-9a-f]{64})$/.exec(String(header ?? "").trim());
  if (!m) return { ok: false, reason: "Cabeçalho X-Interos-Signature ausente ou malformado (t=<unix>,v1=<hex>)." };
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > windowSec) return { ok: false, reason: "Assinatura fora da janela de tempo (±5 min): possível repetição." };
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(m[2], "hex");
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return { ok: false, reason: "Assinatura inválida." };
  return { ok: true, t };
}
