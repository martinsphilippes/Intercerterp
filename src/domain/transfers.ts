import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber, peekNumber } from "@/lib/core/numbering";
import { resolveOccurrence } from "@/lib/core/notify";
import { nowIso } from "@/lib/dates";
import { QTY, roundDiv } from "@/lib/money";
import { adjustInTransit, applyOnce, balanceId, damageWarehouse, defaultWarehouse, postMovements, releaseReservations, reserve, type MovementInput } from "./stock";

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
 *
 * Expedição incompleta (`shipping`): se a expedição falhar depois de algum item ter saído, a transferência
 * não volta a "separado" — "Expedir" conclui o restante e "Cancelar" devolve à origem o que já saiu.
 * Consumo do trânsito por item (recebido + avariado + devolvido + perdido) é serializado por um contador
 * (`counters`, chave `transfer-consumed:<id>:<sku>`) incrementado na mesma transação dos movimentos com
 * limite no expedido: recebimentos/resoluções simultâneos nunca passam do que saiu da origem.
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
  shipping: "Expedição incompleta",
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

/** Quantidade do item já baixada do trânsito (recebido + avariado + devolvido + perdido). */
const consumedQty = (i: TransferItem) => (i.receivedQty ?? 0) + (i.damagedQty ?? 0) + (i.returnedQty ?? 0) + (i.lostQty ?? 0);
const consumedKey = (transferId: string, skuId: string) => `transfer-consumed:${transferId}:${skuId}`;
const consumedCounterId = (transferId: string, skuId: string) => detId("counter", consumedKey(transferId, skuId));

/**
 * Garante o contador de consumo do item (criado na expedição; para transferências expedidas antes dele,
 * nasce com o consumo já registrado pelos movimentos).
 */
async function ensureConsumedCounter(ctx: Ctx, transferId: string, item: TransferItem): Promise<string> {
  const cid = consumedCounterId(transferId, item.skuId);
  if (await ctx.store.get("counters", cid)) return cid;
  try {
    await ctx.store.create("counters", { key: consumedKey(transferId, item.skuId), value: consumedQty(item) }, cid);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
  return cid;
}

/** Baixa `qty` do trânsito do item dentro da transação do chamador, limitada ao expedido. */
async function consumeTransit(tx: Store, cid: string, qty: number, shippedQty: number) {
  await tx.increment("counters", cid, "value", qty, { max: shippedQty });
}

/** Chave da tentativa de separação (uma nova a cada falha: reservas liberadas não são reaproveitadas). */
const separationKey = (transferId: string) => `transfer-separation:${transferId}`;

/** Campos do rascunho comparáveis (para não regravar um reenvio idêntico). */
function draftSignature(d: { toBranchId?: string | null; fromWarehouseId?: string | null; toWarehouseId?: string | null; items?: Array<{ skuId: string; qty: number }>; responsibleId?: string | null; notes?: string | null; expectedAt?: string | null; documentRef?: string | null }) {
  return JSON.stringify([d.toBranchId ?? null, d.fromWarehouseId ?? null, d.toWarehouseId ?? null, (d.items ?? []).map((i) => [i.skuId, i.qty]), d.responsibleId ?? null, d.notes ?? null, d.expectedAt ?? null, d.documentRef ?? null]);
}

/** Regrava o rascunho com o conteúdo informado (validação completa); sem alteração devolve o mesmo. */
async function applyDraftInput(ctx: Ctx, t: Doc, input: TransferInput) {
  assert(t.status === "draft", "Somente rascunhos podem ser alterados.");
  assert(ctx.branchId === t.fromBranchId, "Altere a transferência no contexto da filial de origem.");
  assert(input.toBranchId && input.toBranchId !== t.fromBranchId, "Escolha uma filial de destino diferente da origem.");
  const dest = await ctx.store.getOrThrow("branches", input.toBranchId);
  assert(dest.companyId === ctx.companyId, "Filial de destino de outra empresa.");
  const { from, to } = await resolveWarehouses(ctx, t.fromBranchId, input.toBranchId, input.fromWarehouseId, input.toWarehouseId);
  const items = await buildItems(ctx, input.items);
  const patch = { toBranchId: input.toBranchId, fromWarehouseId: from.id, toWarehouseId: to.id, items, responsibleId: input.responsibleId || t.responsibleId, notes: input.notes?.trim() || null, expectedAt: input.expectedAt || null, documentRef: input.documentRef?.trim() || null };
  if (draftSignature(patch) === draftSignature(t as any)) return t;
  const u = await ctx.store.update("transfers", t.id, patch);
  await audit(ctx, { module: "stock", action: "transfer.update", entityType: "transfer", entityId: t.id, summary: `Rascunho da transferência ${transferCode(t.number)} alterado`, before: { items: (t.items as TransferItem[]).map((i) => [i.sku, i.qty]) }, after: { items: items.map((i) => [i.sku, i.qty]) } });
  return u;
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

/**
 * Cria rascunho na filial atual (origem). Idempotente por `idemKey`: o reenvio do mesmo formulário devolve
 * a mesma transferência — e, se ela ainda for rascunho (ex.: "Confirmar e enviar" falhou na separação),
 * aplica os dados corrigidos do reenvio em vez de manter os antigos.
 */
export async function createTransfer(ctx: Ctx, input: TransferInput, opts: { idemKey?: string | null; id?: string } = {}) {
  requirePerm(ctx, "stock", "create");
  const fromBranchId = requireBranch(ctx);
  const id = opts.id ?? (opts.idemKey ? detId("transfer", ctx.companyId, opts.idemKey) : undefined);
  if (id) {
    const existing = await ctx.store.get("transfers", id);
    if (existing) {
      if (opts.idemKey && !opts.id && existing.status === "draft" && existing.fromBranchId === fromBranchId) return applyDraftInput(ctx, existing, input);
      return existing;
    }
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
  return applyDraftInput(ctx, t, input);
}

/** Separação: reserva os itens na origem (reduz o disponível, não o físico). */
export async function separateTransfer(ctx: Ctx, id: string) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  if (t.status !== "draft") {
    if (["separated", "shipping", "in_transit", "partial", "received"].includes(t.status)) return t; // já separada: idempotente
    throw new BusinessError("Transferência cancelada não pode ser separada.");
  }
  assert(ctx.branchId === t.fromBranchId, "A separação é feita no contexto da filial de origem.");
  // cada tentativa usa chaves próprias: após uma falha (reservas liberadas), a nova separação reserva de novo
  const attempt = await peekNumber(ctx.store, separationKey(id));
  try {
    for (const i of t.items as TransferItem[]) {
      const idemKey = attempt ? `transfer:${id}:reserve:${attempt}:${i.skuId}` : `transfer:${id}:reserve:${i.skuId}`;
      await reserve(ctx, { warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: i.qty, originType: "transfer", originId: id, idemKey });
    }
  } catch (e) {
    await releaseReservations(ctx, "transfer", id, "released");
    await nextNumber(ctx.store, separationKey(id));
    throw e;
  }
  const u = await ctx.store.update("transfers", id, { status: "separated", separatedAt: nowIso() });
  await audit(ctx, { module: "stock", action: "transfer.separate", entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)} separada (itens reservados na origem)` });
  return u;
}

/**
 * Expedição: por item, de forma atômica e única — consome a reserva, lança `transfer_out` na origem
 * (custo médio vigente) e soma o trânsito no destino. Antes de expedir, confere o físico de todos os itens
 * ainda não expedidos; se mesmo assim falhar no meio, a transferência fica em "expedição incompleta"
 * (nunca "separada" com mercadoria já em trânsito): "Expedir" conclui, "Cancelar" devolve à origem.
 */
export async function shipTransfer(ctx: Ctx, id: string) {
  requirePerm(ctx, "stock", "edit");
  let t = await loadTransfer(ctx, id);
  if (t.status === "cancelled" || t.cancelledAt) {
    // na origem, conclui um cancelamento que tenha ficado incompleto (ex.: expedição concorrente) antes de recusar
    if (ctx.branchId === t.fromBranchId) await abortShipIfCancelled(ctx, id, "Transferência cancelada não pode ser expedida.");
    throw new BusinessError("Transferência cancelada não pode ser expedida.", "transfer_cancelled");
  }
  if (["in_transit", "partial", "received"].includes(t.status)) return t;
  if (t.status === "draft") t = await separateTransfer(ctx, id);
  assert(["separated", "shipping"].includes(t.status), "Somente transferências separadas podem ser expedidas.");
  assert(ctx.branchId === t.fromBranchId, "A expedição é feita no contexto da filial de origem.");
  const items = t.items as TransferItem[];
  // pré-validação: o físico da origem cobre cada item que ainda vai sair (evita expedição parcial)
  const before = await transferItemsFromMovements(ctx, t);
  for (const i of items) {
    if ((before.find((x) => x.skuId === i.skuId)?.shippedQty ?? 0) > 0) continue;
    const bal = await ctx.store.get("stock_balances", balanceId(t.fromWarehouseId, i.skuId));
    const physical = (bal?.physical as number) ?? 0;
    if (physical < i.qty) throw new BusinessError(`Saldo insuficiente para expedir ${i.sku}: físico ${physical / QTY}, a expedir ${i.qty / QTY}. Regularize o estoque da origem ou cancele a transferência.`, "insufficient_stock", { skuId: i.skuId });
  }
  if (t.status === "separated") t = await ctx.store.update("transfers", id, { status: "shipping" });
  try {
    for (const i of items) {
      await applyOnce(ctx, `transfer:${id}:ship:${i.skuId}`, { entityType: "transfer", entityId: id }, async (tx) => {
        const now = await ctx.store.get("transfers", id);
        if (now?.status === "cancelled" || now?.cancelledAt) throw new BusinessError("A transferência foi cancelada durante a expedição.", "transfer_cancelled");
        const cid = consumedCounterId(id, i.skuId);
        if (!(await ctx.store.get("counters", cid))) await tx.create("counters", { key: consumedKey(id, i.skuId), value: 0 }, cid);
        await releaseReservations(ctx, "transfer", id, "consumed", i.skuId, tx);
        await postMovements(ctx, [{ warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: -i.qty, type: "transfer_out", originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — expedição`, idemKey: `transfer:${id}:out:${i.skuId}` }], tx);
        await adjustInTransit(ctx, t.toWarehouseId, i.skuId, i.qty, tx);
      });
    }
  } catch (e) {
    // cancelamento concorrente: devolve à origem o que esta expedição lançou e recusa com a mensagem do cancelamento
    await abortShipIfCancelled(ctx, id);
    const cur = await transferItemsFromMovements(ctx, t);
    const shipped = cur.filter((i) => i.shippedQty > 0).length;
    const fresh = await ctx.store.get("transfers", id);
    if (fresh?.status === "shipping" && !fresh.cancelledAt) {
      // nada saiu: volta a "separado"; algo saiu: permanece em expedição incompleta com o expedido registrado
      await ctx.store.update("transfers", id, shipped ? { items: cur } : { status: "separated" });
      await abortShipIfCancelled(ctx, id); // o cancelamento pode ter sido gravado entre a leitura e a gravação acima
    }
    if (shipped && e instanceof BusinessError) {
      throw new BusinessError(`Expedição incompleta: ${shipped} de ${items.length} item(ns) já saíram da origem. ${e.message} Regularize e clique em "Expedir" para concluir, ou cancele a transferência para devolver à origem o que já saiu.`, e.code, e.details);
    }
    throw e;
  }
  // nunca grava "em trânsito" sobre um cancelamento: confere antes e depois da gravação (sem atualização condicional
  // no banco, a conferência posterior desfaz a sobreposição e devolve à origem o que saiu)
  await abortShipIfCancelled(ctx, id);
  const next = await transferItemsFromMovements(ctx, t);
  const totalCost = next.reduce((a, i) => a + roundDiv(i.shippedQty * i.unitCost, QTY), 0);
  const u = await ctx.store.update("transfers", id, { status: "in_transit", items: next, shippedAt: t.shippedAt ?? nowIso(), shippedBy: ctx.user.id, totalCost });
  await abortShipIfCancelled(ctx, id);
  await audit(ctx, { module: "stock", action: "transfer.ship", entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)} expedida — em trânsito para o destino`, related: next.map((i) => `sku:${i.skuId}`) });
  return u;
}

/**
 * Expedição × cancelamento: se o cancelamento já foi gravado (status ou `cancelledAt`, que a expedição nunca
 * apaga), conclui o cancelamento — devolve à origem o que estiver em trânsito, libera reservas, regrava itens
 * e divergências e restaura o status "cancelado" — e recusa a expedição. Sem cancelamento, não faz nada.
 */
async function abortShipIfCancelled(ctx: Ctx, id: string, message?: string): Promise<void> {
  const fresh = await ctx.store.get("transfers", id);
  if (!fresh || (fresh.status !== "cancelled" && !fresh.cancelledAt)) return;
  let doc = fresh;
  if (fresh.status !== "cancelled" || (await cancellationIncomplete(ctx, fresh))) {
    const done = await completeCancellation(ctx, fresh, fresh.cancelReason ?? "cancelada durante a expedição", nowIso());
    doc = done.doc;
    if (done.settled.length) {
      await audit(ctx, { module: "stock", action: "transfer.cancel_complete", entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(fresh.number)}: cancelada durante a expedição — ${done.settled.length} item(ns) já expedido(s) devolvido(s) à origem`, reason: fresh.cancelReason ?? null, related: done.settled.map((i) => `sku:${i.skuId}`) });
    }
  }
  if (message) throw new BusinessError(message, "transfer_cancelled");
  const back = ((doc.items ?? []) as TransferItem[]).filter((i) => (i.returnedQty ?? 0) > 0).length;
  throw new BusinessError(
    back
      ? `A transferência foi cancelada durante a expedição: ${back} item(ns) que já tinham saído voltaram à origem e nada ficou em trânsito.`
      : "A transferência foi cancelada durante a expedição; nenhum item saiu da origem.",
    "transfer_cancelled",
  );
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
    const lost = Math.max(0, -sum("loss"));
    return {
      ...i,
      shippedQty: Math.max(0, -sum("transfer_out")),
      unitCost: out?.unitCost ?? i.unitCost ?? 0,
      receivedQty: sum("transfer_in"),
      damagedQty: sum("damage_in"),
      returnedQty: Math.max(0, sum("transfer_return") - lost),
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
 * avariado → `damage_in` no depósito de avarias; ambos baixam o trânsito. O consumo do item é limitado ao
 * expedido na mesma transação (recebimentos simultâneos com chaves diferentes não passam do expedido).
 */
export async function receiveTransfer(ctx: Ctx, id: string, input: { lines: TransferReceiptLine[]; idemKey: string; notes?: string | null }) {
  requirePerm(ctx, "stock", "edit");
  assert(input.idemKey, "Chave do recebimento ausente.");
  const t = await loadTransfer(ctx, id);
  const receipts = (t.receipts ?? []) as Array<Record<string, any>>;
  if (receipts.some((r) => r.key === input.idemKey)) return t;
  assert(["in_transit", "partial"].includes(t.status), t.status === "shipping" ? "Expedição incompleta: conclua a expedição na origem antes de receber." : "Só é possível receber transferências em trânsito.");
  assert(ctx.branchId === t.toBranchId, "O recebimento é feito no contexto da filial de destino.");
  const current = await transferItemsFromMovements(ctx, t);
  const lines = input.lines.filter((l) => (l.receivedQty ?? 0) > 0 || (l.damagedQty ?? 0) > 0);
  assert(lines.length > 0, "Informe as quantidades recebidas.");
  const rk = detId("rcv", id, input.idemKey).slice(0, 16);
  const onceKey = (skuId: string) => `transfer:${id}:rcv:${rk}:${skuId}`;
  // linhas desta chave já aplicadas (repetição após falha antes do registro final) não são revalidadas
  const applied = new Set<string>();
  for (const l of lines) if (await ctx.store.get("operations", detId("once", onceKey(l.skuId)))) applied.add(l.skuId);
  for (const l of lines) {
    const item = current.find((i) => i.skuId === l.skuId);
    assert(item, "Item não pertence à transferência.");
    assert(Number.isInteger(l.receivedQty) && l.receivedQty >= 0 && Number.isInteger(l.damagedQty) && l.damagedQty >= 0, "Quantidades inválidas.");
    if (applied.has(l.skuId)) continue;
    assert(l.receivedQty + l.damagedQty <= pendingQty(item!), `${item!.sku}: recebido + avariado excede o pendente em trânsito (${pendingQty(item!) / QTY}).`);
  }
  const damaged = lines.some((l) => l.damagedQty > 0) ? await damageWarehouse(ctx, t.toBranchId) : null;
  for (const l of lines) {
    if (applied.has(l.skuId)) continue;
    const item = current.find((i) => i.skuId === l.skuId)!;
    const cid = await ensureConsumedCounter(ctx, id, item);
    await withTransitGuard(() =>
      applyOnce(ctx, onceKey(l.skuId), { entityType: "transfer", entityId: id }, async (tx) => {
        await consumeTransit(tx, cid, l.receivedQty + l.damagedQty, item.shippedQty);
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
  // relê a transferência: recebimentos/resoluções concorrentes já registrados não são sobrescritos
  const fresh = await loadTransfer(ctx, id);
  const freshReceipts = (fresh.receipts ?? []) as Array<Record<string, any>>;
  if (freshReceipts.some((r) => r.key === input.idemKey)) return fresh;
  const divergences = [...((fresh.divergences ?? []) as any[])].map((d) => (d.kind === "missing" && d.open && lines.some((l) => l.skuId === d.skuId) ? { ...d, open: false, resolvedAs: "superseded", resolvedAt: at } : d));
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
    receipts: [...freshReceipts, { key: input.idemKey, at, by: ctx.user.id, lines, notes: input.notes ?? null }],
    receivedAt: status === "received" ? at : fresh.receivedAt ?? null,
    receivedBy: ctx.user.id,
  });
  if (status === "received") await resolveOccurrence(ctx.store, `transfer_overdue:${id}`);
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
 * Baixa o pendente em trânsito de um item: `return` devolve à origem (`transfer_return` com o custo de
 * origem); `loss` baixa como perda (retorno + `loss` na origem). Uma única vez por estado do item
 * (chave pelo consumo acumulado) e limitada ao expedido (contador do item). Devolve a quantidade baixada.
 */
async function settlePending(ctx: Ctx, t: Doc, i: TransferItem, mode: "return" | "loss", reasonText: string): Promise<number> {
  const q = pendingQty(i);
  if (q <= 0) return 0;
  const id = t.id;
  // chave pelo estado acumulado: duas resoluções (ou resolução + cancelamento) simultâneas aplicam uma só vez
  const base = `transfer:${id}:resolve:${i.skuId}:${consumedQty(i)}`;
  const cid = await ensureConsumedCounter(ctx, id, i);
  await withTransitGuard(() =>
    applyOnce(ctx, base, { entityType: "transfer", entityId: id }, async (tx) => {
      await consumeTransit(tx, cid, q, i.shippedQty);
      const movs: MovementInput[] = [
        { warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: q, type: "transfer_return", unitCost: i.unitCost, originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — ${mode === "return" ? "retorno à origem" : "falta (retorno contábil)"}: ${reasonText}`, idemKey: `${base}:ret` },
      ];
      if (mode === "loss") movs.push({ warehouseId: t.fromWarehouseId, skuId: i.skuId, qty: -q, type: "loss", originType: "transfer", originId: id, operationId: id, reason: `Transferência ${transferCode(t.number)} — falta baixada como perda: ${reasonText}`, idemKey: `${base}:loss`, allowNegative: true });
      await postMovements(ctx, movs, tx);
      await adjustInTransit(ctx, t.toWarehouseId, i.skuId, -q, tx, { min: 0 });
    }),
  );
  return q;
}

/**
 * Resolve o que ficou pendente em trânsito: `return` devolve à origem (`transfer_return` com o custo
 * de origem); `loss` baixa como perda (retorno + `loss` na origem, ambos com motivo). Também recupera
 * transferência cancelada que ainda tenha saldo em trânsito (registros anteriores à correção do cancelamento).
 */
export async function resolveTransferPending(ctx: Ctx, id: string, input: { mode: "return" | "loss"; reason: string; skuIds?: string[] }) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  if (t.status === "received") return t; // já resolvida: idempotente
  const current = await transferItemsFromMovements(ctx, t);
  if (t.status === "cancelled" && !current.some((i) => pendingQty(i) > 0)) return t;
  assert(t.status !== "shipping", "Expedição incompleta: conclua a expedição ou cancele a transferência (o que já saiu volta à origem).");
  assert(["in_transit", "partial", "cancelled"].includes(t.status), "Não há saldo em trânsito a resolver.");
  assert(ctx.branchId === t.fromBranchId || ctx.branchId === t.toBranchId, "Resolva no contexto da filial de origem ou de destino.");
  assert(input.reason?.trim(), "Informe o motivo.");
  const targets = current.filter((i) => pendingQty(i) > 0 && (!input.skuIds?.length || input.skuIds.includes(i.skuId)));
  if (!targets.length) return t;
  const at = nowIso();
  for (const i of targets) await settlePending(ctx, t, i, input.mode, input.reason.trim());
  const items = await transferItemsFromMovements(ctx, t);
  const fresh = await loadTransfer(ctx, id);
  const divergences = [...((fresh.divergences ?? []) as any[])].map((d) => (d.kind === "missing" && d.open && targets.some((x) => x.skuId === d.skuId) ? { ...d, open: false, resolvedAs: input.mode, resolvedAt: at } : d));
  for (const i of targets) divergences.push({ kind: input.mode === "return" ? "returned" : "lost", skuId: i.skuId, qty: pendingQty(i), note: input.reason.trim(), at, by: ctx.user.id });
  const status = fresh.status === "cancelled" ? "cancelled" : statusAfter(items);
  const u = await ctx.store.update("transfers", id, { items, divergences, status, returnedAt: input.mode === "return" ? at : fresh.returnedAt ?? null, receivedAt: status === "received" ? (fresh.receivedAt ?? at) : fresh.receivedAt ?? null, cancelledAt: status === "cancelled" ? (fresh.cancelledAt ?? at) : null });
  if (status === "received" || status === "cancelled") await resolveOccurrence(ctx.store, `transfer_overdue:${id}`);
  await audit(ctx, { module: "stock", action: `transfer.${input.mode}`, entityType: "transfer", entityId: id, summary: `Transferência ${transferCode(t.number)}: pendente ${input.mode === "return" ? "devolvido à origem" : "baixado como perda"} (${targets.length} item(ns))`, reason: input.reason.trim(), related: targets.map((i) => `sku:${i.skuId}`) });
  return u;
}

/**
 * Conclui o cancelamento a partir dos movimentos (fonte de verdade): devolve à origem tudo o que estiver
 * pendente em trânsito, libera as reservas e regrava status, itens recalculados, `returnedAt` e as
 * divergências "returned" que faltarem (uma por quantidade devolvida ainda não registrada). Idempotente e
 * segura em paralelo: cada devolução (`settlePending`) e cada reserva é encerrada uma única vez.
 */
async function completeCancellation(ctx: Ctx, t: Doc, reason: string, at: string): Promise<{ doc: Doc; settled: TransferItem[] }> {
  const settled: TransferItem[] = [];
  for (const i of await transferItemsFromMovements(ctx, t)) {
    if (pendingQty(i) <= 0) continue;
    await settlePending(ctx, t, i, "return", `cancelamento — ${reason}`);
    settled.push(i);
  }
  await releaseReservations(ctx, "transfer", t.id, "released");
  const fresh = await loadTransfer(ctx, t.id);
  const items = await transferItemsFromMovements(ctx, fresh);
  const divergences = [...((fresh.divergences ?? []) as any[])];
  for (const i of items) {
    const noted = divergences.filter((d) => d.kind === "returned" && d.skuId === i.skuId).reduce((a, d) => a + (Number(d.qty) || 0), 0);
    if ((i.returnedQty ?? 0) > noted) divergences.push({ kind: "returned", skuId: i.skuId, qty: i.returnedQty - noted, note: `Cancelamento: ${reason}`, at, by: ctx.user.id });
  }
  const returned = items.some((i) => (i.returnedQty ?? 0) > 0);
  const doc = await ctx.store.update("transfers", t.id, {
    status: "cancelled",
    cancelledAt: fresh.cancelledAt ?? at,
    cancelReason: fresh.cancelReason ?? reason,
    items,
    divergences,
    returnedAt: returned ? (fresh.returnedAt ?? at) : (fresh.returnedAt ?? null),
  });
  return { doc, settled };
}

/** Cancelamento gravado mas incompleto: pendente em trânsito, itens/divergências desatualizados ou reserva ativa. */
async function cancellationIncomplete(ctx: Ctx, t: Doc): Promise<boolean> {
  const items = await transferItemsFromMovements(ctx, t);
  if (items.some((i) => pendingQty(i) > 0)) return true;
  const stored = new Map(((t.items ?? []) as TransferItem[]).map((i) => [i.skuId, i]));
  const divs = (t.divergences ?? []) as any[];
  for (const i of items) {
    const s = stored.get(i.skuId);
    if ((s?.shippedQty ?? 0) !== i.shippedQty || (s?.returnedQty ?? 0) !== i.returnedQty || (s?.lostQty ?? 0) !== i.lostQty) return true;
    const noted = divs.filter((d) => d.kind === "returned" && d.skuId === i.skuId).reduce((a, d) => a + (Number(d.qty) || 0), 0);
    if (i.returnedQty > noted || (i.returnedQty > 0 && !t.returnedAt)) return true;
  }
  const active = await ctx.store.list("stock_reservations", { filters: [["eq", "originType", "transfer"], ["eq", "originId", t.id], ["eq", "status", "active"]], limit: 1 });
  return active.items.length > 0;
}

/**
 * Cancela rascunho, separada ou com expedição incompleta: libera as reservas e devolve à origem o que já
 * tiver saído (movimentos `transfer_return` idempotentes, baixando o trânsito do destino). Depois da
 * expedição completa, use o retorno à origem.
 * Repetir o cancelamento de uma transferência já cancelada não altera nada — exceto quando o cancelamento
 * ficou incompleto (interrupção ou expedição simultânea): aí conclui a devolução e regrava itens e divergências.
 */
export async function cancelTransfer(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "stock", "edit");
  const t = await loadTransfer(ctx, id);
  if (t.status === "cancelled") {
    if (!(await cancellationIncomplete(ctx, t))) return t;
    assert(ctx.branchId === t.fromBranchId, "Conclua o cancelamento no contexto da filial de origem.");
    const { doc, settled } = await completeCancellation(ctx, t, t.cancelReason ?? (reason?.trim() || "cancelamento"), nowIso());
    await resolveOccurrence(ctx.store, `transfer_overdue:${id}`);
    await audit(ctx, {
      module: "stock",
      action: "transfer.cancel_complete",
      entityType: "transfer",
      entityId: id,
      summary: `Transferência ${transferCode(t.number)}: cancelamento concluído${settled.length ? ` — ${settled.length} item(ns) em trânsito devolvido(s) à origem` : " — itens e divergências atualizados"}`,
      reason: t.cancelReason ?? null,
      related: settled.map((i) => `sku:${i.skuId}`),
    });
    return doc;
  }
  assert(["draft", "separated", "shipping"].includes(t.status), "Transferência já expedida: use \"Retornar à origem\" para o saldo em trânsito.");
  assert(ctx.branchId === t.fromBranchId, "Cancele no contexto da filial de origem.");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  const at = nowIso();
  // o que já saiu da origem (expedição incompleta) volta para ela antes de cancelar — nada fica preso em trânsito
  let { doc: u, settled: back } = await completeCancellation(ctx, t, reason.trim(), at);
  // expedição simultânea pode ter lançado saída depois da leitura dos movimentos: confere de novo após gravar
  // o cancelamento (uma expedição que ainda não viu o cancelamento devolve, ela mesma, o que lançar depois)
  if (await cancellationIncomplete(ctx, u)) {
    const again = await completeCancellation(ctx, u, reason.trim(), at);
    u = again.doc;
    back = [...back, ...again.settled.filter((i) => !back.some((b) => b.skuId === i.skuId))];
  }
  await resolveOccurrence(ctx.store, `transfer_overdue:${id}`);
  await audit(ctx, {
    module: "stock",
    action: "transfer.cancel",
    entityType: "transfer",
    entityId: id,
    summary: `Transferência ${transferCode(t.number)} cancelada${back.length ? ` — ${back.length} item(ns) já expedido(s) devolvido(s) à origem` : ""}`,
    reason: reason.trim(),
    related: back.map((i) => `sku:${i.skuId}`),
  });
  return u;
}

/**
 * Referência do documento fiscal de transferência emitido (número/chave), quando não emitido pelo ERP.
 * Somente na filial de origem (quem emite o documento), fora do consolidado e em transferência não cancelada.
 */
export async function setTransferDocument(ctx: Ctx, id: string, ref: string | null) {
  requirePerm(ctx, "stock", "edit");
  const branchId = requireBranch(ctx);
  const t = await loadTransfer(ctx, id);
  assert(branchId === t.fromBranchId, "A referência do documento é informada no contexto da filial de origem.");
  assert(t.status !== "cancelled", "Transferência cancelada não aceita documento de referência.");
  const value = ref?.trim() || null;
  if (value) assert(value.length <= 200, "Referência muito longa.");
  if (value === (t.documentRef ?? null)) return t;
  const u = await ctx.store.update("transfers", id, { documentRef: value });
  await audit(ctx, { module: "stock", action: "transfer.document", entityType: "transfer", entityId: id, summary: value ? `Transferência ${transferCode(t.number)}: documento de referência ${value}` : `Transferência ${transferCode(t.number)}: documento de referência removido`, before: { documentRef: t.documentRef ?? null }, after: { documentRef: value } });
  return u;
}

/** Documentos fiscais emitidos pela frente fiscal com origem nesta transferência. */
export async function transferDocuments(ctx: Ctx, id: string): Promise<Doc[]> {
  return listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "transfer"], ["eq", "originId", id]] });
}
