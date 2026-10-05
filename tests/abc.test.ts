import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { addReturn, addSale, at, baseRefs, COMPANY } from "./report-fixtures";
import { abcReport, classifyAbc, parseLimits, getAbcLimits } from "@/domain/abc";
import { reportTotals } from "@/domain/reports";
import { setSetting } from "@/lib/core/settings";
import type { Store } from "@/lib/db/types";

const LIMITS = { a: 8000, b: 9500 };
const scope = (from: string, to: string) => ({ companyId: COMPANY, branchIds: null, from, to });

/**
 * Receitas líquidas (centavos) que reproduzem o exemplo do cliente com o critério do acumulado ANTERIOR:
 *  S1 50,00% (acum. 50,00) · S2 25,00% (75,00) · S3 10,09% (85,09) → classe A termina em 85,09%
 *  S4  8,00% (93,09) · S5 4,22% (97,31) → classe B leva o acumulado a 97,31%
 *  S6  2,69% (100,00) → C
 */
const VALUES: Array<[string, number]> = [
  ["S1", 500000],
  ["S2", 250000],
  ["S3", 100900],
  ["S4", 80000],
  ["S5", 42200],
  ["S6", 26900],
];

async function scenario(store: Store) {
  await baseRefs(store);
  let n = 0;
  for (const [sku, value] of VALUES) {
    // preço unitário = valor, 1 unidade; custo 40% do valor
    await addSale(store, { id: `sale-${sku}`, at: at("2026-09-10", 10 + (n++ % 8)), items: [{ skuId: sku, sku, qty: 1000, unitPrice: value, cost: Math.round(value * 0.4) }] });
  }
  // S7: vendido ANTES do recorte e devolvido DENTRO do recorte → receita negativa no período (fora da base)
  await addSale(store, { id: "sale-S7", at: at("2026-08-20"), items: [{ skuId: "S7", sku: "S7", qty: 1000, unitPrice: 5000, cost: 2000 }] });
  await addReturn(store, { id: "ret-S7", saleId: "sale-S7", at: at("2026-09-15"), items: [{ seq: 1, skuId: "S7", qty: 1000, total: 5000, cost: 2000 }] });
  // venda cancelada no período: não entra em nada
  await addSale(store, { id: "sale-cancelled", status: "cancelled", at: at("2026-09-12"), items: [{ skuId: "S6", sku: "S6", qty: 1000, unitPrice: 99999, cost: 1 }] });
}

describe("curva ABC", () => {
  let store: Store;
  beforeEach(async () => {
    store = freshStore();
    await scenario(store);
  });

  it("classifica pelo acumulado anterior: A termina em 85,09% e B leva a 97,31%", async () => {
    const r = await abcReport(store, scope("2026-09-01", "2026-09-30"), { limits: LIMITS, includeNoMovement: false });
    const base = r.classification.base;
    expect(base.map((x) => x.row.sku)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
    expect(base.map((x) => x.klass)).toEqual(["A", "A", "A", "B", "B", "C"]);
    const lastA = base.filter((x) => x.klass === "A").at(-1)!;
    const lastB = base.filter((x) => x.klass === "B").at(-1)!;
    expect(lastA.cumAfterBps).toBe(8509); // 85,09%
    expect(lastB.cumAfterBps).toBe(9731); // 97,31%
    // o item que cruza o limite de A (S3: 75,00% → 85,09%) fica em A; S4 começa em 85,09% ≥ 80% → B
    expect(base[2].cumBeforeBps).toBe(7500);
    expect(base[3].cumBeforeBps).toBe(8509);
    expect(r.classification.classes.A).toMatchObject({ count: 3, value: 850900, shareBps: 8509 });
    expect(r.classification.classes.B).toMatchObject({ count: 2, value: 122200, shareBps: 1222 });
    expect(r.classification.classes.C).toMatchObject({ count: 1, value: 26900, shareBps: 269 });
  });

  it("separa itens sem receita positiva e reconcilia com a receita total do recorte", async () => {
    const r = await abcReport(store, scope("2026-09-01", "2026-09-30"), { limits: LIMITS, includeNoMovement: false });
    expect(r.classification.excluded.map((x) => [x.row.sku, x.value])).toEqual([["S7", -5000]]);
    expect(r.classification.baseTotal).toBe(1000000);
    expect(r.classification.excludedTotal).toBe(-5000);
    // receita total do recorte = base da curva + itens com receita ≤ 0
    expect(r.revenue.total).toBe(995000);
    expect(r.revenue.base + r.revenue.excluded).toBe(r.revenue.total);
    // mesma base dos gerenciais/painel
    const t = await reportTotals(store, scope("2026-09-01", "2026-09-30"));
    expect(t.netRevenue).toBe(r.revenue.total);
  });

  it("filtrar por classe não recalcula o denominador", async () => {
    const r = await abcReport(store, scope("2026-09-01", "2026-09-30"), { limits: LIMITS, includeNoMovement: false });
    const onlyB = r.classification.base.filter((x) => x.klass === "B");
    // participação de S4 continua 8,00% do total da curva (não 80000/122200)
    expect(onlyB.map((x) => [x.row.sku, x.shareBps, x.cumAfterBps])).toEqual([
      ["S4", 800, 9309],
      ["S5", 422, 9731],
    ]);
  });

  it("desempate: maior quantidade, depois SKU crescente", () => {
    const rows = [
      { sku: "B", v: 100, q: 1000 },
      { sku: "A", v: 100, q: 1000 },
      { sku: "C", v: 100, q: 3000 },
      { sku: "Z", v: 0, q: 0 },
      { sku: "N", v: -10, q: -1000 },
    ];
    const c = classifyAbc(rows, { value: (r) => r.v, qty: (r) => r.q, sku: (r) => r.sku }, LIMITS);
    expect(c.base.map((x) => x.row.sku)).toEqual(["C", "A", "B"]);
    expect(c.excluded.map((x) => x.row.sku)).toEqual(["N", "Z"]);
    expect(c.total).toBe(290);
  });

  it("limites vêm dos parâmetros (abc.limitA/limitB) e podem ser ajustados para o recorte", async () => {
    expect(await getAbcLimits(store, COMPANY, null)).toEqual({ a: 8000, b: 9500 });
    await setSetting(store, COMPANY, null, "abc.limitA", 7000);
    await setSetting(store, COMPANY, null, "abc.limitB", 9000);
    const lim = await getAbcLimits(store, COMPANY, null);
    expect(lim).toEqual({ a: 7000, b: 9000 });
    expect(parseLimits("85,5", "97", lim)).toEqual({ limits: { a: 8550, b: 9700 }, custom: true });
    expect(parseLimits("96", "90", lim).error).toBeTruthy();
    const r = await abcReport(store, scope("2026-09-01", "2026-09-30"), { limits: { a: 7000, b: 9000 }, includeNoMovement: false });
    // S2 começa em 50% < 70% → A; S3 começa em 75% ≥ 70% → B; S4 começa em 85,09% < 90% → B; S5 começa em 93,09% → C
    expect(r.classification.base.map((x) => x.klass)).toEqual(["A", "A", "B", "B", "C", "C"]);
  });

  it("critérios alternativos: quantidade e lucro bruto", async () => {
    const byQty = await abcReport(store, scope("2026-09-01", "2026-09-30"), { criterion: "quantidade", limits: LIMITS, includeNoMovement: false });
    // todos com 1 un → empate total → ordem por SKU
    expect(byQty.classification.base.map((x) => x.row.sku)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
    expect(byQty.classification.excluded.map((x) => x.row.sku)).toEqual(["S7"]);
    const byMargin = await abcReport(store, scope("2026-09-01", "2026-09-30"), { criterion: "margem", limits: LIMITS, includeNoMovement: false });
    expect(byMargin.classification.baseTotal).toBe(600000); // 60% de 1.000.000
    expect(byMargin.classification.excludedTotal).toBe(-3000); // devolução: −5.000 receita + 2.000 custo revertido
  });
});
