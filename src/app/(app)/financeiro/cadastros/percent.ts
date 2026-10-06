/**
 * Texto digitado em % → pontos-base (1% = 100). Aceita vírgula ou ponto como separador decimal ("1,5" e "1.5" = 1,5%);
 * com vírgula presente, pontos são separadores de milhar (convenção de src/lib/money.ts). Vazio = 0; inválido = null.
 */
export function percentTextToBps(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d*\.?\d*$/.test(norm) || norm === ".") return null;
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
