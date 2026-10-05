import "server-only";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { addDays, dayRange, today } from "@/lib/dates";
import { QTY, roundDiv } from "@/lib/money";
import { MOVEMENT_LABEL, ORIGIN_LABEL, originHref, type MovementType } from "@/domain/stock";
import { categoryDescendants } from "@/domain/products";
import { pendingQty, transferCode, type TransferItem } from "@/domain/transfers";

type P = Pick<ListParams, "q" | "f">;

/** Filial do recorte: no consolidado (ou `filial=all`) todas; senão a escolhida ou a atual. */
export function branchScope(ctx: Ctx, f: Record<string, string>): string | null {
  if (f.filial === "all") return null;
  if (f.filial) return f.filial;
  return ctx.branchId;
}

async function maps(ctx: Ctx) {
  const cid = ctx.companyId;
  const [branches, warehouses, products, skus, categories] = await Promise.all([
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "products", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "skus", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "categories", { filters: [["eq", "companyId", cid]] }),
  ]);
  return {
    branches,
    warehouses,
    categories,
    branch: new Map(branches.map((b) => [b.id, b])),
    warehouse: new Map(warehouses.map((w) => [w.id, w])),
    product: new Map(products.map((p) => [p.id, p])),
    sku: new Map(skus.map((s) => [s.id, s])),
    skus,
  };
}

function skuMatches(q: string, sku: Doc | undefined, product: Doc | undefined) {
  if (!q) return true;
  const n = normalizeSearch(q);
  const up = q.trim().toUpperCase();
  return Boolean(
    (sku && (sku.sku === up || sku.barcode === q.trim() || (sku.extraBarcodes ?? []).includes(q.trim()) || normalizeSearch(sku.searchText ?? sku.name ?? "").includes(n))) ||
      (product && (normalizeSearch(product.name).includes(n) || String(product.code ?? "").toUpperCase() === up)),
  );
}

// ───────────────────────────── Saldos

export type BalanceRow = Awaited<ReturnType<typeof queryBalances>>[number];

export async function queryBalances(ctx: Ctx, p: P) {
  const m = await maps(ctx);
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  const bid = branchScope(ctx, p.f);
  if (bid) filters.push(["eq", "branchId", bid]);
  if (p.f.deposito) filters.push(["eq", "warehouseId", p.f.deposito]);
  if (p.f.sku) filters.push(["eq", "skuId", p.f.sku]);
  if (p.f.produto) filters.push(["eq", "productId", p.f.produto]);
  const cats = p.f.categoria ? new Set(categoryDescendants(m.categories, p.f.categoria)) : null;
  const bals = await listAll(ctx.store, "stock_balances", { filters });
  return bals
    .map((b) => {
      const sku = m.sku.get(b.skuId);
      const product = m.product.get(b.productId ?? sku?.productId);
      const wh = m.warehouse.get(b.warehouseId);
      const available = (b.physical ?? 0) - (b.reserved ?? 0);
      return {
        ...b,
        skuCode: sku?.sku ?? "—",
        skuName: sku?.name ?? "—",
        unitCode: sku?.unitCode ?? product?.unitCode ?? "",
        productName: product?.name ?? "—",
        categoryId: product?.categoryId ?? null,
        productActive: product?.active !== false,
        warehouseName: wh?.name ?? "—",
        warehouseKind: wh?.kind ?? "available",
        branchName: m.branch.get(b.branchId)?.name ?? "—",
        available,
        value: roundDiv((b.physical ?? 0) * (b.avgCost ?? 0), QTY),
        belowMin: Boolean(b.minQty && available < b.minQty),
        belowSafety: Boolean(b.safetyQty && available < b.safetyQty),
      };
    })
    .filter((r) => (cats ? r.categoryId && cats.has(r.categoryId) : true))
    .filter((r) => skuMatches(p.q, m.sku.get(r.skuId), m.product.get(r.productId)))
    .filter((r) => {
      switch (p.f.situacao) {
        case "below_min":
          return r.belowMin;
        case "zero":
          return r.physical === 0;
        case "negative":
          return r.physical < 0;
        case "transit":
          return (r.inTransit ?? 0) !== 0;
        case "reserved":
          return (r.reserved ?? 0) > 0;
        case "positive":
          return r.physical > 0;
        default:
          return true;
      }
    })
    .filter((r) => (p.f.tipoDeposito ? r.warehouseKind === p.f.tipoDeposito : true));
}

// ───────────────────────────── Movimentos

export type MovementRow = Awaited<ReturnType<typeof queryMovements>>["rows"][number];

const ORIGIN_COLLECTION: Record<string, { collection: string; label: (d: Doc) => string }> = {
  sale: { collection: "sales", label: (d) => `Venda nº ${d.number}` },
  sale_cancel: { collection: "sales", label: (d) => `Cancelamento venda nº ${d.number}` },
  return: { collection: "returns", label: (d) => `Devolução nº ${d.number}` },
  transfer: { collection: "transfers", label: (d) => `Transferência ${transferCode(d.number)}` },
  inventory: { collection: "inventories", label: (d) => `Inventário ${d.code ?? `nº ${d.number}`}` },
  receipt: { collection: "receipts", label: (d) => `Recebimento nº ${d.number}` },
  purchase_receipt: { collection: "receipts", label: (d) => `Recebimento nº ${d.number}` },
  purchase: { collection: "receipts", label: (d) => `Recebimento nº ${d.number}` },
  purchase_order: { collection: "purchase_orders", label: (d) => `Pedido de compra nº ${d.number}` },
  product: { collection: "products", label: (d) => `Cadastro ${d.code}` },
  import: { collection: "product_imports", label: (d) => `Importação nº ${d.number}` },
};

/** Rótulos legíveis das referências (venda nº, transferência nº …) buscados em lote. */
async function originLabels(ctx: Ctx, movs: Doc[]) {
  const byType = new Map<string, Set<string>>();
  for (const mv of movs) if (mv.originType && mv.originId && ORIGIN_COLLECTION[mv.originType]) byType.set(mv.originType, (byType.get(mv.originType) ?? new Set()).add(mv.originId));
  const out = new Map<string, string>();
  for (const [type, ids] of byType) {
    const def = ORIGIN_COLLECTION[type];
    const list = [...ids];
    for (let i = 0; i < list.length; i += 100) {
      const docs = await listAll(ctx.store, def.collection, { filters: [["eq", "id", list.slice(i, i + 100)]] }).catch(() => [] as Doc[]);
      for (const d of docs) out.set(`${type}:${d.id}`, def.label(d));
    }
  }
  return out;
}

export function movementPeriod(f: Record<string, string>, hasOrigin: boolean) {
  if (hasOrigin && !f.de && !f.ate) return null;
  const to = f.ate || today();
  const from = f.de || addDays(to, -30);
  return { from, to };
}

export async function queryMovements(ctx: Ctx, p: P) {
  const m = await maps(ctx);
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  const bid = branchScope(ctx, p.f);
  if (bid) filters.push(["eq", "branchId", bid]);
  if (p.f.deposito) filters.push(["eq", "warehouseId", p.f.deposito]);
  if (p.f.sku) filters.push(["eq", "skuId", p.f.sku]);
  if (p.f.produto) filters.push(["eq", "productId", p.f.produto]);
  if (p.f.tipo) filters.push(["eq", "type", p.f.tipo.split(",")]);
  let originId: string | null = null;
  if (p.f.origem) {
    const [type, id] = p.f.origem.split(":");
    if (type) filters.push(["eq", "originType", type]);
    if (id) {
      filters.push(["eq", "originId", id]);
      originId = id;
    }
  }
  const period = movementPeriod(p.f, Boolean(originId));
  if (period) {
    const r = dayRange(period.from, period.to);
    filters.push(["gte", "occurredAt", r.start], ["lt", "occurredAt", r.end]);
  }
  const movs = await listAll(ctx.store, "stock_movements", { filters, orderBy: [{ field: "occurredAt", dir: "desc" }] });
  const filtered = movs.filter((mv) => skuMatches(p.q, m.sku.get(mv.skuId), m.product.get(mv.productId)));
  const labels = await originLabels(ctx, filtered);
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name]));
  const rows = filtered.map((mv) => {
    const sku = m.sku.get(mv.skuId);
    const product = m.product.get(mv.productId ?? sku?.productId);
    const wh = m.warehouse.get(mv.warehouseId);
    return {
      ...mv,
      skuCode: sku?.sku ?? "—",
      productName: product?.name ?? "—",
      productId: product?.id ?? mv.productId,
      unitCode: sku?.unitCode ?? product?.unitCode ?? "",
      warehouseName: wh?.name ?? "—",
      branchName: m.branch.get(mv.branchId)?.name ?? "—",
      typeLabel: MOVEMENT_LABEL[mv.type as MovementType] ?? mv.type,
      originLabel: mv.originType ? (labels.get(`${mv.originType}:${mv.originId}`) ?? ORIGIN_LABEL[mv.originType] ?? mv.originType) : "—",
      originHref: originHref(mv.originType, mv.originId),
      userName: users.get(mv.createdBy) ?? (mv.createdBy === "system" ? "Sistema" : "—"),
      inQty: mv.qty > 0 ? mv.qty : 0,
      outQty: mv.qty < 0 ? -mv.qty : 0,
      inValue: mv.qty > 0 ? mv.totalCost : 0,
      outValue: mv.qty < 0 ? mv.totalCost : 0,
    };
  });
  return { rows, period };
}

// ───────────────────────────── Transferências

export type TransferRow = Awaited<ReturnType<typeof queryTransfers>>[number];

export async function queryTransfers(ctx: Ctx, p: P) {
  const m = await maps(ctx);
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.status) filters.push(["eq", "status", p.f.status.split(",")]);
  const list = await listAll(ctx.store, "transfers", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] });
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name]));
  const bid = branchScope(ctx, p.f);
  const q = p.q.trim();
  return list
    .filter((t) => {
      if (p.f.direcao === "enviadas") return t.fromBranchId === (bid ?? ctx.branchId);
      if (p.f.direcao === "recebidas") return t.toBranchId === (bid ?? ctx.branchId);
      return bid ? t.fromBranchId === bid || t.toBranchId === bid : true;
    })
    .filter((t) => (p.f.de ? String(t.createdAt) >= dayRange(p.f.de, p.f.de).start : true))
    .filter((t) => (p.f.ate ? String(t.createdAt) < dayRange(p.f.ate, p.f.ate).end : true))
    .filter((t) => (q ? String(t.number) === q.replace(/\D/g, "") || (t.items as TransferItem[]).some((i) => skuMatches(q, m.sku.get(i.skuId), m.product.get(i.productId))) : true))
    .filter((t) => (p.f.divergencia === "1" ? (t.divergences ?? []).length > 0 : true))
    .map((t) => {
      const items = t.items as TransferItem[];
      return {
        ...t,
        fromName: m.branch.get(t.fromBranchId)?.name ?? "—",
        toName: m.branch.get(t.toBranchId)?.name ?? "—",
        itemsCount: items.length,
        qtyTotal: items.reduce((a, i) => a + i.qty, 0),
        pendingTotal: items.reduce((a, i) => a + pendingQty(i), 0),
        costTotal: t.totalCost ?? items.reduce((a, i) => a + roundDiv(i.qty * (i.unitCost ?? 0), QTY), 0),
        responsibleName: users.get(t.responsibleId) ?? "—",
        divergenceCount: (t.divergences ?? []).filter((d: any) => d.kind === "damaged" || d.kind === "lost" || (d.kind === "missing" && d.open)).length,
      };
    });
}

// ───────────────────────────── Inventários

export type InventoryRow = Awaited<ReturnType<typeof queryInventories>>[number];

export async function queryInventories(ctx: Ctx, p: P) {
  const m = await maps(ctx);
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  const bid = branchScope(ctx, p.f);
  if (bid) filters.push(["eq", "branchId", bid]);
  if (p.f.status) filters.push(["eq", "status", p.f.status.split(",")]);
  if (p.f.deposito) filters.push(["eq", "warehouseId", p.f.deposito]);
  const list = await listAll(ctx.store, "inventories", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] });
  const counts = list.length ? await listAll(ctx.store, "inventory_counts", { filters: [["eq", "inventoryId", list.map((i) => i.id).slice(0, 100)]] }) : [];
  const byInv = new Map<string, Doc[]>();
  for (const c of counts) byInv.set(c.inventoryId, [...(byInv.get(c.inventoryId) ?? []), c]);
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name]));
  return list
    .filter((i) => (p.f.de ? String(i.baseAt) >= dayRange(p.f.de, p.f.de).start : true))
    .filter((i) => (p.f.ate ? String(i.baseAt) < dayRange(p.f.ate, p.f.ate).end : true))
    .filter((i) => (p.q ? String(i.number) === p.q.replace(/\D/g, "") : true))
    .map((i) => {
      const cs = byInv.get(i.id) ?? [];
      const counted = cs.filter((c) => c.counted).length;
      const withDiff = cs.filter((c) => c.difference).length;
      const cat = i.categoryId ? m.categories.find((c) => c.id === i.categoryId) : null;
      return {
        ...i,
        branchName: m.branch.get(i.branchId)?.name ?? "—",
        warehouseName: m.warehouse.get(i.warehouseId)?.name ?? "—",
        scopeLabel: i.scope === "category" ? `Categoria: ${cat?.name ?? "—"}` : i.scope === "location" ? `Localização: ${i.location}` : "Todos os itens",
        itemsTotal: cs.length || i.itemsCount || 0,
        counted,
        withDiff,
        diffValue: cs.reduce((a, c) => a + (c.differenceValue ?? 0), 0),
        diffQty: cs.reduce((a, c) => a + (c.difference ?? 0), 0),
        completedByName: i.completedBy ? (users.get(i.completedBy) ?? "—") : null,
        createdByName: users.get(i.createdBy) ?? "—",
      };
    });
}

export type InventoryItemRow = Awaited<ReturnType<typeof queryInventoryItems>>[number];

/** Itens (contagens) de um inventário com dados do SKU — tela e relatório de diferenças. */
export async function queryInventoryItems(ctx: Ctx, inventoryId: string, p: P) {
  const inv = await ctx.store.get("inventories", inventoryId);
  if (!inv || inv.companyId !== ctx.companyId) return [];
  const m = await maps(ctx);
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name]));
  const counts = await listAll(ctx.store, "inventory_counts", { filters: [["eq", "inventoryId", inventoryId]] });
  return counts
    .map((c) => {
      const sku = m.sku.get(c.skuId);
      const product = m.product.get(c.productId ?? sku?.productId);
      return {
        ...c,
        inventoryNumber: inv.number,
        skuCode: sku?.sku ?? "—",
        barcode: sku?.barcode ?? null,
        productName: sku?.name ?? product?.name ?? "—",
        unitCode: sku?.unitCode ?? product?.unitCode ?? "",
        countedByName: c.countedBy ? (users.get(c.countedBy) ?? "—") : null,
        state: c.finalQty == null && !c.counted ? "pending" : c.difference ? "diff" : "ok",
      };
    })
    .filter((r) => skuMatches(p.q, m.sku.get(r.skuId), m.product.get(r.productId)))
    .filter((r) => (p.f.situacao ? r.state === p.f.situacao : true))
    .sort((a, b) => String(a.location ?? "").localeCompare(String(b.location ?? "")) || a.productName.localeCompare(b.productName, "pt-BR"));
}
