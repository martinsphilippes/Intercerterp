import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { PAPER_WIDTHS, PRINTER_MODES, SCANNER_MODES, TEF_PROVIDERS } from "@/domain/terminals";
import { canBeDefaultWarehouse, sortWarehouses, warehouseOptionLabel } from "@/domain/warehouse-rules";

export async function terminalFormOptions(ctx: Ctx) {
  const [branches, warehouses] = await Promise.all([
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId], ["ne", "status", "inactive"]] }),
    listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  return {
    branches: branches.map((b) => ({ value: b.id, label: b.name })),
    // §39: só depósitos de venda ou almoxarifado ativos (o terminal baixa a venda dele)
    warehouses: sortWarehouses(warehouses.filter(canBeDefaultWarehouse)).map((w) => ({ value: w.id, label: warehouseOptionLabel(w), branchId: w.branchId })),
    printerModes: PRINTER_MODES,
    scannerModes: SCANNER_MODES,
    tefProviders: TEF_PROVIDERS,
    paperWidths: PAPER_WIDTHS,
  };
}
