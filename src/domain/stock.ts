import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { roundDiv, QTY } from "@/lib/money";
import { BusinessError } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";

/**
 * Estoque por movimentos.
 *  - Saldo físico só muda por movimento (com sequência única por saldo → concorrência segura).
 *  - Reserva reduz o disponível, não o físico.
 *  - Custo médio ponderado por SKU e depósito, atualizado em entradas com custo.
 */

export type MovementType =
  | "initial"
  | "purchase"
  | "sale"
  | "sale_cancel"
  | "return"
  | "adjust_in"
  | "adjust_out"
  | "loss"
  | "transfer_out"
  | "transfer_in"
  | "transfer_return"
  | "inventory"
  | "manual_in"
  | "manual_out"
  | "damage_in";

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  initial: "Saldo inicial",
  purchase: "Entrada por compra",
  sale: "Saída por venda",
  sale_cancel: "Estorno de venda cancelada",
  return: "Entrada por devolução",
  adjust_in: "Ajuste de entrada",
  adjust_out: "Ajuste de saída",
  loss: "Perda / avaria",
  transfer_out: "Expedição de transferência",
  transfer_in: "Recebimento de transferência",
  transfer_return: "Retorno de transferência",
  inventory: "Ajuste de inventário",
  manual_in: "Entrada manual",
  manual_out: "Saída manual",
  damage_in: "Entrada em depósito de avarias",
};

export interface MovementInput {
  warehouseId: string;
  skuId: string;
  /** variação do saldo físico em milésimos (positivo = entrada) */
  qty: number;
  type: MovementType;
  /** custo unitário em centavos (entradas). Saídas usam o custo médio vigente. */
  unitCost?: number | null;
  originType?: string;
  originId?: string;
  operationId?: string;
  reason?: string;
  /** chave de idempotência do efeito: o mesmo efeito nunca é lançado duas vezes */
  idemKey: string;
  allowNegative?: boolean;
  occurredAt?: string;
}

export const balanceId = (warehouseId: string, skuId: string) => detId("bal", warehouseId, skuId);

export async function ensureBalance(store: Store, ctx: { companyId: string }, warehouseId: string, skuId: string): Promise<Doc> {
  const id = balanceId(warehouseId, skuId);
  const existing = await store.get("stock_balances", id);
  if (existing) return existing;
  const wh = await store.getOrThrow("warehouses", warehouseId);
  const sku = await store.getOrThrow("skus", skuId);
  try {
    return await store.create(
      "stock_balances",
      { companyId: ctx.companyId, branchId: wh.branchId, warehouseId, skuId, productId: sku.productId, physical: 0, reserved: 0, inTransit: 0, avgCost: sku.costTotal ?? 0, seq: 0 },
      id,
    );
  } catch (e) {
    if (isConflict(e)) return (await store.get("stock_balances", id))!;
    throw e;
  }
}

/**
 * Lança movimentos de forma atômica. Movimentos já lançados (mesma idemKey) são ignorados.
 * Se `tx` for informado, participa da transação do chamador (sem retentativa própria).
 */
export async function postMovements(ctx: Ctx, inputs: MovementInput[], tx?: Store): Promise<Doc[]> {
  if (inputs.length === 0) return [];
  const store = ctx.store;
  for (const m of inputs) {
    if (!Number.isInteger(m.qty) || m.qty === 0) throw new BusinessError("Quantidade do movimento deve ser diferente de zero.");
    await ensureBalance(store, ctx, m.warehouseId, m.skuId);
  }
  const run = async (t: Store) => {
    const cache = new Map<string, Doc>();
    const created: Doc[] = [];
    for (const m of inputs) {
      const movId = detId("mov", m.idemKey);
      if (await store.get("stock_movements", movId)) continue;
      const bid = balanceId(m.warehouseId, m.skuId);
      const bal = cache.get(bid) ?? (await store.getOrThrow("stock_balances", bid));
      const before = bal.physical as number;
      const after = before + m.qty;
      if (after < 0 && m.qty < 0 && !m.allowNegative) {
        const sku = await store.get("skus", m.skuId);
        throw new BusinessError(`Saldo insuficiente para ${sku?.sku ?? m.skuId}: disponível ${before / QTY}, solicitado ${-m.qty / QTY}.`, "insufficient_stock", { skuId: m.skuId });
      }
      let avg = bal.avgCost as number;
      let unitCost: number;
      if (m.qty > 0 && m.unitCost != null && ["purchase", "initial", "manual_in", "adjust_in", "transfer_in"].includes(m.type)) {
        unitCost = m.unitCost;
        const basis = Math.max(before, 0);
        avg = basis + m.qty > 0 ? roundDiv(basis * avg + m.qty * unitCost, basis + m.qty) : unitCost;
      } else {
        unitCost = m.unitCost ?? avg;
      }
      const seq = (bal.seq as number) + 1;
      const occurredAt = m.occurredAt ?? nowIso();
      const mov = await t.create(
        "stock_movements",
        {
          companyId: ctx.companyId,
          branchId: bal.branchId,
          createdBy: ctx.user.id,
          balanceId: bid,
          warehouseId: m.warehouseId,
          skuId: m.skuId,
          productId: bal.productId,
          type: m.type,
          qty: m.qty,
          balanceBefore: before,
          balanceAfter: after,
          unitCost,
          totalCost: roundDiv(Math.abs(m.qty) * unitCost, QTY),
          avgCostAfter: avg,
          seq,
          originType: m.originType ?? null,
          originId: m.originId ?? null,
          operationId: m.operationId ?? null,
          reason: m.reason ?? null,
          occurredAt,
          idemKey: m.idemKey,
        },
        movId,
      );
      const updated = { ...bal, physical: after, avgCost: avg, seq, lastMovementAt: occurredAt };
      await t.update("stock_balances", bid, { physical: after, avgCost: avg, seq, lastMovementAt: occurredAt });
      cache.set(bid, updated);
      created.push(mov);
    }
    return created;
  };
  if (tx) return run(tx);
  return retryOnConflict(() => store.transaction(run));
}

/** Reserva quantidade (reduz disponível). Idempotente por idemKey. */
export async function reserve(ctx: Ctx, input: { warehouseId: string; skuId: string; qty: number; originType: string; originId: string; idemKey: string; allowNegative?: boolean }) {
  const store = ctx.store;
  const bal = await ensureBalance(store, ctx, input.warehouseId, input.skuId);
  const rid = detId("rsv", input.idemKey);
  if (await store.get("stock_reservations", rid)) return;
  const available = bal.physical - bal.reserved;
  if (!input.allowNegative && available < input.qty) {
    const sku = await store.get("skus", input.skuId);
    throw new BusinessError(`Disponível insuficiente para reservar ${sku?.sku ?? ""}: ${available / QTY}.`, "insufficient_stock");
  }
  await store.transaction(async (t) => {
    await t.create(
      "stock_reservations",
      { companyId: ctx.companyId, branchId: bal.branchId, createdBy: ctx.user.id, warehouseId: input.warehouseId, skuId: input.skuId, qty: input.qty, originType: input.originType, originId: input.originId, status: "active", idemKey: input.idemKey },
      rid,
    );
    await t.increment("stock_balances", bal.id, "reserved", input.qty);
  });
}

/** Libera (ou consome) reservas ativas de uma origem. */
export async function releaseReservations(ctx: Ctx, originType: string, originId: string, status: "released" | "consumed" = "released", skuId?: string) {
  const store = ctx.store;
  const filters: any[] = [["eq", "originType", originType], ["eq", "originId", originId], ["eq", "status", "active"]];
  if (skuId) filters.push(["eq", "skuId", skuId]);
  const items = await listAll(store, "stock_reservations", { filters });
  for (const r of items) {
    await store.transaction(async (t) => {
      await t.update("stock_reservations", r.id, { status });
      await t.increment("stock_balances", balanceId(r.warehouseId, r.skuId), "reserved", -r.qty);
    });
  }
  return items.length;
}

export async function adjustInTransit(ctx: Ctx, warehouseId: string, skuId: string, delta: number) {
  const bal = await ensureBalance(ctx.store, ctx, warehouseId, skuId);
  await ctx.store.increment("stock_balances", bal.id, "inTransit", delta);
}

export async function defaultWarehouse(store: Store, branchId: string): Promise<Doc> {
  const branch = await store.getOrThrow("branches", branchId);
  if (branch.defaultWarehouseId) {
    const w = await store.get("warehouses", branch.defaultWarehouseId);
    if (w) return w;
  }
  const res = await store.list("warehouses", { filters: [["eq", "branchId", branchId], ["eq", "kind", "available"]], limit: 1 });
  if (!res.items[0]) throw new BusinessError("Filial sem depósito padrão configurado.");
  return res.items[0];
}

export async function damageWarehouse(ctx: Ctx, branchId: string): Promise<Doc> {
  const res = await ctx.store.list("warehouses", { filters: [["eq", "branchId", branchId], ["eq", "kind", "damaged"]], limit: 1 });
  if (res.items[0]) return res.items[0];
  const id = detId("wh-damaged", branchId);
  try {
    return await ctx.store.create("warehouses", { companyId: ctx.companyId, branchId, code: "AVARIA", name: "Avarias", kind: "damaged", isDefault: false, status: "active" }, id);
  } catch (e) {
    if (isConflict(e)) return (await ctx.store.get("warehouses", id))!;
    throw e;
  }
}

/** Saldos de um SKU por depósito (físico, reservado, disponível, trânsito). */
export async function skuBalances(store: Store, skuId: string, branchId?: string | null) {
  const filters: any[] = [["eq", "skuId", skuId]];
  if (branchId) filters.push(["eq", "branchId", branchId]);
  const bals = await listAll(store, "stock_balances", { filters });
  return bals.map((b) => ({ ...b, available: b.physical - b.reserved }));
}

/** Disponível de vários SKUs numa filial (soma depósitos de tipo "available"). */
export async function availableMap(store: Store, branchId: string, skuIds: string[]): Promise<Map<string, { physical: number; reserved: number; available: number; avgCost: number }>> {
  const out = new Map<string, { physical: number; reserved: number; available: number; avgCost: number }>();
  if (skuIds.length === 0) return out;
  const whs = await listAll(store, "warehouses", { filters: [["eq", "branchId", branchId], ["eq", "kind", "available"]] });
  const whIds = new Set(whs.map((w) => w.id));
  for (let i = 0; i < skuIds.length; i += 100) {
    const chunk = skuIds.slice(i, i + 100);
    const bals = await listAll(store, "stock_balances", { filters: [["eq", "skuId", chunk], ["eq", "branchId", branchId]] });
    for (const b of bals) {
      if (!whIds.has(b.warehouseId)) continue;
      const cur = out.get(b.skuId) ?? { physical: 0, reserved: 0, available: 0, avgCost: b.avgCost ?? 0 };
      cur.physical += b.physical;
      cur.reserved += b.reserved;
      cur.available = cur.physical - cur.reserved;
      cur.avgCost = b.avgCost ?? cur.avgCost;
      out.set(b.skuId, cur);
    }
  }
  return out;
}
