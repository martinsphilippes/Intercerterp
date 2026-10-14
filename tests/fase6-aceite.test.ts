import { describe, it, expect } from "vitest";
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import { currentSession, openSession } from "@/domain/cash";
import { finalizeSale, prepareSale, type FinalizeSaleInput } from "@/domain/sales";
import { resolveScaleBarcode } from "@/domain/scale";
import * as scaleSeed from "@/domain/seed/modules/scale";
import * as kitsSeed from "@/domain/seed/modules/kits";
import * as lotsSeed from "@/domain/seed/modules/lots";

/**
 * Aceite da Fase 6 (plano): uma mesma venda com etiqueta de balança, kit e item com lote — conferida em estoque e CMV.
 */
describe("Fase 6 — aceite: balança + kit + lote na mesma venda", () => {
  it("baixa o produto pesado, os componentes do kit e o lote que vence primeiro, uma única vez", async () => {
    const store = freshStore();
    const refs = await seedBase(store);
    await scaleSeed.seed(refs);
    await kitsSeed.seed(refs);
    await lotsSeed.seed(refs);
    const cashier = await refs.ctxFor("cashier", "matriz");
    const terminalId = refs.terminals.cx1.id;
    if (!(await currentSession(cashier, terminalId))) await openSession(cashier, { terminalId, openingFund: 10000 });

    const label = await resolveScaleBarcode(store, { companyId: refs.company.id, branchId: refs.branches.matriz.id, code: scaleSeed.SCALE_DEMO_LABELS.mussarela750g });
    expect(label?.ok).toBe(true);
    if (!label?.ok) return;
    const kitSku = (await listAll(store, "skus", { filters: [["eq", "sku", "KIT-ESCOLAR"]] }))[0];
    const iogurteSku = (await listAll(store, "skus", { filters: [["eq", "productId", (await listAll(store, "products", { filters: [["eq", "lotControl", true]] }))[0].id]] }))[0];
    expect(kitSku && iogurteSku).toBeTruthy();

    const input: FinalizeSaleInput = {
      terminalId, idemKey: "aceite-fase6",
      items: [{ skuId: label.skuId, qty: label.qty }, { skuId: kitSku.id, qty: 1000 }, { skuId: iogurteSku.id, qty: 2000 }],
      payments: [],
    };
    const prep = await prepareSale(cashier, input);
    const total = prep.calc.total;
    // a linha da etiqueta fecha com o total calculado pela regra atual
    expect(prep.calc.items[0].total).toBe(label.lineTotal);

    const before = await listAll(store, "stock_movements");
    await finalizeSale(cashier, { ...input, payments: [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }] });
    await finalizeSale(cashier, { ...input, payments: [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }] }); // repetição: nada novo
    const movs = (await listAll(store, "stock_movements")).filter((m) => !before.some((b) => b.id === m.id));

    // queijo pelo peso da etiqueta
    expect(movs.filter((m) => m.skuId === label.skuId).map((m) => m.qty)).toEqual([-label.qty]);
    // kit: nunca o próprio SKU; componentes baixados
    expect(movs.some((m) => m.skuId === kitSku.id)).toBe(false);
    expect(movs.filter((m) => m.type === "sale" && m.skuId !== label.skuId && m.skuId !== iogurteSku.id).length).toBeGreaterThan(0);
    // lote: sai do que vence primeiro (L-A)
    const iog = movs.filter((m) => m.skuId === iogurteSku.id);
    expect(iog).toHaveLength(1);
    expect((iog[0].lots ?? []).map((l: any) => l.lot)).toEqual(["L-A"]);

    // CMV do kit = soma dos componentes
    const sale = await store.getOrThrow("sales", detId("sale", "aceite-fase6"));
    const items = await listAll(store, "sale_items", { filters: [["eq", "saleId", sale.id]] });
    const kitItem = items.find((i) => i.skuId === kitSku.id)!;
    const kitMovCost = movs.filter((m) => m.type === "sale" && m.skuId !== label.skuId && m.skuId !== iogurteSku.id).reduce((a, m) => a + m.totalCost, 0);
    expect(kitItem.costTotal ?? kitItem.unitCost).toBe(kitMovCost);
  });
});
