import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { QTY } from "@/lib/money";
import { queryDocument } from "@/domain/fiscal/service";
import { storeOfCompany } from "@/domain/ecommerce/common";
import { createStore, publishStore, readiness, saveLegalContact, saveShipping, savePayments, shippingOf, paymentsOf } from "@/domain/ecommerce/store";
import { addToCatalog, publicCatalog, publicProduct, saveListing } from "@/domain/ecommerce/catalog";
import { addToCart, applyCoupon, cartView, selectDelivery, setCartQty, setDeliveryZip } from "@/domain/ecommerce/cart";
import { saveCoupon } from "@/domain/ecommerce/promotions";
import { placeOrder, simulatePaymentEvent, type CheckoutInput } from "@/domain/ecommerce/checkout";
import { cancelOrder, completeReturn, confirmDelivery, confirmPickup, confirmPicking, dispatchOrder, expirePendingOrders, generateLabel, handlePaymentEvent, orderOfCompany, requestReturn } from "@/domain/ecommerce/orders";
import { invoiceOrder } from "@/domain/ecommerce/fiscal";
import { normalizeDomain } from "@/domain/ecommerce/domains";
import { intercertGateway } from "@/domain/ecommerce/providers";

/**
 * Comércio digital (Telas 49–64, §49): loja por empresa, vitrine com preço/estoque do ERP, carrinho, cupom, checkout com
 * reserva, pagamento idempotente, NF-e do pedido, expedição/retirada com baixa única, cancelamento com estorno, expiração,
 * arrependimento e avisos assinados do Gateway Intercert.
 */

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let st: Doc;

const sku = (k: string) => refs.skus[k].id;
const wh = () => refs.warehouses["matriz-main"].id;
const bal = async (k: string) => {
  const b = await store.get("stock_balances", detId("bal", wh(), sku(k)));
  return { physical: b?.physical ?? 0, reserved: b?.reserved ?? 0 };
};
const token = () => crypto.randomBytes(16).toString("hex");
const fresh = async () => (st = (await storeOfCompany(store, admin.companyId))!);

function checkout(over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    submissionKey: crypto.randomBytes(16).toString("hex"),
    customer: { name: "Cliente de Teste", email: "cliente@example.com", phone: "11987654321", doc: "39053344705" },
    address: { zip: "01310100", street: "Avenida Paulista", number: "1000", district: "Bela Vista", cityName: "São Paulo", cityCode: "3550308", uf: "SP" },
    deliveryOptionId: `pickup:${refs.branches.matriz.id}`,
    payment: { method: "pix", installments: 1 },
    acceptTerms: true,
    marketingConsent: false,
    ...over,
  };
}

async function cartWith(items: Array<[string, number, string?]>) {
  const t = token();
  for (const [slug, qty, skuId] of items) await addToCart(store, st, t, { productSlug: slug, skuId: skuId ?? null, qty });
  return t;
}

const slugOf = async (productKey: string) => (await listAll(store, "store_products", { filters: [["eq", "productId", refs.products[productKey].id]] }))[0].slug as string;

async function authorize(orderId: string) {
  let o = await invoiceOrder(admin, orderId);
  const doc = await store.get("fiscal_documents", o.fiscalDocumentId);
  if (doc && doc.status !== "authorized") await queryDocument(admin, doc.id);
  o = await orderOfCompany(admin, orderId);
  return o;
}

beforeEach(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  await createStore(admin, { name: "Loja Teste" });
  await saveLegalContact(admin, { companyName: "Comércio Teste Ltda", cnpj: "11222333000181", address: "Rua das Flores, 100 — Centro — São Paulo/SP", email: "contato@loja-teste.com.br", phone: "1133334444" }, { whatsapp: "11999990000", email: "contato@loja-teste.com.br", phone: "1133334444", hours: "9h às 18h" });
  const ids = ["caderno", "bone", "fone", "camiseta"].map((k) => refs.products[k].id);
  await addToCatalog(admin, ids);
  for (const k of ["caderno", "bone", "fone", "camiseta"]) await saveListing(admin, refs.products[k].id, { title: refs.products[k].name, description: "Descrição do produto para a vitrine de testes.", images: [], featured: k === "fone", published: true, weightGrams: 400 });
  await publishStore(admin);
  await fresh();
}, 120_000);

describe("loja e vitrine", () => {
  it("uma loja por empresa; publicação exige catálogo, recebimentos, entrega, dados legais e páginas", async () => {
    const again = await createStore(admin, { name: "Outra" });
    expect(again.id).toBe(st.id);
    expect(st.status).toBe("published");
    const items = await readiness(admin, st);
    expect(items.filter((i) => i.blocking && !i.ok)).toEqual([]);
    // tirar todos os produtos da vitrine bloqueia uma nova publicação
    for (const l of await listAll(store, "store_products", { filters: [["eq", "storeId", st.id]] })) await store.update("store_products", l.id, { published: false });
    await expect(publishStore(admin)).rejects.toMatchObject({ code: "not_ready" });
  });

  it("vitrine mostra só o que está publicado e sem pendência, com preço e disponível do ERP", async () => {
    const cat = await publicCatalog(store, st);
    expect(cat.cards.map((c) => c.productId).sort()).toEqual(["caderno", "bone", "fone", "camiseta"].map((k) => refs.products[k].id).sort());
    const caderno = cat.cards.find((c) => c.productId === refs.products.caderno.id)!;
    expect(caderno.price).toBe(2490);
    expect(caderno.available).toBe(true);
    // peso apagado (na loja e no cadastro): "Peso pendente" bloqueia a venda (transportadora habilitada)
    await store.update("products", refs.products.bone.id, { weightGrams: null });
    const l = (await listAll(store, "store_products", { filters: [["eq", "productId", refs.products.bone.id]] }))[0];
    await saveListing(admin, refs.products.bone.id, { title: l.title, description: l.description, images: [], featured: false, published: true, weightGrams: null });
    expect((await listAll(store, "store_products", { filters: [["eq", "productId", refs.products.bone.id]] }))[0].issues.map((i: any) => i.code)).toContain("no_weight");
    expect((await publicCatalog(store, st)).cards.some((c) => c.productId === refs.products.bone.id)).toBe(false);
    // monitor: falha de validação do produto; corrigido o peso, o reprocessamento conclui a MESMA linha
    const { monitorEvents, reprocessEvent } = await import("@/domain/ecommerce/monitor");
    const failed = (await monitorEvents(admin, { status: "failed" })).filter((e) => e.subject === `product:${refs.products.bone.id}`);
    expect(failed).toHaveLength(1);
    await saveListing(admin, refs.products.bone.id, { title: l.title, description: l.description, images: [], featured: false, published: true, weightGrams: 150 });
    const r = await reprocessEvent(admin, failed[0].id);
    expect(r.status).toBe("ok");
    expect((await monitorEvents(admin, {})).filter((e) => e.subject === `product:${refs.products.bone.id}`)).toHaveLength(1);
    expect((await publicCatalog(store, st)).cards.some((c) => c.productId === refs.products.bone.id)).toBe(true);
    // produto com variações: uma variante por SKU com estoque próprio
    const camiseta = await publicProduct(store, st, await slugOf("camiseta"));
    expect(camiseta!.variants.length).toBeGreaterThan(1);
  });
});

describe("carrinho, checkout e pagamento", () => {
  it("Pix + retirada: reserva no checkout, pagamento idempotente, recebível, NF-e e retirada com código baixando o estoque uma vez", async () => {
    const before = await bal("caderno-u");
    const t = await cartWith([[await slugOf("caderno"), 3]]);
    const view = await cartView(store, st, t);
    expect(view!.subtotal).toBe(3 * 2490);
    const order = await placeOrder(store, st, t, checkout());
    expect(order).toMatchObject({ status: "pending_payment", paymentStatus: "pending", total: 3 * 2490 });
    expect(order.payment.pix.copyPaste).toMatch(/^SIMULACAO-SEM-VALOR/);
    expect(await bal("caderno-u")).toEqual({ physical: before.physical, reserved: before.reserved + 3 * QTY });
    // reenvio do mesmo checkout devolve o mesmo pedido (sem nova reserva)
    expect((await placeOrder(store, st, t, checkout())).id).toBe(order.id);
    expect((await bal("caderno-u")).reserved).toBe(before.reserved + 3 * QTY);

    const first = await simulatePaymentEvent(store, order, "approved", { repeatOf: "evt-1" });
    expect(first.outcome).toBe("applied");
    expect(first.order).toMatchObject({ status: "paid", paymentStatus: "paid" });
    const again = await simulatePaymentEvent(store, first.order, "approved", { repeatOf: "evt-1" });
    expect(again.outcome).toBe("duplicate");
    const stale = await simulatePaymentEvent(store, first.order, "pending");
    expect(stale.outcome).toBe("ignored");
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "online_order"], ["eq", "originId", order.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ kind: "receivable", partyType: "other" });
    expect(await store.get("gateway_transactions", detId("gwtx", order.id))).toMatchObject({ gross: 3 * 2490, status: "awaiting_credit" });

    // retirada antes da nota: bloqueada
    await expect(confirmPicking(admin, order.id, { volumes: 1 })).rejects.toThrow(/NF-e/);
    const invoiced = await authorize(order.id);
    expect(invoiced).toMatchObject({ status: "invoiced", fiscalStatus: "authorized" });
    const nfe = await store.get("fiscal_documents", invoiced.fiscalDocumentId);
    expect(nfe).toMatchObject({ originType: "online_order", presence: "2" });

    const ready = await confirmPicking(admin, order.id, { volumes: 1 });
    expect(ready.status).toBe("ready_for_pickup");
    await expect(confirmPickup(admin, order.id, "000000")).rejects.toMatchObject({ code: "pickup_code" });
    const done = await confirmPickup(admin, order.id, ready.pickupCode);
    expect(done.status).toBe("delivered");
    expect(await bal("caderno-u")).toEqual({ physical: before.physical - 3 * QTY, reserved: before.reserved });
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originType", "online_order"], ["eq", "originId", order.id]] });
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ type: "sale", qty: -3 * QTY });
  });

  it("cartão de teste recusado cancela e libera a reserva; aprovação tardia vira estorno pendente", async () => {
    const before = await bal("bone-u");
    const t = await cartWith([[await slugOf("bone"), 2]]);
    const order = await placeOrder(store, st, t, checkout({ payment: { method: "card", installments: 1, simulate: "decline" } }));
    expect(order).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect(await bal("bone-u")).toEqual(before);
    const late = await handlePaymentEvent(store, order, { externalKey: "late-approval", type: "approved", providerRef: order.payment.providerRef }, "teste");
    expect(late.outcome).toBe("ignored");
    expect((await orderOfCompany(admin, order.id)).refundStatus).toBe("pending");
  });

  it("cartão aprovado em 3x gera recebível em 3 parcelas; cancelamento antes da nota estorna e libera a reserva", async () => {
    const before = await bal("fone-u");
    const t = await cartWith([[await slugOf("fone"), 1]]);
    const order = await placeOrder(store, st, t, checkout({ payment: { method: "card", installments: 3, simulate: "approve" } }));
    expect(order).toMatchObject({ status: "paid", paymentStatus: "paid" });
    const insts = await listAll(store, "installments", { filters: [["eq", "titleId", order.receivableTitleId]] });
    expect(insts).toHaveLength(3);
    const cancelled = await cancelOrder(admin, order.id, "Cliente desistiu por telefone");
    expect(cancelled).toMatchObject({ status: "cancelled", paymentStatus: "refunded", refundStatus: "done" });
    expect(await bal("fone-u")).toEqual(before);
    expect((await store.get("titles", order.receivableTitleId))!.status).toBe("cancelled");
  });

  it("cupom: desconto só nos produtos com teto e mínimo; uso contado e devolvido ao cancelar; limite de usos", async () => {
    await saveCoupon(admin, { code: "bemvindo10", percentBps: 1000, capAmount: 2000, minOrder: 10000, freeShipping: false, active: true, usageLimit: 1 });
    const t = await cartWith([[await slugOf("caderno"), 3]]); // 74,70: abaixo do mínimo
    await expect(applyCoupon(store, st, t, "BEMVINDO10")).rejects.toMatchObject({ code: "coupon_invalid" });
    await setCartQty(store, st, t, sku("caderno-u"), 10); // 249,00 → 10% = 24,90, teto 20,00
    await applyCoupon(store, st, t, "bemvindo10");
    const v = await cartView(store, st, t);
    expect(v!.discount).toBe(2000);
    const order = await placeOrder(store, st, t, checkout());
    expect(order).toMatchObject({ discount: 2000, total: 24900 - 2000, couponCode: "BEMVINDO10" });
    expect(order.items.reduce((a: number, i: any) => a + i.discount, 0)).toBe(2000);
    const coupon = (await listAll(store, "store_coupons", { filters: [["eq", "code", "BEMVINDO10"]] }))[0];
    expect(coupon.usedCount).toBe(1);
    // esgotado para o próximo carrinho
    const t2 = await cartWith([[await slugOf("caderno"), 10]]);
    await expect(applyCoupon(store, st, t2, "BEMVINDO10")).rejects.toThrow(/esgotado/i);
    await cancelOrder(admin, order.id, "Teste de devolução do uso do cupom");
    expect((await store.get("store_coupons", coupon.id))!.usedCount).toBe(0);
  });

  it("Pix vencido: a rotina cancela o pedido e libera a reserva", async () => {
    const before = await bal("caderno-u");
    const t = await cartWith([[await slugOf("caderno"), 2]]);
    const order = await placeOrder(store, st, t, checkout());
    await store.update("online_orders", order.id, { expiresAt: new Date(Date.now() - 60000).toISOString() });
    expect(await expirePendingOrders(store, admin.companyId)).toBe(1);
    expect(await orderOfCompany(admin, order.id)).toMatchObject({ status: "cancelled", paymentStatus: "expired" });
    expect(await bal("caderno-u")).toEqual(before);
    expect(await expirePendingOrders(store, admin.companyId)).toBe(0);
  });

  it("transportadora: frete grátis acima do mínimo só na entrega padrão; despacho exige nota; arrependimento devolve ao estoque", async () => {
    const ship = shippingOf(st);
    await saveShipping(admin, { ...ship, freeShippingMin: 20000, pickupBranchIds: st.pickupBranchIds, fulfillmentBranchId: st.fulfillmentBranchId });
    await fresh();
    const t = await cartWith([[await slugOf("fone"), 2]]); // 299,80
    await setDeliveryZip(store, st, t, "01310100");
    const v = await cartView(store, st, t);
    const std = v!.delivery.options.find((o) => o.id === "carrier:standard")!;
    const exp = v!.delivery.options.find((o) => o.id === "carrier:express")!;
    expect(std).toMatchObject({ price: 0, free: true });
    expect(exp.price).toBeGreaterThan(0);
    await selectDelivery(store, st, t, "carrier:express");
    const before = await bal("fone-u");
    let order = await placeOrder(store, st, t, checkout({ deliveryOptionId: "carrier:express", payment: { method: "card", installments: 1, simulate: "approve" } }));
    expect(order.total).toBe(29980 + exp.price);
    await expect(dispatchOrder(admin, order.id)).rejects.toThrow(/NF-e|pagamento/);
    order = await authorize(order.id);
    await confirmPicking(admin, order.id, { volumes: 1 });
    const labeled = await generateLabel(admin, order.id);
    expect(labeled.delivery.trackingCode).toMatch(/^SIM/);
    order = await dispatchOrder(admin, order.id);
    expect(order.status).toBe("shipped");
    expect((await bal("fone-u")).physical).toBe(before.physical - 2 * QTY);
    order = await confirmDelivery(admin, order.id);
    order = await requestReturn(store, order, { reason: "withdrawal", details: "Não serviu, quero devolver." });
    expect(order.status).toBe("return_requested");
    order = await completeReturn(admin, order.id, "Produto conferido, embalagem original.");
    expect(order).toMatchObject({ status: "returned", paymentStatus: "refunded" });
    expect(await bal("fone-u")).toEqual(before);
  });

  it("pedidos não pagos seguram estoque: limite por e-mail e por acesso (IP) na loja", async () => {
    const one = await placeOrder(store, st, await cartWith([[await slugOf("caderno"), 1]]), checkout({ meta: { ip: "203.0.113.7" } }));
    await placeOrder(store, st, await cartWith([[await slugOf("caderno"), 1]]), checkout({ meta: { ip: "203.0.113.7" } }));
    await expect(placeOrder(store, st, await cartWith([[await slugOf("caderno"), 1]]), checkout({ meta: { ip: "198.51.100.1" } }))).rejects.toMatchObject({ code: "too_many_pending" });
    const other = (n: number) => checkout({ customer: { name: "Outra Pessoa", email: `outra${n}@example.com`, phone: "11987654321", doc: "52998224725" }, meta: { ip: "203.0.113.7" } });
    expect((await placeOrder(store, st, await cartWith([[await slugOf("caderno"), 1]]), other(1))).status).toBe("pending_payment"); // 3º do mesmo acesso
    await expect(placeOrder(store, st, await cartWith([[await slugOf("caderno"), 1]]), other(2))).rejects.toMatchObject({ code: "too_many_pending" });
    // pago, deixa de contar
    await simulatePaymentEvent(store, one, "approved");
    expect((await placeOrder(store, st, await cartWith([[await slugOf("caderno"), 1]]), other(3))).status).toBe("pending_payment");
  });

  it("checkout recusa dados inválidos e opção de entrega inexistente; pagamento de boleto desligado não é aceito", async () => {
    const t = await cartWith([[await slugOf("caderno"), 1]]);
    await expect(placeOrder(store, st, t, checkout({ customer: { name: "A", email: "x", phone: "1", doc: "123" } }))).rejects.toMatchObject({ code: "checkout_invalid" });
    await expect(placeOrder(store, st, t, checkout({ deliveryOptionId: "carrier:teleporte" }))).rejects.toMatchObject({ code: "delivery_changed" });
    const pay = paymentsOf(st);
    await savePayments(admin, { ...pay, methods: { ...pay.methods, boleto: { ...pay.methods.boleto, enabled: false } } });
    await fresh();
    await expect(placeOrder(store, st, t, checkout({ payment: { method: "boleto", installments: 1 } }))).rejects.toMatchObject({ code: "checkout_invalid" });
  });
});

describe("domínio próprio e avisos do gateway", () => {
  it("domínio: só o nome, sem protocolo/caminho, e nunca um endereço do sistema", () => {
    expect(normalizeDomain(" Loja.Exemplo.com.br. ")).toBe("loja.exemplo.com.br");
    expect(() => normalizeDomain("https://loja.exemplo.com.br")).toThrow(/sem https/);
    expect(() => normalizeDomain("loja.exemplo.com.br/produtos")).toThrow();
    expect(() => normalizeDomain("minhaloja.vercel.app")).toThrow(/próprio sistema/);
    expect(() => normalizeDomain("localhost")).toThrow();
  });

  it("domínio próprio: só o verificado abre a loja; hosts do ERP nunca viram vitrine", async () => {
    const { resolveStore } = await import("@/domain/ecommerce/storefront");
    const { isErpHost } = await import("@/middleware");
    const { detId } = await import("@/lib/db");
    const put = (storeId: string, status: string) => store.create("store_domains", { companyId: st.companyId, branchId: null, storeId, domain: "loja.exemplo.com.br", primary: true, status, provider: "manual_dns", dns: { verifyToken: "abc" } }, detId("sdomain", storeId, "loja.exemplo.com.br"));
    await put(st.id, "pending_dns");
    expect(await resolveStore(store, "~loja.exemplo.com.br")).toBeNull();
    // outra loja cadastra o mesmo domínio e comprova a propriedade: só ela abre
    const other = await store.create("stores", { companyId: "outra-empresa", branchId: null, name: "Outra", slug: "outra", status: "published" });
    await put(other.id, "active");
    const r = await resolveStore(store, "~loja.exemplo.com.br");
    expect(r).toMatchObject({ basePath: "", viaDomain: true });
    expect(r!.st.id).toBe(other.id);
    expect((await resolveStore(store, "loja-teste"))?.basePath).toBe("/loja/loja-teste");
    expect(isErpHost("intercerterp.vercel.app")).toBe(true);
    expect(isErpHost("localhost:3000")).toBe(true);
    expect(isErpHost("loja.exemplo.com.br")).toBe(false);
    process.env.APP_HOSTS = "erp.minhaempresa.com.br";
    expect(isErpHost("erp.minhaempresa.com.br")).toBe(true);
    delete process.env.APP_HOSTS;
  });

  it("Gateway Intercert: aviso só vale com assinatura HMAC válida e recente", () => {
    process.env.GATEWAY_INTERCERT_WEBHOOK_SECRET = "segredo-de-teste";
    const gw = intercertGateway({ webhookSecret: "GATEWAY_INTERCERT_WEBHOOK_SECRET" });
    const body = JSON.stringify({ id: "evt_1", type: "payment.approved", data: { chargeId: "ch_1", amount: 1000 } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", "segredo-de-teste").update(`${ts}.${body}`).digest("hex");
    const h = (s: string, t = ts) => new Headers({ "x-intercert-timestamp": t, "x-intercert-signature": s });
    expect(gw.verifyWebhook(h(sig), body)).toBe(true);
    expect(gw.verifyWebhook(h(sig), body.replace("1000", "9000"))).toBe(false);
    expect(gw.verifyWebhook(h(sig, String(Number(ts) - 3600)), body)).toBe(false);
    expect(gw.parseWebhook(JSON.parse(body))).toEqual([expect.objectContaining({ externalKey: "intercert:evt_1", type: "approved", providerRef: "ch_1", amount: 1000 })]);
    delete process.env.GATEWAY_INTERCERT_WEBHOOK_SECRET;
  });
});
