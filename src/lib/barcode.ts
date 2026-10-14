/**
 * Codificação de códigos de barras em TypeScript puro (sem dependências), para impressão em SVG:
 *  - EAN-13 (GTIN de 13 dígitos com dígito verificador válido);
 *  - Code 128 (conjunto C para sequências numéricas de tamanho par, conjunto B para o restante).
 * As funções devolvem as larguras dos módulos (barra, espaço, barra, …) — quem desenha decide a escala.
 */

/** Padrões do Code 128 (valores 0–106): larguras alternadas barra/espaço. */
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/** Texto imprimível no conjunto B (ASCII 32–126); acentos são removidos e o restante vira "?". */
export function code128Text(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** Valores Code 128 (início, dados, verificador e parada) — conjunto C para dígitos em quantidade par (≥ 4), senão B. */
export function code128Values(input: string): number[] {
  const text = code128Text(input);
  const values: number[] = [];
  if (/^\d+$/.test(text) && text.length >= 4 && text.length % 2 === 0) {
    values.push(START_C);
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values;
}

/** Larguras dos módulos (barra, espaço, …) do Code 128. */
export function code128Widths(input: string): number[] {
  return code128Values(input).flatMap((v) => CODE128_PATTERNS[v].split("").map(Number));
}

/** Dígito verificador GTIN (módulo 10, pesos 3/1 a partir da direita). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** EAN-13 válido: 13 dígitos com dígito verificador correto. */
export function isEan13(code: string | null | undefined): code is string {
  if (!code || !/^\d{13}$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, 12)) === Number(code[12]);
}

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/**
 * Módulos do EAN-13 (95 caracteres "0"/"1") e quais posições são barras-guarda (mais compridas).
 * Lança erro se o código não for um EAN-13 válido.
 */
export function ean13Modules(code: string): { modules: string; guards: boolean[] } {
  if (!isEan13(code)) throw new Error(`EAN-13 inválido: ${code}`);
  const first = Number(code[0]);
  const parity = EAN_PARITY[first];
  let modules = "101";
  for (let i = 0; i < 6; i++) {
    const d = Number(code[i + 1]);
    modules += parity[i] === "L" ? EAN_L[d] : EAN_G[d];
  }
  modules += "01010";
  for (let i = 0; i < 6; i++) modules += EAN_R[Number(code[i + 7])];
  modules += "101";
  const guards = modules.split("").map((_, i) => i < 3 || (i >= 45 && i < 50) || i >= 92);
  return { modules, guards };
}
