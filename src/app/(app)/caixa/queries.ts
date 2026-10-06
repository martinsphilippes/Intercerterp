import "server-only";
import { listAll } from "@/lib/db";
import type { Doc, Filter } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, dayRange, today } from "@/lib/dates";
import type { ListParams } from "@/lib/list";
import { nameMap } from "@/lib/server/lookups";
import { blindCloseEnabled, CASH_MOVEMENT_LABEL, expectedVisible, sessionSummary } from "@/domain/cash";

export function cashPeriod(f: Record<string, string>) {
  const to = f.ate || today();
  const from = f.de || addDays(to, -29);
  return { from, to };
}

/** Consulta única das sessões de caixa (tela e exportação). Abertas: previsto calculado agora; fechadas: valores preservados no fechamento. */
export async function querySessions(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const { from, to } = cashPeriod(p.f);
  const { start, end } = dayRange(from, to);
  const filters: Filter[] = [["eq", "companyId", ctx.companyId], ["gte", "openedAt", start], ["lt", "openedAt", end]];
  const branch = ctx.branchId ?? p.f.filial ?? null;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (p.f.terminal) filters.push(["eq", "terminalId", p.f.terminal]);
  if (p.f.operador) filters.push(["eq", "operatorId", p.f.operador]);
  if (p.f.situacao) filters.push(["eq", "status", p.f.situacao === "open" ? ["open", "reopened"] : p.f.situacao]);
  const sessions = await listAll(ctx.store, "cash_sessions", { filters, orderBy: [{ field: "openedAt", dir: "desc" }] });
  // sessões ainda abertas de antes do período continuam visíveis
  if (!p.f.situacao || p.f.situacao === "open") {
    const stillOpen = await listAll(ctx.store, "cash_sessions", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["open", "reopened"]], ...(branch ? [["eq", "branchId", branch] as Filter] : [])] });
    for (const s of stillOpen) if (!sessions.some((x) => x.id === s.id) && (!p.f.terminal || s.terminalId === p.f.terminal) && (!p.f.operador || s.operatorId === p.f.operador)) sessions.unshift(s);
  }
  const ids = sessions.map((s) => s.id);
  const sales: Doc[] = [];
  for (let i = 0; i < ids.length; i += 100) sales.push(...(await listAll(ctx.store, "sales", { filters: [["eq", "cashSessionId", ids.slice(i, i + 100)]] })));
  const [users, terminals, branches] = await Promise.all([nameMap(ctx, "users"), nameMap(ctx, "terminals"), nameMap(ctx, "branches")]);
  const rows = [];
  const blindByBranch = new Map<string, boolean>();
  for (const s of sessions) {
    const own = sales.filter((x) => x.cashSessionId === s.id);
    const done = own.filter((x) => x.status === "completed");
    const open = ["open", "reopened"].includes(s.status);
    let expectedCash = s.expected?.cash ?? null;
    if (open) {
      // conferência cega: o previsto de sessão aberta só aparece depois da contagem (ou para supervisor)
      if (!blindByBranch.has(s.branchId)) blindByBranch.set(s.branchId, await blindCloseEnabled(ctx, s.branchId));
      expectedCash = (await expectedVisible(ctx, s, blindByBranch.get(s.branchId))) ? (await sessionSummary(ctx, s.id)).expected.cash : null;
    }
    const diffs: Record<string, number> = open ? {} : (s.differences ?? {});
    const totalDiff = Object.values(diffs).reduce((a: number, b: any) => a + Number(b), 0);
    rows.push({
      id: s.id,
      number: s.number as number,
      branchName: branches.get(s.branchId) ?? "—",
      terminalId: s.terminalId as string,
      terminalName: terminals.get(s.terminalId) ?? "—",
      operatorName: users.get(s.operatorId) ?? "—",
      openedAt: s.openedAt as string,
      closedAt: (s.closedAt ?? null) as string | null,
      status: s.status as string,
      version: (s.version ?? 1) as number,
      openingFund: (s.openingFund ?? 0) as number,
      salesCount: done.length,
      salesTotal: done.reduce((a, x) => a + x.total, 0),
      cancelledCount: own.filter((x) => x.status === "cancelled").length,
      expectedCash: expectedCash as number | null,
      countedCash: (open ? null : (s.counted?.cash ?? null)) as number | null,
      totalDiff,
      hasDiff: Object.keys(diffs).length > 0,
      justification: (s.justification ?? null) as string | null,
    });
  }
  if (p.f.divergencia === "1") return rows.filter((r) => r.hasDiff);
  return rows;
}

export type SessionRow = Awaited<ReturnType<typeof querySessions>>[number];

/** Movimentos de caixa (suprimentos, sangrias, abertura e devoluções) — tela da sessão e exportação. */
export async function queryCashMovements(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: Filter[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.sessao) filters.push(["eq", "sessionId", p.f.sessao]);
  else {
    const { from, to } = cashPeriod(p.f);
    const { start, end } = dayRange(from, to);
    filters.push(["gte", "occurredAt", start], ["lt", "occurredAt", end]);
    const branch = ctx.branchId ?? p.f.filial ?? null;
    if (branch) filters.push(["eq", "branchId", branch]);
  }
  const types = p.f.tipo === "vendas" ? ["sale"] : p.f.tipo ? [p.f.tipo] : ["opening", "supply", "withdrawal", "refund", "closing_adjust"];
  filters.push(["eq", "type", types]);
  const rows = await listAll(ctx.store, "cash_movements", { filters, orderBy: [{ field: "occurredAt", dir: p.f.ordem === "antigos" ? "asc" : "desc" }] });
  const [users, accounts, sessions] = await Promise.all([nameMap(ctx, "users"), nameMap(ctx, "financial_accounts"), nameMap(ctx, "cash_sessions", (s) => `nº ${s.number}`)]);
  return rows.map((m) => ({
    id: m.id,
    number: (m.number ?? 0) as number,
    occurredAt: m.occurredAt as string,
    sessionId: m.sessionId as string,
    sessionLabel: sessions.get(m.sessionId) ?? "—",
    type: m.type as string,
    typeLabel: CASH_MOVEMENT_LABEL[m.type] ?? m.type,
    amount: m.amount as number,
    reason: (m.reason ?? "") as string,
    accountId: (m.accountId ?? null) as string | null,
    accountName: m.accountId ? (accounts.get(m.accountId) ?? null) : null,
    recipient: (m.recipient ?? null) as string | null,
    createdByName: users.get(m.createdBy) ?? "—",
    approvedByName: m.approvedBy ? (users.get(m.approvedBy) ?? null) : null,
    saleId: (m.saleId ?? null) as string | null,
    returnId: (m.returnId ?? null) as string | null,
    notes: (m.notes ?? null) as string | null,
    transferId: (m.transferId ?? null) as string | null,
  }));
}

export type MovementRow = Awaited<ReturnType<typeof queryCashMovements>>[number];
