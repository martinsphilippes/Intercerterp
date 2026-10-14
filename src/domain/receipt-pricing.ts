import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting } from "@/lib/core/settings";
import { nowIso } from "@/lib/dates";
import { marginBps, roundDiv } from "@/lib/money";
import { defaultPriceTableId } from "./pricing";
import { getReceipt, type ReceiptItem } from "./receipts";
import { applyPriceChanges, commercialRound, loadPriceTargets, previewLine, previewTotals, rulePrice, type CostOverrides, type PriceEnding, type PriceLine } from "./price-adjust";

/**
 * Precificação após a entrada (COM-07): a partir de um recebimento CONFIRMADO, lista os itens com o custo anterior × o
 * custo desta entrada (custo de entrada com frete/despesas rateados + custos adicionais do SKU), o preço atual, a margem
 * antes da entrada, a margem com o custo novo e a sugestão de preço (margem padrão ou margem atual do produto). Nada é
 * gravado sem a prévia: a aplicação usa o motor compartilhado (`applyPriceChanges`) e marca o recebimento como precificado.
 */

export type PricingMode = "keep_margin" | "target_margin";

export interface PricingDefaults {
  mode: PricingMode;
  targetMarginBps: number;
  ending: PriceEnding;
}

export async function pricingDefaults(ctx: Ctx): Promise<PricingDefaults> {
  const [mode, target, ending] = await Promise.all([
    getSetting<string>(ctx.store, ctx.companyId, ctx.branchId, "purchase.pricingMode", "keep_margin"),
    getSetting<number>(ctx.store, ctx.companyId, ctx.branchId, "pricing.defaultMarginBps", 3000),
    getSetting<string>(ctx.store, ctx.companyId, ctx.branchId, "purchase.priceEnding", "none"),
  ]);
  return {
    mode: mode === "target_margin" ? "target_margin" : "keep_margin",
    targetMarginBps: Number.isInteger(target) && target >= 0 && target < 10000 ? target : 3000,
    ending: (["none", "00", "90", "99"].includes(ending) ? ending : "none") as PriceEnding,
  };
}

export interface ReceiptPricingLine extends PriceLine {
  /** quantidade recebida (milésimos, unidade interna) */
  qty: number;
  /** custo de referência antes desta entrada (custo total do SKU) */
  oldCost: number | null;
  /** custo de entrada desta nota (com rateios) */
  entryCost: number;
  /** variação do custo (pontos-base) */
  costVariationBps: number | null;
  /** margem do preço atual com o custo anterior (antes da entrada) */
  marginBeforeEntry: number | null;
  /** preço sugerido pela regra (antes de qualquer ajuste manual) */
  suggestedPrice: number | null;
}

function requirePricing(ctx: Ctx) {
  requirePerm(ctx, "purchases", "view");
  requirePerm(ctx, "products", "view");
  requireAction(ctx, "purchase.pricing");
}

async function confirmedReceipt(ctx: Ctx, receiptId: string) {
  const r = await getReceipt(ctx, receiptId);
  if (r.status !== "confirmed") throw new BusinessError(`Recebimento nº ${r.number} ainda não foi concluído: a precificação fica disponível depois da entrada.`, "not_confirmed");
  return r;
}

/** Itens do recebimento agrupados por SKU (quantidade somada; custo de entrada ponderado pelo valor das linhas). */
function receiptSkus(r: Doc): Array<{ skuId: string; qty: number; entryCost: number; description: string }> {
  const by = new Map<string, { skuId: string; qty: number; value: number; description: string }>();
  for (const it of (r.items ?? []) as ReceiptItem[]) {
    if (it.ignore || !it.skuId || !(it.receivedQty > 0)) continue;
    const unit = it.landedUnitCost ?? it.unitCost;
    const value = it.landedValue ?? roundDiv(unit * it.receivedQty, 1000);
    const cur = by.get(it.skuId) ?? { skuId: it.skuId, qty: 0, value: 0, description: it.description };
    cur.qty += it.receivedQty;
    cur.value += value;
    by.set(it.skuId, cur);
  }
  return [...by.values()].map((x) => ({ skuId: x.skuId, qty: x.qty, entryCost: roundDiv(x.value * 1000, x.qty), description: x.description }));
}

/**
 * Custo anterior à entrada: o histórico gravado pela confirmação (ids determinísticos) guarda o custo total antes da
 * alteração; sem histórico (custo não mudou ou efeito "atualizar custo" desmarcado), vale o custo total atual do SKU.
 */
async function costBefore(ctx: Ctx, receiptId: string, sku: Doc): Promise<number> {
  const total = await ctx.store.get("price_history", detId("ph", "receipt", receiptId, sku.id, "costTotal"));
  if (total && total.companyId === ctx.companyId) return total.oldValue ?? 0;
  const acq = await ctx.store.get("price_history", detId("ph", "receipt", receiptId, sku.id));
  if (acq && acq.companyId === ctx.companyId) return (acq.oldValue ?? 0) + (sku.costAdditional ?? 0);
  return sku.costTotal ?? sku.costAcquisition ?? 0;
}

/** Dados da tela de precificação (sugestões com a regra informada ou a padrão). Nada é gravado. */
export async function receiptPricing(ctx: Ctx, receiptId: string, opts: Partial<PricingDefaults> & { priceTableId?: string | null } = {}) {
  requirePricing(ctx);
  const r = await confirmedReceipt(ctx, receiptId);
  const defaults = await pricingDefaults(ctx);
  const mode = opts.mode ?? defaults.mode;
  const target = opts.targetMarginBps ?? defaults.targetMarginBps;
  const ending = opts.ending ?? defaults.ending;
  assert(Number.isInteger(target) && target >= 0 && target < 10000, "A margem padrão deve estar entre 0% e 99,99%.");
  const priceTableId = opts.priceTableId || (await defaultPriceTableId(ctx.store, ctx.companyId));
  assert(priceTableId, "Cadastre uma tabela de preço padrão em Cadastros auxiliares.");
  const items = receiptSkus(r);
  const { table, targets } = await loadPriceTargets(ctx, items.map((i) => i.skuId), priceTableId);
  const skus: Doc[] = [];
  for (let i = 0; i < items.length; i += 100) skus.push(...(await listAll(ctx.store, "skus", { filters: [["eq", "id", items.slice(i, i + 100).map((x) => x.skuId)]] })));
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const rule = mode === "target_margin" ? ({ kind: "margin", marginBps: target } as const) : ({ kind: "keep_margin", fallbackMarginBps: target } as const);
  const lines: ReceiptPricingLine[] = [];
  const costs: CostOverrides = {};
  for (const it of items) {
    const t0 = targets.get(it.skuId);
    const sku = skuById.get(it.skuId);
    if (!t0 || !sku) continue;
    const oldCost = await costBefore(ctx, r.id, sku);
    const newCost = it.entryCost + (sku.costAdditional ?? 0);
    costs[it.skuId] = { cost: newCost, oldCost };
    const t = { ...t0, cost: newCost };
    const rp = rulePrice(rule, { cost: newCost, currentPrice: t.currentPrice, oldCost });
    const suggested = rp.price == null ? null : commercialRound(rp.price, ending, "up");
    lines.push({
      ...previewLine(t, suggested, rp.note),
      qty: it.qty,
      oldCost,
      entryCost: it.entryCost,
      costVariationBps: oldCost > 0 ? roundDiv((newCost - oldCost) * 10000, oldCost) : null,
      marginBeforeEntry: t.currentPrice ? marginBps(t.currentPrice, oldCost) : null,
      suggestedPrice: suggested,
    });
  }
  return {
    receipt: { id: r.id, number: r.number as number, nfeNumber: (r.nfeNumber as string | null) ?? null, supplierId: r.supplierId as string, branchId: r.branchId as string, confirmedAt: r.confirmedAt as string | null, pricingStatus: (r.pricingStatus as string | null) ?? "pending", pricedAt: (r.pricedAt as string | null) ?? null, pricedBy: (r.pricedBy as string | null) ?? null },
    table: { id: table.id, name: table.name as string },
    settings: { mode, targetMarginBps: target, ending },
    defaults,
    lines,
    costs,
    totals: previewTotals(lines),
  };
}

/** Prévia dos preços escolhidos pelo usuário (com os custos desta entrada). */
export async function previewReceiptPricing(ctx: Ctx, receiptId: string, input: { priceTableId: string; lines: Array<{ skuId: string; newPrice: number | null }> }) {
  const data = await receiptPricing(ctx, receiptId, { priceTableId: input.priceTableId });
  const bySku = new Map(data.lines.map((l) => [l.skuId, l]));
  const { targets } = await loadPriceTargets(ctx, input.lines.map((l) => l.skuId), input.priceTableId);
  const lines: PriceLine[] = [];
  for (const l of input.lines) {
    const t0 = targets.get(l.skuId);
    const base = bySku.get(l.skuId);
    if (!t0 || !base) continue;
    lines.push(previewLine({ ...t0, cost: data.costs[l.skuId]?.cost ?? t0.cost }, l.newPrice));
  }
  return { lines, totals: previewTotals(lines) };
}

/**
 * Aplica os preços revisados do recebimento (somente itens do próprio recebimento), grava o histórico com o motivo
 * "Precificação após a entrada — recebimento nº N" e marca o recebimento como precificado. Idempotente por `idemKey`.
 */
export async function applyReceiptPricing(ctx: Ctx, receiptId: string, input: { priceTableId: string; lines: Array<{ skuId: string; newPrice: number; expectedPrice: number | null }>; idemKey: string; note?: string | null }) {
  requirePricing(ctx);
  const r = await confirmedReceipt(ctx, receiptId);
  const allowed = new Set(receiptSkus(r).map((i) => i.skuId));
  for (const l of input.lines) assert(allowed.has(l.skuId), "Só é possível precificar itens deste recebimento.");
  const reason = `Precificação após a entrada — recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`.slice(0, 300);
  const result = await applyPriceChanges(ctx, {
    via: "purchase.pricing",
    priceTableId: input.priceTableId,
    lines: input.lines,
    reason,
    idemKey: `receipt:${r.id}:${input.idemKey}`,
    related: [`receipt:${r.id}`, `supplier:${r.supplierId}`],
    entity: { type: "receipt", id: r.id },
  });
  if (!result.replayed && (result.applied > 0 || result.same > 0) && r.pricingStatus !== "done") {
    await ctx.store.update("receipts", r.id, { pricingStatus: "done", pricedAt: nowIso(), pricedBy: ctx.user.id });
    await audit(ctx, { module: "purchases", action: "receipt.pricing", entityType: "receipt", entityId: r.id, summary: `Recebimento nº ${r.number} precificado: ${result.applied} preço(s) alterado(s)`, related: [`supplier:${r.supplierId}`] });
  }
  return result;
}
