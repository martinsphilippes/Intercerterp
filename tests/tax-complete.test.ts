import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { seedModules } from "@/domain/seed/modules";
import "@/domain/jobs-registry";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { FEATURE_DEFAULTS, setSetting } from "@/lib/core/settings";
import { readFile } from "@/lib/core/files";
import { buildItems, computeTotals, getFiscalConfig, queryDocument, simulatedXml, toProviderPayload, type BuildRecipient } from "@/domain/fiscal/service";
import { buildNfe, docToInput, refreshFromCatalog, saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { saveTaxGroup as saveFiscalTaxGroup } from "@/domain/fiscal/config";
import { saveTaxGroup as saveProductsTaxGroup } from "@/domain/products";
import {
  adjustedMvaBps,
  completeFromForm,
  computeDifal,
  DEFAULT_NATURES,
  formatUfRates,
  interstateRateBps,
  natureKeyFromForm,
  parseDifalModes,
  parseUfRates,
  saveCompleteSettings,
  saveNature,
  saveSimplesCredit,
  simplesCreditMessage,
  TC_SETTINGS,
} from "@/domain/fiscal/tax-complete";
import { PARAMS } from "@/app/(app)/administracao/parametros/catalog";
import { COMPLETE_SCENARIOS, seedCompleteGroups, seedNormalGroups, snapshotAll, type SnapEntry } from "./tax-reform-harness";

/**
 * Tributação completa (Fase 7 — FIS-12, FIS-16, FIS-11/07, FIS-13).
 * TESTE DE IGUALDADE: tests/fixtures/tributacao-baseline.json foi gravado com o código ANTERIOR à Fase 7 de tributação
 * (commit "retrato de igualdade da tributação completa"), reutilizando o harness da reforma com cenários extras
 * (interestadual 7%, consumidor final não contribuinte e natureza de operação) e grupos com os campos novos preenchidos.
 * Regravar (somente com mudança fiscal deliberada e aprovada): TRIBUTACAO_BASELINE_WRITE=1 npx vitest run tests/tax-complete.test.ts
 *
 * Valores esperados calculados à mão nos comentários (centavos; arredondamento metade para cima).
 */

const BASELINE = path.join(__dirname, "fixtures", "tributacao-baseline.json");

let store: Store;
let refs: DemoRefs;
let groups: Record<string, Doc>;
let normalGroups: Doc[];
const skuByCode = new Map<string, string>();
let seq = 0;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  await seedModules(refs);
  normalGroups = await seedNormalGroups(refs);
  groups = await seedCompleteGroups(refs);
  for (const k of await listAll(store, "skus", { filters: [["eq", "companyId", refs.company.id]] })) skuByCode.set(k.sku, k.id);
}, 240000);

const companyId = () => refs.company.id;
const matriz = () => refs.branches.matriz.id;
const adminCtx = () => refs.ctxFor("admin", "matriz");

async function snapshotBothRegimes() {
  const opts = { scenarios: COMPLETE_SCENARIOS };
  const a = await snapshotAll(store, refs, "simples", opts);
  await store.update("companies", companyId(), { regime: "normal", crt: "3" });
  try {
    return { ...a, ...(await snapshotAll(store, refs, "normal", opts)) };
  } finally {
    await store.update("companies", companyId(), { regime: "simples", crt: "1" });
  }
}

const baseline = () => JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, SnapEntry>;

type Flags = { tc?: boolean; nat?: boolean; cred?: boolean };
async function setFlags(f: Flags) {
  await setSetting(store, companyId(), null, "feature.tributacaoCompleta", Boolean(f.tc));
  await setSetting(store, companyId(), null, "feature.naturezasOperacao", Boolean(f.nat));
  await setSetting(store, companyId(), null, "feature.creditoSimples", Boolean(f.cred));
}

/** Parâmetros da Fase 7 todos preenchidos (só valem com os recursos ligados). */
async function fillSettings() {
  await setSetting(store, companyId(), null, TC_SETTINGS.pisCofinsExcludeIcms, true);
  await setSetting(store, companyId(), null, TC_SETTINGS.difalDefaultMode, "dentro");
  await setSetting(store, companyId(), null, TC_SETTINGS.difalModeByUf, { RJ: "fora" });
  await setSetting(store, companyId(), null, TC_SETTINGS.ufRates, { BA: { internalBps: 1800 }, RJ: { internalBps: 2000, fcpBps: 200 } });
  await setSetting(store, companyId(), null, TC_SETTINGS.simplesCreditBps, 250);
}
async function clearSettings() {
  await setSetting(store, companyId(), null, TC_SETTINGS.pisCofinsExcludeIcms, false);
  await setSetting(store, companyId(), null, TC_SETTINGS.difalDefaultMode, "fora");
  await setSetting(store, companyId(), null, TC_SETTINGS.difalModeByUf, {});
  await setSetting(store, companyId(), null, TC_SETTINGS.ufRates, {});
  await setSetting(store, companyId(), null, TC_SETTINGS.simplesCreditBps, null);
}

async function asNormal<T>(fn: () => Promise<T>): Promise<T> {
  await store.update("companies", companyId(), { regime: "normal", crt: "3" });
  try {
    return await fn();
  } finally {
    await store.update("companies", companyId(), { regime: "simples", crt: "1" });
  }
}

async function product(key: string, groupData: Record<string, unknown>, data: Record<string, unknown> = {}) {
  const sd = refs.seeder;
  const tg = await sd.put("tax_groups", `tg-${key}`, { companyId: companyId(), name: `Grupo ${key}`, regime: "normal", cfopInternal: "5102", cfopInterstate: "6102", cfopReturn: "1202", cstCsosn: "00", icmsRateBps: 1800, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, active: true, ...groupData });
  const p = await sd.put("products", key, { companyId: companyId(), type: "product", code: key.toUpperCase(), name: `Produto ${key}`, unitCode: "UN", ncm: "61091000", cest: "2806300", origin: "0", taxGroupId: tg.id, status: "active", active: true, ...data });
  const s = await sd.put("skus", `${key}-u`, { companyId: companyId(), productId: p.id, sku: key.toUpperCase(), name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
  return { p, s, tg };
}

/** SKU do produto de um grupo da tributação completa (códigos do harness: tc-10 → TC10, tc-imp → TCIMP…). */
const skuOf = (groupKey: string) => skuByCode.get(groupKey.replace("-", "").toUpperCase())!;

const CONTRIB = (uf: string): BuildRecipient => ({ uf, ie: "110042490114", ieIndicator: "1", finalConsumer: false });
const CONSUMER = (uf: string): BuildRecipient => ({ uf, ie: null, ieIndicator: "9", finalConsumer: true });

/** Um item de R$ 1.000,00 (ou `price`), sem desconto/frete — base = valor do item. */
async function one(sku: string, o: { interstate?: boolean; recipient?: BuildRecipient | null; model?: "nfe" | "nfce"; price?: number; operationKey?: string | null; kind?: "sale" | "other" } = {}) {
  const ctx = await adminCtx();
  const items = await buildItems(ctx, [{ skuId: sku, qty: 1000, unitPrice: o.price ?? 100000, discount: 0 }], { branchId: matriz(), interstate: Boolean(o.interstate), kind: o.kind ?? "sale", model: o.model ?? "nfe", recipient: o.recipient === undefined ? CONTRIB(o.interstate ? "RJ" : "SP") : o.recipient, operationKey: o.operationKey ?? null });
  return { item: items[0], items, totals: computeTotals(items) };
}

function fakeDoc(items: any[], totals: any, recipient: Record<string, any> | null, model = "nfe"): Doc {
  return { model, ref: `tc-${++seq}`, number: 1, series: "1", issuedAt: "2026-03-02T12:00:00.000Z", authorizedAt: "2026-03-02T12:00:05.000Z", nature: "Venda de mercadoria", purpose: "normal", operationType: "saida", presence: "1", recipient, items, totals, payments: [{ kind: "pix", amount: totals.total }], transport: { mode: "9" }, total: totals.total } as unknown as Doc;
}

async function payloadOf(items: any[], totals: any, recipient: Record<string, any> | null, model = "nfe") {
  const company = await store.getOrThrow("companies", companyId());
  const branch = await store.getOrThrow("branches", matriz());
  const cfg = await getFiscalConfig(store, companyId(), matriz());
  const doc = fakeDoc(items, totals, recipient, model);
  return { payload: toProviderPayload(doc, company, branch, cfg), xml: simulatedXml(doc) };
}

describe("tributação completa — teste de igualdade (retrato anterior à Fase 7)", () => {
  it("sem os recursos (padrão): payload, XML e totais de todas as combinações idênticos ao retrato", async () => {
    expect(FEATURE_DEFAULTS).toMatchObject({ tributacaoCompleta: false, naturezasOperacao: false, creditoSimples: false, reformaTributaria: false });
    const now = await snapshotBothRegimes();
    if (process.env.TRIBUTACAO_BASELINE_WRITE === "1") writeFileSync(BASELINE, JSON.stringify(now));
    const base = baseline();
    expect(Object.keys(base).length).toBeGreaterThan(500);
    expect(Object.keys(now).sort()).toEqual(Object.keys(base).sort());
    for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
  }, 180000);

  it("parâmetros preenchidos (PIS/COFINS sem ICMS, DIFAL, alíquotas por UF, pCredSN, naturezas) com os recursos DESLIGADOS: nada muda", async () => {
    await fillSettings();
    await setFlags({});
    try {
      const now = await snapshotBothRegimes();
      const base = baseline();
      for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
    } finally {
      await clearSettings();
    }
  }, 180000);

  it("recurso ligado: só mudam os itens com regra nova — Simples sem ST/crédito e regime normal interno sem FCP/ST ficam idênticos", async () => {
    await setFlags({ tc: true });
    try {
      const now = await snapshotBothRegimes();
      const base = baseline();
      const changed = Object.keys(base).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(base[k]));
      // Simples: somente o CSOSN 201 (ST interna e interestadual com alíquota da UF) muda
      expect(changed.filter((k) => k.startsWith("simples|") && !k.includes("|TC201|"))).toEqual([]);
      expect(changed.some((k) => k.startsWith("simples|TC201|") && k.endsWith("|nfe-interna"))).toBe(true);
      // regime normal: CST 00 interno sem FCP (rn-00) e NFC-e de todos os produtos sem ST/FCP continuam iguais
      expect(changed).not.toContain(Object.keys(base).find((k) => k.startsWith("normal|RN00|") && k.endsWith("|nfe-interna")));
      expect(changed.filter((k) => k.startsWith("normal|RN") && k.endsWith("|nfce"))).toEqual([]);
      // interestadual com a UF do destinatário (7% SP → BA em vez da interna) e CST 10 (ICMS próprio + ST) mudam;
      // sem a UF do destinatário (cenário da reforma, só "interestadual") a alíquota interestadual não é aplicada
      expect(changed.some((k) => k.startsWith("normal|RN00|") && k.endsWith("|nfe-interestadual-7"))).toBe(true);
      expect(changed.some((k) => k.startsWith("normal|RN00|") && k.endsWith("|nfe-interestadual"))).toBe(false);
      expect(changed.some((k) => k.startsWith("normal|TC10|") && k.endsWith("|nfe-interna"))).toBe(true);
    } finally {
      await setFlags({});
    }
  }, 180000);
});

describe("FIS-12 — regras puras (alíquota interestadual, MVA ajustada, tabela por UF)", () => {
  it("alíquota interestadual 4/7/12% (Res. SF 22/1989 e 13/2012)", () => {
    expect(interstateRateBps("SP", "RJ", "0")).toBe(1200); // Sudeste → Sudeste
    expect(interstateRateBps("SP", "BA", "0")).toBe(700); // Sudeste → Nordeste
    expect(interstateRateBps("SP", "ES", "0")).toBe(700); // ES recebe 7% do Sul/Sudeste
    expect(interstateRateBps("PR", "MT", "0")).toBe(700);
    expect(interstateRateBps("BA", "SP", "0")).toBe(1200); // Nordeste → Sudeste
    expect(interstateRateBps("ES", "BA", "0")).toBe(1200); // ES não é origem de 7%
    expect(interstateRateBps("MG", "PR", "0")).toBe(1200);
    for (const o of ["1", "2", "3", "8"]) expect(interstateRateBps("SP", "BA", o)).toBe(400); // importados
    for (const o of ["4", "5", "6", "7"]) expect(interstateRateBps("SP", "RJ", o)).toBe(1200);
  });

  it("MVA ajustada = [(1 + MVA) × (1 − inter) / (1 − intra)] − 1", () => {
    expect(adjustedMvaBps(4000, 1200, 2000)).toBe(5400); // 1,4 × 0,88 / 0,80 − 1 = 0,54
    expect(adjustedMvaBps(4000, 1200, 1800)).toBe(5024); // 1,232 / 0,82 − 1 = 0,50244 → 50,24%
    expect(adjustedMvaBps(4000, 700, 1800)).toBe(5878); // 1,302 / 0,82 − 1 = 0,58780
    expect(adjustedMvaBps(4000, 400, 1800)).toBe(6390); // 1,344 / 0,82 − 1 = 0,63902
  });

  it("tabela de alíquotas por UF (texto ↔ json) e modo do DIFAL por UF", () => {
    const r = parseUfRates("RJ 20 2\nmg;18;-;54,2\n\nBA|20,5");
    expect(r).toEqual({ RJ: { internalBps: 2000, fcpBps: 200 }, MG: { internalBps: 1800, mvaAdjBps: 5420 }, BA: { internalBps: 2050 } });
    expect(parseUfRates(formatUfRates(r))).toEqual(r);
    expect(() => parseUfRates("XX 18")).toThrow(/UF inválida/);
    expect(() => parseUfRates("SP 180")).toThrow(/Percentual inválido/);
    expect(parseDifalModes("MG dentro\nba FORA")).toEqual({ MG: "dentro", BA: "fora" });
    expect(() => parseDifalModes("MG meio")).toThrow(/fora.*dentro/);
  });
});

describe("FIS-12 — ICMS próprio no CST 10/70, ICMS-ST com MVA, FCP e alíquota interestadual (recurso ligado)", () => {
  it("CST 10 interno: ICMS próprio 18% + ST com MVA original 40% + FCP 2% e FCP-ST", async () => {
    await setFlags({ tc: true });
    try {
      await asNormal(async () => {
        const { item, totals } = await one(skuOf("tc-10"));
        // ICMS próprio: 1.000,00 × 18% = 180,00 (antes: zero — achado 2 da Fase 0)
        expect(item).toMatchObject({ cstCsosn: "10", icmsBase: 100000, icmsRateBps: 1800, icms: 18000 });
        // FCP próprio: 1.000,00 × 2% = 20,00
        expect(item.tc?.fcp).toEqual({ base: 100000, rateBps: 200, value: 2000 });
        // base ST = 1.000,00 × 1,40 = 1.400,00; ST = 1.400 × 18% − 180 = 72,00; FCP-ST = 1.400 × 2% − 20 = 8,00
        expect(item.tc?.st).toEqual({ mvaBps: 4000, mvaAdjusted: false, redBps: 0, base: 140000, rateBps: 1800, value: 7200, fcpBase: 140000, fcpRateBps: 200, fcp: 800 });
        // vNF = 1.000 + ST 72 + FCP-ST 8 = 1.080,00
        expect(totals).toMatchObject({ total: 108000, icmsSt: 7200, fcpSt: 800, fcp: 2000, icmsStBase: 140000, icms: 18000 });
        const { payload, xml } = await payloadOf([item], totals, { name: "Mercado", doc: "11444777000161", ie: "110042490114", ieIndicator: "1", address: { uf: "SP" } });
        expect(payload.items[0]).toMatchObject({ icms_modalidade_base_calculo: 3, icms_base_calculo: 1000, icms_aliquota: 18, icms_valor: 180, icms_modalidade_base_calculo_st: 4, icms_margem_valor_adicionado_st: 40, icms_base_calculo_st: 1400, icms_aliquota_st: 18, icms_valor_st: 72, fcp_base_calculo: 1000, fcp_percentual: 2, fcp_valor: 20, fcp_base_calculo_st: 1400, fcp_percentual_st: 2, fcp_valor_st: 8 });
        expect(payload).toMatchObject({ valor_total: 1080, icms_base_calculo_st: 1400, icms_valor_total_st: 72, fcp_valor_total: 20, fcp_valor_total_st: 8 });
        expect(xml).toMatch(/<ICMSST modBCST="4" pMVAST="40.0000" vBCST="1400.00" pICMSST="18.0000" vICMSST="72.00" vBCFCPST="1400.00" pFCPST="2.0000" vFCPST="8.00"\/>/);
        expect(xml).toMatch(/<ICMSTotComp vBCST="1400.00" vST="72.00" vFCP="20.00" vFCPST="8.00" /);
        expect(xml).toMatch(/<total>1080.00<\/total>/);
      });
    } finally {
      await setFlags({});
    }
  });

  it("CST 10 interestadual SP → RJ: alíquota 12%, MVA ajustada 54% pela fórmula, ST com a alíquota interna do RJ e FCP-ST do destino", async () => {
    await setFlags({ tc: true });
    try {
      await asNormal(async () => {
        const { item, totals } = await one(skuOf("tc-10"), { interstate: true, recipient: CONTRIB("RJ") });
        expect(item).toMatchObject({ icmsRateBps: 1200, icms: 12000 }); // 1.000 × 12%
        expect(item.tc?.interRateBps).toBe(1200);
        expect(item.tc?.fcp).toBeUndefined(); // FCP próprio só na operação interna
        // MVA ajustada = 1,4 × 0,88 / 0,80 − 1 = 54%; base ST 1.540,00; ST = 1.540 × 20% − 120 = 188,00; FCP-ST = 1.540 × 2% = 30,80
        expect(item.tc?.st).toEqual({ mvaBps: 5400, mvaAdjusted: true, redBps: 0, base: 154000, rateBps: 2000, value: 18800, fcpBase: 154000, fcpRateBps: 200, fcp: 3080 });
        expect(totals.total).toBe(100000 + 18800 + 3080);
      });
    } finally {
      await setFlags({});
    }
  });

  it("CST 70 interestadual: redução de base do ICMS próprio e da ST, MVA ajustada informada na UF", async () => {
    await setFlags({ tc: true });
    try {
      await asNormal(async () => {
        const { item } = await one(skuOf("tc-70"), { interstate: true, recipient: CONTRIB("RJ") });
        // base reduzida 33,33%: 1.000 − 333,30 = 666,70; ICMS 12% = 80,004 → 80,00
        expect(item).toMatchObject({ cstCsosn: "70", icmsBase: 66670, icmsBaseReductionBps: 3333, icmsRateBps: 1200, icms: 8000 });
        // MVA ajustada informada 50%: 1.500,00 − 33,33% (499,95) = 1.000,05; ST = 1.000,05 × 20% (200,01) − 80,00 = 120,01; FCP-ST 2% = 20,001 → 20,00
        expect(item.tc?.st).toEqual({ mvaBps: 5000, mvaAdjusted: true, redBps: 3333, base: 100005, rateBps: 2000, value: 12001, fcpBase: 100005, fcpRateBps: 200, fcp: 2000 });
        const { payload } = await payloadOf([item], computeTotals([item]), { name: "Mercado", doc: "11444777000161", ie: "1", address: { uf: "RJ" } });
        expect(payload.items[0]).toMatchObject({ icms_reducao_base_calculo: 33.33, icms_reducao_base_calculo_st: 33.33, icms_margem_valor_adicionado_st: 50 });
      });
    } finally {
      await setFlags({});
    }
  });

  it("CST 00: interestadual 12% (Sudeste), 7% (Nordeste) e importado 4%; sem o recurso, alíquota interna (comportamento anterior)", async () => {
    await asNormal(async () => {
      const off = await one(skuOf("tc-00"), { interstate: true, recipient: CONTRIB("BA") });
      expect(off.item).toMatchObject({ icmsRateBps: 1800, icms: 18000 });
      expect(off.item.tc).toBeUndefined();
      await setFlags({ tc: true });
      try {
        expect((await one(skuOf("tc-00"), { interstate: true, recipient: CONTRIB("RJ") })).item).toMatchObject({ icmsRateBps: 1200, icms: 12000 });
        expect((await one(skuOf("tc-00"), { interstate: true, recipient: CONTRIB("BA") })).item).toMatchObject({ icmsRateBps: 700, icms: 7000 });
        expect((await one(skuOf("tc-imp"), { interstate: true, recipient: CONTRIB("BA") })).item).toMatchObject({ origin: "1", icmsRateBps: 400, icms: 4000 });
        // interna continua com a alíquota do grupo (+ FCP 2% no tc-00)
        const internal = (await one(skuOf("tc-00"))).item;
        expect(internal).toMatchObject({ icmsRateBps: 1800, icms: 18000 });
        expect(internal.tc?.fcp?.value).toBe(2000);
      } finally {
        await setFlags({});
      }
    });
  });

  it("ST sem MVA ou sem alíquota da UF de destino: não calcula e avisa; NFC-e e consumidor final não calculam ST", async () => {
    const { s } = await product("st-sem-mva", { cstCsosn: "10", cfopInternal: "5401", cfopInterstate: "6401" });
    await setFlags({ tc: true });
    try {
      await asNormal(async () => {
        const a = (await one(s.id)).item;
        expect(a.icms).toBe(18000);
        expect(a.tc?.st).toBeUndefined();
        expect(a.tc?.warnings?.[0]).toMatch(/ICMS-ST não calculado: informe a MVA/);
        const b = (await one(skuOf("tc-10"), { interstate: true, recipient: CONTRIB("MG") })).item;
        expect(b.tc?.st).toBeUndefined();
        expect(b.tc?.warnings?.[0]).toMatch(/alíquota interna de MG/);
        const nfce = await one(skuOf("tc-10"), { model: "nfce", recipient: null });
        expect(nfce.item.icms).toBe(18000);
        expect(nfce.item.tc?.st).toBeUndefined();
        expect(nfce.totals.total).toBe(100000);
        expect((await one(skuOf("tc-10"), { recipient: { uf: "SP", ieIndicator: "9", finalConsumer: true } })).item.tc?.st).toBeUndefined();
      });
    } finally {
      await setFlags({});
    }
  });

  it("CSOSN 201 (Simples): ST com MVA original, deduzindo o ICMS próprio presumido; sem ICMS próprio destacado", async () => {
    await setFlags({ tc: true });
    try {
      const { item } = await one(skuOf("tc-201"));
      // base ST 1.400,00; ST = 1.400 × 18% (252,00) − 1.000 × 18% (180,00) = 72,00
      expect(item).toMatchObject({ icmsBase: 0, icms: 0 });
      expect(item.tc?.st).toMatchObject({ mvaBps: 4000, mvaAdjusted: false, base: 140000, value: 7200 });
      // interestadual: Simples usa a MVA original (sem ajuste) — 1.400 × 20% (280) − 1.000 × 12% (120) = 160,00
      const inter = (await one(skuOf("tc-201"), { interstate: true, recipient: CONTRIB("RJ") })).item;
      expect(inter.tc?.st).toMatchObject({ mvaBps: 4000, mvaAdjusted: false, base: 140000, rateBps: 2000, value: 16000 });
    } finally {
      await setFlags({});
    }
  });

  it("PIS/COFINS sem o ICMS na base (parâmetro separado, tema 69 do STF)", async () => {
    await setFlags({ tc: true });
    try {
      await asNormal(async () => {
        const before = (await one(skuOf("tc-00"))).item;
        expect(before).toMatchObject({ pisBase: 100000, pis: 1650, cofinsBase: 100000, cofins: 7600 });
        await setSetting(store, companyId(), null, TC_SETTINGS.pisCofinsExcludeIcms, true);
        const { item } = await one(skuOf("tc-00"));
        // base = 1.000 − ICMS 180 = 820,00; PIS 1,65% = 13,53; COFINS 7,6% = 62,32
        expect(item).toMatchObject({ icms: 18000, pisBase: 82000, pis: 1353, cofinsBase: 82000, cofins: 6232 });
        expect(item.tc?.pisCofinsExIcms).toBe(true);
        const { payload } = await payloadOf([item], computeTotals([item]), null);
        expect(payload.items[0]).toMatchObject({ pis_base_calculo: 820, pis_valor: 13.53, cofins_base_calculo: 820, cofins_valor: 62.32 });
      });
    } finally {
      await setSetting(store, companyId(), null, TC_SETTINGS.pisCofinsExcludeIcms, false);
      await setFlags({});
    }
  });
});

describe("FIS-16 — DIFAL (EC 87/2015) na venda interestadual a consumidor final não contribuinte", () => {
  it("cálculo puro: por fora 110 × (18% − 7%) = 12,10; por dentro (base dupla) e com FCP", () => {
    expect(computeDifal(11000, 700, 1800, 0, "fora")).toMatchObject({ base: 11000, dest: 1210, fcp: 0, remet: 0, partBps: 10000 });
    // por dentro: ICMS origem 7,70; base = (110 − 7,70) / 0,82 = 124,756 → 124,76; DIFAL = 124,76 × 18% (22,46) − 7,70 = 14,76
    expect(computeDifal(11000, 700, 1800, 0, "dentro")).toMatchObject({ base: 12476, dest: 1476 });
    // exemplo da fonte (SP → RS): 100 − 12 = 88 / 0,82 = 107,32; DIFAL = 19,32 − 12 = 7,32
    expect(computeDifal(10000, 1200, 1800, 0, "dentro")).toMatchObject({ base: 10732, dest: 732 });
    // com FCP 2% (hipótese: FCP no divisor): base = 88 / 0,78 = 112,82; DIFAL = 22,56 − 12 = 10,56; FCP = 2,26
    expect(computeDifal(10000, 1200, 2000, 200, "dentro")).toMatchObject({ base: 11282, dest: 1056, fcp: 226, fcpBase: 11282 });
    expect(computeDifal(10000, 1200, 2000, 200, "fora")).toMatchObject({ base: 10000, dest: 800, fcp: 200 });
  });

  it("NF-e SP → BA a não contribuinte: por fora (padrão) 12,10 com a tabela de alíquotas da empresa; por dentro por UF; vNF inalterado; grupo ICMSUFDest", async () => {
    const { s } = await product("difal-ba", { ufRates: null });
    await setFlags({ tc: true });
    await setSetting(store, companyId(), null, TC_SETTINGS.ufRates, { BA: { internalBps: 1800 } });
    try {
      await asNormal(async () => {
        const fora = await one(s.id, { interstate: true, recipient: CONSUMER("BA"), price: 11000 });
        expect(fora.item).toMatchObject({ icmsRateBps: 700, icms: 770 });
        expect(fora.item.tc?.difal).toMatchObject({ mode: "fora", base: 11000, internalRateBps: 1800, interRateBps: 700, dest: 1210, remet: 0 });
        expect(fora.totals).toMatchObject({ total: 11000, icmsUfDest: 1210 });
        const rcp = { name: "Consumidor", doc: "52998224725", ieIndicator: "9", finalConsumer: true, address: { uf: "BA" } };
        const { payload, xml } = await payloadOf([fora.item], fora.totals, rcp);
        expect(payload).toMatchObject({ consumidor_final: 1, local_destino: 2, valor_total: 110, icms_valor_total_uf_destino: 12.1, fcp_valor_total_uf_destino: 0, icms_valor_total_uf_remetente: 0 });
        expect(payload.items[0]).toMatchObject({ icms_aliquota: 7, icms_valor: 7.7, icms_base_calculo_uf_destino: 110, icms_aliquota_interna_uf_destino: 18, icms_aliquota_interestadual: 7, icms_percentual_partilha: 100, icms_valor_uf_destino: 12.1, icms_valor_uf_remetente: 0 });
        expect(xml).toMatch(/<ICMSUFDest vBCUFDest="110.00" vBCFCPUFDest="110.00" pFCPUFDest="0.0000" pICMSUFDest="18.0000" pICMSInter="7.0000" pICMSInterPart="100.0000" vFCPUFDest="0.00" vICMSUFDest="12.10" vICMSUFRemet="0.00"\/>/);
        await setSetting(store, companyId(), null, TC_SETTINGS.difalModeByUf, { BA: "dentro" });
        const dentro = await one(s.id, { interstate: true, recipient: CONSUMER("BA"), price: 11000 });
        expect(dentro.item.tc?.difal).toMatchObject({ mode: "dentro", base: 12476, dest: 1476 });
        // contribuinte (IE) não tem DIFAL de EC 87
        expect((await one(s.id, { interstate: true, recipient: CONTRIB("BA"), price: 11000 })).item.tc?.difal).toBeUndefined();
        // UF sem alíquota cadastrada: aviso, sem DIFAL
        const mg = (await one(s.id, { interstate: true, recipient: CONSUMER("MG"), price: 11000 })).item;
        expect(mg.tc?.difal).toBeUndefined();
        expect(mg.tc?.warnings?.[0]).toMatch(/DIFAL não calculado: alíquota interna de MG/);
      });
    } finally {
      await clearSettings();
      await setFlags({});
    }
  });

  it("alíquota da UF no grupo sobrepõe a tabela da empresa; FCP do destino no DIFAL (RJ 20% + 2%)", async () => {
    await setFlags({ tc: true });
    await setSetting(store, companyId(), null, TC_SETTINGS.ufRates, { RJ: { internalBps: 1700 } });
    try {
      await asNormal(async () => {
        const { item } = await one(skuOf("tc-00"), { interstate: true, recipient: CONSUMER("RJ") });
        // grupo tc-00: RJ 20% + FCP 2%; por fora: 1.000 × (20% − 12%) = 80,00; FCP = 20,00
        expect(item.tc?.difal).toMatchObject({ mode: "fora", internalRateBps: 2000, fcpRateBps: 200, dest: 8000, fcp: 2000 });
      });
    } finally {
      await clearSettings();
      await setFlags({});
    }
  });

  it("NF-e pelo assistente: destinatário pessoa física de outra UF leva o DIFAL ao provedor; Simples não calcula DIFAL", async () => {
    await setFlags({ tc: true });
    const ctx = await adminCtx();
    const maria = refs.customers.maria;
    const input: NfeInput = {
      branchId: matriz(),
      origin: { type: "manual" },
      nature: "Venda de mercadoria",
      purpose: "normal",
      operationType: "saida",
      presence: "2",
      recipient: { partyType: "customer", partyId: maria.id, name: maria.name, doc: maria.doc, ie: null, ieIndicator: "9", finalConsumer: true, email: maria.email, address: { street: "Rua B", number: "1", district: "Centro", cityName: "Rio de Janeiro", cityCode: "3304557", uf: "RJ", zip: "20000000" } },
      items: [{ skuId: skuOf("tc-00"), qty: 1000, unitPrice: 100000, discount: 0 }],
      freight: 0,
      insurance: 0,
      other: 0,
      transport: { mode: "9" },
      payments: [{ kind: "pix", amount: 100000 }],
      referencedKeys: [],
      effects: { stock: false, financial: false },
    };
    try {
      const simples = await buildNfe(ctx, input);
      expect(simples.items[0].tc?.difal).toBeUndefined();
      await asNormal(async () => {
        const built = await buildNfe(ctx, input);
        expect(built.items[0]).toMatchObject({ icmsRateBps: 1200, icms: 12000 });
        expect(built.items[0].tc?.difal).toMatchObject({ dest: 8000, fcp: 2000 });
        let doc = await saveNfe(ctx, input, { idemKey: `tc-nfe-${++seq}`, transmit: true });
        const req = (await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "request"]] }))[0];
        expect(req.request).toMatchObject({ consumidor_final: 1, valor_total: 1000, icms_valor_total_uf_destino: 80, fcp_valor_total_uf_destino: 20 });
        expect(req.request.items[0]).toMatchObject({ icms_valor_uf_destino: 80, fcp_valor_uf_destino: 20, icms_aliquota_interestadual: 12 });
        doc = await queryDocument(ctx, doc.id);
        expect(doc.status).toBe("authorized");
        const xml = (await readFile(ctx, doc.xmlFileId)).data.toString();
        expect(xml).toMatch(/<ICMSUFDest vBCUFDest="1000.00"/);
      });
    } finally {
      await setFlags({});
    }
  });
});

describe("FIS-13 — crédito do Simples Nacional (LC 123/2006, art. 23)", () => {
  it("CSOSN 101/201 com pCredSN: vCredICMSSN no item e mensagem obrigatória nas informações complementares", async () => {
    await setFlags({ cred: true });
    try {
      const noRate = (await one(skuOf("tc-101"))).item;
      expect(noRate.tc?.credSn).toBeUndefined();
      expect(noRate.tc?.warnings?.[0]).toMatch(/pCredSN/);
      await setSetting(store, companyId(), null, TC_SETTINGS.simplesCreditBps, 250);
      const { item, totals } = await one(skuOf("tc-101"));
      // 1.000,00 × 2,5% = 25,00 — não altera ICMS nem o total
      expect(item).toMatchObject({ cstCsosn: "101", icms: 0 });
      expect(item.tc?.credSn).toEqual({ rateBps: 250, value: 2500 });
      expect(totals.total).toBe(100000);
      const msg = simplesCreditMessage([item]);
      expect(msg).toBe("DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. PERMITE O APROVEITAMENTO DO CRÉDITO DE ICMS NO VALOR DE R$ 25,00, CORRESPONDENTE À ALÍQUOTA DE 2,50%, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR Nº 123, DE 2006.");
      const doc = fakeDoc([item], totals, null);
      (doc as any).service = { additionalInfo: "Pedido 123." };
      const company = await store.getOrThrow("companies", companyId());
      const payload = toProviderPayload(doc, company, await store.getOrThrow("branches", matriz()), await getFiscalConfig(store, companyId(), matriz()));
      expect(payload.items[0]).toMatchObject({ icms_situacao_tributaria: "101", icms_aliquota_credito_simples: 2.5, icms_valor_credito_simples: 25 });
      expect(payload.informacoes_adicionais_contribuinte).toBe(`Pedido 123. ${msg}`);
      expect(simulatedXml(doc)).toMatch(/<CredSN pCredSN="2.5000" vCredICMSSN="25.00"\/>/);
      // CSOSN 102 (sem permissão de crédito) e NFC-e: nada
      const { s: s102 } = await product("csosn-102", { regime: "simples", cstCsosn: "102", icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0 });
      const c102 = (await one(s102.id)).item;
      expect(c102.tc?.credSn).toBeUndefined();
      expect((await one(skuOf("tc-101"), { model: "nfce", recipient: null })).item.tc).toBeUndefined();
      // empresa do regime normal não usa o crédito
      await asNormal(async () => expect((await one(skuOf("tc-101"))).item.tc).toBeUndefined());
    } finally {
      await clearSettings();
      await setFlags({});
    }
  });

  it("sem o recurso, o percentual gravado é ignorado (nada muda)", async () => {
    await setSetting(store, companyId(), null, TC_SETTINGS.simplesCreditBps, 250);
    try {
      expect((await one(skuOf("tc-101"))).item.tc).toBeUndefined();
    } finally {
      await clearSettings();
    }
  });
});

describe("FIS-11/07 — naturezas de operação", () => {
  it("grupo dedicado à natureza (operationKey) aplica CFOP e CST; sem grupo, a natureza aplica CFOP/CST padrão sobre o grupo do produto; “venda” não muda nada", async () => {
    await setFlags({ nat: true });
    try {
      // regime normal: grupo tc-rem (CST 41, CFOP 5915/6915) dedicado à remessa para conserto
      await asNormal(async () => {
        const rem = (await one(skuOf("tc-00"), { operationKey: "remessa_conserto" })).item;
        expect(rem).toMatchObject({ cfop: "5915", cstCsosn: "41", taxGroupId: groups["tc-rem"].id, icms: 0 });
        expect((await one(skuOf("tc-00"), { operationKey: "remessa_conserto", interstate: true })).item.cfop).toBe("6915");
        // bonificação (sem grupo dedicado): CFOP da natureza, CST do grupo do produto
        expect((await one(skuOf("tc-00"), { operationKey: "bonificacao" })).item).toMatchObject({ cfop: "5910", cstCsosn: "00", taxGroupId: groups["tc-00"].id, icms: 18000 });
        // grupo escolhido no item prevalece sobre a natureza
        const ctx = await adminCtx();
        const manual = await buildItems(ctx, [{ skuId: skuOf("tc-00"), qty: 1000, unitPrice: 100000, discount: 0, taxGroupId: normalGroups[0].id }], { branchId: matriz(), kind: "sale", operationKey: "remessa_conserto" });
        expect(manual[0].cstCsosn).toBe("00");
      });
      // Simples: o grupo tc-rem é de regime normal → natureza aplica CFOP 5915 e CSOSN 900 sobre o grupo do produto
      expect((await one(skuOf("tc-101"), { operationKey: "remessa_conserto" })).item).toMatchObject({ cfop: "5915", cstCsosn: "900", taxGroupId: groups["tc-101"].id });
      // venda: sem CFOP/CST próprios — idêntico a não escolher natureza
      const plain = (await one(skuOf("tc-101"))).item;
      expect((await one(skuOf("tc-101"), { operationKey: "venda" })).item).toEqual(plain);
    } finally {
      await setFlags({});
    }
    // recurso desligado: a natureza é ignorada
    expect((await one(skuOf("tc-101"), { operationKey: "remessa_conserto" })).item).toMatchObject({ cfop: "5102", cstCsosn: "101" });
  });

  it("cadastro de naturezas (tabela em settings): validações, inclusão, alteração e uso no assistente (gravada no documento e no rascunho)", async () => {
    const ctx = await adminCtx();
    await expect(saveNature(ctx, { key: "x", label: "X", operationType: "saida", purpose: "normal", kind: "other", active: true })).rejects.toThrow(/desligado/);
    await setFlags({ nat: true });
    try {
      await expect(saveNature(ctx, { key: "Remessa X", label: "Remessa", operationType: "saida", purpose: "normal", kind: "other", active: true })).rejects.toThrow(/Código da natureza/);
      await expect(saveNature(ctx, { key: "remessa_x", label: "Remessa", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "1915", active: true })).rejects.toThrow(/CFOP deve começar por 5/);
      await expect(saveNature(ctx, { key: "venda", label: "Venda duplicada", operationType: "saida", purpose: "normal", kind: "sale", active: true })).rejects.toThrow(/Já existe/);
      await saveNature(ctx, { key: "remessa_industrializacao", label: "Remessa para industrialização", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5901", cfopInterstate: "6901", cstSimples: "900", cstNormal: "50", active: true });
      await saveNature(ctx, { key: "bonificacao", label: "Bonificação", operationType: "saida", purpose: "normal", kind: "other", cfopInternal: "5910", cfopInterstate: "6910", cstSimples: "400", active: true }, { originalKey: "bonificacao" });
      expect((await one(skuOf("tc-101"), { operationKey: "remessa_industrializacao" })).item).toMatchObject({ cfop: "5901", cstCsosn: "900" });
      expect((await one(skuOf("tc-101"), { operationKey: "bonificacao" })).item).toMatchObject({ cfop: "5910", cstCsosn: "400" });
      // NF-e avulsa com natureza: gravada no documento, restaurada no rascunho e reaplicada em "Atualizar do cadastro"
      const c = refs.customers.mercado;
      const input: NfeInput = { branchId: matriz(), origin: { type: "manual" }, nature: "Remessa para industrialização", operationKey: "remessa_industrializacao", purpose: "normal", operationType: "saida", presence: "1", recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] }, items: [{ skuId: skuOf("tc-101"), qty: 1000, unitPrice: 5000, discount: 0 }], freight: 0, insurance: 0, other: 0, transport: { mode: "9" }, payments: [{ kind: "none", amount: 0 }], referencedKeys: [], effects: { stock: false, financial: false } };
      const doc = await saveNfe(ctx, input, { idemKey: `tc-nat-${++seq}`, transmit: false });
      expect(doc.operationKey).toBe("remessa_industrializacao");
      expect(doc.items[0]).toMatchObject({ cfop: "5901", cstCsosn: "900" });
      expect(docToInput(doc).operationKey).toBe("remessa_industrializacao");
      const r = await refreshFromCatalog(ctx, doc.id);
      expect(r.doc.items[0]).toMatchObject({ cfop: "5901", cstCsosn: "900" });
      expect(DEFAULT_NATURES.map((n) => n.key)).toEqual(expect.arrayContaining(["venda", "devolucao_venda", "remessa_conserto", "demonstracao", "bonificacao", "transferencia", "consignacao"]));
    } finally {
      await setSetting(store, companyId(), null, TC_SETTINGS.operationNatures, null);
      await setFlags({});
    }
  });
});

describe("cadastros e parâmetros da tributação completa", () => {
  it("grupo tributário: campos de ST/MVA/UF e natureza só gravados quando o bloco é enviado (Produtos e Fiscal)", async () => {
    const ctx = await adminCtx();
    const fd = new FormData();
    expect(completeFromForm(fd)).toBeNull();
    expect(natureKeyFromForm(fd)).toBeUndefined();
    fd.set("tcBlock", "1");
    fd.set("stMva", "40");
    fd.set("stRate", "18");
    fd.set("stBaseReduction", "");
    fd.set("ufRates", "RJ 20 2\nBA 20,5");
    fd.set("natureBlock", "1");
    fd.set("operationKey", "remessa_conserto");
    const g = await saveProductsTaxGroup(ctx, { name: "Grupo ST cadastro", regime: "normal", cstCsosn: "10", cfopInternal: "5401", cfopInterstate: "6401", icmsRateBps: 1800, complete: completeFromForm(fd), operationKey: natureKeyFromForm(fd) });
    expect(g).toMatchObject({ stMvaBps: 4000, stRateBps: 1800, stBaseReductionBps: null, ufRates: { RJ: { internalBps: 2000, fcpBps: 200 }, BA: { internalBps: 2050 } }, operationKey: "remessa_conserto" });
    // sem os blocos (recursos desligados na tela): valores mantidos
    const g2 = await saveProductsTaxGroup(ctx, { id: g.id, name: "Grupo ST cadastro", regime: "normal", cstCsosn: "10", cfopInternal: "5401", cfopInterstate: "6401", icmsRateBps: 1800 });
    expect(g2).toMatchObject({ stMvaBps: 4000, operationKey: "remessa_conserto" });
    const g3 = await saveFiscalTaxGroup(ctx, g.id, { name: "Grupo ST cadastro", regime: "normal", cfopInternal: "5401", cfopInterstate: "6401", cstCsosn: "10", icmsRateBps: 1800, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, active: true, complete: { stMvaBps: 5000, stRateBps: 1800, ufRates: "" }, operationKey: null });
    expect(g3).toMatchObject({ stMvaBps: 5000, ufRates: null, operationKey: null });
    await expect(saveProductsTaxGroup(ctx, { name: "x", regime: "normal", complete: { ufRates: "ZZ 18" } })).rejects.toThrow(/UF inválida/);
  });

  it("parâmetros (DIFAL, PIS/COFINS, alíquotas por UF, pCredSN) exigem o recurso e ficam em settings", async () => {
    const ctx = await adminCtx();
    await expect(saveCompleteSettings(ctx, { pisCofinsExcludeIcms: true, difalDefaultMode: "dentro", difalModes: "", ufRates: "" })).rejects.toThrow(/desligado/);
    await expect(saveSimplesCredit(ctx, 250)).rejects.toThrow(/desligado/);
    await setFlags({ tc: true, cred: true });
    try {
      await expect(saveCompleteSettings(ctx, { pisCofinsExcludeIcms: true, difalDefaultMode: "meio", difalModes: "", ufRates: "" })).rejects.toThrow(/Modo padrão/);
      await saveCompleteSettings(ctx, { pisCofinsExcludeIcms: true, difalDefaultMode: "dentro", difalModes: "RJ fora", ufRates: "BA 18\nRJ 20 2" });
      const rows = await listAll(store, "settings", { filters: [["eq", "companyId", companyId()]] });
      const v = (k: string) => rows.find((r) => r.key === k && !r.branchId)?.value;
      expect(v(TC_SETTINGS.pisCofinsExcludeIcms)).toBe(true);
      expect(v(TC_SETTINGS.difalDefaultMode)).toBe("dentro");
      expect(v(TC_SETTINGS.difalModeByUf)).toEqual({ RJ: "fora" });
      expect(v(TC_SETTINGS.ufRates)).toEqual({ BA: { internalBps: 1800 }, RJ: { internalBps: 2000, fcpBps: 200 } });
      expect(await saveSimplesCredit(ctx, 312)).toBe(312);
      await expect(saveSimplesCredit(ctx, 20000)).rejects.toThrow(/inválido/);
    } finally {
      await clearSettings();
      await setFlags({});
    }
  });

  it("recursos no catálogo de parâmetros, desligados por padrão", () => {
    for (const k of ["tributacaoCompleta", "naturezasOperacao", "creditoSimples"]) {
      const p = PARAMS.find((x) => x.key === `feature.${k}`);
      expect(p, k).toBeTruthy();
      expect(p!.default).toBe(false);
      expect(FEATURE_DEFAULTS[k]).toBe(false);
    }
  });
});

