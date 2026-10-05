import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { nowIso } from "@/lib/dates";
import { QTY, roundDiv } from "@/lib/money";
import { adjustInTransit, applyOnce, damageWarehouse, defaultWarehouse, postMovements, releaseReservations, reserve, type MovementInput } from "./stock";

/**
 * Transferência entre filiais (Tela 18).
 *
 * Estados: rascunho → separado (reserva na origem) → em trânsito (saída `transfer_out` na origem,
 * consumo da reserva e `inTransit` no destino) → recebido parcial/total (entrada `transfer_in` no destino
 * com o custo de origem, baixa do trânsito), e cancelado.
 *
 * Divergências no recebimento: avaria vai para o depósito de avarias do destino (`damage_in`);
 * o que não chegou permanece em trânsito até ser recebido depois, devolvido à origem (`transfer_return`)
 * ou baixado como perda (retorno + `loss` na origem, ambos rastreáveis).
 * Conservação: origem + trânsito + destino + avarias (+ perdas baixadas) = saldo antes da expedição.
 * O trânsito nunca entra no disponível de nenhuma filial.
 *
 * Idempotência: cada efeito por item é aplicado uma única vez (`applyOnce` + idemKey dos movimentos);
 * repetir uma transição já feita não altera nada.
 */

export interface TransferItem {
  skuId: string;
  productId: string;
  sku: string;
  name: string;
  unitCode: string;
  qty: number;
  shippedQty: number;
  unitCost: number;
  receivedQty: number;
  damagedQty: number;
  returnedQty: number;
  lostQty: number;
}

export interface TransferReceiptLine {
  skuId: string;
  receivedQty: number;
  damagedQty: number;
  note?: string | null;
}

/** Código de exibição da transferência (ex.: TR-00042). */
export const transferCode = (n: number | null | undefined) => `TR-${String(n ?? 0).padStart(5, "0")}`;

export const pendingQty = (i: TransferItem) => Math.max(0, (i.shippedQty ?? 0) - (i.receivedQty ?? 0) - (i.damagedQty ?? 0) - (i.returnedQty ?? 0) - (i.lostQty ?? 0));

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  separated: "Separado",
  in_transit: "Em trânsito",
  partial: "Recebido parcial",
  received: "Recebido",
  cancelled: "Cancelado",
};

async function loadTransfer(ctx: Ctx, id: string) {
  const t = await ctx.store.getOrThrow("transfers", id);
  assert(t.companyId === ctx.companyId, "Transferência de outra empresa.");
  return t;
}

async function buildItems(ctx: Ctx, lines: Array<{ skuId: string; qty: number }>): Promise<TransferItem[]> {
  const merged = new Map<string, number>();
  for (const l of lines) {
    assert(Number.isInteger(l.qty) && l.qty > 0, "Quantidades devem ser maiores que zero.");
    merged.set(l.skuId, (merged.get(l.skuId) ?? 0) + l.qty);
  }
  assert(merged.size > 0, "Inclua ao menos um item.");
  assert(merged.size <= 200, "Máximo de 200 itens por transferência.");
  const out: TransferItem[] = [];
  for (const [skuId, qty] of merged) {
    const sku = await ctx.store.getOrThrow("skus", skuId);
    assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
    const product = await ctx.store.getOrThrow("products", sku.productId);
    assert(product.type !== "service", `${sku.name}: serviços não têm estoque.`);
    out.push({ skuId, productId: sku.productId, sku: sku.sku, name: sku.name, unitCode: sku.unitCode ?? product.unitCode, qty, shippedQty: 0, unitCost: 0, receivedQty: 0, damagedQty: 0, returnedQty: 0, lostQty: 0 });
  }
  return out;
}

async function resolveWarehouses(ctx: Ctx, fromBranchId: string, toBranchId: string, fromWarehouseId?: string | null, toWarehouseId?: string | null) {
  const from = fromWarehouseId ? await ctx.store.getOrThrow("warehouses", fromWarehouseId) : await defaultWarehouse(ctx.store, fromBranchId);
  const to = toWarehouseId ? await ctx.store.getOrThrow("warehouses", toWarehouseId) : await defaultWarehouse(ctx.store, toBranchId);
  assert(from.branchId === fromBranchId && from.companyId === ctx.companyId, "Depósito de origem não pertence à filial de origem.");
  assert(to.branchId === toBranchId && to.companyId === ctx.companyId, "Depósito de destino não pertence à filial de destino.");
  assert(from.kind !== "damaged" && to.kind !== "damaged", "Use depósitos de estoque disponível (avarias têm fluxo próprio).");
  return { from, to };
}

export interface TransferInput {
  toBranchId: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  items: Array<{ skuId: string; qty: number }>;
  responsibleId?: string | null;
  notes?: string | null;
  /** previsão de chegada (AAAA-MM-DD) */
  expectedAt?: string | null;
  /** documento de referência (romaneio, NF-e emitida fora do ERP etc.) */
  documentRef?: string | null;
}

/** Cria rascunho na filial atual (origem). Idempotente por `idemKey`. */
export async function createTransfer(ctx: Ctx, input: TransferInput, opts: { idemKey?: string | null; id?: string } = {}) {
  requirePerm(ctx, "stock", "create");
  const fromBranchId = requireBranch(ctx);
  const id = opts.id ?? (opts.idemKey ? detId("transfer", ctx.companyId, opts.idemKey) : undefined);
  if (id) {
    const existing = await ctx.store.get("transfers", id);
    if (existing) return existing;
  }
  assert(input.toBranchId && input.toBranchId !== fromBranchId, "Escolha uma filial de destino diferente da origem.");
  const dest = await ctx.store.getOrThrow("branches", input.toBranchId);
  assert(dest.companyId === ctx.companyId, "Filial de destino de outra empresa.");
  const { from, to } = await resolveWarehouses(ctx, fromBranchId, input.toBranchId, input.fromWarehouseId, input.toWarehouseId);
  const items = await buildItems(ctx, input.items);
  const number = await nextNumber(ctx.store, `transfer:${ctx.companyId}`);
  const t = await ctx.store.create(
    "transfers",
    {
      companyId: ctx.companyId, branchId: fromBranchId, createdBy: ctx.user.id, number, fromBranchId, toBranchId: input.toBranchId, fromWarehouseId: from.id, toWarehouseId: to.id,
      status: "draft", items, responsibleId: input.responsibleId || ctx.user.id, notes: input.notes?.trim() || null, divergences: [], receipts: [],
      expectedAt: input.expectedAt || null, documentRef: input.documentRef?.trim() || null,
    },
    id,
  );
  await audit(ctx, { module: "stock", action: "transfer.create", entityType: "transfer", entityId: t.id, summary: `Transferência ${transferCode(number)} criada (${items.length} item(ns)) para ${dest.name}`, related: items.map((i) => `sku:${i.skuId}`) });
  return t;
}

export async function updateTransferDraft(ctx: Ctx, id: string, input: TransferInput) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  assert(t.status === "draft", "Somente rascunhos podem ser alterados.");
  assert(ctx.branchId === t.fromBranchId, "Altere a transferência no contexto da filial de origem.");
  assert(input.toBranchId && input.toBranchId !== t.fromBranchId, "Escolha uma filial de destino diferente da origem.");
  const { from, to } = await resolveWarehouses(ctx, t.fromBranchId, input.toBranchId, input.fromWarehouseId, input.toWarehouseId);
  const items = await buildItems(ctx, input.items);
  const u = await ctx.store.update("transfers", id, { toBranchId: input.toBranchId, fromWarehouseId: from.id, toWarehouseId: to.id, items, responsibleId: input.responsibleId || t.responsibleId, notes: input.notes?.trim() || null, expectedAt: input.expectedAt || null, documentRef: input.documentRef?.trim() || null });
  await audit(ctx, { module: "stock", action: "transfer.update", entityType: "transfer", entityId: id, summary: `Rascunho da transferência ${transferCode(t.number)} alterado`, before: { items: t.items.map((i: TransferItem) => [i.sku, i.qty]) }, after: { items: items.map((i) => [i.sku, i.qty]) } });
  return u;
}

/** Separação: reserva os itens na origem (reduz o disponível, não o físico). */
export async function separateTransfer(ctx: Ctx, id: string) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  if (t.status !== "draft") {
    if (["separated", "in_transit", "partial", "received"].includes(t.status)) return t; // já separada: idempotente
    throw new BusinessError("Transferência cancelada não pode ser separada.");
  }
  assert(ctx.branchId === t.fromBranchId, "A separação é feita no contexto da filial de origem.");
  try {
    for (const i of t.items as TransferItem[]) {
      await reserve(ctx, { warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: i.qty, originType: "transfer", originId: id, idemKey: `transfer:${id}:reserve:${i.skuId}` });
    }
  } catch (e) {
    await releaseReservations(ctx, "transfer", id, "released");
    throw e;
  }
  const u = await ctx.store.update("transfers", id, { status: "separated", separatedAt: nowIso() });
  await audit(ctx, { module: "stock", action: "transfer.separate", entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)} separada (itens reservados na origem)` });
  return u;
}

/**
 * Expedição: por item, de forma atômica e única — consome a reserva, lança `transfer_out` na origem
 * (custo médio vigente) e soma o trânsito no destino.
 */
export async function shipTransfer(ctx: Ctx, id: string) {
  requirePerm(ctx, "stock", "edit");
  let t = await loadTransfer(ctx, id);
  if (["in_transit", "partial", "received"].includes(t.status)) return t;
  if (t.status === "draft") t = await separateTransfer(ctx, id);
  assert(t.status === "separated", "Somente transferências separadas podem ser expedidas.");
  assert(ctx.branchId === t.fromBranchId, "A expedição é feita no contexto da filial de origem.");
  const items = t.items as TransferItem[];
  for (const i of items) {
    await applyOnce(ctx, `transfer:${id}:ship:${i.skuId}`, { entityType: "transfer", entityId: id }, async (tx) => {
      await releaseReservations(ctx, "transfer", id, "consumed", i.skuId, tx);
      await postMovements(ctx, [{ warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: -i.qty, type: "transfer_out", originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — expedição`, idemKey: `transfer:${id}:out:${i.skuId}` }], tx);
      await adjustInTransit(ctx, t.toWarehouseId, i.skuId, i.qty, tx);
    });
  }
  const next = await transferItemsFromMovements(ctx, t);
  const totalCost = next.reduce((a, i) => a + roundDiv(i.shippedQty * i.unitCost, QTY), 0);
  const u = await ctx.store.update("transfers", id, { status: "in_transit", items: next, shippedAt: t.shippedAt ?? nowIso(), shippedBy: ctx.user.id, totalCost });
  await audit(ctx, { module: "stock", action: "transfer.ship", entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)} expedida — em trânsito para o destino`, related: next.map((i) => `sku:${i.skuId}`) });
  return u;
}

/**
 * Quantidades por item derivadas dos movimentos da transferência (fonte de verdade, robusta a
 * operações concorrentes): expedido, recebido, avariado, devolvido e perdido.
 */
export async function transferItemsFromMovements(ctx: Ctx, t: Doc): Promise<TransferItem[]> {
  const movs = await listAll(ctx.store, "stock_movements", { filters: [["eq", "originType", "transfer"], ["eq", "originId", t.id]] });
  return (t.items as TransferItem[]).map((i) => {
    const m = movs.filter((x) => x.skuId === i.skuId);
    const sum = (type: string) => m.filter((x) => x.type === type).reduce((a, x) => a + x.qty, 0);
    const out = m.find((x) => x.type === "transfer_out");
    const lost = -sum("loss");
    return {
      ...i,
      shippedQty: -sum("transfer_out"),
      unitCost: out?.unitCost ?? i.unitCost ?? 0,
      receivedQty: sum("transfer_in"),
      damagedQty: sum("damage_in"),
      returnedQty: sum("transfer_return") - lost,
      lostQty: lost,
    };
  });
}

async function withTransitGuard<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    if (isConflict(e) && e.reason === "bounds") throw new BusinessError("A quantidade excede o saldo em trânsito desta transferência (outra operação pode ter sido registrada). Atualize a página.", "transit_exceeded");
    throw e;
  }
}

function statusAfter(items: TransferItem[]): "in_transit" | "partial" | "received" | "cancelled" {
  const pending = items.reduce((a, i) => a + pendingQty(i), 0);
  const arrived = items.reduce((a, i) => a + (i.receivedQty ?? 0) + (i.damagedQty ?? 0), 0);
  const returned = items.reduce((a, i) => a + (i.returnedQty ?? 0), 0);
  const lost = items.reduce((a, i) => a + (i.lostQty ?? 0), 0);
  if (pending > 0) return arrived > 0 || returned > 0 || lost > 0 ? "partial" : "in_transit";
  if (arrived === 0 && lost === 0 && returned > 0) return "cancelled";
  return "received";
}

/**
 * Recebimento (parcial ou total) no destino. Cada recebimento tem chave própria (formulário):
 * repetir o mesmo envio não duplica. Bom → `transfer_in` no depósito de destino com o custo de origem;
 * avariado → `damage_in` no depósito de avarias; ambos baixam o trânsito.
 */
export async function receiveTransfer(ctx: Ctx, id: string, input: { lines: TransferReceiptLine[]; idemKey: string; notes?: string | null }) {
  requirePerm(ctx, "stock", "edit");
  assert(input.idemKey, "Chave do recebimento ausente.");
  const t = await loadTransfer(ctx, id);
  const receipts = (t.receipts ?? []) as Array<Record<string, any>>;
  if (receipts.some((r) => r.key === input.idemKey)) return t;
  assert(["in_transit", "partial"].includes(t.status), "Só é possível receber transferências em trânsito.");
  assert(ctx.branchId === t.toBranchId, "O recebimento é feito no contexto da filial de destino.");
  const current = await transferItemsFromMovements(ctx, t);
  const lines = input.lines.filter((l) => (l.receivedQty ?? 0) > 0 || (l.damagedQty ?? 0) > 0);
  assert(lines.length > 0, "Informe as quantidades recebidas.");
  for (const l of lines) {
    const item = current.find((i) => i.skuId === l.skuId);
    assert(item, "Item não pertence à transferência.");
    assert(Number.isInteger(l.receivedQty) && l.receivedQty >= 0 && Number.isInteger(l.damagedQty) && l.damagedQty >= 0, "Quantidades inválidas.");
    assert(l.receivedQty + l.damagedQty <= pendingQty(item!), `${item!.sku}: recebido + avariado excede o pendente em trânsito (${pendingQty(item!) / QTY}).`);
  }
  const damaged = lines.some((l) => l.damagedQty > 0) ? await damageWarehouse(ctx, t.toBranchId) : null;
  const rk = detId("rcv", id, input.idemKey).slice(0, 16);
  for (const l of lines) {
    const item = current.find((i) => i.skuId === l.skuId)!;
    await withTransitGuard(() =>
      applyOnce(ctx, `transfer:${id}:rcv:${rk}:${l.skuId}`, { entityType: "transfer", entityId: id }, async (tx) => {
        const movs: MovementInput[] = [];
        if (l.receivedQty > 0) movs.push({ warehouseId: t.toWarehouseId, skuId: l.skuId, qty: l.receivedQty, type: "transfer_in", unitCost: item.unitCost, originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — recebimento`, idemKey: `transfer:${id}:in:${rk}:${l.skuId}` });
        if (l.damagedQty > 0) movs.push({ warehouseId: damaged!.id, skuId: l.skuId, qty: l.damagedQty, type: "damage_in", unitCost: item.unitCost, originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — avaria no recebimento${l.note ? `: ${l.note}` : ""}`, idemKey: `transfer:${id}:dmg:${rk}:${l.skuId}` });
        await postMovements(ctx, movs, tx);
        await adjustInTransit(ctx, t.toWarehouseId, l.skuId, -(l.receivedQty + l.damagedQty), tx, { min: 0 });
      }),
    );
  }
  const items = await transferItemsFromMovements(ctx, t);
  const at = nowIso();
  const divergences = [...((t.divergences ?? []) as any[])].map((d) => (d.kind === "missing" && d.open && lines.some((l) => l.skuId === d.skuId) ? { ...d, open: false, resolvedAs: "superseded", resolvedAt: at } : d));
  for (const l of lines) if (l.damagedQty > 0) divergences.push({ kind: "damaged", skuId: l.skuId, qty: l.damagedQty, note: l.note ?? null, at, by: ctx.user.id, warehouseId: damaged?.id });
  for (const i of items) {
    const p = pendingQty(i);
    const line = lines.find((l) => l.skuId === i.skuId);
    if (p > 0 && line) divergences.push({ kind: "missing", skuId: i.skuId, qty: p, note: line.note || "Quantidade não recebida (permanece em trânsito)", at, by: ctx.user.id, open: true });
  }
  const status = statusAfter(items);
  const u = await ctx.store.update("transfers", id, {
    items,
    status,
    divergences,
    receipts: [...receipts, { key: input.idemKey, at, by: ctx.user.id, lines, notes: input.notes ?? null }],
    receivedAt: status === "received" ? at : t.receivedAt ?? null,
    receivedBy: ctx.user.id,
  });
  const totalRec = lines.reduce((a, l) => a + l.receivedQty, 0);
  const totalDmg = lines.reduce((a, l) => a + l.damagedQty, 0);
  await audit(ctx, {
    module: "stock",
    action: "transfer.receive",
    entityType: "transfer",
    entityId: id,
    branchId: t.toBranchId,
    summary: `Transferência ${transferCode(t.number)}: recebido ${totalRec / QTY}${totalDmg ? `, avariado ${totalDmg / QTY}` : ""} — ${status === "received" ? "recebimento total" : "recebimento parcial"}`,
    related: lines.map((l) => `sku:${l.skuId}`),
  });
  return u;
}

/**
 * Resolve o que ficou pendente em trânsito: `return` devolve à origem (`transfer_return` com o custo
 * de origem); `loss` baixa como perda (retorno + `loss` na origem, ambos com motivo).
 */
export async function resolveTransferPending(ctx: Ctx, id: string, input: { mode: "return" | "loss"; reason: string; skuIds?: string[] }) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  if (["received", "cancelled"].includes(t.status)) return t; // já resolvida: idempotente
  assert(["in_transit", "partial"].includes(t.status), "Não há saldo em trânsito a resolver.");
  assert(ctx.branchId === t.fromBranchId || ctx.branchId === t.toBranchId, "Resolva no contexto da filial de origem ou de destino.");
  assert(input.reason?.trim(), "Informe o motivo.");
  const current = await transferItemsFromMovements(ctx, t);
  const targets = current.filter((i) => pendingQty(i) > 0 && (!input.skuIds?.length || input.skuIds.includes(i.skuId)));
  if (!targets.length) return t;
  const at = nowIso();
  for (const i of targets) {
    const q = pendingQty(i);
    // chave pelo estado acumulado: duas resoluções simultâneas do mesmo pendente aplicam uma só vez
    const base = `transfer:${id}:resolve:${i.skuId}:${i.returnedQty + i.lostQty + i.receivedQty + i.damagedQty}`;
    await withTransitGuard(() =>
      applyOnce(ctx, base, { entityType: "transfer", entityId: id }, async (tx) => {
        const movs: MovementInput[] = [
          { warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: q, type: "transfer_return", unitCost: i.unitCost, originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — ${input.mode === "return" ? "retorno à origem" : "falta (retorno contábil)"}: ${input.reason.trim()}`, idemKey: `${base}:ret` },
        ];
        if (input.mode === "loss") movs.push({ warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: -q, type: "loss", originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — falta baixada como perda: ${input.reason.trim()}`, idemKey: `${base}:loss`, allowNegative: true });
        await postMovements(ctx, movs, tx);
        await adjustInTransit(ctx, t.toWarehouseId, i.skuId, -q, tx, { min: 0 });
      }),
    );
  }
  const items = await transferItemsFromMovements(ctx, t);
  const divergences = [...((t.divergences ?? []) as any[])].map((d) => (d.kind === "missing" && d.open && targets.some((x) => x.skuId === d.skuId) ? { ...d, open: false, resolvedAs: input.mode, resolvedAt: at } : d));
  for (const i of targets) divergences.push({ kind: input.mode === "return" ? "returned" : "lost", skuId: i.skuId, qty: pendingQty(i), note: input.reason.trim(), at, by: ctx.user.id });
  const status = statusAfter(items);
  const u = await ctx.store.update("transfers", id, { items, divergences, status, returnedAt: input.mode === "return" ? at : t.returnedAt ?? null, receivedAt: status === "received" ? (t.receivedAt ?? at) : t.receivedAt ?? null, cancelledAt: status === "cancelled" ? at : null });
  await audit(ctx, { module: "stock", action: `transfer.${input.mode}`, entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)}: pendente ${input.mode === "return" ? "devolvido à origem" : "baixado como perda"} (${targets.length} item(ns))`, reason: input.reason.trim(), related: targets.map((i) => `sku:${i.skuId}`) });
  return u;
}

/** Cancela rascunho ou separada (libera reservas). Depois da expedição, use o retorno à origem. */
export async function cancelTransfer(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  if (t.status === "cancelled") return t;
  assert(["draft", "separated"].includes(t.status), "Transferência já expedida: use \"Retornar à origem\" para o saldo em trânsito.");
  assert(ctx.branchId === t.fromBranchId, "Cancele no contexto da filial de origem.");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  await releaseReservations(ctx, "transfer", id, "released");
  const u = await ctx.store.update("transfers", id, { status: "cancelled", cancelledAt: nowIso(), cancelReason: reason.trim() });
  await audit(ctx, { module: "stock", action: "transfer.cancel", entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)} cancelada`, reason: reason.trim() });
  return u;
}

/** Referência do documento fiscal de transferência emitido (número/chave), quando não emitido pelo ERP. */
export async function setTransferDocument(ctx: Ctx, id: string, ref: string | null) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  const value = ref?.trim() || null;
  if (value) assert(value.length <= 200, "Referência muito longa.");
  const u = await ctx.store.update("transfers", id, { documentRef: value });
  await audit(ctx, { module: "stock", action: "transfer.document", entityType: "transfer", entityId: id, summary: value ? `NF-e de transferência vinculada: ${value}` : "Vínculo de NF-e removido" });
  return u;
}

/** Documentos fiscais emitidos pela frente fiscal com origem nesta transferência. */
export async function transferDocuments(ctx: Ctx, id: string): Promise<Doc[]> {
  return listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "transfer"], ["eq", "originId", id]] });
}
