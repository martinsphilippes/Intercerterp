import { describe, it, expect } from "vitest";
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { listAll, detId } from "@/lib/db";
import { resolvePrices, savePrice, priceMetrics, defaultPriceTableId } from "@/domain/pricing";
import { createProduct, saveVariants, saveSkuCosts, deleteProduct, setProductStatus, postInitialBalance, generateVariantCombos, isValidGtin, updateProduct, saveUnitConversion, convertQty, saveCategory, deleteCategory, savePriceTable, saveTaxGroup, saveBrand, saveStockParams } from "@/domain/products";
import { balanceId } from "@/domain/stock";
import { previewImport, runImport, parseCsv, guessMapping } from "@/domain/product-import";
import { addDays, today } from "@/lib/dates";

async function setup() {
  const store = freshStore();
  const refs = await seedBase(store);
  const ctx = await refs.ctxFor("admin", "matriz");
  return { store, refs, ctx };
}

describe("produtos — variações e preços", () => {
  it("gera combinações, preços padrão/atacado por quantidade, vigência e histórico", async () => {
    const { store, refs, ctx } = await setup();
    expect(generateVariantCombos([{ name: "Cor", values: ["Azul", "Verde"] }, { name: "Tamanho", values: ["P", "M", "G"] }])).toHaveLength(6);
    const p = await createProduct(
      ctx,
      { type: "product", name: "Jaqueta Corta-vento", unitCode: "UN", categoryId: refs.categories["Vestuário"].id, ncm: "62019300", origin: "0", taxGroupId: null },
      {
        axes: [{ name: "Cor", values: ["Azul", "Verde"] }, { name: "Tamanho", values: ["P", "M"] }],
        costAcquisition: 8000,
        additionalCosts: [{ name: "Frete", amount: 500 }],
        price: 19990,
        wholesalePrice: 16990,
        wholesaleMinQty: 10000,
        maxDiscountBps: 1000,
        idemKey: "teste-jaqueta",
      },
    );
    const skus = await listAll(store, "skus", { filters: [["eq", "productId", p.id]] });
    expect(skus).toHaveLength(4);
    expect(new Set(skus.map((s) => s.sku)).size).toBe(4);
    expect(skus.every((s) => s.costTotal === 8500)).toBe(true);
    // idempotência do cadastro (duplo envio)
    const again = await createProduct(ctx, { type: "product", name: "Jaqueta Corta-vento", unitCode: "UN" }, { idemKey: "teste-jaqueta" });
    expect(again.id).toBe(p.id);
    expect((await listAll(store, "products", { filters: [["eq", "name", "Jaqueta Corta-vento"]] })).length).toBe(1);

    const sku = skus[0];
    const [retail, wholesale] = await resolvePrices(store, { companyId: ctx.companyId, branchId: ctx.branchId, items: [{ skuId: sku.id, qty: 5000 }, { skuId: sku.id, qty: 10000 }] });
    expect(retail.price).toBe(19990);
    expect(retail.wholesale).toBe(false);
    expect(wholesale.price).toBe(16990);
    expect(wholesale.wholesale).toBe(true);
    expect(wholesale.listPrice).toBe(19990);
    expect(retail.maxDiscountBps).toBe(1000);

    // vigência: promoção futura não vale hoje; vale dentro do período; expirada não vale
    const table = (await defaultPriceTableId(store, ctx.companyId))!;
    const from = addDays(today(), 5);
    await savePrice(ctx, { priceTableId: table, skuId: sku.id, price: 14990, validFrom: from, validTo: addDays(from, 10), reason: "Promoção" });
    const [now] = await resolvePrices(store, { companyId: ctx.companyId, branchId: ctx.branchId, items: [{ skuId: sku.id, qty: 1000 }] });
    expect(now.price).toBe(19990);
    const [during] = await resolvePrices(store, { companyId: ctx.companyId, branchId: ctx.branchId, items: [{ skuId: sku.id, qty: 1000 }], date: addDays(from, 2) });
    expect(during.price).toBe(14990);
    const [after] = await resolvePrices(store, { companyId: ctx.companyId, branchId: ctx.branchId, items: [{ skuId: sku.id, qty: 1000 }], date: addDays(from, 30) });
    expect(after.price).toBe(19990);
    // preço específico da filial tem prioridade sobre o geral
    await savePrice(ctx, { priceTableId: table, skuId: sku.id, branchId: refs.branches.shopping.id, price: 21990 });
    const [shop] = await resolvePrices(store, { companyId: ctx.companyId, branchId: refs.branches.shopping.id, items: [{ skuId: sku.id, qty: 1000 }] });
    expect(shop.price).toBe(21990);

    // histórico: alteração de preço e de custo
    await savePrice(ctx, { priceTableId: table, skuId: sku.id, price: 20990, wholesalePrice: 16990, wholesaleMinQty: 10000 });
    await saveSkuCosts(ctx, sku.id, { costAcquisition: 9000, additionalCosts: [{ name: "Frete", amount: 500 }, { name: "Embalagem", amount: 150 }], reason: "Reajuste do fornecedor" });
    const hist = await listAll(store, "price_history", { filters: [["eq", "skuId", sku.id]] });
    expect(hist.some((h) => h.field === "price" && h.oldValue === 19990 && h.newValue === 20990)).toBe(true);
    expect(hist.some((h) => h.field === "costTotal" && h.oldValue === 8500 && h.newValue === 9650)).toBe(true);
    // margem e markup são métricas diferentes
    const m = priceMetrics(20990, 9650);
    expect(m.marginBps).toBe(5403); // (20990-9650)/20990
    expect(m.markupBps).toBe(11751); // (20990-9650)/9650

    // nova variação herda custo e preços da referência
    const axes = [{ name: "Cor", values: ["Azul", "Verde", "Preta"] }, { name: "Tamanho", values: ["P", "M"] }];
    const current = await listAll(store, "skus", { filters: [["eq", "productId", p.id]] });
    const variants = [...current.map((s) => ({ id: s.id, sku: s.sku, barcode: s.barcode, attributes: s.attributes })), { attributes: { Cor: "Preta", Tamanho: "P" } }, { attributes: { Cor: "Preta", Tamanho: "M" } }];
    const r = await saveVariants(ctx, p.id, { axes, variants });
    expect(r.created).toBe(2);
    const black = (await listAll(store, "skus", { filters: [["eq", "productId", p.id]] })).find((s) => s.attributes.Cor === "Preta")!;
    const [bp] = await resolvePrices(store, { companyId: ctx.companyId, branchId: ctx.branchId, items: [{ skuId: black.id, qty: 1000 }] });
    expect(bp.price).toBeGreaterThan(0);
    expect(black.costTotal).toBeGreaterThan(0);
  });

  it("valida GTIN, código único, regime fiscal e conversões de unidade", async () => {
    const { refs, ctx } = await setup();
    expect(isValidGtin("7891000100011")).toBe(true);
    expect(isValidGtin("7891000100012")).toBe(false);
    await expect(createProduct(ctx, { type: "product", name: "X", unitCode: "UN", gtin: "7891000100012" })).rejects.toThrow(/GTIN/);
    await expect(createProduct(ctx, { type: "product", name: "X", unitCode: "UN", code: "CANECA" })).rejects.toThrow(/código CANECA/);
    // empresa do Simples: CST de 2 dígitos é recusado; CSOSN aceito
    await expect(createProduct(ctx, { type: "product", name: "Y", unitCode: "UN", cstCsosn: "00" })).rejects.toThrow(/CSOSN/);
    const y = await createProduct(ctx, { type: "product", name: "Y", unitCode: "UN", cstCsosn: "102", ncm: "48202000", cfop: "5102" });
    expect(y.cstCsosn).toBe("102");
    // serviço guarda campos de ISS e descarta NCM
    const s = await createProduct(ctx, { type: "service", name: "Instalação", unitCode: "H", ncm: "12345678", serviceListItem: "14.01", municipalServiceCode: "01234", issRateBps: 300 });
    expect(s.ncm).toBeNull();
    expect(s.issRateBps).toBe(300);
    await expect(updateProduct(ctx, s.id, { issRateBps: 900 }, "fiscal")).rejects.toThrow(/ISS/);
    const conv = await saveUnitConversion(ctx, { productId: refs.products.caneta.id, fromUnit: "CX", toUnit: "UN", factor: 50000 });
    expect(convertQty(2000, "CX", "UN", [conv as any])).toBe(100000);
    expect(convertQty(100000, "UN", "CX", [conv as any])).toBe(2000);
  });

  it("exclui produto sem uso; com histórico só inativa; saldo inicial gera movimento identificado", async () => {
    const { store, refs, ctx } = await setup();
    const p = await createProduct(ctx, { type: "product", name: "Agenda 2027", unitCode: "UN" }, { price: 3990 });
    const sku = (await listAll(store, "skus", { filters: [["eq", "productId", p.id]] }))[0];
    const wh = refs.warehouses["matriz-main"];
    const mov = await postInitialBalance(ctx, { warehouseId: wh.id, skuId: sku.id, qty: 7000, unitCost: 1500 });
    expect(mov!.type).toBe("initial");
    expect(mov!.originType).toBe("product");
    const again = await postInitialBalance(ctx, { warehouseId: wh.id, skuId: sku.id, qty: 7000, unitCost: 1500 });
    expect(again!.id).toBe(mov!.id);
    expect((await listAll(store, "stock_movements", { filters: [["eq", "skuId", sku.id]] })).length).toBe(1);
    await expect(deleteProduct(ctx, p.id)).rejects.toThrow(/Inativar/);
    const inactive = await setProductStatus(ctx, p.id, false);
    expect(inactive.status).toBe("inactive");
    const q = await createProduct(ctx, { type: "product", name: "Produto sem uso", unitCode: "UN" }, { price: 1000, costAcquisition: 500 });
    await deleteProduct(ctx, q.id);
    expect(await store.get("products", q.id)).toBeNull();
    expect((await listAll(store, "skus", { filters: [["eq", "productId", q.id]] })).length).toBe(0);
  });

  it("cadastros auxiliares: hierarquia sem ciclo, exclusão só sem uso, tabela padrão única, grupo tributário por regime", async () => {
    const { store, refs, ctx } = await setup();
    const sub = await saveCategory(ctx, { name: "Camisetas", parentId: refs.categories["Vestuário"].id });
    await expect(saveCategory(ctx, { id: refs.categories["Vestuário"].id, name: "Vestuário", parentId: sub.id })).rejects.toThrow(/pai/);
    await expect(deleteCategory(ctx, refs.categories["Vestuário"].id)).rejects.toThrow(/em uso/);
    await deleteCategory(ctx, sub.id);
    const promo = await savePriceTable(ctx, { name: "Promoção", active: true, isDefault: true });
    const tables = await listAll(store, "price_tables", { filters: [["eq", "companyId", ctx.companyId]] });
    expect(tables.filter((t) => t.isDefault).map((t) => t.id)).toEqual([promo.id]);
    await expect(saveTaxGroup(ctx, { name: "Normal", regime: "normal", cstCsosn: "102" })).rejects.toThrow(/CST/);
    const tg = await saveTaxGroup(ctx, { name: "Normal 00", regime: "normal", cstCsosn: "00", cfopInternal: "5102", cfopInterstate: "6102", icmsRateBps: 1800 });
    expect(tg.icmsRateBps).toBe(1800);
  });
});

describe("produtos — isolamento e cadastro completo", () => {
  it("categoria e marca de outra empresa não são alteradas pelo id", async () => {
    const { store, ctx } = await setup();
    const cat = await store.create("categories", { companyId: "OTHER", name: "Alheia", status: "active" });
    const brand = await store.create("brands", { companyId: "OTHER", name: "Marca alheia", status: "active" });
    await expect(saveCategory(ctx, { id: cat.id, name: "HACK", status: "inactive" })).rejects.toThrow(/não encontrada/);
    await expect(saveBrand(ctx, { id: brand.id, name: "HACK", status: "inactive" })).rejects.toThrow(/não encontrada/);
    expect(await store.get("categories", cat.id)).toMatchObject({ name: "Alheia", status: "active" });
    expect(await store.get("brands", brand.id)).toMatchObject({ name: "Marca alheia", status: "active" });
    // a própria empresa continua editando normalmente
    const own = await saveBrand(ctx, { name: "Nova Marca" });
    expect((await saveBrand(ctx, { id: own.id, name: "Nova Marca 2" })).name).toBe("Nova Marca 2");
  });

  it("parâmetros de estoque recusam SKU de outra empresa", async () => {
    const { store, refs, ctx } = await setup();
    const wh = refs.warehouses["matriz-main"].id;
    const foreign = await store.create("skus", { companyId: "OTHER", productId: "p-other", sku: "ALHEIO", name: "SKU alheio", costTotal: 9999, active: true });
    await expect(saveStockParams(ctx, { warehouseId: wh, skuId: foreign.id, minQty: 1000, maxQty: 0, safetyQty: 0, reorderMultiple: 0 })).rejects.toThrow(/SKU/);
    expect(await store.get("stock_balances", balanceId(wh, foreign.id))).toBeNull();
  });

  it("sem tabela de preço padrão, nada é gravado; a repetição após corrigir completa o cadastro", async () => {
    const { store, ctx } = await setup();
    const table = (await defaultPriceTableId(store, ctx.companyId))!;
    await store.update("price_tables", table, { isDefault: false });
    const input = { type: "product" as const, name: "Garrafa Inox 1 L", unitCode: "UN" };
    const extras = { idemKey: "form-garrafa", price: 8990, costAcquisition: 3000 };
    await expect(createProduct(ctx, input, extras)).rejects.toThrow(/tabela de preço padrão/);
    expect(await listAll(store, "products", { filters: [["eq", "name", "Garrafa Inox 1 L"]] })).toHaveLength(0);
    expect(await listAll(store, "skus", { filters: [["eq", "name", "Garrafa Inox 1 L"]] })).toHaveLength(0);
    await store.update("price_tables", table, { isDefault: true });
    const p = await createProduct(ctx, input, extras);
    const skus = await listAll(store, "skus", { filters: [["eq", "productId", p.id]] });
    expect(skus).toHaveLength(1);
    expect(await listAll(store, "prices", { filters: [["eq", "productId", p.id]] })).toHaveLength(1);
  });

  it("sem permissão de saldo inicial, o produto não é criado pela metade", async () => {
    const { store, refs } = await setup();
    const fiscal = await refs.ctxFor("fiscal", "matriz"); // produtos: sim; estoque: não
    const wh = refs.warehouses["matriz-main"].id;
    await expect(createProduct(fiscal, { type: "product", name: "Produto do fiscal", unitCode: "UN" }, { idemKey: "f-1", price: 1000, stock: { warehouseId: wh, qty: 5000 } })).rejects.toThrow(/saldo inicial/);
    expect(await listAll(store, "products", { filters: [["eq", "name", "Produto do fiscal"]] })).toHaveLength(0);
    // sem o saldo inicial, cadastra (parâmetros zerados não exigem permissão de estoque)
    const p = await createProduct(fiscal, { type: "product", name: "Produto do fiscal", unitCode: "UN" }, { idemKey: "f-1", price: 1000, stock: { warehouseId: wh, qty: 0 } });
    expect(await listAll(store, "prices", { filters: [["eq", "productId", p.id]] })).toHaveLength(1);
  });

  it("repetição depois de queda no meio do cadastro completa preço, parâmetros e saldo inicial", async () => {
    const { store, refs, ctx } = await setup();
    const wh = refs.warehouses["matriz-main"].id;
    const input = { type: "product" as const, name: "Luminária LED", unitCode: "UN" };
    const extras = { idemKey: "form-lum", price: 12990, costAcquisition: 5000, stock: { warehouseId: wh, qty: 4000, minQty: 2000, maxQty: 10000 } };
    // queda simulada ao gravar o preço (depois de produto e SKU gravados)
    const orig = (store as any).create.bind(store);
    let armed = true;
    (store as any).create = async (c: string, d: any, id?: string) => {
      if (armed && c === "prices") {
        armed = false;
        throw new Error("Tempo esgotado");
      }
      return orig(c, d, id);
    };
    await expect(createProduct(ctx, input, extras)).rejects.toThrow(/Tempo esgotado/);
    delete (store as any).create;
    const p = await createProduct(ctx, input, extras);
    const skus = await listAll(store, "skus", { filters: [["eq", "productId", p.id]] });
    expect(skus).toHaveLength(1);
    expect(await listAll(store, "prices", { filters: [["eq", "productId", p.id]] })).toHaveLength(1);
    const b = (await store.get("stock_balances", balanceId(wh, skus[0].id)))!;
    expect(b.physical).toBe(4000);
    expect(b.minQty).toBe(2000);
    // terceira repetição não duplica nada
    await createProduct(ctx, input, extras);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "skuId", skus[0].id]] })).toHaveLength(1);
    expect(await listAll(store, "skus", { filters: [["eq", "productId", p.id]] })).toHaveLength(1);
  });
});

describe("importação CSV", () => {
  const csv = [
    "Código;SKU;Descrição;EAN;Unidade;Categoria;Marca;NCM;Custo;Preço;Estoque",
    "IMP001;IMP001;Garrafa Térmica 500 ml;7891234567895;UN;Casa;Casa Bela;73239900;25,00;59,90;10",
    "IMP002;IMP002;Toalha de Rosto;;UN;Casa Nova;Casa Bela;63026000;12,50;29,90;",
    "IMP003;IMP003;;;UN;Casa;;;;19,90;",
    "IMP004;IMP004;Produto EAN ruim;7891234567890;UN;Casa;;;1,00;2,00;",
    "CANECA;CANECA;Caneca Cerâmica 350 ml (nova descrição);;UN;Casa;Casa Bela;69120000;13,00;36,90;",
    "IMP005;IMP005;Preço inválido;;UN;Casa;;;abc;10,00;",
  ].join("\n");

  it("mapeia colunas, mostra prévia por linha e aplica a política de atualização", async () => {
    const { store, ctx } = await setup();
    const { headers, rows } = parseCsv(csv);
    expect(headers).toHaveLength(11);
    expect(rows).toHaveLength(6);
    const mapping = guessMapping(headers);
    expect(Object.values(mapping)).toEqual(expect.arrayContaining(["code", "sku", "name", "barcode", "unit", "category", "brand", "ncm", "cost", "price", "initialQty"]));

    // política: criar novos e ignorar existentes
    const prev = await previewImport(ctx, { text: csv, mapping, mode: "create_only", matchBy: "sku" });
    const by = (line: number) => prev.results.find((r) => r.line === line)!;
    expect(by(2).action).toBe("create");
    expect(by(3).action).toBe("create");
    expect(by(3).messages.join(" ")).toMatch(/categoria "Casa Nova" será criada/);
    expect(by(4).action).toBe("error"); // sem nome
    expect(by(5).action).toBe("error"); // EAN inválido
    expect(by(6).action).toBe("skip"); // CANECA já existe
    expect(by(7).action).toBe("error"); // custo inválido
    expect(prev.totals).toMatchObject({ create: 2, update: 0, skip: 1, error: 3 });
    expect(await listAll(store, "products", { filters: [["eq", "code", "IMP001"]] })).toHaveLength(0); // prévia não grava

    const res = await runImport(ctx, { fileName: "produtos.csv", text: csv, mapping, mode: "create_only", matchBy: "sku", idemKey: "imp-1" });
    expect(res.totals).toMatchObject({ create: 2, skip: 1, error: 3 });
    const garrafa = (await listAll(store, "products", { filters: [["eq", "code", "IMP001"]] }))[0];
    expect(garrafa.name).toBe("Garrafa Térmica 500 ml");
    const gs = (await listAll(store, "skus", { filters: [["eq", "productId", garrafa.id]] }))[0];
    expect(gs.barcode).toBe("7891234567895");
    expect(gs.costTotal).toBe(2500);
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "skuId", gs.id]] });
    expect(movs).toHaveLength(1);
    expect(movs[0].type).toBe("initial");
    expect(movs[0].qty).toBe(10000);
    const caneca = (await listAll(store, "products", { filters: [["eq", "code", "CANECA"]] }))[0];
    expect(caneca.name).toBe("Caneca Cerâmica 350 ml"); // ignorado

    // reenviar o mesmo lote não duplica
    const again = await runImport(ctx, { fileName: "produtos.csv", text: csv, mapping, mode: "create_only", matchBy: "sku", idemKey: "imp-1" });
    expect(again.id).toBe(res.id);
    expect(await listAll(store, "products", { filters: [["eq", "code", "IMP001"]] })).toHaveLength(1);

    // política: criar e atualizar existentes por SKU → atualiza CANECA (nome, custo, preço) e ignora o que já foi criado? (atualiza)
    const up = await runImport(ctx, { fileName: "produtos.csv", text: csv, mapping, mode: "upsert", matchBy: "sku", idemKey: "imp-2" });
    expect(up.totals).toMatchObject({ create: 0, update: 3, error: 3 });
    const caneca2 = (await store.get("products", caneca.id))!;
    expect(caneca2.name).toBe("Caneca Cerâmica 350 ml (nova descrição)");
    const csku = (await listAll(store, "skus", { filters: [["eq", "productId", caneca.id]] }))[0];
    expect(csku.costAcquisition).toBe(1300);
    const [cp] = await resolvePrices(store, { companyId: ctx.companyId, branchId: ctx.branchId, items: [{ skuId: csku.id, qty: 1000 }] });
    expect(cp.price).toBe(3690);
    expect((await listAll(store, "price_history", { filters: [["eq", "skuId", csku.id], ["eq", "field", "price"]] })).length).toBeGreaterThan(0);
    // saldo inicial não é relançado para existentes
    expect(await listAll(store, "stock_movements", { filters: [["eq", "skuId", gs.id]] })).toHaveLength(1);

    // política: somente atualizar → linha nova é ignorada
    const csv2 = "Código;Descrição;Preço\nNOVO99;Produto novo;10,00\nCANECA;Caneca Cerâmica;35,90";
    const m2 = guessMapping(parseCsv(csv2).headers);
    const p2 = await previewImport(ctx, { text: csv2, mapping: m2, mode: "update_only", matchBy: "code" });
    expect(p2.results.map((r) => r.action)).toEqual(["skip", "update"]);
  });
});

void detId;
