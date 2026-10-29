import { randomBytes } from "crypto";
import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { addDays, nowIso, today } from "@/lib/dates";
import { formatMoney, formatQty, roundDiv, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, systemCtx, type Ctx, type CtxUser } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { searchable } from "@/lib/core/text";
import type { SpecialAction } from "@/lib/permissions";
import { priceSale } from "./sale-pricing";
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";
import { defaultWarehouse, ensureBalance, releaseReservations, reserve } from "./stock";
import type { CartItem } from "./cart-calc";

/**
 * Documento comercial de venda (VEN-01 orçamento, VEN-02 pedido) — Fase 5.
 *
 * Um único documento (`sales_documents` + `sales_document_items`) com `type = "quote" | "order"`:
 *  - Orçamento: rascunho → enviado → aprovado | recusado | expirado → convertido (em pedido ou em venda no PDV).
 *  - Pedido: aberto → parcialmente faturado → faturado | cancelado. Reserva o estoque ao ser confirmado
 *    (`stock.reserve`, origem "sales_document"); a reserva é consumida no faturamento e liberada no cancelamento e na
 *    expiração (rotina diária, parâmetro `sales.orderReservationDays`).
 *
 * Preço e totais: MESMA regra da venda (`priceSale` → `resolvePrices` + `calcSale` + limites de desconto do usuário e
 * aprovação de supervisor). Sem cálculo paralelo.
 *
 * Regra de efeitos (sem efeito duplo): o documento NUNCA movimenta estoque nem financeiro. Quem fatura é:
 *  (a) a venda do PDV (`finalizeSale` com `salesDocumentId`) — estoque, caixa e títulos pela própria venda; ou
 *  (b) a NF-e com origem `sales_document` — estoque e título a receber na autorização (`applyDocumentEffects`).
 * Cada venda/NF-e grava, uma única vez (marcador determinístico em `operations` na mesma transação dos incrementos),
 * as quantidades faturadas por item (`invoicedQty`, limitadas à quantidade do item). Cancelamento da venda/NF-e
 * devolve exatamente essas quantidades ao saldo a faturar (marcador próprio).
 */

export const SALES_DOC_FLAG = "documentoComercial";
export type SalesDocType = "quote" | "order";
/** linhas por documento (cabeçalho + itens numa transação do Appwrite, limite de 100 operações) */
export const MAX_DOC_LINES = 90;

export const QUOTE_STATUS_LABEL: Record<string, string> = { draft: "Rascunho", sent: "Enviado", approved: "Aprovado", rejected: "Recusado", expired: "Expirado", converted: "Convertido" };
export const ORDER_STATUS_LABEL: Record<string, string> = { open: "Aberto", partial: "Parcialmente faturado", invoiced: "Faturado", cancelled: "Cancelado" };
export const RESERVATION_LABEL: Record<string, string> = { active: "Reservado", expired: "Reserva expirada", released: "Reserva liberada", none: "Sem reserva" };
export const docTypeLabel = (t: string) => (t === "quote" ? "Orçamento" : "Pedido de venda");
export const docLabel = (d: Record<string, any>) => `${d.type === "quote" ? "Orçamento" : "Pedido"} nº ${d.number ?? "—"}`;
export const docPath = (d: Record<string, any>) => `/vendas/${d.type === "quote" ? "orcamentos" : "pedidos"}/${d.id}`;

/** orçamento ainda utilizável (importar no PDV, converter, enviar) */
const QUOTE_OPEN = ["draft", "sent", "approved"];
/** pedido com saldo a faturar */
const ORDER_OPEN = ["open", "partial"];
/** NF-e encerradas (não contam como faturamento nem como em andamento) */
const NFE_INACTIVE = ["cancelled", "denied", "unused", "discarded"];

export interface SalesDocItemInput {
  skuId: string;
  qty: number;
  /** preço digitado (abaixo da tabela vira desconto do item; acima substitui o preço) */
  unitPrice?: number | null;
  itemDiscount?: number;
  itemSurcharge?: number;
  description?: string | null;
}

export interface SalesDocInput {
  customerId?: string | null;
  /** orçamento sem cliente cadastrado: nome e telefone do contato */
  contactName?: string | null;
  contactPhone?: string | null;
  sellerId?: string | null;
  priceTableId?: string | null;
  items: SalesDocItemInput[];
  globalDiscount?: number;
  globalDiscountBps?: number;
  surcharge?: number;
  validUntil?: string | null;
  deliveryDate?: string | null;
  paymentTermId?: string | null;
  paymentNotes?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  /** autorização de supervisor (login/senha) para desconto acima do limite */
  discountApproval?: SupervisorCredentials | null;
}

// ───────────────────────────── utilidades

export async function salesDocsEnabled(ctx: Pick<Ctx, "store" | "companyId" | "branchId">) {
  return isFeatureOn(ctx.store, ctx.companyId, ctx.branchId, SALES_DOC_FLAG, true);
}

async function assertFeature(ctx: Ctx) {
  if (!(await salesDocsEnabled(ctx))) throw new BusinessError("Orçamentos e pedidos de venda estão desligados em Administração › Parâmetros › Recursos.", "feature_off");
}

function assertScope(ctx: Ctx, doc: Doc) {
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  const branchId = requireBranch(ctx);
  assert(doc.branchId === branchId, "Documento de outra filial: selecione a filial do documento no topo da tela.", "branch_mismatch");
}

/**
 * Parte proporcional de um valor do item (desconto, acréscimo) para `q` unidades a partir de `from` já atribuídas:
 * cumulativa (meio para longe de zero), de modo que a soma de todos os faturamentos feche o valor do item ao centavo.
 */
export function shareOf(total: number, qty: number, from: number, q: number) {
  if (!total || !qty) return 0;
  const a = Math.min(qty, Math.max(0, from));
  const b = Math.min(qty, a + Math.max(0, q));
  return roundDiv(total * b, qty) - roundDiv(total * a, qty);
}

const pendingOf = (it: Doc) => Math.max(0, (it.qty ?? 0) - (it.invoicedQty ?? 0));

export async function documentItems(store: Store, documentId: string) {
  return listAll(store, "sales_document_items", { filters: [["eq", "documentId", documentId]], orderBy: [{ field: "seq" }] });
}

async function loadDoc(ctx: Ctx, id: string) {
  const doc = await ctx.store.getOrThrow("sales_documents", id);
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  return doc;
}

async function validSeller(ctx: Ctx, sellerId: string | null | undefined) {
  if (!sellerId) return null;
  const u = await ctx.store.get("users", sellerId);
  assert(u && (u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId)), "Vendedor inválido.");
  return u!.id as string;
}

function customerSnapshot(c: Doc | null, input: Pick<SalesDocInput, "contactName" | "contactPhone">) {
  if (c) return { id: c.id, name: c.name, doc: c.doc ?? null, personType: c.personType ?? null, phone: c.mobile ?? c.phone ?? null, email: c.email ?? null, address: (c.addresses ?? [])[0] ?? null, ie: c.ie ?? null };
  const name = input.contactName?.trim();
  const phone = input.contactPhone?.replace(/\D/g, "") || null;
  return name || phone ? { id: null, name: name || "Cliente não cadastrado", doc: null, personType: null, phone, email: null, address: null, ie: null } : null;
}

/** Quantidades em NF-e EM ANDAMENTO (rascunho/pendente/rejeitada/na fila/processando/erro) do pedido, por item (seq). */
async function nfeInProgressBySeq(ctx: Ctx, documentId: string, excludeFiscalId?: string | null) {
  const docs = (await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", documentId], ["eq", "model", "nfe"]] })).filter(
    (d) => d.companyId === ctx.companyId && d.id !== excludeFiscalId && !NFE_INACTIVE.includes(d.status) && d.status !== "authorized",
  );
  const out = new Map<number, number>();
  for (const d of docs) for (const i of d.items ?? []) if (i.nItemPed) out.set(i.nItemPed, (out.get(i.nItemPed) ?? 0) + (i.qty ?? 0));
  return { map: out, docs };
}

/** Reservas ativas do documento numa filial, por SKU (o pedido importado no PDV pode consumir a própria reserva). */
export async function reservedForDocument(store: Store, documentId: string, branchId: string) {
  const rs = await listAll(store, "stock_reservations", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", documentId], ["eq", "status", "active"]] });
  const out = new Map<string, number>();
  for (const r of rs) if (r.branchId === branchId) out.set(r.skuId, (out.get(r.skuId) ?? 0) + (r.qty ?? 0));
  return out;
}

// ───────────────────────────── preço e totais (regra da venda)

async function priceDocument(ctx: Ctx, branchId: string, input: SalesDocInput, approver: CtxUser | null) {
  assert(input.items.length > 0, "Adicione ao menos um item.");
  assert(input.items.length <= MAX_DOC_LINES, `Documento com mais de ${MAX_DOC_LINES} linhas: divida em dois documentos.`);
  const branch = await ctx.store.getOrThrow("branches", branchId);
  const priceTableId = input.priceTableId ?? branch.defaultPriceTableId ?? null;
  const items = input.items.map((i) => ({
    skuId: i.skuId,
    qty: Math.round(i.qty),
    itemDiscount: Math.max(0, Math.round(i.itemDiscount ?? 0)),
    itemSurcharge: Math.max(0, Math.round(i.itemSurcharge ?? 0)),
    unitPrice: i.unitPrice == null ? undefined : Math.max(0, Math.round(i.unitPrice)),
  }));
  const globalDiscountBps = input.globalDiscountBps ? Math.min(10000, Math.max(0, Math.round(input.globalDiscountBps))) : 0;
  const globalDiscount = globalDiscountBps ? undefined : Math.max(0, Math.round(input.globalDiscount ?? 0));
  const surcharge = Math.max(0, Math.round(input.surcharge ?? 0));
  const priced = await priceSale(ctx, { branchId, priceTableId, items, globalDiscount, globalDiscountBps: globalDiscountBps || undefined, surcharge }, { approver });
  const rows = priced.lines.map((l, idx) => {
    const it = priced.calc.items[idx];
    return {
      seq: idx + 1,
      skuId: l.sku.id,
      productId: l.product.id,
      sku: l.sku.sku,
      description: (input.items[idx].description?.trim() || l.sku.name || l.product.name || l.sku.sku).slice(0, 250),
      unitCode: l.sku.unitCode ?? l.product.unitCode ?? "UN",
      qty: l.input.qty,
      listPrice: l.listPrice,
      unitPrice: l.unitPrice,
      grossTotal: it.grossTotal,
      itemDiscount: it.itemDiscount,
      itemSurcharge: l.input.itemSurcharge ?? 0,
      globalDiscount: it.globalDiscount,
      surcharge: it.surcharge,
      total: it.total,
      invoicedQty: 0,
      service: l.product.type === "service",
      maxDiscountBps: l.maxDiscountBps ?? null,
      wholesale: Boolean(l.wholesale),
    };
  });
  const c = priced.calc;
  const header = {
    priceTableId,
    itemsCount: rows.length,
    qtyTotal: rows.reduce((a, r) => a + r.qty, 0),
    subtotal: c.subtotal,
    itemDiscounts: c.itemDiscounts,
    globalDiscount: c.globalDiscount,
    globalDiscountBps,
    discountTotal: c.discountTotal,
    surcharge,
    surchargeTotal: c.surchargeTotal,
    total: c.total,
  };
  return { header, rows, calc: c };
}

const itemId = (documentId: string, seq: number) => detId("sdocitem", documentId, seq);

// ───────────────────────────── criação e edição

async function headerFields(ctx: Ctx, type: SalesDocType, branchId: string, input: SalesDocInput) {
  const customer = input.customerId ? await ctx.store.getOrThrow("customers", input.customerId) : null;
  if (customer) {
    assert(customer.companyId === ctx.companyId, "Cliente de outra empresa.");
    assert(customer.status !== "inactive", "Cliente inativo.");
  }
  if (type === "order") assert(customer, "Pedido de venda exige cliente cadastrado.", "customer_required");
  const sellerId = (await validSeller(ctx, input.sellerId)) ?? customer?.sellerId ?? (ctx.user.id !== "system" ? ctx.user.id : null);
  if (input.paymentTermId) {
    const t = await ctx.store.getOrThrow("payment_terms", input.paymentTermId);
    assert(t.companyId === ctx.companyId, "Condição de pagamento inválida.");
  }
  const snapshot = customerSnapshot(customer, input);
  const validDays = await getSetting<number>(ctx.store, ctx.companyId, branchId, "sales.quoteValidityDays", 10);
  const validUntil = input.validUntil || (type === "quote" ? addDays(today(), Math.max(1, Number(validDays) || 10)) : null);
  if (type === "quote" && validUntil) assert(validUntil >= today(), "A validade do orçamento não pode ser anterior a hoje.");
  return {
    customerId: customer?.id ?? null,
    customerSnapshot: snapshot,
    sellerId,
    validUntil,
    deliveryDate: input.deliveryDate || null,
    paymentTermId: input.paymentTermId || null,
    paymentNotes: input.paymentNotes?.trim().slice(0, 300) || null,
    notes: input.notes?.trim().slice(0, 4000) || null,
    internalNotes: input.internalNotes?.trim().slice(0, 4000) || null,
  };
}

const actionFor = (type: SalesDocType): SpecialAction => (type === "quote" ? "sales_doc.quote" : "sales_doc.order");

/** Cria orçamento ou pedido. Idempotente pela chave do formulário (repetir devolve o mesmo documento). */
export async function createSalesDocument(ctx: Ctx, type: SalesDocType, input: SalesDocInput, opts: { idemKey: string; sourceQuoteId?: string | null; duplicatedFrom?: string | null }) {
  await assertFeature(ctx);
  requirePerm(ctx, "sales", "view");
  requireAction(ctx, actionFor(type));
  const branchId = requireBranch(ctx);
  assert(opts.idemKey, "Chave de idempotência ausente.");
  const id = detId("sdoc", ctx.companyId, opts.idemKey);
  const already = await ctx.store.get("sales_documents", id);
  if (already) return already;
  const approver = input.discountApproval?.login ? await verifySupervisor(ctx, input.discountApproval, "sale.discount_over_limit", "desconto acima do limite (orçamento/pedido)") : null;
  const priced = await priceDocument(ctx, branchId, input, approver);
  const head = await headerFields(ctx, type, branchId, input);
  return persistNew(ctx, type, id, branchId, head, priced.header, priced.rows, { ...opts, approverId: approver?.id ?? null });
}

async function persistNew(
  ctx: Ctx,
  type: SalesDocType,
  id: string,
  branchId: string,
  head: Record<string, any>,
  totals: Record<string, any>,
  rows: Array<Record<string, any>>,
  opts: { idemKey: string; sourceQuoteId?: string | null; duplicatedFrom?: string | null; approverId?: string | null },
) {
  const number = await nextNumber(ctx.store, `sales_document:${type}:${ctx.companyId}`);
  const warehouse = type === "order" ? await defaultWarehouse(ctx.store, branchId) : null;
  const reserveDays = type === "order" ? Math.max(0, Number(await getSetting<number>(ctx.store, ctx.companyId, branchId, "sales.orderReservationDays", 15)) || 0) : 0;
  const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };
  let created = false;
  try {
    await ctx.store.transaction(async (t) => {
      await t.create(
        "sales_documents",
        {
          ...base,
          scopeKey: `${ctx.companyId}:${type}:${number}`,
          type,
          number,
          status: type === "quote" ? "draft" : "open",
          ...head,
          ...totals,
          invoicedQtyTotal: 0,
          discountApprovedBy: opts.approverId ?? null,
          idemKey: `${ctx.companyId}:${opts.idemKey}`,
          searchText: searchable(String(number), head.customerSnapshot?.name, head.customerSnapshot?.doc, head.customerSnapshot?.phone).slice(0, 1000),
          revision: 1,
          shareToken: randomBytes(16).toString("hex"),
          sourceQuoteId: opts.sourceQuoteId ?? null,
          duplicatedFrom: opts.duplicatedFrom ?? null,
          warehouseId: warehouse?.id ?? null,
          reservationStatus: type === "order" ? (reserveDays > 0 ? "active" : "none") : null,
          reserveUntil: type === "order" && reserveDays > 0 ? addDays(today(), reserveDays) : null,
        },
        id,
      );
      for (const r of rows) await t.create("sales_document_items", { ...base, documentId: id, ...r }, itemId(id, r.seq));
    });
    created = true;
  } catch (e) {
    // repetição concorrente da mesma chave (ou da mesma conversão): devolve o documento já gravado
    if (!isConflict(e)) throw e;
    const ex = await ctx.store.get("sales_documents", id);
    if (!ex) throw e;
    return ex;
  }
  const doc = await ctx.store.getOrThrow("sales_documents", id);
  if (created) {
    if (type === "order") await syncReservations(ctx, id, "renew");
    await audit(ctx, {
      module: "sales", action: `sales_document.create`, entityType: "sales_document", entityId: id,
      summary: `${docLabel(doc)} criado — ${formatMoney(doc.total)} (${rows.length} itens)${doc.customerSnapshot?.name ? ` para ${doc.customerSnapshot.name}` : ""}${opts.sourceQuoteId ? " a partir de orçamento" : ""}`,
      related: [doc.customerId ? `customer:${doc.customerId}` : "", opts.sourceQuoteId ? `sales_document:${opts.sourceQuoteId}` : ""].filter(Boolean),
    });
  }
  return ctx.store.getOrThrow("sales_documents", id);
}

/** Altera orçamento (volta a rascunho) ou pedido aberto sem faturamento (refaz a reserva). */
export async function updateSalesDocument(ctx: Ctx, id: string, input: SalesDocInput, reason?: string | null) {
  await assertFeature(ctx);
  requirePerm(ctx, "sales", "view");
  const doc = await loadDoc(ctx, id);
  requireAction(ctx, actionFor(doc.type));
  assertScope(ctx, doc);
  if (doc.type === "quote") assert(doc.status !== "converted", "Orçamento convertido não pode ser alterado: duplique-o para um novo orçamento.", "locked");
  else {
    assert(doc.status === "open", `Pedido ${ORDER_STATUS_LABEL[doc.status]?.toLowerCase() ?? doc.status} não pode ser alterado.`, "locked");
    assert((doc.invoicedQtyTotal ?? 0) === 0, "Pedido com faturamento não pode ser alterado.", "locked");
    const prog = await nfeInProgressBySeq(ctx, id);
    assert(!prog.docs.length, "Há NF-e em andamento para este pedido: descarte-a antes de alterar o pedido.", "locked");
  }
  const approver = input.discountApproval?.login ? await verifySupervisor(ctx, input.discountApproval, "sale.discount_over_limit", "desconto acima do limite (orçamento/pedido)") : null;
  const priced = await priceDocument(ctx, doc.branchId, input, approver);
  const head = await headerFields(ctx, doc.type, doc.branchId, input);
  const old = await documentItems(ctx.store, id);
  const base = { companyId: ctx.companyId, branchId: doc.branchId, createdBy: ctx.user.id };
  await ctx.store.transaction(async (t) => {
    await t.update("sales_documents", id, {
      ...head,
      ...priced.header,
      status: doc.type === "quote" ? "draft" : doc.status,
      revision: (doc.revision ?? 1) + 1,
      discountApprovedBy: approver?.id ?? null,
      searchText: searchable(String(doc.number), head.customerSnapshot?.name, head.customerSnapshot?.doc, head.customerSnapshot?.phone).slice(0, 1000),
      ...(doc.type === "quote" ? { sentAt: null, sentVia: null, approvedAt: null, rejectedAt: null, rejectReason: null, expiredAt: null } : {}),
    });
    const have = new Set(old.map((o) => o.id));
    for (const r of priced.rows) {
      const rid = itemId(id, r.seq);
      if (have.has(rid)) await t.update("sales_document_items", rid, { ...r });
      else await t.create("sales_document_items", { ...base, documentId: id, ...r }, rid);
    }
    for (const o of old) if (o.seq > priced.rows.length) await t.delete("sales_document_items", o.id);
  });
  if (doc.type === "order") await syncReservations(ctx, id, "renew");
  await audit(ctx, {
    module: "sales", action: "sales_document.update", entityType: "sales_document", entityId: id,
    summary: `${docLabel(doc)} alterado (revisão ${(doc.revision ?? 1) + 1}) — ${formatMoney(doc.total)} → ${formatMoney(priced.header.total)}`,
    before: { total: doc.total, items: doc.itemsCount, status: doc.status }, after: { total: priced.header.total, items: priced.rows.length }, reason: reason ?? null,
  });
  return ctx.store.getOrThrow("sales_documents", id);
}

/** Copia itens e condições de um documento para a entrada de outro (preço do documento mantido como preço digitado). */
function inputFrom(doc: Doc, items: Doc[]): SalesDocInput {
  return {
    customerId: doc.customerId ?? null,
    contactName: doc.customerId ? null : (doc.customerSnapshot?.name ?? null),
    contactPhone: doc.customerId ? null : (doc.customerSnapshot?.phone ?? null),
    sellerId: doc.sellerId ?? null,
    priceTableId: doc.priceTableId ?? null,
    items: items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice, itemDiscount: i.itemDiscount, itemSurcharge: i.itemSurcharge ?? 0, description: i.description })),
    globalDiscount: doc.globalDiscountBps ? undefined : doc.globalDiscount,
    globalDiscountBps: doc.globalDiscountBps || undefined,
    surcharge: doc.surcharge ?? 0,
    deliveryDate: doc.deliveryDate ?? null,
    paymentTermId: doc.paymentTermId ?? null,
    paymentNotes: doc.paymentNotes ?? null,
    notes: doc.notes ?? null,
    internalNotes: doc.internalNotes ?? null,
  };
}

/** Duplica um orçamento/pedido como novo ORÇAMENTO em rascunho (preços revalidados pela regra da venda). */
export async function duplicateSalesDocument(ctx: Ctx, id: string, idemKey: string) {
  const doc = await loadDoc(ctx, id);
  const items = await documentItems(ctx.store, id);
  const input = inputFrom(doc, items);
  return createSalesDocument(ctx, "quote", { ...input, validUntil: null }, { idemKey: `dup:${idemKey}`, duplicatedFrom: id });
}

// ───────────────────────────── ciclo do orçamento

async function setQuoteStatus(ctx: Ctx, id: string, allowed: string[], patch: Record<string, any>, action: string, summary: (d: Doc) => string, reason?: string | null) {
  await assertFeature(ctx);
  requireAction(ctx, "sales_doc.quote");
  const doc = await loadDoc(ctx, id);
  assertScope(ctx, doc);
  assert(doc.type === "quote", "Somente orçamentos.");
  if (patch.status && doc.status === patch.status) return doc;
  assert(allowed.includes(doc.status), `Orçamento ${QUOTE_STATUS_LABEL[doc.status]?.toLowerCase() ?? doc.status}: operação não permitida.`, "invalid_status");
  const updated = await ctx.store.update("sales_documents", id, patch);
  await audit(ctx, { module: "sales", action, entityType: "sales_document", entityId: id, summary: summary(doc), reason: reason ?? null });
  return updated;
}

/** Registra o envio ao cliente (WhatsApp, e-mail ou manual). Rascunho passa a "enviado"; os demais só registram a data. */
export async function markQuoteSent(ctx: Ctx, id: string, via: "whatsapp" | "email" | "manual" | "print") {
  await assertFeature(ctx);
  const doc = await loadDoc(ctx, id);
  assertScope(ctx, doc);
  requireAction(ctx, actionFor(doc.type));
  assert(doc.type === "order" || !["converted", "rejected", "expired"].includes(doc.status), `Orçamento ${QUOTE_STATUS_LABEL[doc.status]?.toLowerCase()} não pode ser enviado.`, "invalid_status");
  const patch: Record<string, any> = { sentAt: nowIso(), sentVia: via };
  if (doc.type === "quote" && doc.status === "draft") patch.status = "sent";
  const updated = await ctx.store.update("sales_documents", id, patch);
  await audit(ctx, { module: "sales", action: "sales_document.send", entityType: "sales_document", entityId: id, summary: `${docLabel(doc)} enviado ao cliente (${via === "whatsapp" ? "WhatsApp" : via === "email" ? "e-mail" : via === "print" ? "impresso" : "manual"})` });
  return updated;
}

export async function approveQuote(ctx: Ctx, id: string) {
  return setQuoteStatus(ctx, id, ["draft", "sent"], { status: "approved", approvedAt: nowIso() }, "sales_document.approve", (d) => `${docLabel(d)} aprovado pelo cliente`);
}

export async function rejectQuote(ctx: Ctx, id: string, reason: string) {
  assert(reason?.trim(), "Informe o motivo da recusa.");
  return setQuoteStatus(ctx, id, ["draft", "sent", "approved"], { status: "rejected", rejectedAt: nowIso(), rejectReason: reason.trim().slice(0, 500) }, "sales_document.reject", (d) => `${docLabel(d)} recusado`, reason);
}

/**
 * Converte o orçamento em pedido (idempotente: id do pedido determinístico pelo orçamento — repetição ou conversão
 * concorrente devolve o mesmo pedido). O pedido copia itens, preços e condições aprovados no orçamento (sem repreçar).
 */
export async function convertQuoteToOrder(ctx: Ctx, quoteId: string) {
  await assertFeature(ctx);
  requirePerm(ctx, "sales", "view");
  requireAction(ctx, "sales_doc.order");
  const quote = await loadDoc(ctx, quoteId);
  assertScope(ctx, quote);
  assert(quote.type === "quote", "Somente orçamentos podem ser convertidos em pedido.");
  if (quote.convertedOrderId) return ctx.store.getOrThrow("sales_documents", quote.convertedOrderId);
  assert(QUOTE_OPEN.includes(quote.status), quote.status === "converted" ? "Orçamento já convertido em venda no PDV." : `Orçamento ${QUOTE_STATUS_LABEL[quote.status]?.toLowerCase()} não pode ser convertido.`, "invalid_status");
  assert(!quote.validUntil || quote.validUntil >= today(), "Orçamento vencido: altere a validade antes de converter.", "expired");
  assert(quote.customerId, "Identifique o cliente cadastrado no orçamento antes de convertê-lo em pedido.", "customer_required");
  const customer = await ctx.store.getOrThrow("customers", quote.customerId);
  assert(customer.status !== "inactive", "Cliente inativo.");
  const items = await documentItems(ctx.store, quoteId);
  const orderId = detId("sdoc", ctx.companyId, `quote:${quoteId}`);
  const head = {
    customerId: quote.customerId,
    customerSnapshot: customerSnapshot(customer, {}),
    sellerId: quote.sellerId ?? null,
    validUntil: null,
    deliveryDate: quote.deliveryDate ?? null,
    paymentTermId: quote.paymentTermId ?? null,
    paymentNotes: quote.paymentNotes ?? null,
    notes: quote.notes ?? null,
    internalNotes: quote.internalNotes ?? null,
  };
  const totals = {
    priceTableId: quote.priceTableId ?? null, itemsCount: quote.itemsCount, qtyTotal: quote.qtyTotal, subtotal: quote.subtotal, itemDiscounts: quote.itemDiscounts, globalDiscount: quote.globalDiscount,
    globalDiscountBps: quote.globalDiscountBps ?? 0, discountTotal: quote.discountTotal, surcharge: quote.surcharge ?? 0, surchargeTotal: quote.surchargeTotal, total: quote.total,
  };
  const rows = items.map((i) => ({
    seq: i.seq, skuId: i.skuId, productId: i.productId, sku: i.sku, description: i.description, unitCode: i.unitCode, qty: i.qty, listPrice: i.listPrice, unitPrice: i.unitPrice,
    grossTotal: i.grossTotal, itemDiscount: i.itemDiscount, itemSurcharge: i.itemSurcharge ?? 0, globalDiscount: i.globalDiscount, surcharge: i.surcharge, total: i.total, invoicedQty: 0,
    service: Boolean(i.service), maxDiscountBps: i.maxDiscountBps ?? null, wholesale: Boolean(i.wholesale),
  }));
  const order = await persistNew(ctx, "order", orderId, quote.branchId, head, totals, rows, { idemKey: `quote:${quoteId}`, sourceQuoteId: quoteId, approverId: quote.discountApprovedBy ?? null });
  await retryOnConflict(async () => {
    const cur = await ctx.store.getOrThrow("sales_documents", quoteId);
    if (cur.convertedOrderId === order.id) return;
    await ctx.store.update("sales_documents", quoteId, { status: "converted", convertedOrderId: order.id, approvedAt: cur.approvedAt ?? nowIso() });
  });
  await audit(ctx, { module: "sales", action: "sales_document.convert", entityType: "sales_document", entityId: quoteId, summary: `${docLabel(quote)} convertido no pedido nº ${order.number}`, related: [`sales_document:${order.id}`] });
  return order;
}

// ───────────────────────────── pedido: cancelamento e reserva

export async function cancelOrder(ctx: Ctx, id: string, reason: string) {
  await assertFeature(ctx);
  requireAction(ctx, "sales_doc.cancel");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  const doc = await loadDoc(ctx, id);
  assertScope(ctx, doc);
  assert(doc.type === "order", "Somente pedidos de venda.");
  if (doc.status === "cancelled") {
    await syncReservations(ctx, id, "renew"); // conclui liberação pendente (idempotente)
    return doc;
  }
  assert(ORDER_OPEN.includes(doc.status), `Pedido ${ORDER_STATUS_LABEL[doc.status]?.toLowerCase()} não pode ser cancelado.`, "invalid_status");
  const prog = await nfeInProgressBySeq(ctx, id);
  assert(!prog.docs.length, "Há NF-e em andamento para este pedido: descarte-a (ou aguarde a autorização) antes de cancelar.", "nfe_in_progress");
  const openCarts = await cartsWithDocument(ctx, doc);
  assert(!openCarts.length, "O pedido está importado num atendimento do PDV: conclua ou cancele o atendimento antes.", "cart_open");
  await ctx.store.update("sales_documents", id, { status: "cancelled", cancelledAt: nowIso(), cancelledBy: ctx.user.id, cancelReason: reason.trim().slice(0, 500), reservationStatus: doc.reservationStatus === "active" ? "released" : doc.reservationStatus });
  const released = await syncReservations(ctx, id, "renew");
  await audit(ctx, { module: "sales", action: "sales_document.cancel", entityType: "sales_document", entityId: id, summary: `${docLabel(doc)} cancelado${(doc.invoicedQtyTotal ?? 0) > 0 ? " (saldo não faturado)" : ""} — reserva liberada (${released.released} SKU)`, reason });
  return ctx.store.getOrThrow("sales_documents", id);
}

/** Renova (ou cria) a reserva do pedido pelo prazo do parâmetro, sobre o disponível atual. */
export async function renewReservation(ctx: Ctx, id: string) {
  await assertFeature(ctx);
  requireAction(ctx, "sales_doc.order");
  const doc = await loadDoc(ctx, id);
  assertScope(ctx, doc);
  assert(doc.type === "order" && ORDER_OPEN.includes(doc.status), "Somente pedidos abertos reservam estoque.");
  const days = Math.max(0, Number(await getSetting<number>(ctx.store, ctx.companyId, doc.branchId, "sales.orderReservationDays", 15)) || 0);
  assert(days > 0, "Reserva de pedidos desligada (parâmetro “Reserva de estoque do pedido de venda” = 0).");
  await ctx.store.update("sales_documents", id, { reservationStatus: "active", reserveUntil: addDays(today(), days) });
  const r = await syncReservations(ctx, id, "renew");
  await audit(ctx, { module: "sales", action: "sales_document.reserve", entityType: "sales_document", entityId: id, summary: `${docLabel(doc)}: reserva renovada até ${addDays(today(), days).split("-").reverse().join("/")}${r.shortage.length ? ` — sem saldo para ${r.shortage.length} SKU` : ""}` });
  return ctx.store.getOrThrow("sales_documents", id);
}

/**
 * Ajusta as reservas do pedido ao saldo a faturar (pendente = quantidade − faturado, itens físicos):
 *  - "reduce": só reduz (faturamento consome a reserva; nunca reserva além do que já havia);
 *  - "renew": libera e reserva de novo o pendente sobre o disponível atual (criação, alteração, renovação);
 * Pedido cancelado, faturado ou com reserva expirada/liberada → nenhuma reserva ativa.
 * Cada SKU usa chave nova a cada ajuste (`sdoc:<pedido>:<sku>:<n>`), como exige `reserve()`.
 */
export async function syncReservations(ctx: Ctx, id: string, mode: "reduce" | "renew", endStatus: "released" | "consumed" = "released") {
  const doc = await ctx.store.getOrThrow("sales_documents", id);
  const shortage: Array<{ skuId: string; sku: string; missing: number }> = [];
  let released = 0;
  if (doc.type !== "order") return { shortage, released };
  const items = await documentItems(ctx.store, id);
  const keep = ORDER_OPEN.includes(doc.status) && doc.reservationStatus === "active";
  const desired = new Map<string, number>();
  if (keep) for (const it of items) if (!it.service) desired.set(it.skuId, (desired.get(it.skuId) ?? 0) + pendingOf(it));
  const active = await listAll(ctx.store, "stock_reservations", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", id], ["eq", "status", "active"]] });
  const cur = new Map<string, number>();
  for (const r of active) cur.set(r.skuId, (cur.get(r.skuId) ?? 0) + r.qty);
  const sctx: Ctx = { ...ctx, branchId: doc.branchId };
  const warehouseId = doc.warehouseId ?? (await defaultWarehouse(ctx.store, doc.branchId)).id;
  for (const skuId of new Set([...desired.keys(), ...cur.keys()])) {
    const have = cur.get(skuId) ?? 0;
    const want = desired.get(skuId) ?? 0;
    if (mode === "reduce" ? have <= want : have === want) continue;
    if (have > 0) {
      await releaseReservations(sctx, "sales_document", id, mode === "reduce" ? endStatus : "released", skuId);
      released++;
    }
    let q = mode === "reduce" ? Math.min(have, want) : want;
    if (q <= 0) continue;
    if (mode === "renew") {
      const bal = await ensureBalance(ctx.store, ctx, warehouseId, skuId);
      const avail = Math.max(0, (bal.physical ?? 0) - (bal.reserved ?? 0));
      if (avail < q) {
        const sku = await ctx.store.get("skus", skuId);
        shortage.push({ skuId, sku: sku?.sku ?? skuId, missing: q - avail });
        q = avail;
      }
      if (q <= 0) continue;
    }
    const gen = (await listAll(ctx.store, "stock_reservations", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", id], ["eq", "skuId", skuId]] })).length;
    try {
      await reserve(sctx, { warehouseId, skuId, qty: q, originType: "sales_document", originId: id, idemKey: `sdoc:${id}:${skuId}:${gen}`, allowNegative: mode === "reduce" });
    } catch (e: any) {
      if (!(e instanceof BusinessError) || e.code !== "insufficient_stock") throw e;
      const sku = await ctx.store.get("skus", skuId);
      shortage.push({ skuId, sku: sku?.sku ?? skuId, missing: q });
    }
  }
  // falta de reserva atual (pendente − reservado por SKU) — recalculada em todo ajuste (o faturamento pode zerá-la)
  const after = await listAll(ctx.store, "stock_reservations", { filters: [["eq", "originType", "sales_document"], ["eq", "originId", id], ["eq", "status", "active"]] });
  const have = new Map<string, number>();
  for (const r of after) have.set(r.skuId, (have.get(r.skuId) ?? 0) + r.qty);
  const missing: Array<{ skuId: string; sku: string; missing: number }> = [];
  for (const [skuId, want] of desired) {
    const m = want - (have.get(skuId) ?? 0);
    if (m > 0) missing.push({ skuId, sku: items.find((i) => i.skuId === skuId)?.sku ?? skuId, missing: m });
  }
  const now = missing.length ? missing : null;
  if (JSON.stringify(now) !== JSON.stringify(doc.reservationShortage ?? null)) await ctx.store.update("sales_documents", id, { reservationShortage: now });
  return { shortage, released };
}

// ───────────────────────────── faturamento (venda do PDV e NF-e)

/** Situação do documento a partir das quantidades faturadas (pedido) — idempotente. */
async function refreshDocument(ctx: Ctx, id: string) {
  const doc = await ctx.store.getOrThrow("sales_documents", id);
  const items = await documentItems(ctx.store, id);
  const invoiced = items.reduce((a, i) => a + Math.min(i.qty, i.invoicedQty ?? 0), 0);
  const patch: Record<string, any> = {};
  if ((doc.invoicedQtyTotal ?? 0) !== invoiced) patch.invoicedQtyTotal = invoiced;
  if (doc.type === "order" && doc.status !== "cancelled") {
    const all = items.length > 0 && items.every((i) => (i.invoicedQty ?? 0) >= i.qty);
    const status = all ? "invoiced" : invoiced > 0 ? "partial" : "open";
    if (status !== doc.status) patch.status = status;
    if (status === "invoiced" && !doc.invoicedAt) patch.invoicedAt = nowIso();
    if (status !== "invoiced" && doc.invoicedAt) patch.invoicedAt = null;
  }
  if (Object.keys(patch).length) await ctx.store.update("sales_documents", id, patch);
  return { ...doc, ...patch };
}

type BillLine = { itemId: string; seq: number; qty: number };

/**
 * Grava UMA vez o faturamento de uma origem (venda ou NF-e): marcador determinístico + incrementos de `invoicedQty`
 * limitados à quantidade do item, na mesma transação. `plan` recebe os itens relidos (concorrência) e devolve as linhas.
 */
async function recordBilling(ctx: Ctx, documentId: string, sourceKey: string, meta: Record<string, any>, plan: (items: Doc[]) => { lines: BillLine[]; excess?: unknown }) {
  const markerId = detId("sdocbill", sourceKey);
  const applied = await retryOnConflict(async () => {
    if (await ctx.store.get("operations", markerId)) return false;
    const items = await documentItems(ctx.store, documentId);
    const { lines, excess } = plan(items);
    await ctx.store.transaction(async (t) => {
      await t.create("operations", { companyId: ctx.companyId, type: "sales_doc.bill", status: "done", entityType: "sales_document", entityId: documentId, createdBy: ctx.user.id, result: { ...meta, lines, excess: excess ?? null, at: nowIso() } }, markerId);
      for (const l of lines) {
        const it = items.find((i) => i.id === l.itemId)!;
        await t.increment("sales_document_items", l.itemId, "invoicedQty", l.qty, { max: it.qty });
      }
      await t.update("sales_documents", documentId, { lastBilledAt: nowIso() });
    });
    return true;
  });
  return { applied, marker: await ctx.store.get("operations", markerId) };
}

/** Desfaz UMA vez o faturamento de uma origem (cancelamento da venda/NF-e): devolve exatamente as quantidades gravadas. */
async function reverseBilling(ctx: Ctx, documentId: string, sourceKey: string) {
  const bill = await ctx.store.get("operations", detId("sdocbill", sourceKey));
  if (!bill) return false;
  const markerId = detId("sdocunbill", sourceKey);
  return retryOnConflict(async () => {
    if (await ctx.store.get("operations", markerId)) return false;
    const lines = (bill.result?.lines ?? []) as BillLine[];
    await ctx.store.transaction(async (t) => {
      await t.create("operations", { companyId: ctx.companyId, type: "sales_doc.unbill", status: "done", entityType: "sales_document", entityId: documentId, createdBy: ctx.user.id, result: { source: sourceKey, lines, at: nowIso() } }, markerId);
      for (const l of lines) if (l.qty > 0) await t.increment("sales_document_items", l.itemId, "invoicedQty", -l.qty, { min: 0 });
    });
    return true;
  });
}

/** Distribui quantidades por SKU entre os itens do documento (na ordem dos itens), até o saldo de cada item. */
function allocateBySku(items: Doc[], wanted: Map<string, number>) {
  const lines: BillLine[] = [];
  const excess: Array<{ skuId: string; qty: number }> = [];
  for (const [skuId, q0] of wanted) {
    let q = q0;
    for (const it of items.filter((i) => i.skuId === skuId)) {
      if (q <= 0) break;
      const take = Math.min(q, pendingOf(it));
      if (take > 0) {
        lines.push({ itemId: it.id, seq: it.seq, qty: take });
        q -= take;
      }
    }
    if (q > 0) excess.push({ skuId, qty: q });
  }
  return { lines, excess };
}

/**
 * Venda concluída no PDV a partir do documento (gancho pós-commit de `finalizeSale`, idempotente):
 *  - pedido: quantidades vendidas dos SKUs do pedido viram faturadas (até o saldo de cada item); a reserva é consumida;
 *  - orçamento: passa a "convertido" com o vínculo da venda.
 */
export async function billFromSale(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (!sale.salesDocumentId || sale.status !== "completed") return null;
  const doc = await ctx.store.getOrThrow("sales_documents", sale.salesDocumentId);
  const sctx: Ctx = { ...ctx, branchId: doc.branchId };
  const saleItems = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]] });
  if (saleItems.length < (sale.itemsCount ?? 0)) throw new Error(`Itens da venda nº ${sale.number} ainda não gravados.`);
  const sourceKey = `sale:${saleId}`;
  const meta = { source: "sale", sourceId: saleId, sourceNumber: sale.number, documentId: doc.id };
  let res: Awaited<ReturnType<typeof recordBilling>>;
  if (doc.type === "quote") {
    res = await recordBilling(sctx, doc.id, sourceKey, meta, () => ({ lines: [] }));
    if (res.applied || doc.status !== "converted") {
      const fresh = await ctx.store.getOrThrow("sales_documents", doc.id);
      if (!fresh.convertedSaleId && !fresh.convertedOrderId) await ctx.store.update("sales_documents", doc.id, { status: "converted", convertedSaleId: saleId, approvedAt: fresh.approvedAt ?? nowIso() });
    }
  } else {
    const wanted = new Map<string, number>();
    for (const i of saleItems) wanted.set(i.skuId, (wanted.get(i.skuId) ?? 0) + i.qty);
    res = await recordBilling(sctx, doc.id, sourceKey, meta, (items) => allocateBySku(items, wanted));
    await refreshDocument(sctx, doc.id);
    await syncReservations(sctx, doc.id, "reduce", "consumed");
  }
  if (res.applied) {
    const lines = (res.marker?.result?.lines ?? []) as BillLine[];
    await audit(sctx, {
      module: "sales", action: "sales_document.bill", entityType: "sales_document", entityId: doc.id,
      summary: doc.type === "quote" ? `${docLabel(doc)} convertido na venda nº ${sale.number} (PDV)` : `${docLabel(doc)}: ${lines.length} item(ns) faturado(s) na venda nº ${sale.number} (PDV) — ${lines.map((l) => `item ${l.seq}: ${formatQty(l.qty)}`).join(", ")}`,
      related: [`sale:${saleId}`],
    });
  }
  return ctx.store.getOrThrow("sales_documents", doc.id);
}

/** Venda cancelada: as quantidades que ela faturou voltam ao saldo do pedido; orçamento convertido por ela volta a "aprovado". */
export async function unbillFromSale(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (!sale.salesDocumentId) return null;
  const doc = await ctx.store.getOrThrow("sales_documents", sale.salesDocumentId);
  const sctx: Ctx = { ...ctx, branchId: doc.branchId };
  const done = await reverseBilling(sctx, doc.id, `sale:${saleId}`);
  if (doc.type === "quote") {
    if (doc.convertedSaleId === saleId) await ctx.store.update("sales_documents", doc.id, { status: "approved", convertedSaleId: null });
  } else await refreshDocument(sctx, doc.id);
  if (done) await audit(sctx, { module: "sales", action: "sales_document.unbill", entityType: "sales_document", entityId: doc.id, summary: `${docLabel(doc)}: faturamento da venda nº ${sale.number} desfeito (venda cancelada) — quantidades voltaram ao saldo a faturar`, related: [`sale:${saleId}`] });
  return ctx.store.getOrThrow("sales_documents", doc.id);
}

/** Gancho da NF-e com origem pedido (`syncOrigin`): autorizada fatura; cancelada/descartada/denegada devolve ao saldo. */
export async function syncBillingFromNfe(ctx: Ctx, fiscalDocId: string) {
  const fd = await ctx.store.getOrThrow("fiscal_documents", fiscalDocId);
  if (fd.originType !== "sales_document" || !fd.originId) return null;
  const doc = await ctx.store.get("sales_documents", fd.originId);
  if (!doc) return null;
  const sctx: Ctx = { ...ctx, branchId: doc.branchId };
  const sourceKey = `nfe:${fd.id}`;
  if (fd.status === "authorized") {
    const res = await recordBilling(sctx, doc.id, sourceKey, { source: "nfe", sourceId: fd.id, sourceNumber: fd.number ?? null, documentId: doc.id }, (items) => {
      const lines: BillLine[] = [];
      const excess: Array<{ seq: number; qty: number }> = [];
      for (const i of fd.items ?? []) {
        if (!i.nItemPed) continue;
        const it = items.find((x) => x.seq === i.nItemPed);
        if (!it) continue;
        const already = lines.filter((l) => l.itemId === it.id).reduce((a, l) => a + l.qty, 0);
        const take = Math.min(i.qty, Math.max(0, pendingOf(it) - already));
        if (take > 0) lines.push({ itemId: it.id, seq: it.seq, qty: take });
        if (take < i.qty) excess.push({ seq: i.nItemPed, qty: i.qty - take });
      }
      return { lines, excess };
    });
    await refreshDocument(sctx, doc.id);
    await syncReservations(sctx, doc.id, "reduce", "consumed");
    if (res.applied) {
      const lines = (res.marker?.result?.lines ?? []) as BillLine[];
      await audit(sctx, { module: "sales", action: "sales_document.bill", entityType: "sales_document", entityId: doc.id, summary: `${docLabel(doc)}: ${lines.length} item(ns) faturado(s) na NF-e nº ${fd.number ?? fd.ref}`, related: [`fiscal_document:${fd.id}`] });
    }
  } else if (NFE_INACTIVE.includes(fd.status)) {
    const done = await reverseBilling(sctx, doc.id, sourceKey);
    await refreshDocument(sctx, doc.id);
    if (done) await audit(sctx, { module: "sales", action: "sales_document.unbill", entityType: "sales_document", entityId: doc.id, summary: `${docLabel(doc)}: NF-e nº ${fd.number ?? fd.ref} cancelada — quantidades voltaram ao saldo a faturar`, related: [`fiscal_document:${fd.id}`] });
  }
  return ctx.store.getOrThrow("sales_documents", doc.id);
}

/** Saldo faturável agora por item: quantidade − faturado − em NF-e em andamento (exceto a NF-e informada). */
export async function billableByItem(ctx: Ctx, doc: Doc, items: Doc[], excludeFiscalId?: string | null) {
  const prog = await nfeInProgressBySeq(ctx, doc.id, excludeFiscalId);
  return new Map(items.map((i) => [i.id, Math.max(0, pendingOf(i) - (prog.map.get(i.seq) ?? 0))]));
}

/** Documento pode ser faturado (PDV/NF-e)? Devolve a mensagem do impedimento ou null. */
function billingBlocker(doc: Doc, target: "pdv" | "nfe"): string | null {
  if (doc.type === "quote") {
    if (target === "nfe") return "Orçamento não gera NF-e diretamente: converta-o em pedido de venda.";
    if (!QUOTE_OPEN.includes(doc.status)) return `${docLabel(doc)} está ${QUOTE_STATUS_LABEL[doc.status]?.toLowerCase() ?? doc.status}.`;
    if (doc.validUntil && doc.validUntil < today()) return `${docLabel(doc)} venceu em ${doc.validUntil.split("-").reverse().join("/")}: altere a validade antes de faturar.`;
    return null;
  }
  if (!ORDER_OPEN.includes(doc.status)) return `${docLabel(doc)} está ${ORDER_STATUS_LABEL[doc.status]?.toLowerCase() ?? doc.status}.`;
  return null;
}

/**
 * Conferência antes de gravar a venda do PDV com documento vinculado (sem efeito no documento): documento da filial,
 * faturável, mesmo cliente e, para pedido, quantidade de cada SKU do pedido até o saldo faturável (sem faturar duas vezes
 * o que está em NF-e em andamento).
 */
export async function checkSaleAgainstDocument(ctx: Ctx, documentId: string, sale: { branchId: string; customerId: string | null; lines: Array<{ skuId: string; qty: number }> }) {
  const doc = await ctx.store.getOrThrow("sales_documents", documentId);
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  assert(doc.branchId === sale.branchId, "O orçamento/pedido importado é de outra filial.", "branch_mismatch");
  const blocker = billingBlocker(doc, "pdv");
  if (blocker) throw new BusinessError(blocker, "document_not_billable");
  if (doc.customerId) assert(sale.customerId === doc.customerId, `A venda deve ser para o cliente do ${doc.type === "quote" ? "orçamento" : "pedido"} (${doc.customerSnapshot?.name ?? ""}).`, "document_customer");
  if (doc.type !== "order") return doc;
  const items = await documentItems(ctx.store, documentId);
  const billable = await billableByItem(ctx, doc, items);
  const bySku = new Map<string, number>();
  for (const i of items) bySku.set(i.skuId, (bySku.get(i.skuId) ?? 0) + (billable.get(i.id) ?? 0));
  const sold = new Map<string, number>();
  for (const l of sale.lines) sold.set(l.skuId, (sold.get(l.skuId) ?? 0) + l.qty);
  for (const [skuId, q] of sold) {
    if (!bySku.has(skuId)) continue; // item fora do pedido: venda avulsa junto
    const max = bySku.get(skuId)!;
    if (q > max) {
      const it = items.find((i) => i.skuId === skuId)!;
      throw new BusinessError(`${it.sku}: quantidade (${formatQty(q)}) acima do saldo a faturar do pedido nº ${doc.number} (${formatQty(max)}). Venda o excedente em outro atendimento.`, "document_over_billing");
    }
  }
  return doc;
}

// ───────────────────────────── PDV (PDV-12)

async function cartsWithDocument(ctx: Ctx, doc: Doc) {
  const carts = await listAll(ctx.store, "carts", { filters: [["eq", "branchId", doc.branchId], ["eq", "status", ["open", "parked"]]] }, 500);
  return carts.filter((c) => c.salesDocumentId === doc.id);
}

/** Itens do documento como linhas do atendimento: preço do documento mantido, desconto/acréscimo proporcionais ao saldo. */
export async function cartItemsFor(ctx: Ctx, doc: Doc, quantities?: Record<string, number> | null): Promise<CartItem[]> {
  const items = await documentItems(ctx.store, doc.id);
  const billable = doc.type === "order" ? await billableByItem(ctx, doc, items) : new Map(items.map((i) => [i.id, i.qty]));
  const out: CartItem[] = [];
  for (const it of items) {
    const max = billable.get(it.id) ?? 0;
    // faturamento parcial: quantidade escolhida por item (até o saldo); sem escolha = todo o saldo
    const wanted = quantities && it.id in quantities ? Math.max(0, Math.round(Number(quantities[it.id]) || 0)) : max;
    if (doc.type === "order") assert(wanted <= max, `Item ${it.seq} (${it.sku}): quantidade acima do saldo a faturar (${formatQty(max)}).`, "document_over_billing");
    else assert(wanted <= it.qty, `Item ${it.seq} (${it.sku}): quantidade acima da do orçamento.`);
    const q = wanted;
    if (q <= 0) continue;
    const from = doc.type === "order" ? (it.invoicedQty ?? 0) : 0;
    out.push({
      skuId: it.skuId,
      qty: q,
      unitPrice: it.unitPrice,
      itemDiscount: shareOf((it.itemDiscount ?? 0) + (it.globalDiscount ?? 0), it.qty, from, q),
      itemSurcharge: shareOf(it.surcharge ?? 0, it.qty, from, q),
      sku: it.sku,
      name: it.description,
      unitCode: it.unitCode,
      listPrice: it.listPrice,
      wholesalePrice: null,
      wholesaleMinQty: null,
      available: null,
      service: Boolean(it.service),
      maxDiscountBps: it.maxDiscountBps ?? null,
    });
  }
  return out;
}

/**
 * "Importar orçamento/pedido" no PDV: cria (ou reaproveita, se vazio) o atendimento do terminal com cliente, vendedor,
 * tabela, itens e preços do documento. O atendimento atual com itens vai para espera (pré-venda). A conclusão da venda
 * fatura o documento (gancho pós-commit). Um documento fica em um único atendimento aberto por vez.
 */
export async function importDocumentToCart(ctx: Ctx, terminalId: string, documentId: string, quantities?: Record<string, number> | null) {
  await assertFeature(ctx);
  requirePerm(ctx, "pdv", "create");
  requirePerm(ctx, "sales", "view");
  const branchId = requireBranch(ctx);
  const doc = await loadDoc(ctx, documentId);
  assert(doc.branchId === branchId, "Documento de outra filial: selecione a filial do documento.", "branch_mismatch");
  const blocker = billingBlocker(doc, "pdv");
  if (blocker) throw new BusinessError(blocker, "document_not_billable");
  const { createCart, ensureOpenCart, parkCart, cancelCart, saveCart } = await import("./carts");
  let cart = await ensureOpenCart(ctx, terminalId, { create: false });
  const same = Boolean(cart && cart.salesDocumentId === doc.id);
  const elsewhere = (await cartsWithDocument(ctx, doc)).filter((c) => c.id !== cart?.id);
  if (elsewhere.length) throw new BusinessError(`${docLabel(doc)} já está ${elsewhere[0].status === "parked" ? "em uma pré-venda" : "em atendimento em outro terminal"}: retome aquele atendimento ou cancele-o antes.`, "document_in_cart");
  const items = await cartItemsFor(ctx, doc, quantities);
  assert(items.length > 0, quantities ? "Informe a quantidade de ao menos um item." : `${docLabel(doc)} não tem saldo a faturar (itens já faturados ou em NF-e em andamento).`, "nothing_to_bill");
  // o mesmo documento já está neste atendimento: só atualiza itens/quantidades
  if (cart && !same && (cart.items ?? []).length) cart = (await parkCart(ctx, cart.id, cart.name ?? null)).fresh;
  else if (cart && !same && cart.exchangeReturnId) {
    await cancelCart(ctx, cart.id, "Atendimento vazio substituído por orçamento/pedido importado");
    cart = null;
  }
  if (!cart) cart = await createCart(ctx, terminalId);
  const saved = await saveCart(ctx, cart.id, {
    items,
    customerId: doc.customerId ?? null,
    priceTableId: doc.priceTableId ?? undefined,
    sellerId: doc.sellerId ?? null,
    globalDiscount: 0,
    globalDiscountBps: 0,
    surcharge: 0,
    notes: `${docLabel(doc)}${doc.notes ? ` — ${doc.notes}` : ""}`.slice(0, 500),
    salesDocumentId: doc.id,
    salesDocumentLabel: `${docLabel(doc)}${doc.customerSnapshot?.name ? ` — ${doc.customerSnapshot.name}` : ""}`.slice(0, 120),
  }, { replaceItems: true });
  await audit(ctx, { module: "sales", action: "sales_document.import_pdv", entityType: "sales_document", entityId: doc.id, summary: `${docLabel(doc)} importado no PDV (${items.length} itens)`, related: [`cart:${saved.id}`] });
  return saved;
}

/** Documentos faturáveis da filial para o PDV (orçamentos válidos e pedidos com saldo), com busca por nº/cliente. */
export async function listBillableDocuments(ctx: Ctx, q?: string | null) {
  const branchId = requireBranch(ctx);
  if (!(await salesDocsEnabled(ctx))) return [];
  const rows = await listAll(ctx.store, "sales_documents", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchId], ["eq", "status", [...QUOTE_OPEN, ...ORDER_OPEN]]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 500);
  const d = today();
  const term = searchable(q ?? "");
  const num = /^\d{1,9}$/.test((q ?? "").trim()) ? Number(q!.trim()) : null;
  return rows
    .filter((r) => r.type === "order" || !r.validUntil || r.validUntil >= d)
    .filter((r) => !term || (num != null ? r.number === num : String(r.searchText ?? "").includes(term)))
    .slice(0, 50)
    .map((r) => ({ id: r.id, type: r.type as SalesDocType, number: r.number as number, status: r.status as string, customerName: (r.customerSnapshot?.name ?? null) as string | null, total: r.total as number, validUntil: (r.validUntil ?? null) as string | null, createdAt: r.createdAt as string, itemsCount: r.itemsCount as number, invoicedQtyTotal: (r.invoicedQtyTotal ?? 0) as number, qtyTotal: (r.qtyTotal ?? 0) as number }));
}

// ───────────────────────────── NF-e (FIS-05)

/** Pré-preenchimento da NF-e a partir do pedido: saldo faturável, preços do pedido, xPed/nItemPed e efeitos na autorização. */
export async function salesDocumentNfePrefill(ctx: Ctx, id: string, branchId: string, existingFiscalId: string | null, base: import("./fiscal/nfe").NfeInput) {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const doc = await loadDoc(ctx, id);
  const label = docLabel(doc);
  const href = docPath(doc);
  if (!(await salesDocsEnabled({ ...ctx, branchId }))) blockers.push("Orçamentos e pedidos de venda estão desligados em Administração › Parâmetros › Recursos.");
  const b = billingBlocker(doc, "nfe");
  if (b) blockers.push(b);
  if (doc.branchId !== branchId) {
    const br = await ctx.store.get("branches", doc.branchId);
    blockers.push(`O ${label.toLowerCase()} pertence ${br ? `à filial ${br.name}` : "a outra filial"}: a NF-e deve ser emitida pela filial do pedido — selecione-a no topo da tela.`);
  }
  const items = await documentItems(ctx.store, id);
  const billable = await billableByItem(ctx, doc, items, existingFiscalId);
  const lines = items.filter((i) => (billable.get(i.id) ?? 0) > 0);
  if (!blockers.length && !lines.length) blockers.push(`${label} sem saldo a faturar (itens já faturados no PDV/NF-e ou em NF-e em andamento).`);
  if (lines.length < items.length && lines.length) warnings.push("Itens já faturados (no PDV ou em NF-e anterior) não aparecem; a quantidade de cada item é o saldo a faturar.");
  warnings.push("O pedido não baixa estoque nem gera financeiro: esta NF-e baixa o estoque e gera o título a receber na autorização (marque/desmarque em Pagamento › Efeitos). O cancelamento da NF-e estorna os efeitos e devolve as quantidades ao pedido.");
  const { partyRecipient } = await import("./fiscal/nfe");
  const customer = doc.customerId ? await ctx.store.get("customers", doc.customerId) : null;
  const nfeItems = lines.map((i) => {
    const q = billable.get(i.id)!;
    return { skuId: i.skuId, qty: q, unitPrice: i.unitPrice, discount: shareOf((i.itemDiscount ?? 0) + (i.globalDiscount ?? 0), i.qty, i.invoicedQty ?? 0, q), description: i.description, xPed: String(doc.number), nItemPed: i.seq };
  });
  const other = lines.reduce((a, i) => a + shareOf(i.surcharge ?? 0, i.qty, i.invoicedQty ?? 0, billable.get(i.id)!), 0);
  const total = nfeItems.reduce((a, i) => a + roundDiv(i.unitPrice * i.qty, QTY) - i.discount, 0) + other;
  const input = {
    ...base,
    origin: { type: "sales_document" as const, id },
    nature: "Venda de mercadoria",
    recipient: customer ? partyRecipient(customer, "customer") : base.recipient,
    items: nfeItems,
    other,
    payments: total > 0 ? [{ kind: "other", amount: total }] : [],
    additionalInfo: `Pedido de venda nº ${doc.number}${doc.paymentNotes ? ` — ${doc.paymentNotes}` : ""}`.slice(0, 500),
    effects: { stock: true, financial: true, warehouseId: null, dueDate: null, paymentTermId: doc.paymentTermId ?? null },
  };
  return { input, label, href, warnings, blockers };
}

/**
 * Normaliza a NF-e de pedido no servidor (prévia e gravação): cada item precisa apontar um item do pedido (nItemPed)
 * com o mesmo produto; quantidade até o saldo faturável; preço, desconto e acréscimo proporcionais vêm do pedido.
 */
export async function normalizeSalesDocumentNfe(ctx: Ctx, input: import("./fiscal/nfe").NfeInput, opts: { excludeDocId?: string | null }) {
  const doc = await loadDoc(ctx, input.origin.id!);
  const b = billingBlocker(doc, "nfe");
  if (b) throw new BusinessError(b, "document_not_billable");
  const items = await documentItems(ctx.store, doc.id);
  const billable = await billableByItem(ctx, doc, items, opts.excludeDocId ?? null);
  const used = new Map<string, number>();
  let other = 0;
  const out = input.items.map((li) => {
    const it = li.nItemPed ? items.find((i) => i.seq === Number(li.nItemPed)) : null;
    if (!it || it.skuId !== li.skuId) throw new BusinessError("Item fora do pedido de venda: a NF-e de pedido só fatura itens do pedido (inclua outros produtos em outra NF-e).", "item_not_in_document");
    const prev = used.get(it.id) ?? 0;
    const max = (billable.get(it.id) ?? 0) - prev;
    if (li.qty > max) throw new BusinessError(`Item ${it.seq} (${it.sku}): quantidade ${formatQty(li.qty)} acima do saldo a faturar do pedido (${formatQty(Math.max(0, max))}).`, "document_over_billing");
    const from = (it.invoicedQty ?? 0) + prev;
    used.set(it.id, prev + li.qty);
    other += shareOf(it.surcharge ?? 0, it.qty, from, li.qty);
    return { ...li, unitPrice: it.unitPrice, discount: shareOf((it.itemDiscount ?? 0) + (it.globalDiscount ?? 0), it.qty, from, li.qty), description: li.description || it.description, xPed: String(doc.number), nItemPed: it.seq };
  });
  return { ...input, items: out, other };
}

// ───────────────────────────── envio, compartilhamento e rotina

/** Texto da mensagem do WhatsApp (com link público somente leitura do documento). */
export function whatsappText(doc: Doc, company: { tradeName?: string | null; name?: string | null } | null, link: string | null) {
  const who = doc.customerSnapshot?.name && doc.customerId ? doc.customerSnapshot.name.split(" ")[0] : null;
  const lines = [
    `Olá${who ? `, ${who}` : ""}! Segue o ${doc.type === "quote" ? "orçamento" : "pedido"} nº ${doc.number} de ${company?.tradeName || company?.name || "nossa loja"}.`,
    `Total: ${formatMoney(doc.total)} (${doc.itemsCount} ${doc.itemsCount === 1 ? "item" : "itens"}).`,
    doc.type === "quote" && doc.validUntil ? `Válido até ${doc.validUntil.split("-").reverse().join("/")}.` : "",
    doc.paymentNotes ? `Pagamento: ${doc.paymentNotes}.` : "",
    link ? `Veja e imprima: ${link}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Documento pelo link público (somente leitura; token aleatório de 128 bits). Store SEM escopo de empresa. */
export async function documentByShareToken(store: Store, token: string) {
  if (!/^[0-9a-f]{32}$/.test(token ?? "")) return null;
  const res = await store.list("sales_documents", { filters: [["eq", "shareToken", token]], limit: 1 });
  const doc = res.items[0];
  if (!doc) return null;
  const [items, company, branch] = await Promise.all([documentItems(store, doc.id), store.get("companies", doc.companyId), store.get("branches", doc.branchId)]);
  const seller = doc.sellerId ? await store.get("users", doc.sellerId) : null;
  const term = doc.paymentTermId ? await store.get("payment_terms", doc.paymentTermId) : null;
  return { doc, items, company, branch, sellerName: (seller?.name ?? null) as string | null, termName: (term?.name ?? null) as string | null };
}

/** Envio por e-mail pelo canal configurado (Integrações → E-mail); só registra "enviado" se o provedor aceitar. */
export async function sendDocumentEmail(ctx: Ctx, id: string, to: string, link: string | null) {
  await assertFeature(ctx);
  const doc = await loadDoc(ctx, id);
  assertScope(ctx, doc);
  requireAction(ctx, actionFor(doc.type));
  assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to?.trim() ?? ""), "Informe um e-mail válido.");
  const items = await documentItems(ctx.store, id);
  const company = await ctx.store.get("companies", ctx.companyId);
  const esc = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const rows = items.map((i) => `<tr><td>${esc(i.description)}</td><td align="right">${esc(formatQty(i.qty, i.unitCode))}</td><td align="right">${esc(formatMoney(i.unitPrice))}</td><td align="right">${esc(formatMoney(i.total))}</td></tr>`).join("");
  const html = `<p>${esc(whatsappText(doc, company, null)).replace(/\n/g, "<br>")}</p><table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Produto</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr>${rows}</table><p><b>Total: ${esc(formatMoney(doc.total))}</b></p>${link ? `<p><a href="${esc(link)}">Ver e imprimir o ${doc.type === "quote" ? "orçamento" : "pedido"}</a></p>` : ""}`;
  const { sendEmail } = await import("@/lib/core/email");
  const res = await sendEmail(ctx.companyId, { to: to.trim(), subject: `${docTypeLabel(doc.type)} nº ${doc.number} — ${company?.tradeName ?? company?.name ?? ""}`, html });
  if (!res.delivered) throw new BusinessError(`E-mail não enviado: ${res.message ?? res.channel}.`, "email_failed");
  return markQuoteSent(ctx, id, "email");
}

/**
 * Rotina diária: orçamentos vencidos (rascunho/enviado/aprovado) → "expirado"; pedidos com reserva vencida → reserva
 * liberada ("Reserva expirada"; o pedido continua aberto e pode renovar a reserva).
 */
export async function expireSalesDocuments(store: Store, companyId: string) {
  const d = today();
  let quotes = 0;
  let reservations = 0;
  const open = await listAll(store, "sales_documents", { filters: [["eq", "companyId", companyId], ["eq", "status", [...QUOTE_OPEN, ...ORDER_OPEN]]] });
  for (const doc of open) {
    const ctx = systemCtx(store, companyId, doc.branchId);
    if (doc.type === "quote" && doc.validUntil && doc.validUntil < d) {
      await ctx.store.update("sales_documents", doc.id, { status: "expired", expiredAt: nowIso() });
      await audit(ctx, { module: "sales", action: "sales_document.expire", entityType: "sales_document", entityId: doc.id, summary: `${docLabel(doc)} expirado (validade ${doc.validUntil.split("-").reverse().join("/")})` });
      quotes++;
    } else if (doc.type === "order" && doc.reservationStatus === "active" && doc.reserveUntil && doc.reserveUntil < d) {
      await ctx.store.update("sales_documents", doc.id, { reservationStatus: "expired" });
      await syncReservations(ctx, doc.id, "renew");
      await audit(ctx, { module: "sales", action: "sales_document.reservation_expire", entityType: "sales_document", entityId: doc.id, summary: `${docLabel(doc)}: reserva de estoque expirada (prazo ${doc.reserveUntil.split("-").reverse().join("/")}) e liberada` });
      reservations++;
    }
  }
  return { quotes, reservations };
}
