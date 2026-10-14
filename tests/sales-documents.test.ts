import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { addDays, today } from "@/lib/dates";
import { roundDiv, QTY } from "@/lib/money";
import { setSetting } from "@/lib/core/settings";
import { openSession } from "@/domain/cash";
import { calcSale } from "@/domain/pricing-calc";
import { resolvePrices } from "@/domain/pricing";
import { cartTotals } from "@/domain/cart-calc";
import { cartToSaleInput } from "@/domain/carts";
import { cancelSale, finalizeSale, prepareSale } from "@/domain/sales";
import { loadOrigin, saveNfe } from "@/domain/fiscal/nfe";
import { cancelDocument, getFiscalConfig, queryDocument, toProviderPayload } from "@/domain/fiscal/service";
import {
  cancelOrder, convertQuoteToOrder, createSalesDocument, documentItems, expireSalesDocuments, importDocumentToCart, markQuoteSent, renewReservation, updateSalesDocument,
} from "@/domain/sales-documents";

/**
 * Fase 5 — documento comercial de venda (VEN-01/VEN-02, PDV-12, FIS-05): totais pela regra da venda, conversão
 * idempotente, reserva de estoque (criação, faturamento, cancelamento, expiração), faturamento parcial no PDV + restante
 * em NF-e sem efeito duplo, xPed/nItemPed, permissões e liga/desliga.
 */

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let cashier: Ctx;
let terminalId: string;

const sku = (k: string) => refs.skus[k].id;
const wh = () => refs.warehouses["matriz-main"].id;
const bal = async (k: string) => {
  const b = await store.get("stock_balances", detId("bal", wh(), sku(k)));
  return { physical: b?.physical ?? 0, reserved: b?.reserved ?? 0 };
};
const activeReservations = async (docId: string) => listAll(store, "stock_reservations", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", docId], ["eq", "status", "active"]] });
const reservedBySku = async (docId: string) => {
  const m: Record<string, number> = {};
  for (const r of await activeReservations(docId)) m[r.skuId] = (m[r.skuId] ?? 0) + r.qty;
  return m;
};

/** pedido do cliente Maria: 10 cadernos + 4 canecas, desconto geral R$ 10,00 */
async function order(idem = "o1") {
  return createSalesDocument(admin, "order", { customerId: refs.customers.maria.id, items: [{ skuId: sku("caderno-u"), qty: 10 * QTY }, { skuId: sku("caneca-u"), qty: 4 * QTY }], globalDiscount: 1000 }, { idemKey: idem });
}

/** Venda do atendimento importado, paga em dinheiro pelo total calculado. */
async function sellCart(cart: Doc, ctx = cashier) {
  const total = cartTotals(cart as any).total;
  return finalizeSale(ctx, { ...cartToSaleInput(cart, [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }]) });
}

async function authorizeNfe(input: Parameters<typeof saveNfe>[1], idemKey: string) {
  let doc = await saveNfe(admin, input, { idemKey, transmit: true });
  doc = await queryDocument(admin, doc.id);
  expect(doc.status).toBe("authorized");
  return doc;
}

beforeEach(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  terminalId = refs.terminals.cx1.id;
  await openSession(cashier, { terminalId, openingFund: 10000 });
});

describe("documento comercial — preço e totais", () => {
  it("totais iguais ao calcSale (preço digitado, desconto do item, atacado, desconto geral e acréscimo) e ao prepareSale", async () => {
    const items = [
      { skuId: sku("caderno-u"), qty: 25 * QTY, itemDiscount: 300 }, // atacado (≥ 20)
      { skuId: sku("caneca-u"), qty: 3 * QTY, unitPrice: 3000 }, // preço digitado abaixo da tabela → desconto do item
      { skuId: sku("bone-u"), qty: 1500, itemSurcharge: 100 },
    ];
    const q = await createSalesDocument(admin, "quote", { customerId: refs.customers.maria.id, items, globalDiscount: 777, surcharge: 250 }, { idemKey: "q-totais" });
    const prices = await resolvePrices(store, { companyId: refs.company.id, branchId: refs.branches.matriz.id, priceTableId: refs.branches.matriz.defaultPriceTableId ?? null, items });
    const expected = calcSale(
      items.map((i, k) => {
        const list = prices[k].price;
        const typed = i.unitPrice != null && i.unitPrice < list ? roundDiv((list - i.unitPrice) * i.qty, QTY) : 0;
        return { qty: i.qty, unitPrice: list, itemDiscount: (i.itemDiscount ?? 0) + typed, itemSurcharge: i.itemSurcharge ?? 0 };
      }),
      { globalDiscount: 777, surcharge: 250 },
    );
    expect(prices[0].wholesale).toBe(true);
    expect(q).toMatchObject({ type: "quote", status: "draft", number: 1, subtotal: expected.subtotal, discountTotal: expected.discountTotal, surchargeTotal: expected.surchargeTotal, total: expected.total });
    const rows = await documentItems(store, q.id);
    expect(rows.map((r) => r.total)).toEqual(expected.items.map((i) => i.total));
    expect(rows.map((r) => r.globalDiscount)).toEqual(expected.items.map((i) => i.globalDiscount));
    // mesma regra da venda: prepareSale com os mesmos itens chega ao mesmo total
    const prep = await prepareSale(admin, { idemKey: "x", terminalId, items, globalDiscount: 777, surcharge: 250, payments: [] });
    expect(prep.calc.total).toBe(q.total);
    // validade padrão do orçamento (parâmetro, 10 dias)
    expect(q.validUntil).toBe(addDays(today(), 10));
    // o documento não movimenta estoque nem reserva (orçamento)
    expect(await activeReservations(q.id)).toHaveLength(0);
  });

  it("limite de desconto do usuário vale para o documento (mesma regra da venda)", async () => {
    await expect(
      createSalesDocument(cashier, "quote", { items: [{ skuId: sku("caneca-u"), qty: 2 * QTY }], globalDiscountBps: 1500 }, { idemKey: "q-limite" }),
    ).rejects.toMatchObject({ code: "discount_limit" });
    const ok = await createSalesDocument(cashier, "quote", { contactName: "Cliente balcão", contactPhone: "11 98888-7777", items: [{ skuId: sku("caneca-u"), qty: 2 * QTY }], globalDiscountBps: 500 }, { idemKey: "q-limite-ok" });
    expect(ok.customerSnapshot).toMatchObject({ name: "Cliente balcão", phone: "11988887777" });
    // idempotente pela chave do formulário
    const again = await createSalesDocument(cashier, "quote", { items: [{ skuId: sku("caneca-u"), qty: 2 * QTY }] }, { idemKey: "q-limite-ok" });
    expect(again.id).toBe(ok.id);
  });
});

describe("orçamento → pedido", () => {
  it("conversão idempotente (repetida e concorrente) cria um único pedido com os mesmos valores", async () => {
    const q = await createSalesDocument(admin, "quote", { customerId: refs.customers.maria.id, items: [{ skuId: sku("caderno-u"), qty: 5 * QTY }], globalDiscount: 300 }, { idemKey: "q-conv" });
    await markQuoteSent(admin, q.id, "whatsapp");
    expect((await store.getOrThrow("sales_documents", q.id)).status).toBe("sent");
    const [a, b] = await Promise.all([convertQuoteToOrder(admin, q.id), convertQuoteToOrder(admin, q.id)]);
    const c = await convertQuoteToOrder(admin, q.id);
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    const orders = (await listAll(store, "sales_documents")).filter((d) => d.type === "order");
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "open", sourceQuoteId: q.id, total: q.total, customerId: refs.customers.maria.id });
    expect(await store.getOrThrow("sales_documents", q.id)).toMatchObject({ status: "converted", convertedOrderId: a.id });
    // orçamento convertido fica travado
    await expect(updateSalesDocument(admin, q.id, { items: [{ skuId: sku("caderno-u"), qty: QTY }] })).rejects.toMatchObject({ code: "locked" });
  });
});

describe("pedido — reserva de estoque", () => {
  it("reserva ao confirmar, libera no cancelamento", async () => {
    const before = await bal("caderno-u");
    const o = await order();
    expect(o.reservationStatus).toBe("active");
    expect(o.reserveUntil).toBe(addDays(today(), 15));
    expect(await reservedBySku(o.id)).toEqual({ [sku("caderno-u")]: 10 * QTY, [sku("caneca-u")]: 4 * QTY });
    expect((await bal("caderno-u")).reserved - before.reserved).toBe(10 * QTY);
    expect((await bal("caderno-u")).physical).toBe(before.physical); // só reserva, sem movimento
    await cancelOrder(admin, o.id, "Cliente desistiu");
    expect(await activeReservations(o.id)).toHaveLength(0);
    expect((await bal("caderno-u")).reserved).toBe(before.reserved);
    expect((await store.getOrThrow("sales_documents", o.id))).toMatchObject({ status: "cancelled", reservationStatus: "released" });
    // repetir o cancelamento não muda nada
    await cancelOrder(admin, o.id, "Cliente desistiu");
    expect((await bal("caderno-u")).reserved).toBe(before.reserved);
  });

  it("rotina diária: reserva vencida é liberada; orçamento vencido expira; reserva pode ser renovada", async () => {
    const o = await order();
    const q = await createSalesDocument(admin, "quote", { items: [{ skuId: sku("caneca-u"), qty: QTY }] }, { idemKey: "q-exp" });
    await store.update("sales_documents", o.id, { reserveUntil: addDays(today(), -1) });
    await store.update("sales_documents", q.id, { validUntil: addDays(today(), -1) });
    const r = await expireSalesDocuments(store, refs.company.id);
    expect(r).toEqual({ quotes: 1, reservations: 1 });
    expect(await activeReservations(o.id)).toHaveLength(0);
    expect((await store.getOrThrow("sales_documents", o.id))).toMatchObject({ status: "open", reservationStatus: "expired" });
    expect((await store.getOrThrow("sales_documents", q.id)).status).toBe("expired");
    // repetir não altera
    expect(await expireSalesDocuments(store, refs.company.id)).toEqual({ quotes: 0, reservations: 0 });
    // orçamento vencido não é importado no PDV
    await expect(importDocumentToCart(cashier, terminalId, q.id)).rejects.toMatchObject({ code: "document_not_billable" });
    await renewReservation(admin, o.id);
    expect(await reservedBySku(o.id)).toEqual({ [sku("caderno-u")]: 10 * QTY, [sku("caneca-u")]: 4 * QTY });
  });
});

describe("faturamento parcial no PDV + restante em NF-e (sem efeito duplo)", () => {
  it("PDV fatura parte, NF-e fatura o restante com xPed/nItemPed; estoque e títulos uma única vez", async () => {
    const o = await order();
    const cad0 = await bal("caderno-u");
    const can0 = await bal("caneca-u");
    const items = await documentItems(store, o.id);
    // importar no PDV só 4 cadernos
    const cart = await importDocumentToCart(cashier, terminalId, o.id, { [items[0].id]: 4 * QTY, [items[1].id]: 0 });
    expect(cart).toMatchObject({ salesDocumentId: o.id, customerId: refs.customers.maria.id });
    expect(cart.items).toHaveLength(1);
    const sale = await sellCart(cart);
    expect(sale.salesDocumentId).toBe(o.id);
    // repetir a conclusão não fatura de novo
    await sellCart(cart);
    let it = await documentItems(store, o.id);
    expect(it.map((i) => i.invoicedQty)).toEqual([4 * QTY, 0]);
    expect((await store.getOrThrow("sales_documents", o.id)).status).toBe("partial");
    // venda baixou 4; reserva reduzida para o pendente (6 + 4)
    expect(await bal("caderno-u")).toEqual({ physical: cad0.physical - 4 * QTY, reserved: cad0.reserved - 4 * QTY });
    expect(await reservedBySku(o.id)).toEqual({ [sku("caderno-u")]: 6 * QTY, [sku("caneca-u")]: 4 * QTY });

    // NF-e do restante: origem pedido de venda, efeitos na autorização
    const pre = await loadOrigin(admin, "sales_document", o.id, refs.branches.matriz.id);
    expect(pre.blockers).toEqual([]);
    expect(pre.effectsLocked).toBe(false);
    expect(pre.input.items.map((i) => [i.qty, i.xPed, i.nItemPed])).toEqual([[6 * QTY, String(o.number), 1], [4 * QTY, String(o.number), 2]]);
    // acima do saldo é recusado no servidor
    await expect(saveNfe(admin, { ...pre.input, items: [{ ...pre.input.items[0], qty: 7 * QTY }] }, { idemKey: "nfe-over", transmit: false })).rejects.toMatchObject({ code: "document_over_billing" });
    const nfe = await authorizeNfe(pre.input, "nfe-o1");
    expect(nfe.items.map((i: any) => [i.xPed, i.nItemPed])).toEqual([[String(o.number), 1], [String(o.number), 2]]);
    const company = await store.getOrThrow("companies", refs.company.id);
    const payload = toProviderPayload(nfe, company, refs.branches.matriz, await getFiscalConfig(store, refs.company.id, refs.branches.matriz.id));
    expect(payload.items.map((i: any) => [i.pedido_compra, i.numero_item_pedido_compra])).toEqual([[String(o.number), 1], [String(o.number), 2]]);

    it = await documentItems(store, o.id);
    expect(it.map((i) => i.invoicedQty)).toEqual([10 * QTY, 4 * QTY]);
    const done = await store.getOrThrow("sales_documents", o.id);
    expect(done.status).toBe("invoiced");
    // sem efeito duplo: total baixado = quantidade do pedido; reservas zeradas
    expect(await bal("caderno-u")).toEqual({ physical: cad0.physical - 10 * QTY, reserved: cad0.reserved - 10 * QTY });
    expect(await bal("caneca-u")).toEqual({ physical: can0.physical - 4 * QTY, reserved: can0.reserved - 4 * QTY });
    expect(await activeReservations(o.id)).toHaveLength(0);
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "skuId", sku("caderno-u")]] });
    expect(movs.filter((m) => m.originId === sale.id || m.originId === nfe.id).reduce((a, m) => a + m.qty, 0)).toBe(-10 * QTY);
    // valores: venda + NF-e = total do pedido, centavo a centavo
    expect(sale.total + nfe.total).toBe(o.total);
    // financeiro: título da NF-e (a receber) com o valor da nota; a venda em dinheiro não gera título
    const titles = await listAll(store, "titles", { filters: [["eq", "originId", nfe.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ kind: "receivable", originType: "fiscal_document", total: nfe.total });
    // repetir a consulta não fatura de novo
    await queryDocument(admin, nfe.id);
    expect((await documentItems(store, o.id)).map((i) => i.invoicedQty)).toEqual([10 * QTY, 4 * QTY]);

    // cancelamento da NF-e: estoque volta, quantidades voltam ao saldo do pedido
    await cancelDocument(admin, nfe.id, "Cancelamento de teste do faturamento do pedido");
    expect((await documentItems(store, o.id)).map((i) => i.invoicedQty)).toEqual([4 * QTY, 0]);
    expect((await store.getOrThrow("sales_documents", o.id)).status).toBe("partial");
    expect((await bal("caderno-u")).physical).toBe(cad0.physical - 4 * QTY);
    // cancelamento da venda: o pedido volta a aberto
    await cancelSale(admin, sale.id, "Cancelamento de teste", { terminalId });
    expect((await documentItems(store, o.id)).map((i) => i.invoicedQty)).toEqual([0, 0]);
    expect((await store.getOrThrow("sales_documents", o.id)).status).toBe("open");
  });

  it("venda acima do saldo do pedido é recusada antes de gravar; pedido cancelado não é faturado", async () => {
    const o = await order();
    const cart = await importDocumentToCart(cashier, terminalId, o.id);
    const big = { ...cart, items: cart.items.map((i: any, k: number) => (k === 0 ? { ...i, qty: 11 * QTY } : i)) };
    await expect(sellCart(big)).rejects.toMatchObject({ code: "document_over_billing" });
    expect(await listAll(store, "sales")).toHaveLength(0);
    // o mesmo pedido não é importado em dois atendimentos
    await expect(importDocumentToCart(admin, refs.terminals.cx2.id, o.id)).rejects.toMatchObject({ code: "document_in_cart" });
  });

  it("orçamento importado no PDV vira venda; cancelar a venda devolve o orçamento a aprovado", async () => {
    const q = await createSalesDocument(admin, "quote", { customerId: refs.customers.maria.id, items: [{ skuId: sku("caneca-u"), qty: 2 * QTY }], globalDiscount: 100 }, { idemKey: "q-pdv" });
    const cart = await importDocumentToCart(cashier, terminalId, q.id);
    expect(cartTotals(cart as any).total).toBe(q.total);
    const sale = await sellCart(cart);
    expect(sale.total).toBe(q.total);
    expect(await store.getOrThrow("sales_documents", q.id)).toMatchObject({ status: "converted", convertedSaleId: sale.id });
    await cancelSale(admin, sale.id, "Teste", { terminalId });
    expect(await store.getOrThrow("sales_documents", q.id)).toMatchObject({ status: "approved", convertedSaleId: null });
  });
});

describe("permissões e liga/desliga", () => {
  it("caixa cria orçamento, mas não cria pedido, não converte e não cancela", async () => {
    const q = await createSalesDocument(cashier, "quote", { customerId: refs.customers.maria.id, items: [{ skuId: sku("caneca-u"), qty: QTY }] }, { idemKey: "q-perm" });
    await expect(createSalesDocument(cashier, "order", { customerId: refs.customers.maria.id, items: [{ skuId: sku("caneca-u"), qty: QTY }] }, { idemKey: "o-perm" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(convertQuoteToOrder(cashier, q.id)).rejects.toMatchObject({ code: "forbidden" });
    const o = await order();
    await expect(cancelOrder(cashier, o.id, "sem permissão")).rejects.toMatchObject({ code: "forbidden" });
    const stockist = await refs.ctxFor("stockist", "matriz");
    await expect(createSalesDocument(stockist, "quote", { items: [{ skuId: sku("caneca-u"), qty: QTY }] }, { idemKey: "q-est" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("parâmetro desligado: não cria, não importa no PDV e bloqueia a NF-e de pedido; venda direta segue igual", async () => {
    const o = await order();
    await setSetting(store, refs.company.id, null, "feature.documentoComercial", false);
    await expect(createSalesDocument(admin, "quote", { items: [{ skuId: sku("caneca-u"), qty: QTY }] }, { idemKey: "q-off" })).rejects.toMatchObject({ code: "feature_off" });
    await expect(importDocumentToCart(cashier, terminalId, o.id)).rejects.toMatchObject({ code: "feature_off" });
    const pre = await loadOrigin(admin, "sales_document", o.id, refs.branches.matriz.id);
    expect(pre.blockers.join(" ")).toMatch(/desligados/);
    const sale = await finalizeSale(cashier, { idemKey: "direta", terminalId, items: [{ skuId: sku("bone-u"), qty: QTY }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490, received: 5000 }] });
    expect(sale).toMatchObject({ status: "completed", total: 4490 });
    expect(sale.salesDocumentId ?? null).toBeNull();
  });
});

describe("demonstração", () => {
  it("seed idempotente: 2 orçamentos (enviado e aprovado) e 1 pedido parcialmente faturado", async () => {
    const { seed } = await import("@/domain/seed/modules/sales-documents");
    await seed(refs);
    await seed(refs);
    const docs = await listAll(store, "sales_documents");
    expect(docs.filter((d) => d.type === "quote").map((d) => d.status).sort()).toEqual(["approved", "sent"]);
    const orders = docs.filter((d) => d.type === "order");
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("partial");
    const sales = (await listAll(store, "sales")).filter((s) => s.salesDocumentId === orders[0].id);
    expect(sales).toHaveLength(1);
    expect((await documentItems(store, orders[0].id)).map((i) => i.invoicedQty)).toEqual([8 * QTY, 0]);
    expect(await reservedBySku(orders[0].id)).toEqual({ [sku("caderno-u")]: 7 * QTY, [sku("caneca-u")]: 3 * QTY });
  });
});
