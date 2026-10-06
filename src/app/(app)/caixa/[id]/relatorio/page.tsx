import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { LinkButton } from "@/components/ui/button";
import { listAll } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { CASH_MOVEMENT_LABEL, expectedVisible, sessionSummary } from "@/domain/cash";
import { AutoPrint } from "../../../vendas/sale-widgets";
import { PrintStyles } from "../../../vendas/print-styles";
import { ClosureTable, METHOD_LABEL, SessionVersions } from "../../session-views";

export const metadata = { title: "Relatório de caixa" };

/** Relatório imprimível da sessão (A4): previsto por meio, conferências/versões, movimentos e vendas. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const s = await requireSession("cash");
  const { id } = await params;
  const { print } = await searchParams;
  const store = s.ctx.store;
  const session = await store.get("cash_sessions", id);
  if (!session || session.companyId !== s.ctx.companyId) notFound();
  if (!s.user.isAdmin && (s.user.branchIds ?? []).length && !s.user.branchIds.includes(session.branchId)) notFound();
  const sum = await sessionSummary(s.ctx, id);
  // conferência cega: prévia de sessão aberta não revela o previsto antes da contagem
  const showExpected = await expectedVisible(s.ctx, session);
  const [users, terminals, branches] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "terminals"), nameMap(s.ctx, "branches")]);
  const sales = await listAll(store, "sales", { filters: [["eq", "cashSessionId", id]], orderBy: [{ field: "completedAt", dir: "asc" }] });
  const company = await store.get("companies", session.companyId);
  const open = ["open", "reopened"].includes(session.status);
  const live: Record<string, number> = { cash: sum.expected.cash };
  for (const [k, v] of Object.entries(sum.byMethod)) if (k !== "cash") live[k] = v.expected;
  return (
    <div className="space-y-3">
      <PrintStyles paper="A4" />
      <div className="no-print flex gap-2"><AutoPrint enabled={print === "1"} /><LinkButton href={`/caixa/${id}`}>Voltar à sessão</LinkButton></div>
      <article className="print-doc mx-auto max-w-4xl space-y-4 rounded-lg border border-line bg-white p-6 text-sm text-black">
        <header className="flex justify-between border-b border-black pb-2">
          <div><p className="text-lg font-bold">Relatório de caixa nº {session.number}{open ? " — PRÉVIA (sessão aberta)" : ""}</p><p>{company?.tradeName || company?.name} · {branches.get(session.branchId)} · {terminals.get(session.terminalId)}</p></div>
          <div className="text-right text-xs"><p>Operador: {users.get(session.operatorId)}</p><p>Abertura: {formatDateTime(session.openedAt)}</p><p>Fechamento: {session.closedAt ? `${formatDateTime(session.closedAt)} (${users.get(session.closedBy) ?? "—"})` : "—"}</p><p>Versão: {session.version ?? 1}</p></div>
        </header>
        <section className="grid grid-cols-4 gap-2 text-center">
          {[["Fundo", sum.totals.opening], ["Vendas (" + sum.totals.salesCount + ")", sum.totals.sales], ["Suprimentos", sum.totals.supply], ["Sangrias", sum.totals.withdrawal], ["Devoluções em espécie", sum.totals.refunds], ["Vendas em dinheiro", showExpected ? sum.totals.cashSales : null], ["Troco entregue", sum.totals.change], ["Dinheiro esperado", showExpected ? sum.expected.cash : null]].map(([l, v]) => (
            <div key={String(l)} className="rounded border border-line p-2"><p className="text-xs text-slate-600">{l}</p><p className="font-semibold">{v == null ? "oculto (conferência cega)" : formatMoney(v as number)}</p></div>
          ))}
        </section>
        <section>
          <h2 className="mb-1 font-semibold">{open ? "Previsto por meio de pagamento" : "Conferência (versão atual)"}</h2>
          {open && !showExpected ? (
            <p>Conferência cega ativa: o previsto é revelado somente depois que a contagem for registrada no fechamento.</p>
          ) : open ? (
            <table className="table-base w-full"><thead><tr><th>Forma</th><th className="text-right">Transações</th><th className="text-right">Esperado</th></tr></thead><tbody>{Object.entries(live).map(([k, v]) => <tr key={k}><td>{METHOD_LABEL[k] ?? k}</td><td className="text-right">{sum.byMethod[k]?.count ?? 0}</td><td className="text-right">{formatMoney(v)}</td></tr>)}</tbody></table>
          ) : (
            <ClosureTable expected={session.expected ?? {}} counted={session.counted ?? {}} differences={session.differences ?? {}} />
          )}
          {session.justification && !open && <p className="mt-1">Justificativa: {session.justification}</p>}
        </section>
        <section>
          <h2 className="mb-1 font-semibold">Movimentos</h2>
          <table className="table-base w-full"><thead><tr><th>Data/hora</th><th>Tipo</th><th>Motivo</th><th>Responsável</th><th className="text-right">Valor</th></tr></thead>
            <tbody>{sum.movements.filter((m) => m.type !== "sale").map((m) => <tr key={m.id}><td>{formatDateTime(m.occurredAt)}</td><td>{CASH_MOVEMENT_LABEL[m.type] ?? m.type}</td><td>{m.reason}</td><td>{m.recipient ?? users.get(m.createdBy)}</td><td className="text-right">{formatMoney(m.amount)}</td></tr>)}</tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-1 font-semibold">Vendas ({sales.length})</h2>
          <table className="table-base w-full"><thead><tr><th>Venda</th><th>Hora</th><th>Cliente</th><th>Situação</th><th className="text-right">Total</th></tr></thead>
            <tbody>{sales.map((x) => <tr key={x.id}><td>nº {x.number}</td><td>{formatDateTime(x.completedAt)}</td><td>{x.customerSnapshot?.name ?? "Consumidor final"}</td><td>{x.status === "cancelled" ? "Cancelada" : "Concluída"}</td><td className="text-right">{formatMoney(x.total)}</td></tr>)}</tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-1 font-semibold">Histórico de versões</h2>
          <SessionVersions history={session.history ?? []} />
        </section>
        <footer className="grid grid-cols-2 gap-12 pt-10 text-center text-xs">
          <p className="border-t border-black pt-1">Operador — {users.get(session.operatorId)}</p>
          <p className="border-t border-black pt-1">Conferente / gerência</p>
        </footer>
        <p className="text-center text-[10px] text-slate-500">Emitido em {formatDateTime(new Date().toISOString())} por {s.user.name}</p>
      </article>
    </div>
  );
}
