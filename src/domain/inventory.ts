import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { nowIso } from "@/lib/dates";
import { QTY, roundDiv } from "@/lib/money";
import { balanceId, postMovements, type MovementInput } from "./stock";
import { categoryDescendants } from "./products";

/**
 * Inventário e contagem (Tela 19) — método da BASE TEMPORAL por sequência de movimentos.
 *
 *  - Na abertura, cada item recebe o saldo base (físico) e a sequência do saldo naquele instante (`baseSeq`).
 *  - Ao contar (ou recontar) um item, grava-se a sequência do saldo no momento da contagem (`countSeq`).
 *  - Esperado = saldo base + Σ movimentos do saldo com baseSeq < seq ≤ countSeq
 *    (exceto os ajustes do próprio inventário).
 *  - Diferença = contado (recontagem prevalece) − esperado.
 *  - Concluir lança UM ajuste (`inventory`) por item com diferença, com idemKey `inventory:<id>:<sku>`:
 *    concluir de novo não duplica. Novo físico = contado + movimentos ocorridos após a contagem.
 *  - A loja continua operando durante a contagem: vendas/recebimentos entram no esperado conforme a ordem.
 */

export const INVENTORY_METHOD = "base_temporal_seq";

/** Código sequencial anual (ex.: INV-2026-009). */
export const inventoryCode = (year: string, n: number) => `INV-${year}-${String(n).padStart(3, "0")}`;
export const invLabel = (inv: { code?: string | null; number?: number | null }) => inv.code ?? `nº ${inv.number}`;

export interface InventoryInput {
  responsibleId?: string | null;
  warehouseId: string;
  scope: "all" | "category" | "location";
  categoryId?: string | null;
  location?: string | null;
  notes?: string | null;
}

async function loadInventory(ctx: Ctx, id: string) {
  const inv = await ctx.store.getOrThrow("inventories", id);
  assert(inv.companyId === ctx.companyId, "Inventário de outra empresa.");
  return inv;
}

/** SKUs no escopo (produtos físicos ativos; por categoria inclui subcategorias; por localização usa o saldo). */
async function scopeSkus(ctx: Ctx, input: InventoryInput) {
  const products = await listAll(ctx.store, "products", { filters: [["eq", "companyId", ctx.companyId], ["eq", "type", "product"]] });
  let allowed = products.filter((p) => p.active !== false);
  if (input.scope === "category") {
    assert(input.categoryId, "Escolha a categoria.");
    const cats = await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] });
    const ids = new Set(categoryDescendants(cats, input.categoryId!));
    allowed = allowed.filter((p) => p.categoryId && ids.has(p.categoryId));
  }
  const pids = new Set(allowed.map((p) => p.id));
  const skus = (await listAll(ctx.store, "skus", { filters: [["eq", "companyId", ctx.companyId]] })).filter((s) => pids.has(s.productId) && s.active !== false);
  const balances = await listAll(ctx.store, "stock_balances", { filters: [["eq", "warehouseId", input.warehouseId]] });
  const balBySku = new Map(balances.map((b) => [b.skuId, b]));
  if (input.scope === "location") {
    const loc = (input.location ?? "").trim().toLowerCase();
    assert(loc, "Informe a localização (ex.: corredor A, prateleira 3).");
    return skus.filter((s) => String(balBySku.get(s.id)?.location ?? "").toLowerCase().startsWith(loc)).map((s) => ({ sku: s, bal: balBySku.get(s.id) ?? null }));
  }
  return skus.map((s) => ({ sku: s, bal: balBySku.get(s.id) ?? null }));
}

/** Abre o inventário e grava a base (snapshot) de cada item. Idempotente por `idemKey`. */
export async function createInventory(ctx: Ctx, input: InventoryInput, opts: { idemKey?: string | null; id?: string } = {}) {
  requirePerm(ctx, "stock", "create");
  const branchId = requireBranch(ctx);
  const id = opts.id ?? (opts.idemKey ? detId("inventory", ctx.companyId, opts.idemKey) : undefined);
  if (id) {
    const existing = await ctx.store.get("inventories", id);
    if (existing) return existing;
  }
  const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
  assert(wh.companyId === ctx.companyId && wh.branchId === branchId, "O depósito não pertence à filial selecionada.");
  const items = await scopeSkus(ctx, input);
  assert(items.length > 0, "Nenhum item no escopo escolhido.");
  const baseAt = nowIso();
  const year = baseAt.slice(0, 4);
  const number = await nextNumber(ctx.store, `inventory:${ctx.companyId}:${year}`);
  const inv = await ctx.store.create(
    "inventories",
    {
      companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId: wh.id, scope: input.scope, categoryId: input.scope === "category" ? input.categoryId : null,
      location: input.scope === "location" ? input.location?.trim() : null, status: "open", baseAt, startedAt: baseAt, method: INVENTORY_METHOD, notes: input.notes?.trim() || null, itemsCount: items.length,
      code: inventoryCode(year, number), responsibleId: input.responsibleId || ctx.user.id,
    },
    id,
  );
  for (const { sku, bal } of items) {
    await ctx.store.create(
      "inventory_counts",
      {
        companyId: ctx.companyId, branchId, inventoryId: inv.id, skuId: sku.id, productId: sku.productId, baseQty: bal?.physical ?? 0, baseSeq: bal?.seq ?? 0,
        unitCost: bal?.avgCost ?? sku.costTotal ?? 0, counted: false, location: bal?.location ?? null,
      },
      detId("invcount", inv.id, sku.id),
    );
  }
  await audit(ctx, { module: "stock", action: "inventory.create", entityType: "inventory", entityId: inv.id, summary: `Inventário ${inventoryCode(year, number)} aberto em ${wh.name} (${items.length} itens, base ${new Date(baseAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})` });
  return inv;
}

/** Inclui um SKU fora do escopo inicial (ex.: item encontrado na contagem); base = saldo no momento da inclusão. */
export async function addInventoryItem(ctx: Ctx, inventoryId: string, skuId: string) {
  requirePerm(ctx, "stock", "edit");
  const inv = await loadInventory(ctx, inventoryId);
  assert(["open", "counting"].includes(inv.status), "Inventário não está em contagem.");
  assert(ctx.branchId === inv.branchId, "Opere o inventário no contexto da sua filial.");
  const id = detId("invcount", inventoryId, skuId);
  const existing = await ctx.store.get("inventory_counts", id);
  if (existing) return existing;
  const sku = await ctx.store.getOrThrow("skus", skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  const product = await ctx.store.getOrThrow("products", sku.productId);
  assert(product.type !== "service", "Serviços não têm estoque.");
  const bal = await ctx.store.get("stock_balances", balanceId(inv.warehouseId, skuId));
  const c = await ctx.store.create(
    "inventory_counts",
    { companyId: ctx.companyId, branchId: inv.branchId, inventoryId, skuId, productId: sku.productId, baseQty: bal?.physical ?? 0, baseSeq: bal?.seq ?? 0, unitCost: bal?.avgCost ?? sku.costTotal ?? 0, counted: false, location: bal?.location ?? null },
    id,
  );
  await ctx.store.update("inventories", inventoryId, { itemsCount: (inv.itemsCount ?? 0) + 1 });
  await audit(ctx, { module: "stock", action: "inventory.add_item", entityType: "inventory", entityId: inventoryId, summary: `Item ${sku.sku} incluído no inventário ${invLabel(inv)}`, related: [`sku:${skuId}`] });
  return c;
}

/** Soma dos movimentos do saldo entre a base e a contagem, exceto ajustes do próprio inventário. */
async function movementsBetween(ctx: Ctx, inv: Doc, skuId: string, fromSeq: number, toSeq: number) {
  if (toSeq <= fromSeq) return 0;
  const movs = await listAll(ctx.store, "stock_movements", { filters: [["eq", "balanceId", balanceId(inv.warehouseId, skuId)], ["gt", "seq", fromSeq], ["lte", "seq", toSeq]] });
  return movs.filter((m) => !(m.originType === "inventory" && m.originId === inv.id)).reduce((a, m) => a + m.qty, 0);
}

function evaluate(c: Doc, mdc: number) {
  const finalQty = c.recountQty ?? c.countedQty ?? null;
  const expectedQty = (c.baseQty ?? 0) + mdc;
  const difference = finalQty == null ? null : finalQty - expectedQty;
  return { finalQty, expectedQty, difference, differenceValue: difference == null ? null : roundDiv(difference * (c.unitCost ?? 0), QTY) };
}

export interface CountEntry {
  skuId: string;
  qty: number | null;
  note?: string | null;
  recount?: boolean;
}

/**
 * Registra contagens (ou recontagens). Cada contagem grava a sequência atual do saldo (momento da contagem)
 * e calcula esperado e diferença pelo método da base temporal.
 */
export async function saveCounts(ctx: Ctx, inventoryId: string, entries: CountEntry[]) {
  requirePerm(ctx, "stock", "edit");
  const inv = await loadInventory(ctx, inventoryId);
  assert(["open", "counting"].includes(inv.status), "Inventário concluído ou cancelado não aceita contagens.");
  assert(!inv.closingAt, "Inventário em conclusão.");
  assert(ctx.branchId === inv.branchId, "Opere o inventário no contexto da sua filial.");
  let saved = 0;
  const at = nowIso();
  for (const e of entries) {
    if (e.qty == null && e.note == null) continue;
    const id = detId("invcount", inventoryId, e.skuId);
    const c = await ctx.store.get("inventory_counts", id);
    assert(c && c.inventoryId === inventoryId, "Item não pertence ao inventário.");
    if (e.qty == null) {
      if ((e.note ?? null) !== (c!.note ?? null)) {
        await ctx.store.update("inventory_counts", id, { note: e.note?.slice(0, 500) || null });
        saved++;
      }
      continue;
    }
    assert(Number.isInteger(e.qty) && e.qty >= 0, "Quantidade contada inválida.");
    const bal = await ctx.store.get("stock_balances", balanceId(inv.warehouseId, e.skuId));
    const countSeq = bal?.seq ?? 0;
    const isRecount = Boolean(e.recount && c!.counted);
    const patch: Record<string, any> = isRecount
      ? { recountQty: e.qty, recountAt: at, recountBy: ctx.user.id, countSeq }
      : { countedQty: e.qty, counted: true, countedAt: at, countedBy: ctx.user.id, countSeq, recountQty: null, recountAt: null, recountBy: null };
    if (e.note !== undefined) patch.note = e.note?.slice(0, 500) || null;
    const merged = { ...c!, ...patch };
    const mdc = await movementsBetween(ctx, inv, e.skuId, c!.baseSeq ?? 0, countSeq);
    const ev = evaluate(merged as Doc, mdc);
    await ctx.store.update("inventory_counts", id, { ...patch, movementsDuringCount: mdc, expectedQty: ev.expectedQty, finalQty: ev.finalQty, difference: ev.difference, differenceValue: ev.differenceValue });
    saved++;
  }
  if (saved && inv.status === "open") await ctx.store.update("inventories", inventoryId, { status: "counting" });
  if (saved) await audit(ctx, { module: "stock", action: "inventory.count", entityType: "inventory", entityId: inventoryId, summary: `Inventário ${invLabel(inv)}: ${saved} contagem(ns)/observação(ões) registrada(s)` });
  return { saved };
}

export interface InventorySummary {
  itemsTotal: number;
  itemsCounted: number;
  itemsAdjusted: number;
  qtyPositive: number;
  qtyNegative: number;
  valuePositive: number;
  valueNegative: number;
  valueNet: number;
  uncounted: "keep" | "zero";
}

/**
 * Conclui: congela esperado/diferença de cada item (fase 1), lança um ajuste por item (fase 2) e fecha.
 * Idempotente: se já concluído, devolve o resumo; se interrompido na fase 2, reaproveita os valores congelados.
 */
export async function concludeInventory(ctx: Ctx, inventoryId: string, opts: { uncounted?: "keep" | "zero" } = {}) {
  requireAction(ctx, "stock.inventory_close");
  const inv0 = await loadInventory(ctx, inventoryId);
  if (inv0.status === "completed") return inv0;
  assert(["open", "counting"].includes(inv0.status), "Inventário cancelado não pode ser concluído.");
  assert(ctx.branchId === inv0.branchId, "Conclua o inventário no contexto da sua filial.");
  const uncounted = opts.uncounted ?? inv0.summary?.uncounted ?? "keep";
  const counts = await listAll(ctx.store, "inventory_counts", { filters: [["eq", "inventoryId", inventoryId]] });
  if (uncounted === "keep") assert(counts.some((c) => c.counted), "Nenhum item contado. Registre as contagens antes de concluir.");

  // fase 1 — congelar
  let inv = inv0;
  if (!inv0.closingAt) {
    for (const c of counts) {
      let patch: Record<string, any>;
      if (!c.counted) {
        if (uncounted !== "zero") {
          patch = { expectedQty: null, finalQty: null, difference: null, differenceValue: null };
        } else {
          const bal = await ctx.store.get("stock_balances", balanceId(inv0.warehouseId, c.skuId));
          const countSeq = bal?.seq ?? 0;
          const mdc = await movementsBetween(ctx, inv0, c.skuId, c.baseSeq ?? 0, countSeq);
          const unitCost = bal?.avgCost ?? c.unitCost ?? 0;
          const ev = evaluate({ ...c, countedQty: 0, unitCost } as Doc, mdc);
          patch = { countSeq, movementsDuringCount: mdc, unitCost, expectedQty: ev.expectedQty, finalQty: 0, difference: ev.difference, differenceValue: ev.differenceValue, note: c.note ?? "Não contado — considerado zero na conclusão" };
        }
      } else {
        const bal = await ctx.store.get("stock_balances", balanceId(inv0.warehouseId, c.skuId));
        const mdc = await movementsBetween(ctx, inv0, c.skuId, c.baseSeq ?? 0, c.countSeq ?? c.baseSeq ?? 0);
        const unitCost = bal?.avgCost ?? c.unitCost ?? 0;
        const ev = evaluate({ ...c, unitCost } as Doc, mdc);
        patch = { movementsDuringCount: mdc, unitCost, expectedQty: ev.expectedQty, finalQty: ev.finalQty, difference: ev.difference, differenceValue: ev.differenceValue };
      }
      await ctx.store.update("inventory_counts", c.id, patch);
    }
    inv = await ctx.store.update("inventories", inventoryId, { closingAt: nowIso(), summary: { ...(inv0.summary ?? {}), uncounted } });
  }

  // fase 2 — um ajuste por item com diferença (idempotente por idemKey)
  const frozen = await listAll(ctx.store, "inventory_counts", { filters: [["eq", "inventoryId", inventoryId]] });
  const movements: MovementInput[] = frozen
    .filter((c) => c.difference)
    .map((c) => ({
      warehouseId: inv.warehouseId,
      skuId: c.skuId,
      qty: c.difference,
      type: "inventory" as const,
      unitCost: c.unitCost ?? null,
      originType: "inventory",
      originId: inventoryId,
      operationId: inventoryId,
      reason: `Inventário ${invLabel(inv)}: contado ${c.finalQty / QTY}, esperado ${c.expectedQty / QTY}`,
      idemKey: `inventory:${inventoryId}:${c.skuId}`,
      allowNegative: true,
    }));
  for (let i = 0; i < movements.length; i += 40) await postMovements(ctx, movements.slice(i, i + 40));
  for (const c of frozen) if (c.difference && !c.adjustmentMovementId) await ctx.store.update("inventory_counts", c.id, { adjustmentMovementId: detId("mov", `inventory:${inventoryId}:${c.skuId}`) });

  const summary: InventorySummary = {
    itemsTotal: frozen.length,
    itemsCounted: frozen.filter((c) => c.finalQty != null).length,
    itemsAdjusted: movements.length,
    qtyPositive: frozen.reduce((a, c) => a + Math.max(0, c.difference ?? 0), 0),
    qtyNegative: frozen.reduce((a, c) => a + Math.min(0, c.difference ?? 0), 0),
    valuePositive: frozen.reduce((a, c) => a + Math.max(0, c.differenceValue ?? 0), 0),
    valueNegative: frozen.reduce((a, c) => a + Math.min(0, c.differenceValue ?? 0), 0),
    valueNet: frozen.reduce((a, c) => a + (c.differenceValue ?? 0), 0),
    uncounted,
  };
  const done = await ctx.store.update("inventories", inventoryId, { status: "completed", completedAt: nowIso(), completedBy: ctx.user.id, summary });
  await audit(ctx, {
    module: "stock",
    action: "inventory.complete",
    entityType: "inventory",
    entityId: inventoryId,
    summary: `Inventário ${invLabel(inv)} concluído: ${summary.itemsAdjusted} ajuste(s), diferença líquida ${(summary.qtyPositive + summary.qtyNegative) / QTY} un / ${(summary.valueNet / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    after: summary,
  });
  return done;
}

export async function cancelInventory(ctx: Ctx, inventoryId: string, reason: string) {
  requirePerm(ctx, "stock", "edit");
  const inv = await loadInventory(ctx, inventoryId);
  if (inv.status === "cancelled") return inv;
  assert(inv.status !== "completed", "Inventário concluído não pode ser cancelado (os ajustes já foram lançados).");
  assert(!inv.closingAt, "Inventário em conclusão não pode ser cancelado; conclua-o.");
  assert(ctx.branchId === inv.branchId, "Opere o inventário no contexto da sua filial.");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  const u = await ctx.store.update("inventories", inventoryId, { status: "cancelled", cancelledAt: nowIso(), cancelReason: reason.trim() });
  await audit(ctx, { module: "stock", action: "inventory.cancel", entityType: "inventory", entityId: inventoryId, summary: `Inventário ${invLabel(inv)} cancelado (sem ajustes)`, reason: reason.trim() });
  return u;
}
