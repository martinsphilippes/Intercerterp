import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { seedModules } from "@/domain/seed/modules";
import "@/domain/jobs-registry";
import { detId, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { addDays, today } from "@/lib/dates";
import { setSetting, FEATURE_DEFAULTS } from "@/lib/core/settings";
import { readFile } from "@/lib/core/files";
import { buildItems, getFiscalConfig, queryDocument, simulatedXml, toProviderPayload, validateDocument, validateWarnings } from "@/domain/fiscal/service";
import { buildNfe, currentWarnings, refreshFromCatalog, saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { saveReformAdherence, saveTaxGroup as saveFiscalTaxGroup } from "@/domain/fiscal/config";
import { saveProductReform, saveTaxGroup as saveProductsTaxGroup } from "@/domain/products";
import { computeItemReform, ibsCbsKind, isReformActive, reformActiveForDoc, reformBase, reformPayloadItem, reformTotals, REFORM_FEATURE, TEST_RATES_2026 } from "@/domain/fiscal/reform";
import { FISCAL_GLOSSARY, HELP_ARTICLES, rejectionHelp, SEFAZ_REJECTIONS } from "@/domain/help-content";
import { PARAMS } from "@/app/(app)/administracao/parametros/catalog";
import { seedNormalGroups, snapshotAll, stripReform, type SnapEntry } from "./tax-reform-harness";

/**
 * Reforma tributária (FIS-19, FIS-26/27, PLA-08 — Fase 2).
 * TESTE DE IGUALDADE: o retrato tests/fixtures/reforma-baseline.json foi gravado com o código ANTERIOR à reforma
 * (commit "retrato de igualdade fiscal"); payload do provedor, XML de simulação e totais de todos os produtos do seed
 * (Simples e regime normal, NF-e interna/interestadual e NFC-e) precisam continuar idênticos — sem adesão e, com adesão,
 * descontados apenas os grupos novos (IBS/CBS/IS).
 */

const BASELINE = path.join(__dirname, "fixtures", "reforma-baseline.json");

let store: Store;
let refs: DemoRefs;
let seq = 0;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  await seedModules(refs);
  await seedNormalGroups(refs);
}, 240000);

const adminCtx = () => refs.ctxFor("admin", "matriz");
const companyId = () => refs.company.id;
const matriz = () => refs.branches.matriz.id;
const cfgId = () => detId("fiscalcfg", `${companyId()}|${matriz()}`);

async function snapshotBothRegimes(opts: { reform?: boolean } = {}) {
  const a = await snapshotAll(store, refs, "simples", opts);
  await store.update("companies", companyId(), { regime: "normal", crt: "3" });
  try {
    return { ...a, ...(await snapshotAll(store, refs, "normal", opts)) };
  } finally {
    await store.update("companies", companyId(), { regime: "simples", crt: "1" });
  }
}

const baseline = () => JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, SnapEntry>;

/** Liga/desliga o recurso e a adesão (configuração fiscal da matriz) diretamente no banco. */
async function setReform(feature: boolean, adherence: boolean, from: string | null = today()) {
  await setSetting(store, companyId(), null, `feature.${REFORM_FEATURE}`, feature);
  await store.update("fiscal_configs", cfgId(), { reformAdherence: adherence, reformAdherenceFrom: adherence ? from : null });
}

/** Classificação de teste em TODOS os grupos tributários da empresa (CST 000, cClassTrib 000001, CBS 0,9%, IBS 0,1%). */
async function classifyAllGroups(extra: Record<string, unknown> = {}) {
  const groups = await listAll(store, "tax_groups", { filters: [["eq", "companyId", companyId()]] });
  for (const g of groups) await store.update("tax_groups", g.id, { ibsCbsCst: "000", cClassTrib: "000001", ...TEST_RATES_2026, reformValidFrom: null, ...extra });
  return groups;
}

async function clearAllGroups() {
  const groups = await listAll(store, "tax_groups", { filters: [["eq", "companyId", companyId()]] });
  for (const g of groups) await store.update("tax_groups", g.id, { ibsCbsCst: null, cClassTrib: null, ibsRateBps: null, cbsRateBps: null, isRateBps: null, ibsCbsRedBps: null, reformValidFrom: null });
}

async function product(key: string, data: Record<string, unknown>, groupData?: Record<string, unknown>) {
  const sd = refs.seeder;
  const tg = groupData ? await sd.put("tax_groups", `tg-${key}`, { companyId: companyId(), name: `Grupo ${key}`, regime: "simples", cfopInternal: "5102", cfopInterstate: "6102", cfopReturn: "1202", cstCsosn: "102", icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0, active: true, ...groupData }) : null;
  const p = await sd.put("products", key, { companyId: companyId(), type: "product", code: key.toUpperCase(), name: `Produto ${key}`, unitCode: "UN", ncm: "61091000", origin: "0", taxGroupId: tg?.id ?? refs.products.caneca.taxGroupId, status: "active", active: true, ...data });
  const s = await sd.put("skus", `${key}-u`, { companyId: companyId(), productId: p.id, sku: key.toUpperCase(), name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
  return { p, s, tg };
}

function nfeInput(skuId: string, over: Partial<NfeInput> = {}): NfeInput {
  const c = refs.customers.mercado;
  return {
    branchId: matriz(),
    origin: { type: "manual" },
    nature: "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: "1",
    recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] },
    items: [{ skuId, qty: 2000, unitPrice: 5000, discount: 0 }],
    freight: 0,
    insurance: 0,
    other: 0,
    transport: { mode: "9" },
    payments: [{ kind: "boleto", amount: 10000 }],
    referencedKeys: [],
    effects: { stock: false, financial: false },
    ...over,
  };
}

describe("reforma tributária — teste de igualdade (retrato anterior à reforma)", () => {
  it("sem adesão (padrão): payload, XML de simulação e totais de todos os produtos do seed são idênticos ao retrato", async () => {
    expect(FEATURE_DEFAULTS.reformaTributaria).toBe(false);
    const now = await snapshotBothRegimes();
    if (process.env.REFORMA_BASELINE_WRITE === "1") writeFileSync(BASELINE, JSON.stringify(now));
    const base = baseline();
    expect(Object.keys(base).length).toBeGreaterThan(100);
    expect(Object.keys(now).sort()).toEqual(Object.keys(base).sort());
    for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
  }, 120000);

  it("recurso ligado e grupos classificados, mas SEM adesão: nada muda (mesmo com o envio pedindo os grupos)", async () => {
    await classifyAllGroups();
    await setReform(true, false);
    try {
      const now = await snapshotBothRegimes({ reform: true });
      const base = baseline();
      for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
    } finally {
      await setReform(false, false);
      await clearAllGroups();
    }
  }, 120000);

  it("adesão marcada com o recurso DESLIGADO: nada muda", async () => {
    await classifyAllGroups();
    await setReform(false, true);
    try {
      const now = await snapshotBothRegimes({ reform: true });
      const base = baseline();
      for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
    } finally {
      await setReform(false, false);
      await clearAllGroups();
    }
  }, 120000);

  it("COM adesão: ICMS/PIS/COFINS, totais e XML idênticos ao retrato, exceto os grupos IBS/CBS novos (presentes em todos os itens)", async () => {
    await classifyAllGroups();
    await setReform(true, true);
    try {
      const now = await snapshotBothRegimes({ reform: true });
      const base = baseline();
      expect(Object.keys(now).sort()).toEqual(Object.keys(base).sort());
      for (const k of Object.keys(base)) {
        expect(stripReform(now[k]), k).toEqual(base[k]);
        const it0 = now[k].payload.items[0];
        expect(it0.ibs_cbs_situacao_tributaria, k).toBe("000");
        expect(it0.ibs_cbs_classificacao_tributaria, k).toBe("000001");
        expect(it0.cbs_aliquota, k).toBe(0.9);
        expect(it0.ibs_uf_aliquota, k).toBe(0.1);
        // total da nota (vNF) inalterado: IBS/CBS não somam no período de teste
        expect(now[k].payload.valor_total, k).toBe(base[k].payload.valor_total);
        expect(now[k].payload.cbs_valor_total, k).toBe(it0.cbs_valor);
        expect(now[k].xml, k).toMatch(/<IBSCBS CST="000" cClassTrib="000001" vBC="/);
        expect(now[k].xml, k).toMatch(/<IBSCBSTot /);
      }
    } finally {
      await setReform(false, false);
      await clearAllGroups();
    }
  }, 120000);
});

describe("reforma tributária — cálculo por CST com as alíquotas de teste de 2026", () => {
  const rates = { ibsRateBps: 10, cbsRateBps: 90, isRateBps: 0, redBps: 0 };

  it("base = valor do item − ICMS − PIS − COFINS; CBS 0,9% e IBS 0,1% (UF), IBS municipal 0", () => {
    expect(reformBase({ total: 10000, icms: 1800, pis: 165, cofins: 760 })).toBe(7275);
    const r = computeItemReform({ total: 10000, icms: 1800, pis: 165, cofins: 760 }, { ...rates, cst: "000", cClassTrib: "000001" });
    expect(r).toMatchObject({ kind: "values", base: 7275, ibsUf: 7, ibsMun: 0, ibs: 7, cbs: 65 }); // 7,275 → 7 ; 65,475 → 65
    const p = reformPayloadItem(r);
    expect(p).toEqual({
      ibs_cbs_situacao_tributaria: "000",
      ibs_cbs_classificacao_tributaria: "000001",
      ibs_cbs_base_calculo: 72.75,
      ibs_uf_aliquota: 0.1,
      ibs_uf_valor: 0.07,
      ibs_mun_aliquota: 0,
      ibs_mun_valor: 0,
      ibs_valor_total: 0.07,
      cbs_aliquota: 0.9,
      cbs_valor: 0.65,
    });
    // Simples: sem ICMS/PIS/COFINS destacados — base = valor do item
    expect(computeItemReform({ total: 10000, icms: 0, pis: 0, cofins: 0 }, { ...rates, cst: "000", cClassTrib: "000001" })).toMatchObject({ base: 10000, ibsUf: 10, cbs: 90 });
  });

  it("CST 200 (alíquota reduzida): pRedAliq reduz IBS e CBS; CST 000 ignora a redução", () => {
    const r = computeItemReform({ total: 10000 }, { ...rates, redBps: 6000, cst: "200", cClassTrib: "200028" });
    expect(r).toMatchObject({ base: 10000, redBps: 6000, ibsUf: 4, cbs: 36 }); // 0,04% e 0,36%
    const p = reformPayloadItem(r);
    expect(p).toMatchObject({ cbs_percentual_reducao_aliquota: 60, cbs_aliquota_efetiva: 0.36, ibs_uf_percentual_reducao_aliquota: 60, ibs_uf_aliquota_efetiva: 0.04 });
    expect(computeItemReform({ total: 10000 }, { ...rates, redBps: 6000, cst: "000", cClassTrib: "000001" })).toMatchObject({ redBps: 0, cbs: 90 });
  });

  it("CST 400/410/550 (isenção, imunidade, suspensão): só CST e cClassTrib, sem valores", () => {
    for (const cst of ["400", "410", "550"]) {
      const r = computeItemReform({ total: 10000 }, { ...rates, cst, cClassTrib: `${cst}001` });
      expect(r.kind).toBe("no_values");
      expect(reformPayloadItem(r)).toEqual({ ibs_cbs_situacao_tributaria: cst, ibs_cbs_classificacao_tributaria: `${cst}001` });
    }
    expect(ibsCbsKind("510")).toBe("unsupported");
    expect(ibsCbsKind("620")).toBe("unsupported");
  });

  it("IS: calculado por fora sobre o valor do item e somado à base do IBS/CBS", () => {
    const r = computeItemReform({ total: 10000 }, { ...rates, isRateBps: 1000, cst: "000", cClassTrib: "000001" });
    expect(r).toMatchObject({ isBase: 10000, is: 1000, base: 11000, cbs: 99, ibsUf: 11 });
    expect(reformPayloadItem(r)).toMatchObject({ is_base_calculo: 100, is_aliquota: 10, is_valor: 10 });
    expect(reformTotals([{ ibsCbs: r }, { ibsCbs: null }])).toMatchObject({ base: 11000, cbs: 99, is: 1000, hasIs: true });
  });

  it("NF-e de regime normal com adesão: grupos por item e totais; ICMS/PIS/COFINS e total inalterados; transmissão leva os grupos ao provedor e ao XML", async () => {
    const ctx = await adminCtx();
    await store.update("companies", companyId(), { regime: "normal", crt: "3" });
    const { s } = await product("rt-normal", {}, { regime: "normal", cstCsosn: "00", icmsRateBps: 1800, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, ibsCbsCst: "000", cClassTrib: "000001", ...TEST_RATES_2026 });
    try {
      const before = await buildNfe(ctx, nfeInput(s.id));
      expect(before.items[0].ibsCbs).toBeUndefined();
      await setReform(true, true);
      const after = await buildNfe(ctx, nfeInput(s.id));
      const { ibsCbs, ...rest } = after.items[0];
      expect(rest).toEqual(before.items[0]);
      expect(after.totals).toEqual(before.totals);
      // item: 100,00 − ICMS 18,00 − PIS 1,65 − COFINS 7,60 = 72,75
      expect(ibsCbs).toMatchObject({ cst: "000", cClassTrib: "000001", base: 7275, ibsUf: 7, cbs: 65 });
      let doc = await saveNfe(ctx, nfeInput(s.id), { idemKey: `rt-nfe-${++seq}`, transmit: true });
      const req = (await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "request"]] }))[0];
      expect(req.request.items[0]).toMatchObject({ icms_valor: 18, pis_valor: 1.65, cofins_valor: 7.6, ibs_cbs_situacao_tributaria: "000", ibs_cbs_base_calculo: 72.75, cbs_valor: 0.65, ibs_uf_valor: 0.07 });
      expect(req.request).toMatchObject({ valor_total: 100, cbs_valor_total: 0.65, ibs_valor_total: 0.07, ibs_cbs_base_calculo: 72.75 });
      doc = await queryDocument(ctx, doc.id);
      expect(doc.status).toBe("authorized");
      const xml = (await readFile(ctx, doc.xmlFileId)).data.toString();
      expect(xml).toMatch(/<IBSCBS CST="000" cClassTrib="000001" vBC="72.75" pIBSUF="0.1000" vIBSUF="0.07"/);
      expect(xml).toMatch(/<IBSCBSTot vBC="72.75" vIBSUF="0.07" vIBSMun="0.00" vIBS="0.07" vCBS="0.65"\/>/);
      expect(xml).toMatch(/<total>100.00<\/total>/);
    } finally {
      await setReform(false, false);
      await store.update("companies", companyId(), { regime: "simples", crt: "1" });
    }
  });

  it("NFC-e (venda no PDV) e produto sobrepondo CST/cClassTrib do grupo", async () => {
    const ctx = await adminCtx();
    const { s, p } = await product("rt-nfce", {}, { ibsCbsCst: "000", cClassTrib: "000001", ...TEST_RATES_2026 });
    await setReform(true, true);
    try {
      await saveProductReform(ctx, p.id, { ibsCbsCst: "200", cClassTrib: "200003" });
      const items = await buildItems(ctx, [{ skuId: s.id, qty: 1000, unitPrice: 1000, discount: 0 }], { branchId: matriz(), kind: "sale" });
      expect(items[0].ibsCbs).toMatchObject({ cst: "200", cClassTrib: "200003", base: 1000, ibsUf: 1, cbs: 9 });
      await expect(saveProductReform(ctx, p.id, { ibsCbsCst: "000", cClassTrib: "200003" })).rejects.toThrow(/não pertence ao CST/);
    } finally {
      await setReform(false, false);
    }
  });
});

describe("reforma tributária — vigência", () => {
  it("antes da data de adesão não sai; a partir dela sai", async () => {
    const ctx = await adminCtx();
    const { s } = await product("rt-vig", {}, { ibsCbsCst: "000", cClassTrib: "000001", ...TEST_RATES_2026 });
    try {
      await setReform(true, true, addDays(today(), 1));
      const cfg = await getFiscalConfig(store, companyId(), matriz());
      expect(await isReformActive(store, companyId(), matriz(), cfg)).toBe(false);
      expect((await buildItems(ctx, [{ skuId: s.id, qty: 1000, unitPrice: 1000, discount: 0 }], { branchId: matriz() }))[0].ibsCbs).toBeUndefined();
      // documento emitido hoje com adesão a partir de amanhã: transmissão sem os grupos
      expect(await reformActiveForDoc(store, { model: "nfe", companyId: companyId(), branchId: matriz(), issuedAt: new Date().toISOString() } as any, cfg)).toBe(false);
      await setReform(true, true, today());
      expect((await buildItems(ctx, [{ skuId: s.id, qty: 1000, unitPrice: 1000, discount: 0 }], { branchId: matriz() }))[0].ibsCbs).toMatchObject({ cst: "000" });
      const cfg2 = await getFiscalConfig(store, companyId(), matriz());
      expect(await reformActiveForDoc(store, { model: "nfe", companyId: companyId(), branchId: matriz(), issuedAt: `${addDays(today(), -2)}T15:00:00.000Z` } as any, cfg2)).toBe(false);
      expect(await reformActiveForDoc(store, { model: "nfse", companyId: companyId(), branchId: matriz(), issuedAt: new Date().toISOString() } as any, cfg2)).toBe(false);
    } finally {
      await setReform(false, false);
    }
  });

  it("vigência própria do grupo (reformValidFrom futura) segura o grupo; payload sem adesão nunca leva os grupos já calculados", async () => {
    const ctx = await adminCtx();
    const { s, tg } = await product("rt-vig-grp", {}, { ibsCbsCst: "000", cClassTrib: "000001", ...TEST_RATES_2026, reformValidFrom: addDays(today(), 10) });
    await setReform(true, true);
    try {
      const items = await buildItems(ctx, [{ skuId: s.id, qty: 1000, unitPrice: 1000, discount: 0 }], { branchId: matriz() });
      expect(items[0].ibsCbs).toBeUndefined();
      await store.update("tax_groups", tg!.id, { reformValidFrom: today() });
      const items2 = await buildItems(ctx, [{ skuId: s.id, qty: 1000, unitPrice: 1000, discount: 0 }], { branchId: matriz() });
      expect(items2[0].ibsCbs).toBeTruthy();
      // adesão desligada depois de montar: o envio sem `reform` não leva os grupos (reversão pela flag)
      const doc = { model: "nfe", items: items2, totals: { products: 1000, discount: 0, freight: 0, total: 1000 }, payments: [], ref: "x" } as any;
      const company = await store.getOrThrow("companies", companyId());
      const payload = toProviderPayload(doc, company, refs.branches.matriz, null);
      expect(Object.keys(payload.items[0]).some((k) => /^(ibs|cbs|is)_/.test(k))).toBe(false);
      expect(simulatedXml(doc)).not.toMatch(/IBSCBS/);
    } finally {
      await setReform(false, false);
    }
  });

  it("adesão exige data de início; cadastro do grupo valida CST/cClassTrib e mantém os campos quando o bloco não é enviado", async () => {
    const ctx = await adminCtx();
    await expect(saveReformAdherence(ctx, matriz(), { adherence: true, from: null })).rejects.toThrow(/data de início/);
    await saveReformAdherence(ctx, matriz(), { adherence: true, from: "2026-01-01" });
    expect(await store.get("fiscal_configs", cfgId())).toMatchObject({ reformAdherence: true, reformAdherenceFrom: "2026-01-01" });
    await saveReformAdherence(ctx, matriz(), { adherence: false });
    expect(await store.get("fiscal_configs", cfgId())).toMatchObject({ reformAdherence: false, reformAdherenceFrom: null });

    const base = { name: "Grupo reforma", regime: "simples", cfopInternal: "5102", cfopInterstate: "6102", cstCsosn: "102", icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0, active: true };
    await expect(saveFiscalTaxGroup(ctx, null, { ...base, reform: { ibsCbsCst: "000", cClassTrib: "410001" } })).rejects.toThrow(/não pertence ao CST/);
    await expect(saveFiscalTaxGroup(ctx, null, { ...base, reform: { ibsCbsCst: "999" } })).rejects.toThrow(/CST do IBS\/CBS inválido/);
    const g = await saveFiscalTaxGroup(ctx, null, { ...base, reform: { ibsCbsCst: "000", cClassTrib: "000001", ibsRateBps: 10, cbsRateBps: 90, reformValidFrom: "2026-01-01" } });
    expect(g).toMatchObject({ ibsCbsCst: "000", cClassTrib: "000001", ibsRateBps: 10, cbsRateBps: 90, reformValidFrom: "2026-01-01" });
    const g2 = await saveFiscalTaxGroup(ctx, g.id, { ...base, name: "Grupo reforma (editado)" });
    expect(g2).toMatchObject({ name: "Grupo reforma (editado)", ibsCbsCst: "000", cClassTrib: "000001", cbsRateBps: 90 });
    const g3 = await saveProductsTaxGroup(ctx, { id: g.id, ...base, reform: { ibsCbsCst: "410", cClassTrib: "410004" } });
    expect(g3).toMatchObject({ ibsCbsCst: "410", cClassTrib: "410004", ibsRateBps: null, cbsRateBps: null });
  });
});

describe("avisos prévios (FIS-26/27) — não bloqueiam a transmissão", () => {
  it("NCM inexistente, CEST ausente com ST, CFOP × destino, CST × regime e GTIN inválido viram avisos", async () => {
    const ctx = await adminCtx();
    const ncm = await product("av-ncm", { ncm: "00000000" });
    const st = await product("av-st", { cest: null }, { cstCsosn: "500", cfopInternal: "5405", cfopInterstate: "6404" });
    const cst = await product("av-cst", { cstCsosn: "00" });
    const gtin = await product("av-gtin", { gtin: "7891234567890" });
    const ok = await product("av-ok", { gtin: "7891000315507" });
    const built = await buildNfe(ctx, { ...nfeInput(ncm.s.id), items: [ncm, st, cst, gtin, ok].map((x) => ({ skuId: x.s.id, qty: 1000, unitPrice: 1000, discount: 0 })), payments: [{ kind: "boleto", amount: 5000 }] });
    const w = built.warnings.join("\n");
    expect(w).toMatch(/Item 1 \(AV-NCM\): NCM 00000000 não existe.*778/);
    expect(w).toMatch(/Item 2 \(AV-ST\): .*sem CEST — rejeição 806/);
    expect(w).toMatch(/Item 3 \(AV-CST\): CST 00 .*Simples Nacional.*590/);
    expect(w).toMatch(/Item 4 \(AV-GTIN\): GTIN\/EAN 7891234567890 .*611/);
    expect(w).not.toMatch(/Item 5/);
    // avisos não são pendências: nada disso bloqueia a transmissão
    expect(built.issues.join(" ")).not.toMatch(/778|806|590|611/);
    // CFOP × destino: cliente de outra UF com CFOP interno sobreposto
    const c = refs.customers.mercado;
    const inter = await buildNfe(ctx, nfeInput(ok.s.id, { recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: { ...c.addresses[0], uf: "RJ", cityCode: "3304557" } }, items: [{ skuId: ok.s.id, qty: 2000, unitPrice: 5000, discount: 0, cfop: "5102" }] }));
    expect(inter.warnings.join(" ")).toMatch(/CFOP 5102 incompatível com destinatário em outra UF \(SP → RJ\); o esperado é 6xxx — rejeição 524/);
    const intra = await buildNfe(ctx, nfeInput(ok.s.id, { items: [{ skuId: ok.s.id, qty: 2000, unitPrice: 5000, discount: 0, cfop: "6102" }] }));
    expect(intra.warnings.join(" ")).toMatch(/CFOP 6102 incompatível com destinatário na mesma UF \(SP\).*523/);
    expect(intra.issues).toEqual([]);
    // documento salvo: aviso disponível no detalhe e transmissão segue (simulador)
    const doc = await saveNfe(ctx, nfeInput(ok.s.id, { items: [{ skuId: ok.s.id, qty: 2000, unitPrice: 5000, discount: 0, cfop: "6102" }] }), { idemKey: `av-doc-${++seq}`, transmit: true });
    expect(doc.status).toBe("processing");
    expect((await currentWarnings(ctx, doc)).join(" ")).toMatch(/523/);
    // NFC-e: CFOP fora de 5xxx
    const nfce = validateWarnings({ model: "nfce", items: [{ seq: 1, code: "X", ncm: "61091000", cfop: "6102", cstCsosn: "102" }] } as any, { regime: "simples" } as any, refs.branches.matriz);
    expect(nfce.join(" ")).toMatch(/NFC-e só admite operação interna.*725/);
    expect(validateDocument({ model: "nfce", items: [{ seq: 1, code: "X", ncm: "61091000", cfop: "5102", cstCsosn: "102", qty: 1000 }] } as any, await store.getOrThrow("companies", companyId()), refs.branches.matriz)).toEqual([]);
  });

  it("com adesão: item sem CST/cClassTrib do IBS/CBS, cClassTrib ausente e CST não calculado viram avisos; sem adesão, nenhum aviso da reforma", async () => {
    const ctx = await adminCtx();
    const none = await product("av-rt-none", {}, {});
    const noClass = await product("av-rt-noclass", {}, { ibsCbsCst: "000", ...TEST_RATES_2026 });
    const dif = await product("av-rt-510", {}, { ibsCbsCst: "510", cClassTrib: "510001" });
    const input = { ...nfeInput(none.s.id), items: [none, noClass, dif].map((x) => ({ skuId: x.s.id, qty: 1000, unitPrice: 1000, discount: 0 })), payments: [{ kind: "boleto", amount: 3000 }] };
    expect((await buildNfe(ctx, input)).warnings.join(" ")).not.toMatch(/IBS\/CBS/);
    await setReform(true, true);
    try {
      const w = (await buildNfe(ctx, input)).warnings.join("\n");
      expect(w).toMatch(/Item 1 \(AV-RT-NONE\): empresa aderiu à reforma tributária, mas o item não tem CST\/cClassTrib/);
      expect(w).toMatch(/Item 2 \(AV-RT-NOCLASS\): cClassTrib do IBS\/CBS ausente \(CST 000\)/);
      expect(w).toMatch(/Item 3 \(AV-RT-510\): CST 510 do IBS\/CBS exige grupo específico/);
      expect((await buildNfe(ctx, input)).issues).toEqual([]);
    } finally {
      await setReform(false, false);
    }
  });

  it("“Atualizar do cadastro” recalcula os grupos depois da adesão", async () => {
    const ctx = await adminCtx();
    const { s } = await product("rt-refresh", {}, { ibsCbsCst: "000", cClassTrib: "000001", ...TEST_RATES_2026 });
    const doc = await saveNfe(ctx, nfeInput(s.id), { idemKey: `rt-refresh-${++seq}`, transmit: false });
    expect(doc.items[0].ibsCbs).toBeUndefined();
    await setReform(true, true);
    try {
      expect((await currentWarnings(ctx, doc)).join(" ")).toMatch(/não tem CST\/cClassTrib/);
      const r = await refreshFromCatalog(ctx, doc.id);
      expect(r.doc.items[0].ibsCbs).toMatchObject({ cst: "000", base: 10000, cbs: 90, ibsUf: 10 });
      expect(r.doc.totals).toEqual(doc.totals);
    } finally {
      await setReform(false, false);
    }
  });
});

describe("ajuda: glossário fiscal (PLA-08), catálogo de rejeições (FIS-27) e parâmetro", () => {
  it("glossário cobre os termos fiscais e da reforma", () => {
    const terms = FISCAL_GLOSSARY.map((g) => g.term).join(" | ");
    for (const t of ["CFOP", "CST (ICMS)", "CSOSN", "NCM", "CEST", "MVA", "ST", "DIFAL", "IBS", "CBS", "IS", "cClassTrib", "CRT", "GTIN"]) expect(terms).toContain(t);
    const art = HELP_ARTICLES.find((a) => a.slug === "glossario-fiscal")!;
    expect(art.area).toBe("fiscal");
    for (const g of FISCAL_GLOSSARY) expect(art.body).toContain(g.term);
  });

  it("catálogo de rejeições com código, causa provável e como resolver; artigo e busca por código", () => {
    const codes = SEFAZ_REJECTIONS.map((r) => r.code);
    for (const c of ["204", "225", "233", "523", "524", "590", "591", "611", "778", "806", "1115"]) expect(codes).toContain(c);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of SEFAZ_REJECTIONS) expect(r.cause.length > 10 && r.fix.length > 10 && r.message.length > 5).toBe(true);
    expect(rejectionHelp("778")?.message).toMatch(/NCM inexistente/);
    expect(rejectionHelp(806)?.fix).toMatch(/CEST/);
    expect(rejectionHelp("000")).toBeNull();
    const art = HELP_ARTICLES.find((a) => a.slug === "rejeicoes-comuns-sefaz")!;
    for (const r of SEFAZ_REJECTIONS) expect(art.body).toContain(`**${r.code} — `);
    const rt = HELP_ARTICLES.find((a) => a.slug === "reforma-tributaria-ibs-cbs")!;
    expect(rt.body).toMatch(/validar|Valide a classificação com a contabilidade e emita primeiro em homologação/);
  });

  it("parâmetro feature.reformaTributaria no catálogo, desligado por padrão", () => {
    const p = PARAMS.find((x) => x.key === "feature.reformaTributaria");
    expect(p).toMatchObject({ group: "Recursos", type: "bool", default: false });
    expect(FEATURE_DEFAULTS.reformaTributaria).toBe(false);
  });
});
