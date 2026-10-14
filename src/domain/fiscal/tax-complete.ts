import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { pct, roundDiv } from "@/lib/money";
import { assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { featureDefault, getSetting, isFeatureOn, setSetting } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";

/**
 * Tributação completa (Fase 7): FIS-12 (ICMS próprio no CST 10/70, alíquota interestadual 4/7/12%, ICMS-ST com MVA
 * original/ajustada, FCP e FCP-ST, base do PIS/COFINS sem o ICMS), FIS-16 (DIFAL — EC 87/2015, "por fora" ou "por dentro"
 * por UF), FIS-11/07 (naturezas de operação com CFOP e CST padrão) e FIS-13 (crédito do Simples Nacional — LC 123/2006,
 * art. 23).
 *
 * Tudo ADITIVO e atrás de recursos DESLIGADOS por padrão (FEATURE_DEFAULTS): `feature.tributacaoCompleta` (FIS-12/16),
 * `feature.naturezasOperacao` (FIS-11/07) e `feature.creditoSimples` (FIS-13). Desligados, nenhum campo novo é lido e os
 * documentos saem exatamente como antes (teste de igualdade em tests/tax-complete.test.ts).
 *
 * Regras = hipóteses a validar com a contabilidade e em homologação (docs/regras-assumidas.md §38).
 */

export const TAX_COMPLETE_FEATURE = "tributacaoCompleta";
export const NATURES_FEATURE = "naturezasOperacao";
export const SIMPLES_CREDIT_FEATURE = "creditoSimples";

/** Parâmetros (empresa/filial) usados só com os recursos ligados. */
export const TC_SETTINGS = {
  pisCofinsExcludeIcms: "fiscal.pisCofinsExcludeIcms",
  difalDefaultMode: "fiscal.difalDefaultMode",
  difalModeByUf: "fiscal.difalModeByUf",
  ufRates: "fiscal.ufRates",
  simplesCreditBps: "fiscal.simplesCreditBps",
  operationNatures: "fiscal.operationNatures",
} as const;

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

const fmtPct = (bps: number) => String(bps / 100).replace(".", ",");

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

// ───────────────────────────── Cálculo do item

export interface ItemSt {
  mvaBps: number;
  /** MVA ajustada (calculada pela fórmula ou informada na UF) */
  mvaAdjusted: boolean;
  redBps: number;
  base: number;
  rateBps: number;
  value: number;
  fcpBase: number;
  fcpRateBps: number;
  fcp: number;
}

export type ItemDifal = ReturnType<typeof computeDifal>;

/** Campos da tributação completa do item (gravados em `DocItem.tc` SOMENTE com os recursos ligados e algo calculado). */
export interface ItemComplete {
  /** alíquota interestadual aplicada ao ICMS próprio */
  interRateBps?: number;
  fcp?: { base: number; rateBps: number; value: number };
  st?: ItemSt;
  difal?: ItemDifal;
  /** crédito do Simples Nacional (pCredSN/vCredICMSSN) */
  credSn?: { rateBps: number; value: number };
  /** base do PIS/COFINS sem o ICMS próprio */
  pisCofinsExIcms?: boolean;
  warnings?: string[];
}

/** Parâmetros da empresa/filial para o cálculo (lidos só com algum recurso ligado). */
export interface CompleteSettings {
  taxOn: boolean;
  creditOn: boolean;
  pisCofinsExcludeIcms: boolean;
  difalDefaultMode: DifalMode;
  difalModeByUf: Record<string, DifalMode>;
  ufRates: UfRates;
  simplesCreditBps: number | null;
}

export async function loadCompleteSettings(store: Store, companyId: string, branchId: string | null | undefined, regimeSimples: boolean): Promise<CompleteSettings | null> {
  const taxOn = await isFeatureOn(store, companyId, branchId, TAX_COMPLETE_FEATURE, featureDefault(TAX_COMPLETE_FEATURE, false));
  const creditOn = regimeSimples ? await isFeatureOn(store, companyId, branchId, SIMPLES_CREDIT_FEATURE, featureDefault(SIMPLES_CREDIT_FEATURE, false)) : false;
  if (!taxOn && !creditOn) return null;
  const g = <T>(k: string, d: T) => getSetting<T>(store, companyId, branchId, k, d);
  const mode = await g<string>(TC_SETTINGS.difalDefaultMode, "fora");
  const byUf = await g<Record<string, string>>(TC_SETTINGS.difalModeByUf, {});
  const credit = await g<number | null>(TC_SETTINGS.simplesCreditBps, null);
  return {
    taxOn,
    creditOn,
    pisCofinsExcludeIcms: Boolean(await g(TC_SETTINGS.pisCofinsExcludeIcms, false)),
    difalDefaultMode: mode === "dentro" ? "dentro" : "fora",
    difalModeByUf: Object.fromEntries(Object.entries(byUf ?? {}).filter(([, m]) => m === "fora" || m === "dentro")) as Record<string, DifalMode>,
    ufRates: cleanUfRates(await g(TC_SETTINGS.ufRates, {})),
    simplesCreditBps: Number.isInteger(credit) && (credit as number) > 0 ? (credit as number) : null,
  };
}

export interface CompleteInput {
  net: number;
  cst: string;
  simples: boolean;
  model: "nfe" | "nfce";
  /** saída (venda, transferência, remessa, devolução a fornecedor); entradas não calculam ST nem DIFAL */
  saida: boolean;
  /** venda (ou outra saída) — DIFAL só em saída */
  interstate: boolean;
  emitUf: string | null;
  destUf: string | null;
  origin: string;
  /** destinatário consumidor final não contribuinte (indIEDest 9) */
  nonContributor: boolean;
  /** destinatário marcado como consumidor final */
  finalConsumer: boolean;
  group: Doc | null;
  icmsRateBps: number;
  icmsBaseReductionBps: number;
  pisRateBps: number;
  cofinsRateBps: number;
}

export interface CompleteResult {
  icmsBase: number;
  icmsRateBps: number;
  icmsBaseReductionBps: number;
  icms: number;
  pisBase: number;
  pis: number;
  cofinsBase: number;
  cofins: number;
  tc: ItemComplete | null;
}

const OWN_ICMS_CST = new Set(["00", "20", "10", "70"]);
const ST_NORMAL = new Set(["10", "70"]);
const ST_SIMPLES = new Set(["201", "202", "203"]);
const CREDIT_CSOSN = new Set(["101", "201"]);

/**
 * Cálculo do item com os recursos ligados (substitui o cálculo de ICMS/PIS/COFINS de `buildItems` só quando
 * `settings` existe). Regras:
 *  - ICMS próprio (regime normal) nos CST 00, 20, 10 e 70 (CST 20/70 com a redução de base do grupo); interestadual com a
 *    alíquota 4/7/12% (`interstateRateBps`) — interno com a alíquota do grupo (como antes);
 *  - FCP próprio (operação interna) = base do ICMS × FCP do grupo;
 *  - ICMS-ST (NF-e de saída a destinatário que não é consumidor final) nos CST 10/70 e CSOSN 201/202/203:
 *    base ST = valor do item × (1 + MVA) (− redução da ST no CST 70); interno: MVA original e alíquota da ST do grupo;
 *    interestadual: alíquota interna da UF de destino e MVA ajustada (informada na UF ou pela fórmula; Simples usa a
 *    MVA original); ICMS-ST = base ST × alíquota − ICMS próprio (Simples: ICMS próprio presumido pela alíquota
 *    interna/interestadual); FCP-ST = base ST × FCP (destino, se interestadual) − FCP próprio;
 *  - DIFAL (regime normal, NF-e de saída interestadual a não contribuinte): `computeDifal` sobre a base do ICMS próprio;
 *  - PIS/COFINS (regime normal) com base sem o ICMS próprio, se o parâmetro estiver marcado (tema 69 do STF);
 *  - crédito do Simples (CSOSN 101/201, NF-e) = valor do item × pCredSN.
 */
export function computeItemComplete(p: CompleteInput, s: CompleteSettings): CompleteResult {
  const g: Record<string, any> = p.group ?? {};
  const normal = !p.simples;
  const tc: ItemComplete = {};
  const warnings: string[] = [];
  let icmsBase = 0;
  let icms = 0;
  let red = 0;
  let rate = p.icmsRateBps;
  let pisBase = p.net;
  let cofinsBase = p.net;
  const destUf = p.destUf && p.destUf !== "EX" ? p.destUf.toUpperCase() : null;
  const inter = s.taxOn && p.interstate && destUf ? interstateRateBps(p.emitUf, destUf, p.origin) : null;
  if (s.taxOn) {
    if (p.interstate && !destUf && p.model === "nfe") warnings.push("UF do destinatário não informada: alíquota interestadual, ST e DIFAL não calculados.");
    const ufRates: UfRates = { ...s.ufRates, ...cleanUfRates(g.ufRates) };
    if (normal && OWN_ICMS_CST.has(p.cst)) {
      if (inter != null) {
        rate = inter;
        tc.interRateBps = inter;
      }
      red = p.cst === "20" || p.cst === "70" ? p.icmsBaseReductionBps : 0;
      icmsBase = p.net - pct(p.net, red);
      icms = pct(icmsBase, rate);
    }
    // FCP próprio (somente operação interna)
    const fcpRate = Number(g.fcpRateBps ?? 0);
    let fcpOwn = 0;
    if (!p.interstate && icmsBase && fcpRate > 0) {
      fcpOwn = pct(icmsBase, fcpRate);
      tc.fcp = { base: icmsBase, rateBps: fcpRate, value: fcpOwn };
    }
    // ICMS-ST
    const stCst = normal ? ST_NORMAL.has(p.cst) : ST_SIMPLES.has(p.cst);
    if (stCst && p.model === "nfe" && p.saida && !p.finalConsumer && !p.nonContributor && !(p.interstate && !destUf)) {
      const dest = p.interstate ? ufRates[destUf!] : null;
      const stRate = p.interstate ? (dest?.internalBps ?? null) : (g.stRateBps ?? p.icmsRateBps ?? null);
      const mvaOrig = Number.isInteger(g.stMvaBps) ? Number(g.stMvaBps) : null;
      let mva: number | null = mvaOrig;
      let adjusted = false;
      if (p.interstate && dest?.mvaAdjBps != null) {
        mva = dest.mvaAdjBps;
        adjusted = true;
      } else if (p.interstate && normal && mvaOrig != null && stRate) {
        mva = adjustedMvaBps(mvaOrig, inter!, stRate);
        adjusted = true;
      }
      if (mva == null || !stRate) warnings.push(`ICMS-ST não calculado: informe a MVA e a alíquota interna${p.interstate ? ` de ${destUf}` : " da ST"} no grupo tributário${p.interstate ? " (ou na tabela de alíquotas por UF)" : ""}.`);
      else {
        const stRed = p.cst === "70" ? Number(g.stBaseReductionBps ?? 0) : 0;
        const full = roundDiv(p.net * (10000 + mva), 10000);
        const base = full - pct(full, stRed);
        const ownDeduction = normal ? icms : pct(p.net, inter ?? stRate);
        const value = Math.max(0, pct(base, stRate) - ownDeduction);
        const fcpStRate = p.interstate ? Number(dest?.fcpBps ?? 0) : fcpRate;
        const fcpSt = fcpStRate > 0 ? Math.max(0, pct(base, fcpStRate) - fcpOwn) : 0;
        tc.st = { mvaBps: mva, mvaAdjusted: adjusted, redBps: stRed, base, rateBps: stRate, value, fcpBase: fcpStRate > 0 ? base : 0, fcpRateBps: fcpStRate, fcp: fcpSt };
      }
    }
    // DIFAL
    if (normal && p.model === "nfe" && p.saida && p.interstate && destUf && p.nonContributor && icmsBase > 0 && inter != null) {
      const dest = ufRates[destUf];
      if (!dest) warnings.push(`DIFAL não calculado: alíquota interna de ${destUf} não cadastrada (grupo tributário ou Fiscal › Configurações › Operações).`);
      else tc.difal = computeDifal(icmsBase, inter, dest.internalBps, Number(dest.fcpBps ?? 0), s.difalModeByUf[destUf] ?? s.difalDefaultMode);
    }
    // PIS/COFINS sem o ICMS próprio na base
    if (normal && s.pisCofinsExcludeIcms && icms > 0) {
      pisBase = cofinsBase = p.net - icms;
      tc.pisCofinsExIcms = true;
    }
  } else if (normal && ["00", "20"].includes(p.cst)) {
    // recurso de tributação desligado (só o crédito do Simples ligado): cálculo anterior
    red = p.cst === "20" ? p.icmsBaseReductionBps : 0;
    icmsBase = p.net - pct(p.net, red);
    icms = pct(icmsBase, p.icmsRateBps);
  }
  // crédito do Simples Nacional (FIS-13)
  if (s.creditOn && p.simples && CREDIT_CSOSN.has(p.cst) && p.model === "nfe") {
    if (!s.simplesCreditBps) warnings.push("CSOSN com permissão de crédito sem o percentual de crédito do Simples (pCredSN) — informe em Fiscal › Configurações › Operações.");
    else tc.credSn = { rateBps: s.simplesCreditBps, value: pct(p.net, s.simplesCreditBps) };
  }
  if (warnings.length) tc.warnings = warnings;
  const pis = p.pisRateBps ? pct(pisBase, p.pisRateBps) : 0;
  const cofins = p.cofinsRateBps ? pct(cofinsBase, p.cofinsRateBps) : 0;
  return { icmsBase, icmsRateBps: rate, icmsBaseReductionBps: red, icms, pisBase, pis, cofinsBase, cofins, tc: Object.keys(tc).length ? tc : null };
}

// ───────────────────────────── Totais, payload e XML

type WithTc = { tc?: ItemComplete | null };

/** Totais da tributação completa; null quando nenhum item tem os campos (documento como antes). */
export function completeTotals(items: WithTc[]) {
  const list = items.map((i) => i.tc).filter((t): t is ItemComplete => Boolean(t));
  if (!list.some((t) => t.st || t.fcp || t.difal || t.credSn)) return null;
  const sum = (f: (t: ItemComplete) => number) => list.reduce((a, t) => a + f(t), 0);
  return {
    icmsStBase: sum((t) => t.st?.base ?? 0),
    icmsSt: sum((t) => t.st?.value ?? 0),
    fcp: sum((t) => t.fcp?.value ?? 0),
    fcpSt: sum((t) => t.st?.fcp ?? 0),
    fcpUfDest: sum((t) => t.difal?.fcp ?? 0),
    icmsUfDest: sum((t) => t.difal?.dest ?? 0),
    icmsUfRemet: sum((t) => t.difal?.remet ?? 0),
    credSn: sum((t) => t.credSn?.value ?? 0),
  };
}

const money = (c: number) => Number((c / 100).toFixed(2));
const rate = (bps: number) => bps / 100;

/** Campos do item no payload do provedor (nomes da API Focus NFe — conferir em homologação). */
export function completePayloadItem(t: ItemComplete | null | undefined): Record<string, any> {
  if (!t) return {};
  const out: Record<string, any> = {};
  if (t.fcp) Object.assign(out, { fcp_base_calculo: money(t.fcp.base), fcp_percentual: rate(t.fcp.rateBps), fcp_valor: money(t.fcp.value) });
  if (t.st) {
    Object.assign(out, {
      icms_modalidade_base_calculo_st: 4,
      icms_margem_valor_adicionado_st: rate(t.st.mvaBps),
      ...(t.st.redBps ? { icms_reducao_base_calculo_st: rate(t.st.redBps) } : {}),
      icms_base_calculo_st: money(t.st.base),
      icms_aliquota_st: rate(t.st.rateBps),
      icms_valor_st: money(t.st.value),
    });
    if (t.st.fcpRateBps) Object.assign(out, { fcp_base_calculo_st: money(t.st.fcpBase), fcp_percentual_st: rate(t.st.fcpRateBps), fcp_valor_st: money(t.st.fcp) });
  }
  if (t.difal)
    Object.assign(out, {
      icms_base_calculo_uf_destino: money(t.difal.base),
      fcp_base_calculo_uf_destino: money(t.difal.fcpBase),
      fcp_percentual_uf_destino: rate(t.difal.fcpRateBps),
      icms_aliquota_interna_uf_destino: rate(t.difal.internalRateBps),
      icms_aliquota_interestadual: rate(t.difal.interRateBps),
      icms_percentual_partilha: rate(t.difal.partBps),
      fcp_valor_uf_destino: money(t.difal.fcp),
      icms_valor_uf_destino: money(t.difal.dest),
      icms_valor_uf_remetente: money(t.difal.remet),
    });
  if (t.credSn) Object.assign(out, { icms_aliquota_credito_simples: rate(t.credSn.rateBps), icms_valor_credito_simples: money(t.credSn.value) });
  return out;
}

/** Totais na raiz do payload — vazio sem itens com os campos. */
export function completePayloadTotals(items: WithTc[]): Record<string, any> {
  const t = completeTotals(items);
  if (!t) return {};
  const out: Record<string, any> = {};
  if (t.icmsSt || t.icmsStBase) Object.assign(out, { icms_base_calculo_st: money(t.icmsStBase), icms_valor_total_st: money(t.icmsSt) });
  if (t.fcp) out.fcp_valor_total = money(t.fcp);
  if (t.fcpSt) out.fcp_valor_total_st = money(t.fcpSt);
  if (items.some((i) => i.tc?.difal)) Object.assign(out, { fcp_valor_total_uf_destino: money(t.fcpUfDest), icms_valor_total_uf_destino: money(t.icmsUfDest), icms_valor_total_uf_remetente: money(t.icmsUfRemet) });
  return out;
}

const x2 = (c: number) => (c / 100).toFixed(2);
const p4 = (bps: number) => (bps / 100).toFixed(4);

/** Elementos do item no XML de simulação (só com os campos calculados). */
export function completeXmlItem(t: ItemComplete | null | undefined): string {
  if (!t) return "";
  const parts: string[] = [];
  if (t.fcp) parts.push(`<FCP vBCFCP="${x2(t.fcp.base)}" pFCP="${p4(t.fcp.rateBps)}" vFCP="${x2(t.fcp.value)}"/>`);
  if (t.st) parts.push(`<ICMSST modBCST="4" pMVAST="${p4(t.st.mvaBps)}"${t.st.redBps ? ` pRedBCST="${p4(t.st.redBps)}"` : ""} vBCST="${x2(t.st.base)}" pICMSST="${p4(t.st.rateBps)}" vICMSST="${x2(t.st.value)}"${t.st.fcpRateBps ? ` vBCFCPST="${x2(t.st.fcpBase)}" pFCPST="${p4(t.st.fcpRateBps)}" vFCPST="${x2(t.st.fcp)}"` : ""}/>`);
  if (t.difal) parts.push(`<ICMSUFDest vBCUFDest="${x2(t.difal.base)}" vBCFCPUFDest="${x2(t.difal.fcpBase)}" pFCPUFDest="${p4(t.difal.fcpRateBps)}" pICMSUFDest="${p4(t.difal.internalRateBps)}" pICMSInter="${p4(t.difal.interRateBps)}" pICMSInterPart="${p4(t.difal.partBps)}" vFCPUFDest="${x2(t.difal.fcp)}" vICMSUFDest="${x2(t.difal.dest)}" vICMSUFRemet="${x2(t.difal.remet)}"/>`);
  if (t.credSn) parts.push(`<CredSN pCredSN="${p4(t.credSn.rateBps)}" vCredICMSSN="${x2(t.credSn.value)}"/>`);
  return parts.join("");
}

/** Totais no XML de simulação (linha própria antes de <total>; vazio sem itens com os campos). */
export function completeXmlTotals(items: WithTc[]): string {
  const t = completeTotals(items);
  if (!t) return "";
  return `  <ICMSTotComp vBCST="${x2(t.icmsStBase)}" vST="${x2(t.icmsSt)}" vFCP="${x2(t.fcp)}" vFCPST="${x2(t.fcpSt)}" vFCPUFDest="${x2(t.fcpUfDest)}" vICMSUFDest="${x2(t.icmsUfDest)}" vICMSUFRemet="${x2(t.icmsUfRemet)}"/>\n`;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Mensagem obrigatória do crédito do Simples nas informações complementares (LC 123/2006, art. 23; Resolução CGSN
 * 140/2018). Null sem itens com crédito.
 */
export function simplesCreditMessage(items: WithTc[]): string | null {
  const list = items.map((i) => i.tc?.credSn).filter((c): c is { rateBps: number; value: number } => Boolean(c));
  if (!list.length) return null;
  const value = list.reduce((a, c) => a + c.value, 0);
  const rates = [...new Set(list.map((c) => c.rateBps))];
  return `DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. PERMITE O APROVEITAMENTO DO CRÉDITO DE ICMS NO VALOR DE R$ ${brl(value)}, CORRESPONDENTE À ALÍQUOTA DE ${rates.map((r) => `${brl(r)}%`).join(" / ")}, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR Nº 123, DE 2006.`;
}

// ───────────────────────────── Naturezas de operação (FIS-11/07)

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

export async function listNatures(store: Store, companyId: string, branchId: string | null | undefined): Promise<OperationNature[]> {
  const v = await getSetting<OperationNature[] | null>(store, companyId, branchId, TC_SETTINGS.operationNatures, null);
  return Array.isArray(v) && v.length ? v : DEFAULT_NATURES;
}

export async function natureFor(store: Store, companyId: string, branchId: string | null | undefined, key: string | null | undefined): Promise<OperationNature | null> {
  if (!key) return null;
  return (await listNatures(store, companyId, branchId)).find((n) => n.key === key && n.active !== false) ?? null;
}

const SIMPLES_REGIMES = new Set(["simples", "mei", "simples_excesso"]);

/** Grupo tributário dedicado à natureza (`tax_groups.operationKey`), ativo e do mesmo regime da empresa (quando informado). */
export async function natureGroupFor(store: Store, companyId: string, key: string, companySimples: boolean): Promise<Doc | null> {
  const groups = await listAll(store, "tax_groups", { filters: [["eq", "companyId", companyId], ["eq", "operationKey", key]], orderBy: [{ field: "name" }] });
  return groups.find((g) => g.active !== false && (!g.regime || SIMPLES_REGIMES.has(g.regime) === companySimples)) ?? null;
}

export interface NatureInput {
  key: string;
  label: string;
  operationType: string;
  purpose: string;
  kind: string;
  cfopInternal?: string | null;
  cfopInterstate?: string | null;
  cstSimples?: string | null;
  cstNormal?: string | null;
  active: boolean;
}

/** Valida e normaliza uma natureza (CFOP coerente com o tipo de operação). */
export function normalizeNature(i: NatureInput): OperationNature {
  const key = String(i.key ?? "").trim().toLowerCase();
  assert(/^[a-z0-9_]{2,40}$/.test(key), "Código da natureza inválido (2 a 40 letras minúsculas, números ou _).");
  const label = String(i.label ?? "").trim();
  assert(label.length >= 3 && label.length <= 60, "Descrição da natureza deve ter de 3 a 60 caracteres (natOp).");
  assert(i.operationType === "saida" || i.operationType === "entrada", "Tipo de operação inválido.");
  assert(["normal", "devolucao", "complementar", "ajuste"].includes(i.purpose), "Finalidade inválida.");
  assert(i.kind in NATURE_KIND_LABEL, "Tipo da natureza inválido.");
  const saida = i.operationType === "saida";
  const cfop = (v: string | null | undefined, first: string, label: string) => {
    const d = onlyDigits(v);
    if (!d) return null;
    assert(d.length === 4 && d[0] === first, `${label}: CFOP deve começar por ${first} (${saida ? "saída" : "entrada"}).`);
    return d;
  };
  const cstS = onlyDigits(i.cstSimples) || null;
  const cstN = onlyDigits(i.cstNormal) || null;
  if (cstS) assert(cstS.length === 3, "CSOSN padrão deve ter 3 dígitos.");
  if (cstN) assert(cstN.length === 2, "CST padrão (regime normal) deve ter 2 dígitos.");
  return {
    key,
    label,
    operationType: i.operationType as OperationNature["operationType"],
    purpose: i.purpose as OperationNature["purpose"],
    kind: i.kind as NatureKind,
    cfopInternal: cfop(i.cfopInternal, saida ? "5" : "1", "CFOP interno"),
    cfopInterstate: cfop(i.cfopInterstate, saida ? "6" : "2", "CFOP interestadual"),
    cstSimples: cstS,
    cstNormal: cstN,
    active: Boolean(i.active),
  };
}

/** Grava (inclui ou altera) uma natureza na tabela da empresa (Fiscal › Configurações › Operações). */
export async function saveNature(ctx: Ctx, input: NatureInput, opts: { originalKey?: string | null } = {}) {
  requireAction(ctx, "fiscal.configure");
  assert(await isFeatureOn(ctx.store, ctx.companyId, ctx.branchId, NATURES_FEATURE, featureDefault(NATURES_FEATURE, false)), "Recurso de naturezas de operação desligado (Administração › Parâmetros › Recursos).", "feature_off");
  const n = normalizeNature(input);
  const list = [...(await listNatures(ctx.store, ctx.companyId, null))];
  const orig = opts.originalKey ?? null;
  const idx = list.findIndex((x) => x.key === (orig ?? n.key));
  if (!orig || orig !== n.key) assert(!list.some((x) => x.key === n.key), `Já existe a natureza "${n.key}".`);
  if (idx >= 0 && orig) list[idx] = n;
  else list.push(n);
  await setSetting(ctx.store, ctx.companyId, null, TC_SETTINGS.operationNatures, list, ctx.user.id);
  await audit(ctx, { module: "fiscal", action: "nature.save", entityType: "settings", entityId: TC_SETTINGS.operationNatures, summary: `Natureza de operação "${n.label}" (${n.key}) ${idx >= 0 && orig ? "alterada" : "incluída"}`, after: n });
  return n;
}

export interface CompleteSettingsInput {
  pisCofinsExcludeIcms: boolean;
  difalDefaultMode: string;
  difalModes: string;
  ufRates: string;
}

/** Opções da tributação completa (empresa): PIS/COFINS sem ICMS, modo do DIFAL (padrão e por UF) e alíquotas por UF. */
export async function saveCompleteSettings(ctx: Ctx, input: CompleteSettingsInput) {
  requireAction(ctx, "fiscal.configure");
  assert(await isFeatureOn(ctx.store, ctx.companyId, ctx.branchId, TAX_COMPLETE_FEATURE, featureDefault(TAX_COMPLETE_FEATURE, false)), "Recurso de tributação completa desligado (Administração › Parâmetros › Recursos).", "feature_off");
  assert(input.difalDefaultMode === "fora" || input.difalDefaultMode === "dentro", "Modo padrão do DIFAL inválido.");
  const modes = parseDifalModes(input.difalModes);
  const rates = parseUfRates(input.ufRates);
  for (const [uf, r] of Object.entries(rates)) assert(r.internalBps + (r.fcpBps ?? 0) < 10000, `Alíquotas de ${uf} inválidas.`);
  const values: Record<string, unknown> = {
    [TC_SETTINGS.pisCofinsExcludeIcms]: Boolean(input.pisCofinsExcludeIcms),
    [TC_SETTINGS.difalDefaultMode]: input.difalDefaultMode,
    [TC_SETTINGS.difalModeByUf]: modes,
    [TC_SETTINGS.ufRates]: rates,
  };
  for (const [k, v] of Object.entries(values)) await setSetting(ctx.store, ctx.companyId, null, k, v, ctx.user.id);
  await audit(ctx, { module: "fiscal", action: "tax_complete.settings", entityType: "settings", entityId: "fiscal.tributacaoCompleta", summary: `Tributação completa: PIS/COFINS ${input.pisCofinsExcludeIcms ? "sem" : "com"} ICMS na base; DIFAL ${input.difalDefaultMode} (${Object.keys(modes).length} UF com modo próprio); ${Object.keys(rates).length} UF na tabela de alíquotas`, after: values });
  return values;
}

/** Percentual de crédito do Simples (pCredSN — alíquota do Anexo da LC 123 na faixa do mês anterior). Null/0 = sem crédito. */
export async function saveSimplesCredit(ctx: Ctx, bps: number | null) {
  requireAction(ctx, "fiscal.configure");
  assert(await isFeatureOn(ctx.store, ctx.companyId, ctx.branchId, SIMPLES_CREDIT_FEATURE, featureDefault(SIMPLES_CREDIT_FEATURE, false)), "Recurso de crédito do Simples desligado (Administração › Parâmetros › Recursos).", "feature_off");
  if (bps != null) assert(Number.isInteger(bps) && bps >= 0 && bps <= 10000, "Percentual de crédito inválido.");
  await setSetting(ctx.store, ctx.companyId, null, TC_SETTINGS.simplesCreditBps, bps || null, ctx.user.id);
  await audit(ctx, { module: "fiscal", action: "simples_credit.save", entityType: "settings", entityId: TC_SETTINGS.simplesCreditBps, summary: `Crédito do Simples (pCredSN): ${bps ? `${fmtPct(bps)}%` : "não informado"}` });
  return bps || null;
}

// ───────────────────────────── Cadastro do grupo tributário

export interface CompleteGroupInput {
  stMvaBps?: number | null;
  stRateBps?: number | null;
  stBaseReductionBps?: number | null;
  ufRates?: string | null;
}

/** Normaliza os campos opcionais da tributação completa no grupo tributário. */
export function normalizeCompleteGroup(i: CompleteGroupInput) {
  if (i.stMvaBps != null) assert(Number.isInteger(i.stMvaBps) && i.stMvaBps >= 0 && i.stMvaBps <= 100000, "MVA inválida (0% a 1000%).");
  for (const [k, v] of [["alíquota da ST", i.stRateBps], ["redução da base da ST", i.stBaseReductionBps]] as const) if (v != null) assert(Number.isInteger(v) && v >= 0 && v <= 10000, `${k} inválida (0% a 100%).`);
  const rates = parseUfRates(i.ufRates);
  return { stMvaBps: i.stMvaBps ?? null, stRateBps: i.stRateBps ?? null, stBaseReductionBps: i.stBaseReductionBps || null, ufRates: Object.keys(rates).length ? rates : null };
}

const parsePctField = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace("%", "").replace(",", "."));
  assert(Number.isFinite(n), `Percentual inválido: ${v}.`);
  return Math.round(n * 100);
};

/** Bloco "Tributação completa" do formulário do grupo; sem o marcador `tcBlock` (recurso desligado) devolve null — mantém o gravado. */
export function completeFromForm(fd: FormData): CompleteGroupInput | null {
  if (!fd.has("tcBlock")) return null;
  const str = (k: string) => String(fd.get(k) ?? "");
  return { stMvaBps: parsePctField(str("stMva")), stRateBps: parsePctField(str("stRate")), stBaseReductionBps: parsePctField(str("stBaseReduction")), ufRates: str("ufRates") };
}

/** Natureza do grupo (`operationKey`); sem o marcador `natureBlock` devolve undefined — mantém o gravado. */
export function natureKeyFromForm(fd: FormData): string | null | undefined {
  if (!fd.has("natureBlock")) return undefined;
  const v = String(fd.get("operationKey") ?? "").trim();
  if (v) assert(/^[a-z0-9_]{2,40}$/.test(v), "Natureza de operação inválida.");
  return v || null;
}
