import { detId, findOne, isConflict, listAll, sha256 } from "@/lib/db";
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
import { CONFIRMED, netUnitCost } from "./purchase-calc";
import { orderItems, refreshOrderReceipts, remainingQty } from "./purchases";
import { createSupplier, findSupplierByDoc, supplierLabel } from "./suppliers";

/**
 * Recebimento de mercadorias (Tela 29).
 *  - Importação real de XML de NF-e (upload) ou chave + itens dos pedidos (sem XML).
 *  - Mesma chave/XML não duplica: índice único `receipts.scopeKey` = empresa|nfe|chave.
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
export function receiptItemStatus(it: ReceiptItem, divergences: Divergence[]): "ok" | "divergence" | "pending" | "ignored" {
  if (it.ignore) return "ignored";
  if (!it.skuId || !it.checked) return divergences.some((d) => d.idx === it.idx && d.kind !== "note") && it.checked ? "divergence" : "pending";
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

async function orderLines(store: Store, orderIds: string[]) {
  const out: Array<Doc & { order: Doc; remaining: number; netUnit: number }> = [];
  for (const id of orderIds) {
    const o = await store.get("purchase_orders", id);
    if (!o) continue;
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
export function computeReceipt(r: { items: ReceiptItem[]; freight: number; otherExpenses: number; discount: number; invoicedTotal?: number | null; hasXml: boolean }, lines: Array<{ id: string; skuId: string; remaining: number; netUnit: number; order: { id: string; number: number } }>): ReceiptComputation {
  const pool = new Map<string, Array<{ id: string; remaining: number; netUnit: number; order: { id: string; number: number } }>>();
  for (const l of lines) pool.set(l.skuId, [...(pool.get(l.skuId) ?? []), { ...l }]);
  const divergences: Divergence[] = [];
  const items = r.items.map((it) => ({ ...it }));
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
    for (const l of avail) {
      if (left <= 0) break;
      const q = Math.min(left, l.remaining);
      if (q <= 0) continue;
      it.allocations.push({ orderId: l.order.id, orderItemId: l.id, orderNumber: l.order.number, qty: q });
      l.remaining -= q;
      left -= q;
    }
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
  for (const it of active) it.lineValue = it.receivedQty === it.invoicedQty && it.unitCost === it.invoiceUnitCost && it.invoicedValue > 0 ? it.invoicedValue : lineTotal(it.unitCost, it.receivedQty);
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
  if (r.invoicedTotal != null && r.invoicedTotal !== dueTotal) divergences.push({ kind: "value", message: `Valor faturado ${formatMoney(r.invoicedTotal)} × valor devido pelo recebido ${formatMoney(dueTotal)} (diferença ${formatMoney(r.invoicedTotal - dueTotal)}).` });
  return { items, productsTotal, dueTotal, divergences };
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

async function recompute(ctx: Ctx, r: Doc, patch: Record<string, any> = {}) {
  const merged = { ...r, ...patch };
  const lines = await orderLines(ctx.store, merged.orderIds ?? []);
  const comp = computeReceipt({ items: merged.items ?? [], freight: merged.freight ?? 0, otherExpenses: merged.otherExpenses ?? 0, discount: merged.discount ?? 0, invoicedTotal: merged.xmlFileId ? merged.invoicedTotal : null, hasXml: Boolean(merged.xmlFileId) }, lines as any);
  const term = merged.paymentTermId ? await ctx.store.get("payment_terms", merged.paymentTermId) : null;
  const amount = effectsOf(merged).createPayable ? payableAmount({ dueTotal: comp.dueTotal, invoicedTotal: merged.invoicedTotal, differenceAction: merged.differenceAction }) : 0;
  const base = merged.nfeIssueDate ? toLocalDate(merged.nfeIssueDate) : today();
  const inst = buildReceiptInstallments(amount, merged.emitter?.duplicatas ?? [], term ? { installments: term.installments, firstDueDays: term.firstDueDays, intervalDays: term.intervalDays } : null, base);
  const divergences = [...comp.divergences];
  if (inst.rescaled) divergences.push({ kind: "installments", message: `Duplicatas do XML somam ${formatMoney((merged.emitter?.duplicatas ?? []).reduce((a: number, d: any) => a + d.vDup, 0))}; parcelas ajustadas ao valor a pagar ${formatMoney(amount)} mantendo os vencimentos.` });
  if (merged.recipientMismatch) divergences.push({ kind: "recipient", message: merged.recipientMismatch });
  return {
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
export async function importNfeXml(ctx: Ctx, input: { xml: string; fileName?: string | null; warehouseId?: string | null; orderIds?: string[] | null; createSupplier?: boolean }) {
  requireReceive(ctx);
  const branchId = requireBranch(ctx);
  const nfe = parseNfeXml(input.xml);
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
    supplier = await createSupplier(
      ctx,
      { personType: nfe.emitter.cnpj ? "PJ" : "PF", doc: emitterDoc, name: nfe.emitter.name, tradeName: nfe.emitter.tradeName, ie: nfe.emitter.ie, addresses: [{ type: "principal", ...Object.fromEntries(Object.entries(nfe.emitter.address).map(([k, v]) => [k, v ?? undefined])) }], status: "active" },
      { source: `a partir do XML da NF-e ${nfe.number}` },
    );
  }
  assert(supplier.status !== "inactive", `Fornecedor ${supplierLabel(supplier)} está inativo — reative antes de receber.`);
  const orderIds = input.orderIds?.length ? input.orderIds : (await openOrdersFor(ctx.store, ctx.companyId, supplier.id, branchId)).map((o) => o.id);
  const lines = await orderLines(ctx.store, orderIds);
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
    paymentTermId: firstOrder?.paymentTermId ?? supplier.paymentTermId ?? null, emitter: { ...nfe.emitter, duplicatas: nfe.duplicatas, protocol: nfe.protocol, authorized: nfe.authorized, nature: nfe.nature, totals: nfe.totals },
    differenceAction: "adjust_to_due", notes: null, scopeKey: scopeFor(ctx.companyId, nfe.key), searchText: searchable(String(number), nfe.number, nfe.key, supplier.name, supplier.tradeName),
    ...(await financialDefaults(ctx, firstOrder ?? null, nfe.emitter.address?.uf ?? null)),
  };
  const draft = { ...base, xmlFileId: "pending" } as any;
  const calc = await recompute(ctx, draft);
  let r: Doc;
  try {
    r = await ctx.store.create("receipts", { ...base, ...omit(calc, "payable") }, detId("receipt", base.scopeKey));
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
    summary: `Recebimento nº ${number}: XML da NF-e ${nfe.number}/${nfe.series} de ${supplierLabel(supplier)} importado (${items.length} itens, ${formatMoney(nfe.totals.vNF)}); ${items.filter((i) => !i.skuId).length} item(ns) sem associação`,
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
  const orders = await Promise.all(input.orderIds.map((id) => ctx.store.getOrThrow("purchase_orders", id)));
  for (const o of orders) {
    assert(o.supplierId === supplier.id, `Pedido nº ${o.number} é de outro fornecedor.`);
    assert(CONFIRMED.includes(o.status), `Pedido nº ${o.number} não está aprovado/enviado (situação atual: ${o.status}).`);
    assert(o.branchId === branchId, `Pedido nº ${o.number} é de outra filial.`);
  }
  const lines = await orderLines(ctx.store, input.orderIds);
  const bySku = new Map<string, { qty: number; netUnit: number; description: string; unitCode: string; sku: string | null; supplierCode: string | null }>();
  for (const l of lines) {
    if (l.remaining <= 0) continue;
    const cur = bySku.get(l.skuId);
    if (cur) cur.qty += l.remaining;
    else bySku.set(l.skuId, { qty: l.remaining, netUnit: l.netUnit, description: l.description, unitCode: l.unitCode, sku: (await ctx.store.get("skus", l.skuId))?.sku ?? null, supplierCode: l.supplierCode ?? null });
  }
  const items: ReceiptItem[] = [...bySku.entries()].map(([skuId, v], i) => ({
    idx: i + 1, cProd: v.supplierCode, conversionFactor: QTY, invoicedQty: v.qty, invoicedValue: lineTotal(v.netUnit, v.qty), invoiceUnitCost: v.netUnit, skuId, sku: v.sku, description: v.description, unitCode: v.unitCode,
    mapping: "order", expectedQty: v.qty, receivedQty: v.qty, unitCost: v.netUnit, ignore: false, divergence: null,
  }));
  assert(items.length || !orders.length, "Os pedidos selecionados não têm saldo a receber.");
  const number = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  const freight = orders.filter((o) => !(o.receivedValue > 0)).reduce((a, o) => a + (o.freight ?? 0), 0);
  const other = orders.filter((o) => !(o.receivedValue > 0)).reduce((a, o) => a + (o.otherExpenses ?? 0), 0);
  const base = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId: input.warehouseId || orders[0]?.warehouseId || (await defaultWarehouse(ctx.store, branchId)).id, supplierId: supplier.id,
    orderIds: input.orderIds, nfeKey: key || null, nfeNumber: input.nfeNumber || (key ? String(Number(key.slice(25, 34))) : null), nfeSeries: input.nfeSeries || (key ? String(Number(key.slice(22, 25))) : null),
    nfeIssueDate: input.issueDate ? `${input.issueDate}T12:00:00.000Z` : null, xmlFileId: null, xmlHash: null, status: "draft", items, freight, otherExpenses: other, discount: 0,
    invoicedTotal: input.invoicedTotal ?? null, paymentTermId: orders[0]?.paymentTermId ?? supplier.paymentTermId ?? null, emitter: { cnpj: supplier.doc, name: supplier.name, tradeName: supplier.tradeName, duplicatas: [] },
    differenceAction: "adjust_to_due", notes: null, scopeKey, searchText: searchable(String(number), input.nfeNumber, key, supplier.name, supplier.tradeName),
    ...(await financialDefaults(ctx, orders[0] ?? null, supplier.addresses?.[0]?.uf ?? null)),
  };
  const calc = await recompute(ctx, base as any);
  let r: Doc;
  try {
    r = await ctx.store.create("receipts", { ...base, ...omit(calc, "payable") }, detId("receipt", scopeKey));
  } catch (e) {
    if (isConflict(e)) {
      const ex = await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
      if (ex && !key) return ex;
      throw new BusinessError(`Chave já registrada${ex ? ` no recebimento nº ${ex.number}` : ""}.`, "duplicate", { id: ex?.id });
    }
    throw e;
  }
  await audit(ctx, { module: "purchases", action: "receipt.create", entityType: "receipt", entityId: r.id, summary: `Recebimento nº ${number} aberto sem XML${key ? ` (chave ${key})` : ""} — ${supplierLabel(supplier)}, ${items.length} item(ns) do saldo de ${orders.length} pedido(s)`, related: [`supplier:${supplier.id}`, ...input.orderIds.map((o) => `purchase_order:${o}`)] });
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
}

export async function updateReceipt(ctx: Ctx, id: string, input: ReceiptUpdate) {
  requireReceive(ctx);
  const r = await getReceipt(ctx, id);
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
  const orderIds = input.orderIds ?? r.orderIds ?? [];
  for (const oid of orderIds) {
    const o = await ctx.store.getOrThrow("purchase_orders", oid);
    assert(o.supplierId === r.supplierId, `Pedido nº ${o.number} é de outro fornecedor.`);
    assert(o.branchId === r.branchId, `Pedido nº ${o.number} é de outra filial.`);
    assert(CONFIRMED.includes(o.status) || (r.orderIds ?? []).includes(oid), `Pedido nº ${o.number} não está aprovado/enviado.`);
  }
  if (input.warehouseId) {
    const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
    assert(wh.branchId === r.branchId, "Depósito de outra filial.");
  }
  for (const [k, v] of [["Frete", input.freight], ["Outras despesas", input.otherExpenses], ["Desconto", input.discount]] as const) assert(v == null || (Number.isInteger(v) && v >= 0), `${k} inválido.`);
  const patch: Record<string, any> = {
    items,
    orderIds,
    ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
    ...(input.freight != null ? { freight: input.freight } : {}),
    ...(input.otherExpenses != null ? { otherExpenses: input.otherExpenses } : {}),
    ...(input.discount != null ? { discount: input.discount } : {}),
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
  await audit(ctx, { module: "purchases", action: "receipt.update", entityType: "receipt", entityId: id, summary: `Recebimento nº ${r.number}: conferência atualizada (devido ${formatMoney(calc.dueTotal)}, ${calc.divergences.length} divergência(s))` });
  return u;
}

export async function cancelReceipt(ctx: Ctx, id: string, reason: string) {
  requireReceive(ctx);
  assert(reason?.trim(), "Informe o motivo.");
  const r = await getReceipt(ctx, id);
  assert(r.status === "draft", "Somente recebimento em conferência pode ser cancelado.");
  // libera a chave para nova importação, preservando o registro cancelado
  await ctx.store.update("receipts", id, { status: "cancelled", scopeKey: `${r.scopeKey}|cancelled|${Date.now()}` });
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
 * Confirma o recebimento. Cada efeito é idempotente (movimentos por idemKey, título por idemKey,
 * saldo dos pedidos recalculado a partir dos recebimentos confirmados), então uma retentativa
 * após falha conclui sem duplicar. Durante os efeitos o documento fica "confirmando" (não editável).
 */
export async function confirmReceipt(ctx: Ctx, id: string) {
  requireReceive(ctx);
  let r = await getReceipt(ctx, id);
  if (r.status === "confirmed") return r;
  assert(["draft", "confirming"].includes(r.status), "Recebimento cancelado.");
  if (r.status === "draft") {
    const calc = await recompute(ctx, r);
    r = await ctx.store.update("receipts", id, omit(calc, "payable"));
    const blockers = confirmBlockers(r);
    if (blockers.length) throw new BusinessError(blockers.join(" "), "receipt_blocked");
    r = await ctx.store.update("receipts", id, { status: "confirming" });
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
        await ctx.store.create("price_history", { companyId: ctx.companyId, branchId: r.branchId, createdBy: ctx.user.id, skuId: sku.id, productId: sku.productId, priceTableId: null, field: "costAcquisition", oldValue: sku.costAcquisition ?? 0, newValue: newCost, reason: `Recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""} — custo com frete/despesas rateados` }, phId).catch((e) => {
          if (!isConflict(e)) throw e;
        });
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
      notes: r.differenceAction === "pay_invoiced" ? `Pago pelo valor faturado (${formatMoney(r.invoicedTotal)}) — divergência registrada: ${r.notes ?? ""}` : null,
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
