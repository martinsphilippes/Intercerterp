import { decodeBankFile, splitLines, type BankFormat, type ParseResult } from "./common";
import { looksLikeOfx, parseOfx } from "./ofx";
import { parseCsv, sniffCsv, type CsvMapping, type CsvSniff } from "./csv";
import { looksLikeCnab240, parseCnab240 } from "./cnab240";
import { looksLikeCnab400, parseCnab400 } from "./cnab400";

export * from "./common";
export { parseOfx } from "./ofx";
export { parseCsv, sniffCsv, splitCsvLine, validateMapping, type CsvMapping, type CsvSniff } from "./csv";
export { parseCnab240, CNAB240_OCCURRENCES } from "./cnab240";
export { parseCnab400, CNAB400_LAYOUTS } from "./cnab400";

export const FORMAT_LABEL: Record<BankFormat, string> = { ofx: "OFX (extrato)", csv: "CSV (extrato)", cnab240: "CNAB 240 (retorno de cobrança)", cnab400: "CNAB 400 (retorno de cobrança)" };

/** Detecta o formato pelo conteúdo (a extensão só desempata). */
export function detectFormat(text: string, fileName = ""): BankFormat {
  if (looksLikeOfx(text)) return "ofx";
  const lines = splitLines(text);
  if (looksLikeCnab240(lines)) return "cnab240";
  if (looksLikeCnab400(lines)) return "cnab400";
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "ofx") return "ofx";
  if (ext === "ret" || ext === "rem") {
    const len = (lines[0] ?? "").replace(/\s+$/, "").length;
    return len > 300 ? "cnab400" : "cnab240";
  }
  return "csv";
}

export interface ParseOptions {
  format?: BankFormat | "auto";
  csvMapping?: CsvMapping | null;
}

/** Lê o arquivo bancário. CSV sem mapeamento usa o mapeamento sugerido pela pré-visualização. */
export function parseBankFile(data: Buffer | string, fileName: string, opts: ParseOptions = {}): { result: ParseResult; text: string; csv: CsvSniff | null } {
  const text = decodeBankFile(data);
  const format = !opts.format || opts.format === "auto" ? detectFormat(text, fileName) : opts.format;
  if (format === "ofx") return { result: parseOfx(text), text, csv: null };
  if (format === "cnab240") return { result: parseCnab240(text), text, csv: null };
  if (format === "cnab400") return { result: parseCnab400(text), text, csv: null };
  const csv = sniffCsv(text);
  return { result: parseCsv(text, opts.csvMapping ?? csv.guess), text, csv };
}
