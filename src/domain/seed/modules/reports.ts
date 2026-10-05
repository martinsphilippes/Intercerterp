import { detId, listAll } from "@/lib/db";
import { addDays, monthStart, toLocalDate, today } from "@/lib/dates";
import type { DemoRefs } from "../base";

/**
 * Demonstração de Análise e gestão (Telas 03, 44, 45):
 *  - metas do mês anterior (receita, nº de vendas e ticket) e meta de ticket do mês corrente — o seed base já cria receita/nº de vendas do mês corrente;
 *  - devolução HOJE de uma venda de dia anterior (demonstra que a devolução entra na data do movimento, com a origem identificada).
 * Idempotente: ids determinísticos (seeder) e chave de idempotência da devolução.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const store = sd.store;
  const base = { companyId: refs.company.id, isDemo: true };
  const current = today().slice(0, 7);
  const previous = addDays(monthStart(today()), -1).slice(0, 7);
  const targets: Record<string, { revenue: number; count: number; ticket: number }> = {
    matriz: { revenue: 3500000, count: 200, ticket: 17500 },
    shopping: { revenue: 2000000, count: 120, ticket: 16000 },
  };
  let goals = 0;
  for (const [key, branch] of Object.entries(refs.branches)) {
    const t = targets[key] ?? targets.matriz;
    const defs: Array<[string, string, number]> = [
      [previous, "revenue", t.revenue],
      [previous, "sales_count", t.count],
      [previous, "ticket", t.ticket],
      [current, "ticket", t.ticket],
    ];
    for (const [period, metric, target] of defs) {
      const keyId = `${key}-${period}-${metric === "sales_count" ? "count" : metric}`;
      // não duplica meta criada manualmente para a mesma filial/mês/métrica
      const dup = await listAll(store, "goals", { filters: [["eq", "companyId", refs.company.id], ["eq", "period", period], ["eq", "metric", metric], ["eq", "branchId", branch.id]] });
      if (dup.length && !dup.some((g) => g.id === sd.id("goals", keyId))) continue;
      await sd.put("goals", keyId, { ...base, branchId: branch.id, period, metric, target, notes: "Meta de demonstração" });
      goals++;
    }
  }

  // Devolução hoje de uma venda anterior (data do movimento ≠ data da venda)
  let priorReturn: string | null = null;
  const idemKey = "demo-reports-prior-day-return";
  const existing = await store.get("returns", detId("return", idemKey));
  if (existing) priorReturn = existing.id;
  else {
    try {
      const sales = await listAll(store, "sales", { filters: [["eq", "companyId", refs.company.id], ["eq", "branchId", refs.branches.matriz.id], ["eq", "status", "completed"]] });
      const candidates = sales
        .filter((s) => toLocalDate(s.completedAt) < today() && !(s.returnedTotal > 0) && s.origin !== "exchange")
        .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
      const sale = candidates.find((s) => s.customerId) ?? candidates[0];
      if (sale) {
        const { processReturn, returnableItems } = await import("../../sales");
        const items = (await returnableItems(store, sale.id)).filter((i) => i.returnable > 0);
        const item = items[0];
        if (item) {
          const ctx = await refs.ctxFor("manager", "matriz");
          const ret = await processReturn(ctx, {
            saleId: sale.id,
            idemKey,
            reason: "Defeito constatado pelo cliente após a compra (demonstração de devolução de venda anterior)",
            items: [{ saleItemId: item.id, qty: Math.min(1000, item.returnable), condition: "damaged" }],
            compensation: sale.customerId ? "store_credit" : "refund",
            refundMethod: sale.customerId ? undefined : "cash",
          });
          priorReturn = ret.id;
        }
      }
    } catch (e: any) {
      console.warn("[seed reports] devolução de demonstração não criada:", e?.message ?? e);
    }
  }
  return { goals, priorReturn };
}
