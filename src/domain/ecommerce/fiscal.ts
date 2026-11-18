import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { nowIso } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import type { NfeInput, NfeRecipient, OriginPrefill } from "../fiscal/nfe";
import { commerceEvent, orderEvent } from "./common";
import { ORDER_COLLECTION } from "./orders";

/**
 * NF-e do pedido on-line (Tela 54 "Revisar documento fiscal"; fluxo fiscal das Telas 30–35).
 *
 *  - Modelo 55 com indicador de presença 2 (operação não presencial, pela internet), destinatário identificado pelo
 *    CPF/CNPJ e endereço informados no checkout, desconto do cupom rateado nos itens e frete no total da nota.
 *  - Efeitos travados: o estoque sai pela reserva do pedido (na expedição/retirada) e o recebível nasce no pagamento —
 *    a nota não baixa estoque nem gera título (sem duplicidade).
 *  - A autorização (situação vinda do provedor fiscal) libera a expedição; o cancelamento da nota devolve o pedido a
 *    "pago — a faturar".
 */

const PAY_KIND: Record<string, string> = { pix: "pix", card: "credit", boleto: "boleto" };
const TRANSPORT_MODE: Record<string, string> = { pickup: "9", own: "0", third_party: "0", carrier: "0" };

function recipientOf(order: Doc): NfeRecipient {
  const a = order.shippingAddress ?? {};
  const doc = onlyDigits(order.customer?.doc ?? "");
  return {
    partyType: order.customerId ? "customer" : "other",
    partyId: order.customerId ?? null,
    name: String(order.customer?.name ?? ""),
    doc,
    ie: null,
    ieIndicator: "9",
    email: order.customer?.email ?? null,
    finalConsumer: true,
    address: { zip: a.zip, street: a.street, number: a.number, complement: a.complement ?? undefined, district: a.district, cityName: a.cityName, cityCode: a.cityCode ?? undefined, uf: a.uf },
  };
}

/** Pré-preenchimento da NF-e a partir do pedido (chamado por loadOrigin com a origem "online_order"). */
export async function onlineOrderNfePrefill(ctx: Ctx, orderId: string, branchId: string, existingDocId: string | null, base: NfeInput): Promise<Omit<OriginPrefill, "generation" | "existingDocId"> & { existingDocId: string | null }> {
  const order = await unscoped(ctx.store).getOrThrow(ORDER_COLLECTION, orderId);
  assert(order.companyId === ctx.companyId, "Pedido de outra empresa.");
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (order.paymentStatus !== "paid") blockers.push(`O pedido ${order.code} ainda não tem pagamento aprovado: a nota é emitida depois da confirmação do pagamento.`);
  if (["cancelled", "returned"].includes(order.status)) blockers.push(`O pedido ${order.code} está ${order.status === "cancelled" ? "cancelado" : "devolvido"}.`);
  if (order.branchId !== branchId) {
    const b = order.branchId ? await ctx.store.get("branches", order.branchId) : null;
    blockers.push(`O pedido ${order.code} é atendido pela filial ${b?.name ?? "de expedição"}: a NF-e deve ser emitida por ela — selecione-a no topo da tela.`);
  }
  if (!onlyDigits(order.customer?.doc ?? "")) warnings.push("Pedido sem CPF/CNPJ do comprador: informe o documento do destinatário.");
  if (!order.shippingAddress?.cityCode) warnings.push("Código IBGE do município do destinatário ausente: confira o endereço (o checkout não localizou o município pelo CEP).");
  const items = (order.items ?? []) as Array<{ skuId: string; qty: number; unitPrice: number; discount: number; title: string; variant?: string }>;
  const mode = String(order.delivery?.mode ?? "carrier");
  const input: NfeInput = {
    ...base,
    branchId,
    origin: { type: "online_order", id: orderId },
    nature: "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: "2",
    recipient: recipientOf(order),
    items: items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount ?? 0, description: i.variant ? `${i.title} — ${i.variant}` : i.title })),
    freight: order.shippingAmount ?? 0,
    insurance: 0,
    other: 0,
    transport: { mode: TRANSPORT_MODE[mode] ?? "9", volumes: order.delivery?.volumes ?? undefined },
    payments: [{ kind: PAY_KIND[order.payment?.method] ?? "other", amount: order.total }],
    referencedKeys: [],
    additionalInfo: `Pedido on-line ${order.code}. Venda não presencial pela internet.`,
    effects: { stock: false, financial: false },
  };
  return { input, effectsLocked: true, label: `Pedido on-line ${order.code}`, href: `/comercio-digital/pedidos/${orderId}`, warnings, blockers, existingDocId };
}

/** Emite (salva e transmite) a NF-e do pedido. Contexto na filial do pedido, com a permissão fiscal do usuário ou da rotina. */
export async function invoiceOrder(ctx: Ctx, orderId: string): Promise<Doc> {
  const order = await unscoped(ctx.store).getOrThrow(ORDER_COLLECTION, orderId);
  assert(order.companyId === ctx.companyId, "Pedido de outra empresa.");
  if (order.fiscalStatus === "authorized") return order;
  const { loadOrigin, saveNfe } = await import("../fiscal/nfe");
  const fctx = { ...ctx, branchId: order.branchId };
  const pre = await loadOrigin(fctx, "online_order", orderId, order.branchId);
  if (pre.blockers.length) throw new BusinessError(pre.blockers.join(" "), "fiscal_blocked");
  const doc = await saveNfe(fctx, pre.input, { idemKey: `online_order:${orderId}`, draftId: pre.existingDocId ?? null, transmit: true });
  await syncOrderFromNfe(fctx, doc);
  return (await unscoped(ctx.store).get(ORDER_COLLECTION, orderId))!;
}

/** Gancho do serviço fiscal: a situação da NF-e (autorizada, rejeitada, cancelada) reflete no pedido. */
export async function syncOrderFromNfe(ctx: Ctx, doc: Doc) {
  if (doc.originType !== "online_order" || !doc.originId || doc.model !== "nfe") return;
  const base = unscoped(ctx.store);
  const order = await base.get(ORDER_COLLECTION, doc.originId);
  if (!order || order.companyId !== doc.companyId) return;
  // documento antigo (cancelado/descartado) não sobrepõe um mais novo do mesmo pedido
  if (order.fiscalDocumentId && order.fiscalDocumentId !== doc.id) {
    const cur = await base.get("fiscal_documents", order.fiscalDocumentId);
    if (cur && cur.status === "authorized" && doc.status !== "authorized") return;
  }
  const patch: Record<string, unknown> = { fiscalStatus: doc.status, fiscalDocumentId: doc.id };
  let summary: string | null = null;
  if (doc.status === "authorized" && order.status === "paid") {
    Object.assign(patch, { status: "invoiced", invoicedAt: nowIso() });
    summary = `NF-e nº ${doc.number ?? "—"} autorizada: pedido liberado para a expedição.`;
  } else if (doc.status === "cancelled" && order.status === "invoiced") {
    Object.assign(patch, { status: "paid", invoicedAt: null });
    summary = `NF-e nº ${doc.number ?? "—"} cancelada: o pedido volta a "pago — a faturar".`;
  } else if (["rejected", "denied", "error"].includes(doc.status)) summary = `NF-e com problema (${doc.status}): revise o documento fiscal do pedido.`;
  if (order.fiscalStatus === doc.status && order.fiscalDocumentId === doc.id && !patch.status) return;
  const after = await base.update(ORDER_COLLECTION, order.id, patch);
  if (summary) await orderEvent(ctx, after, "fiscal", summary);
  await commerceEvent(ctx.store, {
    companyId: order.companyId,
    storeId: order.storeId,
    area: "fiscal",
    action: `fiscal.${doc.status}`,
    status: doc.status === "authorized" || doc.status === "cancelled" ? "ok" : ["rejected", "denied", "error"].includes(doc.status) ? "failed" : "pending",
    reference: order.code,
    orderId: order.id,
    externalKey: `fiscal:${doc.id}:${doc.status}`,
    diagnostic: summary ?? `NF-e ${doc.status}.`,
    subject: `order:${order.id}`,
  });
}

/** Documento fiscal ativo do pedido (para exibir número, chave e situação). */
export async function orderFiscalDocs(ctx: Ctx, orderId: string) {
  return (await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "online_order"], ["eq", "originId", orderId]] })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
