import { pct, roundDiv } from "@/lib/money";
import { assert } from "@/lib/core/errors";

/**
 * Tributação completa (Fase 7) — regras puras e tabelas sem dependência de servidor (usadas também em componentes do
 * navegador). Ver src/domain/fiscal/tax-complete.ts e docs/regras-assumidas.md §38.
 */

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

/** Sul e Sudeste, exceto o Espírito Santo (Resolução do Senado 22/1989). */
const SOUTH_SOUTHEAST = new Set(["SP", "RJ", "MG", "PR", "SC", "RS"]);
/** Origens com alíquota interestadual de 4% (Resolução do Senado 13/2012): estrangeira (1, 2) e nacional com conteúdo de importação acima de 40% (3, 8). */
const IMPORTED_ORIGINS = new Set(["1", "2", "3", "8"]);

/**
 * Alíquota interestadual (pontos-base): 4% para importados (origem 1, 2, 3 ou 8 — Res. SF 13/2012); 7% das UFs do Sul e
 * Sudeste (exceto ES) para Norte, Nordeste, Centro-Oeste e ES; 12% nas demais (Res. SF 22/1989).
 */
export function interstateRateBps(emitUf: string | null | undefined, destUf: string | null | undefined, origin: string | null | undefined): number {
  if (IMPORTED_ORIGINS.has(String(origin ?? "0"))) return 400;
  const from = String(emitUf ?? "").toUpperCase();
  const to = String(destUf ?? "").toUpperCase();
  if (SOUTH_SOUTHEAST.has(from) && !SOUTH_SOUTHEAST.has(to)) return 700;
  return 1200;
}

/**
 * MVA ajustada (operação interestadual — fórmula dos convênios/protocolos de ST, reproduzida pelas SEFAZ):
 * MVA ajustada = [(1 + MVA original) × (1 − ALQ inter) / (1 − ALQ intra)] − 1. Resultado em pontos-base (2 casas no
 * percentual), arredondado metade para cima.
 */
export function adjustedMvaBps(mvaBps: number, interBps: number, intraBps: number): number {
  assert(intraBps < 10000, "Alíquota interna inválida para a MVA ajustada.");
  return roundDiv((10000 + mvaBps) * (10000 - interBps), 10000 - intraBps) - 10000;
}

// ───────────────────────────── Alíquotas por UF (grupo e tabela da empresa)

export interface UfRate {
  /** alíquota interna do destino (ST interestadual e DIFAL) */
  internalBps: number;
  /** FCP do destino (FCP-ST interestadual e FCP do DIFAL) */
  fcpBps?: number | null;
  /** MVA ajustada informada (sobrepõe o cálculo pela fórmula) */
  mvaAdjBps?: number | null;
}
export type UfRates = Record<string, UfRate>;

const pctNum = (v: string) => {
  const n = Number(v.replace("%", "").replace(",", "."));
  assert(Number.isFinite(n) && n >= 0 && n <= 100, `Percentual inválido: ${v}.`);
  return Math.round(n * 100);
};

/**
 * Lê a tabela de alíquotas por UF de um texto (uma UF por linha: `UF alíquota-interna [FCP] [MVA-ajustada]`, separados
 * por espaço, `;` ou `|`; percentuais com vírgula ou ponto; `-` = não informado). Ex.: `RJ 20 2` / `MG;18;0;54,2`.
 */
export function parseUfRates(text: string | null | undefined): UfRates {
  const out: UfRates = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [uf, internal, fcp, mva] = line.split(/[;|\s\t]+/);
    const UF = String(uf ?? "").toUpperCase();
    assert((UFS as readonly string[]).includes(UF), `UF inválida na tabela de alíquotas: "${uf}".`);
    assert(internal && internal !== "-", `Informe a alíquota interna de ${UF}.`);
    const r: UfRate = { internalBps: pctNum(internal) };
    if (fcp && fcp !== "-") r.fcpBps = pctNum(fcp);
    if (mva && mva !== "-") {
      const n = Number(mva.replace("%", "").replace(",", "."));
      assert(Number.isFinite(n) && n >= 0 && n <= 1000, `MVA ajustada inválida em ${UF}.`);
      r.mvaAdjBps = Math.round(n * 100);
    }
    out[UF] = r;
  }
  return out;
}

export const fmtPct = (bps: number) => String(bps / 100).replace(".", ",");

export function formatUfRates(rates: UfRates | null | undefined): string {
  return Object.entries(rates ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uf, r]) => [uf, fmtPct(r.internalBps), r.fcpBps != null ? fmtPct(r.fcpBps) : r.mvaAdjBps != null ? "-" : null, r.mvaAdjBps != null ? fmtPct(r.mvaAdjBps) : null].filter((x) => x != null).join(" "))
    .join("\n");
}

/** Normaliza o json gravado (descarta entradas inválidas). */
export function cleanUfRates(v: unknown): UfRates {
  const out: UfRates = {};
  if (!v || typeof v !== "object") return out;
  for (const [uf, r] of Object.entries(v as Record<string, any>)) {
    if (!(UFS as readonly string[]).includes(uf) || !r || !Number.isInteger(r.internalBps)) continue;
    out[uf] = { internalBps: r.internalBps, ...(Number.isInteger(r.fcpBps) ? { fcpBps: r.fcpBps } : {}), ...(Number.isInteger(r.mvaAdjBps) ? { mvaAdjBps: r.mvaAdjBps } : {}) };
  }
  return out;
}

// ───────────────────────────── DIFAL por UF

export type DifalMode = "fora" | "dentro";
export const DIFAL_MODE_LABEL: Record<DifalMode, string> = { fora: "Por fora (base única)", dentro: "Por dentro (base dupla)" };

/** `UF modo` por linha (modo = fora | dentro). */
export function parseDifalModes(text: string | null | undefined): Record<string, DifalMode> {
  const out: Record<string, DifalMode> = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [uf, mode] = line.split(/[;|\s\t]+/);
    const UF = String(uf ?? "").toUpperCase();
    assert((UFS as readonly string[]).includes(UF), `UF inválida no modo do DIFAL: "${uf}".`);
    const m = String(mode ?? "").toLowerCase();
    assert(m === "fora" || m === "dentro", `Modo do DIFAL de ${UF} deve ser "fora" ou "dentro".`);
    out[UF] = m;
  }
  return out;
}

export const formatDifalModes = (m: Record<string, DifalMode> | null | undefined) =>
  Object.entries(m ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uf, mode]) => `${uf} ${mode}`)
    .join("\n");

/**
 * DIFAL (EC 87/2015; Convênio ICMS 236/2021; LC 190/2022) — venda interestadual a consumidor final não contribuinte.
 * - "fora" (base única): vBCUFDest = V; vICMSUFDest = V × (ALQ intra − ALQ inter). Ex.: 110 × (18% − 7%) = 12,10.
 * - "dentro" (base dupla): ICMS origem = V × ALQ inter; vBCUFDest = (V − ICMS origem) / (1 − (ALQ intra + FCP));
 *   vICMSUFDest = vBCUFDest × ALQ intra − ICMS origem. (Hipótese: o FCP do destino compõe a carga do divisor.)
 * FCP do destino = base × pFCPUFDest. Partilha 100% para o destino desde 2019 (vICMSUFRemet = 0).
 */
export function computeDifal(v: number, interBps: number, intraBps: number, fcpBps: number, mode: DifalMode) {
  if (mode === "dentro") {
    const icmsOrig = pct(v, interBps);
    const base = roundDiv((v - icmsOrig) * 10000, 10000 - intraBps - fcpBps);
    return { mode, base, fcpBase: base, fcpRateBps: fcpBps, internalRateBps: intraBps, interRateBps: interBps, partBps: 10000, fcp: pct(base, fcpBps), dest: Math.max(0, pct(base, intraBps) - icmsOrig), remet: 0 };
  }
  return { mode, base: v, fcpBase: v, fcpRateBps: fcpBps, internalRateBps: intraBps, interRateBps: interBps, partBps: 10000, fcp: pct(v, fcpBps), dest: Math.max(0, roundDiv(v * (intraBps - interBps), 10000)), remet: 0 };
}

export type NatureKind = "sale" | "sale_return" | "supplier_return" | "transfer" | "purchase" | "other";

export interface OperationNature {
  key: string;
  label: string;
  operationType: "saida" | "entrada";
  purpose: "normal" | "devolucao" | "complementar" | "ajuste";
  kind: NatureKind;
  /** CFOP padrão (vazio = do grupo tributário / regra atual) */
  cfopInternal: string | null;
  cfopInterstate: string | null;
  /** CST/CSOSN padrão por regime (vazio = do grupo/produto) */
  cstSimples: string | null;
  cstNormal: string | null;
  active: boolean;
}

/**
 * Tabela padrão (hipóteses — validar com a contabilidade). CFOP do Anexo do Convênio s/nº de 1970 (CFOP); CST/CSOSN
 * sugeridos: remessa/retorno de conserto com suspensão (CST 50 / CSOSN 900), outras saídas CST 90 / CSOSN 900; demais
 * seguem o grupo tributário. "Venda" sem CFOP próprio = exatamente a regra atual.
 */
export const DEFAULT_NATURES: OperationNature[] = [
  { key: "venda", label: "Venda de mercadoria", operationType: "saida", purpose: "normal", kind: "sale", cfopInternal: null, cfopInterstate: null, cstSimples: null, cstNormal: null, active: true },
  { key: "venda_producao", label: "Venda de produção do estabelecimento", operationType: "saida", purpose: "normal", kind: "sale", cfopInternal: "5101", cfopInterstate: "6101", cstSimples: null, cstNormal: null, active: true },
  { key: "devolucao_venda", label: "Devolução de venda", operationType: "entrada", purpose: "devolucao", kind: "sale_return", cfopInternal: "1202", cfopInterstate: "2202", cstSimples: null, cstNormal: null, active: true },
  { key: "devolucao_compra", label: "Devolução de mercadoria ao fornecedor", operationType: "saida", purpose: "devolucao", kind: "supplier_return", cfopInternal: "5202", cfopInterstate: "6202", cstSimples: null, cstNormal: null, active: true },
  { key: "remessa_conserto", label: "Remessa para conserto ou reparo", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5915", cfopInterstate: "6915", cstSimples: "900", cstNormal: "50", active: true },
  { key: "retorno_conserto", label: "Retorno de mercadoria remetida para conserto", operationType: "entrada", purpose: "normal", kind: "other", cfopInternal: "1916", cfopInterstate: "2916", cstSimples: "900", cstNormal: "50", active: true },
  { key: "demonstracao", label: "Remessa para demonstração", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5912", cfopInterstate: "6912", cstSimples: null, cstNormal: null, active: true },
  { key: "bonificacao", label: "Remessa em bonificação, doação ou brinde", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5910", cfopInterstate: "6910", cstSimples: null, cstNormal: null, active: true },
  { key: "transferencia", label: "Transferência de mercadoria entre filiais", operationType: "saida", purpose: "normal", kind: "transfer", cfopInternal: null, cfopInterstate: null, cstSimples: null, cstNormal: null, active: true },
  { key: "consignacao", label: "Remessa em consignação mercantil", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5917", cfopInterstate: "6917", cstSimples: null, cstNormal: null, active: true },
  { key: "compra", label: "Entrada de mercadoria (compra)", operationType: "entrada", purpose: "normal", kind: "purchase", cfopInternal: null, cfopInterstate: null, cstSimples: null, cstNormal: null, active: true },
  { key: "outras_saidas", label: "Outras saídas", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5949", cfopInterstate: "6949", cstSimples: "900", cstNormal: "90", active: true },
];

export const NATURE_KIND_LABEL: Record<NatureKind, string> = { sale: "Venda", sale_return: "Devolução de venda", supplier_return: "Devolução a fornecedor", transfer: "Transferência", purchase: "Compra", other: "Outra" };
