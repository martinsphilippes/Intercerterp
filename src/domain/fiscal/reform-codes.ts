/**
 * Tabelas da reforma tributária sem dependência de servidor (usadas também em componentes do navegador).
 * Ver src/domain/fiscal/reform.ts e docs/regras-assumidas.md §34.
 */

/** CST do IBS/CBS (tabela da IT 2025.002 — conferir a versão vigente no Portal Nacional da NF-e). */
export const IBS_CBS_CST: Record<string, string> = {
  "000": "Tributação integral",
  "010": "Tributação com alíquotas uniformes — operações do FGTS",
  "011": "Tributação com alíquotas uniformes reduzidas",
  "200": "Alíquota zero ou reduzida",
  "210": "Alíquota reduzida com redutor de base de cálculo",
  "220": "Alíquota fixa",
  "221": "Alíquota fixa proporcional",
  "400": "Isenção",
  "410": "Imunidade e não incidência",
  "510": "Diferimento",
  "550": "Suspensão",
  "620": "Tributação monofásica",
  "800": "Transferência de crédito",
  "810": "Ajustes",
  "820": "Tributação em declaração de regime específico",
};

export const IBS_CBS_CST_OPTIONS = Object.entries(IBS_CBS_CST).map(([value, label]) => ({ value, label: `${value} — ${label}` }));

/** Alíquotas do período de teste de 2026 (LC 214/2025, arts. 343 e 346) — sugestão no cadastro, nunca aplicada sozinha. */
export const TEST_RATES_2026 = { ibsRateBps: 10, cbsRateBps: 90 };
