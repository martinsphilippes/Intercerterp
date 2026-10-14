/**
 * Harness do TESTE DE IGUALDADE da reforma tributária (Fase 2).
 *
 * Gera, para TODOS os produtos/SKUs do seed de demonstração (e para grupos de regime normal criados aqui), o payload do
 * provedor e o XML de simulação de NF-e (interna e interestadual) e NFC-e, com documento de data/número fixos.
 * O retrato foi gravado em tests/fixtures/reforma-baseline.json com o código ANTERIOR à reforma (sem os campos
 * IBS/CBS/IS); tests/tax-reform.test.ts compara o resultado atual (sem adesão e com adesão, descontados os grupos novos).
 * Regravar o retrato (somente se uma mudança fiscal deliberada e aprovada exigir): REFORMA_BASELINE_WRITE=1 npx vitest run tests/tax-reform.test.ts
 */
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import type { DemoRefs } from "@/domain/seed/base";
import { buildItems, computeTotals, getFiscalConfig, simulatedXml, toProviderPayload } from "@/domain/fiscal/service";

export interface SnapEntry {
  payload: Record<string, any>;
  xml: string;
  totals: Record<string, number>;
}

/** Grupos de regime normal (CST do ICMS) usados para cobrir ICMS próprio, redução de base, isenção e ST. */
export const NORMAL_GROUPS = [
  { key: "rn-00", name: "Regime normal — tributado 18% (CST 00)", cstCsosn: "00", icmsRateBps: 1800, icmsBaseReductionBps: 0, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5102", cfopInterstate: "6102" },
  { key: "rn-20", name: "Regime normal — redução de base (CST 20)", cstCsosn: "20", icmsRateBps: 1200, icmsBaseReductionBps: 3333, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5102", cfopInterstate: "6102" },
  { key: "rn-40", name: "Regime normal — isento (CST 40)", cstCsosn: "40", icmsRateBps: 0, icmsBaseReductionBps: 0, pisCst: "07", pisRateBps: 0, cofinsCst: "07", cofinsRateBps: 0, cfopInternal: "5102", cfopInterstate: "6102" },
  { key: "rn-60", name: "Regime normal — ICMS ST (CST 60)", cstCsosn: "60", icmsRateBps: 0, icmsBaseReductionBps: 0, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5405", cfopInterstate: "6404" },
];

/** Cria (idempotente) os grupos e produtos de regime normal do teste de igualdade. */
export async function seedNormalGroups(refs: DemoRefs) {
  const sd = refs.seeder;
  const out: Doc[] = [];
  for (const g of NORMAL_GROUPS) {
    const { key, ...data } = g;
    const tg = await sd.put("tax_groups", key, { companyId: refs.company.id, regime: "normal", cfopReturn: "1202", active: true, ...data });
    const p = await sd.put("products", `prod-${key}`, { companyId: refs.company.id, type: "product", code: `RN${key.slice(3)}`, name: `Produto ${g.name}`, unitCode: "UN", ncm: "61091000", cest: key === "rn-60" ? "2806300" : null, origin: "0", taxGroupId: tg.id, status: "active", active: true });
    await sd.put("skus", `prod-${key}-u`, { companyId: refs.company.id, productId: p.id, sku: `RN${key.slice(3)}`, name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
    out.push(tg);
  }
  return out;
}

/**
 * Cenário do retrato. `consumer` = destinatário consumidor final NÃO contribuinte (CPF, indIEDest 9) na UF `destUf`;
 * `operationKey` = natureza de operação (Fase 7). Os cenários da reforma (padrão) não usam esses campos.
 */
export interface SnapScenario {
  key: string;
  model: "nfe" | "nfce";
  interstate: boolean;
  destUf?: string;
  consumer?: boolean;
  operationKey?: string;
}

/**
 * Grupos da tributação completa (Fase 7 — FIS-12/13/16): CST 10/70 com MVA e alíquota de ST, CST 00 com FCP e alíquotas
 * por UF, CSOSN 101/201 e um grupo exclusivo de natureza (remessa para conserto). Os campos novos ficam inertes sem o
 * recurso `feature.tributacaoCompleta` — o retrato tests/fixtures/tributacao-baseline.json foi gravado ANTES deles existirem.
 */
export const COMPLETE_GROUPS = [
  { key: "tc-10", regime: "normal", name: "Normal — ICMS próprio + ST (CST 10)", cstCsosn: "10", icmsRateBps: 1800, fcpRateBps: 200, stMvaBps: 4000, stRateBps: 1800, ufRates: { RJ: { internalBps: 2000, fcpBps: 200 }, BA: { internalBps: 2050, fcpBps: 200 } }, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5401", cfopInterstate: "6401", product: { code: "TC10", origin: "0", cest: "2806300" } },
  { key: "tc-70", regime: "normal", name: "Normal — redução de base + ST (CST 70)", cstCsosn: "70", icmsRateBps: 1800, icmsBaseReductionBps: 3333, stBaseReductionBps: 3333, stMvaBps: 4000, stRateBps: 1800, ufRates: { RJ: { internalBps: 2000, fcpBps: 200, mvaAdjBps: 5000 } }, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5401", cfopInterstate: "6401", product: { code: "TC70", origin: "0", cest: "2806300" } },
  { key: "tc-00", regime: "normal", name: "Normal — tributado com FCP e alíquotas por UF (CST 00)", cstCsosn: "00", icmsRateBps: 1800, fcpRateBps: 200, ufRates: { RJ: { internalBps: 2000, fcpBps: 200 }, BA: { internalBps: 2050, fcpBps: 200 } }, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5102", cfopInterstate: "6102", product: { code: "TC00", origin: "0", cest: null } },
  { key: "tc-imp", regime: "normal", name: "Normal — importado (CST 00, origem 1)", cstCsosn: "00", icmsRateBps: 1800, ufRates: { BA: { internalBps: 2050 } }, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, cfopInternal: "5102", cfopInterstate: "6102", product: { code: "TCIMP", origin: "1", cest: null } },
  { key: "tc-101", regime: "simples", name: "Simples — com permissão de crédito (CSOSN 101)", cstCsosn: "101", icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0, cfopInternal: "5102", cfopInterstate: "6102", product: { code: "TC101", origin: "0", cest: null } },
  { key: "tc-201", regime: "simples", name: "Simples — crédito + ST (CSOSN 201)", cstCsosn: "201", icmsRateBps: 0, stMvaBps: 4000, stRateBps: 1800, ufRates: { RJ: { internalBps: 2000, fcpBps: 200 } }, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0, cfopInternal: "5401", cfopInterstate: "6401", product: { code: "TC201", origin: "0", cest: "2806300" } },
  { key: "tc-rem", regime: "normal", name: "Natureza — remessa para conserto", operationKey: "remessa_conserto", cstCsosn: "41", icmsRateBps: 0, pisCst: "08", pisRateBps: 0, cofinsCst: "08", cofinsRateBps: 0, cfopInternal: "5915", cfopInterstate: "6915", product: null },
] as const;

/** Cria (idempotente) os grupos e produtos da tributação completa. */
export async function seedCompleteGroups(refs: DemoRefs) {
  const sd = refs.seeder;
  const out: Record<string, Doc> = {};
  for (const g of COMPLETE_GROUPS) {
    const { key, product, ...data } = g;
    const tg = await sd.put("tax_groups", key, { companyId: refs.company.id, cfopReturn: "1202", active: true, ...JSON.parse(JSON.stringify(data)) });
    out[key] = tg;
    if (!product) continue;
    const p = await sd.put("products", `prod-${key}`, { companyId: refs.company.id, type: "product", code: product.code, name: `Produto ${g.name}`, unitCode: "UN", ncm: "61091000", cest: product.cest, origin: product.origin, taxGroupId: tg.id, status: "active", active: true });
    await sd.put("skus", `prod-${key}-u`, { companyId: refs.company.id, productId: p.id, sku: product.code, name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
  }
  return out;
}

const SCENARIOS: readonly SnapScenario[] = [
  { key: "nfe-interna", model: "nfe", interstate: false },
  { key: "nfe-interestadual", model: "nfe", interstate: true },
  { key: "nfce", model: "nfce", interstate: false },
];

/** Cenários do teste de igualdade da tributação completa (Fase 7): os da reforma + interestadual a consumidor (DIFAL) e natureza. */
export const COMPLETE_SCENARIOS: readonly SnapScenario[] = [
  ...SCENARIOS,
  { key: "nfe-interestadual-7", model: "nfe", interstate: true, destUf: "BA" },
  { key: "nfe-consumidor-ba", model: "nfe", interstate: true, destUf: "BA", consumer: true },
  { key: "nfe-consumidor-rj", model: "nfe", interstate: true, destUf: "RJ", consumer: true },
  { key: "nfe-remessa-conserto", model: "nfe", interstate: false, operationKey: "remessa_conserto" },
];

/**
 * Retrato de todos os SKUs ativos da empresa (ordenados pelo código): payload, XML de simulação e totais.
 * `regimeTag` distingue as passagens (empresa no Simples e no regime normal); `opts.reform` = adesão vigente na emissão
 * (inclui os grupos IBS/CBS/IS dos itens que os calcularam).
 */
export async function snapshotAll(store: Store, refs: DemoRefs, regimeTag: string, opts: { reform?: boolean; scenarios?: readonly SnapScenario[] } = {}): Promise<Record<string, SnapEntry>> {
  const ctx = await refs.ctxFor("admin", "matriz");
  const company = await store.getOrThrow("companies", refs.company.id);
  const branch = await store.getOrThrow("branches", refs.branches.matriz.id);
  const cfg = await getFiscalConfig(store, refs.company.id, branch.id);
  const products = new Map((await listAll(store, "products", { filters: [["eq", "companyId", refs.company.id]] })).map((p) => [p.id, p]));
  const skus = (await listAll(store, "skus", { filters: [["eq", "companyId", refs.company.id]] }))
    .filter((k) => k.active !== false && products.get(k.productId) && products.get(k.productId)!.type !== "service")
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)) || String(a.id).localeCompare(String(b.id)));
  const emitUf = branch.uf ?? "SP";
  const out: Record<string, SnapEntry> = {};
  for (const sku of skus) {
    for (const sc of opts.scenarios ?? SCENARIOS) {
      const destUf = sc.destUf ?? (sc.interstate ? (emitUf === "RJ" ? "SP" : "RJ") : emitUf);
      // destinatário (Fase 7: a montagem dos itens recebe a UF e o indicador de IE para alíquota interestadual e DIFAL)
      const rcp = sc.consumer
        ? { name: "Consumidor Teste", doc: "52998224725", ie: null, ieIndicator: "9", finalConsumer: true, address: { street: "Rua B", number: "2", district: "Centro", cityName: "Cidade", cityCode: destUf === "BA" ? "2927408" : "3304557", uf: destUf, zip: "40000000" } }
        : { name: "Mercado Teste Ltda", doc: "11444777000161", ie: "110042490114", ieIndicator: "1", address: { street: "Rua A", number: "1", district: "Centro", cityName: "Cidade", cityCode: sc.interstate ? (destUf === "BA" ? "2927408" : "3304557") : "3550308", uf: destUf, zip: "01001000" } };
      const extra = sc.destUf || sc.consumer || sc.operationKey ? { model: sc.model, recipient: sc.model === "nfe" ? { uf: destUf, ie: rcp.ie, ieIndicator: rcp.ieIndicator, finalConsumer: Boolean((rcp as any).finalConsumer) } : null, operationKey: sc.operationKey ?? null } : {};
      const items = await buildItems(ctx, [{ skuId: sku.id, qty: 3000, unitPrice: 1999, discount: 150, description: sku.name }], { branchId: branch.id, interstate: sc.interstate, freight: sc.model === "nfe" ? 500 : 0, insurance: sc.model === "nfe" ? 120 : 0, other: 35, kind: sc.operationKey ? "other" : "sale", ...extra } as Parameters<typeof buildItems>[2]);
      const totals = computeTotals(items, { insurance: sc.model === "nfe" ? 120 : 0 });
      const doc = {
        model: sc.model,
        ref: `snap-${sku.sku}-${sc.key}`,
        number: 1,
        series: "1",
        issuedAt: "2026-03-02T12:00:00.000Z",
        authorizedAt: "2026-03-02T12:00:05.000Z",
        accessKey: "",
        protocol: "",
        nature: "Venda de mercadoria",
        purpose: "normal",
        operationType: "saida",
        presence: "1",
        recipient: sc.model === "nfe" ? rcp : null,
        recipientName: sc.model === "nfe" ? rcp.name : null,
        recipientDoc: sc.model === "nfe" ? rcp.doc : null,
        items,
        totals,
        payments: [{ kind: "pix", amount: totals.total }],
        transport: { mode: "9" },
        total: totals.total,
      } as unknown as Doc;
      out[`${regimeTag}|${sku.sku}|${sku.id}|${sc.key}`] = { payload: JSON.parse(JSON.stringify(toProviderPayload(doc, company, branch, cfg, opts))), xml: simulatedXml(doc, opts), totals: totals as any };
    }
  }
  return out;
}

const REFORM_KEY = /^(ibs|cbs|is)_/;

/** Remove do retrato tudo o que a reforma acrescenta (campos ibs_/cbs_/is_ do payload e elementos IBSCBS/IS do XML). */
export function stripReform(e: SnapEntry): SnapEntry {
  const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([k]) => !REFORM_KEY.test(k)));
  return {
    payload: { ...clean(e.payload), items: (e.payload.items ?? []).map((i: Record<string, any>) => clean(i)) },
    xml: e.xml.replace(/<IBSCBS [^>]*\/>/g, "").replace(/<IS [^>]*\/>/g, "").replace(/  <IBSCBSTot [^>]*\/>\n/g, ""),
    totals: e.totals,
  };
}
