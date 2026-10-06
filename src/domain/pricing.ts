import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { today } from "@/lib/dates";
import { formatMoney, marginBps, markupBps } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";

/**
 * Resolução de preço: tabela informada (ou padrão da filial/empresa), preço específico da filial
 * tem prioridade sobre o geral, vigência pela data, e preço de atacado quando a quantidade atinge o mínimo.
 */
export interface ResolvedPrice {
  skuId: string;
  price: number;
  listPrice: number;
  wholesale: boolean;
  maxDiscountBps: number | null;
  priceTableId: string | null;
  priceId: string | null;
}

export const priceScopeKey = (tableId: string, skuId: string, branchId: string | null | undefined, validFrom: string | null | undefined) => `${tableId}|${skuId}|${branchId ?? "*"}|${validFrom ?? ""}`;

export async function defaultPriceTableId(store: Store, companyId: string): Promise<string | null> {
  const res = await store.list("price_tables", { filters: [["eq", "companyId", companyId], ["eq", "isDefault", true], ["eq", "active", true]], limit: 1 });
  return res.items[0]?.id ?? null;
}

export async function resolvePrices(
  store: Store,
  input: { companyId: string; branchId: string | null; priceTableId?: string | null; items: Array<{ skuId: string; qty: number }>; date?: string },
): Promise<ResolvedPrice[]> {
  const date = input.date ?? today();
  const defaultTable = await defaultPriceTableId(store, input.companyId);
  let tableId = input.priceTableId ?? defaultTable;
  // tabela inativa não resolve preço: cai para a tabela padrão
  if (tableId && tableId !== defaultTable) {
    const t = await store.get("price_tables", tableId);
    if (!t || t.active === false) tableId = defaultTable;
  }
  const skuIds = [...new Set(input.items.map((i) => i.skuId))];
  const prices = skuIds.length ? await listAll(store, "prices", { filters: [["eq", "skuId", skuIds]] }) : [];
  const pick = (skuId: string, table: string | null) => {
    const cands = prices.filter(
      (p) => p.skuId === skuId && p.priceTableId === table && (!p.branchId || p.branchId === input.branchId) && (!p.validFrom || p.validFrom <= date) && (!p.validTo || p.validTo >= date),
    );
    cands.sort((a, b) => (a.branchId ? 0 : 1) - (b.branchId ? 0 : 1) || String(b.validFrom ?? "").localeCompare(String(a.validFrom ?? "")));
    return cands[0] ?? null;
  };
  return input.items.map((i) => {
    const p = (tableId ? pick(i.skuId, tableId) : null) ?? (defaultTable && defaultTable !== tableId ? pick(i.skuId, defaultTable) : null);
    if (!p) return { skuId: i.skuId, price: 0, listPrice: 0, wholesale: false, maxDiscountBps: null, priceTableId: tableId, priceId: null };
    const wholesale = Boolean(p.wholesalePrice && p.wholesaleMinQty && i.qty >= p.wholesaleMinQty);
    return {
      skuId: i.skuId,
      price: wholesale ? p.wholesalePrice : p.price,
      listPrice: p.price,
      wholesale,
      maxDiscountBps: p.maxDiscountBps ?? null,
      priceTableId: p.priceTableId,
      priceId: p.id,
    };
  });
}

// ───────────────────────────── Manutenção de preços (Tela 16 — aba Preços / visão Custos e preços)

/** Margem (sobre o preço) e markup (sobre o custo) em pontos-base — sempre separados. */
export function priceMetrics(price: number | null | undefined, cost: number | null | undefined): { marginBps: number | null; markupBps: number | null; profit: number | null } {
  if (price == null || cost == null) return { marginBps: null, markupBps: null, profit: null };
  return { marginBps: marginBps(price, cost), markupBps: markupBps(price, cost), profit: price - cost };
}

export interface PriceInput {
  priceTableId: string;
  skuId: string;
  /** null = todas as filiais */
  branchId?: string | null;
  price: number;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
  maxDiscountBps?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  reason?: string | null;
}

/** Registra alteração de preço/custo no histórico (toda mudança de valor gera uma linha). */
export async function recordPriceHistory(
  ctx: Ctx,
  rows: Array<{ skuId: string; productId?: string | null; priceTableId?: string | null; field: string; oldValue: number | null; newValue: number | null; reason?: string | null }>,
) {
  for (const r of rows) {
    if ((r.oldValue ?? null) === (r.newValue ?? null)) continue;
    await ctx.store.create("price_history", {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      createdBy: ctx.user.id,
      skuId: r.skuId,
      productId: r.productId ?? null,
      priceTableId: r.priceTableId ?? null,
      field: r.field,
      oldValue: r.oldValue ?? null,
      newValue: r.newValue ?? null,
      reason: r.reason?.slice(0, 300) ?? null,
    });
  }
}

/** Validação dos valores de um preço (também usada antes de gravar o cadastro do produto). */
export function validatePrice(input: Pick<PriceInput, "price" | "wholesalePrice" | "wholesaleMinQty" | "maxDiscountBps" | "validFrom" | "validTo">) {
  assert(Number.isInteger(input.price) && input.price >= 0, "Preço inválido.");
  if (input.wholesalePrice != null && input.wholesalePrice > 0) {
    assert(input.wholesaleMinQty != null && input.wholesaleMinQty > 0, "Preço de atacado exige quantidade mínima.");
    assert(input.wholesalePrice <= input.price, "O preço de atacado não pode ser maior que o preço padrão.");
  }
  if (input.maxDiscountBps != null) assert(input.maxDiscountBps >= 0 && input.maxDiscountBps <= 10000, "Desconto máximo deve estar entre 0% e 100%.");
  if (input.validFrom && input.validTo) assert(input.validTo >= input.validFrom, "O fim da vigência deve ser igual ou posterior ao início.");
}

/**
 * Cria ou atualiza um preço (tabela × SKU × filial × início de vigência). Toda alteração de valor
 * gera `price_history`. Quando `id` é informado, a linha existente é alterada (inclusive a vigência).
 */
export async function savePrice(ctx: Ctx, input: PriceInput & { id?: string | null }) {
  requirePerm(ctx, "products", "edit");
  validatePrice(input);
  const table = await ctx.store.getOrThrow("price_tables", input.priceTableId);
  assert(table.companyId === ctx.companyId, "Tabela de preço de outra empresa.");
  const sku = await ctx.store.getOrThrow("skus", input.skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  if (input.branchId) {
    const b = await ctx.store.getOrThrow("branches", input.branchId);
    assert(b.companyId === ctx.companyId, "Filial de outra empresa.");
  }
  const scopeKey = priceScopeKey(input.priceTableId, input.skuId, input.branchId ?? null, input.validFrom ?? null);
  const data = {
    priceTableId: input.priceTableId,
    skuId: input.skuId,
    productId: sku.productId,
    branchId: input.branchId ?? null,
    scopeKey,
    price: input.price,
    wholesalePrice: input.wholesalePrice && input.wholesalePrice > 0 ? input.wholesalePrice : null,
    wholesaleMinQty: input.wholesalePrice && input.wholesalePrice > 0 ? (input.wholesaleMinQty ?? null) : null,
    maxDiscountBps: input.maxDiscountBps ?? null,
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
  };
  let before: Doc | null = input.id ? await ctx.store.getOrThrow("prices", input.id) : null;
  if (!before) before = await findOne(ctx.store, "prices", [["eq", "scopeKey", scopeKey]]);
  if (before) assert(before.companyId === ctx.companyId, "Preço de outra empresa.");
  if (before && before.scopeKey !== scopeKey) {
    const clash = await findOne(ctx.store, "prices", [["eq", "scopeKey", scopeKey]]);
    if (clash && clash.id !== before.id) throw new BusinessError("Já existe preço desta tabela para o SKU com a mesma filial e início de vigência.", "duplicate");
  }
  let saved: Doc;
  try {
    saved = before ? await ctx.store.update("prices", before.id, data) : await ctx.store.create("prices", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data }, detId("price", scopeKey));
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Já existe preço desta tabela para o SKU com a mesma filial e início de vigência.", "duplicate");
    throw e;
  }
  const reason = input.reason || (before ? "Alteração de preço" : "Preço cadastrado");
  await recordPriceHistory(ctx, [
    { skuId: sku.id, productId: sku.productId, priceTableId: table.id, field: "price", oldValue: before?.price ?? null, newValue: saved.price, reason },
    { skuId: sku.id, productId: sku.productId, priceTableId: table.id, field: "wholesalePrice", oldValue: before?.wholesalePrice ?? null, newValue: saved.wholesalePrice ?? null, reason },
  ]);
  await audit(ctx, {
    module: "products",
    action: before ? "price.update" : "price.create",
    entityType: "price",
    entityId: saved.id,
    summary: `Preço de ${sku.sku} na tabela ${table.name}: ${before ? `${formatMoney(before.price)} → ` : ""}${formatMoney(saved.price)}${saved.validFrom || saved.validTo ? ` (vigência ${saved.validFrom ?? "…"} a ${saved.validTo ?? "…"})` : ""}`,
    before: before ? { price: before.price, wholesalePrice: before.wholesalePrice, validFrom: before.validFrom, validTo: before.validTo } : undefined,
    after: { price: saved.price, wholesalePrice: saved.wholesalePrice, wholesaleMinQty: saved.wholesaleMinQty, maxDiscountBps: saved.maxDiscountBps, validFrom: saved.validFrom, validTo: saved.validTo, branchId: saved.branchId },
    related: [`product:${sku.productId}`, `sku:${sku.id}`],
  });
  return saved;
}

export async function deletePrice(ctx: Ctx, id: string, reason?: string | null) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("prices", id);
  assert(p.companyId === ctx.companyId, "Preço de outra empresa.");
  await ctx.store.delete("prices", id);
  await recordPriceHistory(ctx, [{ skuId: p.skuId, productId: p.productId, priceTableId: p.priceTableId, field: "price", oldValue: p.price, newValue: null, reason: reason || "Preço removido" }]);
  await audit(ctx, { module: "products", action: "price.delete", entityType: "price", entityId: id, summary: `Preço removido (${formatMoney(p.price)})`, before: { price: p.price, validFrom: p.validFrom, validTo: p.validTo }, related: [`product:${p.productId}`, `sku:${p.skuId}`] });
}

/** Situação de vigência de um preço numa data. */
export function priceValidity(p: { validFrom?: string | null; validTo?: string | null }, date = today()): "current" | "future" | "expired" {
  if (p.validFrom && p.validFrom > date) return "future";
  if (p.validTo && p.validTo < date) return "expired";
  return "current";
}
