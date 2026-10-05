import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import { runDueJobs } from "@/lib/core/jobs";
import { setSetting } from "@/lib/core/settings";
import { openSession, sessionSummary } from "@/domain/cash";
import { finalizeSale, prepareSale, cancelSale, processReturn, returnableItems, linkExchangeSale, type FinalizeSaleInput } from "@/domain/sales";
import { createPixIntent, checkIntent, simulateIntent } from "@/domain/payments/intents";
import { simulatedPix } from "@/domain/payments/providers";
import { createCart, saveCart, parkCart, resumeCart, cancelCart, ensureOpenCart, cartToSaleInput, listParkedCarts } from "@/domain/carts";
import { cartTotals, previewSchedule } from "@/domain/cart-calc";
import { buildSchedule } from "@/domain/finance";
import { availableMap } from "@/domain/stock";

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;

const avail = async (skuKey: string) => (await availableMap(store, refs.branches.matriz.id, [refs.skus[skuKey].id])).get(refs.skus[skuKey].id)?.available ?? 0;
const balanceOf = async (accountKey: string) => (await store.getOrThrow("financial_accounts", refs.accounts[accountKey].id)).balance;

async function sale(input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }, ctx = cashier) {
  return finalizeSale(ctx, { terminalId, ...input });
}

describe("vendas (PDV)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("venda com múltiplos meios mantém estoque, caixa, financeiro e fiscal coerentes", async () => {
    const meiaBefore = await avail("meia-u");
    const camBefore = await avail("camiseta-m-preta");
    const caixaBefore = await balanceOf("caixa-matriz");
    const pixBefore = await balanceOf("pix");
    // 2 camisetas (49,90) + 1 meia (29,90) = 129,70; desconto global 4,70 → 125,00 (dentro do limite de 5% do perfil Caixa)
    const items = [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 2000 }, { skuId: refs.skus["meia-u"].id, qty: 1000 }];
    const prep = await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [], globalDiscount: 470 });
    expect(prep.calc.total).toBe(12500);
    const s = await sale({
      idemKey: "multi-1", items, globalDiscount: 470, customerId: refs.customers.maria.id,
      payments: [
        { methodId: refs.methods.dinheiro.id, amount: 3000, received: 5000 },
        { methodId: refs.methods.debito.id, amount: 2000, nsu: "123456" },
        { methodId: refs.methods.pix.id, amount: 2500, reference: "E2E123MANUAL" },
        { methodId: refs.methods.crediario.id, amount: 5000, paymentTermId: refs.terms["30-60"].id },
      ],
    });
    expect(s.total).toBe(12500);
    expect(s.discountTotal).toBe(470);
    expect(s.changeAmount).toBe(2000);
    expect(s.paymentStatus).toBe("pending"); // parte a prazo
    // rateio do desconto global fecha os centavos
    const items2 = await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] });
    expect(items2.reduce((a, i) => a + i.total, 0)).toBe(12500);
    expect(items2.reduce((a, i) => a + i.globalDiscount, 0)).toBe(470);
    // estoque
    expect(await avail("meia-u")).toBe(meiaBefore - 1000);
    expect(await avail("camiseta-m-preta")).toBe(camBefore - 2000);
    // caixa: somente o valor aplicado em dinheiro (troco não entra)
    const movs = await listAll(store, "cash_movements", { filters: [["eq", "saleId", s.id]] });
    expect(movs).toHaveLength(1);
    expect(movs[0].amount).toBe(3000);
    expect(await balanceOf("caixa-matriz")).toBe(caixaBefore + 3000);
    expect(await balanceOf("pix")).toBe(pixBefore + 2500);
    // financeiro: recebível de cartão (adquirente) e título do crediário com 2 parcelas
    const titles = await listAll(store, "titles", { filters: [["eq", "originId", s.id]] });
    expect(titles.map((t) => t.originType).sort()).toEqual(["sale", "sale_card"]);
    const cred = titles.find((t) => t.originType === "sale")!;
    expect(cred.total).toBe(5000);
    const insts = await listAll(store, "installments", { filters: [["eq", "titleId", cred.id]] });
    expect(insts.map((i) => i.amount)).toEqual([2500, 2500]);
    const card = titles.find((t) => t.originType === "sale_card")!;
    expect(card.total).toBe(2000);
    const pays = await listAll(store, "sale_payments", { filters: [["eq", "saleId", s.id]] });
    expect(pays.find((p) => p.methodKind === "debit")!.feeAmount).toBe(26); // 1,29% de 20,00
    expect(pays.find((p) => p.methodKind === "pix")!.manual).toBe(true);
    // fiscal: NFC-e criada na fila; só fica autorizada após o retorno do provedor (simulação)
    const doc = await store.getOrThrow("fiscal_documents", (await store.getOrThrow("sales", s.id)).fiscalDocumentId);
    expect(doc.model).toBe("nfce");
    expect(["queued", "processing"]).toContain(doc.status);
    await runDueJobs(store, { limit: 50 });
    const after = await store.getOrThrow("sales", s.id);
    expect(after.fiscalStatus).toBe("authorized");
    // sessão de caixa: previsto por meio
    const sum = await sessionSummary(cashier, s.cashSessionId);
    expect(sum.expected.cash).toBe(10000 + 3000);
    expect(sum.byMethod.debit.expected).toBe(2000);
    expect(sum.byMethod.pix.expected).toBe(2500);
  });

  it("duplo clique e repetição (sequencial e paralela) não duplicam venda, baixa ou movimento", async () => {
    const before = await avail("bone-u");
    const caixaBefore = await balanceOf("caixa-matriz");
    const input = { idemKey: "dup-1", items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490, received: 5000 }] };
    const results = await Promise.all([sale(input), sale(input), sale(input)]);
    const again = await sale(input);
    expect(new Set([...results, again].map((r) => r.id)).size).toBe(1);
    expect(await listAll(store, "sales", { filters: [["eq", "idemKey", "dup-1"]] })).toHaveLength(1);
    expect(await listAll(store, "sale_payments", { filters: [["eq", "saleId", again.id]] })).toHaveLength(1);
    expect(await listAll(store, "cash_movements", { filters: [["eq", "saleId", again.id]] })).toHaveLength(1);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", again.id]] })).toHaveLength(1);
    expect(await listAll(store, "account_entries", { filters: [["eq", "operationId", again.id]] })).toHaveLength(1);
    expect(await avail("bone-u")).toBe(before - 1000);
    expect(await balanceOf("caixa-matriz")).toBe(caixaBefore + 4490);
    const audits = await listAll(store, "audit_logs", { filters: [["eq", "action", "sale.complete"], ["eq", "entityId", again.id]] });
    expect(audits).toHaveLength(1);
  });

  it("Pix: pendente bloqueia, falha permite nova cobrança após consultar a anterior, confirmado conclui uma única vez", async () => {
    const cartId = "cart-pix-1";
    const i1 = await createPixIntent(cashier, { cartId, amount: 4490, description: "teste" });
    expect(i1.status).toBe("pending");
    expect(i1.isSimulated).toBe(true);
    // repetir a geração com a mesma referência pendente não cria outra cobrança
    const i1b = await createPixIntent(cashier, { cartId, amount: 4490, description: "teste" });
    expect(i1b.id).toBe(i1.id);
    const items = [{ skuId: refs.skus["bone-u"].id, qty: 1000 }];
    await expect(sale({ idemKey: "pix-1", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i1.id }] })).rejects.toThrow(/não confirmado/);
    // falha do provedor
    const failed = await simulateIntent(cashier, i1.id, "failed");
    expect(failed.status).toBe("failed");
    await expect(sale({ idemKey: "pix-1", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i1.id }] })).rejects.toThrow(/não confirmado/);
    const i2 = await createPixIntent(cashier, { cartId, amount: 4490, description: "teste" });
    expect(i2.id).not.toBe(i1.id);
    expect(i2.reference).toMatch(/-2$/);
    // timeout/erro de rede: estado "unknown" é consultado antes de recriar e, se pago, é reaproveitado
    await store.update("payment_intents", i2.id, { status: "unknown" });
    simulatedPix().setStatus(i2.reference, "confirmed");
    const i2b = await createPixIntent(cashier, { cartId, amount: 4490, description: "teste" });
    expect(i2b.id).toBe(i2.id);
    expect(i2b.status).toBe("confirmed");
    expect((await listAll(store, "payment_intents", { filters: [["eq", "cartId", cartId]] })).length).toBe(2);
    const checked = await checkIntent(cashier, i2.id);
    expect(checked.status).toBe("confirmed");
    const s = await sale({ idemKey: "pix-1", cartId: null, items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i2.id }] });
    const pay = (await listAll(store, "sale_payments", { filters: [["eq", "saleId", s.id]] }))[0];
    expect(pay.manual).toBe(false);
    expect(pay.intentId).toBe(i2.id);
    expect((await store.getOrThrow("payment_intents", i2.id)).saleId).toBe(s.id);
    // o mesmo Pix não paga outra venda
    await expect(sale({ idemKey: "pix-2", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i2.id }] })).rejects.toThrow(/outra venda/);
    // Pix manual exige identificador do comprovante
    await expect(sale({ idemKey: "pix-3", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490 }] })).rejects.toThrow(/identificador/);
  });

  it("cartão sem TEF exige NSU ou autorização e respeita parcelas máximas", async () => {
    const items = [{ skuId: refs.skus["bone-u"].id, qty: 1000 }];
    await expect(sale({ idemKey: "card-1", items, payments: [{ methodId: refs.methods.debito.id, amount: 4490 }] })).rejects.toThrow(/NSU/);
    await expect(sale({ idemKey: "card-1", items, payments: [{ methodId: refs.methods.credito.id, amount: 4490, installments: 12, nsu: "1" }] })).rejects.toThrow(/máximo/);
    const s = await sale({ idemKey: "card-1", items, payments: [{ methodId: refs.methods.credito.id, amount: 4490, installments: 3, authCode: "AUT77" }] });
    const insts = await listAll(store, "installments", { filters: [["eq", "titleId", (await listAll(store, "titles", { filters: [["eq", "originId", s.id]] }))[0].id]] });
    expect(insts.map((i) => i.amount).reduce((a, b) => a + b, 0)).toBe(4490);
    expect(insts).toHaveLength(3);
  });

  it("produto sem saldo: bloqueado por padrão, permitido apenas pela configuração comercial", async () => {
    const vela = refs.skus["vela-u"].id;
    expect(await avail("vela-u")).toBe(0);
    const input = { idemKey: "neg-1", items: [{ skuId: vela, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4290 }] };
    await expect(sale(input)).rejects.toThrow(/Estoque insuficiente/);
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "sales.allowNegativeStock", true);
    const prep = await prepareSale(cashier, { ...input, terminalId });
    expect(prep.stockWarnings.length).toBe(1);
    const s = await sale(input);
    expect(s.status).toBe("completed");
    expect(await avail("vela-u")).toBe(-1000);
  });

  it("devolução parcial, excedente bloqueado (inclusive em paralelo), vale-crédito com saldo consumível", async () => {
    const s = await sale({ idemKey: "ret-1", customerId: refs.customers.ana.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000 }], payments: [{ methodId: refs.methods.debito.id, amount: 7470, nsu: "9" }] });
    const [line] = await returnableItems(store, s.id);
    const cadBefore = await avail("caderno-u");
    const r1 = await processReturn(cashier, { saleId: s.id, idemKey: "r1", reason: "sobrou", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r1.itemsTotal).toBe(2490);
    expect(await avail("caderno-u")).toBe(cadBefore + 1000);
    // repetição da mesma devolução não duplica
    const r1b = await processReturn(cashier, { saleId: s.id, idemKey: "r1", reason: "sobrou", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r1b.id).toBe(r1.id);
    // excedente (restam 2)
    await expect(processReturn(cashier, { saleId: s.id, idemKey: "r2", reason: "x", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 3000, condition: "resellable" }] })).rejects.toThrow(/excede/);
    // duas devoluções simultâneas de 2 unidades: só uma passa
    const par = await Promise.allSettled([
      processReturn(cashier, { saleId: s.id, idemKey: "r3", reason: "a", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 2000, condition: "damaged" }] }),
      processReturn(cashier, { saleId: s.id, idemKey: "r4", reason: "b", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 2000, condition: "damaged" }] }),
    ]);
    expect(par.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    const rej = par.find((p) => p.status === "rejected") as PromiseRejectedResult;
    expect(String(rej.reason.message)).toMatch(/excede/);
    const item = await store.getOrThrow("sale_items", line.id);
    expect(item.returnedQty).toBe(3000);
    const after = await store.getOrThrow("sales", s.id);
    expect(after.returnedTotal).toBe(7470); // centavos fecham exatamente na devolução do restante
    // avaria vai ao depósito de avarias (não volta ao disponível)
    expect(await avail("caderno-u")).toBe(cadBefore + 1000);
    // vale-crédito: saldo consumível e histórico
    const voucher = await store.getOrThrow("credit_vouchers", r1.creditVoucherId);
    expect(voucher.balance).toBe(2490);
    await sale({ idemKey: "use-v", customerId: refs.customers.ana.id, items: [{ skuId: refs.skus["caneca-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.vale.id, amount: 2000, voucherCode: voucher.code }, { methodId: refs.methods.dinheiro.id, amount: 1490 }] });
    const v2 = await store.getOrThrow("credit_vouchers", voucher.id);
    expect(v2.balance).toBe(490);
    const moves = await listAll(store, "credit_voucher_moves", { filters: [["eq", "voucherId", voucher.id]] });
    expect(moves.map((m) => m.kind).sort()).toEqual(["issue", "use"]);
    await expect(sale({ idemKey: "use-v2", customerId: refs.customers.ana.id, items: [{ skuId: refs.skus["caneca-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.vale.id, amount: 3490, voucherCode: voucher.code }] })).rejects.toThrow(/insuficiente/);
  });

  it("troca com diferença: vale da troca aplicado na nova venda e vínculo único", async () => {
    const s = await sale({ idemKey: "ex-0", items: [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4990 }] });
    const [line] = await returnableItems(store, s.id);
    const ret = await processReturn(cashier, { saleId: s.id, idemKey: "ex-r", reason: "Troca de tamanho", compensation: "exchange", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(ret.kind).toBe("exchange");
    const v = await store.getOrThrow("credit_vouchers", ret.creditVoucherId);
    const ex = await sale({
      idemKey: "ex-1", exchangeReturnId: ret.id, items: [{ skuId: refs.skus["calca-40"].id, qty: 1000 }],
      payments: [{ methodId: refs.methods.vale.id, amount: v.balance, voucherCode: v.code }, { methodId: refs.methods.dinheiro.id, amount: 15990 - v.balance, received: 12000 }],
    });
    expect(ex.origin).toBe("exchange");
    const linked = await store.getOrThrow("returns", ret.id);
    expect(linked.exchangeSaleId).toBe(ex.id);
    expect(linked.difference).toBe(15990 - 4990); // cliente pagou a diferença
    expect((await store.getOrThrow("credit_vouchers", v.id)).status).toBe("used");
    await expect(sale({ idemKey: "ex-2", exchangeReturnId: ret.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490 }] })).rejects.toThrow(/outra venda/);
    await expect(linkExchangeSale(cashier, ret.id, s.id)).rejects.toThrow(/outra venda/);
    // venda original preservada
    expect((await store.getOrThrow("sales", s.id)).status).toBe("completed");
  });

  it("devolução em dinheiro sai do caixa; cancelamento exige permissão e estorna efeitos", async () => {
    const s = await sale({ idemKey: "cx-1", items: [{ skuId: refs.skus["bone-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 8980, received: 10000 }] });
    const [line] = await returnableItems(store, s.id);
    await processReturn(cashier, { saleId: s.id, idemKey: "cx-r", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "damaged" }] });
    const sum = await sessionSummary(cashier, s.cashSessionId);
    expect(sum.totals.refunds).toBe(4490);
    expect(sum.expected.cash).toBe(10000 + 8980 - 4490);
    // cancelamento integral bloqueado após devolução
    await expect(cancelSale(manager, s.id, "x")).rejects.toThrow(/devoluções/);
    const s2 = await sale({ idemKey: "cx-2", items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490 }] });
    await expect(cancelSale(cashier, s2.id, "desistiu")).rejects.toThrow(/permissão/);
    const before = await avail("bone-u");
    const [c1, c2] = await Promise.all([cancelSale(manager, s2.id, "desistiu"), cancelSale(manager, s2.id, "desistiu")]);
    expect(c1.status).toBe("cancelled");
    expect(c2.status).toBe("cancelled");
    expect(await avail("bone-u")).toBe(before + 1000);
    const refunds = await listAll(store, "cash_movements", { filters: [["eq", "saleId", s2.id], ["eq", "type", "refund"]] });
    expect(refunds).toHaveLength(1);
    const sum2 = await sessionSummary(cashier, s.cashSessionId);
    expect(sum2.expected.cash).toBe(10000 + 8980 - 4490 + 4490 - 4490);
  });

  it("atendimento: autosalvamento, pré-venda, retomada, cancelamento e conclusão idempotente", async () => {
    const cart = (await ensureOpenCart(cashier, terminalId))!;
    expect(cart.status).toBe("open");
    const same = await ensureOpenCart(cashier, terminalId);
    expect(same!.id).toBe(cart.id);
    const items = [
      { skuId: refs.skus["meia-u"].id, qty: 12000, listPrice: 2990, wholesalePrice: 2390, wholesaleMinQty: 12000 },
      { skuId: refs.skus["bone-u"].id, qty: 1000, listPrice: 4490, unitPrice: 4000 },
    ];
    const saved = await saveCart(cashier, cart.id, { items, customerId: refs.customers.joao.id, surcharge: 500 });
    // atacado (12 × 23,90) + boné com preço digitado (44,90 → 40,00 = desconto) + acréscimo 5,00
    const totals = cartTotals(saved);
    expect(totals.total).toBe(12 * 2390 + 4000 + 500);
    expect(saved.total).toBe(totals.total);
    expect(saved.customerName).toBe(refs.customers.joao.name);
    const { parked, fresh } = await parkCart(cashier, cart.id, "Cliente volta às 15h");
    expect(parked.status).toBe("parked");
    expect(fresh.status).toBe("open");
    await expect(saveCart(cashier, cart.id, { items: [] })).rejects.toThrow(/pré-venda/);
    expect((await listParkedCarts(cashier)).map((c) => c.id)).toContain(cart.id);
    // retomada em outro terminal da filial (caixa 2) — atendimento vazio é descartado
    const cx2 = refs.terminals.cx2.id;
    const resumed = await resumeCart(cashier, cart.id, cx2);
    expect(resumed.status).toBe("open");
    expect(resumed.terminalId).toBe(cx2);
    // conclusão pelo terminal com caixa aberto
    await store.update("carts", cart.id, { terminalId });
    const c = await store.getOrThrow("carts", cart.id);
    const input = cartToSaleInput(c, [{ methodId: refs.methods.dinheiro.id, amount: totals.total, received: totals.total }]);
    const s1 = await finalizeSale(cashier, input);
    expect(s1.total).toBe(totals.total);
    expect(s1.surchargeTotal).toBe(500);
    expect((await store.getOrThrow("carts", cart.id)).status).toBe("converted");
    const s2 = await finalizeSale(cashier, input);
    expect(s2.id).toBe(s1.id);
    await expect(saveCart(cashier, cart.id, { items: [] })).rejects.toThrow(/virou venda/);
    // cancelamento de atendimento preserva registro e motivo
    const other = await createCart(cashier, terminalId);
    await saveCart(cashier, other.id, { items: [{ skuId: refs.skus["bone-u"].id, qty: 1000, listPrice: 4490 }] });
    const cancelled = await cancelCart(cashier, other.id, "Cliente desistiu");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("Cliente desistiu");
  });

  it("cancelar atendimento com Pix confirmado e não usado é bloqueado", async () => {
    const cart = await createCart(cashier, terminalId);
    const i = await createPixIntent(cashier, { cartId: cart.id, amount: 1000, description: "x" });
    await simulateIntent(cashier, i.id, "confirmed");
    await expect(cancelCart(cashier, cart.id, "x")).rejects.toThrow(/Pix confirmado/);
  });

  it("prévia de vencimentos do PDV é igual à geração do financeiro", () => {
    for (const term of [{ installments: 3, firstDueDays: 30, intervalDays: 30 }, { installments: 2, firstDueDays: 28, intervalDays: 28 }, { installments: 1, firstDueDays: 0, intervalDays: 30 }]) {
      expect(previewSchedule(10001, term, "2026-01-31")).toEqual(buildSchedule(10001, term, "2026-01-31"));
    }
  });
});
