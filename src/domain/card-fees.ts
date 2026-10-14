import type { Store } from "@/lib/db/types";
import { featureDefault, isFeatureOn } from "@/lib/core/settings";
import { BusinessError } from "@/lib/core/errors";
import { formatBps } from "@/lib/money";

/**
 * FIN-24 — Taxas de cartão por bandeira × nº de parcelas (`payment_methods.feeTable`).
 *
 * Cada linha da tabela vale para uma bandeira (ou "qualquer bandeira" quando `brand` está vazio) e uma faixa de
 * parcelas (`minInstallments`–`maxInstallments`), com a taxa em pontos-base e o prazo do 1º crédito em dias.
 * Resolução na venda: linha da bandeira informada que cobre o nº de parcelas → linha "qualquer bandeira" da faixa →
 * taxa e prazo únicos do meio (`feeBps`/`settlementDays`, regra anterior). Sem tabela, nada muda.
 */

export interface CardFeeRow {
  /** bandeira (texto livre, comparado sem acentos/espaços/caixa); null/"" = qualquer bandeira */
  brand: string | null;
  minInstallments: number;
  maxInstallments: number;
  feeBps: number;
  /** dias até o crédito da 1ª parcela (as demais seguem de 30 em 30 dias, como hoje) */
  settlementDays: number;
}

export interface CardFeeRule {
  feeBps: number;
  /** prazo do 1º crédito; null/undefined = regra anterior do meio (padrão por tipo) */
  settlementDays: number | null | undefined;
  source: "table" | "method";
  /** descrição da linha aplicada (só quando vem da tabela), ex.: "VISA 2–6x: 3,49% em 30 dias" */
  label: string | null;
}

/** Bandeiras sugeridas na tela (o campo aceita qualquer nome). */
export const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express", "Diners", "Cabal", "Sorocred"];

const ALIASES: Record<string, string> = { MASTER: "MASTERCARD", MC: "MASTERCARD", AMEX: "AMERICANEXPRESS", HIPER: "HIPERCARD", DINERSCLUB: "DINERS" };

/** Forma de comparação da bandeira: sem acentos, espaços e pontuação, maiúscula, com apelidos comuns (Master, Amex). */
export function normalizeBrand(v: string | null | undefined): string {
  const s = String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return ALIASES[s] ?? s;
}

export const MAX_FEE_BPS = 2000;
export const MAX_FEE_ROWS = 60;

/**
 * Valida e normaliza a tabela informada na tela (recusa faixas sobrepostas da mesma bandeira).
 * Tabela vazia → [] (o meio volta à taxa única).
 */
export function validateFeeTable(rows: unknown, maxInstallments = 48): CardFeeRow[] {
  if (rows == null || rows === "") return [];
  if (!Array.isArray(rows)) throw new BusinessError("Tabela de taxas inválida.", "invalid_fee_table");
  if (rows.length > MAX_FEE_ROWS) throw new BusinessError(`A tabela de taxas aceita até ${MAX_FEE_ROWS} linhas.`, "invalid_fee_table");
  const out: CardFeeRow[] = [];
  for (const [i, r] of rows.entries()) {
    const n = i + 1;
    const raw = (r ?? {}) as Record<string, unknown>;
    const brand = String(raw.brand ?? "").trim().slice(0, 40) || null;
    const min = Number(raw.minInstallments ?? 1);
    const max = Number(raw.maxInstallments ?? min);
    const feeBps = Number(raw.feeBps);
    const days = Number(raw.settlementDays ?? 0);
    const bad = (msg: string) => new BusinessError(`Tabela de taxas, linha ${n}: ${msg}`, "invalid_fee_table");
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > Math.max(1, maxInstallments)) throw bad(`faixa de parcelas inválida (de 1 até ${Math.max(1, maxInstallments)}, "até" ≥ "de").`);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) throw bad("taxa deve estar entre 0% e 20% (confira a vírgula decimal).");
    if (!Number.isInteger(days) || days < 0 || days > 400) throw bad("prazo de recebimento deve estar entre 0 e 400 dias.");
    out.push({ brand, minInstallments: min, maxInstallments: max, feeBps, settlementDays: days });
  }
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      const x = out[a];
      const y = out[b];
      if (normalizeBrand(x.brand) !== normalizeBrand(y.brand)) continue;
      if (x.minInstallments <= y.maxInstallments && y.minInstallments <= x.maxInstallments) {
        throw new BusinessError(`Tabela de taxas: as linhas ${a + 1} e ${b + 1} (${x.brand ?? "qualquer bandeira"}) têm faixas de parcelas sobrepostas.`, "invalid_fee_table");
      }
    }
  }
  return out.sort((x, y) => (x.brand ?? "~").localeCompare(y.brand ?? "~", "pt-BR") || x.minInstallments - y.minInstallments);
}

const rangeLabel = (r: CardFeeRow) => (r.minInstallments === r.maxInstallments ? `${r.minInstallments}x` : `${r.minInstallments}–${r.maxInstallments}x`);

export function feeRowLabel(r: CardFeeRow): string {
  return `${r.brand ? r.brand.toUpperCase() : "Qualquer bandeira"} ${rangeLabel(r)}: ${formatBps(r.feeBps)} em ${r.settlementDays} dia(s)`;
}

/** Linha da tabela aplicável (bandeira específica antes de "qualquer bandeira"); null = sem linha. */
export function findFeeRow(table: CardFeeRow[] | null | undefined, brand: string | null | undefined, installments: number): CardFeeRow | null {
  if (!Array.isArray(table) || !table.length) return null;
  const n = Math.max(1, installments || 1);
  const b = normalizeBrand(brand);
  const inRange = (r: CardFeeRow) => n >= r.minInstallments && n <= r.maxInstallments;
  return (b ? table.find((r) => r.brand && normalizeBrand(r.brand) === b && inRange(r)) : null) ?? table.find((r) => !r.brand && inRange(r)) ?? null;
}

/**
 * Taxa e prazo da venda no cartão (função pura). `useTable = false` (recurso desligado) ignora a tabela.
 * Sem linha aplicável, devolve exatamente a regra anterior: `feeBps` e `settlementDays` do meio.
 */
export function resolveCardFee(method: Record<string, any>, brand: string | null | undefined, installments: number, useTable = true): CardFeeRule {
  const row = useTable ? findFeeRow(method.feeTable as CardFeeRow[] | null, brand, installments) : null;
  if (row) return { feeBps: row.feeBps, settlementDays: row.settlementDays, source: "table", label: feeRowLabel(row) };
  return { feeBps: method.feeBps ?? 0, settlementDays: method.settlementDays, source: "method", label: null };
}

/** Recurso `feature.taxasCartao` (ligado por padrão). */
export function cardFeesEnabled(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, "taxasCartao", featureDefault("taxasCartao"));
}

/** Regra da venda no servidor: só consulta o parâmetro quando o meio tem tabela (sem tabela, nenhuma leitura a mais). */
export async function cardFeeForSale(store: Store, companyId: string, branchId: string | null | undefined, method: Record<string, any>, brand: string | null | undefined, installments: number): Promise<CardFeeRule> {
  const hasTable = Array.isArray(method.feeTable) && method.feeTable.length > 0;
  return resolveCardFee(method, brand, installments, hasTable && (await cardFeesEnabled(store, companyId, branchId)));
}
