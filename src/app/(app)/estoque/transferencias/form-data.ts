import "server-only";
import { listAll } from "@/lib/db";
import type { SessionInfo } from "@/lib/server/session";
import { lookups } from "@/lib/server/lookups";
import { balanceId } from "@/domain/stock";
import type { TransferLine } from "./transfer-form";

/** Dados do formulário de transferência (origem = filial atual). */
export async function transferFormData(s: SessionInfo, opts: { items?: Array<{ skuId: string; qty: number }>; fromWarehouseId?: string | null } = {}) {
  const ctx = s.ctx;
  const branchId = ctx.branchId!;
  const [branches, warehouses, users] = await Promise.all([
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "available"]] }),
    lookups.users(ctx),
  ]);
  const fromWh = opts.fromWarehouseId ?? warehouses.find((w) => w.branchId === branchId)?.id ?? null;
  const originBals = fromWh ? await listAll(ctx.store, "stock_balances", { filters: [["eq", "warehouseId", fromWh]] }) : [];
  const lines: TransferLine[] = [];
  for (const it of opts.items ?? []) {
    const sku = await ctx.store.get("skus", it.skuId);
    if (!sku || sku.companyId !== ctx.companyId) continue;
    const b = fromWh ? originBals.find((x) => x.id === balanceId(fromWh, sku.id)) : null;
    lines.push({ id: sku.id, sku: sku.sku, name: sku.name, unitCode: sku.unitCode, barcode: sku.barcode ?? null, physical: b?.physical ?? 0, available: (b?.physical ?? 0) - (b?.reserved ?? 0), avgCost: b?.avgCost ?? sku.costTotal ?? 0, location: b?.location ?? null, minQty: b?.minQty ?? 0, qty: it.qty });
  }
  return {
    origin: { id: branchId, name: s.branch?.name ?? "" },
    branches: branches.filter((b) => b.id !== branchId && b.status !== "inactive").map((b) => ({ value: b.id, label: b.name })),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, branchId: w.branchId })),
    users,
    initialLines: lines,
    availableItems: originBals.filter((b) => b.physical - b.reserved > 0).length,
    currentUserId: s.user.id,
  };
}
