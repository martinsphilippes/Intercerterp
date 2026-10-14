import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import { runDueJobs } from "@/lib/core/jobs";
import { setSetting, isFeatureOn, featureDefault } from "@/lib/core/settings";
import { addDays, today } from "@/lib/dates";
import { QTY } from "@/lib/money";
import { openSession } from "@/domain/cash";
import { finalizeSale, prepareSale, cancelSale, processReturn, type FinalizeSaleInput } from "@/domain/sales";
import { createCart, saveCart, cartToSaleInput } from "@/domain/carts";
import { cartTotals } from "@/domain/cart-calc";
import { calcSale } from "@/domain/pricing-calc";
import { applyPromotions, promoClock, promoLiveAt, promotionProblem, type PromoClock, type PromoRule } from "@/domain/promotions-calc";
import { livePromotionRules, savePromotion, setPromotionActive, toPromoRule } from "@/domain/promotions";
import { LOYALTY_METHOD_ID, loyaltyBalance, pointsFor, pointsForAmount } from "@/domain/loyalty";
import { PARAM_MAP } from "@/app/(app)/administracao/parametros/catalog";
import { seed as seedPromotions } from "@/domain/seed/modules/promotions";

/**
 * Fase 6 — promoções (CAD-15) e fidelidade (CAD-21).
 * Regras em docs/regras-assumidas.md §30.
 */

const TUESDAY: PromoClock = { date: "2026-10-13", weekday: 2, time: "10:00" };
const WEDNESDAY: PromoClock = { date: "2026-10-14", weekday: 3, time: "10:00" };

const rule = (r: Partial<PromoRule>): PromoRule => ({ id: "r1", name: "Regra", kind: "buy_x_pay_y", scope: "sku", targetIds: ["A"], active: true, ...r });

describe("promoções — cálculo puro", () => {
  const l3p2 = rule({ buyQty: 3 * QTY, payQty: 2 * QTY, name: "Leve 3 pague 2" });

  it("leve 3 pague 2 com 2, 3 e 7 unidades", () => {
    const at = (qty: number) => applyPromotions([{ skuId: "A", qty, unitPrice: 1000 }], [l3p2], TUESDAY)[0];
    expect(at(2 * QTY).promoDiscount).toBe(0);
    expect(at(3 * QTY)).toEqual({ promoDiscount: 1000, promoId: "r1", promoName: "Leve 3 pague 2" });
    expect(at(7 * QTY).promoDiscount).toBe(2000); // 2 grupos de 3 → 2 grátis; a 7ª unidade paga cheia
  });

  it("linhas do mesmo SKU somam para a contagem; a unidade grátis é a de menor preço", () => {
    const r = applyPromotions([{ skuId: "A", qty: 2 * QTY, unitPrice: 1200 }, { skuId: "A", qty: QTY, unitPrice: 1000 }, { skuId: "B", qty: 3 * QTY, unitPrice: 500 }], [l3p2], TUESDAY);
    expect(r.map((x) => x.promoDiscount)).toEqual([0, 1000, 0]);
  });

  it("faixa por quantidade: a partir de N preço Z ou P%", () => {
    const z = rule({ kind: "min_qty", minQty: 6 * QTY, promoPrice: 850 });
    expect(applyPromotions([{ skuId: "A", qty: 5 * QTY, unitPrice: 1000 }], [z], TUESDAY)[0].promoDiscount).toBe(0);
    expect(applyPromotions([{ skuId: "A", qty: 6 * QTY, unitPrice: 1000 }], [z], TUESDAY)[0].promoDiscount).toBe(900);
    // preço promocional maior que o de tabela/atacado não vira acréscimo
    expect(applyPromotions([{ skuId: "A", qty: 6 * QTY, unitPrice: 800 }], [z], TUESDAY)[0].promoDiscount).toBe(0);
    const p = rule({ kind: "min_qty", minQty: QTY, percentBps: 1000, scope: "category", targetIds: ["CAT"] });
    expect(applyPromotions([{ skuId: "A", categoryId: "CAT", qty: 1500, unitPrice: 999 }], [p], TUESDAY)[0].promoDiscount).toBe(150); // 10% de 14,99 (1,5 × 9,99)
  });

  it("várias regras não se acumulam: vale a de maior desconto", () => {
    const pctRule = rule({ id: "r2", kind: "min_qty", minQty: QTY, percentBps: 1000, name: "10%" });
    const r = applyPromotions([{ skuId: "A", qty: 3 * QTY, unitPrice: 1000 }], [pctRule, l3p2], TUESDAY)[0];
    expect(r).toEqual({ promoDiscount: 1000, promoId: "r1", promoName: "Leve 3 pague 2" });
  });

  it("dia da semana, horário, vigência, filial e ativa/inativa", () => {
    const terca = rule({ weekdays: [2], startTime: "08:00", endTime: "18:00" });
    expect(promoLiveAt(terca, TUESDAY)).toBe(true);
    expect(promoLiveAt(terca, WEDNESDAY)).toBe(false);
    expect(promoLiveAt(terca, { ...TUESDAY, time: "18:00" })).toBe(false); // fim exclusivo
    expect(promoLiveAt(rule({ startTime: "22:00", endTime: "02:00" }), { ...TUESDAY, time: "01:30" })).toBe(true); // atravessa a meia-noite
    expect(promoLiveAt(rule({ validFrom: "2026-10-14" }), TUESDAY)).toBe(false);
    expect(promoLiveAt(rule({ validTo: "2026-10-12" }), TUESDAY)).toBe(false);
    expect(promoLiveAt(rule({ validFrom: "2026-10-13", validTo: "2026-10-13" }), TUESDAY)).toBe(true);
    expect(promoLiveAt(rule({ branchId: "F1" }), TUESDAY, "F2")).toBe(false);
    expect(promoLiveAt(rule({ active: false }), TUESDAY)).toBe(false);
    expect(promoClock("2026-10-13T13:30:00Z", "America/Sao_Paulo")).toEqual({ date: "2026-10-13", weekday: 2, time: "10:30" });
  });

  it("validação do cadastro", () => {
    expect(promotionProblem({ ...l3p2, payQty: 3 * QTY })).toMatch(/menor/);
    expect(promotionProblem({ ...l3p2, buyQty: 2500 })).toMatch(/inteiro/);
    expect(promotionProblem(rule({ kind: "min_qty", minQty: QTY }))).toMatch(/um dos dois/);
    expect(promotionProblem(rule({ kind: "min_qty", minQty: QTY, promoPrice: 100, scope: "category" }))).toMatch(/categoria/);
    expect(promotionProblem(l3p2)).toBeNull();
  });

  it("calcSale: promoção entra como desconto do item, sem mudar o arredondamento nem o rateio", () => {
    const sem = calcSale([{ qty: 3000, unitPrice: 2990, itemDiscount: 2990 }, { qty: 1000, unitPrice: 1000 }], { globalDiscount: 100 });
    const com = calcSale([{ qty: 3000, unitPrice: 2990, promoDiscount: 2990 }, { qty: 1000, unitPrice: 1000 }], { globalDiscount: 100 });
    expect(com.total).toBe(sem.total);
    expect(com.items.map((i) => [i.itemDiscount, i.globalDiscount, i.total])).toEqual(sem.items.map((i) => [i.itemDiscount, i.globalDiscount, i.total]));
    expect(com.promoDiscount).toBe(2990);
    expect(com.items[0].promoDiscount).toBe(2990);
    expect(sem.promoDiscount).toBe(0);
  });
});

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let admin: Ctx;
let terminalId: string;

async function sale(input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }, ctx = cashier) {
  return finalizeSale(ctx, { terminalId, ...input });
}

describe("promoções na venda (PDV)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    admin = await refs.ctxFor("admin", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("sem promoção cadastrada a venda é idêntica (nenhum campo novo no item)", async () => {
    const s = await sale({ idemKey: "sem-promo", items: [{ skuId: refs.skus["meia-u"].id, qty: 3000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 8970 }] });
    expect(s.total).toBe(8970);
    const [item] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(item.promoDiscount ?? null).toBeNull();
    expect(item.promoId ?? null).toBeNull();
  });

  it("leve 3 pague 2: desconto explícito no item, fora do limite do operador, totais iguais no atendimento e na venda", async () => {
    const meia = refs.skus["meia-u"];
    const promo = await savePromotion(admin, { name: "Meias — leve 3, pague 2", kind: "buy_x_pay_y", scope: "sku", targetIds: [meia.id], buyQty: 3000, payQty: 2000, idemKey: "t1" });
    // repetir o cadastro com a mesma chave não duplica
    expect((await savePromotion(admin, { name: "Meias — leve 3, pague 2", kind: "buy_x_pay_y", scope: "sku", targetIds: [meia.id], buyQty: 3000, payQty: 2000, idemKey: "t1" })).id).toBe(promo.id);
    // atendimento (cart-calc no PDV) com as mesmas regras
    const cart = await createCart(cashier, terminalId);
    const items = [{ skuId: meia.id, qty: 7000, listPrice: 2990, productId: meia.productId, categoryId: refs.categories["Acessórios"].id }];
    const saved = await saveCart(cashier, cart.id, { items, globalDiscount: 300 });
    const rules = await livePromotionRules(store, refs.company.id, refs.branches.matriz.id);
    const totals = cartTotals(saved, { rules, branchId: refs.branches.matriz.id });
    // 7 × 29,90 = 209,30 − 2 grátis (59,80) = 149,50 − 3,00 geral = 146,50
    expect(totals.promoDiscount).toBe(5980);
    expect(totals.total).toBe(14650);
    expect(saved.total).toBe(14650); // total gravado no atendimento já com a promoção
    // 33% de desconto de promoção com limite de 5% do Caixa: só o desconto manual (3,00) conta
    const s = await finalizeSale(cashier, cartToSaleInput(saved, [{ methodId: refs.methods.dinheiro.id, amount: totals.total }]));
    expect(s.total).toBe(totals.total);
    expect(s.discountTotal).toBe(totals.discountTotal);
    const [item] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(item).toMatchObject({ promoDiscount: 5980, promoId: promo.id, promoName: "Meias — leve 3, pague 2", itemDiscount: 5980, globalDiscount: 300, total: 14650 });
  });

  it("o desconto manual continua limitado (o limite incide sobre o valor já promocional)", async () => {
    const meia = refs.skus["meia-u"];
    await savePromotion(admin, { name: "L3P2", kind: "buy_x_pay_y", scope: "sku", targetIds: [meia.id], buyQty: 3000, payQty: 2000 });
    // 3 meias = 89,70 − 29,90 (promo) = 59,80; 5% de 59,80 = 2,99 → 3,00 passa do limite
    const items = [{ skuId: meia.id, qty: 3000 }];
    await expect(prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [], globalDiscount: 300 })).rejects.toMatchObject({ code: "discount_limit" });
    const ok = await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [], globalDiscount: 299 });
    expect(ok.calc.total).toBe(5980 - 299);
  });

  it("faixa por quantidade e promoção de terça por categoria (vigência/dia conferidos no servidor)", async () => {
    const caderno = refs.skus["caderno-u"];
    await savePromotion(admin, { name: "Cadernos a partir de 5", kind: "min_qty", scope: "product", targetIds: [caderno.productId], minQty: 5000, promoPrice: 2190 });
    await savePromotion(admin, { name: "Terça da papelaria", kind: "min_qty", scope: "category", targetIds: [refs.categories["Papelaria"].id], minQty: 1000, percentBps: 1000, weekdays: [2] });
    const items = [{ skuId: caderno.id, qty: 5000 }];
    // terça: 10% de 124,50 = 12,45 > (24,90 − 21,90) × 5 = 15,00? não — a faixa dá 15,00 e vence
    const tue = await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [], occurredAt: "2026-10-13T15:00:00Z" });
    expect(tue.calc.promoDiscount).toBe(1500);
    expect(tue.lines[0].promoName).toBe("Cadernos a partir de 5");
    const tue2 = await prepareSale(cashier, { idemKey: "x", terminalId, items: [{ skuId: caderno.id, qty: 2000 }], payments: [], occurredAt: "2026-10-13T15:00:00Z" });
    expect(tue2.calc.promoDiscount).toBe(498); // 10% de 49,80
    const wed = await prepareSale(cashier, { idemKey: "x", terminalId, items: [{ skuId: caderno.id, qty: 2000 }], payments: [], occurredAt: "2026-10-14T15:00:00Z" });
    expect(wed.calc.promoDiscount).toBe(0);
    // venda concluída numa terça grava a regra
    const s = await sale({ idemKey: "terca", items: [{ skuId: caderno.id, qty: 2000 }], occurredAt: "2026-10-13T15:00:00Z", payments: [{ methodId: refs.methods.dinheiro.id, amount: 4482 }] });
    expect(s.total).toBe(4482);
    const [it] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(it.promoName).toBe("Terça da papelaria");
  });

  it("demonstração idempotente: leve 3 pague 2 nas meias e terça da papelaria", async () => {
    await seedPromotions(refs);
    await seedPromotions(refs);
    const rows = await listAll(store, "promotions", { filters: [["eq", "companyId", refs.company.id]] });
    expect(rows.map((r) => r.name).sort()).toEqual(["Meias — leve 3, pague 2", "Terça da papelaria — 10%"]);
    expect(rows.find((r) => r.kind === "min_qty")!.weekdays).toEqual([2]);
    const s = await prepareSale(cashier, { idemKey: "x", terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 3000 }], payments: [] });
    expect(s.calc.promoDiscount).toBe(2990);
  });

  it("inativa ou com recurso desligado: venda sem promoção", async () => {
    const meia = refs.skus["meia-u"];
    const promo = await savePromotion(admin, { name: "L3P2", kind: "buy_x_pay_y", scope: "sku", targetIds: [meia.id], buyQty: 3000, payQty: 2000 });
    const items = [{ skuId: meia.id, qty: 3000 }];
    expect((await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [] })).calc.total).toBe(5980);
    await setPromotionActive(admin, promo.id, false);
    expect((await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [] })).calc.total).toBe(8970);
    await setPromotionActive(admin, promo.id, true);
    await setSetting(store, refs.company.id, null, "feature.promocoes", false);
    expect(await livePromotionRules(store, refs.company.id, refs.branches.matriz.id)).toEqual([]);
    expect((await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [] })).calc.total).toBe(8970);
    expect(toPromoRule(promo).buyQty).toBe(3000);
  });
});

describe("fidelidade (pontos)", () => {
  const maria = () => refs.customers.maria.id;
  const camiseta = () => refs.skus["camiseta-m-preta"].id;
  const pts = async () => (await loyaltyBalance(store, refs.company.id, maria())).points;
  const vouchers = async () => (await listAll(store, "credit_vouchers", { filters: [["eq", "customerId", maria()]] })).filter((v) => v.kind === "loyalty");

  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
    await setSetting(store, refs.company.id, null, "feature.fidelidade", true);
    await setSetting(store, refs.company.id, null, "loyalty.pointsPerReal", 1);
    await setSetting(store, refs.company.id, null, "loyalty.pointValue", 10); // R$ 0,10 por ponto
    await setSetting(store, refs.company.id, null, "loyalty.minRedeemPoints", 10);
    await setSetting(store, refs.company.id, null, "loyalty.validityDays", 30);
  });

  it("parâmetros: promoções ligado e fidelidade desligado por padrão", async () => {
    expect(PARAM_MAP["feature.promocoes"].default).toBe(true);
    expect(PARAM_MAP["feature.fidelidade"].default).toBe(false);
    expect(featureDefault("fidelidade")).toBe(false);
    expect(featureDefault("promocoes")).toBe(true);
    const other = freshStore();
    expect(await isFeatureOn(other, "c", null, "fidelidade", featureDefault("fidelidade"))).toBe(false);
    expect(pointsFor(5990, { pointsPerReal: 1 })).toBe(59);
    expect(pointsForAmount(305, { pointValue: 10 })).toBe(31);
  });

  it("acumula uma única vez na venda identificada (repetição e tarefa durável não duplicam)", async () => {
    const input = { idemKey: "fid-1", customerId: maria(), items: [{ skuId: camiseta(), qty: 2000 }], payments: [{ methodId: refs.methods.pix.id, amount: 9980, reference: "E2E-1" }] };
    const s = await sale(input);
    expect(s.loyaltyPoints).toBe(99);
    await sale(input);
    await runDueJobs(store);
    expect(await vouchers()).toHaveLength(1);
    const [v] = await vouchers();
    expect(v).toMatchObject({ kind: "loyalty", saleId: s.id, balance: 99, originalAmount: 99, status: "active", expiresAt: addDays(today(), 30) });
    expect(await pts()).toBe(99);
    // venda sem cliente não acumula
    const anon = await sale({ idemKey: "fid-anon", items: [{ skuId: camiseta(), qty: 1000 }], payments: [{ methodId: refs.methods.pix.id, amount: 4990, reference: "E2E-2" }] });
    expect(anon.loyaltyPoints ?? null).toBeNull();
  });

  it("devolução estorna proporcionalmente e a última devolução fecha o restante", async () => {
    const s = await sale({ idemKey: "fid-ret", customerId: maria(), items: [{ skuId: camiseta(), qty: 2000 }], payments: [{ methodId: refs.methods.pix.id, amount: 9980, reference: "E2E-3" }] });
    const [item] = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    await processReturn(manager, { saleId: s.id, idemKey: "ret-1", reason: "Tamanho", compensation: "store_credit", items: [{ saleItemId: item.id, qty: 1000, condition: "resellable" }] });
    expect(await pts()).toBe(49); // 99 × 49,90 ÷ 99,80 = 49,5 → 50 estornados
    // repetir os efeitos da devolução não estorna de novo
    await runDueJobs(store);
    await processReturn(manager, { saleId: s.id, idemKey: "ret-1", reason: "Tamanho", compensation: "store_credit", items: [{ saleItemId: item.id, qty: 1000, condition: "resellable" }] });
    expect(await pts()).toBe(49);
    await processReturn(manager, { saleId: s.id, idemKey: "ret-2", reason: "Cor", compensation: "store_credit", items: [{ saleItemId: item.id, qty: 1000, condition: "resellable" }] });
    expect(await pts()).toBe(0);
    expect((await store.getOrThrow("sales", s.id)).loyaltyPointsReversed).toBe(99);
    // o vale-crédito da devolução não é confundido com pontos
    const vales = (await listAll(store, "credit_vouchers", { filters: [["eq", "customerId", maria()]] })).filter((v) => v.kind !== "loyalty");
    expect(vales).toHaveLength(2);
  });

  it("resgate como forma de pagamento (FIFO, mínimo, saldo) e devolução dos pontos no cancelamento", async () => {
    await sale({ idemKey: "fid-a", customerId: maria(), items: [{ skuId: camiseta(), qty: 2000 }], payments: [{ methodId: refs.methods.pix.id, amount: 9980, reference: "E2E-4" }] });
    expect(await pts()).toBe(99);
    const items = [{ skuId: refs.skus["meia-u"].id, qty: 1000 }]; // 29,90
    // abaixo do mínimo (0,50 = 5 pontos)
    await expect(sale({ idemKey: "fid-min", customerId: maria(), items, payments: [{ methodId: LOYALTY_METHOD_ID, amount: 50 }, { methodId: refs.methods.pix.id, amount: 2940, reference: "E2E-5" }] })).rejects.toMatchObject({ code: "loyalty_min" });
    // acima do saldo (99 pontos = 9,90)
    await expect(sale({ idemKey: "fid-max", customerId: maria(), items, payments: [{ methodId: LOYALTY_METHOD_ID, amount: 1000 }, { methodId: refs.methods.pix.id, amount: 1990, reference: "E2E-6" }] })).rejects.toMatchObject({ code: "loyalty_balance" });
    // sem cliente
    await expect(sale({ idemKey: "fid-anon", items, payments: [{ methodId: LOYALTY_METHOD_ID, amount: 500 }, { methodId: refs.methods.pix.id, amount: 2490, reference: "E2E-7" }] })).rejects.toMatchObject({ code: "customer_required" });
    // R$ 5,00 = 50 pontos; os outros R$ 24,90 geram 24 pontos (o pago com pontos não acumula)
    const s = await sale({ idemKey: "fid-red", customerId: maria(), items, payments: [{ methodId: LOYALTY_METHOD_ID, amount: 500 }, { methodId: refs.methods.pix.id, amount: 2490, reference: "E2E-8" }] });
    const pay = (await listAll(store, "sale_payments", { filters: [["eq", "saleId", s.id]] })).find((p) => p.methodKind === "loyalty")!;
    expect(pay).toMatchObject({ methodName: "Pontos de fidelidade", amount: 500, loyaltyPoints: 50 });
    expect(s.loyaltyPoints).toBe(24);
    expect(await pts()).toBe(99 - 50 + 24);
    // cancelamento: devolve os 50 pontos usados e estorna os 24 acumulados
    await cancelSale(manager, s.id, "Desistência");
    expect(await pts()).toBe(99);
    await runDueJobs(store);
    expect(await pts()).toBe(99);
    const moves = await listAll(store, "credit_voucher_moves", { filters: [["eq", "saleId", s.id]] });
    expect(moves.map((m) => m.kind).sort()).toEqual(["earn", "redeem", "restore", "reverse"]);
  });

  it("validade: pontos vencidos saem do saldo e não podem ser resgatados", async () => {
    await sale({ idemKey: "fid-v", customerId: maria(), items: [{ skuId: camiseta(), qty: 1000 }], payments: [{ methodId: refs.methods.pix.id, amount: 4990, reference: "E2E-9" }] });
    expect(await pts()).toBe(49);
    const [v] = await vouchers();
    await store.update("credit_vouchers", v.id, { expiresAt: addDays(today(), -1) });
    expect(await pts()).toBe(0);
    await expect(sale({ idemKey: "fid-v2", customerId: maria(), items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: LOYALTY_METHOD_ID, amount: 100 }, { methodId: refs.methods.pix.id, amount: 2890, reference: "E2E-10" }] })).rejects.toMatchObject({ code: "loyalty_balance" });
    // pontos não são aceitos como vale-crédito pelo código
    await expect(sale({ idemKey: "fid-v3", customerId: maria(), items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.vale.id, amount: 100, voucherCode: v.code }, { methodId: refs.methods.pix.id, amount: 2890, reference: "E2E-11" }] })).rejects.toThrow(/Vale-crédito não encontrado/);
  });

  it("recurso desligado: não acumula e não aceita resgate", async () => {
    await setSetting(store, refs.company.id, null, "feature.fidelidade", false);
    const s = await sale({ idemKey: "fid-off", customerId: maria(), items: [{ skuId: camiseta(), qty: 1000 }], payments: [{ methodId: refs.methods.pix.id, amount: 4990, reference: "E2E-12" }] });
    expect(s.loyaltyPoints ?? null).toBeNull();
    expect(await vouchers()).toHaveLength(0);
    await expect(sale({ idemKey: "fid-off2", customerId: maria(), items: [{ skuId: camiseta(), qty: 1000 }], payments: [{ methodId: LOYALTY_METHOD_ID, amount: 100 }, { methodId: refs.methods.pix.id, amount: 4890, reference: "E2E-13" }] })).rejects.toMatchObject({ code: "feature_off" });
  });
});
