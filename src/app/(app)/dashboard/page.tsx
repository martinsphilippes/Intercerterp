import Link from "next/link";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, BarChart3, CalendarClock, CheckCircle2, Clock, DollarSign, FileWarning, PackageSearch, PieChart, Plus, Receipt, ScanBarcode, ShoppingCart, Target, TrendingDown, Wallet } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { Meter } from "@/components/charts/bars";
import { can } from "@/lib/permissions";
import { formatBps, formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime, formatMonth, today } from "@/lib/dates";
import { qs, type SearchParams } from "@/lib/list";
import { commercialOverview } from "@/domain/reports";
import { formatGoalValue, GOAL_METRICS, GOAL_STATUS_LABEL, goalsProgress, type GoalProgress } from "@/domain/goals";
import { resolveReportParams, moduleQs, reportQs } from "../relatorios/params";
import { COMMON_DEFINITIONS, Delta, HowWeCalculate, marginText, ReportFilters, ScopeLine } from "../relatorios/_components/report-ui";
import { FISCAL_BUCKETS, certificateAlerts, financeSnapshot, fiscalSnapshot, latestSales, openCashSessions, stockAlerts, type FiscalBucket } from "./queries";

export const metadata = { title: "Painel do gestor" };

const MODEL_LABEL: Record<string, string> = { nfce: "NFC-e", nfe: "NF-e", nfse: "NFS-e" };
const BUCKET_WORD: Record<string, [string, string]> = { pending: ["pendente", "pendentes"], processing: ["processando", "processando"], rejected: ["rejeitado/com erro", "rejeitados/com erro"] };

function goalTone(g: GoalProgress): "good" | "warn" | "bad" | "neutral" {
  return g.status === "achieved" ? "good" : g.status === "on_track" ? "neutral" : g.status === "behind" ? "warn" : g.status === "closed_missed" ? "bad" : "neutral";
}

function longDate(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, dd)));
}

function addDay(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
}

interface Alert {
  key: string;
  tone: "bad" | "warn" | "info";
  icon: typeof AlertTriangle;
  title: string;
  text: string;
  href: string;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("dashboard");
  const params = await searchParams;
  const rp = resolveReportParams(s, params, "mes");
  const canSales = can(s.user, "sales") || can(s.user, "reports");
  const canFin = can(s.user, "finance");
  const canFiscal = can(s.user, "fiscal");
  const canStock = can(s.user, "stock") || can(s.user, "purchases");
  const canCash = can(s.user, "cash") || can(s.user, "pdv");
  // custo/margem: somente perfis com acesso aos relatórios gerenciais
  const canCost = can(s.user, "reports");
  const consolidated = !rp.single;
  const goalMonth = rp.period.to.slice(0, 7);
  const ref = today();

  const [overview, goalsAll, latest, alerts, fin, fiscal, cash, certs] = await Promise.all([
    canSales ? commercialOverview(s.ctx.store, rp.scope) : Promise.resolve(null),
    canSales ? goalsProgress(s.ctx, goalMonth, { branchIds: rp.branchIds }) : Promise.resolve([]),
    canSales ? latestSales(s.ctx, rp.branchIds) : Promise.resolve([]),
    canStock ? stockAlerts(s.ctx, rp.branchIds) : Promise.resolve([]),
    canFin ? financeSnapshot(s.ctx, rp.branchIds, consolidated) : Promise.resolve(null),
    canFiscal ? fiscalSnapshot(s.ctx, rp.branchIds, rp.period) : Promise.resolve(null),
    canCash ? openCashSessions(s.ctx, rp.branchIds) : Promise.resolve([]),
    canFiscal ? certificateAlerts(s.ctx, rp.branchIds) : Promise.resolve([]),
  ]);
  // filial específica: metas da filial; consolidado: metas de todas as filiais e da empresa
  const goals = goalsAll.filter((g) => (rp.single ? g.goal.branchId === rp.filial : true));
  const branchNames = new Map(s.branches.map((b) => [b.id, b.name as string]));
  const filial = rp.single ? rp.filial : null;
  const filialQs = rp.single ? qs({ filial: rp.filial }) : "";
  const t = overview?.totals;
  const prev = overview?.previous;
  const salesHref = `/vendas${moduleQs(rp)}`;
  const outOfStock = alerts.filter((a) => a.available <= 0);
  // pendências fiscais são estado atual: lista desde o início (não só o mês corrente), por grupo de situações
  const fiscalQs = (k: FiscalBucket) => qs({ status: FISCAL_BUCKETS[k].statuses.join(","), from: "2000-01-01", branch: filial });

  // Alertas importantes: somente fatos medidos agora (sem estados presumidos)
  const alertList: Alert[] = [];
  if (outOfStock.length) alertList.push({ key: "nostock", tone: "bad", icon: PackageSearch, title: `${outOfStock.length} produto(s) sem estoque`, text: "Disponível zerado ou negativo com mínimo cadastrado — reposição necessária.", href: `/estoque${qs({ filial, situacao: "below_min" })}` });
  if (alerts.length - outOfStock.length > 0) alertList.push({ key: "minstock", tone: "warn", icon: PackageSearch, title: `${alerts.length - outOfStock.length} produto(s) abaixo do mínimo`, text: "Avalie a reposição antes da ruptura.", href: `/estoque${qs({ filial, situacao: "below_min" })}` });
  if (fin && fin.receivableOverdue.count) alertList.push({ key: "recov", tone: "bad", icon: DollarSign, title: `${fin.receivableOverdue.count} parcela(s) a receber vencida(s)`, text: `Total de ${formatMoney(fin.receivableOverdue.amount)} em atraso.`, href: `/financeiro/receber${qs({ state: "overdue", branch: filial })}` });
  if (fin && fin.payableOverdue.count) alertList.push({ key: "payov", tone: "bad", icon: ArrowUpCircle, title: `${fin.payableOverdue.count} conta(s) a pagar vencida(s)`, text: `Total de ${formatMoney(fin.payableOverdue.amount)}.`, href: `/financeiro/pagar${qs({ state: "overdue", branch: filial })}` });
  if (fin && fin.payableToday.count) alertList.push({ key: "paytoday", tone: "warn", icon: ArrowUpCircle, title: `${fin.payableToday.count} conta(s) a pagar vencem hoje`, text: `Total de ${formatMoney(fin.payableToday.amount)}.`, href: `/financeiro/pagar${qs({ state: "due_today", branch: filial })}` });
  if (fiscal) {
    for (const g of fiscal.grid) {
      if (g.counts.rejected) alertList.push({ key: `rej-${g.model}`, tone: "bad", icon: FileWarning, title: `${g.counts.rejected} ${MODEL_LABEL[g.model]} rejeitada(s)/com erro`, text: "Corrija e retransmita o documento.", href: `/fiscal/${g.model}${fiscalQs("rejected")}` });
      if (g.counts.pending) alertList.push({ key: `pend-${g.model}`, tone: "warn", icon: FileWarning, title: `${g.counts.pending} ${MODEL_LABEL[g.model]} pendente(s)`, text: "Aguardando dados, revisão ou transmissão.", href: `/fiscal/${g.model}${fiscalQs("pending")}` });
    }
  }
  for (const c of certs) alertList.push({ key: `cert-${c.id}`, tone: c.daysLeft < 0 ? "bad" : "warn", icon: CalendarClock, title: c.daysLeft < 0 ? "Certificado digital vencido" : `Certificado vence em ${c.daysLeft} dia(s)`, text: `Validade ${formatDate(c.validTo)}${c.branchId ? ` · ${branchNames.get(c.branchId) ?? ""}` : ""}. Renovação recomendada.`, href: "/fiscal/configuracoes" });
  for (const c of cash.filter((x) => x.stale)) alertList.push({ key: `cash-${c.id}`, tone: "warn", icon: Wallet, title: `Caixa aberto desde ${formatDate(c.openedAt)}`, text: `${c.terminal} · ${c.operator}. Feche o caixa do dia anterior.`, href: `/caixa` });

  const shortcuts = [
    can(s.user, "pdv") && { href: "/pdv", label: "Frente de caixa (PDV)", icon: ScanBarcode },
    canFin && { href: "/financeiro/receber", label: "Contas a receber", icon: ArrowDownCircle },
    canFin && { href: "/financeiro/pagar", label: "Contas a pagar", icon: ArrowUpCircle },
    can(s.user, "purchases") && { href: "/compras/reposicao", label: "Reposição", icon: TrendingDown },
    can(s.user, "reports") && { href: `/relatorios/gerenciais${reportQs(params)}`, label: "Relatórios gerenciais", icon: BarChart3 },
    can(s.user, "reports") && { href: `/relatorios/curva-abc${reportQs(params)}`, label: "Curva ABC", icon: PieChart },
    canSales && { href: `/dashboard/metas?mes=${goalMonth}`, label: "Metas", icon: Target },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof ScanBarcode }>;

  const goalsByBranch = new Map<string, GoalProgress[]>();
  for (const g of goals) goalsByBranch.set(g.branchName, [...(goalsByBranch.get(g.branchName) ?? []), g]);
  const firstName = s.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}!`}
        crumbs={[{ label: "Gestão" }, { label: "Painel do gestor" }]}
        description={
          <>
            Veja o desempenho {rp.single ? `de ${rp.branchName}` : "das filiais"} — hoje, {longDate(ref)}. Cada indicador abre os registros que o compõem.
            {canCash && (
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {cash.length === 0 ? (
                  <Badge tone="neutral">Nenhum caixa aberto</Badge>
                ) : (
                  cash.map((c) => (
                    <Link key={c.id} href={`/caixa`} className="focus-ring rounded-full">
                      <Badge tone={c.stale ? "warn" : "good"} title={`Aberto em ${formatDateTime(c.openedAt)} por ${c.operator}`}>
                        Caixa aberto · {c.terminal}
                        {consolidated && c.branchId ? ` · ${branchNames.get(c.branchId) ?? ""}` : ""}
                      </Badge>
                    </Link>
                  ))
                )}
              </span>
            )}
          </>
        }
        actions={
          <>
            {can(s.user, "reports") && (
              <LinkButton href={`/relatorios/gerenciais${reportQs(params)}`}>
                <BarChart3 className="size-4" aria-hidden /> Relatórios
              </LinkButton>
            )}
            {can(s.user, "pdv", "create") && (
              <LinkButton href="/pdv?nova=1" variant="accent">
                <Plus className="size-4" aria-hidden /> Nova venda
              </LinkButton>
            )}
          </>
        }
      />
      <ReportFilters basePath="/dashboard" params={params} rp={rp} />
      {rp.error && (
        <div className="mb-4">
          <Notice tone="warn">{rp.error}</Notice>
        </div>
      )}
      <ScopeLine rp={rp} compare={overview ? overview.previousScope : null} />

      {!canSales && !canFin && !canFiscal && !canStock && <Notice tone="info">Seu perfil não tem acesso a nenhum dos indicadores do painel. Solicite acesso ao administrador.</Notice>}

      <section aria-label="Indicadores" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t && prev && (
          <>
            <Stat label="Vendas líquidas (faturamento)" value={formatMoney(t.netRevenue)} href={salesHref} hint={<Delta cur={t.netRevenue} prev={prev.netRevenue} />} />
            <Stat label="Vendas concluídas" value={t.salesCount.toLocaleString("pt-BR")} href={`/vendas${moduleQs(rp, { situacao: "completed" })}`} hint={<Delta cur={t.salesCount} prev={prev.salesCount} kind="count" />} />
            <Stat label="Ticket médio" value={t.ticket == null ? "Sem vendas" : formatMoney(t.ticket)} href={salesHref} hint={<Delta cur={t.ticket} prev={prev.ticket} />} />
            {canCost && <Stat label="Margem bruta" value={marginText(t.marginBps)} href={`/relatorios/gerenciais${reportQs(params)}`} hint={<>{`Resultado bruto ${formatMoney(t.grossProfit)} · `}<Delta cur={t.marginBps} prev={prev.marginBps} kind="points" /></>} tone={t.marginBps != null && t.marginBps < 0 ? "bad" : "default"} />}
            <Stat label="Devoluções no período" value={formatMoney(t.returns)} href={`/vendas/devolucoes${moduleQs(rp)}`} tone={t.returns > 0 ? "warn" : "default"} hint={`${t.returnsCount} devolução(ões)${canCost ? ` · custo revertido ${formatMoney(t.costReturned)}` : ""}`} />
          </>
        )}
        {fin && <Stat label="Saldo disponível" value={formatMoney(fin.accountsTotal)} href="/financeiro/fluxo-caixa" hint={<span className={fin.receivableToday.amount ? "text-accent-700" : undefined}>{formatMoney(fin.receivableToday.amount)} a receber hoje ({fin.receivableToday.count} parcela(s))</span>} tone={fin.accountsTotal < 0 ? "bad" : "default"} />}
        {canStock && <Stat label="Estoque crítico" value={`${alerts.length} ${alerts.length === 1 ? "item" : "itens"}`} href={`/estoque${qs({ filial, situacao: "below_min" })}`} tone={outOfStock.length ? "bad" : alerts.length ? "warn" : "good"} hint={<span className={outOfStock.length ? "text-red-700" : undefined}>{outOfStock.length} sem estoque · demais abaixo do mínimo</span>} />}
        {fiscal && <Stat label="Pendências fiscais" value={fiscal.totals.pending + fiscal.totals.processing + fiscal.totals.rejected} href={`/fiscal/nfce${fiscalQs(fiscal.totals.rejected ? "rejected" : "pending")}`} tone={fiscal.totals.rejected ? "bad" : fiscal.totals.pending ? "warn" : "good"} hint={`${fiscal.totals.rejected} rejeitado(s) · ${fiscal.totals.pending} pendente(s) · ${fiscal.totals.processing} processando`} />}
      </section>
      {overview && overview.cancelled.count > 0 && (
        <p className="-mt-2 mb-4 text-xs text-slate-500">
          <Link className="text-brand-700 hover:underline" href={`/vendas${moduleQs(rp, { situacao: "cancelled" })}`}>
            {overview.cancelled.count} venda(s) cancelada(s) no período ({formatMoney(overview.cancelled.total)})
          </Link>{" "}
          não entram no faturamento.
        </p>
      )}

      {shortcuts.length > 0 && (
        <nav aria-label="Atalhos" className="no-print mb-4 flex flex-wrap gap-2">
          {shortcuts.map((sc) => (
            <Link key={sc.href} href={sc.href} className="focus-ring inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm text-ink hover:border-brand-300 hover:bg-brand-50/50">
              <sc.icon className="size-4 shrink-0 text-brand-600" aria-hidden /> {sc.label}
            </Link>
          ))}
        </nav>
      )}

      {overview && (
        <div className="mb-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
          <Card
            className="xl:col-span-2"
            title={`Faturamento ${overview.series.granularity === "hour" ? "por hora" : "por dia"} — ${rp.period.preset === "7d" ? "últimos 7 dias" : rp.period.label}`}
            description={`Total do período ${formatMoney(t!.netRevenue)} · comparado ao período anterior equivalente (${overview.previousScope.from === overview.previousScope.to ? formatDate(overview.previousScope.from) : `${formatDate(overview.previousScope.from)} a ${formatDate(overview.previousScope.to)}`}).`}
            actions={
              can(s.user, "reports") && (
                <Link href={`/relatorios/gerenciais${reportQs(params, { tab: "dia" })}`} className="text-xs font-medium text-brand-700 hover:underline">
                  Ver relatório
                </Link>
              )
            }
          >
            {t && t.salesCount === 0 && t.returnsCount === 0 && (prev?.salesCount ?? 0) === 0 ? (
              <EmptyState title="Sem vendas no período" description="Nenhuma venda concluída ou devolução no recorte selecionado nem no período anterior." action={can(s.user, "pdv") ? <LinkButton href="/pdv">Abrir o PDV</LinkButton> : undefined} />
            ) : (
              <RevenueChart
                points={overview.series.points}
                granularity={overview.series.granularity}
                currentLabel={`Atual (${rp.period.label})`}
                previousLabel="Período anterior"
                drillBase={`/vendas${filialQs}`}
                highlightDate={ref}
                caption={`Receita líquida ${overview.series.granularity === "hour" ? "por hora" : "por dia"} — ${rp.branchName}.`}
              />
            )}
          </Card>
          <Card
            title={`Meta mensal — ${formatMonth(goalMonth)}`}
            description="Realizado do 1º dia do mês até hoje (ou fim do mês) pelo mesmo critério do faturamento."
            actions={
              <Link href={`/dashboard/metas?mes=${goalMonth}${rp.single ? `&filial=${rp.filial}` : ""}`} className="text-xs font-medium text-brand-700 hover:underline">
                Detalhes
              </Link>
            }
          >
            {goals.length === 0 ? (
              <EmptyState icon={<Target className="size-8" />} title="Nenhuma meta cadastrada para o mês" description={`Cadastre metas de receita, número de vendas ou ticket médio para ${rp.single ? rp.branchName : "as filiais"}.`} action={<LinkButton href={`/dashboard/metas?mes=${goalMonth}`} size="sm">Cadastrar metas</LinkButton>} />
            ) : (
              <div className="space-y-4">
                {[...goalsByBranch].map(([branch, list]) => (
                  <div key={branch}>
                    {(consolidated || goalsByBranch.size > 1) && <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{branch}</p>}
                    <ul className="space-y-3">
                      {list.map((g) => {
                        const expectedBps = g.metric === "ticket" || !g.target ? null : Math.round(((g.expected ?? 0) * 10000) / g.target);
                        const link = g.metric === "ticket" && canCost ? `/relatorios/gerenciais?de=${g.from}&ate=${g.to}${g.goal.branchId ? `&filial=${g.goal.branchId}` : "&filial=todas"}` : `/vendas?de=${g.from}&ate=${g.to}${g.goal.branchId ? `&filial=${g.goal.branchId}` : ""}`;
                        return (
                          <li key={g.goal.id}>
                            <Link href={link} className="focus-ring -mx-1 block rounded px-1 py-0.5 hover:bg-brand-50/60">
                              <div className="flex items-baseline justify-between gap-2 text-sm">
                                <span className="text-ink">{GOAL_METRICS[g.metric]?.label ?? g.metric}</span>
                                <span className="tabular text-xs text-slate-600">
                                  <strong className="text-sm text-ink">{formatGoalValue(g.metric, g.actual)}</strong> de {formatGoalValue(g.metric, g.target)}
                                </span>
                              </div>
                              <div className="mt-1.5">
                                <Meter bps={g.progressBps} expectedBps={expectedBps} tone={goalTone(g)} label={`${GOAL_METRICS[g.metric]?.label} — ${formatBps(g.progressBps ?? 0, 1)} da meta`} />
                              </div>
                              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                <span className="inline-flex items-center gap-1">
                                  {g.status === "achieved" ? <CheckCircle2 className="size-3.5 text-emerald-700" aria-hidden /> : g.status === "behind" || g.status === "closed_missed" ? <AlertTriangle className="size-3.5 text-amber-700" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
                                  {GOAL_STATUS_LABEL[g.status]} · {formatBps(g.progressBps ?? 0, 1)}
                                </span>
                                {g.metric !== "ticket" && g.status !== "not_started" && <span>esperado até hoje: {formatGoalValue(g.metric, g.expected)}</span>}
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                <p className="text-xs text-slate-500">O traço vertical indica o ritmo linear esperado para a data (dia {goals[0]?.elapsedDays} de {goals[0]?.monthDays}).</p>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="mb-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        {canSales && (
          <Card className="xl:col-span-2" title="Últimas vendas" actions={<Link href={`/vendas${filialQs}`} className="text-xs font-medium text-brand-700 hover:underline">Ver todas</Link>} bodyClass="p-0">
            {latest.length === 0 ? (
              <EmptyState icon={<Receipt className="size-8" />} title="Nenhuma venda registrada" description="As vendas concluídas no PDV aparecem aqui." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Venda · cliente</th>
                      <th>Documento · hora</th>
                      <th className="text-right">Valor</th>
                      <th>Pagamento</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <Link href={`/vendas/${v.id}`} className="font-medium text-brand-700 hover:underline">
                            nº {v.number}
                          </Link>
                          <span className="block max-w-[220px] truncate text-xs text-slate-500">
                            {v.customerSnapshot?.name ?? "Consumidor"} · {v.operatorName}
                            {consolidated ? ` · ${branchNames.get(v.branchId) ?? ""}` : ""}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          {v.documentModel ? (
                            <Link href={`/fiscal/${v.documentModel}/${v.fiscalDocumentId}`} className="text-brand-700 hover:underline">
                              {MODEL_LABEL[v.documentModel] ?? v.documentModel}
                              {v.documentNumber ? ` ${v.documentNumber}` : ""}
                            </Link>
                          ) : (
                            <StatusBadge kind="fiscal" status={v.fiscalStatus} />
                          )}
                          <span className="block text-xs text-slate-500">{formatDateTime(v.completedAt)}</span>
                        </td>
                        <td className="tabular text-right">
                          {formatMoney(v.total)}
                          {(v.returnedTotal ?? 0) > 0 && <span className="block text-xs text-amber-700">devolvido {formatMoney(v.returnedTotal)}</span>}
                        </td>
                        <td className="max-w-[160px] truncate text-slate-700" title={v.paymentLabel}>{v.paymentLabel}</td>
                        <td>
                          <StatusBadge kind="sale" status={v.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        {(canStock || canFin || canFiscal || canCash) && (
        <Card
          className={canSales ? undefined : "xl:col-span-3"}
          title="Alertas importantes"
          description="Situações medidas agora que exigem ação."
          actions={
            <Link href="/notificacoes" className="text-xs font-medium text-brand-700 hover:underline">
              Ver central
            </Link>
          }
        >
          {alertList.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <CheckCircle2 className="size-4 text-emerald-700" aria-hidden /> Nenhum alerta {rp.single ? "nesta filial" : "nas filiais"} nas áreas que seu perfil acompanha.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {alertList.slice(0, 8).map((a) => (
                <li key={a.key} className="py-2 first:pt-0 last:pb-0">
                  <Link href={a.href} className="focus-ring -mx-1 flex items-start gap-3 rounded px-1 py-0.5 hover:bg-brand-50/60">
                    <a.icon className={`mt-0.5 size-4 shrink-0 ${a.tone === "bad" ? "text-red-700" : a.tone === "warn" ? "text-accent-600" : "text-brand-600"}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{a.title}</span>
                      <span className="block text-xs text-slate-500">{a.text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        )}
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        {fiscal && (
          <Card
            title="Resumo fiscal"
            description="Autorizados no período e documentos que exigem acompanhamento (situação atual)."
            actions={
              <Link href={`/fiscal/nfce${qs({ branch: filial })}`} className="text-xs font-medium text-brand-700 hover:underline">
                Central fiscal
              </Link>
            }
            bodyClass="p-0"
          >
            <ul className="divide-y divide-line">
              {fiscal.grid.map((g) => {
                const issues = (Object.keys(FISCAL_BUCKETS) as FiscalBucket[]).filter((k) => g.counts[k] > 0);
                return (
                  <li key={g.model} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/fiscal/${g.model}${qs({ status: "authorized", from: rp.period.from, to: rp.period.to, branch: filial })}`} className="text-sm font-medium text-brand-700 hover:underline">
                        {MODEL_LABEL[g.model]} autorizadas
                      </Link>
                      <p className="text-xs text-slate-500">
                        {issues.length === 0 ? (
                          <span className="text-emerald-700">Sem pendências</span>
                        ) : (
                          issues.map((k, i) => (
                            <span key={k}>
                              {i > 0 && " · "}
                              <Link href={`/fiscal/${g.model}${fiscalQs(k)}`} className={k === "rejected" ? "text-red-700 hover:underline" : "text-amber-700 hover:underline"}>
                                {g.counts[k]} {BUCKET_WORD[k][g.counts[k] === 1 ? 0 : 1]}
                              </Link>
                            </span>
                          ))
                        )}
                      </p>
                    </div>
                    <div className="tabular shrink-0 text-right">
                      <p className="text-sm font-semibold text-ink">{g.authorizedCount}</p>
                      <p className="text-xs text-slate-500">{formatMoney(g.authorizedTotal)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-4 py-2 text-xs text-slate-500">Quantidade e valor autorizados no período {rp.period.label}. Documentos de demonstração usam provedor de simulação.</p>
          </Card>
        )}
        {fin && (
          <Card title="Financeiro" description="Posição atual dos títulos e das contas." actions={<Link href="/financeiro/fluxo-caixa" className="text-xs font-medium text-brand-700 hover:underline">Fluxo de caixa</Link>}>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Recebíveis vencidos" value={formatMoney(fin.receivableOverdue.amount)} hint={`${fin.receivableOverdue.count} parcela(s)`} tone={fin.receivableOverdue.amount ? "bad" : "default"} href={`/financeiro/receber${qs({ state: "overdue", branch: filial })}`} />
              <Stat label="A pagar hoje" value={formatMoney(fin.payableToday.amount)} hint={`${fin.payableToday.count} parcela(s)`} tone={fin.payableToday.amount ? "warn" : "default"} href={`/financeiro/pagar${qs({ state: "due_today", branch: filial })}`} />
              <Stat label="A pagar — próximos 7 dias" value={formatMoney(fin.payableNext7.amount)} hint={`${fin.payableNext7.count} parcela(s) até ${formatDate(fin.in7)}`} href={`/financeiro/pagar${qs({ state: "upcoming", dueFrom: addDay(fin.ref), dueTo: fin.in7, branch: filial })}`} />
              <Stat label="A pagar vencidas" value={formatMoney(fin.payableOverdue.amount)} hint={`${fin.payableOverdue.count} parcela(s)`} tone={fin.payableOverdue.amount ? "bad" : "default"} href={`/financeiro/pagar${qs({ state: "overdue", branch: filial })}`} />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Saldo das contas</p>
              {fin.accounts.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma conta financeira ativa.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {fin.accounts.map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <td className="py-1.5">
                          <Link href={`/financeiro/fluxo-caixa?conta=${a.id}`} className="text-ink hover:text-brand-700 hover:underline">
                            {a.name}
                          </Link>
                          {a.shared && <span className="ml-2 text-xs text-slate-500">compartilhada</span>}
                        </td>
                        <td className={`tabular py-1.5 text-right ${a.balance < 0 ? "text-red-700" : "text-ink"}`}>{formatMoney(a.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="pt-2 font-semibold">Total</td>
                      <td className="tabular pt-2 text-right font-semibold">{formatMoney(fin.accountsTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </Card>
        )}
        {canStock && (
          <Card title="Estoque crítico" description="Saldos com disponível abaixo do mínimo cadastrado (mesmo critério da listagem de Estoque)." actions={alerts.length > 0 ? <Badge tone={outOfStock.length ? "bad" : "warn"}>{alerts.length}</Badge> : <Badge tone="good">OK</Badge>}>
            {alerts.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-slate-600">
                <CheckCircle2 className="size-4 text-emerald-700" aria-hidden /> Nenhum item abaixo do mínimo {rp.single ? "nesta filial" : "nas filiais"}.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {alerts.slice(0, 7).map((a) => (
                    <li key={`${a.warehouseId}-${a.skuId}`} className="py-2 first:pt-0">
                      <Link href={`/estoque/movimentos?sku=${a.skuId}&filial=${a.branchId}`} className="focus-ring flex items-start justify-between gap-3 rounded text-sm hover:text-brand-700">
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{a.name}</span>
                          <span className="text-xs text-slate-500">
                            {a.sku}
                            {consolidated ? ` · ${branchNames.get(a.branchId) ?? ""}` : ""}
                            {!a.warehouseDefault && a.warehouseName ? ` · ${a.warehouseName}` : ""}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-right text-xs">
                          <span className={a.available <= 0 ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>{formatQty(a.available, a.unitCode ?? undefined)}</span>
                          <span className="block text-slate-500">mín. {formatQty(a.min)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-slate-500">{alerts.length > 7 ? `+${alerts.length - 7} item(ns)` : `${alerts.length} item(ns)`}</span>
                  <Link href={`/compras/reposicao${qs({ filial, situacao: "abaixo-minimo" })}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                    <ShoppingCart className="size-3.5" aria-hidden /> Planejar reposição
                  </Link>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      <HowWeCalculate
        items={[
          ...COMMON_DEFINITIONS,
          ["Metas", "Por filial (ou empresa), mês e métrica. Realizado do 1º dia do mês até hoje pelo mesmo serviço de métricas; o ritmo esperado é a meta × dias decorridos ÷ dias do mês (para ticket, a própria meta)."],
          ["Saldo disponível", "Soma do saldo atual das contas financeiras ativas do recorte (extrato interno), incluindo contas compartilhadas entre filiais. “A receber hoje” = parcelas a receber em aberto com vencimento hoje."],
          ["Estoque crítico", "Saldo (SKU × depósito) com disponível (físico − reservado) abaixo do mínimo cadastrado — mesmo critério da listagem de Estoque “Abaixo do mínimo”; “sem estoque” = disponível ≤ 0."],
          ["Financeiro", "Parcelas em aberto/parciais pelo saldo; vencidas = vencimento antes de hoje."],
          ["Resumo fiscal", "Autorizados: documentos com autorização no período selecionado (quantidade e valor). Pendentes: aguardando dados/revisão/transmissão (inclui rascunhos); processando: na fila ou aguardando retorno; rejeitados: rejeição, denegação ou erro — situação atual."],
          ["Alertas", "Produtos sem estoque/abaixo do mínimo, contas vencidas, documentos fiscais pendentes/rejeitados, certificado digital vencido ou a vencer em até 30 dias e caixa aberto desde dia anterior."],
        ]}
      />
    </>
  );
}
