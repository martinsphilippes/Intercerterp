import { detId, findOne, isConflict, listAll, retryOnConflict, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting } from "@/lib/core/settings";
import { saveFile } from "@/lib/core/files";
import { onlyDigits, searchable } from "@/lib/core/text";
import { addDays, nowIso, toLocalDate, today } from "@/lib/dates";
import { allocate, formatMoney, formatQty, lineTotal, roundDiv, QTY } from "@/lib/money";
import { buildSchedule, createTitle } from "./finance";
import { defaultWarehouse, postMovements } from "./stock";
import { parseNfeXml, nfeKeyIsValid, type ParsedNfe } from "./nfe-xml";
import { CONFIRMED, ORDER_STATUS_LABEL, netUnitCost } from "./purchase-calc";
import { orderItems, refreshOrderReceipts, remainingQty } from "./purchases";
import { occupyDecisionSlots } from "./approvals";
import { createSupplier, findSupplierByDoc, supplierLabel } from "./suppliers";

/**
 * Recebimento de mercadorias (Tela 29).
 *  - Importação real de XML de NF-e (upload) ou chave + itens dos pedidos (sem XML).
 *  - Mesma chave/XML não duplica: índice único `receipts.scopeKey` = empresa|nfe|chave. O id do registro vem
 *    do número (não da chave): cancelar muda o scopeKey e a mesma NF-e pode ser importada de novo.
 *  - NF-e denegada é recusada; de homologação (sem valor fiscal) só em empresa de demonstração; XML sem
 *    protocolo de autorização só é confirmado com justificativa.
 *  - Sem XML: IPI e desconto geral do pedido proporcionais ao alocado; frete/seguro/outras despesas do pedido
 *    cobrados uma única vez (marcador por pedido na confirmação). O total faturado informado é comparado ao
 *    devido (tolerância `purchase.receiptValueTolerance`, padrão 0) e a divergência exige justificativa.
 *  - Escritas exigem a filial do recebimento (contexto consolidado é somente consulta).
 *  - Mapeamento código do fornecedor (cProd) → SKU interno, aprendido em `supplier_products`.
 *  - Comparação previsto (saldo do pedido) × faturado (XML) × recebido (conferência).
 *  - Confirmação: entrada de estoque (custo médio com frete/despesas rateados), atualização de custo
 *    (supplier_products.lastCost, skus.costAcquisition + price_history), saldo do(s) pedido(s) e UM
 *    título a pagar com as parcelas (duplicatas do XML ou condição de pagamento).
 *  - Valor devido = Σ (recebido × custo) − desconto + frete + outras despesas. Os títulos nunca excedem
 *    o devido, salvo divergência registrada com a decisão "pagar o valor faturado" e justificativa.
 */

export interface ReceiptItem {
  idx: number;
  nItem?: number | null;
  cProd?: string | null;
  cEAN?: string | null;
  xProd?: string | null;
  uCom?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  /** quantidade faturada na unidade do fornecedor (milésimos) */
  invoicedQtySupplier?: number | null;
  /** milésimos da unidade interna por unidade do fornecedor (1000 = 1:1) */
  conversionFactor: number;
  invoicedQty: number;
  invoicedValue: number;
  invoiceUnitCost: number;
  skuId: string | null;
  sku?: string | null;
  description: string;
  unitCode?: string | null;
  mapping?: "supplier_code" | "barcode" | "order" | "manual" | null;
  expectedQty: number;
  orderUnitCost?: number | null;
  receivedQty: number;
  unitCost: number;
  ignore?: boolean;
  divergence?: string | null;
  /** conferência física concluída para o item */
  checked?: boolean;
  lot?: string | null;
  expiry?: string | null;
  allocations?: Array<{ orderId: string; orderItemId: string; orderNumber: number; qty: number }>;
  lineValue?: number;
  freightShare?: number;
  otherShare?: number;
  discountShare?: number;
  landedUnitCost?: number;
}

export interface Divergence {
  kind: "qty" | "price" | "not_ordered" | "over_order" | "value" | "unmapped" | "recipient" | "note" | "installments";
  idx?: number;
  skuId?: string | null;
  message: string;
}

export const RECEIPT_STATUS: Record<string, string> = { draft: "Em conferência", confirming: "Confirmando", confirmed: "Confirmado", cancelled: "Cancelado" };

/** Efeitos da entrada (marcáveis na conferência). Desmarcar exige justificativa nas observações. */
export interface ReceiptEffects {
  updateStock: boolean;
  updateCost: boolean;
  createPayable: boolean;
}
export const DEFAULT_EFFECTS: ReceiptEffects = { updateStock: true, updateCost: true, createPayable: true };
export const effectsOf = (r: Record<string, any>): ReceiptEffects => ({ ...DEFAULT_EFFECTS, ...(r.effects ?? {}) });

/** Situação do item na conferência: Confere / Divergência / Pendente / Não estocado. */
export function receiptItemStatus(it: ReceiptItem, divergences: Divergence[], confirmed = false): "ok" | "divergence" | "pending" | "ignored" {
  if (it.ignore) return "ignored";
  if (!it.skuId || (!it.checked && !confirmed)) return "pending";
  return divergences.some((d) => d.idx === it.idx) ? "divergence" : "ok";
}

/**
 * Correspondência NF-e × pedido (0–100%): por item, 1 quando o produto está no pedido com o mesmo custo e
 * quantidade dentro do saldo; 0,5 quando está no pedido com custo ou quantidade diferentes; 0 fora do pedido.
 */
export function orderMatchRate(items: ReceiptItem[]) {
  const act = items.filter((i) => !i.ignore);
  if (!act.length) return 0;
  let sc = 0;
  for (const it of act) {
    if (!it.skuId || !it.expectedQty) continue;
    const priceOk = it.orderUnitCost == null || it.orderUnitCost === it.invoiceUnitCost;
    const qtyOk = it.invoicedQty <= it.expectedQty;
    sc += priceOk && qtyOk ? 1 : 0.5;
  }
  return Math.round((sc / act.length) * 100);
}

const scopeFor = (companyId: string, key: string) => `${companyId}|nfe|${key}`;

export async function getReceipt(ctx: Ctx, id: string) {
  const r = await ctx.store.getOrThrow("receipts", id);
  assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
  return r;
}

/** Escrita no recebimento: exige filial definida (não consolidado) e que o recebimento seja da filial ativa. */
async function getReceiptForWrite(ctx: Ctx, id: string) {
  const branchId = requireBranch(ctx);
  const r = await getReceipt(ctx, id);
  if (r.branchId !== branchId) throw new BusinessError(`Recebimento nº ${r.number} é de outra filial: selecione a filial do recebimento para conferir, confirmar ou cancelar.`, "other_branch");
  return r;
}

/**
 * Marcador de cobrança única do frete/seguro/outras despesas do pedido: gravado pelo recebimento sem XML que
 * CONFIRMA a cobrança (na passagem para "confirmando"; vale quem confirmar primeiro). Só vale enquanto o dono está
 * ativo e vinculado ao pedido: cancelar o recebimento ou desvincular o pedido antes da confirmação o libera.
 */
const chargesMarkerId = (orderId: string) => detId("po-charges", orderId);

/** Libera o marcador de cobrança do pedido se ele (ainda) pertencer ao recebimento indicado. */
async function releaseChargesMarker(store: Store, orderId: string, receiptId: string | null) {
  const m = await store.get("operations", chargesMarkerId(orderId));
  if (!m || (m.result?.receiptId ?? null) !== receiptId) return false;
  await store.delete("operations", m.id);
  return true;
}

/**
 * Marcador de cobrança vigente do pedido. Marcador de recebimento cancelado ou que não está mais vinculado ao pedido
 * (estado de versão anterior ou de concorrência entre conferência e conclusão) não vale e é liberado aqui.
 */
async function liveChargesMarker(store: Store, orderId: string) {
  const m = await store.get("operations", chargesMarkerId(orderId));
  if (!m) return null;
  const ownerId: string | null = m.result?.receiptId ?? null;
  const owner = ownerId ? await store.get("receipts", ownerId) : null;
  if (owner && owner.status !== "cancelled" && (owner.orderIds ?? []).includes(orderId)) return m;
  await releaseChargesMarker(store, orderId, ownerId);
  return null;
}

/**
 * Frete/seguro/outras despesas do pedido já cobrados por OUTRO recebimento:
 *  - marcador de cobrança vigente de outro recebimento (o que confirmou a cobrança);
 *  - recebimento com XML vinculado ao pedido (a nota traz o próprio frete);
 *  - recebimento sem XML confirmando/confirmado que os assumiu (registro anterior ao marcador) ou com encargos
 *    informados pelo usuário (substituem os do pedido).
 * Entrega parcial confirmada SEM esses encargos não conta: o próximo recebimento confirmado do pedido os assume.
 * `pendingClaims` (prévia na abertura de um recebimento): conta também o rascunho sem XML que já os assumiu — na
 * confirmação, porém, vale quem confirmar primeiro.
 */
async function orderChargesTaken(store: Store, orderId: string, selfId: string | null, pendingClaims = false) {
  const m = await liveChargesMarker(store, orderId);
  if (m) return m.result?.receiptId !== selfId;
  const others = (await listAll(store, "receipts", { filters: [["contains", "orderIds", orderId], ["eq", "status", ["draft", "confirming", "confirmed"]]] })).filter((x) => x.id !== selfId);
  return others.some((x) => {
    if (x.xmlFileId) return true;
    const claims = (x.orderCharges?.claimed ?? []).includes(orderId);
    if (x.status === "draft") return pendingClaims && claims;
    const informed = !x.orderCharges || x.orderCharges.auto === false;
    return claims || (informed && (x.freight ?? 0) + (x.otherExpenses ?? 0) > 0);
  });
}

/** Situações de pedido aceitas num recebimento já vinculado (recebido = sem saldo, não aloca nada). */
const LINKABLE = [...CONFIRMED, "received"];

export async function findReceiptByKey(store: Store, companyId: string, key: string) {
  return findOne(store, "receipts", [["eq", "scopeKey", scopeFor(companyId, onlyDigits(key))]]);
}

function requireReceive(ctx: Ctx) {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.receive");
}

/** Pedidos em aberto do fornecedor na filial (aprovado/enviado/parcial). */
export async function openOrdersFor(store: Store, companyId: string, supplierId: string, branchId: string) {
  return listAll(store, "purchase_orders", { filters: [["eq", "companyId", companyId], ["eq", "supplierId", supplierId], ["eq", "branchId", branchId], ["eq", "status", CONFIRMED]], orderBy: [{ field: "number" }] });
}

async function orderLines(store: Store, orderIds: string[], companyId: string) {
  const out: Array<Doc & { order: Doc; remaining: number; netUnit: number }> = [];
  for (const id of [...new Set(orderIds)]) {
    const o = await store.get("purchase_orders", id);
    if (!o || o.companyId !== companyId) continue;
    for (const it of await orderItems(store, id)) out.push({ ...it, order: o, remaining: remainingQty(it), netUnit: netUnitCost(it) });
  }
  return out.sort((a, b) => a.order.number - b.order.number || a.seq - b.seq);
}

/** Mapeia item da NF-e para SKU: vínculo do fornecedor (cProd) → código de barras (cEAN) → item único de pedido. */
async function mapXmlItem(store: Store, companyId: string, supplierId: string | null, it: ParsedNfe["items"][number], lines: Awaited<ReturnType<typeof orderLines>>) {
  if (supplierId && it.cProd) {
    const sp = await findOne(store, "supplier_products", [["eq", "supplierId", supplierId], ["eq", "supplierCode", it.cProd]]);
    if (sp) return { skuId: sp.skuId as string, mapping: "supplier_code" as const, conversionFactor: sp.conversionFactor || QTY };
  }
  if (it.cEAN) {
    const sku = await findOne(store, "skus", [["eq", "companyId", companyId], ["eq", "barcode", it.cEAN]]);
    if (sku) return { skuId: sku.id, mapping: "barcode" as const, conversionFactor: QTY };
  }
  const byCode = lines.filter((l) => l.supplierCode && l.supplierCode === it.cProd);
  if (byCode.length) return { skuId: byCode[0].skuId as string, mapping: "order" as const, conversionFactor: QTY };
  return { skuId: null, mapping: null, conversionFactor: QTY };
}

// ───────────────────────────── Cálculo da conferência (puro sobre o documento)

export interface ReceiptComputation {
  items: ReceiptItem[];
  productsTotal: number;
  dueTotal: number;
  divergences: Divergence[];
}

/**
 * Recalcula expectativa (saldo dos pedidos), alocação por pedido (FIFO pelo número), rateio de frete,
 * outras despesas e desconto pelo valor recebido, custo de entrada e divergências.
 */
export function computeReceipt(r: { items: ReceiptItem[]; freight: number; otherExpenses: number; discount: number; invoicedTotal?: number | null; hasXml: boolean; valueTolerance?: number }, lines:Array<{ id: string; skuId: string; remaining: number; netUnit: number; order: { id: string; number: number }; qty?: number; unitCost?: number; discount?: number | null }>): ReceiptComputation {
  const pool = new Map<string, Array<{ id: string; remaining: number; netUnit: number; order: { id: string; number: number }; qty?: number; unitCost?: number; discount?: number | null }>>();
  for (const l of lines) pool.set(l.skuId, [...(pool.get(l.skuId) ?? []), { ...l }]);
  const divergences: Divergence[] = [];
  const items = r.items.map((it) => ({ ...it }));
  // sem XML: valor exato da linha do pedido (líquido do desconto da linha) proporcional ao alocado, por
  // arredondamento acumulado — recebimentos parciais somam exatamente o líquido da linha (sem o
  // arredondamento do custo unitário líquido, ex.: 3 × R$ 10,00 − R$ 1,00 = R$ 29,00, não 3 × R$ 9,67)
  const exactValue = new Map<number, number | null>();
  for (const it of items) {
    it.allocations = [];
    if (it.ignore) continue;
    if (!it.skuId) {
      if (it.receivedQty > 0) divergences.push({ kind: "unmapped", idx: it.idx, message: `Item ${it.cProd ?? ""} ${it.xProd ?? it.description}: associe a um produto interno.` });
      continue;
    }
    const avail = pool.get(it.skuId) ?? [];
    it.expectedQty = avail.reduce((a, l) => a + l.remaining, 0);
    it.orderUnitCost = avail[0]?.netUnit ?? null;
    let left = it.receivedQty;
    let exact: number | null = 0;
    for (const l of avail) {
      if (left <= 0) break;
      const q = Math.min(left, l.remaining);
      if (q <= 0) continue;
      it.allocations.push({ orderId: l.order.id, orderItemId: l.id, orderNumber: l.order.number, qty: q });
      if (exact != null && l.qty && l.qty > 0 && l.unitCost != null && l.netUnit === it.unitCost) {
        const net = lineTotal(l.unitCost, l.qty) - Math.max(0, l.discount ?? 0);
        const before = Math.max(0, l.qty - l.remaining);
        exact += roundDiv(net * Math.min(l.qty, before + q), l.qty) - roundDiv(net * Math.min(l.qty, before), l.qty);
      } else exact = null;
      l.remaining -= q;
      left -= q;
    }
    exactValue.set(it.idx, !r.hasXml && left === 0 && it.allocations.length ? exact : null);
    if (!avail.length && lines.length) divergences.push({ kind: "not_ordered", idx: it.idx, skuId: it.skuId, message: `${it.description}: não consta nos pedidos relacionados.` });
    else if (left > 0 && lines.length) divergences.push({ kind: "over_order", idx: it.idx, skuId: it.skuId, message: `${it.description}: recebido ${formatQty(left)} acima do saldo do pedido.` });
    if (r.hasXml && it.receivedQty !== it.invoicedQty) divergences.push({ kind: "qty", idx: it.idx, skuId: it.skuId, message: `${it.description}: recebido ${formatQty(it.receivedQty)} × faturado ${formatQty(it.invoicedQty)}.` });
    if (!r.hasXml && it.expectedQty && it.receivedQty < it.expectedQty) divergences.push({ kind: "qty", idx: it.idx, skuId: it.skuId, message: `${it.description}: recebido ${formatQty(it.receivedQty)} de ${formatQty(it.expectedQty)} previstos (saldo continua no pedido).` });
    if (it.orderUnitCost != null && it.unitCost !== it.orderUnitCost) divergences.push({ kind: "price", idx: it.idx, skuId: it.skuId, message: `${it.description}: custo ${formatMoney(it.unitCost)} × pedido ${formatMoney(it.orderUnitCost)}.` });
    if (it.divergence?.trim()) divergences.push({ kind: "note", idx: it.idx, skuId: it.skuId, message: `${it.description}: ${it.divergence.trim()}` });
  }
  // valor de cada linha recebida: usa o valor exato faturado quando quantidade e custo coincidem
  const active = items.filter((it) => !it.ignore && it.skuId && it.receivedQty > 0);
  for (const it of items) it.lineValue = 0;
  for (const it of active) {
    const sameAsInvoice = it.receivedQty === it.invoicedQty && it.unitCost === it.invoiceUnitCost && it.invoicedValue > 0;
    const exact = exactValue.get(it.idx);
    it.lineValue = r.hasXml && sameAsInvoice ? it.invoicedValue : exact != null ? exact : sameAsInvoice ? it.invoicedValue : lineTotal(it.unitCost, it.receivedQty);
  }
  const productsTotal = active.reduce((a, it) => a + (it.lineValue ?? 0), 0);
  const weights = active.map((it) => it.lineValue ?? 0);
  const fr = allocate(r.freight, weights);
  const ot = allocate(r.otherExpenses, weights);
  const dc = allocate(Math.min(r.discount, productsTotal), weights);
  active.forEach((it, i) => {
    it.freightShare = fr[i] ?? 0;
    it.otherShare = ot[i] ?? 0;
    it.discountShare = dc[i] ?? 0;
    const landed = (it.lineValue ?? 0) + it.freightShare + it.otherShare - it.discountShare;
    it.landedUnitCost = roundDiv(landed * QTY, it.receivedQty);
  });
  const dueTotal = productsTotal - Math.min(r.discount, productsTotal) + r.freight + r.otherExpenses;
  if (r.invoicedTotal != null && Math.abs(r.invoicedTotal - dueTotal) > Math.max(0, r.valueTolerance ?? 0)) divergences.push({ kind: "value", message: `Valor faturado ${formatMoney(r.invoicedTotal)} × valor devido pelo recebido ${formatMoney(dueTotal)} (diferença ${formatMoney(r.invoicedTotal - dueTotal)}).` });
  return { items, productsTotal, dueTotal, divergences };
}

export interface OrderChargeLine {
  id: string;
  qty: number;
  unitCost: number;
  discount?: number | null;
  ipi?: number | null;
  order: { id: string; number: number; freight?: number | null; insurance?: number | null; otherExpenses?: number | null; discountTotal?: number | null };
}

/**
 * Encargos do pedido num recebimento SEM XML (o documento do fornecedor não informa os totais):
 *  - IPI de cada linha, proporcional à quantidade alocada à linha (IPI × alocado ÷ pedido);
 *  - desconto geral do pedido (desconto total − descontos das linhas), proporcional ao valor líquido alocado
 *    em relação ao valor líquido das linhas do pedido;
 *  - frete, seguro e outras despesas do pedido: integrais, uma única vez, somente nos pedidos `claimed`
 *    (o recebimento que "assumiu" esses encargos — ver createManualReceipt/confirmReceipt).
 * Resultado no formato do recebimento: frete; outras despesas = outras + seguro + IPI; desconto = desconto geral.
 */
export function orderChargesFor(items: Array<Pick<ReceiptItem, "allocations">>, lines: OrderChargeLine[], claimed: string[]) {
  const byItem = new Map(lines.map((l) => [l.id, l]));
  const orders = new Map<string, OrderChargeLine["order"]>();
  const netByOrder = new Map<string, number>();
  const lineDiscByOrder = new Map<string, number>();
  for (const l of lines) {
    orders.set(l.order.id, l.order);
    const disc = Math.max(0, l.discount ?? 0);
    netByOrder.set(l.order.id, (netByOrder.get(l.order.id) ?? 0) + lineTotal(l.unitCost, l.qty) - disc);
    lineDiscByOrder.set(l.order.id, (lineDiscByOrder.get(l.order.id) ?? 0) + disc);
  }
  let ipi = 0;
  const allocNet = new Map<string, number>();
  for (const it of items) {
    for (const al of it.allocations ?? []) {
      const l = byItem.get(al.orderItemId);
      if (!l || !(l.qty > 0)) continue;
      ipi += roundDiv(Math.max(0, l.ipi ?? 0) * al.qty, l.qty);
      allocNet.set(al.orderId, (allocNet.get(al.orderId) ?? 0) + roundDiv((lineTotal(l.unitCost, l.qty) - Math.max(0, l.discount ?? 0)) * al.qty, l.qty));
    }
  }
  let discount = 0;
  for (const [oid, o] of orders) {
    const header = Math.max(0, (o.discountTotal ?? 0) - (lineDiscByOrder.get(oid) ?? 0));
    const net = netByOrder.get(oid) ?? 0;
    if (header > 0 && net > 0) discount += roundDiv(header * Math.min(allocNet.get(oid) ?? 0, net), net);
  }
  let freight = 0;
  let insurance = 0;
  let other = 0;
  for (const oid of new Set(claimed)) {
    const o = orders.get(oid);
    if (!o) continue;
    freight += Math.max(0, o.freight ?? 0);
    insurance += Math.max(0, o.insurance ?? 0);
    other += Math.max(0, o.otherExpenses ?? 0);
  }
  return { freight, insurance, ipi, discount, otherExpenses: other + insurance + ipi };
}

/** Parcelas do título: duplicatas do XML (reescalonadas ao valor a pagar, se preciso) ou condição de pagamento. */
export function buildReceiptInstallments(amount: number, dups: Array<{ nDup?: string; dVenc: string; vDup: number }>, term: { installments: number; firstDueDays: number; intervalDays: number } | null, baseDate: string) {
  if (amount <= 0) return { installments: [], source: "none" as const, rescaled: false };
  if (dups.length) {
    const sum = dups.reduce((a, d) => a + d.vDup, 0);
    if (sum === amount) return { installments: dups.map((d, i) => ({ number: i + 1, dueDate: d.dVenc, amount: d.vDup, ref: d.nDup ?? null })), source: "xml" as const, rescaled: false };
    const parts = allocate(amount, dups.map((d) => d.vDup));
    return { installments: dups.map((d, i) => ({ number: i + 1, dueDate: d.dVenc, amount: parts[i], ref: d.nDup ?? null })).filter((x) => x.amount > 0), source: "xml" as const, rescaled: true };
  }
  return { installments: buildSchedule(amount, term, baseDate).map((x, i) => ({ number: i + 1, dueDate: x.dueDate, amount: x.amount, ref: null })), source: "term" as const, rescaled: false };
}

/** Valor a pagar conforme a decisão sobre a diferença faturado × devido. */
export function payableAmount(r: { dueTotal: number; invoicedTotal?: number | null; differenceAction?: string | null }) {
  if (r.differenceAction === "pay_invoiced" && r.invoicedTotal != null) return r.invoicedTotal;
  return r.dueTotal;
}

/** Tolerância (centavos) entre o total faturado e o valor devido antes de registrar divergência de valor. */
async function valueTolerance(ctx: Ctx, branchId: string | null) {
  return Math.max(0, Math.round(Number(await getSetting(ctx.store, ctx.companyId, branchId, "purchase.receiptValueTolerance", 0)) || 0));
}

async function recompute(ctx: Ctx, r: Doc, patch: Record<string, any> = {}) {
  const merged = { ...r, ...patch };
  const hasXml = Boolean(merged.xmlFileId);
  const lines = await orderLines(ctx.store, merged.orderIds ?? [], ctx.companyId);
  // o total faturado é comparado ao devido também sem XML (valor informado na conferência)
  const input = { items: merged.items ?? [], freight: merged.freight ?? 0, otherExpenses: merged.otherExpenses ?? 0, discount: merged.discount ?? 0, invoicedTotal: merged.invoicedTotal ?? null, hasXml, valueTolerance: await valueTolerance(ctx, merged.branchId ?? null) };
  let comp = computeReceipt(input, lines as any);
  // sem XML e sem ajuste manual: frete/despesas/IPI/desconto geral vêm do pedido, proporcionais ao alocado
  const charges: Record<string, number> = {};
  if (!hasXml && merged.orderCharges && merged.orderCharges.auto !== false) {
    const c = orderChargesFor(comp.items, lines as any, (merged.orderCharges.claimed ?? []).filter((oid: string) => (merged.orderIds ?? []).includes(oid)));
    Object.assign(charges, { freight: c.freight, otherExpenses: c.otherExpenses, discount: c.discount });
    comp = computeReceipt({ ...input, ...charges }, lines as any);
  }
  const term = merged.paymentTermId ? await ctx.store.get("payment_terms", merged.paymentTermId) : null;
  const amount = effectsOf(merged).createPayable ? payableAmount({ dueTotal: comp.dueTotal, invoicedTotal: merged.invoicedTotal, differenceAction: merged.differenceAction }) : 0;
  const base = merged.nfeIssueDate ? toLocalDate(merged.nfeIssueDate) : today();
  const inst = buildReceiptInstallments(amount, merged.emitter?.duplicatas ?? [], term ? { installments: term.installments, firstDueDays: term.firstDueDays, intervalDays: term.intervalDays } : null, base);
  const divergences = [...comp.divergences];
  if (inst.rescaled) divergences.push({ kind: "installments", message: `Duplicatas do XML somam ${formatMoney((merged.emitter?.duplicatas ?? []).reduce((a: number, d: any) => a + d.vDup, 0))}; parcelas ajustadas ao valor a pagar ${formatMoney(amount)} mantendo os vencimentos.` });
  if (merged.recipientMismatch) divergences.push({ kind: "recipient", message: merged.recipientMismatch });
  return {
    ...charges,
    items: comp.items,
    productsTotal: comp.productsTotal,
    dueTotal: comp.dueTotal,
    total: comp.dueTotal,
    installments: inst.installments.map((x) => ({ ...x, source: inst.source })),
    divergences,
    payable: amount,
  };
}

// ───────────────────────────── Criação

async function companyCnpjs(store: Store, companyId: string) {
  const c = await store.get("companies", companyId);
  const bs = await listAll(store, "branches", { filters: [["eq", "companyId", companyId]] });
  return new Set([c?.cnpj, ...bs.map((b) => b.cnpj)].filter(Boolean).map((x) => onlyDigits(x)));
}

/** Importa XML de NF-e: cria o recebimento em conferência (ou devolve o existente para a mesma chave). */
export async function importNfeXml(ctx: Ctx, input: { xml: string; fileName?: string | null; warehouseId?: string | null; orderIds?: string[] | null; createSupplier?: boolean; allowHomologation?: boolean }) {
  requireReceive(ctx);
  const branchId = requireBranch(ctx);
  const nfe = parseNfeXml(input.xml);
  const protocolInfo = nfe.protocolStatus ? `cStat ${nfe.protocolStatus}${nfe.protocolMessage ? ` – ${nfe.protocolMessage}` : ""}` : null;
  if (nfe.denied) throw new BusinessError(`NF-e ${nfe.number} com uso DENEGADO pela SEFAZ (${protocolInfo}). Ela não pode ser recebida — solicite ao fornecedor a regularização.`, "nfe_denied");
  // homologação = sem valor fiscal: só em empresa de demonstração (ou quando explicitamente permitido)
  let homologationAccepted = false;
  if (nfe.environment === "homologacao") {
    const company = await ctx.store.get("companies", ctx.companyId);
    homologationAccepted = Boolean(input.allowHomologation || company?.isDemo);
    if (!homologationAccepted) throw new BusinessError(`NF-e ${nfe.number} emitida em ambiente de HOMOLOGAÇÃO (sem valor fiscal). Solicite ao fornecedor o XML autorizado em produção.`, "homologation");
  }
  const existing = await findReceiptByKey(ctx.store, ctx.companyId, nfe.key);
  if (existing) throw new BusinessError(`Esta NF-e (chave ${nfe.key}) já foi importada no recebimento nº ${existing.number}.`, "duplicate", { id: existing.id });
  const ours = await companyCnpjs(ctx.store, ctx.companyId);
  const destDoc = onlyDigits(nfe.recipient.cnpj ?? nfe.recipient.cpf ?? "");
  const recipientMismatch = destDoc && !ours.has(destDoc) ? `NF-e destinada a outro CNPJ (${destDoc}).` : null;
  if (recipientMismatch) throw new BusinessError(`${recipientMismatch} Confira se a nota é desta empresa.`, "recipient");
  const emitterDoc = nfe.emitter.cnpj ?? nfe.emitter.cpf;
  assert(emitterDoc, "Emitente sem CNPJ/CPF no XML.");
  let supplier = await findSupplierByDoc(ctx.store, ctx.companyId, emitterDoc);
  if (!supplier) {
    if (input.createSupplier === false) throw new BusinessError(`Fornecedor ${nfe.emitter.name} (${emitterDoc}) não cadastrado.`, "supplier_missing");
    if (!ctx.user.isAdmin && !ctx.user.permissions?.suppliers?.create) throw new BusinessError(`Fornecedor ${nfe.emitter.name} (CNPJ ${emitterDoc}) não está cadastrado e seu perfil não permite cadastrar fornecedores. Peça o cadastro em Compras → Fornecedores e importe o XML novamente.`, "supplier_missing");
    try {
      supplier = await createSupplier(
        ctx,
        { personType: nfe.emitter.cnpj ? "PJ" : "PF", doc: emitterDoc, name: nfe.emitter.name, tradeName: nfe.emitter.tradeName, ie: nfe.emitter.ie, addresses: [{ type: "principal", ...Object.fromEntries(Object.entries(nfe.emitter.address).map(([k, v]) => [k, v ?? undefined])) }], status: "active" },
        { source: `a partir do XML da NF-e ${nfe.number}` },
      );
    } catch (e) {
      // outra importação do mesmo emitente cadastrou o fornecedor ao mesmo tempo (índice único do documento)
      const again = e instanceof BusinessError && e.code === "duplicate" ? await findSupplierByDoc(ctx.store, ctx.companyId, emitterDoc) : null;
      if (!again) throw e;
      supplier = again;
    }
  }
  assert(supplier.status !== "inactive", `Fornecedor ${supplierLabel(supplier)} está inativo — reative antes de receber.`);
  let orderIds: string[];
  if (input.orderIds?.length) {
    // pedidos escolhidos no formulário: mesmas regras do recebimento sem XML (empresa, emitente, filial e situação)
    orderIds = [...new Set(input.orderIds.filter(Boolean))];
    for (const oid of orderIds) {
      const o = await ctx.store.get("purchase_orders", oid);
      assert(o && o.companyId === ctx.companyId, "Pedido inválido para este recebimento.");
      assert(o.supplierId === supplier.id, `Pedido nº ${o.number} é de outro fornecedor (a NF-e foi emitida por ${supplierLabel(supplier)}).`);
      assert(o.branchId === branchId, `Pedido nº ${o.number} é de outra filial.`);
      assert(CONFIRMED.includes(o.status), `Pedido nº ${o.number} não está aprovado/enviado (situação atual: ${ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status}).`);
    }
  } else orderIds = (await openOrdersFor(ctx.store, ctx.companyId, supplier.id, branchId)).map((o) => o.id);
  const lines = await orderLines(ctx.store, orderIds, ctx.companyId);
  const items: ReceiptItem[] = [];
  for (const [i, it] of nfe.items.entries()) {
    const m = await mapXmlItem(ctx.store, ctx.companyId, supplier.id, it, lines);
    const invoicedQty = roundDiv(it.qCom * m.conversionFactor, QTY);
    const net = it.vProd - it.vDesc;
    const sku = m.skuId ? await ctx.store.get("skus", m.skuId) : null;
    const unit = invoicedQty > 0 ? roundDiv(net * QTY, invoicedQty) : 0;
    items.push({
      idx: i + 1, nItem: it.nItem, cProd: it.cProd, cEAN: it.cEAN, xProd: it.xProd, uCom: it.uCom, ncm: it.ncm, cfop: it.cfop, invoicedQtySupplier: it.qCom, conversionFactor: m.conversionFactor,
      invoicedQty, invoicedValue: net, invoiceUnitCost: unit, skuId: m.skuId, sku: sku?.sku ?? null, description: sku?.name ?? it.xProd, unitCode: sku?.unitCode ?? it.uCom, mapping: m.mapping,
      expectedQty: 0, receivedQty: invoicedQty, unitCost: unit, ignore: false, divergence: null,
    });
  }
  // só mantém pedidos que compartilham algum produto com a nota
  const skuSet = new Set(items.map((i) => i.skuId).filter(Boolean));
  const relevant = orderIds.filter((id) => lines.some((l) => l.order.id === id && skuSet.has(l.skuId)));
  const warehouseId = input.warehouseId || (relevant[0] ? lines.find((l) => l.order.id === relevant[0])?.order.warehouseId : null) || (await defaultWarehouse(ctx.store, branchId)).id;
  const firstOrder = relevant[0] ? lines.find((l) => l.order.id === relevant[0])?.order : null;
  const number = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  const hash = sha256(Buffer.from(input.xml));
  const otherExpenses = nfe.totals.vOutro + nfe.totals.vIPI + nfe.totals.vST + nfe.totals.vSeg;
  const base = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId, supplierId: supplier.id, orderIds: relevant, nfeKey: nfe.key, nfeNumber: nfe.number, nfeSeries: nfe.series,
    nfeIssueDate: nfe.issueDate ? new Date(nfe.issueDate).toISOString() : null, xmlHash: hash, status: "draft", items, freight: nfe.totals.vFrete, otherExpenses, discount: 0, invoicedTotal: nfe.totals.vNF,
    paymentTermId: firstOrder?.paymentTermId ?? supplier.paymentTermId ?? null,
    emitter: { ...nfe.emitter, duplicatas: nfe.duplicatas, protocol: nfe.protocol, authorized: nfe.authorized, environment: nfe.environment, protocolStatus: nfe.protocolStatus, protocolMessage: nfe.protocolMessage, homologationAccepted, nature: nfe.nature, totals: nfe.totals },
    differenceAction: "adjust_to_due", notes: null, scopeKey: scopeFor(ctx.companyId, nfe.key), searchText: searchable(String(number), nfe.number, nfe.key, supplier.name, supplier.tradeName),
    ...(await financialDefaults(ctx, firstOrder ?? null, nfe.emitter.address?.uf ?? null)),
  };
  const draft = { ...base, xmlFileId: "pending" } as any;
  const calc = await recompute(ctx, draft);
  let r: Doc;
  try {
    // id pelo número (único na empresa); a deduplicação da chave ativa é o índice único scopeKey,
    // que o cancelamento libera — a mesma NF-e pode ser importada de novo depois de cancelada
    r = await ctx.store.create("receipts", { ...base, ...omit(calc, "payable") }, detId("receipt", ctx.companyId, String(number)));
  } catch (e) {
    if (isConflict(e)) {
      const ex = await findReceiptByKey(ctx.store, ctx.companyId, nfe.key);
      throw new BusinessError(`Esta NF-e já foi importada${ex ? ` no recebimento nº ${ex.number}` : ""}.`, "duplicate", { id: ex?.id });
    }
    throw e;
  }
  const file = await saveFile(ctx, { bucket: "documents", name: input.fileName || `NFe${nfe.key}.xml`, mime: "application/xml", data: Buffer.from(input.xml), entityType: "receipt", entityId: r.id, kind: "nfe_xml" });
  r = await ctx.store.update("receipts", r.id, { xmlFileId: file.id });
  await audit(ctx, {
    module: "purchases", action: "receipt.import_xml", entityType: "receipt", entityId: r.id,
    summary: `Recebimento nº ${number}: XML da NF-e ${nfe.number}/${nfe.series} de ${supplierLabel(supplier)} importado (${items.length} itens, ${formatMoney(nfe.totals.vNF)}); ${items.filter((i) => !i.skuId).length} item(ns) sem associação${nfe.environment === "homologacao" ? " — ambiente de HOMOLOGAÇÃO (sem valor fiscal)" : ""}${nfe.authorized ? "" : ` — sem protocolo de autorização${protocolInfo ? ` (${protocolInfo})` : ""}`}`,
    related: [`supplier:${supplier.id}`, ...relevant.map((o) => `purchase_order:${o}`)],
  });
  return r;
}

/** Padrões fiscais/financeiros da entrada: CFOP (1102 interna / 2102 interestadual), plano de contas, centro de custo e forma de pagamento do pedido. */
async function financialDefaults(ctx: Ctx, order: Doc | null, emitterUf: string | null) {
  const branch = ctx.branchId ? await ctx.store.get("branches", ctx.branchId) : null;
  const interstate = emitterUf && branch?.uf && emitterUf !== branch.uf;
  return {
    entryCfop: interstate ? "2102" : "1102",
    categoryId: (await getSetting<string | null>(ctx.store, ctx.companyId, null, "finance.category.purchases", null)) ?? null,
    costCenterId: order?.costCenterId ?? null,
    paymentMethodId: order?.paymentMethodId ?? null,
    effects: DEFAULT_EFFECTS,
  };
}

function omit<T extends Record<string, any>>(o: T, ...keys: string[]) {
  const out: Record<string, any> = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

/** Recebimento sem XML (chave/nota informadas manualmente, itens a partir do saldo dos pedidos). */
export async function createManualReceipt(ctx: Ctx, input: { supplierId: string; orderIds: string[]; nfeKey?: string | null; nfeNumber?: string | null; nfeSeries?: string | null; issueDate?: string | null; warehouseId?: string | null; invoicedTotal?: number | null; idemKey: string }) {
  requireReceive(ctx);
  const branchId = requireBranch(ctx);
  const supplier = await ctx.store.getOrThrow("suppliers", input.supplierId);
  assert(supplier.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  const key = onlyDigits(input.nfeKey);
  if (key) {
    assert(nfeKeyIsValid(key), "Chave de acesso inválida (44 dígitos com dígito verificador).");
    const ex = await findReceiptByKey(ctx.store, ctx.companyId, key);
    if (ex) throw new BusinessError(`Chave já registrada no recebimento nº ${ex.number}.`, "duplicate", { id: ex.id });
    assert(key.slice(6, 20) === onlyDigits(supplier.doc).padStart(14, "0"), "A chave informada não pertence ao CNPJ deste fornecedor.");
  }
  const scopeKey = key ? scopeFor(ctx.companyId, key) : `${ctx.companyId}|manual|${input.idemKey}`;
  const existing = await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
  if (existing) return existing;
  const orderIds = [...new Set((input.orderIds ?? []).filter(Boolean))];
  const orders = await Promise.all(orderIds.map((id) => ctx.store.getOrThrow("purchase_orders", id)));
  for (const o of orders) {
    assert(o.companyId === ctx.companyId, "Pedido de outra empresa.");
    assert(o.supplierId === supplier.id, `Pedido nº ${o.number} é de outro fornecedor.`);
    assert(CONFIRMED.includes(o.status), `Pedido nº ${o.number} não está aprovado/enviado (situação atual: ${o.status}).`);
    assert(o.branchId === branchId, `Pedido nº ${o.number} é de outra filial.`);
  }
  const lines = await orderLines(ctx.store, orderIds, ctx.companyId);
  const bySku = new Map<string, { qty: number; value: number; netUnit: number; description: string; unitCode: string; sku: string | null; supplierCode: string | null }>();
  for (const l of lines) {
    if (l.remaining <= 0) continue;
    // valor exato do saldo da linha (líquido da linha − parte já recebida), sem arredondar pelo custo unitário líquido
    const net = lineTotal(l.unitCost, l.qty) - Math.max(0, l.discount ?? 0);
    const value = l.qty > 0 ? net - roundDiv(net * Math.min(l.qty, l.qty - l.remaining), l.qty) : lineTotal(l.netUnit, l.remaining);
    const cur = bySku.get(l.skuId);
    if (cur) {
      cur.qty += l.remaining;
      cur.value += value;
    } else bySku.set(l.skuId, { qty: l.remaining, value, netUnit: l.netUnit, description: l.description, unitCode: l.unitCode, sku: (await ctx.store.get("skus", l.skuId))?.sku ?? null, supplierCode: l.supplierCode ?? null });
  }
  const items: ReceiptItem[] = [...bySku.entries()].map(([skuId, v], i) => ({
    idx: i + 1, cProd: v.supplierCode, conversionFactor: QTY, invoicedQty: v.qty, invoicedValue: v.value, invoiceUnitCost: v.netUnit, skuId, sku: v.sku, description: v.description, unitCode: v.unitCode,
    mapping: "order", expectedQty: v.qty, receivedQty: v.qty, unitCost: v.netUnit, ignore: false, divergence: null,
  }));
  assert(items.length || !orders.length, "Os pedidos selecionados não têm saldo a receber.");
  const number = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  // frete/seguro/outras despesas do pedido são cobrados uma única vez: entram na prévia quando nenhum recebimento
  // os cobrou (entregas parciais confirmadas sem eles não contam) e nenhum outro rascunho já os assumiu.
  // A confirmação registra a cobrança (marcador por pedido; vale quem confirmar primeiro).
  const claimed: string[] = [];
  for (const o of orders) if (!(await orderChargesTaken(ctx.store, o.id, null, true))) claimed.push(o.id);
  const base = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId: input.warehouseId || orders[0]?.warehouseId || (await defaultWarehouse(ctx.store, branchId)).id, supplierId: supplier.id,
    orderIds, nfeKey: key || null, nfeNumber: input.nfeNumber || (key ? String(Number(key.slice(25, 34))) : null), nfeSeries: input.nfeSeries || (key ? String(Number(key.slice(22, 25))) : null),
    nfeIssueDate: input.issueDate ? `${input.issueDate}T12:00:00.000Z` : null, xmlFileId: null, xmlHash: null, status: "draft", items, freight: 0, otherExpenses: 0, discount: 0,
    // encargos calculados a partir do pedido (IPI, desconto geral, frete/seguro/outras) até o usuário ajustar
    orderCharges: { auto: true, claimed },
    invoicedTotal: input.invoicedTotal ?? null, paymentTermId: orders[0]?.paymentTermId ?? supplier.paymentTermId ?? null, emitter: { cnpj: supplier.doc, name: supplier.name, tradeName: supplier.tradeName, duplicatas: [] },
    differenceAction: "adjust_to_due", notes: null, scopeKey, searchText: searchable(String(number), input.nfeNumber, key, supplier.name, supplier.tradeName),
    ...(await financialDefaults(ctx, orders[0] ?? null, supplier.addresses?.[0]?.uf ?? null)),
  };
  const calc = await recompute(ctx, base as any);
  let r: Doc;
  try {
    r = await ctx.store.create("receipts", { ...base, ...omit(calc, "payable") }, detId("receipt", ctx.companyId, String(number)));
  } catch (e) {
    if (isConflict(e)) {
      const ex = await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
      if (ex && !key) return ex;
      throw new BusinessError(`Chave já registrada${ex ? ` no recebimento nº ${ex.number}` : ""}.`, "duplicate", { id: ex?.id });
    }
    throw e;
  }
  await audit(ctx, { module: "purchases", action: "receipt.create", entityType: "receipt", entityId: r.id, summary: `Recebimento nº ${number} aberto sem XML${key ? ` (chave ${key})` : ""} — ${supplierLabel(supplier)}, ${items.length} item(ns) do saldo de ${orders.length} pedido(s), devido ${formatMoney(r.dueTotal)}${orders.some((o) => !claimed.includes(o.id) && (o.freight ?? 0) + (o.insurance ?? 0) + (o.otherExpenses ?? 0) > 0) ? " (frete/seguro/despesas já cobrados ou assumidos por outro recebimento não são cobrados de novo)" : ""}`, related: [`supplier:${supplier.id}`, ...orderIds.map((o) => `purchase_order:${o}`)] });
  return r;
}

/**
 * Busca o XML pela chave somente se houver integração capaz (Focus NFe — NF-e recebidas/manifestação
 * com token configurado). Sem integração, devolve a orientação de importar o arquivo XML.
 */
export async function fetchXmlByKey(ctx: Ctx, key: string): Promise<{ ok: true; xml: string } | { ok: false; message: string }> {
  const k = onlyDigits(key);
  if (!nfeKeyIsValid(k)) return { ok: false, message: "Chave de acesso inválida (44 dígitos com dígito verificador)." };
  const branchId = requireBranch(ctx);
  const cfg = await ctx.store.get("fiscal_configs", detId("fiscalcfg", `${ctx.companyId}|${branchId}`));
  if (!cfg || cfg.provider !== "focusnfe") return { ok: false, message: "Nenhuma integração capaz de baixar XML pela chave está configurada (requer Focus NFe com manifestação do destinatário). Importe o arquivo XML recebido do fornecedor." };
  // vínculo de credencial com nome não permitido (ex.: variável do sistema) nunca é lido
  const { fiscalTokenRefProblem } = await import("./integrations");
  const refProblem = fiscalTokenRefProblem(cfg.tokenRef || "FOCUSNFE_TOKEN");
  if (refProblem) return { ok: false, message: `Integração Focus NFe com vínculo de credencial inválido: ${refProblem} Importe o arquivo XML.` };
  const token = process.env[cfg.tokenRef || "FOCUSNFE_TOKEN"];
  if (!token) return { ok: false, message: `Integração Focus NFe sem credencial (${cfg.tokenRef || "FOCUSNFE_TOKEN"}). Importe o arquivo XML.` };
  const base = cfg.environment === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";
  try {
    const res = await fetch(`${base}/v2/nfes_recebidas/${k}.xml`, { headers: { Authorization: "Basic " + Buffer.from(`${token}:`).toString("base64") }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (!res.ok) return { ok: false, message: `Focus NFe respondeu HTTP ${res.status}: ${text.slice(0, 200)}. Importe o arquivo XML.` };
    return { ok: true, xml: text };
  } catch (e: any) {
    return { ok: false, message: `Falha ao consultar a Focus NFe (${e.message}). Importe o arquivo XML.` };
  }
}

// ───────────────────────────── Conferência

export interface ReceiptUpdate {
  items?: Array<{ idx: number; skuId?: string | null; receivedQty?: number; unitCost?: number; conversionFactor?: number; divergence?: string | null; ignore?: boolean; checked?: boolean; lot?: string | null; expiry?: string | null }>;
  /** marca todos os itens como conferidos */
  checkAll?: boolean;
  entryCfop?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  paymentMethodId?: string | null;
  effects?: Partial<ReceiptEffects>;
  orderIds?: string[];
  warehouseId?: string | null;
  freight?: number;
  otherExpenses?: number;
  discount?: number;
  paymentTermId?: string | null;
  differenceAction?: "adjust_to_due" | "pay_invoiced";
  notes?: string | null;
  invoicedTotal?: number | null;
  /**
   * Frete/outras despesas/desconto EXIBIDOS no formulário quando ele foi carregado. Sem XML, os encargos só
   * deixam de ser calculados pelo pedido quando o usuário altera um desses valores em relação ao exibido
   * (um formulário desatualizado — ex.: após erro na conclusão — reenvia os valores antigos sem que isso
   * seja edição). Sem este campo (chamada direta), compara com os valores gravados.
   */
  chargesShown?: { freight: number; otherExpenses: number; discount: number } | null;
  /** sem XML: volta a calcular frete/seguro/outras despesas/IPI/desconto geral pelo pedido (descarta os informados) */
  chargesAuto?: boolean;
  /** sem XML, encargos informados: confirma que o frete/despesas informados são nova cobrança do fornecedor, mesmo com os encargos do pedido já cobrados em outro recebimento */
  chargesLostAck?: boolean;
}

export async function updateReceipt(ctx: Ctx, id: string, input: ReceiptUpdate) {
  requireReceive(ctx);
  const r = await getReceiptForWrite(ctx, id);
  assert(r.status === "draft", "Recebimento já confirmado não pode ser alterado.");
  const items: ReceiptItem[] = (r.items ?? []).map((x: ReceiptItem) => ({ ...x }));
  for (const u of input.items ?? []) {
    const it = items.find((x) => x.idx === u.idx);
    if (!it) continue;
    if (u.skuId !== undefined && u.skuId !== it.skuId) {
      const sku = u.skuId ? await ctx.store.get("skus", u.skuId) : null;
      if (u.skuId) assert(sku && sku.companyId === ctx.companyId, "Produto inválido.");
      it.skuId = u.skuId || null;
      it.sku = sku?.sku ?? null;
      it.description = sku?.name ?? it.xProd ?? it.description;
      it.unitCode = sku?.unitCode ?? it.uCom ?? it.unitCode;
      it.mapping = u.skuId ? "manual" : null;
    }
    if (u.conversionFactor != null && u.conversionFactor !== it.conversionFactor && it.invoicedQtySupplier != null) {
      assert(u.conversionFactor > 0, "Fator de conversão deve ser maior que zero.");
      it.conversionFactor = u.conversionFactor;
      it.invoicedQty = roundDiv(it.invoicedQtySupplier * u.conversionFactor, QTY);
      it.invoiceUnitCost = it.invoicedQty > 0 ? roundDiv(it.invoicedValue * QTY, it.invoicedQty) : 0;
      if (u.receivedQty == null) it.receivedQty = it.invoicedQty;
      if (u.unitCost == null) it.unitCost = it.invoiceUnitCost;
    }
    if (u.receivedQty != null) {
      assert(Number.isInteger(u.receivedQty) && u.receivedQty >= 0, "Quantidade recebida inválida.");
      it.receivedQty = u.receivedQty;
    }
    if (u.unitCost != null) {
      assert(Number.isInteger(u.unitCost) && u.unitCost >= 0, "Custo unitário inválido.");
      it.unitCost = u.unitCost;
    }
    if (u.divergence !== undefined) it.divergence = u.divergence?.trim() || null;
    if (u.ignore !== undefined) it.ignore = Boolean(u.ignore);
    if (u.checked !== undefined) it.checked = Boolean(u.checked);
    if (u.lot !== undefined) it.lot = u.lot?.trim() || null;
    if (u.expiry !== undefined) it.expiry = u.expiry || null;
  }
  if (input.checkAll) for (const it of items) if (!it.ignore) it.checked = true;
  const orderIds: string[] = [...new Set<string>((input.orderIds ?? r.orderIds ?? []).filter(Boolean))];
  for (const oid of orderIds) {
    const o = await ctx.store.getOrThrow("purchase_orders", oid);
    assert(o.companyId === ctx.companyId, "Pedido de outra empresa.");
    assert(o.supplierId === r.supplierId, `Pedido nº ${o.number} é de outro fornecedor.`);
    assert(o.branchId === r.branchId, `Pedido nº ${o.number} é de outra filial.`);
    // novo vínculo: só pedido aprovado/enviado/parcial; vínculo existente: também recebido (sem saldo), nunca rascunho/análise/cancelado
    const linked = (r.orderIds ?? []).includes(oid);
    assert((linked ? LINKABLE : CONFIRMED).includes(o.status), `Pedido nº ${o.number} está ${ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status} — ${linked ? "desmarque-o em “Pedidos relacionados” ou aguarde a nova aprovação" : "somente pedidos aprovados/enviados podem ser vinculados"}.`);
  }
  if (input.warehouseId) {
    const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
    assert(wh.branchId === r.branchId, "Depósito de outra filial.");
  }
  for (const [k, v] of [["Frete", input.freight], ["Outras despesas", input.otherExpenses], ["Desconto", input.discount]] as const) assert(v == null || (Number.isInteger(v) && v >= 0), `${k} inválido.`);
  // sem XML: ao alterar frete/despesas/desconto, os encargos deixam de ser calculados pelo pedido (valores informados).
  // "Alterar" = diferente do que o formulário exibia ao ser carregado (não do gravado: a gravação pode ter
  // recalculado os encargos depois que o formulário foi aberto, ex.: conclusão interrompida por pendência).
  const shown = input.chargesShown ?? { freight: r.freight ?? 0, otherExpenses: r.otherExpenses ?? 0, discount: r.discount ?? 0 };
  const chargesTouched = (input.freight != null && input.freight !== shown.freight) || (input.otherExpenses != null && input.otherExpenses !== shown.otherExpenses) || (input.discount != null && input.discount !== shown.discount);
  let orderCharges: Record<string, any> | null = null;
  if (!r.xmlFileId && r.orderCharges) {
    const wasAuto = r.orderCharges.auto !== false;
    if (input.chargesAuto) orderCharges = { ...r.orderCharges, auto: true, lostAck: false };
    else if (wasAuto && chargesTouched) orderCharges = { ...r.orderCharges, auto: false, lostAck: Boolean(input.chargesLostAck) };
    else if (!wasAuto && input.chargesLostAck !== undefined) orderCharges = { ...r.orderCharges, lostAck: Boolean(input.chargesLostAck) };
  }
  // pedido desvinculado: deixa de ter os encargos assumidos por este recebimento (o marcador é liberado após gravar)
  const unlinked = (r.orderIds ?? []).filter((oid: string) => !orderIds.includes(oid));
  if (!r.xmlFileId && r.orderCharges && unlinked.length) {
    const cur = orderCharges ?? r.orderCharges;
    orderCharges = { ...cur, claimed: (cur.claimed ?? []).filter((oid: string) => orderIds.includes(oid)), lost: (cur.lost ?? []).filter((l: any) => orderIds.includes(l.orderId)) };
  }
  // encargos calculados pelo pedido: os valores de frete/despesas/desconto enviados pelo formulário não valem
  const autoAfter = !r.xmlFileId && Boolean(r.orderCharges) && (orderCharges ?? r.orderCharges).auto !== false;
  const keepCharges = !autoAfter;
  const patch: Record<string, any> = {
    ...(orderCharges ? { orderCharges } : {}),
    items,
    orderIds,
    ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
    ...(keepCharges && input.freight != null ? { freight: input.freight } : {}),
    ...(keepCharges && input.otherExpenses != null ? { otherExpenses: input.otherExpenses } : {}),
    ...(keepCharges && input.discount != null ? { discount: input.discount } : {}),
    ...(input.paymentTermId !== undefined ? { paymentTermId: input.paymentTermId || null } : {}),
    ...(input.differenceAction ? { differenceAction: input.differenceAction } : {}),
    ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    ...(input.invoicedTotal !== undefined && !r.xmlFileId ? { invoicedTotal: input.invoicedTotal } : {}),
    ...(input.entryCfop !== undefined ? { entryCfop: input.entryCfop?.trim() || null } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId || null } : {}),
    ...(input.costCenterId !== undefined ? { costCenterId: input.costCenterId || null } : {}),
    ...(input.paymentMethodId !== undefined ? { paymentMethodId: input.paymentMethodId || null } : {}),
    ...(input.effects ? { effects: { ...effectsOf(r), ...input.effects } } : {}),
  };
  const calc = await recompute(ctx, r, patch);
  const u = await ctx.store.update("receipts", id, { ...patch, ...omit(calc, "payable") });
  // encargos de pedido desvinculado cobrados por este recebimento (conclusão interrompida para revisão) ficam livres
  // para o próximo recebimento do pedido
  for (const oid of unlinked) await releaseChargesMarker(ctx.store, oid, id);
  await audit(ctx, { module: "purchases", action: "receipt.update", entityType: "receipt", entityId: id, summary: `Recebimento nº ${r.number}: conferência atualizada (devido ${formatMoney(calc.dueTotal)}, ${calc.divergences.length} divergência(s))` });
  return u;
}

export async function cancelReceipt(ctx: Ctx, id: string, reason: string) {
  requireReceive(ctx);
  assert(reason?.trim(), "Informe o motivo.");
  const r = await getReceiptForWrite(ctx, id);
  assert(r.status === "draft", "Somente recebimento em conferência pode ser cancelado.");
  // libera a chave para nova importação (o índice único é o scopeKey; o id do registro vem do número),
  // preservando o registro cancelado
  await ctx.store.update("receipts", id, { status: "cancelled", scopeKey: `${r.scopeKey}|cancelled|${Date.now()}` });
  // libera a cobrança de frete/despesas do pedido que este recebimento tenha registrado (conclusão interrompida)
  for (const oid of new Set<string>([...(r.orderCharges?.claimed ?? []), ...(r.orderIds ?? [])])) await releaseChargesMarker(ctx.store, oid, id);
  await audit(ctx, { module: "purchases", action: "receipt.cancel", entityType: "receipt", entityId: id, summary: `Recebimento nº ${r.number} cancelado na conferência`, reason });
}

/** Validações de confirmação (também usadas pela tela para habilitar o botão). */
export function confirmBlockers(r: Doc): string[] {
  const out: string[] = [];
  const items: ReceiptItem[] = r.items ?? [];
  const active = items.filter((i) => !i.ignore);
  if (!active.some((i) => i.receivedQty > 0)) out.push("Informe ao menos um item recebido.");
  const unchecked = active.filter((i) => !i.checked).length;
  if (unchecked) out.push(`Conclua a conferência física: ${unchecked} item(ns) não conferido(s).`);
  const eff = effectsOf(r);
  if ((!eff.updateStock || !eff.createPayable || !eff.updateCost) && !r.notes?.trim()) out.push("Efeito da entrada desmarcado: registre a justificativa em observações.");
  for (const i of active) if (i.receivedQty > 0 && !i.skuId) out.push(`Associe o item "${i.xProd ?? i.description}" a um produto interno (ou marque como não estocado).`);
  for (const i of active) if (i.receivedQty > 0 && !(i.unitCost >= 0)) out.push(`Custo inválido em ${i.description}.`);
  const payable = eff.createPayable ? payableAmount(r as any) : 0;
  if (payable > r.dueTotal) {
    if (r.differenceAction !== "pay_invoiced") out.push("Valor a pagar acima do devido sem divergência registrada.");
    else if (!r.notes?.trim()) out.push('Para pagar o valor faturado acima do recebido, registre a justificativa em "Observações / divergências".');
  }
  // total faturado × devido: sem XML (valor digitado) qualquer divergência exige justificativa; com XML,
  // exige quando o devido supera o faturado (pagaria mais do que a nota)
  const valueDiv = (r.divergences ?? []).some((d: Divergence) => d.kind === "value");
  if (valueDiv && !r.notes?.trim() && r.invoicedTotal != null && (!r.xmlFileId || r.dueTotal > r.invoicedTotal)) {
    out.push(`Total faturado ${formatMoney(r.invoicedTotal)} difere do valor devido ${formatMoney(r.dueTotal)}: corrija quantidades, custos, frete/despesas ou desconto, ou registre a justificativa em "Observações".`);
  }
  // NF-e sem valor fiscal ou sem autorização não entra como se fosse autorizada
  if (r.xmlFileId && r.emitter) {
    if (r.emitter.environment === "homologacao" && !r.emitter.homologationAccepted && !r.notes?.trim()) out.push("NF-e emitida em ambiente de homologação (sem valor fiscal): solicite o XML de produção ou registre a justificativa em observações.");
    if (r.emitter.authorized === false && !r.notes?.trim()) out.push(`XML sem protocolo de autorização da SEFAZ${r.emitter.protocolStatus ? ` (cStat ${r.emitter.protocolStatus}${r.emitter.protocolMessage ? ` – ${r.emitter.protocolMessage}` : ""})` : ""}: confirme a autorização da NF-e no portal da SEFAZ e registre a justificativa em observações.`);
  }
  // sem XML com encargos informados: frete/despesas do pedido já cobrados em outro recebimento não entram de novo
  const lost: any[] = !r.xmlFileId && r.orderCharges?.auto === false ? (r.orderCharges.lost ?? []) : [];
  if (lost.length) {
    const lostFreight = lost.reduce((a, l) => a + (l.freight ?? 0), 0);
    const lostOther = lost.reduce((a, l) => a + (l.insurance ?? 0) + (l.otherExpenses ?? 0), 0);
    const repeated = (lostFreight > 0 && (r.freight ?? 0) > 0) || (lostOther > 0 && (r.otherExpenses ?? 0) > 0);
    if (repeated && (!r.orderCharges.lostAck || !r.notes?.trim())) {
      out.push(
        `Frete/seguro/outras despesas de ${lost.map((l) => `pedido nº ${l.number ?? "—"}`).join(", ")} já foram cobrados no recebimento ${lost.map((l) => `nº ${l.receiptNumber ?? "—"}`).join(", ")}: zere o frete/outras despesas deste recebimento, use “Recalcular encargos pelo pedido” ou, se o fornecedor cobrou nova despesa nesta entrega, marque “Cobrar frete/despesas informados mesmo assim” e registre a justificativa em observações.`,
      );
    }
  }
  const instSum = (r.installments ?? []).reduce((a: number, x: any) => a + x.amount, 0);
  if (payable > 0 && instSum !== payable) out.push("As parcelas não fecham com o valor a pagar — salve a conferência para recalcular.");
  if (eff.createPayable && payable > 0 && (r.installments ?? []).some((x: any) => !x.dueDate)) out.push("Defina a condição de pagamento (vencimentos) para gerar o contas a pagar.");
  return out;
}

async function learnSupplierProduct(ctx: Ctx, r: Doc, it: ReceiptItem) {
  if (!it.skuId) return;
  const id = detId("supprod", r.supplierId, it.skuId);
  const existing = (await findOne(ctx.store, "supplier_products", [["eq", "supplierId", r.supplierId], ["eq", "skuId", it.skuId]])) ?? null;
  const patch: Record<string, any> = { lastCost: it.unitCost, lastPurchaseAt: nowIso() };
  if (it.cProd) {
    const clash = await findOne(ctx.store, "supplier_products", [["eq", "supplierId", r.supplierId], ["eq", "supplierCode", it.cProd]]);
    if (!clash || clash.skuId === it.skuId) {
      patch.supplierCode = it.cProd;
      if (it.xProd) patch.supplierDescription = it.xProd;
      patch.conversionFactor = it.conversionFactor || QTY;
    }
  }
  if (existing) await ctx.store.update("supplier_products", existing.id, patch);
  else {
    try {
      await ctx.store.create("supplier_products", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, supplierId: r.supplierId, skuId: it.skuId, preferred: false, ...patch }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
}

/**
 * Registra, com marcador de id determinístico por pedido, que ESTE recebimento (sem XML) cobra o frete/seguro/
 * outras despesas do pedido — vale quem confirmar primeiro. Se outro recebimento já os cobrou (dois recebimentos
 * abertos ao mesmo tempo), retira o encargo deste; se ninguém os cobrou ainda (entregas parciais anteriores sem eles,
 * recebimento que os assumiria cancelado ou desvinculado), este os assume. Em ambos os casos recalcula o devido e
 * interrompe a confirmação para revisão.
 */
async function claimOrderCharges(ctx: Ctx, r: Doc) {
  if (r.xmlFileId || !r.orderCharges) return;
  const auto = r.orderCharges.auto !== false;
  const linked: string[] = r.orderIds ?? [];
  const claimed: string[] = (r.orderCharges.claimed ?? []).filter((oid: string) => linked.includes(oid));
  const lost: Array<{ orderId: string; number: number | null; receiptNumber: number | null; freight: number; insurance: number; otherExpenses: number }> = [];
  const added: Array<{ orderId: string; number: number }> = [];
  const marker = (oid: string) => ({ companyId: ctx.companyId, type: "purchase.order_charges", status: "done", entityType: "purchase_order", entityId: oid, result: { receiptId: r.id, receiptNumber: r.number }, createdBy: ctx.user.id });
  /** grava o marcador deste recebimento; devolve o marcador de OUTRO recebimento quando ele já registrou a cobrança */
  const take = async (oid: string) => {
    await liveChargesMarker(ctx.store, oid); // marcador de recebimento cancelado/desvinculado é liberado antes
    try {
      await ctx.store.create("operations", marker(oid), chargesMarkerId(oid));
      return null;
    } catch (e) {
      if (!isConflict(e)) throw e;
      const m = await ctx.store.get("operations", chargesMarkerId(oid));
      return m && m.result?.receiptId !== r.id ? m : null;
    }
  };
  for (const oid of claimed) {
    const m = await take(oid);
    if (!m) continue;
    const o = await ctx.store.get("purchase_orders", oid);
    lost.push({ orderId: oid, number: o?.number ?? null, receiptNumber: m.result?.receiptNumber ?? null, freight: Math.max(0, o?.freight ?? 0), insurance: Math.max(0, o?.insurance ?? 0), otherExpenses: Math.max(0, o?.otherExpenses ?? 0) });
  }
  // encargos ainda não cobrados por nenhum recebimento confirmado: com cálculo pelo pedido, este recebimento os
  // assume para os pedidos de que recebe mercadoria (mesmo após entregas parciais confirmadas sem eles)
  if (auto) {
    const receiving = new Set<string>();
    for (const it of (r.items ?? []) as ReceiptItem[]) if (!it.ignore) for (const al of it.allocations ?? []) if (al.qty > 0) receiving.add(al.orderId);
    for (const oid of linked) {
      if (claimed.includes(oid) || !receiving.has(oid)) continue;
      const o = await ctx.store.get("purchase_orders", oid);
      if (!o || Math.max(0, o.freight ?? 0) + Math.max(0, o.insurance ?? 0) + Math.max(0, o.otherExpenses ?? 0) <= 0) continue;
      if (await orderChargesTaken(ctx.store, oid, r.id)) continue;
      if (await take(oid)) continue; // outro recebimento registrou a cobrança ao mesmo tempo
      added.push({ orderId: oid, number: o.number });
    }
  }
  if (!lost.length && !added.length) return;
  const orderCharges = {
    ...r.orderCharges,
    claimed: [...claimed.filter((x) => !lost.some((l) => l.orderId === x)), ...added.map((a) => a.orderId)],
    ...(lost.length ? { lost: [...(r.orderCharges.lost ?? []).filter((l: any) => !lost.some((n) => n.orderId === l.orderId)), ...lost], lostAck: false } : {}),
  };
  const calc = await recompute(ctx, r, { orderCharges });
  await ctx.store.update("receipts", r.id, { orderCharges, ...omit(calc, "payable") });
  const parts: string[] = [];
  if (lost.length) {
    parts.push(
      `Frete/seguro/outras despesas de ${lost.map((l) => `pedido nº ${l.number}`).join(", ")} já foram cobrados no recebimento ${lost.map((l) => `nº ${l.receiptNumber}`).join(", ")}. ${auto ? "Os valores deste recebimento foram recalculados sem esses encargos." : "Retire esses valores de frete/outras despesas deste recebimento (ou use “Recalcular encargos pelo pedido”)."}`,
    );
  }
  if (added.length) parts.push(`Frete/seguro/outras despesas de ${added.map((a) => `pedido nº ${a.number}`).join(", ")} ainda não tinham sido cobrados em nenhum recebimento confirmado (entregas anteriores sem esses encargos, ou o recebimento que os assumiria foi cancelado/desvinculado) e foram incluídos neste: valor devido recalculado para ${formatMoney(calc.dueTotal)}.`);
  await audit(ctx, { module: "purchases", action: "receipt.order_charges", entityType: "receipt", entityId: r.id, summary: `Recebimento nº ${r.number}: ${parts.join(" ")}`, related: [...lost, ...added].map((x) => `purchase_order:${x.orderId}`) });
  throw new BusinessError(`${parts.join(" ")} Revise e conclua novamente.`, lost.length ? "charges_taken" : "charges_added");
}

/**
 * Confirma o recebimento. Cada efeito é idempotente (movimentos por idemKey, título por idemKey,
 * saldo dos pedidos recalculado a partir dos recebimentos confirmados), então uma retentativa
 * após falha conclui sem duplicar. Durante os efeitos o documento fica "confirmando" (não editável).
 */
/** Pedidos vinculados ainda aceitam o recebimento? (podem ter mudado desde a importação: revisão → análise, cancelamento) */
async function linkedOrdersOrThrow(ctx: Ctx, r: Doc) {
  const out: Doc[] = [];
  for (const oid of r.orderIds ?? []) {
    const o = await ctx.store.get("purchase_orders", oid);
    if (!o || o.companyId !== ctx.companyId) throw new BusinessError("Pedido vinculado não encontrado nesta empresa — revise os pedidos relacionados.", "receipt_blocked");
    if (o.supplierId !== r.supplierId || o.branchId !== r.branchId) throw new BusinessError(`Pedido nº ${o.number} é de outro fornecedor ou filial — desmarque-o em “Pedidos relacionados”.`, "receipt_blocked");
    if (!LINKABLE.includes(o.status)) throw new BusinessError(`Pedido nº ${o.number} está ${ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status} — aguarde a nova aprovação ou desmarque-o em “Pedidos relacionados” antes de concluir.`, "receipt_blocked");
    out.push(o);
  }
  return out;
}

/** Limite de gravações por transação do Appwrite (passagem para "confirmando": 2 por solicitação + o recebimento). */
const TX_MAX_WRITES = 100;

/**
 * Passa o recebimento para "confirmando" — a partir daqui os efeitos (estoque, custo, título, saldo do pedido) são
 * concluídos, inclusive por retomada. Na mesma transação ocupa a vaga da decisão (`decisionSeq`) das solicitações dos
 * pedidos ainda revogáveis/canceláveis (aprovado/enviado): revogação da aprovação ou cancelamento concorrentes que
 * leram a vaga anterior falham (e, relidos, recusam o pedido com recebimento em andamento); se eles gravarem antes,
 * esta passagem relê os pedidos e recusa sem lançar nada.
 */
async function startConfirming(ctx: Ctx, id: string) {
  return retryOnConflict(async () => {
    const r = await ctx.store.getOrThrow("receipts", id);
    assert(r.status !== "cancelled", "Recebimento cancelado.");
    if (r.status !== "draft") return r; // outra conclusão (duplo clique) já passou para "confirmando"
    const orders = await linkedOrdersOrThrow(ctx, r);
    const reqIds = [...new Set(orders.filter((o) => ["approved", "sent"].includes(o.status) && o.requestId).map((o) => o.requestId as string))];
    const reqs = (await Promise.all(reqIds.map((rid) => ctx.store.get("purchase_requests", rid)))).filter((x): x is Doc => Boolean(x));
    if (1 + 2 * reqs.length > TX_MAX_WRITES) throw new BusinessError(`Recebimento vinculado a pedidos de ${reqs.length} solicitações diferentes (limite ${Math.floor((TX_MAX_WRITES - 1) / 2)} por conclusão): desmarque parte dos pedidos em “Pedidos relacionados” e receba-os em outro recebimento.`, "receipt_blocked");
    await ctx.store.transaction(async (t) => {
      await occupyDecisionSlots(ctx, t, reqs, "purchase.receipt_confirm", { receiptId: id, receiptNumber: r.number });
      await t.update("receipts", id, { status: "confirming" });
    });
    return { ...r, status: "confirming" } as Doc;
  });
}

export async function confirmReceipt(ctx: Ctx, id: string) {
  requireReceive(ctx);
  let r = await getReceiptForWrite(ctx, id);
  if (r.status === "confirmed") return r;
  assert(["draft", "confirming"].includes(r.status), "Recebimento cancelado.");
  if (r.status === "draft") {
    await linkedOrdersOrThrow(ctx, r);
    const calc = await recompute(ctx, r);
    r = await ctx.store.update("receipts", id, omit(calc, "payable"));
    const blockers = confirmBlockers(r);
    if (blockers.length) throw new BusinessError(blockers.join(" "), "receipt_blocked");
    await claimOrderCharges(ctx, r);
    r = await startConfirming(ctx, id);
    if (r.status === "confirmed") return r;
  }
  const items: ReceiptItem[] = r.items ?? [];
  const active = items.filter((i) => !i.ignore && i.skuId && i.receivedQty > 0);
  const occurredAt = nowIso();
  const eff = effectsOf(r);
  // 1) estoque (custo de entrada com rateio → custo médio ponderado)
  const movements = active.map((it) => ({
    warehouseId: r.warehouseId, skuId: it.skuId!, qty: it.receivedQty, type: "purchase" as const, unitCost: it.landedUnitCost ?? it.unitCost, originType: "purchase_receipt", originId: id,
    reason: `Recebimento nº ${r.number}${r.nfeNumber ? ` — NF-e ${r.nfeNumber}` : ""}`, idemKey: `receipt:${id}:${it.idx}`, occurredAt,
  }));
  if (eff.updateStock) for (let i = 0; i < movements.length; i += 40) await postMovements(ctx, movements.slice(i, i + 40));
  // 2) custos: último custo por fornecedor, custo de aquisição do SKU + histórico
  for (const it of active) {
    await learnSupplierProduct(ctx, r, it);
    if (!eff.updateCost) continue;
    const sku = await ctx.store.getOrThrow("skus", it.skuId!);
    const newCost = it.landedUnitCost ?? it.unitCost;
    if (sku.costAcquisition !== newCost) {
      const phId = detId("ph", "receipt", id, it.skuId!);
      if (!(await ctx.store.get("price_history", phId))) {
        await ctx.store.update("skus", sku.id, { costAcquisition: newCost, costTotal: newCost + (sku.costAdditional ?? 0) });
        const reason = `Recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""} — custo com frete/despesas rateados`;
        // histórico com ids determinísticos (retentativa da confirmação não duplica)
        for (const [field, oldValue, newValue, hid] of [
          ["costAcquisition", sku.costAcquisition ?? 0, newCost, phId],
          ["costTotal", sku.costTotal ?? 0, newCost + (sku.costAdditional ?? 0), detId("ph", "receipt", id, it.skuId!, "costTotal")],
        ] as const) {
          if (oldValue === newValue) continue;
          await ctx.store.create("price_history", { companyId: ctx.companyId, branchId: r.branchId, createdBy: ctx.user.id, skuId: sku.id, productId: sku.productId, priceTableId: null, field, oldValue, newValue, reason }, hid).catch((e) => {
            if (!isConflict(e)) throw e;
          });
        }
      }
    }
  }
  // 3) contas a pagar: um título com as parcelas (sem duplicar documento e parcelas)
  const payable = eff.createPayable ? payableAmount(r as any) : 0;
  let titleId: string | null = r.payableTitleId ?? null;
  if (payable > 0) {
    const supplier = await ctx.store.getOrThrow("suppliers", r.supplierId);
    const method = r.paymentMethodId ? await ctx.store.get("payment_methods", r.paymentMethodId) : null;
    const instSum = (r.installments ?? []).reduce((a: number, x: any) => a + x.amount, 0);
    assert(instSum === payable, "Parcelas não fecham com o valor a pagar.");
    const title = await createTitle(ctx, {
      kind: "payable",
      partyType: "supplier",
      partyId: supplier.id,
      partyName: supplierLabel(supplier),
      description: `Compra — recebimento nº ${r.number}${r.nfeNumber ? ` / NF-e ${r.nfeNumber}` : ""}`,
      documentNumber: r.nfeNumber ? `${r.nfeNumber}${r.nfeSeries ? `-${r.nfeSeries}` : ""}` : `REC-${r.number}`,
      originType: "purchase_receipt",
      originId: id,
      issueDate: r.nfeIssueDate ? toLocalDate(r.nfeIssueDate) : today(),
      categoryId: r.categoryId ?? (await getSetting(ctx.store, ctx.companyId, null, "finance.category.purchases", null)),
      costCenterId: r.costCenterId ?? null,
      installments: (r.installments ?? []).map((x: any) => ({ dueDate: x.dueDate, amount: x.amount, methodKind: method?.kind ?? undefined })),
      notes:
        [
          r.differenceAction === "pay_invoiced" ? `Pago pelo valor faturado (${formatMoney(r.invoicedTotal)}) — divergência registrada: ${r.notes ?? ""}` : null,
          r.emitter?.environment === "homologacao" ? "NF-e de HOMOLOGAÇÃO (sem valor fiscal) — empresa de demonstração." : null,
          r.xmlFileId && r.emitter?.authorized === false ? `NF-e sem protocolo de autorização no XML — justificativa: ${r.notes ?? ""}` : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
      idemKey: `purchase_receipt:${id}`,
      branchId: r.branchId,
    });
    titleId = title.id;
  }
  // 4) conclui e recalcula saldo dos pedidos
  r = await ctx.store.update("receipts", id, { status: "confirmed", confirmedAt: occurredAt, confirmedBy: ctx.user.id, payableTitleId: titleId, total: r.dueTotal });
  const orderStatus: string[] = [];
  for (const oid of r.orderIds ?? []) {
    const res = await refreshOrderReceipts(ctx, oid);
    const o = await ctx.store.get("purchase_orders", oid);
    orderStatus.push(`nº ${o?.number}: ${res.status === "received" ? "recebido" : "parcial"}`);
  }
  await audit(ctx, {
    module: "purchases",
    action: "receipt.confirm",
    entityType: "receipt",
    entityId: id,
    summary: `Recebimento nº ${r.number} confirmado: ${eff.updateStock ? `${active.length} item(ns) em estoque` : "SEM entrada em estoque (efeito desmarcado)"}${eff.updateCost ? "" : ", custo não atualizado"}${eff.createPayable ? "" : ", sem contas a pagar"}, devido ${formatMoney(r.dueTotal)}${titleId ? `, título a pagar com ${(r.installments ?? []).length} parcela(s)` : ""}${orderStatus.length ? `; pedidos ${orderStatus.join(", ")}` : ""}`,
    after: { dueTotal: r.dueTotal, payable, invoicedTotal: r.invoicedTotal, divergences: (r.divergences ?? []).length, effects: eff },
    reason: !eff.updateStock || !eff.updateCost || !eff.createPayable ? r.notes : null,
    related: [`supplier:${r.supplierId}`, ...(r.orderIds ?? []).map((o: string) => `purchase_order:${o}`), ...(titleId ? [`title:${titleId}`] : [])],
  });
  return r;
}

/** Movimentos de estoque gerados pelo recebimento. */
export async function receiptMovements(store: Store, id: string) {
  return listAll(store, "stock_movements", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", id]] });
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

void addDays;
