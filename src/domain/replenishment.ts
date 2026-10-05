import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { getSetting } from "@/lib/core/settings";
import { audit } from "@/lib/core/audit";
import { addDays, dayRange, diffDays, today } from "@/lib/dates";
import { formatMoney, lineTotal, QTY } from "@/lib/money";
import { availableMap } from "./stock";
import { CONFIRMED, PENDING, abcClasses, computeReplenishment, type ReplenishmentResult } from "./purchase-calc";
import { createOrder, remainingQty } from "./purchases";
import { preferredSupplierProduct, supplierLabel } from "./suppliers";

/**
 * Planejamento de compras e reposição (Tela 46 / visão 12).
 * Fórmula em `computeReplenishment` (purchase-calc.ts). Esta camada reúne os dados reais:
 *  - disponível = físico − reservado dos depósitos de venda (kind "available") da filial;
 *  - consumo = vendas concluídas − devoluções da filial nos últimos N dias;
 *  - confirmado = saldo a receber de pedidos aprovados/enviados/parciais com previsão dentro do horizonte;
 *  - fora do horizonte (ou sem previsão) e rascunhos/análise aparecem separados.
 */

export interface ReplenishmentParams {
  branchId: string;
  coverageDays?: number;
  historyDays?: number;
  skuIds?: string[];
  supplierId?: string | null;
  categoryId?: string | null;
  deductDrafts?: boolean;
  refDate?: string;
  /** simulação (visão 12): prazo e custo estimados informados pelo usuário */
  leadOverride?: number | null;
  costOverride?: number | null;
}

export interface OpenOrderLine {
  orderId: string;
  number: number;
  status: string;
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  remaining: number;
  unitCost: number;
}

export interface ReplenishmentRow extends ReplenishmentResult {
  skuId: string;
  productId: string;
  sku: string;
  name: string;
  unitCode: string;
  categoryId: string | null;
  physical: number;
  reserved: number;
  available: number;
  minQty: number;
  targetQty: number;
  safetyQty: number;
  netConsumption: number;
  soldQty: number;
  returnedQty: number;
  hasHistory: boolean;
  historyDays: number;
  coverageDays: number;
  leadTimeDays: number;
  leadTimeSource: string;
  confirmedInHorizon: number;
  confirmedOutside: number;
  draftQty: number;
  confirmedLines: OpenOrderLine[];
  outsideLines: OpenOrderLine[];
  draftLines: OpenOrderLine[];
  supplierId: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  unitCost: number;
  supplierMinQty: number;
  multiple: number;
  belowMin: boolean;
  /** dias de cobertura do disponível ao consumo médio (null sem consumo) */
  daysOfCover: number | null;
  stockoutDate: string | null;
  nextArrival: string | null;
  shortageBeforeArrival: boolean;
  suggestedCost: number;
  /** classe ABC por receita no período de histórico (null = sem receita) */
  abc: "A" | "B" | "C" | null;
  /** situação para o selo: risco antes da entrega, a repor, completar dados (sem fornecedor/custo), coberto */
  situation: "risk" | "reorder" | "incomplete" | "ok";
  horizonEnd: string;
  supplierOptions: Array<{ supplierId: string; name: string; lastCost: number | null; leadTimeDays: number | null; minQty: number | null; multiple: number | null; preferred: boolean; supplierCode: string | null }>;
}

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await fn(ids.slice(i, i + 100))));
  return out;
}

export async function replenishmentSettings(store: Store, companyId: string, branchId: string | null) {
  return {
    coverageDays: Number(await getSetting(store, companyId, branchId, "replenishment.coverageDays", 14)),
    historyDays: Number(await getSetting(store, companyId, branchId, "replenishment.historyDays", 90)),
  };
}

/** Calcula a reposição de todos os SKUs de produto ativos da filial (ou dos informados). */
export async function computeBranchReplenishment(store: Store, companyId: string, p: ReplenishmentParams): Promise<ReplenishmentRow[]> {
  const cfg = await replenishmentSettings(store, companyId, p.branchId);
  const coverageDays = p.coverageDays ?? cfg.coverageDays;
  const historyDays = Math.max(1, p.historyDays ?? cfg.historyDays);
  const ref = p.refDate ?? today();
  const products = new Map((await listAll(store, "products", { filters: [["eq", "companyId", companyId], ["eq", "type", "product"]] })).map((x) => [x.id, x]));
  let skus = await listAll(store, "skus", { filters: [["eq", "companyId", companyId]] });
  skus = skus.filter((s) => s.active !== false && products.has(s.productId) && products.get(s.productId)!.active !== false);
  if (p.skuIds?.length) skus = skus.filter((s) => p.skuIds!.includes(s.id));
  if (p.categoryId) skus = skus.filter((s) => products.get(s.productId)?.categoryId === p.categoryId);
  const skuIds = skus.map((s) => s.id);
  if (!skuIds.length) return [];

  const avail = await availableMap(store, p.branchId, skuIds);
  const balances = await inChunks(skuIds, (c) => listAll(store, "stock_balances", { filters: [["eq", "skuId", c], ["eq", "branchId", p.branchId]] }));
  const whs = new Set((await listAll(store, "warehouses", { filters: [["eq", "branchId", p.branchId], ["eq", "kind", "available"]] })).map((w) => w.id));
  const param = new Map<string, { min: number; max: number; safety: number; multiple: number }>();
  for (const b of balances) {
    if (!whs.has(b.warehouseId)) continue;
    const cur = param.get(b.skuId) ?? { min: 0, max: 0, safety: 0, multiple: 0 };
    cur.min += b.minQty ?? 0;
    cur.max += b.maxQty ?? 0;
    cur.safety += b.safetyQty ?? 0;
    cur.multiple = Math.max(cur.multiple, b.reorderMultiple ?? 0);
    param.set(b.skuId, cur);
  }

  // consumo líquido: vendas concluídas − devoluções da filial no período [ref − N, ref)
  const { start } = dayRange(addDays(ref, -historyDays), ref);
  const { start: end } = dayRange(ref, ref);
  const saleItems = await listAll(store, "sale_items", { filters: [["eq", "companyId", companyId], ["eq", "branchId", p.branchId], ["gte", "completedAt", start], ["lt", "completedAt", end]] });
  const sold = new Map<string, number>();
  const revenue = new Map<string, number>();
  const saleIds = new Set<string>();
  for (const si of saleItems) saleIds.add(si.saleId);
  const cancelled = new Set<string>();
  const saleIdList = [...saleIds];
  for (const s of await inChunks(saleIdList, (c) => listAll(store, "sales", { filters: [["eq", "id", c]] }))) if (s.status !== "completed") cancelled.add(s.id);
  for (const si of saleItems) {
    if (cancelled.has(si.saleId)) continue;
    sold.set(si.skuId, (sold.get(si.skuId) ?? 0) + si.qty);
    revenue.set(si.skuId, (revenue.get(si.skuId) ?? 0) + (si.total ?? 0));
  }
  const abc = abcClasses(revenue, Number(await getSetting(store, companyId, p.branchId, "abc.limitA", 8000)), Number(await getSetting(store, companyId, p.branchId, "abc.limitB", 9500)));
  const returned = new Map<string, number>();
  for (const ri of await listAll(store, "return_items", { filters: [["eq", "companyId", companyId], ["eq", "branchId", p.branchId], ["gte", "completedAt", start], ["lt", "completedAt", end]] })) returned.set(ri.skuId, (returned.get(ri.skuId) ?? 0) + ri.qty);

  // pedidos em aberto da filial
  const openOrders = await listAll(store, "purchase_orders", { filters: [["eq", "companyId", companyId], ["eq", "branchId", p.branchId], ["eq", "status", [...CONFIRMED, ...PENDING]]] });
  const orderById = new Map(openOrders.map((o) => [o.id, o]));
  const orderItemsAll = await inChunks(openOrders.map((o) => o.id), (c) => listAll(store, "purchase_order_items", { filters: [["eq", "orderId", c]] }));
  const linesBySku = new Map<string, Array<OpenOrderLine & { kind: "confirmed" | "pending" }>>();
  for (const it of orderItemsAll) {
    const o = orderById.get(it.orderId)!;
    const rem = remainingQty(it);
    if (rem <= 0) continue;
    const arr = linesBySku.get(it.skuId) ?? [];
    arr.push({ orderId: o.id, number: o.number, status: o.status, supplierId: o.supplierId, supplierName: supplierLabel(o.supplierSnapshot), expectedDate: o.expectedDate ?? null, remaining: rem, unitCost: it.unitCost, kind: CONFIRMED.includes(o.status) ? "confirmed" : "pending" });
    linesBySku.set(it.skuId, arr);
  }

  // fornecedores
  const sps = await inChunks(skuIds, (c) => listAll(store, "supplier_products", { filters: [["eq", "skuId", c]] }));
  const spBySku = new Map<string, Doc[]>();
  for (const sp of sps) spBySku.set(sp.skuId, [...(spBySku.get(sp.skuId) ?? []), sp]);
  const supplierIds = [...new Set(sps.map((s) => s.supplierId))];
  const suppliers = new Map((await inChunks(supplierIds, (c) => listAll(store, "suppliers", { filters: [["eq", "id", c]] }))).map((s) => [s.id, s]));

  const rows: ReplenishmentRow[] = [];
  for (const sku of skus) {
    const a = avail.get(sku.id) ?? { physical: 0, reserved: 0, available: 0, avgCost: 0 };
    const pr = param.get(sku.id) ?? { min: 0, max: 0, safety: 0, multiple: 0 };
    const candidates = (spBySku.get(sku.id) ?? []).filter((x) => suppliers.get(x.supplierId)?.status !== "inactive");
    let sp: Doc | null = null;
    if (p.supplierId) sp = candidates.find((c) => c.supplierId === p.supplierId) ?? null;
    else sp = await preferredSupplierProduct(store, sku.id, candidates);
    if (p.supplierId && !sp) continue;
    const supplier = sp ? suppliers.get(sp.supplierId) : null;
    const leadTimeDays = p.leadOverride ?? sp?.leadTimeDays ?? supplier?.leadTimeDays ?? 0;
    const leadTimeSource = p.leadOverride != null ? "simulação (informado)" : sp?.leadTimeDays != null ? "produto × fornecedor" : supplier?.leadTimeDays != null ? "cadastro do fornecedor" : "não informado (0)";
    const horizonEnd = addDays(ref, leadTimeDays + coverageDays);
    const lines = linesBySku.get(sku.id) ?? [];
    const confirmedLines = lines.filter((l) => l.kind === "confirmed" && l.expectedDate && l.expectedDate <= horizonEnd);
    const outsideLines = lines.filter((l) => l.kind === "confirmed" && !(l.expectedDate && l.expectedDate <= horizonEnd));
    const draftLines = lines.filter((l) => l.kind === "pending");
    const soldQty = sold.get(sku.id) ?? 0;
    const returnedQty = returned.get(sku.id) ?? 0;
    const netConsumption = Math.max(0, soldQty - returnedQty);
    const hasHistory = soldQty > 0;
    const confirmedInHorizon = confirmedLines.reduce((x, l) => x + l.remaining, 0);
    const draftQty = draftLines.reduce((x, l) => x + l.remaining, 0);
    const multiple = sp?.multiple || pr.multiple || 0;
    const supplierMinQty = sp?.minQty || 0;
    const r = computeReplenishment({ netConsumption, historyDays, hasHistory, leadTimeDays, coverageDays, minQty: pr.min, targetQty: pr.max, safetyQty: pr.safety, available: a.available, confirmedInHorizon, draftQty, supplierMinQty, multiple, deductDrafts: p.deductDrafts });
    const daily = hasHistory ? netConsumption / historyDays : 0;
    const daysOfCover = daily > 0 ? Math.floor(Math.max(0, a.available) / daily) : null;
    const stockoutDate = daysOfCover != null ? addDays(ref, daysOfCover) : null;
    const arrivals = confirmedLines.map((l) => l.expectedDate!).sort();
    const nextArrival = arrivals[0] ?? null;
    const reference = nextArrival ?? addDays(ref, leadTimeDays);
    const unitCost = p.costOverride ?? sp?.lastCost ?? sku.costAcquisition ?? 0;
    const shortage = stockoutDate != null && stockoutDate < reference;
    rows.push({
      ...r,
      skuId: sku.id, productId: sku.productId, sku: sku.sku, name: sku.name ?? sku.sku, unitCode: sku.unitCode ?? "UN", categoryId: products.get(sku.productId)?.categoryId ?? null,
      physical: a.physical, reserved: a.reserved, available: a.available, minQty: pr.min, targetQty: pr.max, safetyQty: pr.safety, netConsumption, soldQty, returnedQty, hasHistory, historyDays, coverageDays,
      leadTimeDays, leadTimeSource, confirmedInHorizon, confirmedOutside: outsideLines.reduce((x, l) => x + l.remaining, 0), draftQty, confirmedLines, outsideLines, draftLines,
      supplierId: sp?.supplierId ?? null, supplierName: supplier ? supplierLabel(supplier) : null, supplierCode: sp?.supplierCode ?? null, unitCost, supplierMinQty, multiple,
      belowMin: pr.min > 0 && a.available <= pr.min, daysOfCover, stockoutDate, nextArrival, shortageBeforeArrival: shortage,
      suggestedCost: lineTotal(unitCost, r.suggested),
      abc: abc.get(sku.id) ?? null,
      situation: !sp || !unitCost ? (r.suggested > 0 || r.grossNeed > 0 ? "incomplete" : "ok") : shortage && (r.grossNeed > 0 || outsideLines.length > 0) ? "risk" : r.suggested > 0 ? "reorder" : "ok",
      horizonEnd,
      supplierOptions: candidates.map((c) => ({ supplierId: c.supplierId, name: supplierLabel(suppliers.get(c.supplierId)), lastCost: c.lastCost ?? null, leadTimeDays: c.leadTimeDays ?? suppliers.get(c.supplierId)?.leadTimeDays ?? null, minQty: c.minQty ?? null, multiple: c.multiple ?? null, preferred: Boolean(c.preferred), supplierCode: c.supplierCode ?? null })),
    });
  }
  return rows.sort((x, y) => Number(y.suggested > 0) - Number(x.suggested > 0) || Number(y.shortageBeforeArrival) - Number(x.shortageBeforeArrival) || x.name.localeCompare(y.name, "pt-BR"));
}

export interface DraftLine {
  skuId: string;
  qty: number;
  supplierId: string;
  unitCost: number;
}

/**
 * Cria pedidos em rascunho agrupados por fornecedor a partir das linhas selecionadas (quantidade editável),
 * gravando o cálculo de origem em `originData` de cada pedido.
 */
export async function createDraftsFromReplenishment(ctx: Ctx, lines: DraftLine[], opts: { idemKey: string; coverageDays?: number }) {
  requirePerm(ctx, "purchases", "create");
  const branchId = requireBranch(ctx);
  const valid = lines.filter((l) => l.qty > 0 && l.supplierId);
  assert(valid.length > 0, "Selecione ao menos um item com fornecedor e quantidade.");
  const rows = await computeBranchReplenishment(ctx.store, ctx.companyId, { branchId, skuIds: valid.map((l) => l.skuId), coverageDays: opts.coverageDays });
  const bySku = new Map(rows.map((r) => [r.skuId, r]));
  const groups = new Map<string, DraftLine[]>();
  for (const l of valid) groups.set(l.supplierId, [...(groups.get(l.supplierId) ?? []), l]);
  const runId = detId("replenishment-run", opts.idemKey);
  const orders: Doc[] = [];
  for (const [supplierId, ls] of groups) {
    const supplier = await ctx.store.getOrThrow("suppliers", supplierId);
    const lead = Math.max(...ls.map((l) => bySku.get(l.skuId)?.supplierOptions.find((o) => o.supplierId === supplierId)?.leadTimeDays ?? supplier.leadTimeDays ?? 0));
    const o = await createOrder(ctx, {
      supplierId,
      expectedDate: addDays(today(), lead),
      items: ls.map((l) => ({ skuId: l.skuId, qty: l.qty, unitCost: l.unitCost })),
      paymentTermId: supplier.paymentTermId ?? null,
      paymentTermsText: supplier.paymentTermsText ?? null,
      origin: "replenishment",
      originId: runId,
      notes: "Gerado pelo planejamento de reposição.",
      originData: {
        runId,
        at: new Date().toISOString(),
        by: ctx.user.name,
        items: ls.map((l) => {
          const r = bySku.get(l.skuId);
          return r
            ? { skuId: l.skuId, sku: r.sku, qty: l.qty, suggested: r.suggested, available: r.available, confirmedInHorizon: r.confirmedInHorizon, confirmedOutside: r.confirmedOutside, draftQty: r.draftQty, target: r.target, grossNeed: r.grossNeed, horizonDays: r.horizonDays, netConsumption: r.netConsumption, historyDays: r.historyDays, limitation: r.limitation }
            : { skuId: l.skuId, qty: l.qty };
        }),
      },
      idemKey: `replenishment:${opts.idemKey}:${supplierId}`,
    });
    orders.push(o);
  }
  await audit(ctx, { module: "purchases", action: "replenishment.drafts", entityType: "replenishment", entityId: runId, summary: `Reposição: ${orders.length} pedido(s) em rascunho criado(s) — ${orders.map((o) => `nº ${o.number} (${formatMoney(o.total)})`).join(", ")}`, related: orders.map((o) => `purchase_order:${o.id}`) });
  return orders;
}

export function daysUntil(date: string | null, ref = today()) {
  return date ? diffDays(ref, date) : null;
}

void QTY;
