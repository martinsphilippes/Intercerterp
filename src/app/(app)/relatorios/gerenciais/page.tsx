import Link from "next/link";
import { Download, PieChart } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { BarList } from "@/components/charts/bars";
import { can, canDo } from "@/lib/permissions";
import { formatBps, formatMoney, roundDiv } from "@/lib/money";
import { qs, sp, type SearchParams } from "@/lib/list";
import { firstMovementDate, managerialReport, paymentBreakdown } from "@/domain/reports";
import { formatDate } from "@/lib/dates";
import { MANAGERIAL_TABS, contextShowsScope, reportQs, resolveReportParams, salesListHref } from "../params";
import { COMMON_DEFINITIONS, Delta, FilterSelect, HowWeCalculate, marginText, PrintHeader, PrintStyles, ReportFilters, ScopeLine } from "../_components/report-ui";
import { PrintButton } from "../_components/print-button";
import { ComparisonTable, ResultTable } from "../_components/tables";

export const metadata = { title: "Relatórios gerenciais" };

function Hint({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <>
      <span className="block">{text}</span>
      {children && <span className="mt-1 block border-t border-line pt-1">{children}</span>}
    </>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("reports");
  const params = await searchParams;
  const rp = resolveReportParams(s, params, "mes");
  const compare = sp(params, "cmp") !== "0";
  const first = await firstMovementDate(s.ctx.store, s.ctx.companyId, rp.branchIds);
  const tab = MANAGERIAL_TABS.some((t) => t.key === sp(params, "tab")) ? sp(params, "tab") : "dia";
  const report = await managerialReport(s.ctx.store, rp.scope, { compare, branchIds: rp.branchIds });
  const pay = tab === "pagamento" ? await paymentBreakdown(s.ctx.store, rp.scope) : null;
  const t = report.totals;
  const prev = report.previous;
  const canExport = canDo(s.user, "data.export");
  const exportQs = qs({ page: null }, params);
  const base = `/relatorios/gerenciais`;
  const tabBase = `${base}${qs({ tab: null }, params)}`;
  const detailHref = (id: string) => `${base}/filial/${id}${qs({ periodo: sp(params, "periodo") || null, de: sp(params, "de") || null, ate: sp(params, "ate") || null })}`;
  const empty = t.salesCount === 0 && t.returnsCount === 0;
  // Vendas lista a filial do contexto: quando o recorte é outro, o detalhamento vai para as operações da filial
  // (resultado detalhado) ou fica sem link — nunca abre um recorte diferente do total clicado.
  const salesHref = salesListHref(s, rp, { situacao: "completed" }) ?? (rp.single ? detailHref(rp.filial) : null);
  const cancelledHref = salesListHref(s, rp, { situacao: "cancelled" });

  return (
    <>
      <PrintStyles />
      <PrintHeader title="Relatório gerencial de vendas" company={String(s.company.tradeName || s.company.name)} user={s.user.name} rp={rp} />
      <PageHeader
        title="Relatórios gerenciais"
        crumbs={[{ label: "Análise" }, { label: "Relatórios gerenciais" }]}
        description="Resultado comercial por unidade: vendas brutas, descontos, devoluções, vendas líquidas, CMV, margem, número de vendas e ticket médio — com comparação ao período anterior."
        actions={
          <>
            {can(s.user, "reports") && (
              <LinkButton href={`/relatorios/curva-abc${reportQs(params)}`}>
                <PieChart className="size-4" aria-hidden /> Curva ABC
              </LinkButton>
            )}
            {canExport && (
              <a className={buttonClass("secondary")} href={`/api/export/reports-units${exportQs}`} title="Exportar resultado por unidade (CSV)">
                <Download className="size-4" aria-hidden /> Exportar CSV
              </a>
            )}
            <PrintButton />
          </>
        }
      />
      <ReportFilters basePath={base} params={params} rp={rp} submitLabel="Aplicar filtros" help={`Datas inclusivas, no horário de Brasília.${first ? ` Movimentos registrados a partir de ${formatDate(first)}.` : " Ainda não há vendas registradas."}`}>
        <FilterSelect name="tab" label="Relatório" value={tab} options={MANAGERIAL_TABS.map((x) => ({ value: x.key, label: `Vendas e margem — ${x.label.toLowerCase()}` }))} />
        <label className="flex h-9 items-center gap-2 self-end text-sm text-slate-700">
          <input type="checkbox" name="cmp" value="1" defaultChecked={compare} className="focus-ring size-4 rounded border-line accent-brand-700" />
          Comparar com o período anterior
          <input type="hidden" name="cmp" value="0" />
        </label>
      </ReportFilters>
      {rp.error && (
        <div className="mb-4">
          <Notice tone="warn">{rp.error}</Notice>
        </div>
      )}
      <h2 className="text-base font-semibold text-ink">Vendas e margem</h2>
      <ScopeLine rp={rp} compare={report.previousScope} company={String(s.company.tradeName || s.company.name)} />

      <section aria-label="Indicadores do período" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Vendas líquidas" value={formatMoney(t.netRevenue)} href={salesHref ?? undefined} hint={<Hint text="Após descontos e devoluções">{compare && <Delta cur={t.netRevenue} prev={prev?.netRevenue ?? null} />}</Hint>} />
        <Stat label="Vendas brutas" value={formatMoney(t.gross)} href={salesHref ?? undefined} hint={<Hint text={`Descontos ${formatMoney(t.discounts)} · devoluções ${formatMoney(t.returns)}`}>{compare && <Delta cur={t.gross} prev={prev?.gross ?? null} />}</Hint>} />
        <Stat label="Custo direto (CMV)" value={formatMoney(t.cmv)} hint={<Hint text={`Custo revertido ${formatMoney(t.costReturned)}`}>{compare && <Delta cur={t.cmv} prev={prev?.cmv ?? null} goodWhenUp={false} />}</Hint>} />
        <Stat label="Margem bruta" value={marginText(t.marginBps)} hint={<Hint text={`${formatMoney(t.grossProfit)} de resultado bruto`}>{compare && <Delta cur={t.marginBps} prev={prev?.marginBps ?? null} kind="points" />}</Hint>} tone={t.marginBps != null && t.marginBps < 0 ? "bad" : "default"} />
        <Stat label="Vendas concluídas" value={t.salesCount.toLocaleString("pt-BR")} href={salesHref ?? undefined} hint={<Hint text={`${t.returnsCount} ${t.returnsCount === 1 ? "devolução" : "devoluções"} no período`}>{compare && <Delta cur={t.salesCount} prev={prev?.salesCount ?? null} kind="count" />}</Hint>} />
        <Stat label="Ticket médio" value={t.ticket == null ? "Sem vendas" : formatMoney(t.ticket)} hint={<Hint text="Vendas líquidas ÷ vendas concluídas">{compare && <Delta cur={t.ticket} prev={prev?.ticket ?? null} />}</Hint>} />
      </section>
      {report.cancelled.count > 0 && (
        <p className="-mt-2 mb-4 text-xs text-slate-500">
          {cancelledHref ? (
            <Link className="text-brand-700 hover:underline" href={cancelledHref}>
              {report.cancelled.count} venda(s) cancelada(s) ({formatMoney(report.cancelled.total)})
            </Link>
          ) : (
            <span>
              {report.cancelled.count} venda(s) cancelada(s) ({formatMoney(report.cancelled.total)})
            </span>
          )}{" "}
          no período não entram nos totais.
        </p>
      )}

      <Card title="Resultado por filial" description="Abra os detalhes para conferir os movimentos. Cada filial do recorte aparece, inclusive sem movimento." bodyClass="p-0" className="mb-4">
        <ResultTable
          rows={report.byBranch.map((b) => ({ ...b, href: detailHref(b.id) }))}
          total={{ ...t, id: "total", label: report.byBranch.length > 1 ? "Total consolidado" : "Total" }}
          firstLabel="Filial"
          previous={compare ? report.previousByBranch : null}
          previousTotal={compare ? prev : null}
          action="Detalhes"
        />
        <div className="space-y-0.5 border-t border-line px-4 py-2 text-xs text-slate-500">
          <p>
            {report.cancelled.count === 0 ? "Nenhuma venda cancelada no período." : `${report.cancelled.count} ${report.cancelled.count === 1 ? "venda cancelada fica" : "vendas canceladas ficam"} fora dos cálculos (${formatMoney(report.cancelled.total)}).`} Devoluções consideradas na data em que ocorreram.
          </p>
          {compare && report.previousScope && (
            <p>
              Comparação: {formatDate(report.previousScope.from)} a {formatDate(report.previousScope.to)} · mesmo número de dias.
            </p>
          )}
        </div>
      </Card>

      {compare && prev && (
        <Card title="Comparação com o período anterior" description={`Mesma quantidade de dias (${rp.period.days}), imediatamente antes do período selecionado.`} className="mb-4" bodyClass="p-0">
          <ComparisonTable cur={t} prev={prev} curLabel={rp.period.label} prevLabel={report.previousScope ? `${report.previousScope.from.split("-").reverse().join("/")} a ${report.previousScope.to.split("-").reverse().join("/")}` : ""} />
        </Card>
      )}

      <div className="print-break" />
      <LinkTabs basePath={tabBase} active={tab} tabs={MANAGERIAL_TABS.map((x) => ({ key: x.key, label: x.label }))} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{MANAGERIAL_TABS.find((x) => x.key === tab)?.label}</h2>
        {canExport && (
          <a className={buttonClass("ghost", "sm", "no-print")} href={`/api/export/reports-breakdown${qs({ tab }, params)}`}>
            <Download className="size-4" aria-hidden /> Exportar esta quebra (CSV)
          </a>
        )}
      </div>

      {empty && tab !== "pagamento" ? (
        <Card>
          <EmptyState title="Sem vendas ou devoluções no período" description="Ajuste o período ou a filial." />
        </Card>
      ) : tab === "dia" ? (
        <>
          <Card className="mb-4" title="Receita líquida por dia" description="Colunas: período atual. Linha: período anterior equivalente (alinhado por dia).">
            <RevenueChart
              points={report.series.points}
              granularity={report.series.granularity}
              currentLabel={`Atual (${rp.period.label})`}
              previousLabel={compare ? "Período anterior" : null}
              drillBase={contextShowsScope(s, rp) ? `/vendas${qs({ filial: rp.single ? rp.filial : null, situacao: "completed" })}` : null}
              caption={`Receita líquida — ${rp.branchName}.`}
            />
          </Card>
          <Card bodyClass="p-0">
            <ResultTable rows={report.byDay.map((d) => ({ ...d, href: salesListHref(s, rp, { situacao: "completed" }, { from: d.id, to: d.id }) ?? (rp.single ? `${base}/filial/${rp.filial}${qs({ de: d.id, ate: d.id })}` : null) }))} total={{ ...t, id: "total", label: "Total do período" }} firstLabel="Data" hideZero />
          </Card>
        </>
      ) : tab === "categoria" ? (
        <div className="grid gap-4 2xl:grid-cols-3 [&>*]:min-w-0">
          <Card className="2xl:col-span-1" title="Participação na receita líquida">
            <BarList
              ariaLabel="Receita líquida por categoria"
              rows={report.byCategory.map((c) => ({
                key: c.id,
                label: c.label,
                value: c.netRevenue,
                valueText: formatMoney(c.netRevenue),
                sub: `${t.netRevenue > 0 ? formatBps(roundDiv(c.netRevenue * 10000, t.netRevenue), 1) : "—"} da receita · margem ${marginText(c.marginBps)}`,
                href: `/relatorios/curva-abc${reportQs(params, { categoria: c.id })}`,
              }))}
            />
          </Card>
          <Card className="2xl:col-span-2" bodyClass="p-0">
            <ResultTable
              rows={report.byCategory.map((c) => ({ ...c, href: `/relatorios/curva-abc${reportQs(params, { categoria: c.id })}` }))}
              total={{ ...t, id: "total", label: "Total" }}
              firstLabel="Categoria"
              countLabel="Vendas c/ a categoria"
              showShare
              hideTicket
            />
          </Card>
        </div>
      ) : tab === "operador" ? (
        <Card bodyClass="p-0">
          <ResultTable rows={report.byOperator.map((o) => ({ ...o, href: o.id === "__none__" ? null : salesListHref(s, rp, { operador: o.id, situacao: "completed" }) }))} total={{ ...t, id: "total", label: "Total" }} firstLabel="Operador" showShare />
          <p className="border-t border-line px-4 py-2 text-xs text-slate-500">Devoluções são atribuídas ao operador da venda original, na data do movimento da devolução.</p>
        </Card>
      ) : (
        pay && (
          <Card bodyClass="p-0">
            {pay.rows.length === 0 ? (
              <EmptyState title="Sem pagamentos ou devoluções no período" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Meio de pagamento / forma de devolução</th>
                      <th className="text-right">Vendas / devoluções</th>
                      <th className="text-right">Valor</th>
                      <th className="text-right">Participação nas vendas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pay.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.kind === "return" ? <span className="text-amber-800">(−) {r.label}</span> : r.label}</td>
                        <td className="tabular text-right">{r.count}</td>
                        <td className={`tabular text-right ${r.kind === "return" ? "text-amber-800" : ""}`}>{r.kind === "return" ? `− ${formatMoney(r.amount)}` : formatMoney(r.amount)}</td>
                        <td className="tabular text-right">{r.kind === "payment" && pay.paymentsTotal > 0 ? formatBps(roundDiv(r.amount * 10000, pay.paymentsTotal), 1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      <td className="border-t border-line px-3 py-2">Vendas (pagamentos aplicados)</td>
                      <td className="border-t border-line px-3 py-2" />
                      <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(pay.paymentsTotal)}</td>
                      <td className="border-t border-line px-3 py-2" />
                    </tr>
                    <tr className="bg-slate-50 font-semibold">
                      <td className="px-3 py-2">(−) Devoluções do período</td>
                      <td className="px-3 py-2" />
                      <td className="tabular px-3 py-2 text-right">− {formatMoney(pay.returnsTotal)}</td>
                      <td className="px-3 py-2" />
                    </tr>
                    <tr className="bg-slate-100 font-semibold">
                      <td className="px-3 py-2">= Receita líquida</td>
                      <td className="px-3 py-2" />
                      <td className="tabular px-3 py-2 text-right">{formatMoney(pay.paymentsTotal - pay.returnsTotal)}</td>
                      <td className="px-3 py-2 text-right text-xs font-normal text-slate-500">{pay.paymentsTotal - pay.returnsTotal === pay.netRevenue ? "confere com o resumo" : "divergente do resumo"}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
              Valores aplicados por meio nas vendas concluídas do período (troco excluído; vale-crédito usado em trocas aparece como meio de pagamento). Devoluções do período pela forma de compensação; em venda a prazo, a parte abatida do título (crediário) aparece em linha própria, sem saída de caixa. Taxas de cartão não reduzem a receita comercial (ficam no financeiro).
            </p>
          </Card>
        )
      )}

      <HowWeCalculate
        items={[
          ...COMMON_DEFINITIONS,
          ["Vendas brutas / líquidas", "Brutas = preço × quantidade dos itens. Líquidas (receita líquida) = brutas − descontos + acréscimos − devoluções."],
          ["Resultado por unidade", "Soma das operações da filial; o total consolidado é a soma das filiais (margem e ticket recalculados pelos totais). O detalhe da filial lista exatamente as vendas e devoluções que compõem a linha."],
          ["Quebras", "Por dia: data local da venda/devolução. Por categoria: categoria gravada no item no momento da venda (uma venda com itens de várias categorias conta em cada uma). Por operador: operador da venda; devoluções vão para o operador da venda original."],
        ]}
      />
    </>
  );
}
