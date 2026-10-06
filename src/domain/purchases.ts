import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { searchable } from "@/lib/core/text";
import { getSetting } from "@/lib/core/settings";
import { sendEmail } from "@/lib/core/email";
import { resolveOccurrence } from "@/lib/core/notify";
import { addDays, nowIso, today } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { defaultWarehouse } from "./stock";
import { assertSupplierUsable, supplierLabel, supplierSnapshot } from "./suppliers";
import {
  ORDER_STATUS_LABEL, EDITABLE, REVISABLE, assertTransition, buildInstallmentPlan, computeOrderTotals, isRelevantChange,
  type InstallmentPlan, type OrderItemInput, type OrderStatus, type OrderTotals,
} from "./purchase-calc";

/**
 * Pedidos de compra (Telas 27–28).
 *
 * Máquina de estados (ORDER_TRANSITIONS):
 *   rascunho → em análise → aprovado → enviado → parcialmente recebido → recebido
 *   em análise → em ajuste (devolvido) → em análise …
 *   em análise → rejeitado;  qualquer estado sem recebimento → cancelado
 *   aprovado/enviado → em análise (revisão comercial que exige nova análise, ou revogação da aprovação)
 * Aprovação NÃO envia o pedido nem registra recebimento/pagamento: "Registrar envio" é ação separada
 * e o recebimento é feito em /compras/recebimentos.
 */

export {
  ORDER_STATUS_LABEL, ORDER_TRANSITIONS, canTransition, assertTransition, EDITABLE, REVISABLE, CONFIRMED, PENDING,
  computeOrderTotals, buildInstallmentPlan, netUnitCost, isRelevantChange,
} from "./purchase-calc";
export type { OrderStatus, OrderItemInput, InstallmentPlan, OrderTotals } from "./purchase-calc";

// ───────────────────────────── Leitura

export async function orderItems(store: Store, orderId: string) {
  return listAll(store, "purchase_order_items", { filters: [["eq", "orderId", orderId]], orderBy: [{ field: "seq" }] });
}

export async function getOrder(ctx: Ctx, id: string) {
  const o = await ctx.store.getOrThrow("purchase_orders", id);
  assert(o.companyId === ctx.companyId, "Pedido de outra empresa.");
  return o;
}

/** Escrita no pedido: exige filial definida (não consolidado) e que o pedido seja da filial ativa. */
export async function getOrderForWrite(ctx: Ctx, id: string) {
  const branchId = requireBranch(ctx);
  const o = await getOrder(ctx, id);
  if (o.branchId !== branchId) throw new BusinessError(`Pedido nº ${o.number} é de outra filial: selecione a filial do pedido para alterá-lo.`, "other_branch");
  return o;
}

/** Limite de gravações por transação do Appwrite. */
const TX_MAX_WRITES = 100;

/**
 * Recebimentos que prendem o pedido ao estado atual: em conferência ou confirmando (vinculados) e confirmados com
 * mercadoria alocada a ele (cobre a confirmação interrompida antes de atualizar o saldo do pedido). Cancelar,
 * revogar a aprovação ou revisar o pedido com um deles deixaria estoque e título a pagar num pedido cancelado ou em
 * análise. Ordenados pelo número.
 */
export async function receiptsHoldingOrder(store: Store, orderId: string, statuses: string[] = ["draft", "confirming", "confirmed"]) {
  const rs = await listAll(store, "receipts", { filters: [["contains", "orderIds", orderId], ["eq", "status", statuses]] });
  return rs
    .filter((r) => r.status !== "confirmed" || (r.items ?? []).some((it: any) => !it.ignore && (it.allocations ?? []).some((al: any) => al.orderId === orderId && al.qty > 0)))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

/** Saldo a receber por item (pedido − recebido). */
export function remainingQty(item: { qty: number; receivedQty?: number | null }) {
  return Math.max(0, item.qty - (item.receivedQty ?? 0));
}

// ───────────────────────────── Criação e edição

export interface OrderInput {
  supplierId: string;
  warehouseId?: string | null;
  expectedDate?: string | null;
  items: OrderItemInput[];
  headerDiscount?: number;
  freight?: number;
  insurance?: number;
  otherExpenses?: number;
  paymentTermId?: string | null;
  paymentMethodId?: string | null;
  costCenterId?: string | null;
  /** finalidade da compra */
  purpose?: string | null;
  /** comprador responsável (usuário) */
  buyerId?: string | null;
  paymentTermsText?: string | null;
  /** prazos personalizados, ex.: "30/60/90" (sobrepõe a condição cadastrada) */
  customDays?: string | null;
  notes?: string | null;
  origin?: "manual" | "replenishment" | "quotation";
  originId?: string | null;
  quotationId?: string | null;
  proposalRef?: Record<string, any> | null;
  originData?: Record<string, any> | null;
  idemKey?: string | null;
}

async function normalizeItems(ctx: Ctx, supplierId: string, items: OrderItemInput[]) {
  assert(items.length > 0, "Inclua ao menos um produto no pedido.");
  assert(items.length <= 90, "Limite de 90 produtos por pedido — divida em mais pedidos.");
  const merged = new Map<string, OrderItemInput>();
  for (const it of items) {
    assert(it.skuId, "Produto não informado.");
    assert(Number.isInteger(it.qty) && it.qty > 0, "Quantidade deve ser maior que zero.");
    assert(Number.isInteger(it.unitCost) && it.unitCost >= 0, "Custo unitário inválido.");
    const cur = merged.get(it.skuId);
    if (cur) {
      // mesmo SKU duas vezes: soma quantidade, desconto e IPI das linhas — só com o mesmo custo unitário
      if (cur.unitCost !== it.unitCost) throw new BusinessError(`${it.description?.trim() || cur.description?.trim() || "Produto"} aparece mais de uma vez no pedido com custos diferentes (${formatMoney(cur.unitCost)} × ${formatMoney(it.unitCost)}). Use uma única linha por produto.`, "duplicate_item");
      cur.qty += it.qty;
      cur.discount = (cur.discount ?? 0) + (it.discount ?? 0);
      cur.ipi = (cur.ipi ?? 0) + (it.ipi ?? 0);
    } else merged.set(it.skuId, { ...it });
  }
  const out: OrderItemInput[] = [];
  for (const it of merged.values()) {
    const sku = await ctx.store.getOrThrow("skus", it.skuId);
    assert(sku.companyId === ctx.companyId, "Produto de outra empresa.");
    const sp = (await listAll(ctx.store, "supplier_products", { filters: [["eq", "supplierId", supplierId], ["eq", "skuId", it.skuId]] }))[0];
    out.push({ ...it, description: it.description?.trim() || sku.name || sku.sku, unitCode: it.unitCode || sku.unitCode || "UN", supplierCode: it.supplierCode ?? sp?.supplierCode ?? null });
  }
  return out;
}

async function resolvePlan(ctx: Ctx, total: number, input: Pick<OrderInput, "paymentTermId" | "customDays">) {
  const term = input.paymentTermId ? await ctx.store.get("payment_terms", input.paymentTermId) : null;
  const plan = buildInstallmentPlan(total, term ? { installments: term.installments, firstDueDays: term.firstDueDays, intervalDays: term.intervalDays } : null, input.customDays);
  return { plan, termName: term?.name ?? null };
}

function headerData(supplier: Doc, totals: OrderTotals, input: OrderInput, plan: InstallmentPlan[], termName: string | null, number: number, extra: { buyerName?: string | null; skuCodes?: string[] } = {}) {
  return {
    supplierId: supplier.id,
    supplierSnapshot: supplierSnapshot(supplier),
    expectedDate: input.expectedDate || null,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    freight: totals.freight,
    insurance: totals.insurance,
    ipiTotal: totals.ipiTotal,
    otherExpenses: totals.otherExpenses,
    total: totals.total,
    purpose: input.purpose?.trim() || null,
    buyerId: input.buyerId || null,
    paymentMethodId: input.paymentMethodId || null,
    costCenterId: input.costCenterId || null,
    paymentTermId: input.paymentTermId || null,
    paymentTermsText: input.customDays?.trim() ? `Prazos ${input.customDays.trim()} dias` : input.paymentTermsText?.trim() || termName || supplier.paymentTermsText || null,
    installmentsPlan: plan,
    notes: input.notes ?? null,
    searchText: searchable(String(number), supplier.name, supplier.tradeName, supplier.doc, input.purpose, extra.buyerName, ...totals.items.map((i) => i.description ?? ""), ...(extra.skuCodes ?? [])),
  };
}

function itemRows(ctx: Ctx, branchId: string, orderId: string, totals: OrderTotals, keepReceived?: Map<string, number>) {
  return totals.items.map((it, i) => ({
    id: detId("poi", orderId, it.skuId),
    data: {
      companyId: ctx.companyId,
      branchId,
      createdBy: ctx.user.id,
      orderId,
      seq: i + 1,
      skuId: it.skuId,
      productId: null as string | null,
      description: it.description,
      unitCode: it.unitCode,
      qty: it.qty,
      unitCost: it.unitCost,
      discount: it.discount,
      ipi: it.ipi,
      total: it.total,
      receivedQty: keepReceived?.get(it.skuId) ?? 0,
      supplierCode: it.supplierCode ?? null,
    },
  }));
}

/** Cria pedido em rascunho (idempotente por idemKey). */
export async function createOrder(ctx: Ctx, input: OrderInput) {
  requirePerm(ctx, "purchases", "create");
  const branchId = requireBranch(ctx);
  if (input.idemKey) {
    const existing = await ctx.store.get("purchase_orders", detId("po", input.idemKey));
    if (existing) return existing;
  }
  const supplier = await ctx.store.getOrThrow("suppliers", input.supplierId);
  assert(supplier.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  assertSupplierUsable(supplier);
  const items = await normalizeItems(ctx, supplier.id, input.items);
  const totals = computeOrderTotals({ items, headerDiscount: input.headerDiscount, freight: input.freight, insurance: input.insurance, otherExpenses: input.otherExpenses });
  const { plan, termName } = await resolvePlan(ctx, totals.total, input);
  const warehouseId = input.warehouseId || (await defaultWarehouse(ctx.store, branchId)).id;
  const wh = await ctx.store.getOrThrow("warehouses", warehouseId);
  assert(wh.branchId === branchId, "O depósito de entrega deve ser da filial selecionada.");
  const number = await nextNumber(ctx.store, `purchase_order:${ctx.companyId}`);
  const id = input.idemKey ? detId("po", input.idemKey) : detId("po", ctx.companyId, String(number));
  const skuDocs = new Map<string, Doc>();
  for (const it of items) skuDocs.set(it.skuId, (await ctx.store.get("skus", it.skuId))!);
  const extra = { buyerName: input.buyerId ? (await ctx.store.get("users", input.buyerId))?.name ?? null : null, skuCodes: [...skuDocs.values()].map((k) => k.sku) };
  try {
    const order = await retryOnConflict(() =>
      ctx.store.transaction(async (t) => {
        const o = await t.create(
          "purchase_orders",
          {
            companyId: ctx.companyId,
            branchId,
            createdBy: ctx.user.id,
            number,
            warehouseId,
            status: "draft",
            revision: 1,
            origin: input.origin ?? "manual",
            originId: input.originId ?? null,
            quotationId: input.quotationId ?? null,
            proposalRef: input.proposalRef ?? null,
            originData: input.originData ?? null,
            receivedValue: 0,
            idemKey: input.idemKey ?? null,
            ...headerData(supplier, totals, input, plan, termName, number, extra),
          },
          id,
        );
        for (const row of itemRows(ctx, branchId, id, totals)) await t.create("purchase_order_items", { ...row.data, productId: skuDocs.get(row.data.skuId)?.productId ?? null }, row.id);
        return o;
      }),
    );
    await audit(ctx, {
      module: "purchases",
      action: "purchase_order.create",
      entityType: "purchase_order",
      entityId: id,
      summary: `Pedido de compra nº ${number} criado em rascunho — ${supplierLabel(supplier)}, ${formatMoney(totals.total)}${input.origin && input.origin !== "manual" ? ` (origem: ${input.origin === "quotation" ? "cotação" : "reposição"})` : ""}`,
      after: { total: totals.total, items: items.length, origin: input.origin ?? "manual" },
      related: [`supplier:${supplier.id}`, ...(input.quotationId ? [`quotation:${input.quotationId}`] : [])],
    });
    return order;
  } catch (e) {
    if (isConflict(e) && input.idemKey) {
      const again = await ctx.store.get("purchase_orders", id);
      if (again) return again;
    }
    throw e;
  }
}

/** Retrato completo do pedido (cabeçalho + itens) para revisões. */
async function snapshotOf(store: Store, order: Doc) {
  const items = await orderItems(store, order.id);
  const pick = (o: Doc) => ({
    revision: o.revision, status: o.status, supplierId: o.supplierId, warehouseId: o.warehouseId, expectedDate: o.expectedDate, subtotal: o.subtotal, discountTotal: o.discountTotal,
    freight: o.freight, insurance: o.insurance ?? 0, ipiTotal: o.ipiTotal ?? 0, otherExpenses: o.otherExpenses, total: o.total, purpose: o.purpose ?? null, paymentTermId: o.paymentTermId, paymentTermsText: o.paymentTermsText, installmentsPlan: o.installmentsPlan, notes: o.notes,
  });
  return { ...pick(order), items: items.map((i) => ({ skuId: i.skuId, description: i.description, unitCode: i.unitCode, qty: i.qty, unitCost: i.unitCost, discount: i.discount, ipi: i.ipi ?? 0, total: i.total })) };
}

export async function revisionMode(store: Store, companyId: string): Promise<"always" | "relevant" | "never"> {
  const { activePolicy } = await import("./approvals");
  const p = await activePolicy(store, companyId);
  return (p?.reviewOnRevision as any) || (await getSetting(store, companyId, null, "purchase.revisionRequiresReview", "relevant"));
}

/**
 * Edita o pedido. Rascunho/ajuste: edição direta. Aprovado/enviado: cria revisão formal
 * (purchase_order_revisions) e, conforme a política, devolve para nova análise.
 */
export async function updateOrder(ctx: Ctx, id: string, input: OrderInput & { revisionReason?: string | null }) {
  requirePerm(ctx, "purchases", "edit");
  const before = await getOrderForWrite(ctx, id);
  const status = before.status as OrderStatus;
  const revising = REVISABLE.includes(status);
  if (!EDITABLE.includes(status) && !revising) throw new BusinessError(`Pedido ${ORDER_STATUS_LABEL[status]} não pode ser alterado.`, "invalid_state");
  if (revising) {
    assert(input.revisionReason?.trim(), "Informe o motivo da revisão (alteração após aprovação).");
    assert(input.supplierId === before.supplierId, "Após a aprovação o fornecedor não pode ser trocado — cancele e crie outro pedido.");
    const receivedAny = (await orderItems(ctx.store, id)).some((i) => (i.receivedQty ?? 0) > 0);
    assert(!receivedAny, "Pedido com recebimento registrado não pode ser revisado.");
    // confirmação de recebimento em andamento/interrompida (saldo do pedido ainda não atualizado)
    const rec = (await receiptsHoldingOrder(ctx.store, id, ["confirming", "confirmed"]))[0];
    if (rec) throw new BusinessError(`Pedido com recebimento registrado não pode ser revisado: o recebimento nº ${rec.number} está ${rec.status === "confirming" ? "em confirmação — conclua-o em Compras → Recebimentos" : "confirmado"}.`, "invalid_state");
  }
  const supplier = await ctx.store.getOrThrow("suppliers", input.supplierId);
  assert(supplier.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  if (EDITABLE.includes(status) && supplier.id !== before.supplierId) assertSupplierUsable(supplier);
  const items = await normalizeItems(ctx, supplier.id, input.items);
  const totals = computeOrderTotals({ items, headerDiscount: input.headerDiscount, freight: input.freight, insurance: input.insurance, otherExpenses: input.otherExpenses });
  const { plan, termName } = await resolvePlan(ctx, totals.total, input);
  const warehouseId = input.warehouseId || before.warehouseId;
  const wh = await ctx.store.getOrThrow("warehouses", warehouseId);
  assert(wh.branchId === before.branchId, "O depósito de entrega deve ser da filial do pedido.");
  const prevSnapshot = await snapshotOf(ctx.store, before);
  const oldItems = await orderItems(ctx.store, id);
  const skuCodes = (await Promise.all(items.map((i) => ctx.store.get("skus", i.skuId)))).map((k) => k?.sku ?? "");
  const header = headerData(supplier, totals, input, plan, termName, before.number, { buyerName: input.buyerId ? (await ctx.store.get("users", input.buyerId))?.name ?? null : null, skuCodes });
  const afterView = { total: totals.total, paymentTermsText: header.paymentTermsText, items: totals.items };
  const mode = revising ? await revisionMode(ctx.store, ctx.companyId) : "never";
  const needsReview = revising && (mode === "always" || (mode === "relevant" && isRelevantChange(prevSnapshot, afterView)));
  const newRevision = revising ? (before.revision ?? 1) + 1 : before.revision ?? 1;
  const skuDocs = new Map<string, Doc>();
  for (const it of items) skuDocs.set(it.skuId, (await ctx.store.get("skus", it.skuId))!);
  const rows = itemRows(ctx, before.branchId, id, totals);
  const keepIds = new Set(rows.map((r) => r.id));
  // gravações dos itens: remove os que saíram, cria os novos e só atualiza os que mudaram
  const oldById = new Map(oldItems.map((o) => [o.id, o]));
  const toDelete = oldItems.filter((o) => !keepIds.has(o.id));
  const itemWrites: Array<{ kind: "create" | "update"; id: string; data: Record<string, any> }> = [];
  for (const r of rows) {
    const data = { ...r.data, productId: skuDocs.get(r.data.skuId)?.productId ?? null };
    const old = oldById.get(r.id);
    if (!old) {
      itemWrites.push({ kind: "create", id: r.id, data });
      continue;
    }
    const { companyId: _c, createdBy: _u, orderId: _o, receivedQty: _r, ...patch } = data;
    if (Object.entries(patch).some(([k, v]) => (old[k] ?? null) !== (v ?? null))) itemWrites.push({ kind: "update", id: r.id, data: patch });
  }
  const writes = (revising ? 1 : 0) + 1 + toDelete.length + itemWrites.length;
  if (writes > TX_MAX_WRITES) {
    throw new BusinessError(`Alteração grande demais para um único salvamento: ${writes} gravações (o limite por operação é ${TX_MAX_WRITES}). Salve primeiro as remoções de itens e, depois, as inclusões.`, "too_many_changes");
  }
  await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      if (revising) {
        await t.create(
          "purchase_order_revisions",
          { companyId: ctx.companyId, branchId: before.branchId, createdBy: ctx.user.id, orderId: id, revision: before.revision ?? 1, snapshot: prevSnapshot, reason: input.revisionReason, requiresReview: needsReview },
          detId("porev", id, String(before.revision ?? 1)),
        );
      }
      await t.update("purchase_orders", id, {
        ...header,
        warehouseId,
        revision: newRevision,
        ...(needsReview ? { status: "in_review" } : {}),
        ...(revising && !needsReview ? { approvedRevision: newRevision } : {}),
      });
      for (const o of toDelete) await t.delete("purchase_order_items", o.id);
      for (const w of itemWrites) {
        if (w.kind === "update") await t.update("purchase_order_items", w.id, w.data);
        else await t.create("purchase_order_items", w.data, w.id);
      }
    }),
  );
  await audit(ctx, {
    module: "purchases",
    action: revising ? "purchase_order.revision" : "purchase_order.update",
    entityType: "purchase_order",
    entityId: id,
    summary: revising
      ? `Pedido nº ${before.number}: revisão ${newRevision} criada (${formatMoney(prevSnapshot.total)} → ${formatMoney(totals.total)}) — ${needsReview ? "volta para análise conforme política" : "dispensada de nova análise pela política"}`
      : `Pedido nº ${before.number} alterado (${formatMoney(prevSnapshot.total)} → ${formatMoney(totals.total)})`,
    before: { total: prevSnapshot.total, items: prevSnapshot.items.length, revision: before.revision },
    after: { total: totals.total, items: items.length, revision: newRevision, policyMode: revising ? mode : undefined },
    reason: input.revisionReason ?? null,
    related: [`supplier:${supplier.id}`],
  });
  if (needsReview) {
    const { submitForApproval } = await import("./approvals");
    await submitForApproval(ctx, [id], { origin: "revision", notes: `Revisão ${newRevision}: ${input.revisionReason}`, skipStateCheck: true });
  }
  return { order: await ctx.store.getOrThrow("purchase_orders", id), revised: revising, needsReview, mode };
}

export interface OrderStatusOpts {
  summary?: (o: Doc) => string;
  reason?: string | null;
  action?: string;
}

/** Pedidos (já lidos) que mudam de estado para `to`, validando a máquina de estados — sem gravar. */
export function planOrdersStatus(orders: Doc[], to: OrderStatus) {
  const changes: Doc[] = [];
  for (const o of orders) {
    if (o.status === to && to !== "sent") continue;
    assertTransition(o.status, to);
    changes.push(o);
  }
  return changes;
}

/** Efeitos posteriores à gravação da mudança de estado: pendências resolvidas na origem e auditoria. */
export async function afterOrdersStatus(ctx: Ctx, changed: Doc[], to: OrderStatus, opts: OrderStatusOpts = {}) {
  for (const o of changed) {
    // pendências de acompanhamento deixam de existir na origem
    if (to === "sent" || to === "cancelled") await resolveOccurrence(ctx.store, `po_unsent:${o.id}`);
    if (["received", "cancelled"].includes(to)) await resolveOccurrence(ctx.store, `po_late:${o.id}`);
    await audit(ctx, {
      module: "purchases",
      action: opts.action ?? `purchase_order.${to}`,
      entityType: "purchase_order",
      entityId: o.id,
      summary: opts.summary?.(o) ?? `Pedido nº ${o.number}: ${ORDER_STATUS_LABEL[o.status as OrderStatus]} → ${ORDER_STATUS_LABEL[to]}`,
      before: { status: o.status },
      after: { status: to },
      reason: opts.reason ?? null,
      related: [`supplier:${o.supplierId}`, ...(o.requestId ? [`purchase_request:${o.requestId}`] : [])],
    });
  }
}

/** Atualiza o estado de um conjunto de pedidos aplicando a máquina de estados. */
export async function setOrdersStatus(ctx: Ctx, orderIds: string[], to: OrderStatus, patch: Record<string, any> = {}, opts: OrderStatusOpts = {}) {
  const updated: Doc[] = [];
  for (const id of orderIds) {
    const o = await getOrder(ctx, id);
    if (!planOrdersStatus([o], to).length) {
      updated.push(o);
      continue;
    }
    const u = await ctx.store.update("purchase_orders", id, { status: to, ...patch });
    updated.push(u);
    await afterOrdersStatus(ctx, [o], to, opts);
  }
  return updated;
}

export async function cancelOrder(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "purchases", "edit");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  const o = await getOrderForWrite(ctx, id);
  // sem mercadoria recebida nem recebimento em conferência/confirmação (a confirmação interrompida ainda não
  // atualizou o saldo do pedido, mas vai lançar estoque e título ao ser retomada)
  const assertCancellable = async () => {
    const items = await orderItems(ctx.store, id);
    assert(!items.some((i) => (i.receivedQty ?? 0) > 0), "Pedido com recebimento não pode ser cancelado — use Encerrar saldo.");
    const rec = (await receiptsHoldingOrder(ctx.store, id))[0];
    if (!rec) return;
    if (rec.status === "draft") throw new BusinessError(`Há recebimento em conferência (nº ${rec.number}) vinculado a este pedido. Cancele-o (ou desmarque o pedido nele) antes.`, "invalid_state");
    if (rec.status === "confirming") throw new BusinessError(`O recebimento nº ${rec.number} deste pedido está em confirmação (ou teve a confirmação interrompida) e vai lançar a mercadoria no estoque: o pedido não pode ser cancelado. Conclua a confirmação em Compras → Recebimentos e, se o restante não for entregue, use Encerrar saldo.`, "invalid_state");
    throw new BusinessError(`Pedido com recebimento (nº ${rec.number}) não pode ser cancelado — use Encerrar saldo.`, "invalid_state");
  };
  await assertCancellable();
  const statusOpts: OrderStatusOpts = { reason, summary: () => `Pedido nº ${o.number} cancelado` };
  // pedido de uma solicitação: cancelamento + recálculo da solicitação disputam a vaga da decisão (decisão
  // concorrente que leu o pedido em análise não o "ressuscita" como aprovado); a conclusão de recebimento disputa a
  // mesma vaga, e a cada nova tentativa o cancelamento revalida os recebimentos
  const viaRequest = o.requestId ? await (await import("./approvals")).changeOrderInRequest(ctx, o.requestId, id, "cancelled", { cancelledAt: nowIso() }, { kind: "purchase.order_cancel", validate: assertCancellable }) : null;
  if (viaRequest) {
    await afterOrdersStatus(ctx, viaRequest.changed, "cancelled", statusOpts);
    if (viaRequest.requestCancelled) await (await import("./approvals")).afterRequestCancelled(ctx, viaRequest.req);
  } else await setOrdersStatus(ctx, [id], "cancelled", { cancelledAt: nowIso() }, statusOpts);
  return ctx.store.getOrThrow("purchase_orders", id);
}

/** Encerra o saldo pendente de um pedido parcialmente recebido (fornecedor não entregará o restante). */
export async function closeOrderBalance(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "purchases", "edit");
  assert(reason?.trim(), "Informe o motivo do encerramento do saldo.");
  const o = await getOrderForWrite(ctx, id);
  assert(o.status === "partial", "Somente pedidos parcialmente recebidos podem ter o saldo encerrado.");
  const items = await orderItems(ctx.store, id);
  const pending = items.reduce((a, i) => a + remainingQty(i), 0);
  await setOrdersStatus(ctx, [id], "received", { notes: [o.notes, `Saldo encerrado em ${today()}: ${reason}`].filter(Boolean).join("\n"), originData: { ...(o.originData ?? {}), closedShort: { at: nowIso(), by: ctx.user.name, reason, pendingQty: pending } } }, { reason, summary: () => `Pedido nº ${o.number}: saldo pendente encerrado (${formatQty(pending)} un. não serão recebidas)` });
}

// ───────────────────────────── Envio ao fornecedor

export function orderNeedsSending(o: Doc) {
  if (o.status === "approved") return true;
  if (o.status === "sent") return (o.sentInfo?.revision ?? o.revision) < (o.revision ?? 1);
  return false;
}

export function orderEmailHtml(o: Doc, items: Doc[], company: Doc | null, branch: Doc | null) {
  const rows = items
    .map((i) => `<tr><td>${i.supplierCode ?? ""}</td><td>${i.description}</td><td style="text-align:right">${formatQty(i.qty)} ${i.unitCode ?? ""}</td><td style="text-align:right">${formatMoney(i.unitCost)}</td><td style="text-align:right">${formatMoney(i.discount)}</td><td style="text-align:right">${formatMoney(i.total)}</td></tr>`)
    .join("");
  const addr = branch?.address ? `${branch.address.street ?? ""}, ${branch.address.number ?? ""} — ${branch.address.district ?? ""}, ${branch.address.cityName ?? ""}/${branch.address.uf ?? ""}` : "";
  return `<div style="font-family:Arial,sans-serif;font-size:13px;color:#0f172a">
<h2 style="margin:0 0 8px">Pedido de compra nº ${o.number} (revisão ${o.revision ?? 1})</h2>
<p>${company?.name ?? ""} — CNPJ ${branch?.cnpj ?? company?.cnpj ?? ""}<br/>Entrega: ${branch?.name ?? ""} ${addr}<br/>Previsão de entrega: ${o.expectedDate ?? "a combinar"}</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #cbd5e1" border="1"><thead><tr><th>Cód. fornecedor</th><th>Produto</th><th>Qtd.</th><th>Custo unit.</th><th>Desconto</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
<p>Subtotal: ${formatMoney(o.subtotal)} · Descontos: ${formatMoney(o.discountTotal)}${o.ipiTotal ? ` · IPI: ${formatMoney(o.ipiTotal)}` : ""} · Frete: ${formatMoney(o.freight)}${o.insurance ? ` · Seguro: ${formatMoney(o.insurance)}` : ""} · Outras despesas: ${formatMoney(o.otherExpenses)}<br/><b>Total: ${formatMoney(o.total)}</b><br/>Condição de pagamento: ${o.paymentTermsText ?? "—"}</p>
${o.notes ? `<p>Observações: ${String(o.notes).replace(/</g, "&lt;")}</p>` : ""}
<p style="color:#64748b">Favor confirmar o recebimento deste pedido respondendo a este e-mail.</p></div>`;
}

/**
 * Registra o envio do pedido ao fornecedor. Manual: identificado (canal, contato, data).
 * E-mail: só marca como enviado se o provedor aceitar a mensagem (resultado real de sendEmail).
 */
export async function registerOrderSent(ctx: Ctx, id: string, input: { method: "manual" | "email"; channel?: string | null; contact?: string | null; to?: string | null; sentDate?: string | null; notes?: string | null }) {
  requirePerm(ctx, "purchases", "edit");
  const o = await getOrderForWrite(ctx, id);
  assert(orderNeedsSending(o), o.status === "sent" ? "O pedido já foi enviado nesta revisão." : `Pedido ${ORDER_STATUS_LABEL[o.status as OrderStatus]} não pode ser enviado — é preciso estar aprovado.`);
  let info: Record<string, any>;
  if (input.method === "email") {
    const to = input.to?.trim();
    assert(to && /.+@.+\..+/.test(to), "Informe o e-mail do fornecedor.");
    const items = await orderItems(ctx.store, id);
    const company = await ctx.store.get("companies", ctx.companyId);
    const branch = o.branchId ? await ctx.store.get("branches", o.branchId) : null;
    const res = await sendEmail(ctx.companyId, { to, subject: `Pedido de compra nº ${o.number} — ${company?.tradeName ?? company?.name ?? ""}`, html: orderEmailHtml(o, items, company, branch) });
    if (!res.delivered) {
      await audit(ctx, { module: "purchases", action: "purchase_order.send_failed", entityType: "purchase_order", entityId: id, summary: `Falha ao enviar pedido nº ${o.number} por e-mail para ${to}: ${res.message ?? res.channel}`, result: "failure" });
      throw new BusinessError(`E-mail não enviado (${res.channel}): ${res.message ?? "sem detalhes"}. O pedido continua aprovado; registre o envio manual ou configure o canal de e-mail em Administração → Integrações.`, "email_failed");
    }
    info = { method: "email", channel: res.channel, to, at: nowIso(), by: ctx.user.name, byId: ctx.user.id, revision: o.revision ?? 1, notes: input.notes ?? null };
  } else {
    assert(input.channel?.trim(), "Informe o canal do envio (ex.: WhatsApp, telefone, portal do fornecedor).");
    assert(input.contact?.trim(), "Informe a pessoa de contato no fornecedor.");
    info = { method: "manual", channel: input.channel!.trim(), contact: input.contact!.trim(), at: input.sentDate ? `${input.sentDate}T12:00:00.000Z` : nowIso(), by: ctx.user.name, byId: ctx.user.id, revision: o.revision ?? 1, notes: input.notes ?? null };
  }
  const sentPatch = { sentAt: info.at, sentMethod: input.method, sentInfo: info };
  const statusOpts: OrderStatusOpts = {
    action: "purchase_order.sent",
    summary: () => `Pedido nº ${o.number} (rev. ${o.revision ?? 1}) enviado ao fornecedor ${input.method === "email" ? `por e-mail para ${info.to} (${info.channel})` : `via ${info.channel}, contato ${info.contact}`}`,
  };
  // pedido de uma solicitação: o registro do envio disputa a vaga da decisão (revogação concorrente da
  // aprovação não devolve para análise um pedido já enviado, e o envio relê o pedido se a revogação vencer)
  const notSendable = (cur: Doc) => {
    const why = cur.status === "sent" ? `O pedido nº ${cur.number} já foi enviado nesta revisão.` : `O pedido nº ${cur.number} não está mais aprovado (situação atual: ${ORDER_STATUS_LABEL[cur.status as OrderStatus] ?? cur.status}) — a aprovação foi revista enquanto o envio era registrado; atualize a página.`;
    return input.method === "email" ? `${why} Atenção: o e-mail já foi enviado para ${info.to} — avise o fornecedor para desconsiderá-lo.` : why;
  };
  const viaRequest = o.requestId
    ? await (await import("./approvals")).changeOrderInRequest(ctx, o.requestId, id, "sent", sentPatch, {
        kind: "purchase.order_sent",
        validate: (cur) => {
          if (!orderNeedsSending(cur)) throw new BusinessError(notSendable(cur), "invalid_state");
        },
      })
    : null;
  if (viaRequest) await afterOrdersStatus(ctx, viaRequest.changed, "sent", statusOpts);
  else await setOrdersStatus(ctx, [id], "sent", sentPatch, statusOpts);
  return ctx.store.getOrThrow("purchase_orders", id);
}

// ───────────────────────────── Recebimento → saldo do pedido

/**
 * Recalcula quantidades recebidas a partir dos recebimentos CONFIRMADOS (determinístico e idempotente)
 * e ajusta o estado: parcialmente recebido / recebido.
 */
export async function refreshOrderReceipts(ctx: Ctx, orderId: string) {
  const order = await ctx.store.getOrThrow("purchase_orders", orderId);
  const items = await orderItems(ctx.store, orderId);
  const receipts = await listAll(ctx.store, "receipts", { filters: [["contains", "orderIds", orderId], ["eq", "status", "confirmed"]] });
  const received = new Map<string, number>();
  for (const r of receipts) for (const it of r.items ?? []) for (const al of it.allocations ?? []) if (al.orderId === orderId) received.set(al.orderItemId, (received.get(al.orderItemId) ?? 0) + al.qty);
  let receivedValue = 0;
  for (const it of items) {
    const q = received.get(it.id) ?? 0;
    if (q !== (it.receivedQty ?? 0)) await ctx.store.update("purchase_order_items", it.id, { receivedQty: q });
    receivedValue += it.qty > 0 ? Math.round((it.total * Math.min(q, it.qty)) / it.qty) : 0;
    it.receivedQty = q;
  }
  const anyReceived = items.some((i) => (i.receivedQty ?? 0) > 0);
  const allReceived = items.every((i) => (i.receivedQty ?? 0) >= i.qty);
  let status = order.status as OrderStatus;
  if (["approved", "sent", "partial"].includes(status)) {
    if (allReceived) status = "received";
    else if (anyReceived) status = "partial";
  }
  if (status !== order.status) await setOrdersStatus(ctx, [orderId], status, { receivedValue }, { summary: () => `Pedido nº ${order.number}: ${status === "received" ? "recebido integralmente" : "recebimento parcial registrado"}` });
  else if (receivedValue !== (order.receivedValue ?? 0)) await ctx.store.update("purchase_orders", orderId, { receivedValue });
  return { status, receivedValue, items };
}

/** Resumo de saldo do pedido (para telas e testes). */
export async function orderBalance(store: Store, orderId: string) {
  const items = await orderItems(store, orderId);
  return items.map((i) => ({ skuId: i.skuId, ordered: i.qty, received: i.receivedQty ?? 0, remaining: remainingQty(i) }));
}

export function expectedDateFrom(leadTimeDays: number | null | undefined, base = today()) {
  return addDays(base, Math.max(0, leadTimeDays ?? 0));
}

void requireAction;

// ───────────────────────────── Orçamento mensal de compras

/**
 * Orçamento mensal de compras da filial (parâmetro purchase.monthlyBudget, em centavos; 0 = não controlado).
 * Consumido = total dos pedidos da filial aprovados no mês (aprovado/enviado/parcial/recebido) + pedidos em análise.
 */
export async function purchaseBudget(store: Store, companyId: string, branchId: string, ref = today()) {
  const limit = Number(await getSetting(store, companyId, branchId, "purchase.monthlyBudget", 0)) || 0;
  const month = ref.slice(0, 7);
  const orders = await listAll(store, "purchase_orders", { filters: [["eq", "companyId", companyId], ["eq", "branchId", branchId], ["eq", "status", ["approved", "sent", "partial", "received", "in_review"]]] });
  let approved = 0;
  let inReview = 0;
  for (const o of orders) {
    if (o.status === "in_review") inReview += o.total;
    else if ((o.approvedAt ?? "").slice(0, 7) === month) approved += o.total;
  }
  return { limit, month, approved, inReview, consumed: approved + inReview, remaining: limit ? limit - approved - inReview : null };
}
