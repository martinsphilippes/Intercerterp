import crypto from "node:crypto";

/**
 * Tipos e utilitários comuns dos leitores de arquivos bancários (OFX, CSV, CNAB 240/400).
 * Todos os valores monetários saem em CENTAVOS inteiros (sem ponto flutuante) e datas em AAAA-MM-DD.
 */

export type BankFormat = "ofx" | "csv" | "cnab240" | "cnab400";

/** statement = linha de extrato; collection = liquidação de cobrança (retorno); collection_fee = débito de tarifa de cobrança */
export type BankTxKind = "statement" | "collection" | "collection_fee";

export interface ParsedTx {
  /** linha (1-based) do arquivo onde o registro começa */
  lineNo: number;
  kind: BankTxKind;
  date: string;
  /** + crédito / − débito; na cobrança é o valor líquido creditado (pago − tarifa) */
  amount: number;
  description: string;
  docNumber?: string | null;
  /** FITID (OFX) ou identificador do banco */
  externalId?: string | null;
  // ── campos de cobrança (CNAB)
  occurrence?: string | null;
  occurrenceText?: string | null;
  ourNumber?: string | null;
  yourNumber?: string | null;
  dueDate?: string | null;
  creditDate?: string | null;
  titleAmount?: number | null;
  paidAmount?: number | null;
  interest?: number | null;
  discount?: number | null;
  fee?: number | null;
  payerName?: string | null;
}

export type IssueStatus = "invalid" | "unsupported" | "info";

export interface LineIssue {
  lineNo: number;
  status: IssueStatus;
  message: string;
  raw?: string;
}

export interface ParseResult {
  format: BankFormat;
  /** extrato bancário ou retorno de cobrança */
  kind: "statement" | "collection_return";
  bankCode: string | null;
  bankName?: string | null;
  layoutVersion: string | null;
  account?: { bankId?: string | null; branch?: string | null; accountId?: string | null } | null;
  period?: { from?: string | null; to?: string | null } | null;
  balance?: { amount: number; date?: string | null } | null;
  generatedAt?: string | null;
  transactions: ParsedTx[];
  issues: LineIssue[];
  totalLines: number;
  /** erro fatal (arquivo inteiro rejeitado), quando houver */
  fatal?: string | null;
}

/** Converte texto decimal ("-1.234,56", "1234.56", "1,5") em centavos, sem float. */
export function parseDecimalToCents(raw: string, decimal?: "," | "."): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  let dec = decimal;
  if (!dec) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) dec = lastComma > lastDot ? "," : ".";
    else if (lastComma >= 0) dec = ",";
    else if (lastDot >= 0) {
      // "1.234" (milhar) vs "12.34" (decimal): 3 dígitos após o único ponto e mais de um ponto → milhar
      const parts = s.split(".");
      dec = parts.length > 2 ? "," : ".";
    } else dec = ".";
  }
  const thousand = dec === "," ? "." : ",";
  s = s.split(thousand).join("");
  const [intPart, fracPart = ""] = s.split(dec);
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (intPart === "" && fracPart === "")) return null;
  if (fracPart.length > 2 && /[1-9]/.test(fracPart.slice(2))) return null; // mais de 2 casas significativas
  const cents = Number(intPart || "0") * 100 + Number((fracPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Campo numérico de largura fixa (CNAB) com 2 casas implícitas → centavos. */
export function fixedCents(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

function validDate(y: number, m: number, d: number): string | null {
  if (!(y >= 1990 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** DDMMAAAA (CNAB 240). Zeros = sem data. */
export function dateDDMMAAAA(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{8}$/.test(s) || /^0+$/.test(s)) return null;
  return validDate(Number(s.slice(4, 8)), Number(s.slice(2, 4)), Number(s.slice(0, 2)));
}

/** DDMMAA (CNAB 400), século 2000. Zeros = sem data. */
export function dateDDMMAA(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{6}$/.test(s) || /^0+$/.test(s)) return null;
  return validDate(2000 + Number(s.slice(4, 6)), Number(s.slice(2, 4)), Number(s.slice(0, 2)));
}

/** AAAAMMDD[...] (OFX). */
export function dateYYYYMMDD(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{8}/.test(s)) return null;
  return validDate(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
}

/** Datas digitadas em planilhas: dd/mm/aaaa, aaaa-mm-dd, mm/dd/aaaa, dd/mm/aa. */
export function dateFlexible(raw: string, order: "dmy" | "ymd" | "mdy" = "dmy"): string | null {
  const s = raw.trim().replace(/\s.*$/, "");
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);
  const m = s.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return /^\d{8}$/.test(s) ? (order === "ymd" ? dateYYYYMMDD(s) : dateDDMMAAAA(s)) : null;
  let [a, b, c] = [m[1], m[2], m[3]];
  if (order === "ymd" || a.length === 4) return validDate(+a, +b, +(c.length === 2 ? c : c));
  const year = c.length === 2 ? 2000 + Number(c) : Number(c);
  if (order === "mdy") [a, b] = [b, a];
  return validDate(year, Number(b), Number(a));
}

/** Decodifica o arquivo: UTF-8 válido, senão Latin-1/Windows-1252 (comum em bancos brasileiros). */
export function decodeBankFile(data: Buffer | string): string {
  if (typeof data === "string") return data;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder("windows-1252").decode(data);
  }
  return text.replace(/^﻿/, "");
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

export function hashParts(...parts: Array<string | number | null | undefined>) {
  return crypto.createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 40);
}

/** Recorte de largura fixa usando posições 1-based inclusivas do manual do layout. */
export const pos = (line: string, from: number, to: number) => line.slice(from - 1, to);

export function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export const BANK_NAMES: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "077": "Banco Inter",
  "104": "Caixa Econômica Federal",
  "237": "Bradesco",
  "260": "Nu Pagamentos",
  "290": "PagSeguro",
  "323": "Mercado Pago",
  "336": "C6 Bank",
  "341": "Itaú Unibanco",
  "422": "Safra",
  "748": "Sicredi",
  "756": "Sicoob",
};

export function normalizeBankCode(code: string | null | undefined): string | null {
  const d = (code ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.slice(-3).padStart(3, "0");
}
