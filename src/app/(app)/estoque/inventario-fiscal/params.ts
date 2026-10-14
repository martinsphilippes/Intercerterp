import "server-only";
import type { SessionInfo } from "@/lib/server/session";
import { sp, type SearchParams } from "@/lib/list";
import { today } from "@/lib/dates";
import type { FiscalInventoryFilters } from "@/domain/inventory-fiscal";
import { allowedBranchIds, branchScope } from "../queries";

/**
 * Parâmetros do inventário em data-base vindos da URL — os MESMOS na tela, na impressão e na exportação CSV/XLSX:
 * `data` (padrão hoje), `filial` (como em Saldos: "all" = todas as permitidas), `deposito`, `tipoDeposito`, `categoria`,
 * `ncm`, `q`.
 */
export function inventoryParams(s: SessionInfo, params: SearchParams): { filters: FiscalInventoryFilters; branchId: string | null } {
  const f: Record<string, string> = { filial: sp(params, "filial") };
  const branchId = branchScope(s.ctx, f);
  const raw = sp(params, "data");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today();
  return {
    branchId,
    filters: {
      date,
      branchIds: branchId ? [branchId] : allowedBranchIds(s.ctx),
      warehouseId: sp(params, "deposito") || null,
      warehouseKind: sp(params, "tipoDeposito") || null,
      categoryId: sp(params, "categoria") || null,
      ncm: sp(params, "ncm") || null,
      q: sp(params, "q") || null,
    },
  };
}
