import { sp, type SearchParams } from "@/lib/list";
import { monthEnd, monthStart, today } from "@/lib/dates";
import type { CommissionBase, CommissionQuery } from "@/domain/commissions";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros da tela de comissões (mesmos na tela, na impressão e no CSV): de, ate, filial, vendedor, base. */
export function commissionParams(params: SearchParams): CommissionQuery & { base: CommissionBase | null } {
  const t = today();
  const de = sp(params, "de");
  const ate = sp(params, "ate");
  const from = DATE_RE.test(de) ? de : monthStart(t);
  const to = DATE_RE.test(ate) ? ate : monthEnd(from);
  const filial = sp(params, "filial");
  const base = sp(params, "base");
  return {
    from,
    to,
    branchId: filial && filial !== "todas" ? filial : null,
    sellerId: sp(params, "vendedor") || null,
    base: base === "invoiced" || base === "received" ? base : null,
  };
}
