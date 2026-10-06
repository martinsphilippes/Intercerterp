import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Lock, RotateCcw, Wallet } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { CASH_MOVEMENT_LABEL, expectedVisible, pendingCloseTransfer, sessionSummary } from "@/domain/cash";
import { reopenSessionAction, retryCloseTransferAction } from "../actions";
import { ClosureTable, METHOD_LABEL, SessionVersions } from "../session-views";

export const metadata = { title: "Sessão de caixa" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("cash");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const store = s.ctx.store;
  const session = await store.get("cash_sessions", id);
  if (!session || session.companyId !== s.ctx.companyId) notFound();
  if (!s.user.isAdmin && (s.user.branchIds ?? []).length && !s.user.branchIds.includes(session.branchId)) notFound();
  const sum = await sessionSummary(s.ctx, id);
  // conferência cega: previsto de sessão aberta oculto até a contagem (exceto supervisor de caixa)
  const showExpected = await expectedVisible(s.ctx, session);
  const pendingTransfer = await pendingCloseTransfer(s.ctx, session);
  const sameBranch = s.ctx.branchId === session.branchId;
  const [users, terminals, branches, accounts] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "terminals"), nameMap(s.ctx, "branches"), nameMap(s.ctx, "financial_accounts")]);
  const sales = await listAll(store, "sales", { filters: [["eq", "cashSessionId", id]], orderBy: [{ field: "completedAt", dir: "desc" }] });
  const open = ["open", "reopened"].includes(session.status);
  const diffs = session.differences ?? {};
  const totalDiff = Object.values(diffs).reduce((a: number, b: any) => a + Number(b), 0);
  const base = `/caixa/${id}`;
  const per = session.peripheralsCheck ?? {};
  const liveExpected: Record<string, number> = { cash: sum.expected.cash };
  for (const [k, v] of Object.entries(sum.byMethod)) if (k !== "cash") liveExpected[k] = v.expected;
  return (
    <>
      <PageHeader
        title={`Caixa nº ${session.number} — ${terminals.get(session.terminalId) ?? ""}`}
        crumbs={[{ label: "Caixa", href: "/caixa" }, { label: `Caixa nº ${session.number}` }]}
        badges={<><StatusBadge kind="cash" status={session.status} /><Badge>versão {session.version ?? 1}</Badge>{!open && (Object.keys(diffs).length ? <Badge tone="bad">Divergência {formatMoney(totalDiff)}</Badge> : <Badge tone="good">Sem diferença</Badge>)}</>}
        description={`${branches.get(session.branchId)} · operador ${users.get(session.operatorId) ?? "—"} · aberto em ${formatDateTime(session.openedAt)}${session.closedAt ? ` · fechado em ${formatDateTime(session.closedAt)} por ${users.get(session.closedBy) ?? "—"}` : ""}`}
        actions={
          <>
            <LinkButton href={`${base}/relatorio`} target="_blank"><FileText className="size-4" /> Relatório</LinkButton>
            {open && s.ctx.branchId === session.branchId && <LinkButton href={`/caixa/movimentos?sessao=${id}`}><Wallet className="size-4" /> Suprimento / sangria</LinkButton>}
            {open && sameBranch && can(s.user, "cash", "edit") && <LinkButton href={`/caixa/fechamento?sessao=${id}`} variant="primary"><Lock className="size-4" /> Fechar caixa</LinkButton>}
            {pendingTransfer && sameBranch && can(s.user, "cash", "edit") && (
              <ActionButton action={retryCloseTransferAction.bind(null, id)} label="Concluir recolhimento" icon={<Wallet className="size-4" />} variant="primary" confirm={`Transferir ${formatMoney(pendingTransfer.amount)} da conta Caixa para ${accounts.get(pendingTransfer.toAccountId) ?? "a conta de destino"}?`} />
            )}
            {session.status === "closed" && canDo(s.user, "cash.reopen") && s.ctx.branchId === session.branchId && (
              <ActionButton action={reopenSessionAction.bind(null, id)} label="Reabrir caixa" icon={<RotateCcw className="size-4" />} askReason="Motivo da reabertura (obrigatório). O fechamento atual é preservado e uma nova versão de conferência será criada." />
            )}
          </>
        }
      />
      {pendingTransfer && (
        <div className="mb-4">
          <Notice tone="warn" title="Recolhimento do fechamento pendente">
            O fechamento registrou o recolhimento de {formatMoney(pendingTransfer.amount)} para {accounts.get(pendingTransfer.toAccountId) ?? "a conta de destino"}, mas a transferência não foi concluída. Use “Concluir recolhimento” (a operação não duplica a transferência).
          </Notice>
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Fundo de abertura" value={formatMoney(sum.totals.opening)} hint="Não é receita" />
        <Stat label="Vendas concluídas" value={sum.totals.salesCount} hint={formatMoney(sum.totals.sales)} href={`/vendas?sessao=${id}`} />
        <Stat label="Suprimentos / sangrias" value={`${formatMoney(sum.totals.supply)} / ${formatMoney(sum.totals.withdrawal)}`} href={`${base}?tab=movimentos`} />
        <Stat label="Dinheiro esperado (agora)" value={showExpected ? formatMoney(sum.expected.cash) : "oculto"} hint={showExpected ? `troco entregue ${formatMoney(sum.totals.change)} · devoluções ${formatMoney(sum.totals.refunds)}` : "conferência cega: revelado após a contagem"} />
        <Stat label={open ? "Situação" : "Diferença do fechamento"} value={open ? (session.status === "reopened" ? "Reaberto" : "Aberto") : formatMoney(totalDiff)} tone={open ? "default" : totalDiff || Object.keys(diffs).length ? "bad" : "good"} hint={!open && session.justification ? `Justificativa: ${session.justification}` : undefined} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Conferência" },
          { key: "movimentos", label: "Movimentos", count: sum.movements.filter((m) => m.type !== "sale").length },
          { key: "vendas", label: "Vendas", count: sales.length },
          { key: "versoes", label: "Versões de fechamento", count: (session.history ?? []).filter((h: any) => h.event === "closed").length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={open ? "Previsto por meio de pagamento (em tempo real)" : `Conferência registrada — versão ${session.version ?? 1}`} className="lg:col-span-2" bodyClass="p-0">
            {open && !showExpected ? (
              <p className="px-4 py-6 text-sm text-slate-500">Conferência cega ativa: o previsto por meio só é exibido depois que a contagem for registrada na tela de fechamento.</p>
            ) : open ? (
              <table className="table-base w-full text-sm">
                <thead><tr><th>Forma</th><th className="text-right">Transações</th><th className="text-right">Esperado</th></tr></thead>
                <tbody>{Object.entries(liveExpected).map(([k, v]) => <tr key={k}><td>{METHOD_LABEL[k] ?? k}</td><td className="tabular text-right">{sum.byMethod[k]?.count ?? 0}</td><td className="tabular text-right">{formatMoney(v)}</td></tr>)}</tbody>
              </table>
            ) : (
              <ClosureTable expected={session.expected ?? {}} counted={session.counted ?? {}} differences={diffs} />
            )}
            {!open && session.justification && <p className="border-t border-line px-4 py-2 text-sm">Justificativa: {session.justification}</p>}
            {showExpected && <p className="border-t border-line px-4 py-2 text-xs text-slate-500">Dinheiro esperado = fundo {formatMoney(sum.totals.opening)} + vendas em dinheiro {formatMoney(sum.totals.cashSales)} + suprimentos {formatMoney(sum.totals.supply)} − sangrias {formatMoney(sum.totals.withdrawal)} − devoluções em espécie {formatMoney(sum.totals.refunds)}.</p>}
          </Card>
          <Card title="Abertura e conferência do terminal">
            <DefinitionList
              cols={1}
              items={[
                { label: "Terminal", value: terminals.get(session.terminalId) },
                { label: "Operador", value: users.get(session.operatorId) },
                { label: "Aberto em", value: formatDateTime(session.openedAt) },
                { label: "Impressora", value: per.printer ? `${per.printer.mode ?? "—"}${per.printer.confirmed ? " · conferida pelo operador" : " · não confirmada"}${per.printer.testPrintedAt ? " · teste impresso" : ""}` : (typeof per.printer === "string" ? per.printer : "—") },
                { label: "Leitor", value: per.scanner ? (per.scanner.tested ? per.scanner.result : typeof per.scanner === "string" ? per.scanner : "não testado") : "—" },
                { label: "TEF / maquininha", value: per.tef ? `${per.tef.provider ?? "—"} (${per.tef.status ?? "—"})${per.tef.confirmed ? " · conferida" : ""}` : "—" },
                { label: "Fiscal / Pix", value: per.fiscal ? `${per.fiscal.provider ?? "—"} ${per.fiscal.environment ?? ""} · Pix ${per.pix?.provider ?? "—"}` : "—" },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === "movimentos" && (
        <Card title="Movimentos de caixa" actions={<Link className="text-sm text-brand-700 hover:underline" href={`/caixa/movimentos?sessao=${id}`}>Abrir tela de movimentos</Link>} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Data/hora</th><th>Tipo</th><th>Motivo</th><th>Origem/destino</th><th>Responsável</th><th className="text-right">Valor</th><th /></tr></thead>
            <tbody>
              {sum.movements.filter((m) => m.type !== "sale").map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.occurredAt)}</td>
                  <td>{CASH_MOVEMENT_LABEL[m.type] ?? m.type}</td>
                  <td>{m.reason}{m.saleId && <Link className="ml-1 text-xs text-brand-700 hover:underline" href={`/vendas/${m.saleId}`}>venda</Link>}{m.returnId && <Link className="ml-1 text-xs text-brand-700 hover:underline" href={`/vendas/devolucoes/${m.returnId}`}>devolução</Link>}</td>
                  <td>{m.accountId ? accounts.get(m.accountId) : "—"}</td>
                  <td>{m.recipient ?? users.get(m.createdBy)}</td>
                  <td className={`tabular text-right ${m.amount < 0 ? "text-red-700" : ""}`}>{formatMoney(m.amount)}</td>
                  <td>{["opening", "supply", "withdrawal"].includes(m.type) && <Link className="text-xs text-brand-700 hover:underline" href={`/caixa/movimentos/${m.id}/comprovante`}>Comprovante</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-xs text-slate-500">Recebimentos de venda em dinheiro: {sum.movements.filter((m) => m.type === "sale").length} lançamento(s), {formatMoney(sum.totals.cashSales)} (ver aba Vendas).</p>
        </Card>
      )}
      {tab === "vendas" && (
        <Card title="Vendas da sessão" bodyClass="p-0">
          {sales.length === 0 ? <EmptyState title="Nenhuma venda nesta sessão" /> : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Situação</th><th>Fiscal</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {sales.map((x) => (
                  <tr key={x.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/vendas/${x.id}`}>nº {x.number}</Link></td>
                    <td>{formatDateTime(x.completedAt)}</td>
                    <td>{x.customerSnapshot?.name ?? "Consumidor final"}</td>
                    <td><StatusBadge kind="sale" status={x.status} /></td>
                    <td><StatusBadge kind="fiscal" status={x.fiscalStatus} /></td>
                    <td className={`tabular text-right ${x.status === "cancelled" ? "text-slate-400 line-through" : ""}`}>{formatMoney(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "versoes" && (
        <Card title="Versões de fechamento e reaberturas" description="Cada fechamento é preservado; a reabertura cria nova versão de conferência.">
          {session.status === "reopened" && <div className="mb-3"><Notice tone="warn">Sessão reaberta: a conferência da versão anterior está preservada abaixo; um novo fechamento criará a versão {session.version}.</Notice></div>}
          <SessionVersions history={session.history ?? []} />
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Histórico e auditoria">
          <Timeline store={store} refs={[`cash_session:${id}`]} />
        </Card>
      )}
    </>
  );
}
