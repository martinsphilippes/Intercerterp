/**
 * Bipagem na contagem do inventário (EST-04) — funções puras usadas pela folha de contagem (cliente) e pelos testes.
 * Cada leitura soma ao item lido (1 unidade ou a quantidade informada antes, ex.: "6*7891000100011"); a contagem é
 * acumulada por item e pode ser desfeita (última leitura) ou corrigida (valor exato) antes de gravar. Quantidades em
 * milésimos.
 */
import { QTY } from "@/lib/money";

export interface ScanItem {
  skuId: string;
  sku: string;
  barcode?: string | null;
  extraBarcodes?: string[] | null;
}

export interface ScanEvent {
  skuId: string;
  qty: number;
  /** correção: valor exato da contagem do item (substitui o acumulado) */
  set?: boolean;
}

export interface ScanState {
  /** contagem acumulada por SKU (milésimos) */
  counts: Record<string, number>;
  /** leituras na ordem, para desfazer */
  log: ScanEvent[];
}

export const emptyScan = (): ScanState => ({ counts: {}, log: [] });

/** Interpreta a leitura: "código", "3*código" ou "2,5*código" (quantidade antes do asterisco). */
export function parseScanInput(text: string): { code: string; qty: number | null } {
  const t = text.trim();
  const m = /^(\d+(?:[.,]\d{1,3})?)\s*[*xX]\s*(\S+)$/.exec(t);
  if (!m) return { code: t, qty: null };
  const qty = Math.round(Number(m[1].replace(",", ".")) * QTY);
  return { code: m[2], qty: qty > 0 ? qty : null };
}

/** Localiza o item pelo código de barras (principal ou adicional) ou pelo SKU (sem diferenciar maiúsculas). */
export function findScanItem<T extends ScanItem>(items: T[], code: string): T | null {
  const c = code.trim();
  if (!c) return null;
  const up = c.toUpperCase();
  return items.find((i) => i.barcode === c) ?? items.find((i) => (i.extraBarcodes ?? []).includes(c)) ?? items.find((i) => i.sku.toUpperCase() === up) ?? null;
}

/** Soma a leitura ao item (padrão 1 unidade). */
export function applyScan(state: ScanState, skuId: string, qty: number = QTY): ScanState {
  if (!Number.isInteger(qty) || qty <= 0) return state;
  return { counts: { ...state.counts, [skuId]: (state.counts[skuId] ?? 0) + qty }, log: [...state.log, { skuId, qty }] };
}

/** Correção: define a contagem exata do item (fica no histórico e também pode ser desfeita). */
export function setScanCount(state: ScanState, skuId: string, qty: number): ScanState {
  if (!Number.isInteger(qty) || qty < 0) return state;
  const prev = state.counts[skuId] ?? 0;
  return { counts: { ...state.counts, [skuId]: qty }, log: [...state.log, { skuId, qty: qty - prev, set: true }] };
}

/** Desfaz a última leitura (ou correção). */
export function undoScan(state: ScanState): ScanState {
  const last = state.log[state.log.length - 1];
  if (!last) return state;
  const counts = { ...state.counts };
  const next = (counts[last.skuId] ?? 0) - last.qty;
  if (next > 0) counts[last.skuId] = next;
  else delete counts[last.skuId];
  return { counts, log: state.log.slice(0, -1) };
}

/** Quantidade final do item na gravação: a contagem já gravada (se o modo for "somar à gravada") + a bipada. */
export function scanTotal(state: ScanState, skuId: string, saved: number | null | undefined, mode: "add" | "replace" = "replace"): number {
  const scanned = state.counts[skuId] ?? 0;
  return mode === "add" ? (saved ?? 0) + scanned : scanned;
}
