import { assert } from "@/lib/core/errors";
import { normalizeSearch } from "@/lib/list";

/**
 * Motor comum de importação por CSV (extraído de `product-import.ts`, que continua com o mesmo comportamento):
 * leitura do arquivo (separador ; , ou tab detectado, aspas, BOM), sugestão de mapeamento coluna → campo pelos nomes
 * do cabeçalho e análise inicial (cabeçalhos, amostra e contagem) sem gravar nada. Usado pela importação de produtos
 * e pela importação de cadastros e saldos (`data-import.ts`).
 */

export interface ImportField {
  key: string;
  label: string;
  aliases: string[];
}

/** CSV com separador detectado (; , ou tab), aspas e BOM. */
export function parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/)[0] ?? "";
  const delimiter = [";", "\t", ","].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty.map((r) => r.map((c) => c.trim())), delimiter };
}

/** Nome de coluna normalizado para comparar com os apelidos dos campos (sem acento, minúsculo, só letras/dígitos). */
export const normalizeHeader = (h: string) => normalizeSearch(h).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Sugestão de mapeamento: coluna → campo, pelo nome do cabeçalho (cada campo no máximo uma vez). */
export function guessMappingFor(fields: ImportField[], headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    const f = fields.find((x) => !used.has(x.key) && (x.key.toLowerCase() === n || x.aliases.includes(n)));
    if (f) {
      out[String(i)] = f.key;
      used.add(f.key);
    }
  });
  return out;
}

/** Leitura inicial do arquivo: cabeçalhos, amostra e mapeamento sugerido (nada é gravado). */
export function analyzeCsvFor(text: string, fields: ImportField[], maxRows: number) {
  assert(text && text.length <= 5_000_000, "Arquivo vazio ou maior que 5 MB.");
  const { headers, rows, delimiter } = parseCsv(text);
  assert(headers.length > 0, "Não foi possível ler o cabeçalho do CSV.");
  return { headers, sample: rows.slice(0, 5), rowCount: rows.length, delimiter, mapping: guessMappingFor(fields, headers), fields: fields.map((f) => ({ key: f.key, label: f.label })), maxRows };
}

/** Valores da linha pelos campos mapeados (coluna → campo). */
export function mappedValues(cells: string[], mapping: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [col, field] of Object.entries(mapping)) if (field) values[field] = (cells[Number(col)] ?? "").trim();
  return values;
}

/** Mapeamento válido: ao menos uma coluna e cada campo do sistema em uma única coluna. Devolve os campos mapeados. */
export function assertMapping(mapping: Record<string, string>): Set<string> {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  assert(mapped.size > 0, "Mapeie ao menos uma coluna.");
  assert(Object.values(mapping).filter(Boolean).length === mapped.size, "Cada campo do sistema só pode ser mapeado para uma coluna.");
  return mapped;
}

export const truthy = (v: string) => ["s", "sim", "1", "true", "x", "y", "yes", "ativo", "verdadeiro"].includes(normalizeSearch(v));
export const falsy = (v: string) => ["n", "nao", "0", "false", "no", "inativo", "falso"].includes(normalizeSearch(v));

/** CSV de modelo (UTF-8 com BOM, separador ;) a partir do cabeçalho e de linhas de exemplo. */
export function csvTemplate(header: string[], examples: string[][]): string {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + [header, ...examples].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}
