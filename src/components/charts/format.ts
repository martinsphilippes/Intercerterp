/** Paleta e formatos dos gráficos (validados: contraste ≥ 3:1 e separação para daltonismo). */
export const CHART_COLORS = {
  /** série principal (brand-500) */
  current: "#2f58a8",
  /** série de comparação/acumulado (accent-600) */
  previous: "#d95f0f",
  grid: "#e3e6eb",
  axis: "#64748b",
  /** rampa ordinal das classes ABC (A mais escura) */
  classA: "#142d5c",
  classB: "#2f58a8",
  classC: "#84a3d9",
};

const compact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** valores em REAIS (não centavos) */
export const brlCompact = (v: number) => compact.format(v);
export const brlFull = (v: number) => full.format(v);

export function dateBR(d: string) {
  const [y, m, dd] = d.split("-");
  return dd ? `${dd}/${m}/${y}` : d;
}

export function pctBR(bps: number, digits = 2) {
  return `${(bps / 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
