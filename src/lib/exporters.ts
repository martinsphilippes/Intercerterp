import "server-only";
import type { SessionInfo } from "./server/session";
import type { SearchParams } from "./list";
import type { ModuleKey } from "./permissions";
import { buildXlsx, type XlsxKind, type XlsxValue } from "./xlsx";

/**
 * Exportação do recorte filtrado: cada listagem registra um exportador que reaproveita
 * a MESMA consulta da tela (mesmos filtros e critérios) e devolve linhas planas.
 */
export interface ExportColumn {
  key: string;
  label: string;
  type?: "text" | "money" | "qty" | "date" | "datetime" | "number" | "bps";
}

export interface ExportDef {
  module: ModuleKey;
  title: string;
  columns: ExportColumn[];
  rows: (s: SessionInfo, params: SearchParams) => Promise<Record<string, any>[]>;
}

const registry = new Map<string, ExportDef>();

export function defineExport(key: string, def: ExportDef) {
  registry.set(key, def);
  return def;
}

export function getExport(key: string) {
  return registry.get(key);
}

function cell(v: any, type?: ExportColumn["type"]): string {
  if (v == null) return "";
  switch (type) {
    case "money":
      return (v / 100).toFixed(2).replace(".", ",");
    case "qty":
      return String(v / 1000).replace(".", ",");
    case "bps":
      return (v / 100).toFixed(2).replace(".", ",");
    case "date": {
      const s = String(v).slice(0, 10);
      const [y, m, d] = s.split("-");
      return d ? `${d}/${m}/${y}` : s;
    }
    case "datetime":
      return new Date(v).toLocaleString("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo" });
    default:
      return String(v);
  }
}

/**
 * Número negativo já formatado em texto ("-12,34", "-1.234,56", "-R$ 12,34", "-12,5%"): só sinal, "R$", espaços,
 * dígitos, separadores e "%" — não há como compor fórmula, então segue como número para a planilha.
 */
const PREFORMATTED_NEGATIVE = /^-\s*(R\$\s*)?\d[\d.,]*%?$/; // \s inclui o espaço não separável do Intl

/** Neutraliza fórmulas em texto (injeção de fórmula no Excel/planilhas). Números formatados não são afetados. */
function neutralize(s: string, numeric: boolean): string {
  if (numeric || !s) return s;
  if (PREFORMATTED_NEGATIVE.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** CSV compatível com Excel pt-BR (UTF-8 com BOM, separador ;). */
export function toCsv(columns: ExportColumn[], rows: Record<string, any>[]): string {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const isNum = (t?: ExportColumn["type"]) => t === "money" || t === "qty" || t === "number" || t === "bps";
  const lines = [columns.map((c) => esc(neutralize(c.label, false))).join(";")];
  for (const r of rows) lines.push(columns.map((c) => esc(neutralize(cell(r[c.key], c.type), isNum(c.type)))).join(";"));
  return "﻿" + lines.join("\r\n");
}

/** Valor da coluna convertido para a planilha XLSX (números como número; datas como data do Excel). */
function xlsxValue(v: any, type?: ExportColumn["type"]): XlsxValue {
  if (v == null || v === "") return null;
  switch (type) {
    case "money":
    case "bps":
      return typeof v === "number" ? v / 100 : String(v);
    case "qty":
      return typeof v === "number" ? v / 1000 : String(v);
    case "number":
      return typeof v === "number" ? v : String(v);
    case "date":
      return String(v).slice(0, 10);
    default:
      return typeof v === "string" ? v : String(v);
  }
}

const XLSX_KIND: Record<NonNullable<ExportColumn["type"]>, XlsxKind> = { text: "text", money: "money", bps: "money", qty: "number", number: "number", date: "date", datetime: "datetime" };

/**
 * XLSX (PLA-11) com as MESMAS colunas e linhas do CSV: valores em reais e percentuais com 2 casas, quantidades em
 * unidades, datas como data. Gerado por `src/lib/xlsx.ts` (OOXML mínimo sobre o jszip já usado no projeto).
 */
export function toXlsx(title: string, columns: ExportColumn[], rows: Record<string, any>[]): Promise<Uint8Array> {
  return buildXlsx([
    {
      name: title,
      columns: columns.map((c) => ({ label: c.label, kind: XLSX_KIND[c.type ?? "text"] })),
      rows: rows.map((r) => columns.map((c) => xlsxValue(r[c.key], c.type))),
    },
  ]);
}

/** Formato pedido na URL da exportação: `formato=xlsx` (padrão: CSV, como sempre). */
export function exportFormat(v: string | null | undefined): "csv" | "xlsx" {
  return String(v ?? "").toLowerCase() === "xlsx" ? "xlsx" : "csv";
}

/** Lista de todas as exportações registradas (central de relatórios). */
export function listExports(): Array<{ key: string; def: ExportDef }> {
  return [...registry.entries()].map(([key, def]) => ({ key, def }));
}
