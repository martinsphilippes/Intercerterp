import JSZip from "jszip";

/**
 * Gerador mínimo de planilhas XLSX (Office Open XML / SpreadsheetML) em TypeScript puro, sobre o `jszip` que o
 * projeto já usa no pacote contábil — sem dependência nova. Gera: [Content_Types].xml, _rels/.rels, xl/workbook.xml,
 * xl/_rels/workbook.xml.rels, xl/styles.xml e uma xl/worksheets/sheetN.xml por aba.
 *  - Textos como "inlineStr" (nunca fórmula: um texto começando com "=" continua texto — sem injeção de fórmula).
 *  - Números como número (valores em reais, quantidades, percentuais), datas como data do Excel (serial) com formato
 *    dd/mm/aaaa (e hh:mm para data e hora), cabeçalho em negrito, primeira linha congelada e filtro automático.
 */

export type XlsxKind = "text" | "money" | "number" | "date" | "datetime";

export interface XlsxColumn {
  label: string;
  kind?: XlsxKind;
  /** largura aproximada em caracteres (padrão: pelo conteúdo, entre 8 e 60) */
  width?: number;
}

/** Valor da célula já convertido: número (money/number), texto, data "aaaa-mm-dd" ou instante ISO (datetime). */
export type XlsxValue = string | number | null | undefined;

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: XlsxValue[][];
}

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Índices de estilo (cellXfs em styles.xml). */
const STYLE = { default: 0, header: 1, money: 2, date: 3, datetime: 4 } as const;

/** Escapa texto para XML e remove caracteres de controle inválidos no XML 1.0. */
export function xmlEscape(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Letra(s) da coluna (0 → A, 25 → Z, 26 → AA). */
export function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\ e sem aspas simples nas pontas. */
export function sheetName(name: string, used: Set<string> = new Set()): string {
  let base = (name || "Planilha").replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim().slice(0, 31) || "Planilha";
  let n = 2;
  let out = base;
  while (used.has(out.toLowerCase())) {
    const suf = ` (${n++})`;
    base = base.slice(0, 31 - suf.length);
    out = base + suf;
  }
  used.add(out.toLowerCase());
  return out;
}

/** Serial do Excel (dias desde 30/12/1899) de uma data "aaaa-mm-dd". */
export function excelDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
}

/** Serial do Excel de um instante, no horário local do fuso informado (padrão: o da instalação). */
export function excelDateTime(iso: string, tz = process.env.APP_TIMEZONE || "America/Sao_Paulo"): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return local / 86400000 + 25569;
}

function cellXml(ref: string, v: XlsxValue, kind: XlsxKind): string {
  if (v == null || v === "") return "";
  if (kind === "money" || kind === "number") {
    const n = typeof v === "number" ? v : Number(String(v));
    if (Number.isFinite(n)) return `<c r="${ref}"${kind === "money" ? ` s="${STYLE.money}"` : ""}><v>${n}</v></c>`;
  }
  if (kind === "date" || kind === "datetime") {
    const serial = kind === "date" ? excelDate(String(v)) : excelDateTime(String(v));
    if (serial != null) return `<c r="${ref}" s="${kind === "date" ? STYLE.date : STYLE.datetime}"><v>${Math.round(serial * 86400) / 86400}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns;
  const widths = cols.map((c, i) => {
    if (c.width) return c.width;
    let w = c.label.length + 2;
    for (const r of sheet.rows.slice(0, 200)) {
      const v = r[i];
      const len = v == null ? 0 : c.kind === "date" ? 10 : c.kind === "datetime" ? 16 : String(v).length + (c.kind === "money" ? 4 : 0);
      if (len + 2 > w) w = len + 2;
    }
    return Math.min(60, Math.max(8, w));
  });
  const out: string[] = [];
  out.push(`<row r="1">${cols.map((c, i) => `<c r="${colLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${xmlEscape(c.label)}</t></is></c>`).join("")}</row>`);
  sheet.rows.forEach((r, ri) => {
    const n = ri + 2;
    out.push(`<row r="${n}">${cols.map((c, i) => cellXml(`${colLetter(i)}${n}`, r[i], c.kind ?? "text")).join("")}</row>`);
  });
  const last = `${colLetter(Math.max(0, cols.length - 1))}${sheet.rows.length + 1}`;
  return (
    HEAD +
    `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "") +
    `<sheetData>${out.join("")}</sheetData>` +
    (cols.length ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`
  );
}

const STYLES =
  HEAD +
  `<styleSheet xmlns="${NS}">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="5">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Monta o arquivo .xlsx (uma aba por item). */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const list = sheets.length ? sheets : [{ name: "Planilha", columns: [], rows: [] }];
  const used = new Set<string>();
  const names = list.map((s) => sheetName(s.name, used));
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    HEAD +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`,
  );
  zip.file("_rels/.rels", HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const defined = list
    .map((s, i) => (s.columns.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$1:$${colLetter(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : ""))
    .join("");
  zip.file(
    "xl/workbook.xml",
    HEAD +
      `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      (defined ? `<definedNames>${defined}</definedNames>` : "") +
      `</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${list.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES);
  list.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
