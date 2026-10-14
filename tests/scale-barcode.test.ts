import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { seed as seedScale, SCALE_DEMO_LABELS } from "@/domain/seed/modules/scale";
import { detId, listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { lineTotal, QTY } from "@/lib/money";
import { setSetting } from "@/lib/core/settings";
import { readFile } from "@/lib/core/files";
import { isValidGtin } from "@/domain/products";
import { calcSale } from "@/domain/pricing-calc";
import { cartTotals } from "@/domain/cart-calc";
import { openSession } from "@/domain/cash";
import { cartToSaleInput, ensureOpenCart, saveCart } from "@/domain/carts";
import { finalizeSale } from "@/domain/sales";
import { buildScaleBarcode, ean13CheckDigit, isValidEan13, parseScaleBarcode, qtyForLabelValue } from "@/domain/scale-barcode";
import { FILIZOLA_LINE, TOLEDO_LINE, buildScaleFile, filizolaLine, scaleText, toledoLine } from "@/domain/scale-files";
import { generateScaleLoad, listScaleProducts, resolveScaleBarcode, saveScaleData, skuForScaleBarcode } from "@/domain/scale";

/**
 * Fase 6 — balança etiquetadora: código de barras de peso/valor no PDV (PDV-06) e dados/carga da balança (CAD-16).
 * Regra de arredondamento da venda inalterada: total da linha = arredondar(preço da tabela × quantidade).
 */

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let cashier: Ctx;
let terminalId: string;

const sku = (k: string) => refs.skus[k].id;
const scaleSku = (key: string) => detId("demo", "skus", `${key}-u`);
const scaleProduct = (key: string) => detId("demo", "products", key);
const resolve = (code: string, priceTableId: string | null = null) => resolveScaleBarcode(store, { companyId: refs.company.id, branchId: refs.branches.matriz.id, priceTableId, code });

/** Lança as etiquetas no atendimento (como o PDV: uma linha por etiqueta) e conclui a venda paga em dinheiro. */
async function sellLabels(codes: string[]) {
  const lines = [];
  for (const c of codes) {
    const r = await resolve(c);
    if (!r || !r.ok) throw new Error(`etiqueta não resolvida: ${c}`);
    lines.push({ skuId: r.skuId, qty: r.qty, listPrice: r.unitPrice, scale: { barcode: r.barcode, content: r.content, labelValue: r.labelValue } });
  }
  const cart = (await ensureOpenCart(cashier, terminalId))!;
  const saved = await saveCart(cashier, cart.id, { items: lines });
  const total = cartTotals(saved).total;
  const sale = await finalizeSale(cashier, cartToSaleInput(saved, [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }]));
  const items = (await listAll(store, "sale_items", { filters: [["eq", "saleId", sale.id]] })).sort((a, b) => a.seq - b.seq);
  return { sale, items, saved };
}

beforeEach(async () => {
  store = freshStore();
  refs = await seedBase(store);
  await seedScale(refs);
  admin = await refs.ctxFor("admin", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  terminalId = refs.terminals.cx1.id;
  await openSession(cashier, { terminalId, openingFund: 10000 });
});

describe("parseScaleBarcode — layouts, peso e valor", () => {
  it("DV EAN-13 igual ao do GTIN e etiquetas montadas nos três layouts", () => {
    expect(ean13CheckDigit("789100010001")).toBe(1);
    for (const l of ["4", "5", "6"]) {
      const code = buildScaleBarcode(123, 1234, l);
      expect(code).toHaveLength(13);
      expect(code[0]).toBe("2");
      expect(isValidEan13(code)).toBe(true);
      expect(isValidGtin(code)).toBe(true);
    }
    expect(buildScaleBarcode(101, 750, "4")).toBe("2010100007500"); // 2 0101 0 000750 0
    expect(buildScaleBarcode(101, 750, "5")).toBe("2001010007506"); // 2 00101 0 00750 6
    expect(buildScaleBarcode(101, 750, "6")).toBe("2000101007500"); // 2 000101 00750 0
    expect(() => buildScaleBarcode(10000, 1, "4")).toThrow();
  });

  it("peso: PLU e gramas (milésimos de kg) em cada layout", () => {
    expect(parseScaleBarcode("2010100007500", { layout: "4", content: "weight" })).toMatchObject({ ok: true, plu: 101, weight: 750, value: null, content: "weight" });
    expect(parseScaleBarcode("2001010007506", { layout: "5", content: "weight" })).toMatchObject({ ok: true, plu: 101, weight: 750 });
    expect(parseScaleBarcode("2000101007500", { layout: "6", content: "weight" })).toMatchObject({ ok: true, plu: 101, weight: 750 });
    // layout 4 com 6 dígitos de valor: 123,456 kg
    expect(parseScaleBarcode(buildScaleBarcode(9999, 123456, "4"), { layout: "4" })).toMatchObject({ ok: true, plu: 9999, weight: 123456 });
    // a posição de preenchimento é ignorada (ex.: dígito de conferência do preço gravado pela balança)
    const first12 = "201015000750";
    expect(parseScaleBarcode(first12 + ean13CheckDigit(first12), { layout: "4" })).toMatchObject({ ok: true, plu: 101, weight: 750 });
  });

  it("valor: centavos da etiqueta", () => {
    const code = buildScaleBarcode(102, 1000, "5");
    expect(parseScaleBarcode(code, { layout: "5", content: "value" })).toMatchObject({ ok: true, plu: 102, value: 1000, weight: null, content: "value" });
  });

  it("DV inválido, código comum, PLU zero e quantidade zero são recusados", () => {
    expect(parseScaleBarcode("2010100007501", { layout: "4" })).toMatchObject({ ok: false, reason: "check_digit" });
    expect(parseScaleBarcode("7891000100011", { layout: "4" })).toMatchObject({ ok: false, reason: "not_scale" });
    expect(parseScaleBarcode("201010000750", { layout: "4" })).toMatchObject({ ok: false, reason: "not_scale" });
    expect(parseScaleBarcode("200000000750" + ean13CheckDigit("200000000750"), { layout: "4" })).toMatchObject({ ok: false, reason: "zero_plu" });
    expect(parseScaleBarcode(buildScaleBarcode(5, 0, "4"), { layout: "4" })).toMatchObject({ ok: false, reason: "zero_amount" });
  });

  it("quantidade do modo valor = valor ÷ preço arredondado ao milésimo", () => {
    expect(qtyForLabelValue(1000, 1690)).toBe(592); // 0,59171 → 0,592
    expect(qtyForLabelValue(3743, 4990)).toBe(750);
    expect(qtyForLabelValue(1000, 4990)).toBe(200); // 0,2004 → 0,200
  });
});

describe("leitura da etiqueta no PDV (resolveScaleBarcode)", () => {
  it("PLU inexistente, DV inválido e código comum", async () => {
    expect(await resolve(buildScaleBarcode(999, 500, "4"))).toMatchObject({ ok: false, code: "plu_not_found" });
    expect(await resolve("2010100007501")).toMatchObject({ ok: false, code: "check_digit" });
    expect(await resolve("7891000100011")).toBeNull(); // segue a busca normal por código de barras
  });

  it("venda com etiqueta de peso: quantidade = peso e total = arredondar(peso × preço/kg) pela regra atual", async () => {
    const r = await resolve(SCALE_DEMO_LABELS.mussarela750g);
    expect(r).toMatchObject({ ok: true, plu: 101, qty: 750, unitPrice: 4990, content: "weight", labelValue: null, difference: 0 });
    expect(r!.ok && r!.skuId).toBe(scaleSku("mussarela-kg"));
    // mesma etiqueta em duas leituras + pão: linhas separadas, cada uma com o total da regra atual
    const { sale, items, saved } = await sellLabels([SCALE_DEMO_LABELS.mussarela750g, SCALE_DEMO_LABELS.pao412g, SCALE_DEMO_LABELS.mussarela750g]);
    expect(saved.items[0].scale).toEqual({ barcode: SCALE_DEMO_LABELS.mussarela750g, content: "weight", labelValue: null });
    expect(items.map((i) => i.qty)).toEqual([750, 412, 750]);
    expect(items.map((i) => i.unitPrice)).toEqual([4990, 1690, 4990]);
    expect(items[0].total).toBe(lineTotal(4990, 750)); // 37,425 → 37,43
    expect(items[0].total).toBe(3743);
    expect(items[1].total).toBe(696); // 6,9628 → 6,96
    const expected = calcSale([{ qty: 750, unitPrice: 4990 }, { qty: 412, unitPrice: 1690 }, { qty: 750, unitPrice: 4990 }]);
    expect(sale.total).toBe(expected.total);
    expect(sale.total).toBe(3743 + 696 + 3743);
    // baixa de estoque em kg
    const bal = await store.get("stock_balances", detId("bal", refs.warehouses["matriz-main"].id, scaleSku("mussarela-kg")));
    expect(bal!.physical).toBe(20000 - 1500);
  });

  it("preço vem da tabela de preços, não do código (tabela/filial)", async () => {
    const r = await resolve(SCALE_DEMO_LABELS.pao412g, refs.priceTables.atacado.id);
    // sem preço na tabela Atacado → cai para a tabela padrão (regra de resolvePrices)
    expect(r).toMatchObject({ ok: true, unitPrice: 1690, qty: 412 });
  });

  it("modo valor: quantidade = valor ÷ preço/kg; total da linha confere ou mostra a diferença do arredondamento", async () => {
    await setSetting(store, refs.company.id, null, "scale.barcodeContent", "value");
    // R$ 37,43 de mussarela (R$ 49,90/kg) → 0,750 kg → 37,43 (fecha)
    const exact = await resolve(buildScaleBarcode(101, 3743, "4"));
    expect(exact).toMatchObject({ ok: true, content: "value", qty: 750, labelValue: 3743, lineTotal: 3743, difference: 0 });
    // R$ 10,00 de pão (R$ 16,90/kg) → 0,592 kg → 10,00 (fecha)
    const pao = await resolve(buildScaleBarcode(102, 1000, "4"));
    expect(pao).toMatchObject({ ok: true, qty: 592, lineTotal: 1000, difference: 0 });
    // R$ 10,00 de mussarela → 0,2004 kg → 0,200 kg → 9,98: a regra da venda não muda; a diferença é informada
    const off = await resolve(buildScaleBarcode(101, 1000, "4"));
    expect(off).toMatchObject({ ok: true, qty: 200, labelValue: 1000, lineTotal: 998, difference: -2 });
    expect(off!.ok && off!.message).toMatch(/total calculado R\$\s?9,98/);
    const { sale, items, saved } = await sellLabels([buildScaleBarcode(101, 1000, "4"), buildScaleBarcode(102, 1000, "4")]);
    expect(saved.items[0].scale).toEqual({ barcode: buildScaleBarcode(101, 1000, "4"), content: "value", labelValue: 1000 });
    expect(items.map((i) => i.total)).toEqual([998, 1000]);
    expect(sale.total).toBe(1998);
  });

  it("modo valor com atacado: a quantidade usa o preço que a venda aplicará", async () => {
    await setSetting(store, refs.company.id, null, "scale.barcodeContent", "value");
    const priceId = detId("demo", "prices", "varejo-pao-frances-kg-u");
    await store.update("prices", priceId, { wholesalePrice: 1500, wholesaleMinQty: 2000 });
    // R$ 40,00: 40/16,90 = 2,367 kg (≥ 2 kg → atacado) → 40/15,00 = 2,667 kg → total 40,01? arredondar(15,00 × 2,667) = 40,01
    const r = await resolve(buildScaleBarcode(102, 4000, "4"));
    expect(r).toMatchObject({ ok: true, unitPrice: 1500, qty: 2667 });
    expect(r!.ok && r!.lineTotal).toBe(lineTotal(1500, 2667));
  });

  it("peso exige produto em KG; produto inativo é recusado", async () => {
    await saveScaleData(admin, refs.products.bone.id, { plu: 300, shelfLifeDays: null, scaleTare: null, scaleEnabled: false, nutrition: null });
    expect(await resolve(buildScaleBarcode(300, 1000, "4"))).toMatchObject({ ok: false, code: "unit_not_kg" });
    await store.update("products", scaleProduct("pao-frances-kg"), { active: false, status: "inactive" });
    expect(await resolve(SCALE_DEMO_LABELS.pao412g)).toMatchObject({ ok: false, code: "product_inactive" });
  });

  it("recurso desligado (feature.balanca): o código volta a ser tratado como código de barras comum", async () => {
    await setSetting(store, refs.company.id, null, "feature.balanca", false);
    expect(await resolve(SCALE_DEMO_LABELS.mussarela750g)).toBeNull();
    expect(await skuForScaleBarcode(store, refs.company.id, refs.branches.matriz.id, SCALE_DEMO_LABELS.mussarela750g)).toBeNull();
    // religado só na filial
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "feature.balanca", true);
    expect(await resolve(SCALE_DEMO_LABELS.mussarela750g)).toMatchObject({ ok: true, qty: 750 });
  });

  it("formato configurado por parâmetro (layout de 5 dígitos)", async () => {
    await setSetting(store, refs.company.id, null, "scale.barcodeLayout", "5");
    expect(await resolve(buildScaleBarcode(101, 1250, "5"))).toMatchObject({ ok: true, plu: 101, qty: 1250 });
    // a etiqueta do layout 4 lida como layout 5 aponta outro PLU (1010) — inexistente
    expect(await resolve(SCALE_DEMO_LABELS.mussarela750g)).toMatchObject({ ok: false, code: "plu_not_found" });
  });
});

describe("dados de balança do produto (CAD-16)", () => {
  it("PLU duplicado é recusado (serviço e índice único)", async () => {
    await expect(saveScaleData(admin, refs.products.caneca.id, { plu: 101, shelfLifeDays: 5, scaleTare: null, scaleEnabled: true, nutrition: null })).rejects.toMatchObject({ code: "duplicate_plu" });
    await expect(store.update("products", refs.products.caneca.id, { plu: 101 })).rejects.toThrow(/duplicado/);
    // o próprio produto pode regravar o mesmo PLU
    await expect(saveScaleData(admin, scaleProduct("mussarela-kg"), { plu: 101, shelfLifeDays: 12, scaleTare: 10, scaleEnabled: true, nutrition: { portion: "30 g", kcal: "91", sodium: "174,5" } })).resolves.toMatchObject({
      plu: 101, shelfLifeDays: 12, scaleTare: 10, nutrition: { portion: "30 g", kcal: 91, sodium: 174.5, carbs: null },
    });
  });

  it("validações: PLU obrigatório para enviar à balança, faixa, variações, serviço e permissão", async () => {
    await expect(saveScaleData(admin, refs.products.caneca.id, { plu: null, shelfLifeDays: null, scaleTare: null, scaleEnabled: true, nutrition: null })).rejects.toThrow(/Informe o PLU/);
    await expect(saveScaleData(admin, refs.products.caneca.id, { plu: 1_000_000, shelfLifeDays: null, scaleTare: null, scaleEnabled: false, nutrition: null })).rejects.toThrow(/PLU deve/);
    await expect(saveScaleData(admin, refs.products.caneca.id, { plu: 7, shelfLifeDays: 1000, scaleTare: null, scaleEnabled: false, nutrition: null })).rejects.toThrow(/Validade/);
    await expect(saveScaleData(admin, refs.products.camiseta.id, { plu: 8, shelfLifeDays: null, scaleTare: null, scaleEnabled: false, nutrition: null })).rejects.toThrow(/variações/);
    await expect(saveScaleData(admin, refs.products.ajuste.id, { plu: 9, shelfLifeDays: null, scaleTare: null, scaleEnabled: false, nutrition: null })).rejects.toThrow(/Serviço/);
    await expect(saveScaleData(cashier, refs.products.caneca.id, { plu: 10, shelfLifeDays: null, scaleTare: null, scaleEnabled: false, nutrition: null })).rejects.toThrow();
    const audits = await listAll(store, "audit_logs", { filters: [["eq", "action", "product.scale_update"]] });
    expect(audits).toHaveLength(0);
  });
});

describe("arquivo de carga (Toledo ITENSMGV.TXT / Filizola CADTXT.TXT)", () => {
  const item = { plu: 101, name: "Queijo Mussarela Fatiado (kg) — açougue & frios especiais", byWeight: true, price: 4990, shelfLifeDays: 10 };

  it("Toledo: linha de 86 posições com campos nas larguras do layout", () => {
    const l = toledoLine(item);
    expect(l).toHaveLength(TOLEDO_LINE);
    expect(l.slice(0, 2)).toBe("01"); // departamento
    expect(l.slice(2, 3)).toBe("0"); // peso
    expect(l.slice(3, 9)).toBe("000101"); // PLU
    expect(l.slice(9, 15)).toBe("004990"); // R$ 49,90/kg
    expect(l.slice(15, 18)).toBe("010"); // validade
    expect(l.slice(18, 43)).toBe(scaleText("QUEIJO MUSSARELA FATIADO", 25));
    expect(l.slice(43, 68)).toBe("(KG) ACOUGUE & FRIOS ESPE");
    expect(l.slice(68, 84)).toBe("0".repeat(16));
    expect(l.slice(84, 86)).toBe("11");
    expect(toledoLine({ ...item, byWeight: false, shelfLifeDays: 0 }).slice(84, 86)).toBe("01");
    expect(toledoLine({ ...item, byWeight: false }).slice(2, 3)).toBe("1");
    expect(() => toledoLine({ ...item, price: 1_000_000 })).toThrow(/Preço/);
  });

  it("Filizola: linha de 39 posições", () => {
    const l = filizolaLine(item);
    expect(l).toHaveLength(FILIZOLA_LINE);
    expect(l.slice(0, 6)).toBe("000101");
    expect(l.slice(6, 7)).toBe("P");
    expect(l.slice(7, 29)).toBe("QUEIJO MUSSARELA FATIA");
    expect(l.slice(29, 36)).toBe("0004990");
    expect(l.slice(36, 39)).toBe("010");
    expect(filizolaLine({ ...item, byWeight: false }).slice(6, 7)).toBe("U");
  });

  it("arquivo: ordem por PLU, CRLF e só ASCII", () => {
    const f = buildScaleFile("filizola", [{ ...item, plu: 102, name: "Pão Francês" }, item]);
    expect(f.fileName).toBe("CADTXT.TXT");
    expect(f.lines.map((x) => x.slice(0, 6))).toEqual(["000101", "000102"]);
    expect(f.content.split("\r\n")).toHaveLength(3);
    expect(/^[\x20-\x7E\r\n]*$/.test(f.content)).toBe(true);
    expect(f.lines[1]).toContain("PAO FRANCES");
  });

  it("gera e grava a carga dos produtos habilitados (download pelo padrão de arquivos) e lista pendências", async () => {
    // caneca habilitada sem preço na tabela escolhida? tem preço — habilita com PLU 5 vendida por unidade
    await saveScaleData(admin, refs.products.caneca.id, { plu: 5, shelfLifeDays: 0, scaleTare: null, scaleEnabled: true, nutrition: null });
    const list = await listScaleProducts(admin);
    expect(list.rows.map((r) => r.plu)).toEqual([5, 101, 102]);
    expect(list.rows.every((r) => r.issues.length === 0)).toBe(true);
    expect(list.rows[0].warnings.join(" ")).toMatch(/UN/);
    const r = await generateScaleLoad(admin, { format: "toledo" });
    expect(r).toMatchObject({ fileName: "ITENSMGV.TXT", count: 3, skipped: [] });
    const { meta, data } = await readFile(admin, r.fileId);
    expect(meta.kind).toBe("scale_load");
    expect(meta.entityType).toBe("scale_load");
    const lines = data.toString("latin1").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.length === TOLEDO_LINE)).toBe(true);
    expect(lines.map((l) => l.slice(3, 9))).toEqual(["000005", "000101", "000102"]);
    expect(lines[1].slice(9, 15)).toBe("004990");
    expect(lines[2].slice(9, 15)).toBe("001690");
    expect(lines[0].slice(2, 3)).toBe("1"); // caneca: unitário
    const f = await generateScaleLoad(admin, { format: "filizola" });
    const fl = (await readFile(admin, f.fileId)).data.toString("latin1").split("\r\n").filter(Boolean);
    expect(fl.every((l) => l.length === FILIZOLA_LINE)).toBe(true);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "action", "scale.load_generate"]] }))).toHaveLength(2);
  });

  it("produto sem preço fica fora do arquivo; PLU duplicado bloqueia a carga; caixa não gera", async () => {
    await store.delete("prices", detId("demo", "prices", "varejo-pao-frances-kg-u"));
    const r = await generateScaleLoad(admin, { format: "toledo" });
    expect(r.count).toBe(1);
    expect(r.skipped).toEqual([{ name: "Pão Francês (kg)", reason: "Sem preço na tabela" }]);
    await expect(generateScaleLoad(cashier, { format: "toledo" })).rejects.toThrow();
    // duplicidade legada (antes do índice): a carga é recusada
    const raw = (store as any).coll("products") as Map<string, any>;
    raw.get(scaleProduct("pao-frances-kg")).plu = 101;
    const list = await listScaleProducts(admin);
    expect(list.duplicates).toEqual([101]);
    expect(list.rows.every((x) => x.issues.some((i) => /duplicado/.test(i)))).toBe(true);
    await expect(generateScaleLoad(admin, { format: "toledo" })).rejects.toMatchObject({ code: "duplicate_plu" });
  });

  it("nenhum produto habilitado: mensagem clara", async () => {
    await store.update("products", scaleProduct("mussarela-kg"), { scaleEnabled: false });
    await store.update("products", scaleProduct("pao-frances-kg"), { scaleEnabled: false });
    await expect(generateScaleLoad(admin, { format: "filizola" })).rejects.toThrow(/Nenhum produto habilitado/);
  });
});

describe("seed de demonstração da balança", () => {
  it("é idempotente e as etiquetas de exemplo resolvem", async () => {
    await seedScale(refs);
    const prods = (await listAll(store, "products", { filters: [["eq", "companyId", refs.company.id]] })).filter((p) => p.plu != null);
    expect(prods.map((p) => p.plu).sort()).toEqual([101, 102]);
    expect(prods.every((p) => p.unitCode === "KG" && p.scaleEnabled)).toBe(true);
    expect(await resolve(SCALE_DEMO_LABELS.pao412g)).toMatchObject({ ok: true, qty: 412, lineTotal: 696 });
    expect(QTY).toBe(1000);
    void sku;
  });
});
