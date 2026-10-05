import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { PRINTER_MODES, SCANNER_MODES, TEF_PROVIDERS } from "@/domain/terminals";

const label = (list: Array<{ value: string; label: string }>, v: string | null) => list.find((x) => x.value === v)?.label.split(" (")[0] ?? v ?? "—";

/** Terminais da empresa com sessão de caixa atual (tela e exportação). No consolidado, todas as filiais. */
export async function queryTerminals(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  const branchId = p.f.branch || ctx.branchId;
  if (branchId) filters.push(["eq", "branchId", branchId]);
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.printer) filters.push(["eq", "printerMode", p.f.printer]);
  const [terminals, branches, warehouses, sessions, users] = await Promise.all([
    listAll(ctx.store, "terminals", { filters }),
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "cash_sessions", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["open", "reopened"]]] }),
    listAll(ctx.store, "users"),
  ]);
  let rows = terminals.map((t) => {
    const s = sessions.find((x) => x.terminalId === t.id);
    return {
      ...t,
      branchName: branches.find((b) => b.id === t.branchId)?.name ?? "—",
      warehouseName: warehouses.find((w) => w.id === t.defaultWarehouseId)?.name ?? "Padrão da filial",
      printerLabel: label(PRINTER_MODES, t.printerMode),
      scannerLabel: label(SCANNER_MODES, t.scannerMode),
      tefLabel: label(TEF_PROVIDERS, t.tefProvider),
      sessionId: s?.id ?? null,
      sessionNumber: s?.number ?? null,
      sessionOpenedAt: s?.openedAt ?? null,
      sessionOperator: s ? (users.find((u) => u.id === s.operatorId)?.name ?? "—") : null,
      sessionState: s ? s.status : "closed",
    };
  });
  if (p.q) {
    const q = normalizeSearch(p.q);
    rows = rows.filter((t) => normalizeSearch(`${t.code} ${t.name} ${t.printerName ?? ""}`).includes(q));
  }
  if (p.f.session === "open") rows = rows.filter((t) => t.sessionId);
  return rows.sort((a, b) => String(a.code).localeCompare(String(b.code), "pt-BR", { numeric: true }));
}
