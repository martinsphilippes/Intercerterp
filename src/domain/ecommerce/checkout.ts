import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { nowIso, addDays } from "@/lib/dates";
import { QTY, allocate, formatMoney } from "@/lib/money";
import { isValidCnpj, isValidCpf, onlyDigits, searchable } from "@/lib/core/text";
import { nextNumber } from "@/lib/core/numbering";
import { defaultWarehouse, releaseReservations, reserve } from "../stock";
import { cartView, couponByCode, couponDiscount, getCart } from "./cart";
import { commerceEvent, orderCode, orderEvent, randomToken, storeCtx, type DeliveryMode, type PayMethod } from "./common";
import { ORDER_COLLECTION, expirePendingOrders, handlePaymentEvent } from "./orders";
import { gatewayFor } from "./providers";
import { checkoutOf, paymentsOf } from "./store";

/**
 * Checkout (Tela 64): identificação, endereço, entrega, pagamento e confirmação num fluxo único.
 *
 *  - Tudo é revalidado no servidor (preço, estoque, cupom, cotação do frete): o navegador só escolhe.
 *  - O pedido nasce "aguardando pagamento" COM o estoque reservado; criar o pedido e aprovar o pagamento são estados
 *    separados. Pix e boleto têm prazo; vencido, o pedido é cancelado e a reserva liberada.
 *  - Clique duplo / reenvio: a mesma chave de envio devolve o mesmo pedido; um carrinho vira no máximo um pedido.
 *  - Cartão: o número nunca chega ao servidor (componente do gateway gera um token no navegador); na simulação não há
 *    campo de cartão ("Cartão de teste").
 *  - Cliente: localizado pelo CPF/CNPJ na empresa; se não existir, é cadastrado. Cadastro existente nunca é alterado
 *    pela vitrine (o pedido guarda os dados informados).
 */

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export interface CheckoutInput {
  /** chave do envio (gerada ao abrir o checkout): repetir o envio devolve o mesmo pedido */
  submissionKey: string;
  customer: { name: string; email: string; phone: string; doc: string };
  address: { zip: string; street: string; number: string; complement?: string | null; district: string; cityName: string; cityCode?: string | null; uf: string };
  deliveryOptionId: string;
  payment: { method: PayMethod; installments: number; simulate?: "approve" | "decline" | null; cardToken?: string | null };
  acceptTerms: boolean;
  marketingConsent: boolean;
  notes?: string | null;
  meta?: { ip?: string | null; userAgent?: string | null };
}

export interface CheckoutProblem {
  field: string;
  message: string;
}

/** Validação dos dados do comprador (devolve a lista de problemas por campo — a tela marca cada um). */
export function validateCheckout(st: Doc, input: CheckoutInput): CheckoutProblem[] {
  const out: CheckoutProblem[] = [];
  const c = input.customer;
  const a = input.address;
  if (String(c.name ?? "").trim().length < 3 || !/\s/.test(String(c.name).trim())) out.push({ field: "name", message: "Informe o nome completo." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(c.email ?? "").trim())) out.push({ field: "email", message: "E-mail inválido." });
  const phone = onlyDigits(c.phone);
  if (phone.length < 10 || phone.length > 11) out.push({ field: "phone", message: "Telefone com DDD (10 ou 11 dígitos)." });
  const doc = onlyDigits(c.doc);
  const needDoc = checkoutOf(st).requireDoc;
  if (doc || needDoc) {
    if (!(doc.length === 11 && isValidCpf(doc)) && !(doc.length === 14 && isValidCnpj(doc))) out.push({ field: "doc", message: needDoc ? "Informe um CPF ou CNPJ válido (necessário para a nota fiscal)." : "CPF/CNPJ inválido." });
  }
  if (onlyDigits(a.zip).length !== 8) out.push({ field: "zip", message: "CEP com 8 dígitos." });
  if (String(a.street ?? "").trim().length < 3) out.push({ field: "street", message: "Informe o endereço." });
  if (!String(a.number ?? "").trim()) out.push({ field: "number", message: "Informe o número (ou S/N)." });
  if (String(a.district ?? "").trim().length < 2) out.push({ field: "district", message: "Informe o bairro." });
  if (String(a.cityName ?? "").trim().length < 2) out.push({ field: "cityName", message: "Informe a cidade." });
  if (!UFS.includes(String(a.uf ?? "").toUpperCase())) out.push({ field: "uf", message: "Escolha a UF." });
  if (a.cityCode && !/^\d{7}$/.test(String(a.cityCode))) out.push({ field: "cityCode", message: "Código do município inválido." });
  if (!input.acceptTerms) out.push({ field: "acceptTerms", message: "É preciso aceitar os termos de compra e a política de privacidade." });
  const pay = paymentsOf(st);
  const m = pay.methods[input.payment.method];
  if (!m?.enabled) out.push({ field: "payment", message: "Escolha um meio de pagamento disponível." });
  if (!input.deliveryOptionId) out.push({ field: "delivery", message: "Escolha a forma de entrega." });
  return out;
}

/** Cliente da empresa pelo CPF/CNPJ; sem cadastro, cria um (com o consentimento de mensagens informado). */
async function customerFor(store: Store, st: Doc, input: CheckoutInput): Promise<Doc | null> {
  const doc = onlyDigits(input.customer.doc);
  if (!doc) return null;
  const ctx = storeCtx(store, st);
  const found = (await listAll(ctx.store, "customers", { filters: [["eq", "companyId", st.companyId], ["eq", "doc", doc]] }))[0];
  if (found) return found;
  const { createCustomer } = await import("../customers");
  const a = input.address;
  try {
    return await createCustomer(
      ctx,
      {
        personType: doc.length === 14 ? "PJ" : "PF",
        doc,
        name: input.customer.name.trim(),
        email: input.customer.email.trim().toLowerCase(),
        mobile: onlyDigits(input.customer.phone),
        finalConsumer: true,
        acceptsPromotions: Boolean(input.marketingConsent),
        promoChannels: input.marketingConsent ? ["email"] : [],
        addresses: [{ type: "main", zip: onlyDigits(a.zip), street: a.street.trim(), number: a.number.trim(), complement: a.complement?.trim() || undefined, district: a.district.trim(), cityName: a.cityName.trim(), cityCode: a.cityCode || undefined, uf: a.uf.toUpperCase() } as any],
        notes: `Cadastro criado pela loja virtual ${st.name}.`,
        status: "active",
      },
      { quick: true, idemKey: `store:${st.id}:doc:${doc}` },
    );
  } catch (e) {
    // corrida com outro pedido do mesmo documento: usa o cadastro que ganhou
    const again = (await listAll(ctx.store, "customers", { filters: [["eq", "companyId", st.companyId], ["eq", "doc", doc]] }))[0];
    if (again) return again;
    throw e;
  }
}

/** Fecha o pedido a partir do carrinho. Devolve o pedido (o mesmo em reenvios). */
export async function placeOrder(store: Store, st: Doc, cartToken: string, input: CheckoutInput): Promise<Doc> {
  if (st.status !== "published") throw new BusinessError("A loja não está recebendo pedidos no momento.", "store_closed");
  const cart = await getCart(store, st, cartToken);
  if (!cart) throw new BusinessError("Seu carrinho expirou: adicione os produtos novamente.", "cart_missing");
  const base = unscoped(store);
  if (cart.orderId) {
    const existing = await base.get(ORDER_COLLECTION, cart.orderId);
    if (existing) return existing;
  }
  assert(/^[0-9a-f]{16,64}$/.test(String(input.submissionKey ?? "")), "Envio inválido: recarregue a página do checkout.");
  const orderId = detId("oorder", cart.id, input.submissionKey);
  const already = await base.get(ORDER_COLLECTION, orderId);
  if (already) return already;

  const problems = validateCheckout(st, input);
  if (problems.length) throw new BusinessError(problems.map((p) => p.message).join(" "), "checkout_invalid");

  // pedidos vencidos da empresa liberam estoque antes da nova reserva
  await expirePendingOrders(store, st.companyId).catch(() => 0);

  // carrinho e frete recalculados no servidor (CEP do endereço informado)
  const zip = onlyDigits(input.address.zip);
  if (cart.delivery?.zip !== zip) await base.update("store_carts", cart.id, { delivery: { zip, selectedId: input.deliveryOptionId, options: null, quotedAt: null } });
  else if (cart.delivery?.selectedId !== input.deliveryOptionId) await base.update("store_carts", cart.id, { delivery: { ...cart.delivery, selectedId: input.deliveryOptionId } });
  const view = await cartView(store, st, cartToken, { requote: true });
  if (!view || !view.lines.length) throw new BusinessError("Seu carrinho está vazio.", "cart_empty");
  if (view.blockers.length) throw new BusinessError(view.blockers.join(" "), "cart_invalid");
  const option = view.delivery.options.find((o) => o.id === input.deliveryOptionId);
  if (!option) throw new BusinessError("A forma de entrega escolhida não está mais disponível para este endereço: escolha novamente.", "delivery_changed");

  // pagamento: parcelas dentro do limite e parcela mínima
  const pay = paymentsOf(st);
  let installments = 1;
  if (input.payment.method === "card") {
    const max = pay.methods.card.maxInstallments ?? 1;
    const minInst = pay.methods.card.minInstallment ?? 0;
    installments = Math.max(1, Math.min(max, Math.floor(input.payment.installments || 1)));
    if (minInst > 0) installments = Math.max(1, Math.min(installments, Math.floor(view.total / minInst) || 1));
  }

  // cupom: limite por cliente
  const coupon = view.coupon;
  const docDigits = onlyDigits(input.customer.doc);
  if (coupon?.perCustomerLimit) {
    const prev = (await listAll(base, ORDER_COLLECTION, { filters: [["eq", "storeId", st.id], ["eq", "couponId", coupon.id]] })).filter(
      (o) => o.status !== "cancelled" && ((docDigits && onlyDigits(o.customer?.doc) === docDigits) || String(o.customer?.email ?? "").toLowerCase() === input.customer.email.trim().toLowerCase()),
    );
    if (prev.length >= coupon.perCustomerLimit) throw new BusinessError(`O cupom ${coupon.code} já foi usado por você o número máximo de vezes.`, "coupon_limit");
  }

  // filial que atende: a da retirada escolhida ou a de expedição da loja
  const branchId = option.mode === "pickup" && option.branchId ? option.branchId : st.fulfillmentBranchId;
  const wh = await defaultWarehouse(base, branchId);
  const ctx = storeCtx(store, st, branchId);

  // desconto do cupom rateado pelos itens (a nota fiscal leva o desconto por item)
  const sellLines = view.lines;
  const weights = sellLines.map((l) => l.lineTotal);
  const discounts = view.discount > 0 ? allocate(view.discount, weights) : sellLines.map(() => 0);
  const items = sellLines.map((l, k) => ({
    skuId: l.skuId,
    productId: l.productId,
    sku: l.sku,
    title: l.title,
    variant: l.variant,
    qty: l.units * QTY,
    unitPrice: l.unitPrice,
    discount: discounts[k],
    total: l.lineTotal - discounts[k],
    warehouseId: wh.id,
  }));

  // reserva (tudo ou nada): falta de saldo em um item libera os já reservados
  try {
    for (const it of items) await reserve({ ...ctx, store: base }, { warehouseId: wh.id, skuId: it.skuId, qty: it.qty, originType: "online_order", originId: orderId, idemKey: `oorder:${orderId}:${it.skuId}` });
  } catch (e: any) {
    await releaseReservations({ ...ctx, store: base }, "online_order", orderId, "released").catch(() => 0);
    if (e?.code === "insufficient_stock") throw new BusinessError("Um dos produtos acabou de ficar sem estoque suficiente. Revise o carrinho.", "insufficient_stock");
    throw e;
  }

  const number = await nextNumber(base, `online_order:${st.companyId}`);
  const code = orderCode(st.orderPrefix, number);
  const customer = await customerFor(store, st, input).catch(() => null);
  const a = input.address;
  const method = input.payment.method;
  const expiresAt =
    method === "pix" ? new Date(Date.now() + (pay.methods.pix.expiresMinutes ?? 30) * 60000).toISOString() : method === "boleto" ? `${addDays(nowIso().slice(0, 10), (pay.methods.boleto.dueDays ?? 3) + 1)}T23:59:59.000Z` : new Date(Date.now() + 30 * 60000).toISOString();
  const deliveryMode: DeliveryMode = option.mode;
  const data = {
    companyId: st.companyId,
    branchId,
    createdBy: "storefront",
    storeId: st.id,
    number,
    code,
    token: randomToken(),
    origin: "store",
    status: "pending_payment",
    paymentStatus: "pending",
    fiscalStatus: "none",
    customerId: customer?.id ?? null,
    customer: { name: input.customer.name.trim(), email: input.customer.email.trim().toLowerCase(), phone: onlyDigits(input.customer.phone), doc: docDigits || null, personType: docDigits.length === 14 ? "PJ" : "PF" },
    shippingAddress: { zip: onlyDigits(a.zip), street: a.street.trim(), number: a.number.trim(), complement: a.complement?.trim() || null, district: a.district.trim(), cityName: a.cityName.trim(), cityCode: a.cityCode || null, uf: a.uf.toUpperCase() },
    items,
    itemsCount: view.units,
    subtotal: view.subtotal,
    discount: view.discount,
    couponCode: coupon?.code ?? null,
    couponId: coupon?.id ?? null,
    shippingAmount: option.price,
    total: view.subtotal - view.discount + option.price,
    delivery: { optionId: option.id, mode: deliveryMode, service: option.service, label: option.label, detail: option.detail, price: option.price, originalPrice: option.originalPrice, free: option.free, daysMin: option.daysMin, daysMax: option.daysMax, branchId: option.branchId, provider: option.provider, simulated: option.simulated },
    payment: { method, installments, provider: null, providerRef: null, simulated: null, status: "creating" },
    fiscalDocumentId: null,
    receivableTitleId: null,
    pickupCode: deliveryMode === "pickup" ? String(100000 + (parseInt(randomToken(4), 16) % 900000)) : null,
    consents: { termsAt: nowIso(), privacyAt: nowIso(), marketing: Boolean(input.marketingConsent), ip: input.meta?.ip?.slice(0, 64) ?? null, userAgent: input.meta?.userAgent?.slice(0, 200) ?? null },
    notes: input.notes?.trim().slice(0, 500) || null,
    idemKey: `${cart.id}:${input.submissionKey}`,
    expiresAt,
    searchText: searchable(code, input.customer.name, input.customer.email, docDigits),
  };
  let order: Doc;
  try {
    order = await store.transaction(async (t) => {
      // um carrinho vira no máximo um pedido (marcador na mesma transação)
      await t.create("operations", { companyId: st.companyId, type: "store_cart.order", status: "done", entityType: "store_cart", entityId: cart.id, result: { orderId }, createdBy: "storefront" }, detId("cart-order", cart.id));
      const o = await t.create(ORDER_COLLECTION, data, orderId);
      if (coupon) {
        if (coupon.usageLimit) await t.increment("store_coupons", coupon.id, "usedCount", 1, { max: coupon.usageLimit });
        else await t.increment("store_coupons", coupon.id, "usedCount", 1);
      }
      await t.update("store_carts", cart.id, { status: "ordered", orderId, customer: { name: data.customer.name, email: data.customer.email, phone: data.customer.phone }, marketingConsent: Boolean(input.marketingConsent), lastActivityAt: nowIso() });
      return o;
    });
  } catch (e: any) {
    await releaseReservations({ ...ctx, store: base }, "online_order", orderId, "released").catch(() => 0);
    if (isConflict(e)) {
      const winner = (await base.get("operations", detId("cart-order", cart.id)))?.result?.orderId;
      const won = winner ? await base.get(ORDER_COLLECTION, winner) : null;
      if (won) return won;
      if (e.reason === "bounds") throw new BusinessError(`O cupom ${coupon?.code} esgotou agora há pouco. Remova o cupom para continuar.`, "coupon_exhausted");
    }
    throw e;
  }
  await orderEvent(ctx, order, "status", `Pedido ${code} registrado pela loja virtual — ${formatMoney(order.total)} (${option.label}). Estoque reservado.`, null, "Cliente");
  await commerceEvent(store, { companyId: st.companyId, storeId: st.id, area: "checkout", action: "checkout.order", status: "ok", reference: code, orderId, externalKey: `order:${orderId}`, diagnostic: `Pedido criado com ${items.length} item(ns) e reserva de estoque.`, subject: `order:${orderId}` });
  return createChargeFor(store, st, order, { method, installments, simulate: input.payment.simulate ?? null, cardToken: input.payment.cardToken ?? null });
}

/** Gera a cobrança no gateway e grava os dados para pagamento; cartão aprovado vira evento de pagamento na hora. */
export async function createChargeFor(store: Store, st: Doc, order: Doc, p: { method: PayMethod; installments: number; simulate?: "approve" | "decline" | null; cardToken?: string | null }): Promise<Doc> {
  const base = unscoped(store);
  const pay = paymentsOf(st);
  const gw = await gatewayFor(store, st.companyId);
  const ctx = storeCtx(store, st, order.branchId);
  try {
    const ch = await gw.createCharge({
      orderId: order.id,
      orderCode: order.code,
      amount: order.total,
      method: p.method,
      installments: p.installments,
      customer: { name: order.customer?.name ?? "", email: order.customer?.email ?? "", doc: order.customer?.doc ?? "" },
      simulate: p.simulate ?? null,
      cardToken: p.cardToken ?? null,
      pixExpiresMinutes: pay.methods.pix.expiresMinutes ?? 30,
      boletoDueDays: pay.methods.boleto.dueDays ?? 3,
    });
    let after: Doc = await base.update(ORDER_COLLECTION, order.id, {
      payment: { method: p.method, installments: p.installments, provider: gw.id, providerRef: ch.providerRef, simulated: gw.simulated, status: ch.status, message: ch.message, pix: ch.pix ?? null, boleto: ch.boleto ?? null, card: ch.card ?? null, createdAt: nowIso() },
      ...(ch.pix?.expiresAt ? { expiresAt: ch.pix.expiresAt } : {}),
    });
    await orderEvent(ctx, after, "payment", ch.message);
    if (ch.approvedNow) after = (await handlePaymentEvent(store, after, { externalKey: `${gw.id}:charge:${ch.providerRef}`, type: "approved", providerRef: ch.providerRef, amount: order.total }, "checkout")).order;
    else if (ch.status === "failed") after = (await handlePaymentEvent(store, after, { externalKey: `${gw.id}:charge:${ch.providerRef}`, type: "failed", providerRef: ch.providerRef, message: ch.message }, "checkout")).order;
    return after;
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 400);
    const after = await base.update(ORDER_COLLECTION, order.id, { payment: { ...(order.payment ?? {}), method: p.method, installments: p.installments, provider: gw.id, simulated: gw.simulated, status: "error", message: msg } });
    await commerceEvent(store, { companyId: st.companyId, storeId: st.id, area: "payment", action: "payment.charge", status: "failed", reference: order.code, orderId: order.id, diagnostic: `Cobrança não gerada: ${msg}`, subject: `order:${order.id}` });
    await orderEvent(ctx, after, "payment", `Cobrança não gerada: ${msg}`);
    return after;
  }
}

/** Simulador de retorno do gateway (Tela 56) e "Simular pagamento" da página do pedido (somente com gateway em simulação). */
export async function simulatePaymentEvent(store: Store, order: Doc, type: "approved" | "pending" | "failed" | "expired", opts: { repeatOf?: string | null } = {}) {
  assert(order.payment?.simulated !== false, "O pedido foi cobrado por um gateway real: o simulador não se aplica.");
  const key = opts.repeatOf ?? `sim:${type}:${order.id}:${Date.now().toString(36)}`;
  return handlePaymentEvent(store, order, { externalKey: key, type, providerRef: order.payment?.providerRef ?? "", amount: order.total, message: type === "failed" ? "Recusa simulada" : null }, "simulador");
}

export { couponByCode, couponDiscount };
