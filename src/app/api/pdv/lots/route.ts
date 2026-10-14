import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { today } from "@/lib/dates";
import { defaultWarehouse } from "@/domain/stock";
import { balanceLots, lotAlertDays, lotsEnabled } from "@/domain/lots";
import { expiryStatus } from "@/domain/lot-calc";

/** Lotes com saldo de um SKU no depósito do terminal (escolha de lote no PDV — EST-02), em ordem FEFO. */
export async function GET(req: NextRequest) {
  const s = await requireApiSession();
  if (s instanceof NextResponse) return s;
  if (!can(s.user, "pdv")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const branchId = s.ctx.branchId;
  if (!branchId) return NextResponse.json({ error: "Selecione uma filial" }, { status: 400 });
  const store = s.ctx.store;
  if (!(await lotsEnabled(store, s.ctx.companyId, branchId))) return NextResponse.json({ lots: [] });
  const skuId = req.nextUrl.searchParams.get("sku") ?? "";
  const sku = skuId ? await store.get("skus", skuId) : null;
  if (!sku || sku.companyId !== s.ctx.companyId) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  const terminalId = req.nextUrl.searchParams.get("terminal") ?? "";
  const terminal = terminalId ? await store.get("terminals", terminalId) : null;
  const warehouseId = terminal && terminal.branchId === branchId && terminal.defaultWarehouseId ? terminal.defaultWarehouseId : (await defaultWarehouse(store, branchId)).id;
  const { lots, unlotted } = await balanceLots(store, warehouseId, skuId);
  const ref = today();
  const days = await lotAlertDays(store, s.ctx.companyId, branchId);
  return NextResponse.json({
    lots: lots.filter((l) => l.qty > 0).map((l) => ({ lot: l.lot, expiry: l.expiry, qty: l.qty, status: expiryStatus(l.expiry, ref, days) })),
    unlotted: Math.max(0, unlotted),
  });
}
