"use server";

import { runAction, fstr, fopt, fint, fjson } from "@/lib/server/action";
import { listAll } from "@/lib/db";
import { normalizeSearch } from "@/lib/list";
import { adjustStock, balanceId, type ManualType } from "@/domain/stock";
import { createTransfer, updateTransferDraft, separateTransfer, shipTransfer, receiveTransfer, resolveTransferPending, cancelTransfer, setTransferDocument, type TransferReceiptLine } from "@/domain/transfers";
import { createInventory, saveCounts, concludeInventory, cancelInventory, addInventoryItem, type CountEntry } from "@/domain/inventory";

/** Pesquisa de SKUs para os seletores (nome, SKU, código de barras); traz o saldo do depósito informado. */
export async function searchSkusAction(q: string, warehouseId?: string | null) {
  return runAction({ module: "stock" }, async (s) => {
    const term = q.trim();
    if (term.length < 2) return [];
    const n = normalizeSearch(term);
    const res = await s.ctx.store.list("skus", { filters: [["eq", "companyId", s.ctx.companyId], ["or", [["contains", "searchText", n], ["eq", "barcode", term], ["eq", "sku", term.toUpperCase()], ["contains", "extraBarcodes", term]]]], limit: 20 });
    const products = new Map((await listAll(s.ctx.store, "products", { filters: [["eq", "id", [...new Set(res.items.map((x) => x.productId))]]] })).map((p) => [p.id, p]));
    const out = [];
    for (const x of res.items) {
      const p = products.get(x.productId);
      if (!p || p.type === "service" || x.active === false) continue;
      const bal = warehouseId ? await s.ctx.store.get("stock_balances", balanceId(warehouseId, x.id)) : null;
      out.push({ id: x.id, sku: x.sku, name: x.name as string, unitCode: (x.unitCode ?? p.unitCode) as string, barcode: x.barcode as string | null, physical: bal?.physical ?? 0, available: (bal?.physical ?? 0) - (bal?.reserved ?? 0), avgCost: bal?.avgCost ?? x.costTotal ?? 0, location: (bal?.location ?? null) as string | null, minQty: (bal?.minQty ?? 0) as number });
    }
    return out.slice(0, 15);
  });
}

/** Saldo de um SKU num depósito (para o resumo "saldo anterior → novo saldo"). */
export async function skuBalanceAction(skuId: string, warehouseId: string) {
  return runAction({ module: "stock" }, async (s) => {
    const sku = await s.ctx.store.get("skus", skuId);
    if (!sku || sku.companyId !== s.ctx.companyId) return null;
    const bal = await s.ctx.store.get("stock_balances", balanceId(warehouseId, skuId));
    return { physical: bal?.physical ?? 0, available: (bal?.physical ?? 0) - (bal?.reserved ?? 0), avgCost: bal?.avgCost ?? sku.costTotal ?? 0, location: (bal?.location ?? null) as string | null, minQty: (bal?.minQty ?? 0) as number };
  });
}

// ───────────────────────────── Ajustes

export async function adjustStockAction(fd: FormData) {
  return runAction({ module: "stock", op: "create", requireBranch: true, revalidate: ["/estoque/movimentos", "/estoque"] }, async (s) => {
    const occurred = fopt(fd, "occurredAt");
    const m = await adjustStock(s.ctx, {
      warehouseId: fstr(fd, "warehouseId"),
      skuId: fstr(fd, "skuId"),
      type: fstr(fd, "type") as ManualType,
      qty: fint(fd, "qty"),
      unitCost: fopt(fd, "unitCost") ? fint(fd, "unitCost") : null,
      reason: fstr(fd, "reason"),
      idemKey: fstr(fd, "_idem"),
      occurredAt: occurred ? new Date(occurred).toISOString() : undefined,
      lot: fopt(fd, "lot"),
      lotExpiry: fopt(fd, "lotExpiry"),
      documentRef: fopt(fd, "documentRef"),
      notes: fopt(fd, "notes"),
    });
    return { ok: true as const, message: `Ajuste lançado: saldo ${(m!.balanceBefore / 1000).toLocaleString("pt-BR")} → ${(m!.balanceAfter / 1000).toLocaleString("pt-BR")}.` };
  });
}

// ───────────────────────────── Transferências

const T = "/estoque/transferencias";

function parseTransfer(fd: FormData) {
  return {
    toBranchId: fstr(fd, "toBranchId"),
    fromWarehouseId: fopt(fd, "fromWarehouseId"),
    toWarehouseId: fopt(fd, "toWarehouseId"),
    responsibleId: fopt(fd, "responsibleId"),
    notes: fopt(fd, "notes"),
    items: fjson<Array<{ skuId: string; qty: number }>>(fd, "items", []),
  };
}

export async function saveTransferAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "stock", op: id ? "edit" : "create", requireBranch: true, revalidate: [T] }, async (s) => {
    const t = id ? await updateTransferDraft(s.ctx, id, parseTransfer(fd)) : await createTransfer(s.ctx, parseTransfer(fd), { idemKey: fopt(fd, "_idem") });
    return { ok: true as const, message: id ? "Rascunho atualizado." : `Transferência nº ${t.number} criada como rascunho.`, redirect: `${T}/${t.id}` };
  });
}

export async function separateTransferAction(id: string) {
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${T}/${id}`, T] }, async (s) => {
    await separateTransfer(s.ctx, id);
    return { ok: true as const, message: "Itens separados e reservados na origem." };
  });
}

export async function shipTransferAction(id: string) {
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${T}/${id}`, T, "/estoque"] }, async (s) => {
    await shipTransfer(s.ctx, id);
    return { ok: true as const, message: "Transferência expedida — saldo em trânsito no destino." };
  });
}

export async function receiveTransferAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${T}/${id}`, T, "/estoque"] }, async (s) => {
    const t = await receiveTransfer(s.ctx, id, { idemKey: fstr(fd, "_idem"), lines: fjson<TransferReceiptLine[]>(fd, "lines", []), notes: fopt(fd, "notes") });
    return { ok: true as const, message: t.status === "received" ? "Recebimento total registrado." : "Recebimento parcial registrado; o restante continua em trânsito." };
  });
}

export async function resolveTransferAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${T}/${id}`, T, "/estoque"] }, async (s) => {
    const mode = fstr(fd, "mode") as "return" | "loss";
    await resolveTransferPending(s.ctx, id, { mode, reason: fstr(fd, "reason") });
    return { ok: true as const, message: mode === "return" ? "Pendente devolvido à origem." : "Falta baixada como perda na origem." };
  });
}

export async function cancelTransferAction(id: string, fd: FormData) {
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${T}/${id}`, T] }, async (s) => {
    await cancelTransfer(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Transferência cancelada; reservas liberadas." };
  });
}

export async function setTransferDocumentAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "stock", op: "edit", revalidate: [`${T}/${id}`] }, async (s) => {
    await setTransferDocument(s.ctx, id, fopt(fd, "documentRef"));
    return { ok: true as const, message: "Referência do documento salva." };
  });
}

// ───────────────────────────── Inventários

const I = "/estoque/inventarios";

export async function createInventoryAction(fd: FormData) {
  return runAction({ module: "stock", op: "create", requireBranch: true, revalidate: [I] }, async (s) => {
    const inv = await createInventory(
      s.ctx,
      { warehouseId: fstr(fd, "warehouseId"), scope: (fstr(fd, "scope") as "all" | "category" | "location") || "all", categoryId: fopt(fd, "categoryId"), location: fopt(fd, "location"), notes: fopt(fd, "notes") },
      { idemKey: fopt(fd, "_idem") },
    );
    return { ok: true as const, message: `Inventário nº ${inv.number} aberto — base registrada.`, redirect: `${I}/${inv.id}` };
  });
}

export async function saveCountsAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${I}/${id}`] }, async (s) => {
    const r = await saveCounts(s.ctx, id, fjson<CountEntry[]>(fd, "entries", []));
    return { ok: true as const, message: r.saved ? `${r.saved} contagem(ns) salva(s).` : "Nenhuma alteração para salvar." };
  });
}

export async function addInventoryItemAction(id: string, skuId: string) {
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${I}/${id}`] }, async (s) => {
    await addInventoryItem(s.ctx, id, skuId);
    return { ok: true as const, message: "Item incluído no inventário." };
  });
}

export async function concludeInventoryAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${I}/${id}`, I, "/estoque", "/estoque/movimentos"] }, async (s) => {
    const inv = await concludeInventory(s.ctx, id, { uncounted: (fstr(fd, "uncounted") as "keep" | "zero") || "keep" });
    return { ok: true as const, message: `Inventário concluído: ${inv.summary?.itemsAdjusted ?? 0} ajuste(s) lançado(s).` };
  });
}

export async function cancelInventoryAction(id: string, fd: FormData) {
  return runAction({ module: "stock", op: "edit", requireBranch: true, revalidate: [`${I}/${id}`, I] }, async (s) => {
    await cancelInventory(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Inventário cancelado (nenhum ajuste lançado)." };
  });
}
