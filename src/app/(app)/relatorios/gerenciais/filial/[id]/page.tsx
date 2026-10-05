import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, Notice } from "@/components/ui/empty";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { canDo } from "@/lib/permissions";
import { formatMoney, marginBps } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { paginate, parseList, qs, sp, type SearchParams } from "@/lib/list";
import { branchOperations, commercialOverview, type SaleOp } from "@/domain/reports";
import { moduleQs, resolveReportParams } from "../../../params";
import { COMMON_DEFINITIONS, Delta, HowWeCalculate, marginText, PrintHeader, PrintStyles, ReportFilters, ScopeLine } from "../../../_components/report-ui";
import { PrintButton } from "../../../_components/print-button";

export const metadata = { title: "Resultado detalhado por filial" };

const COMPENSATION_LABEL: Record<string, string> = { store_credit: "Vale-crédito", exchange: "Troca", refund: "Reembolso" };
const REFUND_LABEL: Record<string, string> = { cash: "dinheiro", pix: "Pix", card_reversal: "estorno no cartão", account: "conta" };

/** Visão 11 — Resultado detalhado por filial: as operações que compõem os totais do resumo gerencial. */
export default async function Page({ params: routeParams, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("reports");
  const { id } = await routeParams;
  const params = await searchParams;
  const branch = s.branches.find((b) => b.id === id);
  if (!branch) notFound();
  const rp0 = resolveReportParams(s, { ...params, filial: id });
  const rp = { ...rp0, branchOptions: [] };
  const [overview, ops] = await Promise.all([commercialOverview(s.ctx.store, rp.scope), branchOperations(s.ctx.store, rp.scope)]);
  const t = ops.totals;
  const prev = overview.previous;
  const base = `/relatorios/gerenciais/filial/${id}`;
  const periodOnly = qs({ periodo: sp(params, "periodo") || null, de: sp(params, "de") || null, ate: sp(params, "ate") || null });
  const lp = parseList(params, { sort: "at", dir: "desc", pageSize: 50 });
  const { rows, total } = paginate(ops.sales, lp);
  const salesSum = ops.sales.reduce((a, o) => a + o.total, 0);
  const retSum = ops.returns.reduce((a, o) => a + o.total, 0);
  const salesCost = ops.sales.reduce((a, o) => a + o.cost, 0);
  const retCost = ops.returns.reduce((a, o) => a + o.cost, 0);
  const consistent = salesSum - retSum === t.netRevenue && overview.totals.netRevenue === t.netRevenue;
  const canExport = canDo(s.user, "data.export");
  const others = s.branches.filter((b) => b.id !== id);

  const columns: Column<SaleOp>[] = [
    { key: "number", label: "Venda", sortable: true, fixed: true, cell: (r) => `nº ${r.number ?? "—"}` },
    { key: "at", label: "Data/hora", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { key: "operatorName", label: "Operador", sortable: true, cell: (r) => r.operatorName },
    { key: "customerName", label: "Cliente", cell: (r) => r.customerName ?? <span className="text-slate-400">Consumidor</span> },
    { key: "itemsCount", label: "Itens", align: "right", hidden: true, cell: (r) => r.itemsCount },
    { key: "gross", label: "Bruto", align: "right", sortable: true, cell: (r) => formatMoney(r.gross) },
    { key: "discounts", label: "Descontos", align: "right", sortable: true, cell: (r) => (r.discounts ? `− ${formatMoney(r.discounts)}` : "—") },
    { key: "surcharges", label: "Acréscimos", align: "right", hidden: true, cell: (r) => formatMoney(r.surcharges) },
    { key: "total", label: "Valor líquido", align: "right", sortable: true, cell: (r) => <strong>{formatMoney(r.total)}</strong> },
    { key: "cost", label: "Custo (CMV)", align: "right", sortable: true, cell: (r) => formatMoney(r.cost) },
    { key: "marginBps", label: "Margem", align: "right", sortable: true, cell: (r) => marginText(r.marginBps) },
  ];

  return (
    <>
      <PrintStyles />
      <PrintHeader title={`Resultado detalhado — ${branch.name}`} company={String(s.company.tradeName || s.company.name)} user={s.user.name} rp={rp} />
      <PageHeader
        title={`Resultado detalhado — ${branch.name}`}
        crumbs={[{ label: "Análise" }, { label: "Relatórios gerenciais", href: `/relatorios/gerenciais${qs({ filial: "todas", periodo: sp(params, "periodo") || null, de: sp(params, "de") || null, ate: sp(params, "ate") || null })}` }, { label: branch.name }]}
        description="Vendas e devoluções do período que compõem os totais desta filial no resumo gerencial — mesmo critério e mesma base."
        actions={
          <>
            <LinkButton href={`/relatorios/gerenciais${qs({ filial: "todas", periodo: sp(params, "periodo") || null, de: sp(params, "de") || null, ate: sp(params, "ate") || null })}`}>
              <ArrowLeft className="size-4" aria-hidden /> Voltar ao relatório
            </LinkButton>
            {canExport && (
              <a className={buttonClass("secondary")} href={`/api/export/reports-branch-ops${qs({ id, page: null, sort: null, dir: null }, params)}`}>
                <Download className="size-4" aria-hidden /> Exportar operações (CSV)
              </a>
            )}
            <PrintButton />
          </>
        }
      />
      <ReportFilters basePath={base} params={params} rp={rp} />
      {rp.error && (
        <div className="mb-4">
          <Notice tone="warn">{rp.error}</Notice>
        </div>
      )}
      <ScopeLine
        rp={rp}
        compare={overview.previousScope}
        extra={
          others.length > 0 && (
            <span className="no-print">
              <strong className="font-semibold text-slate-700">Outras filiais:</strong>{" "}
              {others.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && " · "}
                  <Link className="text-brand-700 hover:underline" href={`/relatorios/gerenciais/filial/${b.id}${periodOnly}`}>
                    {b.name}
                  </Link>
                </span>
              ))}
            </span>
          )
        }
      />

      <section aria-label="Indicadores da filial" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Vendas brutas" value={formatMoney(t.gross)} hint={<Delta cur={t.gross} prev={prev.gross} />} />
        <Stat label="Descontos" value={formatMoney(t.discounts)} hint={t.surcharges ? `Acréscimos ${formatMoney(t.surcharges)}` : "No item e rateio do desconto global"} />
        <Stat label="Devoluções" value={formatMoney(t.returns)} href={`/vendas/devolucoes${moduleQs(rp)}`} hint={`${t.returnsCount} no período · na data do movimento`} tone={t.returns ? "warn" : "default"} />
        <Stat label="Vendas líquidas" value={formatMoney(t.netRevenue)} href={`/vendas${moduleQs(rp)}`} hint={<Delta cur={t.netRevenue} prev={prev.netRevenue} />} />
        <Stat label="Custo direto (CMV)" value={formatMoney(t.cmv)} hint={`Custo revertido nas devoluções ${formatMoney(t.costReturned)}`} />
        <Stat label="Resultado bruto" value={formatMoney(t.grossProfit)} hint={<>Margem {marginText(t.marginBps)} · <Delta cur={t.marginBps} prev={prev.marginBps} kind="points" /></>} tone={t.grossProfit < 0 ? "bad" : "default"} />
        <Stat label="Vendas concluídas" value={t.salesCount.toLocaleString("pt-BR")} href={`/vendas${moduleQs(rp, { status: "completed" })}`} hint={<Delta cur={t.salesCount} prev={prev.salesCount} kind="count" />} />
        <Stat label="Ticket médio" value={t.ticket == null ? "Sem vendas" : formatMoney(t.ticket)} hint={<Delta cur={t.ticket} prev={prev.ticket} />} />
      </section>

      <Card title="Conferência com o resumo" className="mb-4">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <dl className="space-y-1">
            <div className="flex justify-between gap-4">
              <dt>Σ vendas listadas ({ops.sales.length})</dt>
              <dd className="tabular">{formatMoney(salesSum)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-amber-800">
              <dt>(−) Σ devoluções listadas ({ops.returns.length})</dt>
              <dd className="tabular">− {formatMoney(retSum)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
              <dt>= Receita líquida da filial</dt>
              <dd className="tabular">{formatMoney(salesSum - retSum)}</dd>
            </div>
          </dl>
          <dl className="space-y-1">
            <div className="flex justify-between gap-4">
              <dt>Σ custo das vendas</dt>
              <dd className="tabular">{formatMoney(salesCost)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-amber-800">
              <dt>(−) Σ custo revertido nas devoluções</dt>
              <dd className="tabular">− {formatMoney(retCost)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
              <dt>= CMV da filial</dt>
              <dd className="tabular">{formatMoney(salesCost - retCost)}</dd>
            </div>
          </dl>
        </div>
        <p className={`mt-3 text-xs ${consistent ? "text-emerald-700" : "text-red-700"}`}>
          {consistent ? "✓ Confere com a linha da filial no resumo gerencial e no painel (mesmo serviço de métricas)." : "Atenção: divergência entre detalhe e resumo — informe o suporte."}
        </p>
      </Card>

      <Card className="mb-4" title="Receita líquida por dia" description="Período atual (colunas) e período anterior equivalente (linha).">
        <RevenueChart points={overview.series.points} granularity={overview.series.granularity} currentLabel={`Atual (${rp.period.label})`} previousLabel="Período anterior" drillBase={`/vendas${qs({ filial: id })}`} caption={`Receita líquida — ${branch.name}.`} />
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-ink">Vendas concluídas no período</h2>
      <div className="mb-4">
        <DataTable
          id="branch-sales"
          basePath={base}
          params={params}
          columns={columns}
          rows={rows}
          total={total}
          page={lp.page}
          pageSize={lp.pageSize}
          rowHref={(r) => `/vendas/${r.id}`}
          totals={{ gross: formatMoney(t.gross), discounts: `− ${formatMoney(t.discounts)}`, surcharges: formatMoney(t.surcharges), total: formatMoney(salesSum), cost: formatMoney(salesCost), marginBps: marginText(marginBps(salesSum, salesCost)) }}
          empty={<EmptyState title="Nenhuma venda concluída no período" description="Ajuste o período." />}
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Devoluções no período (data do movimento)</h2>
      <Card bodyClass="p-0" className="mb-4">
        {ops.returns.length === 0 ? (
          <EmptyState title="Nenhuma devolução no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Devolução</th>
                  <th>Data/hora do movimento</th>
                  <th>Venda de origem</th>
                  <th>Compensação</th>
                  <th>Situação</th>
                  <th className="text-right">Itens</th>
                  <th className="text-right">Valor devolvido</th>
                  <th className="text-right">Custo revertido</th>
                </tr>
              </thead>
              <tbody>
                {ops.returns.map((r) => {
                  const ret = ops.facts.returns.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/vendas/devolucoes/${r.id}`} className="font-medium text-brand-700 hover:underline">
                          nº {r.number ?? "—"}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(r.at)}</td>
                      <td>
                        <Link href={`/vendas/${r.saleId}`} className="text-brand-700 hover:underline">
                          Venda nº {r.saleNumber ?? "—"}
                        </Link>
                        <span className="block text-xs text-slate-500">
                          {formatDateTime(r.saleAt)} {r.priorSale && <Badge tone="info" className="ml-1">anterior ao período</Badge>}
                        </span>
                      </td>
                      <td>
                        {COMPENSATION_LABEL[r.compensation ?? ""] ?? r.compensation ?? "—"}
                        {ret?.refundMethod ? ` (${REFUND_LABEL[ret.refundMethod] ?? ret.refundMethod})` : ""}
                      </td>
                      <td>
                        <StatusBadge kind="generic" status={r.status} />
                      </td>
                      <td className="tabular text-right">{r.itemsCount}</td>
                      <td className="tabular text-right text-amber-800">− {formatMoney(r.total)}</td>
                      <td className="tabular text-right">− {formatMoney(r.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td className="border-t border-line px-3 py-2" colSpan={6}>
                    Total das devoluções
                  </td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">− {formatMoney(retSum)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">− {formatMoney(retCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {ops.cancelled.length > 0 && (
        <Card title="Vendas canceladas no período (excluídas dos totais)" className="mb-4" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Movimento / data</th>
                  <th>Tipo</th>
                  <th>Motivo</th>
                  <th className="text-right">Valor líquido</th>
                  <th className="text-right">Custo direto</th>
                </tr>
              </thead>
              <tbody>
                {ops.cancelled.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/vendas/${c.id}`} className="font-medium text-brand-700 hover:underline">
                        Venda nº {c.number}
                      </Link>
                      <span className="block text-xs text-slate-500">{formatDateTime(c.completedAt)}</span>
                    </td>
                    <td>
                      <StatusBadge kind="sale" status="cancelled" />
                    </td>
                    <td className="text-slate-600">{c.cancelReason ?? "—"}</td>
                    <td className="text-right text-slate-500">
                      Excluído <span className="tabular block text-xs line-through">{formatMoney(c.total)}</span>
                    </td>
                    <td className="text-right text-slate-500">
                      Excluído <span className="tabular block text-xs line-through">{formatMoney(c.costTotal ?? 0)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mb-4 text-xs text-slate-500">
        {ops.sales.length + ops.returns.length + ops.cancelled.length} registro(s): {ops.sales.length} venda(s), {ops.returns.length} devolução(ões) e {ops.cancelled.length} cancelamento(s) — cancelamentos excluídos dos totais.
      </p>

      <HowWeCalculate
        items={[
          ...COMMON_DEFINITIONS,
          ["Valor líquido da venda", "Bruto − descontos + acréscimos dos itens da venda (igual ao total da venda)."],
          ["Conferência", "Σ valor líquido das vendas listadas − Σ devoluções listadas = receita líquida da filial no resumo gerencial e no painel."],
        ]}
      />
    </>
  );
}
