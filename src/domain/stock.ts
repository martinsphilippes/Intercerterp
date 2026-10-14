import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { DEFAULT_TZ, nowIso, startOfLocalDay, toLocalDate, today } from "@/lib/dates";
import { roundDiv, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { allocateBack, allocateExit, applyParts, mergeParts, normDate, normLot, targetSplit, type LotEntry, type LotPart } from "./lot-calc";

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
  | "damage_in"
  | "supplier_return"
  | "supplier_return_cancel"
  | "assembly_out"
  | "assembly_in"
  /**
   * ajuste só de custo (quantidade 0): frete de CT-e de entrada lançado depois do recebimento concluído (COM-10) e
   * diferença de custo da nota confirmada depois da entrada (§40 — entrada com nota a confirmar; pode ser negativa)
   */
  | "cost_adjust";

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
  supplier_return: "Saída por devolução ao fornecedor",
  supplier_return_cancel: "Estorno de devolução ao fornecedor",
  assembly_out: "Saída por montagem/desmembramento",
  assembly_in: "Entrada por montagem/desmembramento",
  cost_adjust: "Ajuste de custo (frete CT-e / nota)",
};

export interface MovementInput {
  warehouseId: string;
  skuId: string;
  /** variação do saldo físico em milésimos (positivo = entrada) */
  qty: number;
  type: MovementType;
  /**
   * custo unitário em centavos. Entradas: custo de entrada. Saídas: sem valor, usam o custo médio vigente; a venda
   * informa o custo que registrou no item (o médio no momento da venda), para o movimento bater com o custo da venda.
   */
  unitCost?: number | null;
  /** custo total exato da entrada em centavos (ex.: linha do recebimento); evita a sobra do arredondamento unitário */
  totalCost?: number | null;
  originType?: string;
  originId?: string;
  operationId?: string;
  reason?: string;
  /** chave de idempotência do efeito: o mesmo efeito nunca é lançado duas vezes */
  idemKey: string;
  allowNegative?: boolean;
  occurredAt?: string;
  /**
   * Lote/validade. Produto SEM controle de lote: informativo, como sempre. Produto COM controle (`products.lotControl`):
   * na entrada é o lote que recebe a quantidade; na saída é o lote preferido (o restante sai por FEFO).
   */
  lot?: string | null;
  lotExpiry?: string | null;
  /** data de fabricação do lote (rastro da NF-e), quando conhecida */
  lotMfg?: string | null;
  /** produto com controle de lote: divisão explícita por lote (quantidades com sinal; a soma deve ser `qty`) */
  lotSplit?: LotPart[] | null;
  /** produto com controle de lote: entrada que desfaz esta saída volta aos lotes de onde ela tirou */
  sourceMovementId?: string | null;
  /** inventário por lote: quantidades contadas por lote; o movimento leva os lotes a elas (pode ter `qty` 0) */
  lotTarget?: LotPart[] | null;
  documentRef?: string | null;
  notes?: string | null;
  /**
   * Saída que não pode consumir o estoque reservado (disponível = físico − reservado): ajustes e
   * saídas manuais e perdas. Expedições de transferência (que consomem a própria reserva), vendas e
   * inventário não usam esta regra.
   */
  respectReserved?: boolean;
  /** `cost_adjust` com valor negativo (redução do custo médio — nota confirmada com custo menor, §40) */
  allowCostReduction?: boolean;
}

export const balanceId = (warehouseId: string, skuId: string) => detId("bal", warehouseId, skuId);

/**
 * Entradas que trazem custo próprio e recompõem o custo médio ponderado do saldo. Estorno e devolução voltam pelo
 * custo com que saíram (custo da venda). Montagem/desmembramento (`assembly_in`) entra pelo custo dos itens consumidos.
 */
export const COST_ENTRY_TYPES: MovementType[] = ["purchase", "initial", "manual_in", "adjust_in", "transfer_in", "transfer_return", "damage_in", "sale_cancel", "return", "supplier_return_cancel", "assembly_in"];

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
  fiscal_document: "Documento fiscal",
  fiscal_document_cancel: "Cancelamento de documento fiscal",
  transfer: "Transferência",
  inventory: "Inventário",
  manual: "Ajuste manual",
  product: "Cadastro de produto",
  import: "Importação de produtos",
  seed: "Carga inicial (demonstração)",
  sales_document: "Pedido de venda (reserva)",
  assembly: "Montagem/desmembramento",
  cart: "Pré-venda (reserva)",
  freight_cte: "CT-e de frete (compra)",
  receipt_invoice: "Confirmação da nota (entrada com nota a confirmar)",
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
    case "receipt_invoice":
      return `/compras/recebimentos/${originId}`;
    case "purchase_order":
      return `/compras/pedidos/${originId}`;
    case "fiscal_document":
    case "fiscal_document_cancel":
      return `/fiscal/nfe/${originId}`;
    case "transfer":
      return `/estoque/transferencias/${originId}`;
    case "inventory":
      return `/estoque/inventarios/${originId}`;
    case "product":
      return `/produtos/${originId}?tab=estoque`;
    case "import":
      return `/produtos/importar/${originId}`;
    case "sales_document":
      return `/vendas/pedidos/${originId}`;
    case "assembly":
      return `/estoque/montagem?id=${originId}`;
    case "freight_cte":
      return `/compras/cte/${originId}`;
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
    // quantidade 0 só no reenquadramento de lotes do inventário (o físico não muda)
    if (!Number.isInteger(m.qty) || (m.qty === 0 && !m.lotTarget && m.type !== "cost_adjust")) throw new BusinessError("Quantidade do movimento deve ser diferente de zero.");
    // ajuste de custo (COM-10): só valor, sem quantidade. Valor negativo só quando explicitamente permitido (redução de
    // custo da nota confirmada depois da entrada — §40); o frete de CT-e continua exigindo valor positivo.
    if (m.type === "cost_adjust" && (m.qty !== 0 || !(Number.isInteger(m.totalCost) && ((m.totalCost as number) > 0 || (m.allowCostReduction && (m.totalCost as number) < 0))))) throw new BusinessError("Ajuste de custo exige quantidade zero e valor positivo.");
    await ensureBalance(store, ctx, m.warehouseId, m.skuId);
  }
  // controle de lote por produto (lido uma vez por chamada)
  const lotControl = new Map<string, boolean>();
  const tracked = async (productId: string | null | undefined) => {
    if (!productId) return false;
    if (!lotControl.has(productId)) lotControl.set(productId, Boolean((await store.get("products", productId))?.lotControl));
    return lotControl.get(productId)!;
  };
  const run = async (t: Store) => {
    const cache = new Map<string, Doc>();
    const created: Doc[] = [];
    // partes já devolvidas nesta chamada por saída de origem (ainda não gravadas)
    const backInCall = new Map<string, LotPart[]>();
    for (const m of inputs) {
      const movId = detId("mov", m.idemKey);
      if (await store.get("stock_movements", movId)) continue;
      const bid = balanceId(m.warehouseId, m.skuId);
      const bal = cache.get(bid) ?? (await store.getOrThrow("stock_balances", bid));
      // ── lotes (produto com controle): divisão do movimento e novo saldo por lote, gravados junto com o físico
      let lotParts: LotPart[] | null = null;
      let newLots: LotEntry[] | null = null;
      if (m.type !== "cost_adjust" && (await tracked(bal.productId))) {
        const curLots = (bal.lots ?? []) as LotEntry[];
        if (m.lotTarget) lotParts = targetSplit(curLots, m.lotTarget, m.qty);
        else if (m.lotSplit) lotParts = mergeParts(m.lotSplit.map((p) => ({ lot: normLot(p.lot), expiry: normDate(p.expiry), mfg: normDate(p.mfg), qty: p.qty })));
        else if (m.sourceMovementId && m.qty > 0) {
          const source = await store.get("stock_movements", m.sourceMovementId);
          // gravadas antes desta chamada (as desta chamada vêm de `backInCall`, mesmo que o armazenamento já as mostre)
          const prior = (await listAll(store, "stock_movements", { filters: [["eq", "sourceMovementId", m.sourceMovementId]] })).filter((x) => !created.some((c) => c.id === x.id)).flatMap((x) => (x.lots ?? []) as LotPart[]);
          const inCall = backInCall.get(m.sourceMovementId) ?? [];
          const srcParts = ((source?.lots ?? []) as LotPart[]).filter((p) => p.qty < 0);
          lotParts = allocateBack(srcParts, [...prior, ...inCall], m.qty);
          backInCall.set(m.sourceMovementId, [...inCall, ...lotParts]);
        } else if (m.qty > 0) lotParts = [{ lot: normLot(m.lot), expiry: normLot(m.lot) ? normDate(m.lotExpiry) : null, mfg: normLot(m.lot) ? normDate(m.lotMfg) : null, qty: m.qty }];
        else if (m.qty < 0) lotParts = allocateExit(curLots, bal.physical as number, -m.qty, m.lot, today()).map((p) => ({ ...p, qty: -p.qty }));
        lotParts = mergeParts(lotParts ?? []);
        newLots = applyParts(curLots, lotParts);
      }
      if (m.qty === 0 && !(lotParts ?? []).length && m.type !== "cost_adjust") continue; // inventário sem diferença por lote: nada a lançar
      // ajuste de custo sem saldo físico: não há estoque que absorva o valor — nada a lançar
      if (m.type === "cost_adjust" && Math.max(bal.physical as number, 0) <= 0) continue;
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
      let entryTotal: number | null = null;
      if (m.type === "cost_adjust") {
        // valor acrescido ao estoque existente: novo custo médio = (saldo × médio + valor) ÷ saldo
        unitCost = 0;
        entryTotal = m.totalCost as number;
        // redução de custo (§40) nunca deixa o valor do estoque negativo
        if ((before as number) * avg + entryTotal * QTY < 0) throw new BusinessError("Ajuste de custo maior que o valor do estoque do item.", "cost_adjust_exceeds");
        avg = roundDiv((before as number) * avg + entryTotal * QTY, before as number);
      } else if (m.qty > 0 && m.unitCost != null && COST_ENTRY_TYPES.includes(m.type)) {
        unitCost = m.unitCost;
        entryTotal = m.totalCost != null && m.totalCost >= 0 ? m.totalCost : null;
        const basis = Math.max(before, 0);
        // valor da entrada em centavos × milésimos: total exato quando informado, senão custo unitário × quantidade
        const entryValue = entryTotal != null ? entryTotal * QTY : m.qty * unitCost;
        avg = basis + m.qty > 0 ? roundDiv(basis * avg + entryValue, basis + m.qty) : unitCost;
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
          totalCost: entryTotal ?? roundDiv(Math.abs(m.qty) * unitCost, QTY),
          avgCostAfter: avg,
          seq,
          originType: m.originType ?? null,
          originId: m.originId ?? null,
          operationId: m.operationId ?? null,
          reason: m.reason ?? null,
          occurredAt,
          idemKey: m.idemKey,
          lot: lotParts ? (lotParts.find((p) => p.lot)?.lot ?? null) : (m.lot ?? null),
          lotExpiry: lotParts ? (lotParts.find((p) => p.lot)?.expiry ?? null) : (m.lotExpiry ?? null),
          documentRef: m.documentRef ?? null,
          notes: m.notes ?? null,
          ...(lotParts ? { lots: lotParts } : {}),
          ...(m.sourceMovementId ? { sourceMovementId: m.sourceMovementId } : {}),
        },
        movId,
      );
      const balPatch: Record<string, any> = { physical: after, avgCost: avg, seq, lastMovementAt: occurredAt };
      if (newLots) balPatch.lots = newLots;
      const updated = { ...bal, ...balPatch };
      await t.update("stock_balances", bid, balPatch);
      if (m.qty < 0 && m.respectReserved && !m.allowNegative) {
        // Reserva gravada depois da leitura acima (ex.: separação simultânea): o limite atômico confere, no
        // commit, que o reservado vigente não passa do físico resultante (+1/−1: efeito líquido nulo).
        await t.increment("stock_balances", bid, "reserved", 1, { max: after + 1 });
        await t.increment("stock_balances", bid, "reserved", -1);
      }
      cache.set(bid, updated);
      created.push(mov);
    }
    return created;
  };
  if (tx) return run(tx);
  const guarded = inputs.some((m) => m.qty < 0 && m.respectReserved && !m.allowNegative);
  for (let attempt = 0; ; attempt++) {
    try {
      return await retryOnConflict(() => store.transaction(run));
    } catch (e) {
      if (!guarded || !isConflict(e) || e.reason !== "bounds") throw e;
      // o reservado mudou entre a leitura e o commit: relê (a conferência do disponível recusa com a mensagem completa)
      if (attempt >= 2) throw new BusinessError("Saída excede o disponível: uma reserva (transferência separada) foi registrada para este item ao mesmo tempo. Atualize a página e confira o disponível.", "reserved_stock");
    }
  }
}

/**
 * Reserva quantidade (reduz disponível). Idempotente por idemKey: a mesma chave ativa (ou já consumida)
 * não reserva de novo. Uma chave cuja reserva foi LIBERADA não é reaproveitada (a reserva não volta a
 * valer sem conferir o disponível) — o chamador usa nova chave a cada tentativa.
 * O incremento de `reserved` é limitado ao físico lido (duas reservas simultâneas não passam do físico) e a
 * reserva é serializada com os movimentos pela sequência do saldo: se algum movimento (ex.: saída manual)
 * mudou o físico entre a leitura e o commit, a transação falha e a reserva é refeita sobre o saldo relido.
 */
export async function reserve(ctx: Ctx, input: { warehouseId: string; skuId: string; qty: number; originType: string; originId: string; idemKey: string; allowNegative?: boolean }) {
  const store = ctx.store;
  const rid = detId("rsv", input.idemKey);
  for (let attempt = 0; ; attempt++) {
    const bal = await ensureBalance(store, ctx, input.warehouseId, input.skuId);
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
        if (input.allowNegative) {
          await t.increment("stock_balances", bal.id, "reserved", input.qty);
          return;
        }
        await t.increment("stock_balances", bal.id, "reserved", input.qty, { max: Math.max(bal.physical, 0) });
        // o físico lido ainda vale no commit: nenhum movimento entrou no saldo desde a leitura (+1/−1: seq inalterada)
        await t.increment("stock_balances", bal.id, "seq", 1, { max: ((bal.seq as number) ?? 0) + 1 });
        await t.increment("stock_balances", bal.id, "seq", -1);
      });
      return;
    } catch (e) {
      if (isConflict(e) && e.reason === "bounds") {
        // reserva ou movimento concorrente: relê o saldo (a conferência do disponível decide)
        if (attempt < 4) {
          await new Promise((r) => setTimeout(r, 5 + Math.random() * 15 * (attempt + 1)));
          continue;
        }
        throw await insufficient();
      }
      // repetição simultânea da mesma chave: a outra chamada já reservou
      if (isConflict(e) && (await store.get("stock_reservations", rid))?.status === "active") return;
      throw e;
    }
  }
}

/**
 * Libera (ou consome) reservas ativas de uma origem. Devolve quantas reservas foram encerradas agora.
 * Se `tx` for informado, participa da transação do chamador (ex.: expedição de transferência).
 * Cada reserva é encerrada UMA vez (marcador determinístico na mesma transação): liberação e consumo
 * simultâneos da mesma reserva (ex.: cancelar × expedir) não baixam o reservado duas vezes.
 */
export async function releaseReservations(ctx: Ctx, originType: string, originId: string, status: "released" | "consumed" = "released", skuId?: string, tx?: Store) {
  const store = ctx.store;
  const filters: any[] = [["eq", "originType", originType], ["eq", "originId", originId], ["eq", "status", "active"]];
  if (skuId) filters.push(["eq", "skuId", skuId]);
  const items = await listAll(store, "stock_reservations", { filters });
  let ended = 0;
  for (const r of items) {
    const markerId = detId("rsv-end", r.id);
    const apply = async (t: Store) => {
      await t.create("operations", { companyId: ctx.companyId, type: "stock.reservation_end", status: "done", entityType: "stock_reservation", entityId: r.id, result: { status }, createdBy: ctx.user.id }, markerId);
      await t.update("stock_reservations", r.id, { status });
      await t.increment("stock_balances", balanceId(r.warehouseId, r.skuId), "reserved", -r.qty);
    };
    if (tx) {
      await apply(tx);
      ended++;
      continue;
    }
    const done = await retryOnConflict(async () => {
      if (await store.get("operations", markerId)) return false; // encerrada por outra operação
      await store.transaction(apply);
      return true;
    });
    if (done) ended++;
  }
  return ended;
}

/** Reservado ativo de uma origem por SKU na filial (a própria reserva conta como disponível para quem a fez). */
export async function reservedForOrigin(store: Store, originType: string, originId: string, branchId: string) {
  const rs = await listAll(store, "stock_reservations", { filters: [["eq", "originType", originType], ["eq", "originId", originId], ["eq", "status", "active"]] });
  const out = new Map<string, number>();
  for (const r of rs) if (r.branchId === branchId) out.set(r.skuId, (out.get(r.skuId) ?? 0) + (r.qty ?? 0));
  return out;
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
