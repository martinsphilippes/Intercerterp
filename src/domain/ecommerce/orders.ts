import crypto from "node:crypto";
import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { notify } from "@/lib/core/notify";
import { addDays, addMonths, nowIso, today } from "@/lib/dates";
import { formatMoney, pct } from "@/lib/money";
import { applyOnce, defaultWarehouse, postMovements, releaseReservations } from "../stock";
import { createTitle, buildSchedule } from "../finance";
import {
  ORDER_CLOSED,
  ORDER_STATUS_LABEL,
  PAY_METHOD_LABEL,
  WITHDRAWAL_DAYS,
  commerceEvent,
  orderEvent,
  settleCommerceEvent,
  storeCtx,
  type OrderStatus,
  type PayMethod,
} from "./common";
import { gatewayFor, logisticsFor, type PaymentEvent } from "./providers";
import { BOLETO_FIXED_FEE, paymentsOf, primaryDomainOf, storeUrl } from "./store";

/**
 * Pedidos on-line (Telas 54, 56, 59 e 64). Estados (docs/regras-assumidas.md §49):
 *
 *   pending_payment ─(pagamento aprovado)→ paid ─(NF-e autorizada)→ invoiced ─┬─(separado, retirada)→ ready_for_pickup ─(código)→ delivered
 *        │                                  │                               └─(despachado)→ shipped ─(entregue)→ delivered
 *        └─(recusa, expiração, cancelamento)→ cancelled ←──(cancelamento antes da saída; pago = estorno)──┘
 *   delivered/shipped ─(arrependimento ou defeito)→ return_requested ─(mercadoria recebida)→ returned
 *
 * Regras transversais: pagamento aprovado ≠ crédito no banco ≠ entrega concluída; o estoque fica RESERVADO do checkout
 * até a saída (despacho ou retirada), quando vira baixa de venda — uma única vez; evento repetido nunca duplica efeito.
 */

export const ORDER_COLLECTION = "online_orders";

export async function orderOfCompany(ctx: Ctx, id: string): Promise<Doc> {
  const o = await unscoped(ctx.store).get(ORDER_COLLECTION, id);
  if (!o || o.companyId !== ctx.companyId) throw new BusinessError("Pedido não encontrado.", "not_found");
  return o;
}

export async function orderByToken(store: Store, st: Doc, token: string): Promise<Doc | null> {
  if (!/^[0-9a-f]{32}$/.test(String(token ?? ""))) return null;
  const o = (await listAll(unscoped(store), ORDER_COLLECTION, { filters: [["eq", "token", token]] }))[0];
  return o && o.storeId === st.id ? o : null;
}

async function storeOf(store: Store, order: Doc) {
  return unscoped(store).getOrThrow("stores", order.storeId);
}

/** Contexto da operação do pedido (usuário do ERP ou "Loja virtual"), sempre na filial que atende o pedido. */
const inBranch = (ctx: Ctx, order: Doc): Ctx => ({ ...ctx, branchId: order.branchId ?? ctx.branchId });

async function patchOrder(store: Store, order: Doc, patch: Record<string, unknown>) {
  return unscoped(store).update(ORDER_COLLECTION, order.id, patch);
}

export async function trackingUrl(store: Store, st: Doc, order: Doc) {
  const domain = await primaryDomainOf(store, st.id);
  return `${storeUrl(st, { primaryDomain: domain })}/pedido/${order.token}`;
}

/** E-mail ao cliente quando há canal configurado; sem canal, fica só o registro na linha do tempo do pedido. */
async function notifyCustomer(store: Store, st: Doc, order: Doc, subject: string, lines: string[]) {
  const to = String(order.customer?.email ?? "").trim();
  if (!to) return;
  try {
    const { sendEmail } = await import("@/lib/core/email");
    const url = await trackingUrl(store, st, order);
    const html = `<p>Olá, ${String(order.customer?.name ?? "").split(" ")[0] || "cliente"}!</p>${lines.map((l) => `<p>${l}</p>`).join("")}<p><a href="${url}">Acompanhar o pedido ${order.code}</a></p><p>${st.name}</p>`;
    const r = await sendEmail(st.companyId, { to, subject: `${st.name} — ${subject}`, html });
    const ctx = storeCtx(store, st, order.branchId);
    await orderEvent(ctx, order, "email", r.delivered ? `E-mail ao cliente: ${subject}` : `E-mail ao cliente não enviado (${r.channel === "not_configured" ? "canal de e-mail não configurado" : r.message ?? r.channel})`);
  } catch {
    /* comunicação nunca desfaz a operação do pedido */
  }
}

// ───────────────────────────── Pagamento

export interface PaymentOutcome {
  order: Doc;
  outcome: "applied" | "duplicate" | "ignored";
  message: string;
}

/**
 * Aplica um evento de pagamento ao pedido (aviso do gateway, simulador da Tela 56, aprovação imediata do cartão ou
 * expiração). Idempotente pela chave externa do evento; eventos antigos não fazem o pedido retroceder.
 */
export async function handlePaymentEvent(store: Store, order: Doc, ev: PaymentEvent, source: string): Promise<PaymentOutcome> {
  const st = await storeOf(store, order);
  const reg = await commerceEvent(store, {
    companyId: order.companyId,
    storeId: order.storeId,
    area: "payment",
    action: `payment.${ev.type}`,
    status: "pending",
    reference: order.code,
    orderId: order.id,
    externalKey: ev.externalKey,
    payload: { source, type: ev.type, providerRef: ev.providerRef, amount: ev.amount ?? null, fee: ev.fee ?? null, message: ev.message ?? null },
    subject: `order:${order.id}`,
  });
  if (reg.duplicate) return { order, outcome: "duplicate", message: "Evento repetido: nenhuma nova baixa ou alteração (a operação original já foi tratada)." };
  const done = async (status: "ok" | "ignored" | "failed", diagnostic: string, o: Doc): Promise<PaymentOutcome> => {
    await settleCommerceEvent(store, reg.event.id, status, diagnostic);
    return { order: o, outcome: status === "ok" ? "applied" : "ignored", message: diagnostic };
  };
  const fresh = (await unscoped(store).get(ORDER_COLLECTION, order.id))!;
  if (ev.providerRef && fresh.payment?.providerRef && ev.providerRef !== fresh.payment.providerRef) return done("ignored", "Evento de outra cobrança (referência diferente da cobrança atual do pedido).", fresh);
  const ctx = storeCtx(store, st, fresh.branchId);
  const paid = ["paid", "refund_pending", "refunded"].includes(fresh.paymentStatus);
  switch (ev.type) {
    case "approved": {
      if (paid) return done("ignored", "Pedido já pago: evento sem efeito (não gera outra baixa).", fresh);
      if (fresh.status === "cancelled") {
        await patchOrder(store, fresh, { refundStatus: "pending", payment: { ...(fresh.payment ?? {}), lateApprovalAt: nowIso() } });
        await orderEvent(ctx, fresh, "payment", "Pagamento aprovado depois do cancelamento: estorno pendente ao cliente.");
        await notify(store, { companyId: fresh.companyId, branchId: fresh.branchId, type: "integration_failure", priority: "high", title: `Pedido ${fresh.code}: pagamento aprovado após o cancelamento`, body: "Providencie o estorno ao cliente (Comércio digital › Pedidos).", link: `/comercio-digital/pedidos/${fresh.id}`, originType: "online_order", originId: fresh.id, audience: { action: "ecommerce.finance" } }).catch(() => undefined);
        return done("failed", "Pagamento aprovado para pedido cancelado: estorno pendente.", fresh);
      }
      const o = await markPaid(store, st, fresh, ev);
      return done("ok", `Pagamento aprovado: pedido ${o.code} pago${o.status === "invoiced" ? " e faturado" : ""}.`, o);
    }
    case "pending":
      if (paid || fresh.status === "cancelled") return done("ignored", "Pedidos já pagos ou cancelados não retrocedem por um evento antigo.", fresh);
      return done("ok", "Pagamento em análise/aguardando: pedido mantido aguardando pagamento.", fresh);
    case "failed":
    case "expired": {
      if (paid) return done("ignored", "Pedido já pago: evento antigo de recusa/expiração sem efeito.", fresh);
      if (fresh.status === "cancelled") return done("ignored", "Pedido já cancelado.", fresh);
      const o = await cancelInternal(store, st, fresh, ev.type === "failed" ? `Pagamento recusado${ev.message ? `: ${ev.message}` : ""}` : "Prazo de pagamento expirado", { paymentStatus: ev.type === "failed" ? "failed" : "expired", actor: "Gateway" });
      return done("ok", ev.type === "failed" ? "Pagamento recusado: pedido cancelado e reserva liberada." : "Pagamento expirado: pedido cancelado e reserva liberada.", o);
    }
    case "refunded": {
      if (fresh.paymentStatus === "refunded") return done("ignored", "Estorno já registrado.", fresh);
      if (!paid) return done("ignored", "Estorno de pagamento não aprovado: sem efeito.", fresh);
      const o = await patchOrder(store, fresh, { paymentStatus: "refunded", refundStatus: "done" });
      await orderEvent(ctx, o, "payment", "Estorno confirmado pelo gateway.");
      return done("ok", "Estorno confirmado.", o);
    }
    case "chargeback": {
      await orderEvent(ctx, fresh, "payment", "Contestação de pagamento (chargeback) recebida do gateway.");
      await notify(store, { companyId: fresh.companyId, branchId: fresh.branchId, type: "integration_failure", priority: "high", title: `Pedido ${fresh.code}: contestação de pagamento`, body: "Analise a contestação junto ao gateway.", link: `/comercio-digital/pedidos/${fresh.id}`, originType: "online_order", originId: fresh.id, audience: { action: "ecommerce.finance" } }).catch(() => undefined);
      return done("failed", "Contestação (chargeback) registrada: analisar com o gateway.", fresh);
    }
  }
  return done("ignored", "Tipo de evento não tratado.", fresh);
}

/** Taxa estimada do gateway (substituída pela informada no aviso, quando houver). */
export function estimatedFee(st: Doc, method: PayMethod, amount: number) {
  const p = paymentsOf(st);
  const bps = p.feeBps[method] ?? 0;
  return method === "boleto" && !bps ? Math.min(BOLETO_FIXED_FEE, amount) : pct(amount, bps);
}

/** Pagamento aprovado: pedido pago + recebível contra o gateway no financeiro + transação do gateway (uma vez só). */
async function markPaid(store: Store, st: Doc, order: Doc, ev: PaymentEvent): Promise<Doc> {
  const ctx = storeCtx(store, st, order.branchId);
  const method = (order.payment?.method ?? "pix") as PayMethod;
  const gross = order.total;
  const fee = ev.fee != null && ev.fee >= 0 ? ev.fee : estimatedFee(st, method, gross);
  const p = paymentsOf(st);
  const paidDate = (ev.occurredAt ?? nowIso()).slice(0, 10);
  const firstDays = p.settlementDays[method] ?? 1;
  const n = method === "card" ? Math.max(1, Number(order.payment?.installments ?? 1)) : 1;
  const parts = buildSchedule(gross, { installments: n, firstDueDays: 0, intervalDays: 30 }, addDays(paidDate, firstDays)).map((x, k) => ({
    ...x,
    dueDate: k === 0 ? addDays(paidDate, firstDays) : addMonths(addDays(paidDate, firstDays), k),
    methodKind: method === "card" ? "credit" : method,
  }));
  const gatewayName = order.payment?.simulated ? "Gateway Intercert (simulação)" : "Gateway Intercert";
  const applied = await retryOnConflict(async () => {
    const cur = (await unscoped(store).get(ORDER_COLLECTION, order.id))!;
    if (["paid", "refund_pending", "refunded"].includes(cur.paymentStatus)) return cur;
    return store.transaction(async (t) => {
      const title = await createTitle(
        ctx,
        {
          kind: "receivable",
          partyType: "other",
          partyName: `${gatewayName} — ${PAY_METHOD_LABEL[method]}`,
          description: `Recebível do pedido on-line ${order.code}`,
          documentNumber: order.code,
          originType: "online_order",
          originId: order.id,
          issueDate: paidDate,
          competenceDate: paidDate,
          installments: parts,
          idemKey: `online_order:${order.id}:gateway`,
          branchId: order.branchId,
          notes: `Cobrança ${order.payment?.providerRef ?? "—"} · taxa ${ev.fee != null ? "informada" : "estimada"} ${formatMoney(fee)} · líquido previsto ${formatMoney(gross - fee)}`,
        },
        t,
      );
      await t.create(
        "gateway_transactions",
        {
          companyId: order.companyId,
          branchId: order.branchId,
          createdBy: ctx.user.id,
          storeId: order.storeId,
          orderId: order.id,
          provider: order.payment?.provider ?? "simulated",
          providerRef: order.payment?.providerRef ?? null,
          method,
          gross,
          fee,
          net: gross - fee,
          status: "awaiting_credit",
          expectedAt: parts[0].dueDate,
          creditedAt: null,
          reconciledAt: null,
          payoutId: null,
          titleId: title.id,
          installmentId: null,
          accountId: null,
          notes: n > 1 ? `${n} parcelas no cartão (créditos mensais)` : null,
        },
        detId("gwtx", order.id),
      );
      return t.update(ORDER_COLLECTION, order.id, { status: "paid", paymentStatus: "paid", paidAt: ev.occurredAt ?? nowIso(), receivableTitleId: title.id, payment: { ...(cur.payment ?? {}), fee, paidAmount: ev.amount ?? gross } });
    });
  });
  await orderEvent(ctx, applied, "payment", `Pagamento aprovado (${PAY_METHOD_LABEL[method]}) — ${formatMoney(gross)}. Recebível de ${formatMoney(gross)} contra o gateway, crédito previsto em ${parts[0].dueDate.split("-").reverse().join("/")}.`);
  await notify(store, { companyId: order.companyId, branchId: order.branchId, type: "info", title: `Pedido on-line ${order.code} pago`, body: `${formatMoney(gross)} · ${order.customer?.name ?? ""} · ${order.delivery?.label ?? ""}`, link: `/comercio-digital/pedidos/${order.id}`, originType: "online_order", originId: order.id, informative: true, audience: { action: "ecommerce.orders" } }).catch(() => undefined);
  await notifyCustomer(store, st, applied, `pagamento aprovado — pedido ${order.code}`, [`Recebemos o pagamento do pedido ${order.code} (${formatMoney(gross)}).`, "Agora vamos emitir a nota fiscal e preparar os produtos."]);
  if (p.autoInvoice) {
    try {
      const { invoiceOrder } = await import("./fiscal");
      await invoiceOrder(ctx, order.id);
    } catch (e: any) {
      await commerceEvent(store, { companyId: order.companyId, storeId: order.storeId, area: "fiscal", action: "fiscal.auto_invoice", status: "failed", reference: order.code, orderId: order.id, diagnostic: `Emissão automática da NF-e falhou: ${String(e?.message ?? e).slice(0, 400)}`, subject: `order:${order.id}` });
    }
  }
  return (await unscoped(store).get(ORDER_COLLECTION, order.id))!;
}

/** Nova tentativa de cobrança (falha do gateway ao gerar Pix/boleto) — mesmo pedido, mesma reserva. */
export async function retryCharge(store: Store, order: Doc): Promise<Doc> {
  assert(order.status === "pending_payment", "O pedido não está aguardando pagamento.");
  const st = await storeOf(store, order);
  const { createChargeFor } = await import("./checkout");
  return createChargeFor(store, st, order, { method: order.payment?.method, installments: order.payment?.installments ?? 1, simulate: null });
}

// ───────────────────────────── Cancelamento

/** Cancela (sem checar permissão): libera a reserva, devolve o uso do cupom, estorna se pago e cancela o recebível. */
async function cancelInternal(store: Store, st: Doc, order: Doc, reason: string, opts: { paymentStatus?: string; actor?: string; userCtx?: Ctx } = {}): Promise<Doc> {
  const ctx = opts.userCtx ? inBranch(opts.userCtx, order) : storeCtx(store, st, order.branchId);
  const marker = detId("oorder-cancel", order.id);
  const base = unscoped(store);
  try {
    await base.create("operations", { companyId: order.companyId, type: "online_order.cancel", status: "done", entityType: "online_order", entityId: order.id, result: { reason }, createdBy: ctx.user.id }, marker);
  } catch (e) {
    if (isConflict(e)) return (await base.get(ORDER_COLLECTION, order.id))!;
    throw e;
  }
  await releaseReservations({ ...ctx, store: base }, "online_order", order.id, "released");
  if (order.couponId) await base.increment("store_coupons", order.couponId, "usedCount", -1, { min: 0 }).catch(() => undefined);
  const wasPaid = order.paymentStatus === "paid";
  let paymentStatus = opts.paymentStatus ?? (order.paymentStatus === "pending" ? "cancelled" : order.paymentStatus);
  let refundStatus: string | null = order.refundStatus ?? null;
  if (wasPaid) {
    try {
      const gw = await gatewayFor(store, order.companyId);
      const r = await gw.refund({ providerRef: order.payment?.providerRef ?? "", amount: order.total, reason });
      paymentStatus = r.status;
      refundStatus = r.status === "refunded" ? "done" : "pending";
      await orderEvent(ctx, order, "payment", r.message);
    } catch (e: any) {
      paymentStatus = "refund_pending";
      refundStatus = "pending";
      await commerceEvent(store, { companyId: order.companyId, storeId: order.storeId, area: "payment", action: "payment.refund", status: "failed", reference: order.code, orderId: order.id, diagnostic: `Estorno não solicitado ao gateway: ${String(e?.message ?? e).slice(0, 400)}`, subject: `order:${order.id}` });
    }
    // recebível ainda sem baixa: cancelado (o valor volta ao cliente pelo estorno); com baixa, fica para a conciliação
    if (order.receivableTitleId) {
      try {
        const { cancelTitle } = await import("../finance");
        await cancelTitle(ctx, order.receivableTitleId, `Pedido on-line ${order.code} cancelado: ${reason}`);
      } catch (e: any) {
        await orderEvent(ctx, order, "finance", `Recebível mantido para conciliação do estorno: ${String(e?.message ?? e).slice(0, 200)}`);
      }
    }
    await base.update("gateway_transactions", detId("gwtx", order.id), { status: "refunded" }).catch(() => undefined);
  }
  const after = await base.update(ORDER_COLLECTION, order.id, { status: "cancelled", paymentStatus, refundStatus, cancelReason: reason.slice(0, 500), cancelledAt: nowIso() });
  await orderEvent(ctx, after, "status", `Pedido cancelado: ${reason}. Reserva de estoque liberada${wasPaid ? `; estorno ${refundStatus === "done" ? "registrado" : "pendente"}` : ""}.`, null, opts.actor);
  await notifyCustomer(store, st, after, `pedido ${order.code} cancelado`, [`O pedido ${order.code} foi cancelado (${reason}).`, wasPaid ? "O valor pago será devolvido pelo mesmo meio de pagamento." : "Nenhuma cobrança foi realizada."]);
  return after;
}

/** Tela 54: cancelar antes do despacho/retirada. NF-e autorizada precisa ser cancelada antes (no Fiscal). */
export async function cancelOrder(ctx: Ctx, orderId: string, reason: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.cancel");
  const order = await orderOfCompany(ctx, orderId);
  assert(reason.trim().length >= 5, "Informe o motivo do cancelamento (aparece para o cliente e no histórico).");
  assert(["pending_payment", "paid", "invoiced", "ready_for_pickup"].includes(order.status), `Pedido ${ORDER_STATUS_LABEL[order.status as OrderStatus]?.toLowerCase() ?? order.status}: depois da saída, use a devolução.`);
  if (order.fiscalStatus === "authorized") throw new BusinessError("O pedido tem NF-e autorizada: cancele a nota no Fiscal (dentro do prazo) e depois cancele o pedido.", "fiscal_authorized");
  if (order.fiscalDocumentId && ["processing", "queued"].includes(order.fiscalStatus)) throw new BusinessError("A NF-e do pedido está em processamento: aguarde o retorno da SEFAZ antes de cancelar.", "fiscal_processing");
  const st = await storeOf(ctx.store, order);
  const after = await cancelInternal(ctx.store, st, order, reason.trim(), { userCtx: ctx, actor: ctx.user.name });
  await audit(inBranch(ctx, order), { module: "sales", action: "ecommerce.order_cancel", entityType: "online_order", entityId: order.id, summary: `Pedido on-line ${order.code} cancelado`, reason, related: [`store:${order.storeId}`] });
  return after;
}

/** O próprio cliente desiste enquanto o pagamento não foi aprovado (página de acompanhamento). */
export async function cancelByCustomer(store: Store, order: Doc): Promise<Doc> {
  assert(order.status === "pending_payment", "Este pedido não pode mais ser cancelado por aqui: fale com a loja.");
  const st = await storeOf(store, order);
  return cancelInternal(store, st, order, "Desistência do cliente antes do pagamento", { actor: "Cliente" });
}

/**
 * Expira pedidos com pagamento vencido (Pix/boleto): cancela e libera a reserva. Com gateway real há uma folga de 30 min
 * para o aviso atrasado do provedor chegar. Roda na rotina diária e, de forma oportunista, no checkout e na gestão.
 */
export async function expirePendingOrders(store: Store, companyId?: string | null): Promise<number> {
  const filters: any[] = [["eq", "status", "pending_payment"]];
  if (companyId) filters.push(["eq", "companyId", companyId]);
  const rows = await listAll(unscoped(store), ORDER_COLLECTION, { filters }, 2000);
  let n = 0;
  for (const o of rows) {
    if (!o.expiresAt) continue;
    const grace = o.payment?.simulated === false ? 30 * 60000 : 0;
    if (Date.parse(o.expiresAt) + grace > Date.now()) continue;
    const r = await handlePaymentEvent(store, o, { externalKey: `expire:${o.id}`, type: "expired", providerRef: o.payment?.providerRef ?? "" }, "rotina").catch(() => null);
    if (r?.outcome === "applied") n++;
  }
  return n;
}

// ───────────────────────────── Expedição e retirada (Tela 59)

/** Tela 54: "a expedição exige pagamento e autorização fiscal". */
function requireReleased(order: Doc) {
  if (order.paymentStatus !== "paid") throw new BusinessError("A expedição exige pagamento aprovado.", "not_paid");
  if (order.fiscalStatus !== "authorized") throw new BusinessError("A expedição exige a NF-e autorizada: revise e emita o documento fiscal do pedido.", "fiscal_pending");
}

/** Separação e conferência concluída. Na retirada, o pedido fica pronto e o cliente é avisado. */
export async function confirmPicking(ctx: Ctx, orderId: string, input: { volumes: number; note?: string | null }): Promise<Doc> {
  requireAction(ctx, "ecommerce.orders");
  const order = await orderOfCompany(ctx, orderId);
  assert(order.status === "invoiced", order.status === "paid" ? "Emita a NF-e do pedido antes de separar." : `Pedido ${ORDER_STATUS_LABEL[order.status as OrderStatus]?.toLowerCase()}: separação não se aplica.`);
  requireReleased(order);
  const volumes = Math.max(1, Math.min(50, Math.round(input.volumes || 1)));
  const isPickup = order.delivery?.mode === "pickup";
  const delivery = { ...(order.delivery ?? {}), pickedAt: nowIso(), pickedBy: ctx.user.name, volumes, pickNote: input.note?.trim().slice(0, 300) || null };
  const after = await patchOrder(ctx.store, order, isPickup ? { delivery, status: "ready_for_pickup", readyAt: nowIso() } : { delivery });
  await orderEvent(inBranch(ctx, order), after, "fulfillment", isPickup ? `Separação conferida (${volumes} volume(s)): pedido pronto para retirada.` : `Separação e conferência concluídas (${volumes} volume(s)).`, null, ctx.user.name);
  if (isPickup) {
    const st = await storeOf(ctx.store, order);
    await notifyCustomer(ctx.store, st, after, `pedido ${order.code} pronto para retirada`, [`Seu pedido ${order.code} está pronto para retirada.`, `Apresente o código de retirada <strong>${order.pickupCode}</strong> e um documento com foto.`]);
  }
  await audit(inBranch(ctx, order), { module: "sales", action: "ecommerce.order_pick", entityType: "online_order", entityId: order.id, summary: `Pedido ${order.code}: separação e conferência`, related: [`store:${order.storeId}`] });
  return after;
}

/** Etiqueta / chamada do entregador pelo provedor logístico (demonstrativa na simulação). Entrega própria: romaneio. */
export async function generateLabel(ctx: Ctx, orderId: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.orders");
  const order = await orderOfCompany(ctx, orderId);
  assert(order.delivery?.mode !== "pickup", "Retirada na loja não tem etiqueta.");
  assert(order.delivery?.pickedAt, "Confirme a separação e a conferência antes de gerar a etiqueta.");
  if (order.delivery?.trackingCode) return order;
  let trackingCode: string;
  let labelNote: string;
  if (order.delivery?.mode === "own") {
    trackingCode = `ENT-${order.number}`;
    labelNote = "Romaneio da entrega própria (entregador da loja).";
  } else {
    const prov = await logisticsFor(ctx.store, ctx.companyId);
    const r = await prov.createShipment({ orderCode: order.code, mode: order.delivery.mode, service: order.delivery.service });
    trackingCode = r.trackingCode;
    labelNote = r.labelNote;
  }
  const after = await patchOrder(ctx.store, order, { delivery: { ...(order.delivery ?? {}), trackingCode, labelAt: nowIso(), labelNote } });
  await orderEvent(inBranch(ctx, order), after, "fulfillment", `Etiqueta gerada: ${trackingCode}. ${labelNote}`, null, ctx.user.name);
  await commerceEvent(ctx.store, { companyId: order.companyId, storeId: order.storeId, area: "shipping", action: "shipping.label", status: "ok", reference: order.code, orderId: order.id, externalKey: `label:${order.id}`, diagnostic: labelNote, subject: `order:${order.id}` });
  return after;
}

/** Saída do estoque do pedido: consome a reserva e lança a baixa de venda — uma única vez (despacho ou retirada). */
async function consumeStock(ctx: Ctx, order: Doc) {
  const sctx = { ...inBranch(ctx, order), store: unscoped(ctx.store) };
  const wh = await defaultWarehouse(sctx.store, order.branchId);
  const items = (order.items ?? []) as Array<{ skuId: string; qty: number; warehouseId?: string | null; title: string }>;
  await applyOnce(sctx, `online_order:${order.id}:out`, { entityType: "online_order", entityId: order.id }, async (tx) => {
    await releaseReservations(sctx, "online_order", order.id, "consumed", undefined, tx);
    await postMovements(
      sctx,
      items.map((i) => ({
        warehouseId: i.warehouseId || wh.id,
        skuId: i.skuId,
        qty: -i.qty,
        type: "sale" as const,
        originType: "online_order",
        originId: order.id,
        reason: `Pedido on-line ${order.code}`,
        idemKey: `online_order:${order.id}:${i.skuId}:out`,
        allowNegative: true,
        documentRef: order.code,
      })),
      tx,
    );
  });
  await commerceEvent(ctx.store, { companyId: order.companyId, storeId: order.storeId, area: "stock", action: "stock.out", status: "ok", reference: order.code, orderId: order.id, externalKey: `stock-out:${order.id}`, diagnostic: "Reserva consumida e baixa de venda lançada no estoque do ERP.", subject: `order:${order.id}` });
}

/** Despacho (entrega própria, terceiros ou transportadora): baixa o estoque e informa o rastreio ao cliente. */
export async function dispatchOrder(ctx: Ctx, orderId: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.orders");
  const order = await orderOfCompany(ctx, orderId);
  assert(order.delivery?.mode !== "pickup", "Pedido de retirada: confirme a retirada com o código do cliente.");
  assert(order.status === "invoiced", order.status === "shipped" ? "Pedido já despachado." : "O despacho exige pagamento e NF-e autorizada.");
  requireReleased(order);
  assert(order.delivery?.pickedAt, "Confirme a separação e a conferência antes do despacho.");
  await consumeStock(ctx, order);
  const after = await patchOrder(ctx.store, order, { status: "shipped", dispatchedAt: nowIso() });
  await orderEvent(inBranch(ctx, order), after, "fulfillment", `Pedido despachado${order.delivery?.trackingCode ? ` — rastreio ${order.delivery.trackingCode}` : ""}. Estoque baixado.`, null, ctx.user.name);
  const st = await storeOf(ctx.store, order);
  await notifyCustomer(ctx.store, st, after, `pedido ${order.code} a caminho`, [`Seu pedido ${order.code} saiu para entrega (${order.delivery?.label ?? ""}).`, order.delivery?.trackingCode ? `Código de rastreio: ${order.delivery.trackingCode}.` : ""]);
  await audit(inBranch(ctx, order), { module: "sales", action: "ecommerce.order_dispatch", entityType: "online_order", entityId: order.id, summary: `Pedido ${order.code} despachado`, related: [`store:${order.storeId}`] });
  return after;
}

/** Retirada no balcão: confere o código do cliente, baixa o estoque e conclui. */
export async function confirmPickup(ctx: Ctx, orderId: string, code: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.orders");
  const order = await orderOfCompany(ctx, orderId);
  assert(order.delivery?.mode === "pickup", "Este pedido não é de retirada.");
  assert(order.status === "ready_for_pickup", "O pedido ainda não está pronto para retirada (separação pendente).");
  requireReleased(order);
  const given = String(code ?? "").replace(/\D/g, "");
  const ok = given.length === String(order.pickupCode).length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(order.pickupCode)));
  if (!ok) throw new BusinessError("Código de retirada não confere. Peça ao cliente o código exibido no acompanhamento do pedido.", "pickup_code");
  await consumeStock(ctx, order);
  const at = nowIso();
  const after = await patchOrder(ctx.store, order, { status: "delivered", dispatchedAt: at, deliveredAt: at });
  await orderEvent(inBranch(ctx, order), after, "fulfillment", "Retirada confirmada no balcão com o código do cliente. Estoque baixado.", null, ctx.user.name);
  await audit(inBranch(ctx, order), { module: "sales", action: "ecommerce.order_pickup", entityType: "online_order", entityId: order.id, summary: `Pedido ${order.code} retirado pelo cliente`, related: [`store:${order.storeId}`] });
  return after;
}

/** Entrega concluída (confirmação do entregador/transportadora; na simulação, manual). */
export async function confirmDelivery(ctx: Ctx, orderId: string, note?: string | null): Promise<Doc> {
  requireAction(ctx, "ecommerce.orders");
  const order = await orderOfCompany(ctx, orderId);
  assert(order.status === "shipped", "Somente pedidos despachados podem ter a entrega confirmada.");
  const after = await patchOrder(ctx.store, order, { status: "delivered", deliveredAt: nowIso() });
  await orderEvent(inBranch(ctx, order), after, "fulfillment", `Entrega concluída${note?.trim() ? `: ${note.trim().slice(0, 200)}` : ""}.`, null, ctx.user.name);
  const st = await storeOf(ctx.store, order);
  await notifyCustomer(ctx.store, st, after, `pedido ${order.code} entregue`, [`Seu pedido ${order.code} foi entregue.`, `Se precisar desistir da compra, você tem ${WITHDRAWAL_DAYS} dias a partir do recebimento (Código de Defesa do Consumidor, art. 49).`]);
  return after;
}

// ───────────────────────────── Devolução e arrependimento

export function withdrawalDeadline(order: Doc): string | null {
  const ref = order.deliveredAt ?? null;
  return ref ? addDays(String(ref).slice(0, 10), WITHDRAWAL_DAYS) : null;
}

/** Cliente pede a devolução (arrependimento em até 7 dias do recebimento, ou defeito) pela página do pedido. */
export async function requestReturn(store: Store, order: Doc, input: { reason: "withdrawal" | "defect" | "other"; details: string }): Promise<Doc> {
  assert(["shipped", "delivered"].includes(order.status), "Devolução disponível depois do envio ou da retirada do pedido.");
  if (input.reason === "withdrawal") {
    const limit = withdrawalDeadline(order);
    assert(!limit || today() <= limit, `O prazo de arrependimento (${WITHDRAWAL_DAYS} dias do recebimento) terminou. Para defeito, escolha “Produto com defeito”.`);
  }
  assert(input.details.trim().length >= 5, "Conte brevemente o motivo da devolução.");
  const st = await storeOf(store, order);
  const after = await patchOrder(store, order, { status: "return_requested", returnRequest: { reason: input.reason, details: input.details.trim().slice(0, 1000), requestedAt: nowIso() } });
  await orderEvent(storeCtx(store, st, order.branchId), after, "return", `Devolução solicitada pelo cliente (${input.reason === "withdrawal" ? "arrependimento" : input.reason === "defect" ? "defeito" : "outro motivo"}).`, null, "Cliente");
  await notify(store, { companyId: order.companyId, branchId: order.branchId, type: "info", priority: "high", title: `Pedido ${order.code}: devolução solicitada`, body: input.details.trim().slice(0, 200), link: `/comercio-digital/pedidos/${order.id}`, originType: "online_order", originId: order.id, audience: { action: "ecommerce.orders" } }).catch(() => undefined);
  return after;
}

/**
 * Mercadoria devolvida recebida: entrada de devolução no estoque (uma vez), estorno pelo gateway e pedido devolvido.
 * A NF-e de entrada da devolução é emitida pelo Fiscal referenciando a chave da nota do pedido.
 */
export async function completeReturn(ctx: Ctx, orderId: string, note: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.cancel");
  const order = await orderOfCompany(ctx, orderId);
  assert(order.status === "return_requested", "Registre a devolução a partir de uma solicitação do cliente.");
  assert(note.trim().length >= 5, "Descreva a conferência da mercadoria devolvida.");
  const sctx = { ...inBranch(ctx, order), store: unscoped(ctx.store) };
  const wh = await defaultWarehouse(sctx.store, order.branchId);
  const items = (order.items ?? []) as Array<{ skuId: string; qty: number; warehouseId?: string | null }>;
  const outIds = items.map((i) => detId("mov", `online_order:${order.id}:${i.skuId}:out`));
  await postMovements(
    sctx,
    items.map((i, k) => ({ warehouseId: i.warehouseId || wh.id, skuId: i.skuId, qty: i.qty, type: "return" as const, originType: "online_order", originId: order.id, reason: `Devolução do pedido on-line ${order.code}`, idemKey: `online_order:${order.id}:${i.skuId}:return`, sourceMovementId: outIds[k], documentRef: order.code })),
  );
  let paymentStatus = order.paymentStatus;
  let refundStatus = order.refundStatus ?? null;
  if (order.paymentStatus === "paid") {
    try {
      const gw = await gatewayFor(ctx.store, ctx.companyId);
      const r = await gw.refund({ providerRef: order.payment?.providerRef ?? "", amount: order.total, reason: "Devolução" });
      paymentStatus = r.status;
      refundStatus = r.status === "refunded" ? "done" : "pending";
    } catch {
      paymentStatus = "refund_pending";
      refundStatus = "pending";
    }
  }
  const after = await patchOrder(ctx.store, order, { status: "returned", paymentStatus, refundStatus, returnRequest: { ...(order.returnRequest ?? {}), receivedAt: nowIso(), receivedBy: ctx.user.name, note: note.trim().slice(0, 500) } });
  await orderEvent(inBranch(ctx, order), after, "return", `Mercadoria devolvida conferida e de volta ao estoque. Estorno ${refundStatus === "done" ? "registrado" : "pendente"}. Emita a NF-e de entrada da devolução no Fiscal.`, null, ctx.user.name);
  await audit(inBranch(ctx, order), { module: "sales", action: "ecommerce.order_return", entityType: "online_order", entityId: order.id, summary: `Pedido ${order.code} devolvido`, reason: note, related: [`store:${order.storeId}`] });
  return after;
}

// ───────────────────────────── Acompanhamento (Telas 54 e 64)

export interface OrderStep {
  key: "order" | "payment" | "fiscal" | "fulfillment" | "delivery";
  label: string;
  state: "done" | "current" | "todo" | "blocked";
  detail: string;
}

/** Etapas do pedido: 1. Pedido, 2. Pagamento, 3. Fiscal, 4. Expedição, 5. Entrega (estados distintos e independentes). */
export function orderSteps(o: Doc): OrderStep[] {
  const cancelled = ORDER_CLOSED.includes(o.status);
  const paid = ["paid", "refund_pending", "refunded"].includes(o.paymentStatus);
  const fiscalOk = o.fiscalStatus === "authorized";
  const pickup = o.delivery?.mode === "pickup";
  const left = ["shipped", "delivered", "return_requested", "returned"].includes(o.status) || Boolean(o.dispatchedAt);
  const delivered = Boolean(o.deliveredAt);
  const steps: OrderStep[] = [
    { key: "order", label: "Pedido", state: "done", detail: `Registrado em ${String(o.createdAt ?? "").slice(0, 10).split("-").reverse().join("/")}` },
    { key: "payment", label: "Pagamento", state: paid ? "done" : cancelled ? "blocked" : "current", detail: paid ? `Aprovado (${PAY_METHOD_LABEL[o.payment?.method as PayMethod] ?? ""})` : cancelled ? "Não concluído" : "Aguardando confirmação" },
    { key: "fiscal", label: "Fiscal", state: fiscalOk ? "done" : !paid || cancelled ? "todo" : "current", detail: fiscalOk ? "NF-e autorizada" : o.fiscalStatus && o.fiscalStatus !== "none" ? `NF-e: ${o.fiscalStatus}` : "Aguardando emissão da nota" },
    { key: "fulfillment", label: pickup ? "Preparo" : "Expedição", state: left || o.status === "ready_for_pickup" ? "done" : fiscalOk && !cancelled ? "current" : "todo", detail: o.status === "ready_for_pickup" ? "Pronto para retirada" : left ? (pickup ? "Retirado" : "Despachado") : o.delivery?.pickedAt ? "Separado e conferido" : "Aguardando separação" },
    { key: "delivery", label: pickup ? "Retirada" : "Entrega", state: delivered ? "done" : left || o.status === "ready_for_pickup" ? "current" : "todo", detail: delivered ? (pickup ? "Retirado pelo cliente" : "Entregue") : o.delivery?.trackingCode ? `Rastreio ${o.delivery.trackingCode}` : (o.delivery?.detail ?? "") },
  ];
  return steps;
}

/** Linha do tempo do pedido (mais recente primeiro). */
export async function orderTimeline(store: Store, orderId: string) {
  const rows = await listAll(unscoped(store), "online_order_events", { filters: [["eq", "orderId", orderId]] });
  return rows.sort((a, b) => String(b.at ?? b.createdAt).localeCompare(String(a.at ?? a.createdAt)));
}

/** Situação operacional resumida para listas (Tela 54, coluna "Operação"). */
export function operationLabel(o: Doc): string {
  switch (o.status as OrderStatus) {
    case "pending_payment":
      return "Aguardando pagamento";
    case "paid":
      return o.fiscalDocumentId ? "Nota em emissão" : "A faturar";
    case "invoiced":
      return o.delivery?.pickedAt ? (o.delivery?.mode === "pickup" ? "Pronto para retirada" : "Em expedição") : "A preparar";
    case "ready_for_pickup":
      return "Pronto para retirada";
    case "shipped":
      return "Em transporte";
    case "delivered":
      return o.delivery?.mode === "pickup" ? "Retirado" : "Entregue";
    case "cancelled":
      return o.refundStatus === "pending" ? "Cancelado — estorno pendente" : "Cancelado";
    case "return_requested":
      return "Devolução solicitada";
    case "returned":
      return "Devolvido";
  }
  return o.status;
}

