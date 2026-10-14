import { detId, findOne, isConflict, listAll, retryOnConflict, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { saveFile } from "@/lib/core/files";
import { onlyDigits, searchable } from "@/lib/core/text";
import { addDays, nowIso, toLocalDate, today } from "@/lib/dates";
import { allocate, formatMoney, formatQty, lineTotal, roundDiv, QTY } from "@/lib/money";
import { buildSchedule, createTitle } from "./finance";
import { assertPeriodOpen } from "./period-close";
import { defaultWarehouse, postMovements } from "./stock";
import { receiptLotBlockers, receiptLotSplit } from "./lots";
import { WAREHOUSE_TYPE_LABEL, receivesGoods, warehouseType } from "./warehouse-rules";
import { parseNfeXml, nfeKeyIsValid, type NfeItemTax, type ParsedNfe } from "./nfe-xml";
import { CONFIRMED, ORDER_STATUS_LABEL, netUnitCost } from "./purchase-calc";
import { orderItems, refreshOrderReceipts, remainingQty } from "./purchases";
import { occupyDecisionSlots } from "./approvals";
import { createSupplier, findSupplierByDoc, supplierLabel } from "./suppliers";
import { CFOP_FEATURE, CFOP_PAIRS_KEY, DEFAULT_CFOP_PAIRS, convertCfop, isEntryCfop, normalizePairs } from "./cfop-entry";

/**
 * Recebimento de mercadorias (Tela 29).
 *  - Importação real de XML de NF-e (upload) ou chave + itens dos pedidos (sem XML).
 *  - Mesma chave/XML não duplica: índice único `receipts.scopeKey` = empresa|nfe|chave. O id do registro vem
 *    do número (não da chave): cancelar muda o scopeKey e a mesma NF-e pode ser importada de novo.
 *  - NF-e denegada é recusada; de homologação (sem valor fiscal) só em empresa de demonstração; XML sem
 *    protocolo de autorização só é confirmado com justificativa.
 *  - Sem XML: IPI e desconto geral do pedido proporcionais ao alocado; frete/seguro/outras despesas do pedido
 *    cobrados uma única vez — pelo primeiro recebimento que confirmar a cobrança (marcador por pedido gravado na
 *    passagem para "confirmando"; entregas parciais confirmadas sem eles não impedem o próximo de assumi-los).
 *    O total faturado informado é comparado ao devido (tolerância `purchase.receiptValueTolerance`, padrão 0) e a
 *    divergência exige justificativa.
 *  - A passagem para "confirmando" disputa a vaga da decisão da solicitação dos pedidos (revogação da aprovação e
 *    cancelamento concorrentes não deixam mercadoria/título num pedido em análise ou cancelado).
 *  - Escritas exigem a filial do recebimento (contexto consolidado é somente consulta).
 *  - Mapeamento código do fornecedor (cProd) → SKU interno, aprendido em `supplier_products`.
 *  - Comparação previsto (saldo do pedido) × faturado (XML) × recebido (conferência).
 *  - Confirmação: entrada de estoque (custo médio com frete/despesas rateados), atualização de custo
 *    (supplier_products.lastCost, skus.costAcquisition + price_history), saldo do(s) pedido(s) e UM
 *    título a pagar com as parcelas (duplicatas do XML ou condição de pagamento).
 *  - Valor devido = Σ (recebido × custo) − desconto + frete + outras despesas. Os títulos nunca excedem
 *    o devido, salvo divergência registrada com a decisão "pagar o valor faturado" e justificativa.
 *  - Entrada sem pedido (COM-03, parâmetro `feature.entradaSemPedido`, padrão ligado): XML importado com
 *    "sem pedido" (não vincula pedidos em aberto) ou lançamento manual com itens, frete/despesas/desconto e condição
 *    de pagamento. Sem pedido não há saldo previsto nem divergência "fora do pedido"; a conclusão é a mesma
 *    (confirmReceipt): estoque, custo médio e título pelo devido (§14). Origem gravada em `origin` (xml | manual)
 *    e `orderLink` (with_order | without_order).
 *  - CFOP de entrada por item (COM-09): convertido do CFOP do fornecedor pela tabela de pares (`cfop-entry.ts`);
 *    item sem par usa o CFOP do recebimento (1102/2102).
 */

/** Recurso "entrada sem pedido" (padrão ligado: é aditivo). */
export const NO_ORDER_FEATURE = "entradaSemPedido";

export async function noOrderEntryOn(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, NO_ORDER_FEATURE, true);
}

/** Tabela de pares de CFOP vigente (filial → empresa → padrão) ou `null` quando o conversor está desligado. */
export async function cfopPairsFor(store: Store, companyId: string, branchId: string | null | undefined): Promise<Record<string, string> | null> {
  if (!(await isFeatureOn(store, companyId, branchId, CFOP_FEATURE, true))) return null;
  return normalizePairs(await getSetting<unknown>(store, companyId, branchId, CFOP_PAIRS_KEY, DEFAULT_CFOP_PAIRS));
}

const orderLinkOf = (orderIds: string[] | null | undefined) => ((orderIds ?? []).length ? "with_order" : "without_order");

export interface ReceiptItem {
  idx: number;
  nItem?: number | null;
  cProd?: string | null;
  cEAN?: string | null;
  xProd?: string | null;
  uCom?: string | null;
  ncm?: string | null;
  /** CEST do item no XML */
  cest?: string | null;
  /** CFOP de saída informado pelo fornecedor no XML */
  cfop?: string | null;
  /** CFOP de entrada do item (conversor de CFOP ou conferência); vazio = CFOP do recebimento */
  entryCfop?: string | null;
  /** item incluído manualmente (entrada sem pedido): pode ser removido na conferência */
  added?: boolean;
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
  /** created = produto cadastrado a partir do item do XML na conferência */
  mapping?: "supplier_code" | "barcode" | "order" | "manual" | "created" | null;
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
  /** fabricação do lote (rastro do XML) e lotes do XML quando a nota traz mais de um para o item (EST-02) */
  mfg?: string | null;
  rastro?: Array<{ nLote: string; qLote: number; dFab: string | null; dVal: string | null }> | null;
  allocations?: Array<{ orderId: string; orderItemId: string; orderNumber: number; qty: number }>;
  lineValue?: number;
  freightShare?: number;
  otherShare?: number;
  discountShare?: number;
  landedUnitCost?: number;
  /** custo total da linha com rateios (centavos): o estoque entra por este valor exato */
  landedValue?: number;
  /**
   * Valores fiscais do item no XML (FIS-24 — livro de entradas): vProd/vDesc/vFrete/vSeg/vOutro e tributos (ICMS, ST,
   * IPI). Só os diferentes de zero são gravados. Informativo: o custo do recebimento (computeReceipt) não os usa.
   */
  fiscal?: ReceiptItemFiscal | null;
  /** frete de CT-e de entrada rateado no custo do item (COM-10), centavos — somado ao landedValue fora do computeReceipt */
  cteShare?: number;
}

/** Valores fiscais do item lidos do XML (centavos; alíquotas em pontos-base). Campos ausentes = 0/null. */
export type ReceiptItemFiscal = Partial<{ vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number; /** valor contábil informado (nota sem estoque lançada sem XML) */ vItem: number } & NfeItemTax>;

/** Valores fiscais do item do XML, sem os campos zerados/vazios (o recebimento guarda só o que existe na nota). */
export function itemFiscalOf(it: ParsedNfe["items"][number]): ReceiptItemFiscal {
  const all: Record<string, unknown> = { vProd: it.vProd, vDesc: it.vDesc, vFrete: it.vFrete, vSeg: it.vSeg, vOutro: it.vOutro, ...it.tax };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null && v !== 0 && v !== "")) as ReceiptItemFiscal;
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
 * CONFIRMA a cobrança, na mesma transação que o passa para "confirmando" (vale quem confirmar primeiro; rascunho não
 * reserva). Só vale enquanto o dono está ativo e vinculado ao pedido: marcador de recebimento cancelado ou que
 * desvinculou o pedido (estado de versão anterior) é liberado no cancelamento, ao desmarcar o pedido ou na próxima
 * consulta.
 */
const chargesMarkerId = (orderId: string) => detId("po-charges", orderId);

/** Libera o marcador de cobrança do pedido se ele (ainda) pertencer ao recebimento indicado. */
async function releaseChargesMarker(store: Store, orderId: string, receiptId: string | null) {
  const m = await store.get("operations", chargesMarkerId(orderId));
  if (!m || (m.result?.receiptId ?? null) !== receiptId) return false;
  await store.delete("operations", m.id);
  return true;
}

/** Marcador de cobrança vigente do pedido (marcador de recebimento cancelado ou desvinculado do pedido é liberado aqui). */
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
    it.landedValue = landed;
    it.landedUnitCost = roundDiv(landed * QTY, it.receivedQty);
  });
  const dueTotal = productsTotal - Math.min(r.discount, productsTotal) + r.freight + r.otherExpenses;
  if (r.invoicedTotal != null && Math.abs(r.invoicedTotal - dueTotal) > Math.max(0, r.valueTolerance ?? 0)) divergences.push({ kind: "value", message: `Valor faturado ${formatMoney(r.invoicedTotal)} × valor devido pelo recebido ${formatMoney(dueTotal)} (diferença ${formatMoney(r.invoicedTotal - dueTotal)}).` });
  return { items, productsTotal, dueTotal, divergences };
}

/**
 * Rateio do frete de CT-e de entrada (COM-10) nos itens ativos (estocados, com quantidade), proporcional ao valor da
 * linha — o mesmo critério do frete da NF-e em computeReceipt. Soma a parte de cada item ao custo de entrada
 * (landedValue/landedUnitCost). Itens fora do estoque ficam com parte zero.
 */
export function applyCteShares(items: ReceiptItem[], amount: number) {
  const active = items.filter((it) => !it.ignore && it.skuId && it.receivedQty > 0);
  for (const it of items) if (!active.includes(it)) it.cteShare = 0;
  if (!active.length || amount <= 0) return items;
  const shares = allocate(amount, active.map((it) => it.lineValue ?? 0));
  active.forEach((it, i) => {
    it.cteShare = shares[i] ?? 0;
    it.landedValue = (it.landedValue ?? 0) + it.cteShare;
    it.landedUnitCost = roundDiv(it.landedValue * QTY, it.receivedQty);
  });
  return items;
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
  // CT-e de entrada vinculado (COM-10): frete do transportador rateado no custo dos itens pelo mesmo critério do frete
  // da nota (valor da linha). Fora do computeReceipt e fora do valor devido ao fornecedor (o CT-e tem título próprio).
  if ((merged.cteFreight ?? 0) > 0) applyCteShares(comp.items, merged.cteFreight);
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

/** CNPJs da empresa e das filiais (destinatário/tomador de documentos de entrada). */
export async function companyCnpjs(store: Store, companyId: string) {
  const c = await store.get("companies", companyId);
  const bs = await listAll(store, "branches", { filters: [["eq", "companyId", companyId]] });
  return new Set([c?.cnpj, ...bs.map((b) => b.cnpj)].filter(Boolean).map((x) => onlyDigits(x)));
}

/** Importa XML de NF-e: cria o recebimento em conferência (ou devolve o existente para a mesma chave). */
export async function importNfeXml(ctx: Ctx, input: { xml: string; fileName?: string | null; warehouseId?: string | null; orderIds?: string[] | null; createSupplier?: boolean; allowHomologation?: boolean; withoutOrder?: boolean }) {
  requireReceive(ctx);
  const branchId = requireBranch(ctx);
  if (input.withoutOrder) {
    assert(!input.orderIds?.length, "Entrada sem pedido: não selecione pedidos.");
    if (!(await noOrderEntryOn(ctx.store, ctx.companyId, branchId))) throw new BusinessError("Entrada sem pedido desativada (Administração → Parâmetros → Compras). Importe o XML vinculando os pedidos do fornecedor.", "no_order_disabled");
  }
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
  if (input.withoutOrder) orderIds = [];
  else if (input.orderIds?.length) {
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
  const pairs = await cfopPairsFor(ctx.store, ctx.companyId, branchId);
  const items: ReceiptItem[] = [];
  for (const [i, it] of nfe.items.entries()) {
    const m = await mapXmlItem(ctx.store, ctx.companyId, supplier.id, it, lines);
    const invoicedQty = roundDiv(it.qCom * m.conversionFactor, QTY);
    const net = it.vProd - it.vDesc;
    const sku = m.skuId ? await ctx.store.get("skus", m.skuId) : null;
    const unit = invoicedQty > 0 ? roundDiv(net * QTY, invoicedQty) : 0;
    items.push({
      idx: i + 1, nItem: it.nItem, cProd: it.cProd, cEAN: it.cEAN, xProd: it.xProd, uCom: it.uCom, ncm: it.ncm, cest: it.cest, cfop: it.cfop, entryCfop: convertCfop(it.cfop, pairs), invoicedQtySupplier: it.qCom, conversionFactor: m.conversionFactor,
      invoicedQty, invoicedValue: net, invoiceUnitCost: unit, skuId: m.skuId, sku: sku?.sku ?? null, description: sku?.name ?? it.xProd, unitCode: sku?.unitCode ?? it.uCom, mapping: m.mapping,
      expectedQty: 0, receivedQty: invoicedQty, unitCost: unit, ignore: false, divergence: null,
      // valores fiscais do item (livro de entradas — FIS-24); não entram no custo
      fiscal: itemFiscalOf(it),
      // lote/validade do XML (grupo rastro): o primeiro preenche a conferência; com mais de um, todos vão ao estoque
      ...(it.rastro?.length ? { lot: it.rastro[0].nLote, expiry: it.rastro[0].dVal, mfg: it.rastro[0].dFab, ...(it.rastro.length > 1 ? { rastro: it.rastro } : {}) } : {}),
    });
  }
  // só mantém pedidos que compartilham algum produto com a nota
  const skuSet = new Set(items.map((i) => i.skuId).filter(Boolean));
  const relevant = orderIds.filter((id) => lines.some((l) => l.order.id === id && skuSet.has(l.skuId)));
  if (input.warehouseId) await assertReceiptWarehouse(ctx.store, input.warehouseId, branchId);
  const warehouseId = input.warehouseId || (relevant[0] ? lines.find((l) => l.order.id === relevant[0])?.order.warehouseId : null) || (await defaultWarehouse(ctx.store, branchId)).id;
  const firstOrder = relevant[0] ? lines.find((l) => l.order.id === relevant[0])?.order : null;
  const number = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  const hash = sha256(Buffer.from(input.xml));
  const otherExpenses = nfe.totals.vOutro + nfe.totals.vIPI + nfe.totals.vST + nfe.totals.vSeg;
  const defaults = await financialDefaults(ctx, firstOrder ?? null, nfe.emitter.address?.uf ?? null);
  // CFOP do recebimento: o convertido, quando todos os itens convergem para o mesmo par; senão o padrão 1102/2102
  const converted = [...new Set(items.map((x) => x.entryCfop))];
  if (converted.length === 1 && converted[0]) defaults.entryCfop = converted[0];
  const base = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId, supplierId: supplier.id, orderIds: relevant, nfeKey: nfe.key, nfeNumber: nfe.number, nfeSeries: nfe.series,
    nfeIssueDate: nfe.issueDate ? new Date(nfe.issueDate).toISOString() : null, xmlHash: hash, status: "draft", items, freight: nfe.totals.vFrete, otherExpenses, discount: 0, invoicedTotal: nfe.totals.vNF,
    paymentTermId: firstOrder?.paymentTermId ?? supplier.paymentTermId ?? null,
    emitter: { ...nfe.emitter, duplicatas: nfe.duplicatas, protocol: nfe.protocol, authorized: nfe.authorized, environment: nfe.environment, protocolStatus: nfe.protocolStatus, protocolMessage: nfe.protocolMessage, homologationAccepted, nature: nfe.nature, totals: nfe.totals },
    differenceAction: "adjust_to_due", notes: null, scopeKey: scopeFor(ctx.companyId, nfe.key), searchText: searchable(String(number), nfe.number, nfe.key, supplier.name, supplier.tradeName),
    origin: "xml", orderLink: orderLinkOf(relevant),
    ...defaults,
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
    summary: `Recebimento nº ${number}: XML da NF-e ${nfe.number}/${nfe.series} de ${supplierLabel(supplier)} importado ${relevant.length ? "" : input.withoutOrder ? "SEM PEDIDO (escolhido na importação) " : "sem pedido vinculado "}(${items.length} itens, ${formatMoney(nfe.totals.vNF)}); ${items.filter((i) => !i.skuId).length} item(ns) sem associação${pairs && items.some((i) => i.entryCfop) ? `; CFOP de entrada convertido em ${items.filter((i) => i.entryCfop).length} item(ns)` : ""}${nfe.environment === "homologacao" ? " — ambiente de HOMOLOGAÇÃO (sem valor fiscal)" : ""}${nfe.authorized ? "" : ` — sem protocolo de autorização${protocolInfo ? ` (${protocolInfo})` : ""}`}`,
    related: [`supplier:${supplier.id}`, ...relevant.map((o) => `purchase_order:${o}`)],
  });
  return r;
}

/** Padrões fiscais/financeiros da entrada: CFOP (1102 interna / 2102 interestadual), plano de contas, centro de custo e forma de pagamento do pedido. */
async function financialDefaults(ctx: Ctx, order: Doc | null, emitterUf: string | null) {
  const branch = ctx.branchId ? await ctx.store.get("branches", ctx.branchId) : null;
  const interstate = emitterUf && branch?.uf && emitterUf !== branch.uf;
  return {
    entryCfop: (interstate ? "2102" : "1102") as string,
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

/** Item da nota lançada manualmente (entrada sem pedido): quantidade em milésimos, custo e desconto da linha em centavos. */
export interface ManualReceiptItemInput {
  skuId: string;
  qty: number;
  unitCost: number;
  /** desconto da linha (centavos) */
  discount?: number | null;
}

export interface ManualReceiptInput {
  supplierId: string;
  orderIds: string[];
  nfeKey?: string | null;
  nfeNumber?: string | null;
  nfeSeries?: string | null;
  issueDate?: string | null;
  warehouseId?: string | null;
  invoicedTotal?: number | null;
  idemKey: string;
  /** entrada sem pedido: itens da nota (ignorados quando há pedidos — os itens vêm do saldo) */
  items?: ManualReceiptItemInput[] | null;
  /** entrada sem pedido: frete, outras despesas (inclui IPI/ST/seguro) e desconto da nota */
  freight?: number | null;
  otherExpenses?: number | null;
  discount?: number | null;
  /** condição de pagamento; `null` = à vista (vencimento na emissão); omitida = condição do fornecedor */
  paymentTermId?: string | null;
  paymentMethodId?: string | null;
}

/** Monta os itens de uma nota lançada manualmente (sem pedido), validando produto, quantidade, custo e desconto. */
async function manualItems(ctx: Ctx, supplierId: string, input: ManualReceiptItemInput[], firstIdx: number): Promise<ReceiptItem[]> {
  const out: ReceiptItem[] = [];
  for (const [n, it] of input.entries()) {
    const sku = it.skuId ? await ctx.store.get("skus", it.skuId) : null;
    assert(sku && sku.companyId === ctx.companyId, `Item ${n + 1}: produto inválido.`);
    assert(Number.isInteger(it.qty) && it.qty > 0, `${sku.name}: informe a quantidade.`);
    assert(Number.isInteger(it.unitCost) && it.unitCost >= 0, `${sku.name}: custo unitário inválido.`);
    const gross = lineTotal(it.unitCost, it.qty);
    const disc = it.discount ?? 0;
    assert(Number.isInteger(disc) && disc >= 0 && disc <= gross, `${sku.name}: desconto inválido (entre zero e o valor da linha).`);
    const value = gross - disc;
    const unit = roundDiv(value * QTY, it.qty);
    const sp = await findOne(ctx.store, "supplier_products", [["eq", "supplierId", supplierId], ["eq", "skuId", sku.id]]);
    out.push({
      idx: firstIdx + n, cProd: sp?.supplierCode ?? null, conversionFactor: QTY, invoicedQty: it.qty, invoicedValue: value, invoiceUnitCost: unit, skuId: sku.id, sku: sku.sku ?? null, description: sku.name, unitCode: sku.unitCode ?? null,
      mapping: "manual", expectedQty: 0, receivedQty: it.qty, unitCost: unit, ignore: false, divergence: null, added: true,
    });
  }
  return out;
}

/**
 * Entrada sem pedido, lançada manualmente (COM-03): itens, frete/outras despesas/desconto e condição de pagamento
 * informados pelo usuário. Sem encargos de pedido (orderCharges nulo): os valores informados valem como na nota.
 */
async function createNoOrderReceipt(ctx: Ctx, supplier: Doc<any>, input: ManualReceiptInput, key: string, scopeKey: string, branchId: string) {
  if (!(await noOrderEntryOn(ctx.store, ctx.companyId, branchId))) throw new BusinessError("Selecione ao menos um pedido de compra: a entrada sem pedido está desativada (Administração → Parâmetros → Compras).", "no_order_disabled");
  assert(supplier.status !== "inactive", `Fornecedor ${supplierLabel(supplier)} está inativo — reative antes de receber.`);
  assert((input.items ?? []).length, "Informe ao menos um item da nota (produto, quantidade e custo).");
  assert((input.items ?? []).length <= 300, "Nota com itens demais para o lançamento manual (máximo 300) — importe o XML.");
  const items = await manualItems(ctx, supplier.id, input.items ?? [], 1);
  for (const [k, v] of [["Frete", input.freight], ["Outras despesas", input.otherExpenses], ["Desconto", input.discount]] as const) assert(v == null || (Number.isInteger(v) && v >= 0), `${k} inválido.`);
  if (input.warehouseId) await assertReceiptWarehouse(ctx.store, input.warehouseId, branchId);
  // condição: a informada (vazia = à vista, vencimento na emissão); sem o campo, a do fornecedor
  const termId = input.paymentTermId !== undefined ? input.paymentTermId || null : (supplier.paymentTermId ?? null);
  if (input.paymentTermId) {
    const t = await ctx.store.get("payment_terms", input.paymentTermId);
    assert(t && t.companyId === ctx.companyId, "Condição de pagamento inválida.");
  }
  if (input.paymentMethodId) {
    const m = await ctx.store.get("payment_methods", input.paymentMethodId);
    assert(m && m.companyId === ctx.companyId, "Forma de pagamento inválida.");
  }
  if (input.issueDate) assert(/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) && input.issueDate <= today(), "Data de emissão inválida (não pode ser futura).");
  const number = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  const defaults = await financialDefaults(ctx, null, supplier.addresses?.[0]?.uf ?? null);
  const base = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId: input.warehouseId || (await defaultWarehouse(ctx.store, branchId)).id, supplierId: supplier.id,
    orderIds: [], nfeKey: key || null, nfeNumber: input.nfeNumber || (key ? String(Number(key.slice(25, 34))) : null), nfeSeries: input.nfeSeries || (key ? String(Number(key.slice(22, 25))) : null),
    nfeIssueDate: input.issueDate ? `${input.issueDate}T12:00:00.000Z` : null, xmlFileId: null, xmlHash: null, status: "draft", items,
    freight: input.freight ?? 0, otherExpenses: input.otherExpenses ?? 0, discount: input.discount ?? 0, orderCharges: null,
    invoicedTotal: input.invoicedTotal ?? null, paymentTermId: termId, emitter: { cnpj: supplier.doc, name: supplier.name, tradeName: supplier.tradeName, duplicatas: [] },
    differenceAction: "adjust_to_due", notes: null, scopeKey, searchText: searchable(String(number), input.nfeNumber, key, supplier.name, supplier.tradeName),
    origin: "manual", orderLink: "without_order",
    ...defaults,
    ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
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
  await audit(ctx, {
    module: "purchases", action: "receipt.create", entityType: "receipt", entityId: r.id,
    summary: `Recebimento nº ${number} lançado manualmente SEM PEDIDO${key ? ` (chave ${key})` : input.nfeNumber ? ` (NF ${input.nfeNumber})` : ""} — ${supplierLabel(supplier)}, ${items.length} item(ns), devido ${formatMoney(r.dueTotal)}${r.installments?.length ? ` em ${r.installments.length} parcela(s)` : ""}`,
    related: [`supplier:${supplier.id}`],
  });
  return r;
}

/**
 * Recebimento sem XML (chave/nota informadas manualmente): itens a partir do saldo dos pedidos ou, sem pedido
 * (entrada sem pedido, COM-03), itens informados.
 */
export async function createManualReceipt(ctx: Ctx, input: ManualReceiptInput) {
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
  if (!orderIds.length) return createNoOrderReceipt(ctx, supplier, input, key, scopeKey, branchId);
  const orders = await Promise.all(orderIds.map((id) => ctx.store.getOrThrow("purchase_orders", id)));
  for (const o of orders) {
    assert(o.companyId === ctx.companyId, "Pedido de outra empresa.");
    assert(o.supplierId === supplier.id, `Pedido nº ${o.number} é de outro fornecedor.`);
    assert(CONFIRMED.includes(o.status), `Pedido nº ${o.number} não está aprovado/enviado (situação atual: ${o.status}).`);
    assert(o.branchId === branchId, `Pedido nº ${o.number} é de outra filial.`);
  }
  if (input.warehouseId) await assertReceiptWarehouse(ctx.store, input.warehouseId, branchId);
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
    origin: "manual", orderLink: "with_order",
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
  items?: Array<{ idx: number; skuId?: string | null; receivedQty?: number; unitCost?: number; conversionFactor?: number; divergence?: string | null; ignore?: boolean; checked?: boolean; lot?: string | null; expiry?: string | null; entryCfop?: string | null }>;
  /** sem XML: inclui itens na nota lançada manualmente (entrada sem pedido) */
  addItems?: ManualReceiptItemInput[];
  /** sem XML: remove itens incluídos manualmente (idx) */
  removeItems?: number[];
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
    if (u.entryCfop !== undefined) {
      const c = onlyDigits(u.entryCfop);
      assert(!c || isEntryCfop(c), `${it.description}: CFOP de entrada ${u.entryCfop} inválido (4 dígitos começando por 1, 2 ou 3).`);
      it.entryCfop = c || null;
    }
  }
  if (input.removeItems?.length || input.addItems?.length) assert(!r.xmlFileId, "Itens de NF-e importada por XML não podem ser incluídos nem removidos — marque “não estocar” no item.");
  for (const idx of input.removeItems ?? []) {
    const i = items.findIndex((x) => x.idx === idx);
    if (i < 0) continue;
    assert(items[i].added, `${items[i].description}: somente itens incluídos manualmente podem ser removidos.`);
    items.splice(i, 1);
  }
  if (input.addItems?.length) {
    assert(items.length + input.addItems.length <= 300, "Nota com itens demais para o lançamento manual (máximo 300).");
    items.push(...(await manualItems(ctx, r.supplierId, input.addItems, Math.max(0, ...items.map((x) => x.idx)) + 1)));
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
  if (input.warehouseId && input.warehouseId !== r.warehouseId) await assertReceiptWarehouse(ctx.store, input.warehouseId, r.branchId);
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
    orderLink: orderLinkOf(orderIds),
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

/**
 * Associa itens do recebimento em conferência a SKUs (usado pelo cadastro de produto a partir do item do XML):
 * grava o vínculo e a forma de associação e recalcula previsto, divergências e parcelas.
 */
export async function linkReceiptItems(ctx: Ctx, id: string, links: Array<{ idx: number; skuId: string; mapping: NonNullable<ReceiptItem["mapping"]> }>) {
  requireReceive(ctx);
  const r = await getReceiptForWrite(ctx, id);
  assert(r.status === "draft", "Recebimento já confirmado não pode ser alterado.");
  const items: ReceiptItem[] = (r.items ?? []).map((x: ReceiptItem) => ({ ...x }));
  for (const l of links) {
    const it = items.find((x) => x.idx === l.idx);
    if (!it) continue;
    const sku = await ctx.store.get("skus", l.skuId);
    assert(sku && sku.companyId === ctx.companyId, "Produto inválido.");
    Object.assign(it, { skuId: sku.id, sku: sku.sku ?? null, description: sku.name, unitCode: sku.unitCode ?? it.uCom ?? it.unitCode, mapping: l.mapping });
  }
  const calc = await recompute(ctx, r, { items });
  return ctx.store.update("receipts", id, { items, ...omit(calc, "payable") });
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
 * Encargos do pedido (frete/seguro/outras despesas) num recebimento sem XML, avaliados na conclusão. Vale quem
 * confirmar primeiro: o marcador de cobrança é gravado na mesma transação que passa o recebimento para
 * "confirmando" (ver startConfirming), então rascunho nunca reserva a cobrança.
 *  - pedido assumido (`claimed`) cuja cobrança outro recebimento já confirmou → retirado deste (lost);
 *  - com cálculo pelo pedido, pedido de que este recebimento recebe mercadoria e cujos encargos ninguém cobrou
 *    ainda (entregas parciais anteriores sem eles, recebimento que os assumiria cancelado/desvinculado) → incluído
 *    neste (added).
 * Havendo mudança, recalcula o devido e interrompe a conclusão para revisão. Senão, devolve os pedidos cujo marcador
 * este recebimento deve gravar.
 */
async function planOrderCharges(ctx: Ctx, r: Doc): Promise<string[]> {
  if (r.xmlFileId || !r.orderCharges) return [];
  const auto = r.orderCharges.auto !== false;
  const linked: string[] = r.orderIds ?? [];
  const claimed: string[] = (r.orderCharges.claimed ?? []).filter((oid: string) => linked.includes(oid));
  const lost: Array<{ orderId: string; number: number | null; receiptNumber: number | null; freight: number; insurance: number; otherExpenses: number }> = [];
  const added: Array<{ orderId: string; number: number }> = [];
  const toMark: string[] = [];
  for (const oid of claimed) {
    const m = await liveChargesMarker(ctx.store, oid);
    if (!m) toMark.push(oid);
    else if (m.result?.receiptId !== r.id) {
      const o = await ctx.store.get("purchase_orders", oid);
      lost.push({ orderId: oid, number: o?.number ?? null, receiptNumber: m.result?.receiptNumber ?? null, freight: Math.max(0, o?.freight ?? 0), insurance: Math.max(0, o?.insurance ?? 0), otherExpenses: Math.max(0, o?.otherExpenses ?? 0) });
    }
  }
  if (auto) {
    const receiving = new Set<string>();
    for (const it of (r.items ?? []) as ReceiptItem[]) if (!it.ignore) for (const al of it.allocations ?? []) if (al.qty > 0) receiving.add(al.orderId);
    for (const oid of linked) {
      if (claimed.includes(oid) || !receiving.has(oid)) continue;
      const o = await ctx.store.get("purchase_orders", oid);
      if (!o || Math.max(0, o.freight ?? 0) + Math.max(0, o.insurance ?? 0) + Math.max(0, o.otherExpenses ?? 0) <= 0) continue;
      if (await orderChargesTaken(ctx.store, oid, r.id)) continue;
      added.push({ orderId: oid, number: o.number });
    }
  }
  if (!lost.length && !added.length) return toMark;
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

/** Limite de gravações por transação do Appwrite. */
const TX_MAX_WRITES = 100;

/**
 * Passa o recebimento para "confirmando" — a partir daqui os efeitos (estoque, custo, título, saldo do pedido) são
 * concluídos, inclusive por retomada. Numa única transação:
 *  - grava o marcador de cobrança dos encargos dos pedidos que este recebimento cobra (ver planOrderCharges): outro
 *    recebimento que confirmar ao mesmo tempo falha aqui e, relido, perde esses encargos (revisão);
 *  - ocupa a vaga da decisão (`decisionSeq`) das solicitações dos pedidos ainda revogáveis/canceláveis (aprovado/
 *    enviado): revogação da aprovação ou cancelamento concorrentes que leram a vaga anterior falham (e, relidos,
 *    recusam o pedido com recebimento em andamento); se eles gravarem antes, esta passagem relê os pedidos e recusa
 *    sem lançar nada.
 */
async function startConfirming(ctx: Ctx, id: string) {
  return retryOnConflict(async () => {
    const r = await ctx.store.getOrThrow("receipts", id);
    assert(r.status !== "cancelled", "Recebimento cancelado.");
    if (r.status !== "draft") return r; // outra conclusão (duplo clique) já passou para "confirmando"
    const orders = await linkedOrdersOrThrow(ctx, r);
    const toMark = await planOrderCharges(ctx, r);
    const reqIds = [...new Set(orders.filter((o) => ["approved", "sent"].includes(o.status) && o.requestId).map((o) => o.requestId as string))];
    const reqs = (await Promise.all(reqIds.map((rid) => ctx.store.get("purchase_requests", rid)))).filter((x): x is Doc => Boolean(x));
    if (toMark.length + 2 * reqs.length + 1 > TX_MAX_WRITES) throw new BusinessError(`Recebimento vinculado a pedidos demais para uma conclusão (${orders.length} pedidos de ${reqs.length} solicitações): desmarque parte dos pedidos em “Pedidos relacionados” e receba-os em outro recebimento.`, "receipt_blocked");
    await ctx.store.transaction(async (t) => {
      for (const oid of toMark) await t.create("operations", { companyId: ctx.companyId, type: "purchase.order_charges", status: "done", entityType: "purchase_order", entityId: oid, result: { receiptId: id, receiptNumber: r.number }, createdBy: ctx.user.id }, chargesMarkerId(oid));
      await occupyDecisionSlots(ctx, t, reqs, "purchase.receipt_confirm", { receiptId: id, receiptNumber: r.number });
      await t.update("receipts", id, { status: "confirming" });
    });
    return { ...r, status: "confirming" } as Doc;
  });
}

/**
 * Confirma o recebimento. Cada efeito é idempotente (movimentos por idemKey, título por idemKey,
 * saldo dos pedidos recalculado a partir dos recebimentos confirmados), então uma retentativa
 * após falha conclui sem duplicar. Durante os efeitos o documento fica "confirmando" (não editável).
 */

/**
 * Depósito de destino escolhido para o recebimento (§39): da filial, ativo e que recebe mercadoria (venda,
 * almoxarifado ou uso e consumo — avarias não recebe compra).
 */
async function assertReceiptWarehouse(store: Store, warehouseId: string, branchId: string) {
  const wh = await store.getOrThrow("warehouses", warehouseId);
  assert(wh.branchId === branchId, "Depósito de outra filial.");
  assert(wh.status !== "inactive", `O depósito ${wh.name} está desativado.`);
  assert(receivesGoods(wh), `O depósito ${wh.name} é de avarias e não recebe mercadoria de compra: escolha um depósito de venda, almoxarifado ou uso e consumo.`);
  return wh;
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
    // §39: o depósito de destino precisa estar ativo e receber mercadoria (venda, almoxarifado ou uso e consumo)
    if (effectsOf(r).updateStock) {
      const wh = r.warehouseId ? await ctx.store.get("warehouses", r.warehouseId) : null;
      if (!receivesGoods(wh)) blockers.push(wh ? `O depósito de destino ${wh.name} ${wh.status === "inactive" ? "está desativado" : `é de ${WAREHOUSE_TYPE_LABEL[warehouseType(wh)].toLowerCase()}`}: escolha outro depósito de destino na conferência.` : "Escolha o depósito de destino na conferência.");
    }
    // lote obrigatório para produto com controle de lote (EST-02, recurso feature.lotes)
    blockers.push(...(await receiptLotBlockers(ctx, r)));
    if (blockers.length) throw new BusinessError(blockers.join(" "), "receipt_blocked");
    // FIN-21: conta a pagar com competência em período financeiro fechado é recusada antes de qualquer efeito (estoque)
    if (effectsOf(r).createPayable && payableAmount(r as any) > 0) await assertPeriodOpen(ctx.store, ctx.companyId, r.nfeIssueDate ? toLocalDate(r.nfeIssueDate) : today(), "conta a pagar do recebimento (data de emissão da nota)");
    r = await startConfirming(ctx, id);
    if (r.status === "confirmed") return r;
  }
  const items: ReceiptItem[] = r.items ?? [];
  const active = items.filter((i) => !i.ignore && i.skuId && i.receivedQty > 0);
  const occurredAt = nowIso();
  const eff = effectsOf(r);
  // 1) estoque (custo de entrada com rateio → custo médio ponderado)
  const movements = active.map((it) => ({
    warehouseId: r.warehouseId, skuId: it.skuId!, qty: it.receivedQty, type: "purchase" as const, unitCost: it.landedUnitCost ?? it.unitCost, totalCost: it.landedValue ?? null, originType: "purchase_receipt", originId: id,
    reason: `Recebimento nº ${r.number}${r.nfeNumber ? ` — NF-e ${r.nfeNumber}` : ""}`, idemKey: `receipt:${id}:${it.idx}`, occurredAt,
    // lote/validade da conferência ou do XML (EST-02): saldo por lote quando o produto controla lote
    lot: it.lot ?? null, lotExpiry: it.expiry ?? null, lotMfg: it.mfg ?? null, lotSplit: receiptLotSplit(it),
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

// ───────────────────────────── CT-e de entrada (COM-10)

export interface CteLink {
  cteId: string;
  key: string;
  number: string;
  amount: number;
  /** cost = rateado no custo de entrada (recebimento em conferência); adjustment = ajuste de custo (já concluído) */
  mode: "cost" | "adjustment";
}

export interface CteItemAdjustment {
  idx: number;
  skuId: string;
  description: string;
  share: number;
  /** parte absorvida pelo estoque existente (movimento cost_adjust) */
  absorbed: number;
  /** parte das unidades já vendidas/baixadas: não volta ao estoque (fica registrada para a contabilidade) */
  notAbsorbed: number;
  movementId: string | null;
}

/**
 * Lança o frete de um CT-e de entrada num recebimento (idempotente por CT-e):
 *  - em conferência: soma ao `cteFreight` e recalcula — o frete entra no custo de entrada dos itens na conclusão pelo
 *    mesmo rateio (valor da linha), sem mudar o valor devido ao fornecedor;
 *  - concluído: ajuste de custo documentado — a parte de cada item é rateada pelo valor da linha; a fração das
 *    unidades ainda em estoque no depósito do recebimento entra no custo médio (movimento `cost_adjust`, quantidade
 *    zero) e a fração já vendida/baixada fica registrada como não absorvida. O último custo do SKU é atualizado só se
 *    ainda for o deste recebimento.
 */
export async function addCteFreight(ctx: Ctx, receiptId: string, link: Omit<CteLink, "mode">): Promise<{ mode: CteLink["mode"]; adjustments: CteItemAdjustment[] }> {
  const r = await ctx.store.getOrThrow("receipts", receiptId);
  assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
  const links: CteLink[] = r.cteLinks ?? [];
  const prior = links.find((l) => l.cteId === link.cteId);
  // já rateado no custo de entrada (lançado em conferência): a conclusão posterior levou o frete ao estoque
  if (prior?.mode === "cost") return { mode: "cost", adjustments: [] };
  if (r.status === "draft") {
    const patch = { cteLinks: [...links, { ...link, mode: "cost" as const }], cteFreight: (r.cteFreight ?? 0) + link.amount };
    const calc = await recompute(ctx, r, patch);
    await ctx.store.update("receipts", receiptId, { ...patch, ...omit(calc, "payable") });
    await audit(ctx, { module: "purchases", action: "receipt.cte_freight", entityType: "receipt", entityId: receiptId, summary: `Recebimento nº ${r.number}: frete do CT-e nº ${link.number} (${formatMoney(link.amount)}) rateado no custo de entrada dos itens (entra no estoque na conclusão)`, related: [`inbound_cte:${link.cteId}`] });
    return { mode: "cost", adjustments: [] };
  }
  assert(r.status === "confirmed", `Recebimento nº ${r.number} ${r.status === "cancelled" ? "cancelado" : "em conclusão"}: não recebe frete de CT-e.`);
  const items: ReceiptItem[] = r.items ?? [];
  const active = items.filter((it) => !it.ignore && it.skuId && it.receivedQty > 0);
  const shares = active.length ? allocate(link.amount, active.map((it) => it.lineValue ?? 0)) : [];
  const adjustments: CteItemAdjustment[] = [];
  const eff = effectsOf(r);
  for (const [i, it] of active.entries()) {
    const share = shares[i] ?? 0;
    if (share <= 0) continue;
    const idemKey = `cte:${link.cteId}:${receiptId}:${it.idx}`;
    const movId = detId("mov", idemKey);
    let mov = await ctx.store.get("stock_movements", movId);
    if (!mov && eff.updateStock) {
      const bal = await ctx.store.get("stock_balances", detId("bal", r.warehouseId, it.skuId!));
      const onHand = Math.max(0, bal?.physical ?? 0);
      const absorbed = roundDiv(share * Math.min(onHand, it.receivedQty), it.receivedQty);
      if (absorbed > 0) {
        await postMovements(ctx, [{ warehouseId: r.warehouseId, skuId: it.skuId!, qty: 0, type: "cost_adjust", totalCost: absorbed, originType: "freight_cte", originId: link.cteId, reason: `Frete do CT-e nº ${link.number} — recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""}`, idemKey }]);
        mov = await ctx.store.get("stock_movements", movId);
      }
    }
    const absorbed = mov?.totalCost ?? 0;
    adjustments.push({ idx: it.idx, skuId: it.skuId!, description: it.description, share, absorbed, notAbsorbed: share - absorbed, movementId: mov?.id ?? null });
    // último custo do SKU: só quando ainda é o custo deste recebimento (nenhuma entrada posterior o alterou)
    if (eff.updateCost) {
      const sku = await ctx.store.get("skus", it.skuId!);
      const landed = it.landedValue ?? lineTotal(it.unitCost, it.receivedQty);
      const before = it.landedUnitCost ?? it.unitCost;
      const after = roundDiv((landed + share) * QTY, it.receivedQty);
      const phId = detId("ph", "cte", link.cteId, it.skuId!);
      if (sku && sku.costAcquisition === before && after !== before && !(await ctx.store.get("price_history", phId))) {
        await ctx.store.update("skus", sku.id, { costAcquisition: after, costTotal: after + (sku.costAdditional ?? 0) });
        await ctx.store.create("price_history", { companyId: ctx.companyId, branchId: r.branchId, createdBy: ctx.user.id, skuId: sku.id, productId: sku.productId, priceTableId: null, field: "costAcquisition", oldValue: before, newValue: after, reason: `Frete do CT-e nº ${link.number} rateado no recebimento nº ${r.number}` }, phId).catch((e) => {
          if (!isConflict(e)) throw e;
        });
      }
    }
  }
  if (!prior) {
    await ctx.store.update("receipts", receiptId, { cteLinks: [...links, { ...link, mode: "adjustment" }], cteFreight: (r.cteFreight ?? 0) + link.amount });
    const abs = adjustments.reduce((a, x) => a + x.absorbed, 0);
    await audit(ctx, {
      module: "purchases", action: "receipt.cte_adjustment", entityType: "receipt", entityId: receiptId,
      summary: `Recebimento nº ${r.number} (concluído): frete do CT-e nº ${link.number} (${formatMoney(link.amount)}) lançado como ajuste de custo — ${formatMoney(abs)} no custo médio do estoque existente, ${formatMoney(link.amount - abs)} referente a unidades já baixadas (não absorvido)`,
      related: [`inbound_cte:${link.cteId}`],
    });
  }
  return { mode: "adjustment", adjustments };
}

/** Movimentos de estoque gerados pelo recebimento. */
export async function receiptMovements(store: Store, id: string) {
  return listAll(store, "stock_movements", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", id]] });
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

void addDays;
