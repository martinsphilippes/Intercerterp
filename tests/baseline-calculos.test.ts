/**
 * Fase 0 — testes de CARACTERIZAÇÃO dos cálculos monetários centrais.
 *
 * Objetivo: congelar o comportamento ATUAL (valores exatos em centavos e quantidades em milésimos) antes da
 * evolução por fases. Cada expect registra o que o código produz hoje — não o comportamento "ideal".
 * Se um teste daqui quebrar, a mudança de cálculo precisa ser intencional e revisada (e o teste atualizado
 * junto, com justificativa). Comportamentos suspeitos estão marcados com "ATENÇÃO (comportamento atual)".
 *
 * Convenções: valores em centavos inteiros; quantidades em milésimos (1000 = 1 unidade); percentuais em
 * pontos-base (100 = 1%). Arredondamento padrão do sistema: metade para longe de zero (roundDiv).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { setSetting } from "@/lib/core/settings";
import { addDays, addMonths, toLocalDate } from "@/lib/dates";
import { roundDiv, lineTotal, pct, allocate, splitInstallments, marginBps, markupBps } from "@/lib/money";
import { calcSale } from "@/domain/pricing-calc";
import { cartTotals, previewSchedule, changeFor } from "@/domain/cart-calc";
import { prepareSale, finalizeSale, processReturn, returnableItems } from "@/domain/sales";
import { computeOrderTotals, buildInstallmentPlan, netUnitCost } from "@/domain/purchase-calc";
import { computeReceipt, orderChargesFor, buildReceiptInstallments, payableAmount, type ReceiptItem } from "@/domain/receipts";
import { openSession, addCashMovement, sessionSummary, expectedOf } from "@/domain/cash";
import { buildSchedule, termFinancedTotal, lateChargeParams, suggestLateCharges, LATE_DEFAULTS, createManualTitle, settleInstallment } from "@/domain/finance";
import { lateCharges as clientLateCharges, schedule as clientSchedule, financedTotal as clientFinancedTotal } from "@/app/(app)/financeiro/_components/calc";
import { defaultCfop, computeTotals, buildItems, calcNfse, type DocItem } from "@/domain/fiscal/service";
import { postMovements, balanceId, type MovementType } from "@/domain/stock";
import { priceMetrics } from "@/domain/pricing";

// ═════════════════════════════ 1. Aritmética monetária (src/lib/money.ts) — base de todos os cálculos

describe("baseline — aritmética monetária", () => {
  // Regra: roundDiv arredonda metade para LONGE de zero (5/2 = 3; −5/2 = −3; 1,5 → 2; −1,5 → −2).
  it("roundDiv: half away from zero", () => {
    expect([roundDiv(5, 2), roundDiv(-5, 2), roundDiv(4, 3), roundDiv(15, 10), roundDiv(25, 10), roundDiv(-15, 10)]).toEqual([3, -3, 1, 2, 3, -2]);
    expect(() => roundDiv(1, 0)).toThrow(/Divisão por zero/);
  });

  // Regra: linha = preço (centavos) × quantidade (milésimos) ÷ 1000, arredondado; 0,5 centavo sobe para 1.
  it("lineTotal: quantidade fracionária em milésimos", () => {
    expect(lineTotal(999, 1234)).toBe(1233); // 1,234 × R$ 9,99 = 12,32766
    expect(lineTotal(1, 500)).toBe(1); // 0,5 centavo → 1
    expect(lineTotal(1, 499)).toBe(0);
    expect(lineTotal(4990, 2000)).toBe(9980);
    expect(lineTotal(333, 333)).toBe(111); // 0,333 × R$ 3,33 = 1,10889
  });

  // Regra: pct(valor, bps) = valor × bps ÷ 10000 com o mesmo arredondamento.
  it("pct em pontos-base", () => {
    expect([pct(12345, 1000), pct(1, 5000), pct(33333, 200), pct(100, 33)]).toEqual([1235, 1, 667, 0]);
  });

  // Regra: rateio pelo maior resto; empate de resto → maior peso, depois menor índice; pesos todos zero → partes iguais;
  // total negativo é rateado em módulo e devolvido com sinal.
  it("allocate: rateio por maior resto fecha os centavos", () => {
    expect(allocate(100, [1000, 1000, 1000])).toEqual([34, 33, 33]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
    expect(allocate(-100, [1, 2])).toEqual([-33, -67]);
    expect(allocate(7, [5, 0, 5])).toEqual([4, 0, 3]);
    expect(allocate(5, [])).toEqual([]);
  });

  // Regra: parcelas iguais (truncadas) e a SOBRA de centavos vai inteira para a 1ª parcela.
  // ATENÇÃO (comportamento atual): total menor que o nº de parcelas gera parcelas de R$ 0,00.
  it("splitInstallments: sobra na primeira parcela", () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(100, 7)).toEqual([16, 14, 14, 14, 14, 14, 14]);
    expect(splitInstallments(1, 3)).toEqual([1, 0, 0]);
    expect(splitInstallments(100, 0)).toEqual([]);
  });

  // Regra: margem = (receita − custo)/receita; markup = (preço − custo)/custo; ambos em bps arredondados.
  it("marginBps × markupBps", () => {
    expect([marginBps(3, 1), markupBps(3, 1)]).toEqual([6667, 20000]);
    expect([marginBps(10000, 6667), markupBps(10000, 6667)]).toEqual([3333, 4999]);
    expect([marginBps(0, 100), markupBps(100, 0)]).toEqual([null, null]);
  });
});

// ═════════════════════════════ 2. Venda — calcSale (src/domain/pricing-calc.ts)

describe("baseline — calcSale (totais da venda)", () => {
  // Regra: desconto global em valor é rateado entre os itens proporcionalmente ao líquido de cada item (maior resto).
  it("desconto global em valor rateado proporcionalmente (exemplo do PDV)", () => {
    const r = calcSale([{ qty: 2000, unitPrice: 4990 }, { qty: 1000, unitPrice: 2990 }], { globalDiscount: 470 });
    expect(r.items.map((i) => [i.grossTotal, i.globalDiscount, i.total])).toEqual([[9980, 362, 9618], [2990, 108, 2882]]);
    expect({ subtotal: r.subtotal, itemDiscounts: r.itemDiscounts, globalDiscount: r.globalDiscount, discountTotal: r.discountTotal, surchargeTotal: r.surchargeTotal, total: r.total })
      .toEqual({ subtotal: 12970, itemDiscounts: 0, globalDiscount: 470, discountTotal: 470, surchargeTotal: 0, total: 12500 });
  });

  // Regra (borda — resto de centavo): R$ 1,00 de desconto em 3 itens iguais → 34/33/33 (o 1º índice leva o centavo).
  it("divisão com resto de centavo no rateio do desconto global", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 1000 }, { qty: 1000, unitPrice: 1000 }, { qty: 1000, unitPrice: 1000 }], { globalDiscount: 100 });
    expect(r.items.map((i) => i.globalDiscount)).toEqual([34, 33, 33]);
    expect(r.items.map((i) => i.total)).toEqual([966, 967, 967]);
    expect(r.total).toBe(2900);
  });

  // Regra: desconto global em % (bps) incide sobre a soma líquida dos itens (após descontos de item).
  it("desconto global percentual (10,5%)", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 3333 }, { qty: 3000, unitPrice: 1111 }], { globalDiscountBps: 1050 });
    expect(r.items.map((i) => [i.grossTotal, i.globalDiscount, i.total])).toEqual([[3333, 350, 2983], [3333, 350, 2983]]);
    expect([r.subtotal, r.globalDiscount, r.total]).toEqual([6666, 700, 5966]);
  });

  // Regra: com valor E percentual informados, o percentual prevalece (o valor é ignorado).
  it("globalDiscountBps prevalece sobre globalDiscount", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 10000 }], { globalDiscount: 500, globalDiscountBps: 1000 });
    expect([r.globalDiscount, r.total]).toEqual([1000, 9000]);
  });

  // Regra: desconto do item limitado a [0, bruto]; desconto negativo vira 0.
  it("desconto de item acima do bruto é limitado; negativo é zerado", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 1000, itemDiscount: 5000 }, { qty: 1000, unitPrice: 2000, itemDiscount: -50 }]);
    expect(r.items.map((i) => [i.itemDiscount, i.total])).toEqual([[1000, 0], [0, 2000]]);
    expect([r.subtotal, r.itemDiscounts, r.discountTotal, r.total]).toEqual([3000, 1000, 1000, 2000]);
  });

  // Regra (borda — desconto 100%): a função pura aceita e devolve total 0 (o servidor recusa — ver prepareSale).
  it("desconto de 100% zera o total", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 1999 }, { qty: 2500, unitPrice: 799 }], { globalDiscountBps: 10000 });
    expect(r.items.map((i) => [i.grossTotal, i.globalDiscount, i.total])).toEqual([[1999, 1999, 0], [1998, 1998, 0]]);
    expect([r.subtotal, r.globalDiscount, r.total]).toEqual([3997, 3997, 0]);
    // desconto global em valor acima do líquido é limitado ao líquido
    const r2 = calcSale([{ qty: 1000, unitPrice: 1000 }], { globalDiscount: 99999 });
    expect([r2.globalDiscount, r2.total]).toEqual([1000, 0]);
  });

  // Regra: acréscimo global é rateado pelo líquido do item; item com líquido 0 entra com peso 1 (quase nada).
  it("acréscimo global rateado pelo líquido (item zerado com peso 1)", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 1000 }, { qty: 1000, unitPrice: 1000, itemDiscount: 1000 }, { qty: 1000, unitPrice: 500 }], { surcharge: 100 });
    expect(r.items.map((i) => [i.surcharge, i.total])).toEqual([[67, 1067], [0, 0], [33, 533]]);
    expect([r.surchargeTotal, r.total]).toEqual([100, 1600]);
  });

  // Regra: acréscimo do item soma ao acréscimo global rateado; desconto e acréscimo globais coexistem.
  it("acréscimo de item + acréscimo global + desconto global", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 1000, itemSurcharge: 55 }, { qty: 1000, unitPrice: 3000 }], { globalDiscount: 1000, surcharge: 1 });
    expect(r.items.map((i) => [i.globalDiscount, i.surcharge, i.total])).toEqual([[250, 55, 805], [750, 1, 2251]]);
    expect([r.discountTotal, r.surchargeTotal, r.total]).toEqual([1000, 56, 3056]);
  });

  // Regra: valores globais negativos são zerados.
  it("desconto/acréscimo global negativos são ignorados", () => {
    const r = calcSale([{ qty: 1000, unitPrice: 1000 }], { globalDiscount: -300, surcharge: -10 });
    expect([r.globalDiscount, r.surchargeTotal, r.total]).toEqual([0, 0, 1000]);
  });

  // Regra (borda — quantidade fracionária): cada linha é arredondada isoladamente antes de somar.
  it("quantidades fracionárias em milésimos", () => {
    const r = calcSale([{ qty: 1234, unitPrice: 999 }, { qty: 500, unitPrice: 1 }, { qty: 333, unitPrice: 333 }]);
    expect(r.items.map((i) => i.grossTotal)).toEqual([1233, 1, 111]);
    expect(r.total).toBe(1345);
  });
});

// ═════════════════════════════ 3. Atendimento no PDV — cart-calc (src/domain/cart-calc.ts)

describe("baseline — cart-calc (prévia do PDV)", () => {
  // Regra: preço digitado ABAIXO da tabela vira desconto do item ((tabela − digitado) × qtd); ACIMA substitui o preço.
  it("preço digitado abaixo da tabela = desconto; acima = novo preço", () => {
    const r = cartTotals({ items: [{ skuId: "a", qty: 2000, listPrice: 4990, unitPrice: 4500 }, { skuId: "b", qty: 1000, listPrice: 2990, unitPrice: 3500 }] });
    expect(r.items.map((i) => [i.unitPrice, i.grossTotal, i.itemDiscount, i.total])).toEqual([[4990, 9980, 980, 9000], [3500, 3500, 0, 3500]]);
    expect([r.subtotal, r.discountTotal, r.total]).toEqual([13480, 980, 12500]);
  });

  // Regra: preço de atacado vale quando qtd ≥ quantidade mínima (12 un → 23,90; 11 un → 29,90).
  it("preço de atacado por quantidade mínima", () => {
    const r = cartTotals({ items: [{ skuId: "a", qty: 12000, listPrice: 2990, wholesalePrice: 2390, wholesaleMinQty: 12000 }, { skuId: "b", qty: 11000, listPrice: 2990, wholesalePrice: 2390, wholesaleMinQty: 12000 }] });
    expect(r.items.map((i) => [i.unitPrice, i.grossTotal])).toEqual([[2390, 28680], [2990, 32890]]);
    expect(r.total).toBe(61570);
  });

  // Regra: com globalDiscountBps preenchido o valor em R$ é descartado; desconto do preço digitado é arredondado na linha.
  it("percentual global + preço digitado (3 × 3,33 sobre tabela 10,00)", () => {
    const r = cartTotals({ items: [{ skuId: "a", qty: 3000, listPrice: 1000, unitPrice: 333 }], globalDiscount: 500, globalDiscountBps: 1000 });
    expect(r.items.map((i) => [i.itemDiscount, i.globalDiscount, i.total])).toEqual([[2001, 100, 899]]);
    expect([r.discountTotal, r.total]).toEqual([2101, 899]);
  });

  // Regra: tabela sem preço (0) → usa o preço digitado.
  it("item sem preço de tabela usa o digitado", () => {
    expect(cartTotals({ items: [{ skuId: "a", qty: 1000, listPrice: 0, unitPrice: 750 }] }).total).toBe(750);
  });

  // Regra (borda — fração): 1,5 × 10,01 = 15,015 → 15,02 bruto; desconto 0,015 → 0,02; líquido fecha em 15,00.
  it("quantidade fracionária com preço digitado 1 centavo abaixo", () => {
    const r = cartTotals({ items: [{ skuId: "a", qty: 1500, listPrice: 1001, unitPrice: 1000 }] });
    expect(r.items.map((i) => [i.grossTotal, i.itemDiscount, i.total])).toEqual([[1502, 2, 1500]]);
  });

  // Regra: prévia de parcelas = mesma regra de buildSchedule (sobra na 1ª; meses-calendário quando 30/30; senão dias).
  it("previewSchedule (sobra de centavos e fim de mês)", () => {
    expect(previewSchedule(10000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-01-31")).toEqual([
      { amount: 3334, dueDate: "2026-02-28" }, { amount: 3333, dueDate: "2026-03-31" }, { amount: 3333, dueDate: "2026-04-30" },
    ]);
    expect(previewSchedule(10001, { installments: 2, firstDueDays: 28, intervalDays: 28 }, "2026-01-31")).toEqual([
      { amount: 5001, dueDate: "2026-02-28" }, { amount: 5000, dueDate: "2026-03-28" },
    ]);
    expect(previewSchedule(500, null, "2026-03-15")).toEqual([{ amount: 500, dueDate: "2026-03-15" }]);
  });

  // Regra: troco = recebido − aplicado, nunca negativo.
  it("troco", () => {
    expect([changeFor(5000, 3000), changeFor(3000, 5000), changeFor(1, 1)]).toEqual([2000, 0, 0]);
  });
});

// ═════════════════════════════ 4. Compras — pedido (src/domain/purchase-calc.ts)

describe("baseline — computeOrderTotals / plano de parcelas / custo líquido", () => {
  // Regra: linha = bruto − desconto (limitado ao bruto) + IPI (negativo → 0); desconto do pedido limitado ao líquido dos itens;
  // total = subtotal − descontos + IPI + frete + seguro + outras.
  it("totais do pedido com limites de desconto e IPI", () => {
    const r = computeOrderTotals({
      items: [{ skuId: "a", qty: 3000, unitCost: 1000, discount: 100, ipi: 150 }, { skuId: "b", qty: 1500, unitCost: 333, discount: 9999, ipi: -5 }],
      headerDiscount: 99999, freight: 1000, insurance: 200, otherExpenses: 50,
    });
    expect(r.items.map((i) => [i.gross, i.discount, i.ipi, i.total])).toEqual([[3000, 100, 150, 3050], [500, 500, 0, 0]]);
    expect({ subtotal: r.subtotal, itemDiscounts: r.itemDiscounts, headerDiscount: r.headerDiscount, discountTotal: r.discountTotal, ipiTotal: r.ipiTotal, freight: r.freight, insurance: r.insurance, otherExpenses: r.otherExpenses, total: r.total })
      .toEqual({ subtotal: 3500, itemDiscounts: 600, headerDiscount: 2900, discountTotal: 3500, ipiTotal: 150, freight: 1000, insurance: 200, otherExpenses: 50, total: 1400 });
  });

  // Regra: quantidade fracionária (2,5 × 19,99 = 49,975 → 49,98); frete negativo → 0.
  it("pedido com quantidade fracionária e frete negativo", () => {
    const r = computeOrderTotals({ items: [{ skuId: "a", qty: 2500, unitCost: 1999 }, { skuId: "b", qty: 1000, unitCost: 1000 }], headerDiscount: 300, freight: -10 });
    expect([r.items[0].gross, r.subtotal, r.headerDiscount, r.freight, r.total]).toEqual([4998, 5998, 300, 0, 5698]);
  });

  // Regra: plano relativo (dias); "30/60/90" livre ou condição cadastrada; sobra de centavos na 1ª; sem condição = à vista.
  it("buildInstallmentPlan", () => {
    expect(buildInstallmentPlan(10000, { installments: 3, firstDueDays: 30, intervalDays: 30 })).toEqual([
      { number: 1, days: 30, amount: 3334 }, { number: 2, days: 60, amount: 3333 }, { number: 3, days: 90, amount: 3333 },
    ]);
    expect(buildInstallmentPlan(10001, null, "30/60/90").map((p) => p.amount)).toEqual([3335, 3333, 3333]);
    expect(buildInstallmentPlan(999, null)).toEqual([{ number: 1, days: 0, amount: 999 }]);
    expect(buildInstallmentPlan(100, { installments: 0, firstDueDays: 0, intervalDays: 0 })).toEqual([{ number: 1, days: 0, amount: 100 }]);
  });

  // Regra: custo unitário líquido = (bruto − desconto) × 1000 ÷ qtd, arredondado (3 × 10,00 − 1,00 → 9,67).
  it("netUnitCost", () => {
    expect(netUnitCost({ qty: 3000, unitCost: 1000, discount: 100 })).toBe(967);
    expect(netUnitCost({ qty: 0, unitCost: 1234 })).toBe(1234);
    expect(netUnitCost({ qty: 7000, unitCost: 1000, discount: 1 })).toBe(1000);
    expect(netUnitCost({ qty: 1500, unitCost: 999, discount: null })).toBe(999);
  });
});

// ═════════════════════════════ 5. Recebimento de mercadorias (src/domain/receipts.ts)

const ri = (o: Partial<ReceiptItem> & { idx: number }): ReceiptItem => ({
  conversionFactor: 1000, invoicedQty: 0, invoicedValue: 0, invoiceUnitCost: 0, skuId: null, description: `item ${o.idx}`, expectedQty: 0, receivedQty: 0, unitCost: 0, ...o,
});

describe("baseline — computeReceipt (rateio e custo de entrada)", () => {
  // Regra: frete, outras despesas (na importação do XML = vOutro + vIPI + vST + vSeg) e desconto são rateados pelo valor
  // de cada linha recebida (maior resto); custo de entrada = (linha + frete + outras − desconto) × 1000 ÷ qtd recebida.
  // Devido = produtos − desconto + frete + outras; divergência de valor quando |faturado − devido| > tolerância.
  it("com XML: rateio de frete, IPI+ST e desconto; custo unitário de entrada", () => {
    const r = computeReceipt(
      {
        items: [
          ri({ idx: 1, skuId: "A", invoicedQty: 3000, invoicedValue: 3000, invoiceUnitCost: 1000, receivedQty: 3000, unitCost: 1000 }),
          ri({ idx: 2, skuId: "B", invoicedQty: 2000, invoicedValue: 2001, invoiceUnitCost: 1001, receivedQty: 2000, unitCost: 1001 }),
          ri({ idx: 3, skuId: "C", invoicedQty: 1000, invoicedValue: 999, invoiceUnitCost: 999, receivedQty: 1000, unitCost: 999 }),
        ],
        freight: 1000, otherExpenses: 150 /* IPI */ + 77 /* ST */, discount: 100, invoicedTotal: 7277, hasXml: true,
      },
      [],
    );
    expect(r.items.map((i) => [i.lineValue, i.freightShare, i.otherShare, i.discountShare, i.landedUnitCost])).toEqual([
      [3000, 500, 113, 50, 1188],
      [2001, 334, 76, 33, 1189],
      [999, 166, 38, 17, 1186],
    ]);
    expect([r.productsTotal, r.dueTotal]).toEqual([6000, 7127]);
    // (formatMoney usa espaço não separável após "R$": compara-se só os valores)
    expect(r.divergences.map((d) => d.kind)).toEqual(["value"]);
    expect(r.divergences[0].message).toMatch(/^Valor faturado R\$\s72,77 × valor devido pelo recebido R\$\s71,27 \(diferença R\$\s1,50\)\.$/);
  });

  // Regra: sem XML, o valor da linha é o líquido EXATO da linha do pedido (3 × 10,00 − 1,00 = 29,00, não 3 × 9,67).
  // ATENÇÃO (comportamento atual): o custo de entrada unitário arredonda para 9,67 → 3 × 9,67 = 29,01 no estoque (1 centavo a mais).
  it("sem XML: valor exato da linha do pedido e custo unitário arredondado", () => {
    const line = { id: "l1", skuId: "A", remaining: 3000, netUnit: 967, order: { id: "o1", number: 1 }, qty: 3000, unitCost: 1000, discount: 100 };
    const r = computeReceipt({ items: [ri({ idx: 1, skuId: "A", receivedQty: 3000, unitCost: 967 })], freight: 0, otherExpenses: 0, discount: 0, invoicedTotal: null, hasXml: false }, [line]);
    expect([r.items[0].expectedQty, r.items[0].lineValue, r.items[0].landedUnitCost, r.productsTotal, r.dueTotal]).toEqual([3000, 2900, 967, 2900, 2900]);
    expect(r.items[0].allocations).toEqual([{ orderId: "o1", orderItemId: "l1", orderNumber: 1, qty: 3000 }]);
    expect(r.divergences).toEqual([]);
  });

  // Regra: recebimento parcial sem XML usa o valor proporcional acumulado (1/3 de 29,00 = 9,67) e acusa divergência
  // de quantidade e de valor (tolerância de 5 centavos não cobre 33 centavos).
  it("sem XML: recebimento parcial (1 de 3) com tolerância de valor", () => {
    const line = { id: "l1", skuId: "A", remaining: 3000, netUnit: 967, order: { id: "o1", number: 1 }, qty: 3000, unitCost: 1000, discount: 100 };
    const r = computeReceipt({ items: [ri({ idx: 1, skuId: "A", receivedQty: 1000, unitCost: 967 })], freight: 0, otherExpenses: 0, discount: 0, invoicedTotal: 1000, hasXml: false, valueTolerance: 5 }, [line]);
    expect([r.items[0].lineValue, r.items[0].landedUnitCost, r.dueTotal]).toEqual([967, 967, 967]);
    expect(r.divergences.map((d) => d.kind)).toEqual(["qty", "value"]);
  });

  // Regra: alocação FIFO entre pedidos; excedente vira divergência "over_order"; item fora dos pedidos "not_ordered";
  // frete de 0,10 rateado 8/2.
  it("alocação FIFO entre pedidos, excesso e item não pedido", () => {
    const r = computeReceipt(
      {
        items: [
          ri({ idx: 1, skuId: "A", invoicedQty: 5000, invoicedValue: 5000, invoiceUnitCost: 1000, receivedQty: 5000, unitCost: 1000 }),
          ri({ idx: 2, skuId: "Z", invoicedQty: 1000, invoicedValue: 1000, invoiceUnitCost: 1000, receivedQty: 1000, unitCost: 1000 }),
        ],
        freight: 10, otherExpenses: 0, discount: 0, invoicedTotal: 6010, hasXml: true,
      },
      [{ id: "l1", skuId: "A", remaining: 2000, netUnit: 1000, order: { id: "o1", number: 1 } }, { id: "l2", skuId: "A", remaining: 2000, netUnit: 1000, order: { id: "o2", number: 2 } }],
    );
    expect(r.items[0].allocations?.map((a) => [a.orderNumber, a.qty])).toEqual([[1, 2000], [2, 2000]]);
    expect(r.items.map((i) => [i.freightShare, i.landedUnitCost])).toEqual([[8, 1002], [2, 1002]]);
    expect(r.dueTotal).toBe(6010);
    expect(r.divergences.map((d) => d.kind)).toEqual(["over_order", "not_ordered"]);
  });

  // Regra (borda): desconto maior que os produtos é limitado aos produtos → devido 0 e custo de entrada 0.
  it("desconto acima do valor dos produtos", () => {
    const r = computeReceipt({ items: [ri({ idx: 1, skuId: "A", invoicedQty: 1000, invoicedValue: 500, invoiceUnitCost: 500, receivedQty: 1000, unitCost: 500 })], freight: 0, otherExpenses: 0, discount: 900, invoicedTotal: 0, hasXml: true }, []);
    expect([r.items[0].discountShare, r.items[0].landedUnitCost, r.dueTotal]).toEqual([500, 0, 0]);
  });

  // Regra: encargos do pedido sem XML — IPI proporcional à qtd alocada; desconto geral (total − descontos de linha)
  // proporcional ao líquido alocado; frete/seguro/outras integrais no pedido "assumido"; outras = outras + seguro + IPI.
  it("orderChargesFor", () => {
    const order = { id: "o1", number: 1, freight: 500, insurance: 30, otherExpenses: 20, discountTotal: 400 };
    const r = orderChargesFor(
      [{ allocations: [{ orderId: "o1", orderItemId: "l1", orderNumber: 1, qty: 1000 }] }],
      [{ id: "l1", qty: 3000, unitCost: 1000, discount: 100, ipi: 100, order }, { id: "l2", qty: 1000, unitCost: 1000, discount: 0, ipi: 0, order }],
      ["o1"],
    );
    expect(r).toEqual({ freight: 500, insurance: 30, ipi: 33, discount: 74, otherExpenses: 83 });
  });

  // Regra: duplicatas do XML usadas como estão quando somam o valor a pagar; senão reescalonadas por rateio (o centavo
  // extra vai para a maior duplicata); sem duplicatas → condição de pagamento (buildSchedule); valor 0 → sem parcelas.
  it("buildReceiptInstallments e payableAmount", () => {
    expect(buildReceiptInstallments(10000, [{ nDup: "001", dVenc: "2026-11-01", vDup: 5000 }, { nDup: "002", dVenc: "2026-12-01", vDup: 5000 }], null, "2026-10-01")).toEqual({
      installments: [{ number: 1, dueDate: "2026-11-01", amount: 5000, ref: "001" }, { number: 2, dueDate: "2026-12-01", amount: 5000, ref: "002" }], source: "xml", rescaled: false,
    });
    const resc = buildReceiptInstallments(10001, [{ nDup: "001", dVenc: "2026-11-01", vDup: 3333 }, { nDup: "002", dVenc: "2026-12-01", vDup: 3333 }, { nDup: "003", dVenc: "2027-01-01", vDup: 3334 }], null, "2026-10-01");
    expect([resc.installments.map((i) => i.amount), resc.rescaled]).toEqual([[3333, 3333, 3335], true]);
    const term = buildReceiptInstallments(10000, [], { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-01-31");
    expect([term.source, term.installments.map((i) => [i.amount, i.dueDate])]).toEqual(["term", [[3334, "2026-02-28"], [3333, "2026-03-31"], [3333, "2026-04-30"]]]);
    expect(buildReceiptInstallments(0, [], null, "2026-10-01")).toEqual({ installments: [], source: "none", rescaled: false });
    // valor a pagar: faturado só com a decisão "pay_invoiced"
    expect([
      payableAmount({ dueTotal: 1000, invoicedTotal: 1100, differenceAction: "pay_invoiced" }),
      payableAmount({ dueTotal: 1000, invoicedTotal: 1100, differenceAction: "adjust_to_due" }),
      payableAmount({ dueTotal: 1000, invoicedTotal: null, differenceAction: "pay_invoiced" }),
    ]).toEqual([1100, 1000, 1000]);
  });
});

// ═════════════════════════════ 6. Financeiro — parcelamento e encargos (src/domain/finance.ts)

describe("baseline — buildSchedule / juros da condição / multa e juros por atraso", () => {
  // Regra: juros da condição = total + pct(total, bps) (negativo/zero/nulo = sem juros). Cliente usa a mesma fórmula.
  it("termFinancedTotal", () => {
    expect([termFinancedTotal(10000, 199), termFinancedTotal(10000, 0), termFinancedTotal(10000, null), termFinancedTotal(333, 50), termFinancedTotal(10000, -100)]).toEqual([10199, 10000, 10000, 335, 10000]);
    expect(clientFinancedTotal(333, 50)).toBe(335);
  });

  // Regra: parcelas iguais com sobra na 1ª; intervalo 30 e 1º vencimento múltiplo de 30 → meses-calendário (31/01 → 28/02,
  // 31/03, 30/04); caso contrário soma de dias; 0 parcelas = 1; sem condição = à vista na data-base.
  it("buildSchedule — sobra de centavos e vencimentos", () => {
    expect(buildSchedule(10000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-01-31")).toEqual([
      { amount: 3334, dueDate: "2026-02-28" }, { amount: 3333, dueDate: "2026-03-31" }, { amount: 3333, dueDate: "2026-04-30" },
    ]);
    expect(buildSchedule(100, { installments: 7, firstDueDays: 0, intervalDays: 15 }, "2026-10-14")).toEqual([
      { amount: 16, dueDate: "2026-10-14" }, { amount: 14, dueDate: "2026-10-29" }, { amount: 14, dueDate: "2026-11-13" }, { amount: 14, dueDate: "2026-11-28" },
      { amount: 14, dueDate: "2026-12-13" }, { amount: 14, dueDate: "2026-12-28" }, { amount: 14, dueDate: "2027-01-12" },
    ]);
    expect(buildSchedule(10000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-10-14", { interestBps: 199 })).toEqual([
      { amount: 3401, dueDate: "2026-11-14" }, { amount: 3399, dueDate: "2026-12-14" }, { amount: 3399, dueDate: "2027-01-14" },
    ]);
    expect(buildSchedule(5000, null, "2026-10-14")).toEqual([{ amount: 5000, dueDate: "2026-10-14" }]);
    expect(buildSchedule(1000, { installments: 0, firstDueDays: 0, intervalDays: 30 }, "2026-10-14")).toEqual([{ amount: 1000, dueDate: "2026-10-14" }]);
  });

  // ATENÇÃO (comportamento atual): 1 centavo em 3 parcelas gera duas parcelas de R$ 0,00; 1º vencimento 45 dias usa dias corridos.
  it("buildSchedule — borda: parcelas zeradas e 1º vencimento não múltiplo de 30", () => {
    expect(buildSchedule(1, { installments: 3, firstDueDays: 45, intervalDays: 30 }, "2026-10-14")).toEqual([
      { amount: 1, dueDate: "2026-11-28" }, { amount: 0, dueDate: "2026-12-28" }, { amount: 0, dueDate: "2027-01-27" },
    ]);
  });

  // Regra (formulário do cliente, sem condição): parte do 1º vencimento informado e soma meses a partir dele.
  it("schedule do formulário (cliente)", () => {
    expect(clientSchedule(10000, 3, "2026-01-31", 30)).toEqual([
      { amount: 3334, dueDate: "2026-01-31" }, { amount: 3333, dueDate: "2026-02-28" }, { amount: 3333, dueDate: "2026-03-31" },
    ]);
  });

  // Regra: atraso = dias corridos entre vencimento e pagamento; dentro da carência → sem encargos; passada a carência,
  // multa = pct(principal, multa) e juros simples = principal × juros a.m. × dias ÷ 30 contando TODOS os dias de atraso
  // (a carência não é descontada). Pagamento antecipado → 0 dias.
  it("suggestLateCharges — multa, juros pro rata e carência", () => {
    expect(suggestLateCharges("2026-09-01", "2026-10-01", 100000, LATE_DEFAULTS)).toEqual({ daysLate: 30, fine: 2000, interest: 1000 });
    expect(suggestLateCharges("2026-09-01", "2026-09-16", 33333, LATE_DEFAULTS)).toEqual({ daysLate: 15, fine: 667, interest: 167 });
    expect(suggestLateCharges("2026-09-01", "2026-09-04", 10000, { ...LATE_DEFAULTS, graceDays: 3 })).toEqual({ daysLate: 3, fine: 0, interest: 0 });
    expect(suggestLateCharges("2026-09-01", "2026-09-05", 10000, { ...LATE_DEFAULTS, graceDays: 3 })).toEqual({ daysLate: 4, fine: 200, interest: 13 });
    expect(suggestLateCharges("2026-09-01", "2026-08-20", 10000, LATE_DEFAULTS)).toEqual({ daysLate: 0, fine: 0, interest: 0 });
    expect(suggestLateCharges("2026-09-01", "2026-09-02", 1, LATE_DEFAULTS)).toEqual({ daysLate: 1, fine: 0, interest: 0 });
    expect(suggestLateCharges("2026-09-01", "2026-09-02", 0, LATE_DEFAULTS)).toEqual({ daysLate: 1, fine: 0, interest: 0 });
    expect(suggestLateCharges("2026-01-31", "2026-03-31", 12345, { fineBps: 1000, interestMonthlyBps: 333, graceDays: 0 })).toEqual({ daysLate: 59, fine: 1235, interest: 808 });
    expect(suggestLateCharges("2026-09-01", "2027-09-01", 100000, LATE_DEFAULTS)).toEqual({ daysLate: 365, fine: 2000, interest: 12167 });
    // a cópia do formulário (cliente) produz os mesmos valores
    expect(clientLateCharges("2026-09-01", "2026-09-16", 33333, LATE_DEFAULTS)).toEqual({ daysLate: 15, fine: 667, interest: 167 });
    expect(clientLateCharges("2026-01-31", "2026-03-31", 12345, { fineBps: 1000, interestMonthlyBps: 333, graceDays: 0 })).toEqual({ daysLate: 59, fine: 1235, interest: 808 });
  });
});

// ═════════════════════════════ 7. Fiscal (src/domain/fiscal/service.ts, src/domain/fiscal/calc.ts)

describe("baseline — fiscal: CFOP padrão, NFS-e e totais", () => {
  // Regra: venda usa o CFOP do grupo (interno/interestadual) ou 5102/6102; devolução de venda 1202/2202 (ou o do grupo,
  // trocando o 1º dígito por 2 se interestadual); ST (CFOP 54xx ou CST/CSOSN 500/60/10/30/70) muda devolução ao
  // fornecedor (x411), transferência (x409) e compra (x403); "other" sem grupo devolve string vazia.
  it("defaultCfop", () => {
    expect([defaultCfop("sale", false, null), defaultCfop("sale", true, null)]).toEqual(["5102", "6102"]);
    expect([defaultCfop("sale", false, { cfopInternal: "5405", cfopInterstate: "6404" } as any), defaultCfop("sale", true, { cfopInternal: "5102" } as any)]).toEqual(["5405", "6102"]);
    expect([
      defaultCfop("sale_return", false, null), defaultCfop("sale_return", true, null), defaultCfop("sale_return", false, { cfopReturn: "1411" } as any), defaultCfop("sale_return", true, { cfopReturn: "1411" } as any),
    ]).toEqual(["1202", "2202", "1411", "2411"]);
    expect([defaultCfop("supplier_return", false, null), defaultCfop("supplier_return", true, { cstCsosn: "500" } as any), defaultCfop("supplier_return", false, { cfopInternal: "5405" } as any)]).toEqual(["5202", "6411", "5411"]);
    expect([defaultCfop("transfer", false, null), defaultCfop("transfer", true, { cstCsosn: "60" } as any)]).toEqual(["5152", "6409"]);
    expect([defaultCfop("purchase", false, null), defaultCfop("purchase", true, null), defaultCfop("purchase", false, { cstCsosn: "10" } as any), defaultCfop("purchase", true, { cfopInternal: "5405" } as any)]).toEqual(["1102", "2102", "1403", "2403"]);
    expect([defaultCfop("other", false, null), defaultCfop("other", true, { cfopInterstate: "6949" } as any)]).toEqual(["", "6949"]);
  });

  // Regra: base ISS = serviços − desconto incondicionado − deduções (mínimo 0); ISS sempre calculado, retido só se o
  // tomador retém; federais = (serviços − desconto) × alíquota, somando só as marcadas como retidas (INSS calculado mas
  // não retido não abate); líquido = serviços − desconto − ISS retido − federais retidos.
  it("calcNfse — ISS e retenções", () => {
    expect(calcNfse({ amount: 100000, issRateBps: 500, issWithheld: false })).toEqual({ base: 100000, iss: 5000, issWithheldValue: 0, issDue: 5000, pis: 0, cofins: 0, inss: 0, ir: 0, csll: 0, federalWithheld: 0, withheld: 0, net: 100000 });
    expect(calcNfse({
      amount: 100000, unconditionalDiscount: 10000, deductions: 5000, issRateBps: 250, issWithheld: true,
      pisBps: 65, cofinsBps: 300, inssBps: 1100, irBps: 150, csllBps: 100, withhold: { pis: true, cofins: true, csll: true, ir: true },
    })).toEqual({ base: 85000, iss: 2125, issWithheldValue: 2125, issDue: 0, pis: 585, cofins: 2700, inss: 9900, ir: 1350, csll: 900, federalWithheld: 5535, withheld: 7660, net: 82340 });
    // resto de centavo: 2,01% de 33,33 = 0,6699 → 0,67; PIS 0,65% → 0,2166 → 0,22
    expect(calcNfse({ amount: 3333, issRateBps: 201, issWithheld: true, pisBps: 65, cofinsBps: 300, withhold: { pis: true } })).toEqual({ base: 3333, iss: 67, issWithheldValue: 67, issDue: 0, pis: 22, cofins: 100, inss: 0, ir: 0, csll: 0, federalWithheld: 22, withheld: 89, net: 3244 });
    // deduções acima do valor → base 0; desconto de 100% → tudo zero
    expect(calcNfse({ amount: 1000, deductions: 5000, issRateBps: 500, issWithheld: false })).toMatchObject({ base: 0, iss: 0, net: 1000 });
    expect(calcNfse({ amount: 1000, unconditionalDiscount: 1000, issRateBps: 500, issWithheld: true })).toMatchObject({ base: 0, iss: 0, withheld: 0, net: 0 });
    expect(() => calcNfse({ amount: 1000, unconditionalDiscount: 1001, issRateBps: 500, issWithheld: false })).toThrow("Desconto incondicionado não pode exceder o valor dos serviços.");
  });

  // Regra: totais = soma dos itens; seguro: soma dos itens OU (se zero) o `extra.insurance`.
  // ATENÇÃO (comportamento atual): `extra.freight` e `extra.other` são ignorados (só o seguro tem fallback no extra).
  it("computeTotals", () => {
    const di = (o: Partial<DocItem>): DocItem => ({
      seq: 1, code: "x", description: "x", ncm: "", cfop: "5102", unit: "UN", qty: 1000, unitPrice: 0, gross: 0, discount: 0, freight: 0, other: 0, total: 0,
      origin: "0", cstCsosn: "102", icmsRateBps: 0, icmsBase: 0, icms: 0, pisCst: "49", pis: 0, cofinsCst: "49", cofins: 0, ...o,
    });
    expect(computeTotals([
      di({ gross: 10000, discount: 500, freight: 300, other: 20, icmsBase: 9820, icms: 1768, pis: 65, cofins: 300, approxTax: 1000 }),
      di({ gross: 5000, freight: 200, insurance: 10 }),
    ], { insurance: 999 })).toEqual({ products: 15000, discount: 500, freight: 500, insurance: 10, other: 20, icmsBase: 9820, icms: 1768, pis: 65, cofins: 300, approxTax: 1000, total: 15030 });
    expect(computeTotals([di({ gross: 10000 })], { insurance: 999, freight: 777, other: 555 })).toMatchObject({ freight: 0, insurance: 999, other: 0, total: 10999 });
  });
});

// ═════════════════════════════ 8. Margem × markup do cadastro de preços (src/domain/pricing.ts)

describe("baseline — priceMetrics (margem × markup)", () => {
  // Regra: margem sobre o preço, markup sobre o custo, lucro = preço − custo; preço ≤ 0 → margem nula; custo ≤ 0 → markup nulo.
  it("priceMetrics", () => {
    expect(priceMetrics(4990, 1890)).toEqual({ marginBps: 6212, markupBps: 16402, profit: 3100 });
    expect(priceMetrics(1000, 1000)).toEqual({ marginBps: 0, markupBps: 0, profit: 0 });
    expect(priceMetrics(1000, 0)).toEqual({ marginBps: 10000, markupBps: null, profit: 1000 });
    expect(priceMetrics(0, 500)).toEqual({ marginBps: null, markupBps: -10000, profit: -500 });
    expect(priceMetrics(null, 100)).toEqual({ marginBps: null, markupBps: null, profit: null });
    expect(priceMetrics(1000, 1500)).toEqual({ marginBps: -5000, markupBps: -3333, profit: -500 });
  });
});

// ═════════════════════════════ 9. Fluxos com banco em memória (padrão dos testes de domínio)

describe("baseline — fluxos com banco (venda, caixa, financeiro, fiscal, estoque)", () => {
  let store: MemoryStore;
  let refs: DemoRefs;
  let admin: Ctx;
  let terminalId: string;

  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    admin = await refs.ctxFor("admin", "matriz");
    terminalId = refs.terminals.cx1.id;
  });

  // Regra (servidor = PDV): preço digitado abaixo da tabela → desconto do item ((29,90 − 25,00) × 3 = 14,70); acima → novo
  // preço; desconto global 3,33% sobre o líquido (125,00 → 4,16) e acréscimo global 0,07 rateados pelo líquido.
  it("prepareSale — descontos, acréscimos e atacado", async () => {
    await openSession(admin, { terminalId, openingFund: 0 });
    const p1 = await prepareSale(admin, {
      idemKey: "p1", terminalId, payments: [], globalDiscountBps: 333, surcharge: 7,
      items: [{ skuId: refs.skus["meia-u"].id, qty: 3000, unitPrice: 2500 }, { skuId: refs.skus["bone-u"].id, qty: 1000, unitPrice: 5000, itemSurcharge: 10 }],
    });
    expect(p1.calc.items.map((i) => [i.unitPrice, i.grossTotal, i.itemDiscount, i.globalDiscount, i.surcharge, i.total])).toEqual([
      [2990, 8970, 1470, 250, 4, 7254],
      [5000, 5000, 0, 166, 13, 4847],
    ]);
    expect([p1.calc.subtotal, p1.calc.itemDiscounts, p1.calc.globalDiscount, p1.calc.discountTotal, p1.calc.surchargeTotal, p1.calc.total]).toEqual([13970, 1470, 416, 1886, 17, 12101]);
    // 12 meias atingem o mínimo do atacado (23,90)
    const p2 = await prepareSale(admin, { idemKey: "p2", terminalId, payments: [], items: [{ skuId: refs.skus["meia-u"].id, qty: 12000 }] });
    expect([p2.calc.items[0].unitPrice, p2.calc.total]).toEqual([2390, 28680]);
    // desconto de 100%: o servidor recusa venda com total zero
    await expect(prepareSale(admin, { idemKey: "p3", terminalId, payments: [], items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], globalDiscountBps: 10000 })).rejects.toThrow("Total da venda deve ser positivo.");
  });

  // Regra: troco = recebido − aplicado (gravado no pagamento e na venda); custo da venda = custo médio × qtd;
  // cartão: taxa = pct(valor, feeBps) sobre o total, recebível parcelado com sobra na 1ª, 1º vencimento = data + prazo
  // de liquidação (dias) e os seguintes por mês-calendário; crediário 30/60/90: meses-calendário a partir da data da venda.
  it("finalizeSale — troco, custo, taxa de cartão e parcelas", async () => {
    await openSession(admin, { terminalId, openingFund: 10000 });
    const s1 = await finalizeSale(admin, { idemKey: "s1", terminalId, items: [{ skuId: refs.skus["caneca-u"].id, qty: 3000 }], globalDiscount: 1, payments: [{ methodId: refs.methods.dinheiro.id, amount: 10469, received: 20000 }] });
    expect({ subtotal: s1.subtotal, discountTotal: s1.discountTotal, total: s1.total, changeAmount: s1.changeAmount, paidTotal: s1.paidTotal, costTotal: s1.costTotal })
      .toEqual({ subtotal: 10470, discountTotal: 1, total: 10469, changeAmount: 9531, paidTotal: 10469, costTotal: 3750 });
    expect((await listAll(store, "sale_payments", { filters: [["eq", "saleId", s1.id]] })).map((p) => [p.amount, p.received, p.change])).toEqual([[10469, 20000, 9531]]);

    const s2 = await finalizeSale(admin, {
      idemKey: "s2", terminalId, customerId: refs.customers.maria.id, items: [{ skuId: refs.skus["fone-u"].id, qty: 1000 }],
      payments: [{ methodId: refs.methods.credito.id, amount: 10000, installments: 3, nsu: "1" }, { methodId: refs.methods.crediario.id, amount: 4990, paymentTermId: refs.terms["30-60-90"].id }],
    });
    const date = toLocalDate(s2.completedAt);
    const pays = (await listAll(store, "sale_payments", { filters: [["eq", "saleId", s2.id]] })).sort((a, b) => a.seq - b.seq);
    const card1 = addDays(date, 30);
    expect(pays.map((p) => ({ kind: p.methodKind, amount: p.amount, fee: p.feeAmount, net: p.netAmount, dues: p.dueDates.map((d: any) => [d.amount, d.dueDate]) }))).toEqual([
      { kind: "credit", amount: 10000, fee: 309, net: 9691, dues: [[3334, card1], [3333, addMonths(card1, 1)], [3333, addMonths(card1, 2)]] },
      { kind: "crediario", amount: 4990, fee: 0, net: 4990, dues: [[1664, addMonths(date, 1)], [1663, addMonths(date, 2)], [1663, addMonths(date, 3)]] },
    ]);
    expect(s2.costTotal).toBe(5900);
  });

  // Regra: devolução parcial = roundDiv(total do item × qtd devolvida ÷ qtd vendida); a devolução do RESTANTE fecha
  // os centavos (total do item − já devolvido): 74,69 → 24,90 + 49,79.
  it("processReturn — valor proporcional com fechamento de centavos", async () => {
    await openSession(admin, { terminalId, openingFund: 10000 });
    const s = await finalizeSale(admin, { idemKey: "s3", terminalId, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000 }], globalDiscount: 1, payments: [{ methodId: refs.methods.pix.id, amount: 7469, reference: "E2E" }] });
    const [line] = await returnableItems(store, s.id);
    expect([line.total, line.unitNet]).toEqual([7469, 2490]);
    const r1 = await processReturn(admin, { saleId: s.id, idemKey: "r1", reason: "x", compensation: "refund", refundMethod: "cash", terminalId, items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    const r2 = await processReturn(admin, { saleId: s.id, idemKey: "r2", reason: "x", compensation: "refund", refundMethod: "cash", terminalId, items: [{ saleItemId: line.id, qty: 2000, condition: "resellable" }] });
    expect([r1.itemsTotal, r1.compensatedAmount, r2.itemsTotal, r2.compensatedAmount]).toEqual([2490, 2490, 4979, 4979]);
  });

  // Regra do fechamento: dinheiro previsto = fundo + vendas em dinheiro (valor aplicado, já sem troco) + suprimentos
  // − sangrias − devoluções em espécie (+ ajustes); demais meios = soma aplicada por meio (inclui crediário, para conferência
  // dos comprovantes). Troco não é deduzido de novo.
  it("expectedOf — previsto do fechamento de caixa", async () => {
    const sess = await openSession(admin, { terminalId, openingFund: 10000 });
    await finalizeSale(admin, { idemKey: "c1", terminalId, items: [{ skuId: refs.skus["caneca-u"].id, qty: 3000 }], globalDiscount: 1, payments: [{ methodId: refs.methods.dinheiro.id, amount: 10469, received: 20000 }] });
    await finalizeSale(admin, {
      idemKey: "c2", terminalId, customerId: refs.customers.maria.id, items: [{ skuId: refs.skus["fone-u"].id, qty: 1000 }],
      payments: [{ methodId: refs.methods.credito.id, amount: 10000, installments: 3, nsu: "1" }, { methodId: refs.methods.crediario.id, amount: 4990, paymentTermId: refs.terms["30-60-90"].id }],
    });
    const s3 = await finalizeSale(admin, { idemKey: "c3", terminalId, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000 }], globalDiscount: 1, payments: [{ methodId: refs.methods.pix.id, amount: 7469, reference: "E2E" }] });
    const [line] = await returnableItems(store, s3.id);
    await processReturn(admin, { saleId: s3.id, idemKey: "cr1", reason: "x", compensation: "refund", refundMethod: "cash", terminalId, items: [{ saleItemId: line.id, qty: 3000, condition: "resellable" }] });
    await addCashMovement(admin, { sessionId: sess.id, type: "supply", amount: 5000, reason: "troco", idemKey: "sup1" });
    await addCashMovement(admin, { sessionId: sess.id, type: "withdrawal", amount: 3000, reason: "sangria", idemKey: "wd1" });
    const summary = await sessionSummary(admin, sess.id);
    expect(summary.totals).toEqual({ sales: 32928, salesCount: 3, supply: 5000, withdrawal: 3000, refunds: 7469, change: 9531, cashSales: 10469, opening: 10000 });
    expect(summary.expected).toEqual({ cash: 15000 });
    expect(expectedOf(summary)).toEqual({ cash: 15000, credit: 10000, crediario: 4990, pix: 7469 });
  });

  // Regra: parâmetros de atraso = padrão (2% multa, 1% a.m., 0 dia) sobrescrito pelo parâmetro "finance.late".
  // ATENÇÃO (comportamento atual): o valor da FILIAL substitui o objeto inteiro da empresa (não mescla campo a campo):
  // filial com só { graceDays: 5 } perde a multa de 10% configurada na empresa e volta para 2%.
  it("lateChargeParams — padrão, empresa e filial", async () => {
    const companyId = refs.company.id;
    expect(await lateChargeParams(store, companyId, null)).toEqual({ fineBps: 200, interestMonthlyBps: 100, graceDays: 0 });
    await setSetting(store, companyId, null, "finance.late", { fineBps: 1000 });
    expect(await lateChargeParams(store, companyId, refs.branches.matriz.id)).toEqual({ fineBps: 1000, interestMonthlyBps: 100, graceDays: 0 });
    await setSetting(store, companyId, refs.branches.matriz.id, "finance.late", { graceDays: 5 });
    expect(await lateChargeParams(store, companyId, refs.branches.matriz.id)).toEqual({ fineBps: 200, interestMonthlyBps: 100, graceDays: 5 });
    expect(await lateChargeParams(store, companyId, refs.branches.shopping.id)).toEqual({ fineBps: 1000, interestMonthlyBps: 100, graceDays: 0 });
  });

  // Regra da baixa: total = principal − desconto + juros + multa; a conta recebe total − tarifa; o saldo da parcela cai
  // pelo PRINCIPAL inteiro (o desconto quita sem entrada de dinheiro); título 100,00 em 3x = 33,34 + 33,33 + 33,33.
  it("settleInstallment — principal, juros, multa, desconto e tarifa", async () => {
    const fin = await refs.ctxFor("finance", "matriz");
    const t = await createManualTitle(fin, {
      kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: "Serviço", issueDate: "2026-10-01", competenceDate: "2026-10-01",
      installments: buildSchedule(10000, { installments: 3, firstDueDays: 30, intervalDays: 30 }, "2026-10-01"), idemKey: "t1",
    });
    const insts = await listAll(store, "installments", { filters: [["eq", "titleId", t.id]], orderBy: [{ field: "number", dir: "asc" }] });
    expect(insts.map((i) => [i.amount, i.dueDate])).toEqual([[3334, "2026-11-01"], [3333, "2026-12-01"], [3333, "2027-01-01"]]);
    const bank = refs.accounts.banco.id;
    const before = (await store.getOrThrow("financial_accounts", bank)).balance;
    const st = await settleInstallment(fin, { installmentId: insts[0].id, date: "2026-11-15", principal: 3334, interest: 50, fine: 67, discount: 100, fee: 12, accountId: bank, idemKey: "st1" });
    expect(st.total).toBe(3351);
    expect((await store.getOrThrow("financial_accounts", bank)).balance - before).toBe(3339);
    const inst = await store.getOrThrow("installments", insts[0].id);
    expect({ paid: inst.paid, balance: inst.balance, status: inst.status, interest: inst.interest, fine: inst.fine, discount: inst.discount }).toEqual({ paid: 3334, balance: 0, status: "paid", interest: 50, fine: 67, discount: 100 });
    const title = await store.getOrThrow("titles", t.id);
    expect([title.balance, title.status]).toEqual([6666, "partial"]);
  });

  // Regra (Simples Nacional, regime do seed): sem ICMS/PIS/COFINS destacados; frete/seguro/outras rateados pelo líquido
  // (bruto − desconto) com maior resto; CFOP do grupo do produto (fone = grupo ST → 5405).
  it("buildItems — Simples: rateio de frete/seguro/outras", async () => {
    const items = await buildItems(admin, [
      { skuId: refs.skus["meia-u"].id, qty: 3000, unitPrice: 2990, discount: 100 },
      { skuId: refs.skus["fone-u"].id, qty: 1000, unitPrice: 14990, discount: 0 },
      { skuId: refs.skus["bone-u"].id, qty: 1500, unitPrice: 4490, discount: 0 },
    ], { freight: 1001, insurance: 2, other: 333, branchId: refs.branches.matriz.id, kind: "sale" });
    expect(items.map((i) => [i.cfop, i.cstCsosn, i.gross, i.discount, i.freight, i.insurance, i.other, i.total, i.icms, i.pis, i.cofins])).toEqual([
      ["5102", "102", 8970, 100, 290, 1, 97, 9258, 0, 0, 0],
      ["5405", "500", 14990, 0, 491, 1, 163, 15645, 0, 0, 0],
      ["5102", "102", 6735, 0, 220, 0, 73, 7028, 0, 0, 0],
    ]);
    expect(computeTotals(items)).toMatchObject({ products: 30695, discount: 100, freight: 1001, insurance: 2, other: 333, total: 31931 });
  });

  // Regra (regime normal): ICMS só para CST 00/20; CST 20 reduz a base pelo pRedBC do grupo; base ICMS inclui frete;
  // PIS/COFINS e tributos aproximados sobre o líquido do item (com frete). A alíquota do grupo é usada também na
  // operação interestadual.
  // ATENÇÃO (comportamento atual): CST 10 (tributada com ST) fica com ICMS próprio 0; base PIS/COFINS inclui o ICMS.
  it("buildItems — regime normal: CST 20 com redução, CST 00 e CST 10", async () => {
    await store.update("companies", refs.company.id, { regime: "normal", crt: "3" });
    const tg = await store.create("tax_groups", {
      companyId: refs.company.id, name: "Normal CST 20", regime: "normal", cfopInternal: "5102", cfopInterstate: "6102", cfopReturn: "1202", cstCsosn: "20",
      icmsRateBps: 1800, icmsBaseReductionBps: 3333, pisCst: "01", pisRateBps: 165, cofinsCst: "01", cofinsRateBps: 760, approxTaxBps: 3145, active: true,
    });
    const items = await buildItems(admin, [
      { skuId: refs.skus["meia-u"].id, qty: 3000, unitPrice: 2990, discount: 100, taxGroupId: tg.id },
      { skuId: refs.skus["bone-u"].id, qty: 1000, unitPrice: 4490, discount: 0, taxGroupId: tg.id, cstOverride: "00" },
      { skuId: refs.skus["caneca-u"].id, qty: 1000, unitPrice: 3490, discount: 0, taxGroupId: tg.id, cstOverride: "10" },
    ], { freight: 500, branchId: refs.branches.matriz.id, kind: "sale", interstate: true });
    expect(items.map((i) => [i.cfop, i.cstCsosn, i.gross, i.total, i.icmsBaseReductionBps, i.icmsBase, i.icms, i.pis, i.cofins, i.approxTax])).toEqual([
      ["6102", "20", 8970, 9133, 3333, 6089, 1096, 151, 694, 2872],
      ["6102", "00", 4490, 4623, 0, 4623, 832, 76, 351, 1454],
      ["6102", "10", 3490, 3594, 0, 0, 0, 59, 273, 1130],
    ]);
  });

  // Regra do custo médio: entrada de compra/inicial/ajuste de entrada etc. recalcula
  // médio = (saldo⁺ × médio + qtd × custo) ÷ (saldo⁺ + qtd) arredondado; saída usa o médio vigente e não altera o médio;
  // entrada de devolução ("return") NÃO recalcula o médio (registra o custo informado); saldo negativo conta como 0 na
  // base (a entrada redefine o médio = custo da entrada); idemKey repetida é ignorada.
  // ATENÇÃO (comportamento atual): saída com unitCost informado registra esse custo (não o médio) no movimento.
  it("postMovements — custo médio", async () => {
    const sku = refs.skus["bone-u"];
    const wh = refs.warehouses["matriz-main"].id;
    const b0 = await store.getOrThrow("stock_balances", balanceId(wh, sku.id));
    expect([b0.physical, b0.avgCost]).toEqual([15000, 1500]);
    const mv = async (qty: number, type: MovementType, unitCost: number | null, idemKey: string, allowNegative = false) => {
      const [m] = await postMovements(admin, [{ warehouseId: wh, skuId: sku.id, qty, type, unitCost, idemKey, allowNegative }]);
      return m ? [m.balanceBefore, m.balanceAfter, m.unitCost, m.totalCost, m.avgCostAfter] : null;
    };
    // 15 × 15,00 + 10 × 18,00 → 25 un a 16,20
    expect(await mv(10000, "purchase", 1800, "b1")).toEqual([15000, 25000, 1800, 18000, 1620]);
    // saída de 5 un ao custo médio
    expect(await mv(-5000, "sale", null, "b2")).toEqual([25000, 20000, 1620, 8100, 1620]);
    // entrada fracionária 0,333 un a 19,99 → médio 16,2621… → 16,26; custo total 6,65667 → 6,66
    expect(await mv(333, "purchase", 1999, "b3")).toEqual([20000, 20333, 1999, 666, 1626]);
    // devolução com custo diferente não mexe no médio
    expect(await mv(1000, "return", 9999, "b4")).toEqual([20333, 21333, 9999, 9999, 1626]);
    // saída com custo informado
    expect(await mv(-1000, "adjust_out", 5, "b5")).toEqual([21333, 20333, 5, 5, 1626]);
    // saída que deixa o saldo negativo (permitido explicitamente)
    expect(await mv(-100000, "sale", null, "b6", true)).toEqual([20333, -79667, 1626, 162600, 1626]);
    // entrada com saldo negativo: base 0 → médio = custo da entrada
    expect(await mv(2000, "purchase", 2500, "b7")).toEqual([-79667, -77667, 2500, 5000, 2500]);
    // entrada a custo zero com saldo negativo zera o médio
    expect(await mv(1000, "purchase", 0, "b8")).toEqual([-77667, -76667, 0, 0, 0]);
    // mesma chave de idempotência: ignorado
    expect(await mv(1000, "purchase", 3000, "b1")).toBeNull();
    const b1 = await store.getOrThrow("stock_balances", balanceId(wh, sku.id));
    expect([b1.physical, b1.avgCost]).toEqual([-76667, 0]);
  });
});
