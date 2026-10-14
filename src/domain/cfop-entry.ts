import { BusinessError } from "@/lib/core/errors";
import { onlyDigits } from "@/lib/core/text";

/** Pares ordenados pelo CFOP de saída (comparação estável do valor gravado). */
export function sortPairs(pairs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(pairs).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Conversor de CFOP de entrada (COM-09), funções puras (usadas também na tela de parâmetros): CFOP de saída que o
 * fornecedor informou no item da NF-e → CFOP de entrada do destinatário. Tabela de pares no parâmetro `purchase.cfopPairs` (empresa/filial), com a tabela padrão abaixo
 * quando não houver valor gravado; recurso ligado/desligado por `feature.conversorCfop` (padrão ligado).
 *
 * Fonte: tabela de CFOP do Convênio SINIEF s/nº de 15/12/1970 (redação do Ajuste SINIEF 07/2001 e alterações).
 * Hipótese (docs/regras-assumidas.md §14): o CFOP de entrada depende da FINALIDADE da compra e não só do CFOP do
 * fornecedor; a tabela padrão assume a finalidade "comercialização" (varejo). Compras para uso e consumo
 * (1556/2556) ou ativo imobilizado (1551/2551) são ajustadas por item na conferência ou com pares próprios.
 * Sem par para o CFOP do item, vale o padrão do recebimento (1102 interna / 2102 interestadual).
 */
export const DEFAULT_CFOP_PAIRS: Readonly<Record<string, string>> = Object.freeze(sortPairs({
  // venda de produção / de mercadoria de terceiros → compra para comercialização
  "5101": "1102", "6101": "2102",
  "5102": "1102", "6102": "2102",
  "5103": "1102", "6103": "2102",
  "5104": "1102", "6104": "2102",
  "5105": "1102", "6105": "2102",
  "5106": "1102", "6106": "2102",
  // venda com substituição tributária → compra para comercialização com ST
  "5401": "1403", "6401": "2403",
  "5402": "1403", "6402": "2403",
  "5403": "1403", "6403": "2403",
  "5405": "1403", "6404": "2403",
  // entrega futura: simples faturamento e remessa
  "5922": "1922", "6922": "2922",
  "5116": "1117", "6116": "2117",
  "5117": "1117", "6117": "2117",
  // venda à ordem (remessa por conta e ordem de terceiros)
  "5923": "1923", "6923": "2923",
  // transferências entre estabelecimentos
  "5152": "1152", "6152": "2152",
  "5409": "1409", "6409": "2409",
  // devoluções de compra feitas pelo cliente-fornecedor (para nós, devolução de venda)
  "5202": "1202", "6202": "2202",
  "5411": "1411", "6411": "2411",
  // bonificação, amostra, demonstração, consignação
  "5910": "1910", "6910": "2910",
  "5911": "1911", "6911": "2911",
  "5912": "1912", "6912": "2912",
  "5913": "1913", "6913": "2913",
  "5917": "1917", "6917": "2917",
  // ativo imobilizado
  "5551": "1551", "6551": "2551",
  // outras saídas não especificadas
  "5949": "1949", "6949": "2949",
}));

export const CFOP_PAIRS_KEY = "purchase.cfopPairs";
export const CFOP_FEATURE = "conversorCfop";

/** CFOP de entrada válido: 4 dígitos começando por 1 (interna), 2 (interestadual) ou 3 (exterior). */
export function isEntryCfop(c: string | null | undefined) {
  return /^[123]\d{3}$/.test(onlyDigits(c));
}

/** Valida um par saída → entrada: saída 5/6/7, entrada 1/2/3, mesma abrangência (5→1, 6→2, 7→3). */
export function pairProblem(from: string, to: string): string | null {
  if (!/^[567]\d{3}$/.test(from)) return `CFOP de saída ${from || "(vazio)"} inválido: 4 dígitos começando por 5, 6 ou 7.`;
  if (!/^[123]\d{3}$/.test(to)) return `CFOP de entrada ${to || "(vazio)"} inválido: 4 dígitos começando por 1, 2 ou 3.`;
  if (Number(from[0]) - 4 !== Number(to[0])) return `Par ${from} → ${to}: saída ${from[0]}xxx corresponde a entrada ${Number(from[0]) - 4}xxx (operação ${from[0] === "5" ? "interna" : from[0] === "6" ? "interestadual" : "com o exterior"}).`;
  return null;
}

/** Lê a tabela de pares em texto ("5102=1102", um por linha ou separados por vírgula/ponto e vírgula). */
export function parseCfopPairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = String(text ?? "")
    .split(/[\n;,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(\d[\d.]*)\s*(?:=|->|→|>|:)\s*(\d[\d.]*)$/);
    if (!m) throw new BusinessError(`Par de CFOP "${p}" inválido: use o formato 5102=1102.`, "invalid");
    const from = onlyDigits(m[1]);
    const to = onlyDigits(m[2]);
    const problem = pairProblem(from, to);
    if (problem) throw new BusinessError(problem, "invalid");
    if (out[from] && out[from] !== to) throw new BusinessError(`CFOP de saída ${from} informado duas vezes (${out[from]} e ${to}).`, "invalid");
    out[from] = to;
  }
  return sortPairs(out);
}

/** Texto editável da tabela (um par por linha, ordenado). */
export function formatCfopPairs(pairs: Record<string, string> | null | undefined) {
  return Object.entries(pairs ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([a, b]) => `${a}=${b}`)
    .join("\n");
}

/** Normaliza o valor gravado (objeto) — entradas inválidas são ignoradas. */
export function normalizePairs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CFOP_PAIRS };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const from = onlyDigits(k);
    const to = onlyDigits(String(v ?? ""));
    if (!pairProblem(from, to)) out[from] = to;
  }
  return sortPairs(out);
}

/** CFOP de entrada do item pelo CFOP do fornecedor; `null` = sem par (vale o padrão do recebimento). */
export function convertCfop(supplierCfop: string | null | undefined, pairs: Record<string, string> | null): string | null {
  if (!pairs) return null;
  const c = onlyDigits(supplierCfop);
  return c ? (pairs[c] ?? null) : null;
}
