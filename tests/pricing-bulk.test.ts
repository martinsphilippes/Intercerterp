import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { today } from "@/lib/dates";
import { marginBps } from "@/lib/money";
import { setSetting } from "@/lib/core/settings";
import { createProduct } from "@/domain/products";
import { importNfeXml, updateReceipt, confirmReceipt } from "@/domain/receipts";
import { buildSampleNfeXml } from "@/domain/nfe-xml";
import {
  ITEMS_PER_TX, MAX_TX_OPS, PRICE_OPS_PER_ITEM, applyPriceChanges, commercialRound, previewPriceChanges, previewPriceRule, priceFromMargin, priceFromMarkup, rulePrice, runIdempotentBatches,
} from "@/domain/price-adjust";
import { applyFieldChange, previewFieldChange } from "@/domain/product-bulk";
import { applyReceiptPricing, receiptPricing } from "@/domain/receipt-pricing";
import { labelItems, parseLabelParam, receiptLabelRequests, searchLabelSkus } from "@/domain/labels";
import { code128Values, ean13Modules, isEan13 } from "@/lib/barcode";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { PARAM_MAP } from "@/app/(app)/administracao/parametros/catalog";

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let stockist: Ctx;
let cashier: Ctx;
let varejo: string;

const MATRIZ_CNPJ = "11222333000181";
const TEXTIL_CNPJ = "45997418000153";

async function priceOf(skuKey: string, tableId = varejo) {
  const p = (await listAll(store, "prices", { filters: [["eq", "skuId", refs.skus[skuKey].id], ["eq", "priceTableId", tableId]] })).find((x) => !x.branchId && !x.validFrom);
  return p?.price ?? null;
}

async function history(skuId: string, field = "price") {
  return (await listAll(store, "price_history", { filters: [["eq", "skuId", skuId]] })).filter((h) => h.field === field);
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  varejo = refs.priceTables.varejo.id;
}, 120000);

describe("cálculos do motor de preço", () => {
  it("arredondamento comercial: para cima (padrão) e para o mais próximo", () => {
    expect(commercialRound(1013, "90")).toBe(1090);
    expect(commercialRound(1095, "90")).toBe(1190);
    expect(commercialRound(1095, "90", "nearest")).toBe(1090);
    expect(commercialRound(1050, "99", "nearest")).toBe(1099);
    expect(commercialRound(1000, "99")).toBe(1099);
    expect(commercialRound(1001, "00")).toBe(1100);
    expect(commercialRound(1000, "00")).toBe(1000);
    expect(commercialRound(1234, "none")).toBe(1234);
    expect(commercialRound(0, "90")).toBe(0);
  });

  it("preço pela margem (sobre o preço) e pelo markup (sobre o custo) — inverso de priceMetrics", () => {
    expect(priceFromMargin(700, 3000)).toBe(1000);
    expect(marginBps(1000, 700)).toBe(3000);
    expect(priceFromMarkup(1000, 5000)).toBe(1500);
    expect(priceFromMargin(0, 3000)).toBeNull();
    expect(() => priceFromMargin(100, 10000)).toThrow(/margem/i);
    expect(rulePrice({ kind: "percent", percentBps: 1000 }, { cost: 100, currentPrice: 3490 }).price).toBe(3839);
    expect(rulePrice({ kind: "percent", percentBps: 1000 }, { cost: 100, currentPrice: null }).price).toBeNull();
    // manter a margem: margem do preço atual sobre o custo anterior aplicada ao custo novo
    const keep = rulePrice({ kind: "keep_margin", fallbackMarginBps: 3000 }, { cost: 1900, currentPrice: 4490, oldCost: 1500 });
    expect(keep.price).toBe(priceFromMargin(1900, marginBps(4490, 1500)!));
    expect(rulePrice({ kind: "keep_margin", fallbackMarginBps: 3000 }, { cost: 700, currentPrice: null, oldCost: 600 }).price).toBe(1000);
  });

  it("lote de preço cabe no limite de 100 escritas por transação", () => {
    expect(ITEMS_PER_TX * PRICE_OPS_PER_ITEM + 1).toBeLessThanOrEqual(MAX_TX_OPS);
  });
});

describe("prévia × aplicação (alteração em massa de preços)", () => {
  it("prévia não grava nada e mostra margem antes/depois e variação", async () => {
    const before = (await listAll(store, "price_history")).length;
    const r = await previewPriceRule(manager, { via: "products.bulk_edit", skuIds: [refs.skus["caneca-u"].id, refs.skus["vela-u"].id], priceTableId: varejo, rule: { kind: "percent", percentBps: 1000 }, ending: "90" });
    const caneca = r.lines.find((l) => l.skuId === refs.skus["caneca-u"].id)!;
    expect(caneca.currentPrice).toBe(3490);
    expect(caneca.newPrice).toBe(3890); // 3490 + 10% = 3839 → ,90
    expect(caneca.marginBefore).toBe(marginBps(3490, 1250));
    expect(caneca.marginAfter).toBe(marginBps(3890, 1250));
    expect(caneca.variationBps).toBe(1146);
    expect(caneca.status).toBe("change");
    expect(r.totals.change).toBe(2);
    expect(await priceOf("caneca-u")).toBe(3490);
    expect((await listAll(store, "price_history")).length).toBe(before);
  });

  it("aplica com histórico e auditoria; repetir a mesma chave não regrava (idempotente)", async () => {
    const sku = refs.skus["caneca-u"].id;
    const res = await applyPriceChanges(manager, { via: "products.bulk_edit", priceTableId: varejo, lines: [{ skuId: sku, newPrice: 3890, expectedPrice: 3490 }], reason: "Alteração em massa — reajuste de +10%", idemKey: "t-bulk-1" });
    expect(res.applied).toBe(1);
    expect(await priceOf("caneca-u")).toBe(3890);
    const h = await history(sku);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ oldValue: 3490, newValue: 3890, reason: "Alteração em massa — reajuste de +10%" });
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "action", "price.bulk_adjust"]] });
    expect(logs.some((l) => l.entityId === res.jobId && /1 preço\(s\) alterado/.test(l.summary))).toBe(true);
    const again = await applyPriceChanges(manager, { via: "products.bulk_edit", priceTableId: varejo, lines: [{ skuId: sku, newPrice: 3890, expectedPrice: 3490 }], reason: "Alteração em massa — reajuste de +10%", idemKey: "t-bulk-1" });
    expect(again.replayed).toBe(true);
    expect(again.applied).toBe(1);
    expect(await history(sku)).toHaveLength(1);
  });

  it("preço alterado depois da prévia: linha ignorada", async () => {
    const res = await applyPriceChanges(manager, { via: "products.bulk_edit", priceTableId: varejo, lines: [{ skuId: refs.skus["caneca-u"].id, newPrice: 4290, expectedPrice: 3490 }], reason: "Reajuste", idemKey: "t-bulk-stale" });
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.lines[0].message).toMatch(/mudou desde a prévia/);
    expect(await priceOf("caneca-u")).toBe(3890);
  });

  it("linha inválida (atacado acima do novo preço) não impede as demais", async () => {
    const pv = await previewPriceChanges(manager, { via: "products.bulk_edit", priceTableId: varejo, lines: [{ skuId: refs.skus["meia-u"].id, newPrice: 2000 }] });
    expect(pv.lines[0].status).toBe("error");
    expect(pv.lines[0].message).toMatch(/atacado/);
    const res = await applyPriceChanges(manager, {
      via: "products.bulk_edit", priceTableId: varejo, reason: "Teste de lote com erro", idemKey: "t-bulk-mixed",
      lines: [{ skuId: refs.skus["meia-u"].id, newPrice: 2000, expectedPrice: 2990 }, { skuId: refs.skus["vela-u"].id, newPrice: 4590, expectedPrice: 4290 }],
    });
    expect(res.errors).toBe(1);
    expect(res.applied).toBe(1);
    expect(await priceOf("meia-u")).toBe(2990);
    expect(await priceOf("vela-u")).toBe(4590);
  });

  it("aplicação em lotes ≤ 100 escritas por transação (30 SKUs → 2 lotes)", async () => {
    const skuIds: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const p = await createProduct(admin, { type: "product", name: `Item de lote ${i}`, unitCode: "UN", ncm: "61091000" }, { idemKey: `t-lote-${i}`, costAcquisition: 1000, price: 2000 });
      const sku = (await listAll(store, "skus", { filters: [["eq", "productId", p.id]] }))[0];
      skuIds.push(sku.id);
    }
    const pv = await previewPriceRule(manager, { via: "products.bulk_edit", skuIds, priceTableId: varejo, rule: { kind: "markup", markupBps: 15000 }, ending: "99" });
    expect(pv.lines.every((l) => l.newPrice === 2599)).toBe(true); // 1000 × 2,5 = 2500 → ,99
    const res = await applyPriceChanges(manager, { via: "products.bulk_edit", priceTableId: varejo, lines: pv.lines.map((l) => ({ skuId: l.skuId, newPrice: l.newPrice!, expectedPrice: l.currentPrice })), reason: "Markup 150%", idemKey: "t-bulk-30" });
    expect(res.applied).toBe(30);
    const markers = (await listAll(store, "operations", { filters: [["eq", "entityId", res.jobId]] })).filter((o) => o.type === "price.adjust.batch");
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.result.keys.length).sort((a: number, b: number) => a - b)).toEqual([6, 24]);
    for (const id of skuIds) expect((await history(id)).filter((h) => h.reason === "Markup 150%")).toHaveLength(1);
  });

  it("runIdempotentBatches: marcador por lote impede reaplicação", async () => {
    let calls = 0;
    const items = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}` }));
    const job = "t-runner-job";
    const r1 = await runIdempotentBatches(admin, { jobId: job, type: "test.batch", items, perTx: 3, opsPerItem: 1, apply: async () => void calls++ });
    expect(calls).toBe(7);
    expect([...r1.values()].every((o) => o.ok && !o.replayed)).toBe(true);
    const r2 = await runIdempotentBatches(admin, { jobId: job, type: "test.batch", items, perTx: 3, opsPerItem: 1, apply: async () => void calls++ });
    expect(calls).toBe(7);
    expect([...r2.values()].every((o) => o.replayed)).toBe(true);
    await expect(runIdempotentBatches(admin, { jobId: "x", type: "t", items, perTx: 30, opsPerItem: 4, apply: async () => undefined })).rejects.toThrow(/limite/);
  });

  it("permissão negada sem a operação especial (prévia e aplicação)", async () => {
    await expect(previewPriceRule(cashier, { via: "products.bulk_edit", skuIds: [refs.skus["caneca-u"].id], priceTableId: varejo, rule: { kind: "percent", percentBps: 500 } })).rejects.toThrow(/permissão/);
    await expect(applyPriceChanges(stockist, { via: "products.bulk_edit", priceTableId: varejo, lines: [{ skuId: refs.skus["caneca-u"].id, newPrice: 100, expectedPrice: 3890 }], reason: "x", idemKey: "t-deny" })).rejects.toThrow(/permissão/);
    await expect(applyPriceChanges(stockist, { via: "purchase.pricing", priceTableId: varejo, lines: [{ skuId: refs.skus["caneca-u"].id, newPrice: 100, expectedPrice: 3890 }], reason: "x", idemKey: "t-deny2" })).rejects.toThrow(/permissão/);
    expect(await priceOf("caneca-u")).toBe(3890);
    expect(DEFAULT_ROLES.find((r) => r.key === "manager")!.actions).toEqual(expect.arrayContaining(["purchase.pricing", "products.bulk_edit"]));
    expect(DEFAULT_ROLES.find((r) => r.key === "admin")!.actions).toEqual(expect.arrayContaining(["purchase.pricing", "products.bulk_edit"]));
  });
});

describe("alteração em massa de campos cadastrais", () => {
  it("prévia e aplicação da marca; serviços ignorados no NCM; repetição idempotente", async () => {
    const ids = [refs.products.caneca.id, refs.products.vela.id];
    const brandId = (await listAll(store, "brands")).find((b) => b.name === "VoltTech")!.id;
    const pv = await previewFieldChange(manager, { productIds: ids, field: "brandId", value: brandId });
    expect(pv.totals.change).toBe(2);
    expect(pv.lines[0]).toMatchObject({ currentLabel: "Casa Bela", newLabel: "VoltTech" });
    expect((await store.getOrThrow("products", ids[0])).brandId).not.toBe(brandId);
    const res = await applyFieldChange(manager, { productIds: ids, field: "brandId", value: brandId, idemKey: "t-field-1" });
    expect(res.applied).toBe(2);
    const caneca = await store.getOrThrow("products", ids[0]);
    expect(caneca.brandId).toBe(brandId);
    expect(caneca.searchText).toMatch(/volttech/);
    const again = await applyFieldChange(manager, { productIds: ids, field: "brandId", value: brandId, idemKey: "t-field-1" });
    expect(again.replayed).toBe(true);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "action", "product.bulk_edit"]] }))).toHaveLength(1);
    const ncm = await previewFieldChange(manager, { productIds: [refs.products.ajuste.id, refs.products.caneca.id], field: "ncm", value: "6912.00.00" });
    expect(ncm.lines.find((l) => l.productId === refs.products.ajuste.id)!.status).toBe("skip");
    expect(ncm.lines.find((l) => l.productId === refs.products.caneca.id)!.status).toBe("same");
    await expect(previewFieldChange(manager, { productIds: ids, field: "ncm", value: "123" })).rejects.toThrow(/8 dígitos/);
  });

  it("inativar em massa e permissão negada", async () => {
    const res = await applyFieldChange(manager, { productIds: [refs.products.vela.id], field: "active", value: false, idemKey: "t-field-inactive" });
    expect(res.applied).toBe(1);
    expect((await store.getOrThrow("products", refs.products.vela.id)).status).toBe("inactive");
    await expect(applyFieldChange(stockist, { productIds: [refs.products.vela.id], field: "active", value: true, idemKey: "t-field-deny" })).rejects.toThrow(/permissão/);
  });
});

describe("precificação após a entrada (recebimento concluído)", () => {
  let receiptId: string;

  it("sugere pelo custo de entrada e pela margem atual; aplica e marca o recebimento", async () => {
    // 10 bonés a R$ 18,00 + frete R$ 10,00 → custo de entrada R$ 19,00 (antes R$ 15,00; preço R$ 44,90)
    const xml = buildSampleNfeXml({ number: 8801, issueDate: today(), environment: "producao", emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE ABA CURVA", qCom: 10000, vUnCom: 1800 }], freight: 1000 });
    const r = await importNfeXml(stockist, { xml, orderIds: [] });
    receiptId = r.id;
    await expect(receiptPricing(manager, r.id)).rejects.toThrow(/ainda não foi concluído/);
    await updateReceipt(stockist, r.id, { checkAll: true, notes: "Compra sem pedido (teste)" });
    await confirmReceipt(stockist, r.id);
    const data = await receiptPricing(manager, r.id);
    expect(data.receipt.pricingStatus).toBe("pending");
    const line = data.lines.find((l) => l.skuId === refs.skus["bone-u"].id)!;
    expect(line.oldCost).toBe(1500);
    expect(line.entryCost).toBe(1900);
    expect(line.cost).toBe(1900);
    expect(line.currentPrice).toBe(4490);
    expect(line.marginBeforeEntry).toBe(marginBps(4490, 1500));
    expect(line.marginBefore).toBe(marginBps(4490, 1900));
    expect(line.suggestedPrice).toBe(priceFromMargin(1900, marginBps(4490, 1500)!));
    expect(line.qty).toBe(10000);
    // margem padrão (parâmetro) e arredondamento
    await setSetting(store, refs.company.id, null, "pricing.defaultMarginBps", 4000);
    const target = await receiptPricing(manager, r.id, { mode: "target_margin", ending: "90" });
    expect(target.lines[0].suggestedPrice).toBe(commercialRound(priceFromMargin(1900, 4000)!, "90")); // 3166,67 → 3190
    expect(target.lines[0].suggestedPrice).toBe(3190);
    // permissão: estoquista recebe mas não precifica
    await expect(receiptPricing(stockist, r.id)).rejects.toThrow(/permissão/);
    const applied = await applyReceiptPricing(manager, r.id, { priceTableId: varejo, lines: [{ skuId: line.skuId, newPrice: 5690, expectedPrice: 4490 }], idemKey: "t-rp-1" });
    expect(applied.applied).toBe(1);
    expect(await priceOf("bone-u")).toBe(5690);
    const h = (await history(line.skuId)).find((x) => x.newValue === 5690)!;
    expect(h.reason).toMatch(/Precificação após a entrada — recebimento nº/);
    const rec = await store.getOrThrow("receipts", r.id);
    expect(rec.pricingStatus).toBe("done");
    expect(rec.pricedBy).toBe(manager.user.id);
    const again = await applyReceiptPricing(manager, r.id, { priceTableId: varejo, lines: [{ skuId: line.skuId, newPrice: 5690, expectedPrice: 4490 }], idemKey: "t-rp-1" });
    expect(again.replayed).toBe(true);
    expect((await history(line.skuId)).filter((x) => x.newValue === 5690)).toHaveLength(1);
    // só itens do próprio recebimento
    await expect(applyReceiptPricing(manager, r.id, { priceTableId: varejo, lines: [{ skuId: refs.skus["caneca-u"].id, newPrice: 5000, expectedPrice: 3890 }], idemKey: "t-rp-2" })).rejects.toThrow(/itens deste recebimento/);
  });

  it("etiquetas a partir do recebimento: uma por unidade recebida, com o novo preço", async () => {
    const req = await receiptLabelRequests(manager, receiptId);
    expect(req.items).toEqual([{ skuId: refs.skus["bone-u"].id, copies: 10 }]);
    const items = await labelItems(manager, { items: req.items, priceTableId: varejo });
    expect(items[0]).toMatchObject({ sku: "BONE", barcode: "7891000500019", price: 5690, copies: 10 });
  });
});

describe("etiquetas e código de barras", () => {
  it("parâmetro da URL, busca e limites", async () => {
    expect(parseLabelParam("abc:3,abc:2,../x:9,def:0")).toEqual([{ skuId: "abc", copies: 5 }, { skuId: "def", copies: 1 }]);
    const found = await searchLabelSkus(manager, { q: "caneca" });
    expect(found.map((f) => f.sku)).toContain("CANECA");
    await expect(searchLabelSkus(manager, {})).rejects.toThrow(/Digite/);
    await expect(labelItems(manager, { items: [{ skuId: refs.skus["caneca-u"].id, copies: 2001 }] })).rejects.toThrow(/No máximo/);
  });

  it("EAN-13 e Code 128", () => {
    expect(isEan13("7891000500019")).toBe(true);
    expect(isEan13("7891000500018")).toBe(false);
    const { modules, guards } = ean13Modules("7891000500019");
    expect(modules).toHaveLength(95);
    expect(modules.slice(0, 3)).toBe("101");
    expect(modules.slice(45, 50)).toBe("01010");
    expect(guards.filter(Boolean)).toHaveLength(11);
    expect(code128Values("ABC")).toEqual([104, 33, 34, 35, 1, 106]);
    expect(code128Values("1234")).toEqual([105, 12, 34, (105 + 12 + 68) % 103, 106]);
  });

  it("recursos novos registrados no catálogo de parâmetros (padrão ligado)", () => {
    for (const k of ["feature.precificacaoEntrada", "feature.alteracaoMassa", "feature.etiquetas"]) expect(PARAM_MAP[k]?.default).toBe(true);
    expect(PARAM_MAP["pricing.defaultMarginBps"].default).toBe(3000);
  });
});
