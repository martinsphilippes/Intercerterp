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

const SCENARIOS = [
  { key: "nfe-interna", model: "nfe", interstate: false },
  { key: "nfe-interestadual", model: "nfe", interstate: true },
  { key: "nfce", model: "nfce", interstate: false },
] as const;

/**
 * Retrato de todos os SKUs ativos da empresa (ordenados pelo código): payload, XML de simulação e totais.
 * `regimeTag` distingue as passagens (empresa no Simples e no regime normal); `opts.reform` = adesão vigente na emissão
 * (inclui os grupos IBS/CBS/IS dos itens que os calcularam).
 */
export async function snapshotAll(store: Store, refs: DemoRefs, regimeTag: string, opts: { reform?: boolean } = {}): Promise<Record<string, SnapEntry>> {
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
    for (const sc of SCENARIOS) {
      const items = await buildItems(ctx, [{ skuId: sku.id, qty: 3000, unitPrice: 1999, discount: 150, description: sku.name }], { branchId: branch.id, interstate: sc.interstate, freight: sc.model === "nfe" ? 500 : 0, insurance: sc.model === "nfe" ? 120 : 0, other: 35, kind: "sale" });
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
        recipient:
          sc.model === "nfe"
            ? { name: "Mercado Teste Ltda", doc: "11444777000161", ie: "110042490114", ieIndicator: "1", address: { street: "Rua A", number: "1", district: "Centro", cityName: "Cidade", cityCode: sc.interstate ? "3304557" : "3550308", uf: sc.interstate ? (emitUf === "RJ" ? "SP" : "RJ") : emitUf, zip: "01001000" } }
            : null,
        recipientName: sc.model === "nfe" ? "Mercado Teste Ltda" : null,
        recipientDoc: sc.model === "nfe" ? "11444777000161" : null,
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
