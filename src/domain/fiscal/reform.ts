import type { Doc, Store } from "@/lib/db/types";
import { parseBps, roundDiv } from "@/lib/money";
import { assert } from "@/lib/core/errors";
import { featureDefault, isFeatureOn } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";
import { toLocalDate, today } from "@/lib/dates";
import { IBS_CBS_CST } from "./reform-codes";

/**
 * Reforma tributária do consumo (FIS-19, Fase 2): IBS, CBS e IS nos documentos NF-e/NFC-e.
 *
 * Tudo aqui é ADITIVO: os grupos só são calculados e enviados quando (1) o recurso `feature.reformaTributaria` está ligado
 * (desligado por padrão), (2) a configuração fiscal marca a adesão (`fiscal_configs.reformAdherence`) e (3) a data de
 * início da adesão (`reformAdherenceFrom`) já chegou — e, por item, quando o grupo tributário (ou o produto) tem o CST do
 * IBS/CBS e o grupo está na vigência própria da reforma (`reformValidFrom`). ICMS, PIS, COFINS e totais da nota não mudam.
 *
 * Regras (hipóteses a validar com a contabilidade e em homologação — docs/regras-assumidas.md §34):
 *  - base (vBC) do IBS/CBS = valor do item (produtos − desconto + frete + seguro + outras) − ICMS − PIS − COFINS + IS
 *    (fórmula da regra UB16-10 da NT 2025.002; FCP/ICMS-ST/IPI não são calculados pelo ERP);
 *  - alíquotas de teste de 2026 (LC 214/2025): CBS 0,9% (art. 346) e IBS 0,1% estadual (art. 343) — IBS municipal 0%;
 *  - redução de alíquota (pRedAliq) aplicada igualmente ao IBS e à CBS nos CST de redução;
 *  - em 2026 os valores não somam no total da nota (vNF) — regras VB01-10/W60-10.
 */

export const REFORM_FEATURE = "reformaTributaria";
export { IBS_CBS_CST, IBS_CBS_CST_OPTIONS, TEST_RATES_2026 } from "./reform-codes";

/** CST com valores calculados pelo ERP (alíquota × base); com redução de alíquota quando o grupo informa pRedAliq. */
const VALUE_CST = new Set(["000", "010", "011", "200", "210"]);
const REDUCTION_CST = new Set(["011", "200", "210"]);
/** CST sem valores (só CST + cClassTrib no item). */
const NO_VALUE_CST = new Set(["400", "410", "550"]);

export type IbsCbsKind = "values" | "no_values" | "unsupported";

export function ibsCbsKind(cst: string): IbsCbsKind {
  if (VALUE_CST.has(cst)) return "values";
  if (NO_VALUE_CST.has(cst)) return "no_values";
  return "unsupported";
}

/** Parâmetros da reforma de um item (vindos do grupo tributário, com CST/cClassTrib sobreponíveis pelo produto). */
export interface ReformParams {
  cst: string;
  cClassTrib: string | null;
  ibsRateBps: number;
  cbsRateBps: number;
  isRateBps: number;
  /** percentual de redução de alíquota (pRedAliq) — CST 011/200/210 */
  redBps: number;
}

/** IBS/CBS/IS calculados do item (gravados em `DocItem.ibsCbs` somente com a adesão vigente). Valores em centavos. */
export interface ItemReform {
  cst: string;
  cClassTrib: string | null;
  kind: IbsCbsKind;
  base: number;
  ibsUfRateBps: number;
  ibsUf: number;
  ibsMunRateBps: number;
  ibsMun: number;
  ibs: number;
  cbsRateBps: number;
  cbs: number;
  redBps: number;
  isBase?: number;
  isRateBps?: number;
  is?: number;
}

/** Valor com alíquota em pontos-base e redução percentual (pontos-base), arredondado ao centavo (metade para cima). */
function taxValue(base: number, rateBps: number, redBps: number) {
  if (!base || !rateBps) return 0;
  return roundDiv(base * rateBps * (10000 - redBps), 10000 * 10000);
}

/** Base do IBS/CBS (UB16-10): valor do item − ICMS − PIS − COFINS + IS (nunca negativa). */
export function reformBase(item: { total: number; icms?: number; pis?: number; cofins?: number }, isValue = 0): number {
  return Math.max(0, item.total - (item.icms ?? 0) - (item.pis ?? 0) - (item.cofins ?? 0)) + isValue;
}

/** Cálculo do IBS/CBS (e IS quando houver alíquota) de um item já tributado (ICMS/PIS/COFINS calculados antes). */
export function computeItemReform(item: { total: number; icms?: number; pis?: number; cofins?: number }, p: ReformParams): ItemReform {
  const kind = ibsCbsKind(p.cst);
  const red = kind === "values" && REDUCTION_CST.has(p.cst) ? Math.min(10000, Math.max(0, p.redBps)) : 0;
  const out: ItemReform = { cst: p.cst, cClassTrib: p.cClassTrib, kind, base: 0, ibsUfRateBps: 0, ibsUf: 0, ibsMunRateBps: 0, ibsMun: 0, ibs: 0, cbsRateBps: 0, cbs: 0, redBps: red };
  // IS (Imposto Seletivo, a partir de 2027): "por fora", base = valor do item; compõe a base do IBS/CBS
  let isValue = 0;
  if (p.isRateBps > 0) {
    out.isBase = Math.max(0, item.total);
    out.isRateBps = p.isRateBps;
    out.is = isValue = taxValue(out.isBase, p.isRateBps, 0);
  }
  if (kind !== "values") return out;
  out.base = reformBase(item, isValue);
  out.ibsUfRateBps = p.ibsRateBps;
  out.ibsUf = taxValue(out.base, p.ibsRateBps, red);
  out.ibs = out.ibsUf + out.ibsMun;
  out.cbsRateBps = p.cbsRateBps;
  out.cbs = taxValue(out.base, p.cbsRateBps, red);
  return out;
}

/** Parâmetros do item: CST/cClassTrib do produto (se houver) ou do grupo; alíquotas do grupo, respeitando a vigência da reforma no grupo. */
export function reformParamsFor(product: Doc | null | undefined, group: Doc | null | undefined, date: string): ReformParams | null {
  if (group?.reformValidFrom && group.reformValidFrom > date) return null;
  const cst = String(product?.ibsCbsCst || group?.ibsCbsCst || "").trim();
  if (!cst) return null;
  return {
    cst,
    cClassTrib: String(product?.cClassTrib || group?.cClassTrib || "").trim() || null,
    ibsRateBps: group?.ibsRateBps ?? 0,
    cbsRateBps: group?.cbsRateBps ?? 0,
    isRateBps: group?.isRateBps ?? 0,
    redBps: group?.ibsCbsRedBps ?? 0,
  };
}

/** Adesão vigente: recurso ligado + adesão marcada na configuração fiscal + data de início alcançada. */
export function reformAdhered(cfg: Doc | null | undefined, featureOn: boolean, date: string): boolean {
  return Boolean(featureOn && cfg?.reformAdherence === true && cfg.reformAdherenceFrom && String(cfg.reformAdherenceFrom) <= date);
}

/** Recurso ligado para a empresa/filial (desligado por padrão). */
export function reformFeatureOn(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, REFORM_FEATURE, featureDefault(REFORM_FEATURE, false));
}

export async function isReformActive(store: Store, companyId: string, branchId: string | null | undefined, cfg: Doc | null | undefined, date = today()): Promise<boolean> {
  if (!cfg?.reformAdherence) return false; // sem adesão: nem consulta o parâmetro
  return reformAdhered(cfg, await reformFeatureOn(store, companyId, branchId), date);
}

/** Adesão vigente na data de emissão do documento (NF-e/NFC-e). */
export async function reformActiveForDoc(store: Store, doc: Doc, cfg: Doc | null | undefined): Promise<boolean> {
  if (doc.model === "nfse") return false;
  return isReformActive(store, doc.companyId, doc.branchId, cfg, doc.issuedAt ? toLocalDate(doc.issuedAt) : today());
}

/** Totais do documento (somente itens com IBS/CBS calculado); null quando nenhum item tem os grupos. */
export function reformTotals(items: Array<{ ibsCbs?: ItemReform | null }>) {
  const list = items.map((i) => i.ibsCbs).filter((r): r is ItemReform => Boolean(r));
  if (!list.length) return null;
  const sum = (f: (r: ItemReform) => number) => list.reduce((a, r) => a + f(r), 0);
  return { base: sum((r) => r.base), ibsUf: sum((r) => r.ibsUf), ibsMun: sum((r) => r.ibsMun), ibs: sum((r) => r.ibs), cbs: sum((r) => r.cbs), is: sum((r) => r.is ?? 0), hasIs: list.some((r) => (r.isRateBps ?? 0) > 0) };
}

const money = (c: number) => Number((c / 100).toFixed(2));
const rate = (bps: number) => bps / 100;
const effRate = (bps: number, red: number) => Number(((bps * (10000 - red)) / 1000000).toFixed(4));

/** Campos do item no payload do provedor (nomes da API Focus NFe — conferir em homologação). */
export function reformPayloadItem(r: ItemReform): Record<string, any> {
  const out: Record<string, any> = { ibs_cbs_situacao_tributaria: r.cst };
  if (r.cClassTrib) out.ibs_cbs_classificacao_tributaria = r.cClassTrib;
  if (r.kind === "values") {
    Object.assign(out, {
      ibs_cbs_base_calculo: money(r.base),
      ibs_uf_aliquota: rate(r.ibsUfRateBps),
      ibs_uf_valor: money(r.ibsUf),
      ibs_mun_aliquota: rate(r.ibsMunRateBps),
      ibs_mun_valor: money(r.ibsMun),
      ibs_valor_total: money(r.ibs),
      cbs_aliquota: rate(r.cbsRateBps),
      cbs_valor: money(r.cbs),
    });
    if (r.redBps > 0)
      Object.assign(out, {
        ibs_uf_percentual_reducao_aliquota: rate(r.redBps),
        ibs_uf_aliquota_efetiva: effRate(r.ibsUfRateBps, r.redBps),
        ibs_mun_percentual_reducao_aliquota: rate(r.redBps),
        ibs_mun_aliquota_efetiva: effRate(r.ibsMunRateBps, r.redBps),
        cbs_percentual_reducao_aliquota: rate(r.redBps),
        cbs_aliquota_efetiva: effRate(r.cbsRateBps, r.redBps),
      });
  }
  if ((r.isRateBps ?? 0) > 0)
    Object.assign(out, { is_situacao_tributaria: r.cst, ...(r.cClassTrib ? { is_classificacao_tributaria: r.cClassTrib } : {}), is_base_calculo: money(r.isBase ?? 0), is_aliquota: rate(r.isRateBps ?? 0), is_valor: money(r.is ?? 0) });
  return out;
}

/** Totais da nota no payload (raiz) — vazio quando nenhum item tem os grupos. Não alteram valor_total (vNF). */
export function reformPayloadTotals(items: Array<{ ibsCbs?: ItemReform | null }>): Record<string, any> {
  const t = reformTotals(items);
  if (!t) return {};
  return {
    ibs_cbs_base_calculo: money(t.base),
    ibs_uf_valor_total: money(t.ibsUf),
    ibs_mun_valor_total: money(t.ibsMun),
    ibs_valor_total: money(t.ibs),
    cbs_valor_total: money(t.cbs),
    ...(t.hasIs ? { is_valor_total: money(t.is) } : {}),
  };
}

const x2 = (c: number) => (c / 100).toFixed(2);
const p4 = (bps: number) => (bps / 100).toFixed(4);

/** Elemento do item no XML de simulação (somente com adesão vigente). */
export function reformXmlItem(r: ItemReform): string {
  const attrs = [`CST="${r.cst}"`, r.cClassTrib ? `cClassTrib="${r.cClassTrib}"` : ""];
  if (r.kind === "values")
    attrs.push(`vBC="${x2(r.base)}"`, `pIBSUF="${p4(r.ibsUfRateBps)}"`, `vIBSUF="${x2(r.ibsUf)}"`, `pIBSMun="${p4(r.ibsMunRateBps)}"`, `vIBSMun="${x2(r.ibsMun)}"`, `vIBS="${x2(r.ibs)}"`, `pCBS="${p4(r.cbsRateBps)}"`, `vCBS="${x2(r.cbs)}"`, r.redBps ? `pRedAliq="${p4(r.redBps)}"` : "");
  const is = (r.isRateBps ?? 0) > 0 ? `<IS vBCIS="${x2(r.isBase ?? 0)}" pIS="${p4(r.isRateBps ?? 0)}" vIS="${x2(r.is ?? 0)}"/>` : "";
  return `<IBSCBS ${attrs.filter(Boolean).join(" ")}/>${is}`;
}

/** Totais no XML de simulação (linha própria antes de <total>; vazio sem itens com os grupos). */
export function reformXmlTotals(items: Array<{ ibsCbs?: ItemReform | null }>): string {
  const t = reformTotals(items);
  if (!t) return "";
  return `  <IBSCBSTot vBC="${x2(t.base)}" vIBSUF="${x2(t.ibsUf)}" vIBSMun="${x2(t.ibsMun)}" vIBS="${x2(t.ibs)}" vCBS="${x2(t.cbs)}"${t.hasIs ? ` vIS="${x2(t.is)}"` : ""}/>\n`;
}

// ───────────────────────────── Cadastro (grupo tributário e produto)

export interface ReformGroupInput {
  ibsCbsCst?: string | null;
  cClassTrib?: string | null;
  ibsRateBps?: number | null;
  cbsRateBps?: number | null;
  isRateBps?: number | null;
  ibsCbsRedBps?: number | null;
  reformValidFrom?: string | null;
}

/** Valida CST/cClassTrib (cClassTrib = 6 dígitos começando pelo CST, conforme a NT). */
export function checkReformCodes(cst: string | null, cClassTrib: string | null) {
  if (cst) assert(/^\d{3}$/.test(cst) && cst in IBS_CBS_CST, "CST do IBS/CBS inválido (3 dígitos da tabela da reforma, ex.: 000).");
  if (cClassTrib) {
    assert(/^\d{6}$/.test(cClassTrib), "cClassTrib deve ter 6 dígitos (ex.: 000001).");
    assert(cst, "Informe o CST do IBS/CBS junto com o cClassTrib.");
    assert(cClassTrib.startsWith(cst!), `cClassTrib ${cClassTrib} não pertence ao CST ${cst} (os 3 primeiros dígitos são o CST).`);
  }
}

/** Normaliza os campos opcionais da reforma no grupo tributário (todos ausentes = grupo sem reforma). */
export function normalizeReformGroup(i: ReformGroupInput) {
  const cst = onlyDigits(i.ibsCbsCst) || null;
  const cClassTrib = onlyDigits(i.cClassTrib) || null;
  checkReformCodes(cst, cClassTrib);
  for (const [k, v] of [["IBS", i.ibsRateBps], ["CBS", i.cbsRateBps], ["IS", i.isRateBps], ["redução de alíquota do IBS/CBS", i.ibsCbsRedBps]] as const) if (v != null) assert(Number.isInteger(v) && v >= 0 && v <= 10000, `Alíquota de ${k} inválida (0% a 100%).`);
  if (i.reformValidFrom) assert(/^\d{4}-\d{2}-\d{2}$/.test(i.reformValidFrom), "Data de vigência da reforma inválida.");
  return {
    ibsCbsCst: cst,
    cClassTrib,
    ibsRateBps: i.ibsRateBps ?? null,
    cbsRateBps: i.cbsRateBps ?? null,
    isRateBps: i.isRateBps || null,
    ibsCbsRedBps: i.ibsCbsRedBps || null,
    reformValidFrom: i.reformValidFrom || null,
  };
}

/**
 * Campos do bloco "Reforma tributária" de um formulário de grupo tributário. Sem o marcador `reformBlock` (bloco oculto
 * porque o recurso está desligado) devolve null — os valores gravados são mantidos.
 */
export function reformFromForm(fd: FormData): ReformGroupInput | null {
  if (!fd.has("reformBlock")) return null;
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const bps = (k: string) => (str(k) === "" ? null : parseBps(str(k)));
  return { ibsCbsCst: str("ibsCbsCst") || null, cClassTrib: str("cClassTrib") || null, ibsRateBps: bps("ibsRate"), cbsRateBps: bps("cbsRate"), isRateBps: bps("isRate"), ibsCbsRedBps: bps("ibsCbsRed"), reformValidFrom: str("reformValidFrom") || null };
}
