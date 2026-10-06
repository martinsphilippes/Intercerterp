import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { DEFAULT_TZ, nowIso, startOfLocalDay, toLocalDate } from "@/lib/dates";
import { roundDiv, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";

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
  /** rastreabilidade informativa (lote/validade/documento) — o saldo não é controlado por lote */
  lot?: string | null;
  lotExpiry?: string | null;
  documentRef?: string | null;
  notes?: string | null;
  /**
   * Saída que não pode consumir o estoque reservado (disponível = físico − reservado): ajustes e
   * saídas manuais e perdas. Expedições de transferência (que consomem a própria reserva), vendas e
   * inventário não usam esta regra.
   */
  respectReserved?: boolean;
}

export const balanceId = (warehouseId: string, skuId: string) => detId("bal", warehouseId, skuId);

/** Entradas que trazem custo próprio e recalculam o custo médio ponderado do saldo. */
export const COST_ENTRY_TYPES: MovementType[] = ["purchase", "initial", "manual_in", "adjust_in", "transfer_in", "transfer_return", "damage_in"];

/** Tipos de ajuste manual (Tela 17) — exigem a permissão especial `stock.adjust` e motivo. */
export const MANUAL_TYPES = ["adjust_in", "adjust_out", "loss", "manual_in", "manual_out"] as const;
export type ManualType = (typeof MANUAL_TYPES)[number];

/** Rótulos das origens de movimento e links para o registro que originou o efeito. */
export const ORIGIN_LABEL: Record<string, string> = {
  sale: "Venda",
  sale_cancel: "Cancelamento de venda",
  return: "Devolução/troca",
  purchase: "Compra",
  receipt: "Recebimento de compra",
  purchase_receipt: "Recebimento de compra",
  purchase_order: "Pedido de compra",
  transfer: "Transferência",
  inventory: "Inventário",
  manual: "Ajuste manual",
  product: "Cadastro de produto",
  import: "Importação de produtos",
  seed: "Carga inicial (demonstração)",
};

export function originHref(originType: string | null | undefined, originId: string | null | undefined): string | null {
  if (!originType || !originId) return null;
  switch (originType) {
    case "sale":
    case "sale_cancel":
      return `/vendas/${originId}`;
    case "return":
      return `/vendas/devolucoes/${originId}`;
    case "receipt":
    case "purchase_receipt":
    case "purchase":
      return `/compras/recebimentos/${originId}`;
    case "purchase_order":
      return `/compras/pedidos/${originId}`;
    case "transfer":
      return `/estoque/transferencias/${originId}`;
    case "inventory":
      return `/estoque/inventarios/${originId}`;
    case "product":
      return `/produtos/${originId}?tab=estoque`;
    case "import":
      return `/produtos/importar/${originId}`;
    default:
      return null;
  }
}

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
      const reserved = (bal.reserved as number) ?? 0;
      if (m.qty < 0 && m.respectReserved && !m.allowNegative && reserved > 0 && after < reserved) {
        const sku = await store.get("skus", m.skuId);
        throw new BusinessError(
          `Saída excede o disponível de ${sku?.sku ?? m.skuId}: físico ${before / QTY}, reservado ${reserved / QTY}, disponível ${Math.max(0, before - reserved) / QTY}, solicitado ${-m.qty / QTY}. O reservado pertence a transferências separadas — cancele ou ajuste a transferência antes de dar saída nessas unidades.`,
          "reserved_stock",
          { skuId: m.skuId },
        );
      }
      let avg = bal.avgCost as number;
      let unitCost: number;
      if (m.qty > 0 && m.unitCost != null && COST_ENTRY_TYPES.includes(m.type)) {
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
          lot: m.lot ?? null,
          lotExpiry: m.lotExpiry ?? null,
          documentRef: m.documentRef ?? null,
          notes: m.notes ?? null,
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

/**
 * Reserva quantidade (reduz disponível). Idempotente por idemKey: a mesma chave ativa (ou já consumida)
 * não reserva de novo. Uma chave cuja reserva foi LIBERADA não é reaproveitada (a reserva não volta a
 * valer sem conferir o disponível) — o chamador usa nova chave a cada tentativa.
 * O incremento de `reserved` é limitado ao físico lido: duas reservas simultâneas não passam do físico.
 */
export async function reserve(ctx: Ctx, input: { warehouseId: string; skuId: string; qty: number; originType: string; originId: string; idemKey: string; allowNegative?: boolean }) {
  const store = ctx.store;
  const bal = await ensureBalance(store, ctx, input.warehouseId, input.skuId);
  const rid = detId("rsv", input.idemKey);
  const existing = await store.get("stock_reservations", rid);
  if (existing) {
    if (existing.status === "released") throw new BusinessError("A reserva desta tentativa já foi liberada; repita a separação.", "reservation_released");
    return;
  }
  const available = bal.physical - bal.reserved;
  const insufficient = async () => {
    const sku = await store.get("skus", input.skuId);
    return new BusinessError(`Disponível insuficiente para reservar ${sku?.sku ?? ""}: ${available / QTY}.`, "insufficient_stock");
  };
  if (!input.allowNegative && available < input.qty) throw await insufficient();
  try {
    await store.transaction(async (t) => {
      await t.create(
        "stock_reservations",
        { companyId: ctx.companyId, branchId: bal.branchId, createdBy: ctx.user.id, warehouseId: input.warehouseId, skuId: input.skuId, qty: input.qty, originType: input.originType, originId: input.originId, status: "active", idemKey: input.idemKey },
        rid,
      );
      await t.increment("stock_balances", bal.id, "reserved", input.qty, input.allowNegative ? undefined : { max: Math.max(bal.physical, 0) });
    });
  } catch (e) {
    if (isConflict(e) && e.reason === "bounds") throw await insufficient();
    // repetição simultânea da mesma chave: a outra chamada já reservou
    if (isConflict(e) && (await store.get("stock_reservations", rid))?.status === "active") return;
    throw e;
  }
}

/**
 * Libera (ou consome) reservas ativas de uma origem.
 * Se `tx` for informado, participa da transação do chamador (ex.: expedição de transferência).
 */
export async function releaseReservations(ctx: Ctx, originType: string, originId: string, status: "released" | "consumed" = "released", skuId?: string, tx?: Store) {
  const store = ctx.store;
  const filters: any[] = [["eq", "originType", originType], ["eq", "originId", originId], ["eq", "status", "active"]];
  if (skuId) filters.push(["eq", "skuId", skuId]);
  const items = await listAll(store, "stock_reservations", { filters });
  for (const r of items) {
    const apply = async (t: Store) => {
      await t.update("stock_reservations", r.id, { status });
      await t.increment("stock_balances", balanceId(r.warehouseId, r.skuId), "reserved", -r.qty);
    };
    if (tx) await apply(tx);
    else await store.transaction(apply);
  }
  return items.length;
}

/**
 * Ajusta o saldo em trânsito (não físico, nunca disponível). Com `tx`, participa da transação do chamador;
 * `bounds.min` (ex.: 0) impede que a baixa deixe o trânsito negativo (ConflictError "bounds").
 */
export async function adjustInTransit(ctx: Ctx, warehouseId: string, skuId: string, delta: number, tx?: Store, bounds?: { min?: number; max?: number }) {
  const bal = await ensureBalance(ctx.store, ctx, warehouseId, skuId);
  await (tx ?? ctx.store).increment("stock_balances", bal.id, "inTransit", delta, bounds);
}

/**
 * Executa um efeito composto UMA única vez por chave (marcador determinístico em `operations` criado
 * na mesma transação dos efeitos). Repetições e chamadas concorrentes encontram o marcador e não reaplicam.
 * Retorna true quando aplicou agora, false quando já estava aplicado.
 */
export async function applyOnce(ctx: Ctx, key: string, meta: { entityType: string; entityId: string }, fn: (tx: Store) => Promise<void>): Promise<boolean> {
  const markerId = detId("once", key);
  return retryOnConflict(async () => {
    if (await ctx.store.get("operations", markerId)) return false;
    return ctx.store.transaction(async (t) => {
      await t.create("operations", { companyId: ctx.companyId, type: "stock.once", status: "done", entityType: meta.entityType, entityId: meta.entityId, result: { key }, createdBy: ctx.user.id }, markerId);
      await fn(t);
      return true;
    });
  });
}

/**
 * Ajuste manual de estoque (entrada, saída, perda) — Tela 17. Sempre por movimento rastreável:
 * exige `stock.adjust`, filial definida, depósito da filial e motivo. Idempotente pela chave do formulário.
 */
export async function adjustStock(
  ctx: Ctx,
  input: { warehouseId: string; skuId: string; type: ManualType; qty: number; unitCost?: number | null; reason: string; idemKey: string; occurredAt?: string; lot?: string | null; lotExpiry?: string | null; documentRef?: string | null; notes?: string | null },
) {
  requireAction(ctx, "stock.adjust");
  const branchId = requireBranch(ctx);
  assert((MANUAL_TYPES as readonly string[]).includes(input.type), "Tipo de ajuste inválido.");
  assert(Number.isInteger(input.qty) && input.qty > 0, "Informe uma quantidade maior que zero.");
  assert(input.reason?.trim(), "Informe o motivo do ajuste (fica registrado no histórico).");
  const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
  assert(wh.companyId === ctx.companyId && wh.branchId === branchId, "O depósito não pertence à filial selecionada.");
  const sku = await ctx.store.getOrThrow("skus", input.skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  const product = await ctx.store.get("products", sku.productId);
  assert(product?.type !== "service", "Serviços não têm estoque.");
  const sign = input.type === "adjust_in" || input.type === "manual_in" ? 1 : -1;
  if (input.occurredAt) {
    assert(!Number.isNaN(Date.parse(input.occurredAt)), "Data do movimento inválida.");
    assert(input.occurredAt <= new Date(Date.now() + 60000).toISOString(), "A data do ajuste não pode ser futura.");
  }
  const [mov] = await postMovements(ctx, [
    {
      warehouseId: wh.id,
      skuId: sku.id,
      qty: sign * input.qty,
      type: input.type,
      unitCost: sign > 0 ? (input.unitCost ?? null) : null,
      originType: "manual",
      originId: detId("adj", input.idemKey),
      reason: input.reason.trim(),
      idemKey: `manual:${input.idemKey}`,
      occurredAt: input.occurredAt,
      // saída manual, ajuste de saída e perda não consomem o que está reservado (transferências separadas)
      respectReserved: sign < 0,
      lot: input.lot?.trim() || null,
      lotExpiry: input.lotExpiry || null,
      documentRef: input.documentRef?.trim() || null,
      notes: input.notes?.trim().slice(0, 500) || null,
    },
  ]);
  const movement = mov ?? (await ctx.store.get("stock_movements", detId("mov", `manual:${input.idemKey}`)));
  if (mov) {
    await audit(ctx, {
      module: "stock",
      action: `stock.${input.type}`,
      entityType: "stock_movement",
      entityId: mov.id,
      summary: `${MOVEMENT_LABEL[input.type]}: ${sign > 0 ? "+" : "−"}${input.qty / QTY} ${sku.unitCode ?? ""} de ${sku.sku} em ${wh.name}`,
      reason: input.reason.trim(),
      after: { qty: mov.qty, balanceBefore: mov.balanceBefore, balanceAfter: mov.balanceAfter, unitCost: mov.unitCost },
      related: [`sku:${sku.id}`, `product:${sku.productId}`],
    });
  }
  return movement;
}

/**
 * Converte o valor de um campo `datetime-local` ("AAAA-MM-DDTHH:mm[:ss]", horário de parede) em instante
 * ISO UTC, interpretando-o no fuso informado (padrão America/Sao_Paulo) — e não no fuso do servidor.
 * Valor fora do formato devolve null (o chamador recusa com mensagem).
 */
export function localDateTimeToIso(value: string, tz: string = DEFAULT_TZ): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, date, hh, mm, ss] = m;
  if (+hh > 23 || +mm > 59 || +(ss ?? 0) > 59) return null;
  let t: number;
  try {
    t = Date.parse(startOfLocalDay(date, tz)) + ((+hh * 60 + +mm) * 60 + +(ss ?? 0)) * 1000;
  } catch {
    return null;
  }
  if (Number.isNaN(t)) return null;
  // correção de horário de verão: compara o relógio local obtido com o pedido e reajusta uma vez
  const [y, mo, d] = date.split("-").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, +hh, +mm, +(ss ?? 0));
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))) p[x.type] = x.value;
  const got = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  t += wanted - got;
  const iso = new Date(t).toISOString();
  return toLocalDate(iso, tz) === date ? iso : null;
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
