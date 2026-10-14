/**
 * Código de barras de balança etiquetadora (PDV-06) — funções PURAS (sem servidor; podem ser usadas no cliente).
 *
 * Etiqueta EAN-13 de circulação restrita: começa com "2", traz o código do produto na balança (PLU) e o PESO
 * (kg com 3 casas = gramas) ou o VALOR TOTAL (centavos) da etiqueta, e termina com o dígito verificador EAN-13.
 * Layouts suportados (13 posições; regra em docs/regras-assumidas.md §30):
 *   "4"  2 CCCC 0 VVVVVV D   — código de 4 dígitos (posições 2–5), posição 6 ignorada, valor de 6 dígitos (7–12)
 *   "5"  2 CCCCC 0 VVVVV D   — código de 5 dígitos (posições 2–6), posição 7 ignorada, valor de 5 dígitos (8–12)
 *   "6"  2 CCCCCC VVVVV D    — código de 6 dígitos (posições 2–7), valor de 5 dígitos (8–12)
 * A posição "0" é ignorada na leitura (algumas balanças gravam ali um dígito verificador do preço).
 */
import { roundDiv, QTY } from "@/lib/money";

export type ScaleLayout = "4" | "5" | "6";
export type ScaleContent = "weight" | "value";

export interface ScaleLayoutDef {
  value: ScaleLayout;
  mask: string;
  codeDigits: number;
  /** posição (0-based) do primeiro dígito do valor; o valor sempre termina na posição 12 (antes do DV) */
  valueStart: number;
  label: string;
}

export const SCALE_LAYOUTS: ScaleLayoutDef[] = [
  { value: "4", mask: "2CCCC0VVVVVVD", codeDigits: 4, valueStart: 6, label: "2 CCCC 0 VVVVVV D — código de 4 dígitos, valor de 6 dígitos (Toledo/Filizola/Urano “4 dígitos”)" },
  { value: "5", mask: "2CCCCC0VVVVVD", codeDigits: 5, valueStart: 7, label: "2 CCCCC 0 VVVVV D — código de 5 dígitos, valor de 5 dígitos" },
  { value: "6", mask: "2CCCCCCVVVVVD", codeDigits: 6, valueStart: 7, label: "2 CCCCCC VVVVV D — código de 6 dígitos, valor de 5 dígitos" },
];

export const SCALE_CONTENTS: Array<{ value: ScaleContent; label: string }> = [
  { value: "weight", label: "Peso (kg com 3 casas — gramas)" },
  { value: "value", label: "Valor total da etiqueta (centavos)" },
];

export const SCALE_DEFAULTS = { layout: "4" as ScaleLayout, content: "weight" as ScaleContent };

export function scaleLayoutDef(layout: string | number | null | undefined): ScaleLayoutDef {
  // o parâmetro pode voltar do armazenamento como número ("4" → 4)
  return SCALE_LAYOUTS.find((l) => l.value === String(layout ?? "")) ?? SCALE_LAYOUTS.find((l) => l.value === SCALE_DEFAULTS.layout)!;
}

/** Maior PLU que cabe no código do layout (ex.: 4 dígitos → 9999). */
export function maxPluFor(layout: string | number | null | undefined) {
  return 10 ** scaleLayoutDef(layout).codeDigits - 1;
}

/** Dígito verificador EAN-13 (módulo 10, pesos 1 e 3 da esquerda para a direita) dos 12 primeiros dígitos. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error("EAN-13: informe 12 dígitos");
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Código com cara de etiqueta de balança: 13 dígitos começando com "2" (ainda sem conferir o DV). */
export function looksLikeScaleBarcode(code: string | null | undefined): boolean {
  return typeof code === "string" && /^2\d{12}$/.test(code.trim());
}

export type ScaleParse =
  | { ok: true; barcode: string; plu: number; content: ScaleContent; layout: ScaleLayout; /** gramas = milésimos de kg (peso) */ weight: number | null; /** centavos (valor) */ value: number | null }
  | { ok: false; reason: "not_scale" | "check_digit" | "zero_plu" | "zero_amount"; message: string };

/**
 * Decompõe a etiqueta da balança. Não consulta cadastro nem preço: devolve o PLU e o peso (milésimos de kg) ou o valor
 * (centavos), conforme o layout e o conteúdo configurados. DV inválido é recusado.
 */
export function parseScaleBarcode(raw: string, opts: { layout?: string | number | null; content?: string | null } = {}): ScaleParse {
  const code = (raw ?? "").trim();
  if (!looksLikeScaleBarcode(code)) return { ok: false, reason: "not_scale", message: "Não é um código de balança (EAN-13 iniciado por 2)." };
  if (!isValidEan13(code)) return { ok: false, reason: "check_digit", message: `Código de balança ${code} com dígito verificador inválido — leia a etiqueta novamente.` };
  const def = scaleLayoutDef(opts.layout);
  const content: ScaleContent = opts.content === "value" ? "value" : "weight";
  const plu = Number(code.slice(1, 1 + def.codeDigits));
  const amount = Number(code.slice(def.valueStart, 12));
  if (!plu) return { ok: false, reason: "zero_plu", message: `Etiqueta ${code} sem código de produto (PLU 0).` };
  if (!amount) return { ok: false, reason: "zero_amount", message: `Etiqueta ${code} sem ${content === "value" ? "valor" : "peso"}.` };
  return { ok: true, barcode: code, plu, content, layout: def.value, weight: content === "weight" ? amount : null, value: content === "value" ? amount : null };
}

/** Monta uma etiqueta (para demonstração, testes e conferência): PLU + peso em gramas ou valor em centavos + DV. */
export function buildScaleBarcode(plu: number, amount: number, layout?: string | number | null): string {
  const def = scaleLayoutDef(layout);
  const valueDigits = 12 - def.valueStart;
  if (!Number.isInteger(plu) || plu < 1 || plu > 10 ** def.codeDigits - 1) throw new Error(`PLU ${plu} não cabe em ${def.codeDigits} dígitos`);
  if (!Number.isInteger(amount) || amount < 0 || amount > 10 ** valueDigits - 1) throw new Error(`Valor ${amount} não cabe em ${valueDigits} dígitos`);
  const filler = "0".repeat(def.valueStart - 1 - def.codeDigits);
  const first12 = `2${String(plu).padStart(def.codeDigits, "0")}${filler}${String(amount).padStart(valueDigits, "0")}`;
  return first12 + ean13CheckDigit(first12);
}

/**
 * Quantidade (milésimos) de uma etiqueta por VALOR: valor ÷ preço unitário, arredondado ao milésimo (metade para longe
 * de zero, `roundDiv`). O total da linha continua sendo calculado por `calcSale` (arredondar(preço × quantidade)); com
 * preço acima de R$ 9,99 por unidade o total pode diferir da etiqueta em alguns centavos (nenhum milésimo fecha exato).
 */
export function qtyForLabelValue(valueCents: number, unitPrice: number): number {
  if (!(unitPrice > 0)) return 0;
  return Math.max(1, roundDiv(valueCents * QTY, unitPrice));
}
