/**
 * Utilidades de formatação do arquivo SINTEGRA (Convênio ICMS 57/95 — Manual de Orientação, item 3 "formato dos
 * registros"): registro de 126 posições + CR/LF, ASCII, campos numéricos (N) alinhados à direita com zeros à esquerda,
 * sem sinal e sem separador (valores com 2 casas e quantidades com 3 casas implícitas — o sistema já guarda centavos e
 * milésimos, então o inteiro é gravado como está), campos alfanuméricos (X) alinhados à esquerda com espaços à direita,
 * datas AAAAMMDD. Ausência de informação: zeros (N) ou espaços (X).
 *
 * Arquivo próprio do Sintegra (a frente do SPED/EFD tem `common.ts`): podem ser unificados depois.
 */

export const SINTEGRA_LINE_LENGTH = 126;
export const SINTEGRA_EOL = "\r\n";

/** Erro de formatação de campo (valor que não cabe no tamanho do layout). */
export class SintegraFieldError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
  }
}

/** Texto em ASCII imprimível, sem acentos (ç → c, ã → a, º → o …), sem quebras de linha. */
export function toAscii(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ºª°]/g, (c) => (c === "ª" ? "a" : "o"))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e]/g, " ");
}

/** Campo alfanumérico (X): ASCII, alinhado à esquerda, espaços à direita, truncado no tamanho. */
export function alpha(v: unknown, size: number): string {
  return toAscii(v).trim().slice(0, size).padEnd(size, " ");
}

/** Só os dígitos de um texto. */
export const digitsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * Campo numérico de valor inteiro (N): centavos, milésimos ou pontos-base já como inteiro. Negativo ou maior que o
 * campo é erro (o layout não tem sinal e não admite truncar valor).
 */
export function num(v: number | null | undefined, size: number, field = "valor"): string {
  const n = Math.round(Number(v ?? 0));
  if (!Number.isFinite(n)) throw new SintegraFieldError(`Campo ${field}: valor inválido.`, field);
  if (n < 0) throw new SintegraFieldError(`Campo ${field}: valor negativo (${n}) não é admitido no layout.`, field);
  const s = String(n);
  if (s.length > size) throw new SintegraFieldError(`Campo ${field}: ${s} não cabe em ${size} posições.`, field);
  return s.padStart(size, "0");
}

/**
 * Campo numérico de código (N) — CNPJ, CEP, telefone, número do documento: só dígitos, zeros à esquerda; acima do
 * tamanho, ficam os últimos dígitos (regra do manual para o número da nota com mais de 6 dígitos).
 */
export function code(v: unknown, size: number): string {
  const d = digitsOf(v);
  return (d.length > size ? d.slice(-size) : d).padStart(size, "0");
}

/** Data AAAAMMDD a partir de "AAAA-MM-DD" (vazia = zeros). */
export function ymd(date: string | null | undefined): string {
  const d = digitsOf(String(date ?? "").slice(0, 10));
  return d.length === 8 ? d : "00000000";
}

/** Brancos. */
export const blanks = (size: number) => " ".repeat(size);

/** Monta uma linha a partir dos campos já formatados, conferindo as 126 posições. */
export function record(type: string, fields: string[]): string {
  const line = fields.join("");
  if (line.length !== SINTEGRA_LINE_LENGTH) throw new SintegraFieldError(`Registro ${type} com ${line.length} posições (o layout exige ${SINTEGRA_LINE_LENGTH}).`, type);
  return line;
}

/** Texto final do arquivo: cada linha terminada em CR/LF (inclusive a última). */
export function fileText(lines: string[]): string {
  return lines.map((l) => l + SINTEGRA_EOL).join("");
}

/** Tipo do registro (posições 1–2) — 61R conta como 61, como no registro 90. */
export const recordType = (line: string) => line.slice(0, 2);
