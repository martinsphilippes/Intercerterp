import { detId, isConflict, listAll, newId } from "@/lib/db";
import { NotFoundError, type Doc } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { resolveOccurrence } from "@/lib/core/notify";
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
 *  - No máximo UM inventário em andamento por depósito (trava de id determinístico `invlock:<depósito>` em
 *    `operations`, criada na mesma transação do cabeçalho): dois inventários abertos lançariam o mesmo
 *    ajuste duas vezes. A trava é liberada ao concluir ou cancelar.
 *  - Abertura em duas fases: cabeçalho `preparing` + trava; contagens gravadas em lotes idempotentes;
 *    só então `open`. Repetir a abertura (mesma chave) ou "Retomar abertura" completa o que faltou.
 */

export const INVENTORY_METHOD = "base_temporal_seq";

/** Código sequencial anual (ex.: INV-2026-009). */
export const inventoryCode = (year: string, n: number) => `INV-${year}-${String(n).padStart(3, "0")}`;
export const invLabel = (inv: { code?: string | null; number?: number | null }) => inv.code ?? `nº ${inv.number}`;

/** Situações em que o inventário ocupa o depósito. */
export const INVENTORY_ACTIVE_STATUSES = ["preparing", "open", "counting"];

const lockId = (warehouseId: string) => detId("invlock", warehouseId);

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

function busyError(other: Doc) {
  return new BusinessError(
    `Já existe o inventário ${invLabel(other as any)} em andamento neste depósito (${other.status === "preparing" ? "abertura não concluída" : "aberto/em contagem"}). Conclua ou cancele-o antes de abrir outro — dois inventários simultâneos lançariam o mesmo ajuste duas vezes.`,
    "inventory_open",
    { inventoryId: other.id },
  );
}

/** Recusa se o depósito já tem inventário em andamento; descarta trava órfã (inventário já encerrado). */
async function assertWarehouseFree(ctx: Ctx, warehouseId: string, selfId: string) {
  const open = await listAll(ctx.store, "inventories", { filters: [["eq", "companyId", ctx.companyId], ["eq", "warehouseId", warehouseId], ["eq", "status", INVENTORY_ACTIVE_STATUSES]] });
  const other = open.find((i) => i.id !== selfId);
  if (other) throw busyError(other);
  const lock = await ctx.store.get("operations", lockId(warehouseId));
  if (lock && lock.entityId !== selfId) {
    const holder = lock.entityId ? await ctx.store.get("inventories", lock.entityId) : null;
    if (holder && INVENTORY_ACTIVE_STATUSES.includes(holder.status)) throw busyError(holder);
    await ctx.store.delete("operations", lock.id).catch((e) => {
      if (!(e instanceof NotFoundError)) throw e;
    });
  }
}

/** Libera a trava do depósito (idempotente; só a do próprio inventário). */
async function releaseInventoryLock(ctx: Ctx, inv: Doc) {
  const lock = await ctx.store.get("operations", lockId(inv.warehouseId));
  if (!lock || lock.entityId !== inv.id) return;
  await ctx.store.delete("operations", lock.id).catch((e) => {
    if (!(e instanceof NotFoundError)) throw e;
  });
}

/**
 * Grava as contagens que faltam (lotes transacionais idempotentes por id determinístico) e passa o
 * inventário de `preparing` para `open`. Usado na abertura e na retomada.
 */
async function finishOpening(ctx: Ctx, inv: Doc, scoped?: Array<{ sku: Doc; bal: Doc | null }>) {
  const items = scoped ?? (await scopeSkus(ctx, { warehouseId: inv.warehouseId, scope: inv.scope, categoryId: inv.categoryId, location: inv.location }));
  const have = new Set((await listAll(ctx.store, "inventory_counts", { filters: [["eq", "inventoryId", inv.id]] })).map((c) => c.skuId));
  const missing = items.filter((x) => !have.has(x.sku.id));
  const row = ({ sku, bal }: { sku: Doc; bal: Doc | null }) => ({
    companyId: ctx.companyId, branchId: inv.branchId, inventoryId: inv.id, skuId: sku.id, productId: sku.productId, baseQty: bal?.physical ?? 0, baseSeq: bal?.seq ?? 0,
    unitCost: bal?.avgCost ?? sku.costTotal ?? 0, counted: false, location: bal?.location ?? null,
  });
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      await ctx.store.transaction(async (tx) => {
        for (const x of chunk) await tx.create("inventory_counts", row(x), detId("invcount", inv.id, x.sku.id));
      });
    } catch (e) {
      if (!isConflict(e)) throw e;
      // retomada simultânea: grava um a um, ignorando os que a outra chamada já gravou
      for (const x of chunk) {
        const cid = detId("invcount", inv.id, x.sku.id);
        if (await ctx.store.get("inventory_counts", cid)) continue;
        try {
          await ctx.store.create("inventory_counts", row(x), cid);
        } catch (e2) {
          if (!isConflict(e2)) throw e2;
        }
      }
    }
  }
  const cur = (await ctx.store.get("inventories", inv.id))!;
  if (cur.status !== "preparing") return cur; // aberto por outra chamada ou cancelado durante a preparação
  const total = have.size + missing.length;
  const opened = await ctx.store.update("inventories", inv.id, { status: "open", itemsCount: total });
  await audit(ctx, { module: "stock", action: "inventory.create", entityType: "inventory", entityId: inv.id, summary: `Inventário ${invLabel(inv as any)} aberto (${total} itens, base ${new Date(inv.baseAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})` });
  return opened;
}

/**
 * Abre o inventário e grava a base (snapshot) de cada item. Idempotente por `idemKey`: a repetição devolve
 * o mesmo inventário e, se a abertura ficou pela metade, completa as contagens que faltaram.
 * Recusa se já houver inventário em andamento no mesmo depósito.
 */
export async function createInventory(ctx: Ctx, input: InventoryInput, opts: { idemKey?: string | null; id?: string } = {}) {
  requirePerm(ctx, "stock", "create");
  const branchId = requireBranch(ctx);
  const id = opts.id ?? (opts.idemKey ? detId("inventory", ctx.companyId, opts.idemKey) : newId());
  const existing = await ctx.store.get("inventories", id);
  if (existing) return existing.status === "preparing" ? finishOpening(ctx, existing) : existing;
  const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
  assert(wh.companyId === ctx.companyId && wh.branchId === branchId, "O depósito não pertence à filial selecionada.");
  const items = await scopeSkus(ctx, input);
  assert(items.length > 0, "Nenhum item no escopo escolhido.");
  await assertWarehouseFree(ctx, wh.id, id);
  const baseAt = nowIso();
  const year = baseAt.slice(0, 4);
  const number = await nextNumber(ctx.store, `inventory:${ctx.companyId}:${year}`);
  const header = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId: wh.id, scope: input.scope, categoryId: input.scope === "category" ? input.categoryId : null,
    location: input.scope === "location" ? input.location?.trim() : null, status: "preparing", baseAt, startedAt: baseAt, method: INVENTORY_METHOD, notes: input.notes?.trim() || null, itemsCount: items.length,
    code: inventoryCode(year, number), responsibleId: input.responsibleId || ctx.user.id,
  };
  try {
    await ctx.store.transaction(async (tx) => {
      await tx.create("operations", { companyId: ctx.companyId, type: "inventory.lock", status: "active", entityType: "inventory", entityId: id, createdBy: ctx.user.id, result: { warehouseId: wh.id } }, lockId(wh.id));
      await tx.create("inventories", header, id);
    });
  } catch (e) {
    if (!isConflict(e)) throw e;
    const again = await ctx.store.get("inventories", id);
    if (again) return again.status === "preparing" ? finishOpening(ctx, again) : again; // repetição simultânea da mesma abertura
    const lock = await ctx.store.get("operations", lockId(wh.id));
    const holder = lock?.entityId ? await ctx.store.get("inventories", lock.entityId) : null;
    if (holder) throw busyError(holder);
    throw new BusinessError("Outro inventário acabou de ser aberto neste depósito. Atualize a página.", "inventory_open");
  }
  return finishOpening(ctx, (await ctx.store.get("inventories", id))!, items);
}

/** Retoma a abertura interrompida (`preparing`): grava as contagens que faltaram e abre o inventário. */
export async function resumeInventoryOpening(ctx: Ctx, inventoryId: string) {
  requirePerm(ctx, "stock", "create");
  requireBranch(ctx);
  const inv = await loadInventory(ctx, inventoryId);
  if (inv.status !== "preparing") return inv;
  assert(ctx.branchId === inv.branchId, "Opere o inventário no contexto da sua filial.");
  return finishOpening(ctx, inv);
}

/** Inclui um SKU fora do escopo inicial (ex.: item encontrado na contagem); base = saldo no momento da inclusão. */
export async function addInventoryItem(ctx: Ctx, inventoryId: string, skuId: string) {
  requirePerm(ctx, "stock", "edit");
  const inv = await loadInventory(ctx, inventoryId);
  assert(inv.status !== "preparing", "A abertura do inventário não foi concluída; retome a abertura antes de incluir itens.");
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
  assert(inv.status !== "preparing", "A abertura do inventário não foi concluída; retome a abertura antes de contar.");
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
  if (inv0.status === "completed") {
    await releaseInventoryLock(ctx, inv0);
    return inv0;
  }
  assert(inv0.status !== "preparing", "A abertura do inventário não foi concluída; retome a abertura antes de concluir.");
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
  await releaseInventoryLock(ctx, inv0);
  await resolveOccurrence(ctx.store, `inventory_stale:${inventoryId}`);
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
  await releaseInventoryLock(ctx, inv);
  await resolveOccurrence(ctx.store, `inventory_stale:${inventoryId}`);
  await audit(ctx, { module: "stock", action: "inventory.cancel", entityType: "inventory", entityId: inventoryId, summary: `Inventário ${invLabel(inv)} cancelado (sem ajustes)`, reason: reason.trim() });
  return u;
}
