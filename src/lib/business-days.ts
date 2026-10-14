import { addDays } from "./dates";

/**
 * Dias úteis para ajuste de vencimento (FIN-26).
 *
 * Considera fim de semana (sábado e domingo) e somente os feriados NACIONAIS DE DATA FIXA:
 *   01/01 Confraternização Universal · 21/04 Tiradentes · 01/05 Dia do Trabalho · 07/09 Independência ·
 *   12/10 Nossa Senhora Aparecida · 02/11 Finados · 15/11 Proclamação da República ·
 *   20/11 Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023, a partir de 2024) · 25/12 Natal.
 * Não entram: feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi), estaduais e municipais — o vencimento
 * nesses dias continua como gerado (pode ser alterado na parcela).
 */
export const BR_FIXED_HOLIDAYS: ReadonlyArray<{ md: string; name: string; since?: number }> = [
  { md: "01-01", name: "Confraternização Universal" },
  { md: "04-21", name: "Tiradentes" },
  { md: "05-01", name: "Dia do Trabalho" },
  { md: "09-07", name: "Independência do Brasil" },
  { md: "10-12", name: "Nossa Senhora Aparecida" },
  { md: "11-02", name: "Finados" },
  { md: "11-15", name: "Proclamação da República" },
  { md: "11-20", name: "Dia Nacional de Zumbi e da Consciência Negra", since: 2024 },
  { md: "12-25", name: "Natal" },
];

/** Regra para vencimento que cai em dia não útil: manter a data (padrão) ou levar ao próximo dia útil. */
export type NonBusinessDayRule = "keep" | "next";

export const NON_BUSINESS_DAY_RULES: Array<{ value: NonBusinessDayRule; label: string }> = [
  { value: "keep", label: "Manter a data gerada" },
  { value: "next", label: "Levar para o próximo dia útil" },
];

/** Feriado nacional fixo na data (AAAA-MM-DD), ou null. */
export function fixedHoliday(date: string): string | null {
  const year = Number(date.slice(0, 4));
  const md = date.slice(5, 10);
  const h = BR_FIXED_HOLIDAYS.find((x) => x.md === md && (!x.since || year >= x.since));
  return h?.name ?? null;
}

/** Sábado, domingo ou feriado nacional fixo não é dia útil. */
export function isBusinessDay(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return fixedHoliday(date) == null;
}

/** A própria data, se útil; senão o próximo dia útil. */
export function nextBusinessDay(date: string): string {
  let d = date;
  // no máximo alguns dias seguidos não úteis (ex.: feriado na sexta + fim de semana)
  for (let i = 0; i < 10 && !isBusinessDay(d); i++) d = addDays(d, 1);
  return d;
}

/** Aplica a regra de vencimento em dia não útil (ausente/"keep" = data inalterada). */
export function adjustDueDate(date: string, rule: NonBusinessDayRule | null | undefined): string {
  return rule === "next" ? nextBusinessDay(date) : date;
}
