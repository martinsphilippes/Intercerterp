import "server-only";
import type { SessionInfo } from "./server/session";
import type { SearchParams } from "./list";
import type { ModuleKey } from "./permissions";

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

/** CSV compatível com Excel pt-BR (UTF-8 com BOM, separador ;). */
export function toCsv(columns: ExportColumn[], rows: Record<string, any>[]): string {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [columns.map((c) => esc(c.label)).join(";")];
  for (const r of rows) lines.push(columns.map((c) => esc(cell(r[c.key], c.type))).join(";"));
  return "﻿" + lines.join("\r\n");
}
