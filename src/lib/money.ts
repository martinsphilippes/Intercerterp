/**
 * Aritmética monetária em centavos inteiros e quantidades em milésimos.
 * Nunca usar ponto flutuante para totais financeiros: todas as funções
 * recebem e devolvem inteiros, arredondando metade para longe de zero.
 */

export const QTY = 1000; // 1 unidade = 1000 milésimos

/** Arredondamento "half away from zero" de um racional num/den para inteiro. */
export function roundDiv(num: number, den: number): number {
  if (den === 0) throw new Error("Divisão por zero");
  const sign = Math.sign(num) * Math.sign(den);
  const n = Math.abs(num);
  const d = Math.abs(den);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

/** valor de linha = preço unitário (centavos) × quantidade (milésimos) */
export function lineTotal(unitPrice: number, qty: number): number {
  return roundDiv(unitPrice * qty, QTY);
}

/** aplica percentual em pontos-base (1% = 100) */
export function pct(amount: number, bps: number): number {
  return roundDiv(amount * bps, 10000);
}

/**
 * Rateia `total` proporcionalmente aos `weights`, fechando os centavos exatamente
 * (método do maior resto). Pesos zerados recebem zero, salvo se todos forem zero.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const w = weights.map(() => 1);
    return allocate(total, w);
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sum);
  const base = raw.map((r) => Math.floor(r));
  let rest = abs - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r), w: weights[i] })).sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    base[o.i] += 1;
    rest -= 1;
  }
  return base.map((b) => b * sign);
}

/** Divide um total em N parcelas iguais; a diferença de centavos vai para a primeira parcela. */
export function splitInstallments(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.trunc(total / n);
  const parts = Array(n).fill(base);
  parts[0] += total - base * n;
  return parts;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return brl.format(cents / 100);
}

export function formatQty(milli: number | null | undefined, unit?: string, decimals = 3): string {
  if (milli == null) return "—";
  const v = milli / QTY;
  const s = v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  return unit ? `${s} ${unit}` : s;
}

export function formatBps(bps: number | null | undefined, digits = 2): string {
  if (bps == null) return "—";
  return `${(bps / 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Converte texto digitado ("1.234,56" ou "1234.56") para centavos. */
export function parseMoney(input: string | number | null | undefined): number {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return Math.round(input * 100);
  let s = String(input).trim().replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Valor inválido: ${input}`);
  return Math.round(n * 100);
}

export function parseQty(input: string | number | null | undefined): number {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return Math.round(input * QTY);
  let s = String(input).trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Quantidade inválida: ${input}`);
  return Math.round(n * QTY);
}

export function parseBps(input: string | number | null | undefined): number {
  if (input == null || input === "") return 0;
  const s = typeof input === "number" ? String(input) : String(input).replace("%", "").replace(",", ".").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Percentual inválido: ${input}`);
  return Math.round(n * 100);
}

/** Margem em bps a partir de totais; null quando receita ≤ 0 (estado "sem receita"). */
export function marginBps(revenue: number, cost: number): number | null {
  if (revenue <= 0) return null;
  return roundDiv((revenue - cost) * 10000, revenue);
}

export function markupBps(price: number, cost: number): number | null {
  if (cost <= 0) return null;
  return roundDiv((price - cost) * 10000, cost);
}

/** valor monetário para centavos inteiros a partir de float externo (XML, APIs) */
export function toCents(v: number | string): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Math.round(n * 100);
}
