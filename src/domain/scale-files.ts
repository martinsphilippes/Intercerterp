/**
 * Arquivos de carga de balança etiquetadora (CAD-16) — geradores PUROS de texto de largura fixa.
 *
 * Layout de itens básicos (código, tipo de venda, descrição, preço por kg/unidade e validade). Hipóteses e campos em
 * docs/regras-assumidas.md §30 — conferir com o software da balança da loja (MGV da Toledo, Smart/Platina da Filizola)
 * antes do uso em produção. Texto em ASCII (sem acentos, maiúsculas), uma linha por item, terminador CRLF.
 */

export type ScaleFileFormat = "toledo" | "filizola";

export interface ScaleFileItem {
  plu: number;
  name: string;
  /** venda por peso (KG) ou por unidade */
  byWeight: boolean;
  /** centavos por kg (peso) ou por unidade */
  price: number;
  /** dias de validade (0 = sem validade) */
  shelfLifeDays: number;
}

export interface FieldSpec {
  name: string;
  start: number; // posição inicial (1-based)
  size: number;
  content: string;
}

/** Toledo — ITENSMGV.TXT (MGV5/MGV6, cadastro de itens; campos básicos + códigos opcionais zerados). */
export const TOLEDO_FIELDS: FieldSpec[] = [
  { name: "Departamento", start: 1, size: 2, content: "01 (fixo)" },
  { name: "Tipo de venda", start: 3, size: 1, content: "0 = peso (KG); 1 = unidade" },
  { name: "Código do item (PLU)", start: 4, size: 6, content: "numérico, zeros à esquerda" },
  { name: "Preço por kg ou unidade", start: 10, size: 6, content: "centavos, zeros à esquerda (máx. 9999,99)" },
  { name: "Dias de validade", start: 16, size: 3, content: "000 = sem validade" },
  { name: "Descritivo — linha 1", start: 19, size: 25, content: "texto, completado com espaços" },
  { name: "Descritivo — linha 2", start: 44, size: 25, content: "continuação do descritivo" },
  { name: "Código da informação extra", start: 69, size: 6, content: "000000" },
  { name: "Código da imagem", start: 75, size: 4, content: "0000" },
  { name: "Código da informação nutricional", start: 79, size: 6, content: "000000 (tabela nutricional não exportada)" },
  { name: "Imprime data de validade", start: 85, size: 1, content: "1 quando há validade; 0 sem validade" },
  { name: "Imprime data de embalagem", start: 86, size: 1, content: "1" },
];
export const TOLEDO_LINE = 86;
export const TOLEDO_FILE_NAME = "ITENSMGV.TXT";
export const TOLEDO_MAX_PRICE = 999999;

/** Filizola — CADTXT.TXT (importação de itens das linhas Smart/Platina; campos básicos). */
export const FILIZOLA_FIELDS: FieldSpec[] = [
  { name: "Código do item (PLU)", start: 1, size: 6, content: "numérico, zeros à esquerda" },
  { name: "Tipo de venda", start: 7, size: 1, content: "P = peso (KG); U = unidade" },
  { name: "Descrição", start: 8, size: 22, content: "texto, completado com espaços" },
  { name: "Preço por kg ou unidade", start: 30, size: 7, content: "centavos, zeros à esquerda (máx. 99999,99)" },
  { name: "Dias de validade", start: 37, size: 3, content: "000 = sem validade" },
];
export const FILIZOLA_LINE = 39;
export const FILIZOLA_FILE_NAME = "CADTXT.TXT";
export const FILIZOLA_MAX_PRICE = 9999999;

export const SCALE_FORMATS: Array<{ value: ScaleFileFormat; label: string; fileName: string; maxPrice: number; fields: FieldSpec[]; lineLength: number }> = [
  { value: "toledo", label: "Toledo (MGV — ITENSMGV.TXT)", fileName: TOLEDO_FILE_NAME, maxPrice: TOLEDO_MAX_PRICE, fields: TOLEDO_FIELDS, lineLength: TOLEDO_LINE },
  { value: "filizola", label: "Filizola (CADTXT.TXT)", fileName: FILIZOLA_FILE_NAME, maxPrice: FILIZOLA_MAX_PRICE, fields: FILIZOLA_FIELDS, lineLength: FILIZOLA_LINE },
];

export const MAX_PLU = 999999;
export const MAX_SHELF_LIFE_DAYS = 999;

/** Texto para a balança: sem acentos, maiúsculas, só ASCII imprimível, cortado/completado na largura. */
export function scaleText(s: string | null | undefined, size: number): string {
  const t = String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, size).padEnd(size, " ");
}

function num(n: number, size: number, label: string): string {
  if (!Number.isInteger(n) || n < 0 || n > 10 ** size - 1) throw new Error(`${label}: ${n} não cabe em ${size} dígitos`);
  return String(n).padStart(size, "0");
}

/** Divide o descritivo em duas linhas de 25 posições quebrando em espaço quando possível. */
function splitTwoLines(name: string, size: number): [string, string] {
  const t = scaleText(name, size * 2).trimEnd();
  if (t.length <= size) return [t, ""];
  let cut = t.lastIndexOf(" ", size);
  if (cut <= 0) cut = size;
  return [t.slice(0, cut).trim(), t.slice(cut).trim()];
}

export function toledoLine(i: ScaleFileItem): string {
  const [l1, l2] = splitTwoLines(i.name, 25);
  const line =
    "01" +
    (i.byWeight ? "0" : "1") +
    num(i.plu, 6, "PLU") +
    num(i.price, 6, "Preço") +
    num(i.shelfLifeDays, 3, "Validade") +
    scaleText(l1, 25) +
    scaleText(l2, 25) +
    "000000" +
    "0000" +
    "000000" +
    (i.shelfLifeDays > 0 ? "1" : "0") +
    "1";
  return line;
}

export function filizolaLine(i: ScaleFileItem): string {
  return num(i.plu, 6, "PLU") + (i.byWeight ? "P" : "U") + scaleText(i.name, 22) + num(i.price, 7, "Preço") + num(i.shelfLifeDays, 3, "Validade");
}

/** Conteúdo do arquivo (linhas em ordem de PLU, CRLF ao fim de cada linha). */
export function buildScaleFile(format: ScaleFileFormat, items: ScaleFileItem[]): { fileName: string; content: string; lines: string[] } {
  const f = SCALE_FORMATS.find((x) => x.value === format);
  if (!f) throw new Error(`Formato de balança desconhecido: ${format}`);
  const sorted = [...items].sort((a, b) => a.plu - b.plu);
  const lines = sorted.map((i) => (format === "toledo" ? toledoLine(i) : filizolaLine(i)));
  return { fileName: f.fileName, content: lines.map((l) => `${l}\r\n`).join(""), lines };
}
