import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download, Printer, RotateCcw } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { Timeline } from "@/components/ui/timeline";
import { canDo } from "@/lib/permissions";
import { formatBps, formatMoney } from "@/lib/money";
import { addDays, addMonths, formatDate, formatDateTime, monthStart, today } from "@/lib/dates";
import { qs, sp, type SearchParams } from "@/lib/list";
import { COMMISSION_BASE_LABEL, COMMISSION_LINE_LABEL, commissionReport, listClosings, type CommissionLine } from "@/domain/commissions";
import { listSellers } from "@/domain/sellers";
import { hasAllBranches } from "@/domain/goals";
import { AutoPrint } from "../sale-widgets";
import { PrintStyles } from "../print-styles";
import { commissionParams } from "./params";
import { CloseCommissionForm } from "./close-form";
import { reopenCommissionAction } from "./actions";

export const metadata = { title: "Comissões de vendedores" };

const KIND_TONE: Record<CommissionLine["kind"], "neutral" | "info" | "warn" | "bad"> = { sale: "info", receipt: "info", return: "warn", cancel: "bad" };

/** Comissões (VEN-05): apuração por período/filial/vendedor, fechamento em conta a pagar, reabertura, impressão e CSV. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("sales");
  await requireFeaturePage(s, "comissoes");
  if (!canDo(s.user, "sales.commissions")) notFound();
  const params = await searchParams;
  const print = sp(params, "print") === "1";
  const q = commissionParams(params);
  const accessible = [...s.branches].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  const fullAccess = hasAllBranches(s.user);
  if (q.branchId && !accessible.some((b) => b.id === q.branchId)) q.branchId = null;
  let error = null as string | null;
  const report = await commissionReport(s.ctx, q).catch((e) => {
    error = e?.message ?? String(e);
    return null;
  });
  const [sellers, closings] = await Promise.all([listSellers(s.ctx), listClosings(s.ctx, { from: q.from, to: q.to, sellerId: q.sellerId })]);
  const branchName = new Map(accessible.map((b) => [b.id as string, String(b.name)]));
  const scopeLabel = q.branchId ? (branchName.get(q.branchId) ?? "Filial") : fullAccess ? "Todas as filiais" : "Suas filiais";
  const defaultDue = addDays(addMonths(monthStart(q.to), 1), 9);
  const exportHref = `/api/export/sales-commissions${qs({ de: q.from, ate: q.to, filial: q.branchId, vendedor: q.sellerId, base: report?.base ?? q.base })}`;
  const printHref = `/vendas/comissoes${qs({ print: "1" }, params)}`;
  const thisMonth = monthStart(today());
  const prevMonth = addMonths(thisMonth, -1);
  const periodLink = (from: string) => `/vendas/comissoes${qs({ de: from, ate: addDays(addMonths(from, 1), -1), print: null }, params)}`;

  const body = (
    <>
      {error && <Notice tone="bad">{error}</Notice>}
      {report && (
        <>
          <section aria-label="Resumo da apuração" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Comissão a fechar" value={formatMoney(report.totals.openAmount)} tone={report.totals.openAmount > 0 ? "good" : "default"} hint={`${report.sellers.filter((x) => x.openAmount !== 0).length} vendedor(es)`} />
            <Stat label="Base a fechar" value={formatMoney(report.totals.openBase)} hint={COMMISSION_BASE_LABEL[report.base]} />
            <Stat label="Já fechado no período" value={formatMoney(report.totals.closedAmount)} />
            <Stat label="Recorte" value={`${formatDate(report.from)} a ${formatDate(report.to)}`} hint={scopeLabel} />
          </section>
          {report.sellers.length === 0 ? (
            <Card>
              <EmptyState title="Nenhuma comissão no período" description="Não há vendas, devoluções ou recebimentos de vendedores com percentual cadastrado neste recorte. Confira os percentuais em Vendas › Vendedores." />
            </Card>
          ) : (
            <div className="space-y-4">
              {report.sellers.map((sc) => (
                <Card
                  key={sc.sellerId}
                  className="break-inside-avoid"
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {sc.sellerName}
                      {sc.loginDisabled && <Badge tone="warn">sem acesso</Badge>}
                      <span className="text-xs font-normal text-slate-500">
                        {sc.rateBps == null ? "sem percentual geral" : `${formatBps(sc.rateBps)} geral`}
                        {sc.hasCategoryRates ? " · percentuais por categoria" : ""}
                      </span>
                    </span>
                  }
                  actions={
                    sc.closing ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/financeiro/pagar/${sc.closing.titleId}`} className="text-sm text-brand-700 hover:underline">
                          Título nº {sc.closing.number}
                        </Link>
                        <StatusBadge kind="title" status={sc.closing.status} />
                        {!print && sc.closing.status === "open" && sc.closing.balance === sc.closing.total && (
                          <ActionButton
                            action={reopenCommissionAction.bind(null, sc.closing.titleId)}
                            label="Reabrir"
                            icon={<RotateCcw className="size-4" aria-hidden />}
                            askReason={`Reabrir a comissão de ${sc.sellerName}? O título a pagar nº ${sc.closing.number} será cancelado. Informe o motivo:`}
                            variant="ghost"
                            size="sm"
                          />
                        )}
                      </span>
                    ) : null
                  }
                  bodyClass="p-0"
                >
                  {sc.lines.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-500">Sem eventos no período.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base w-full text-sm">
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Evento</th>
                            <th>Venda</th>
                            <th className="hidden md:table-cell">Cliente</th>
                            <th className="text-right">Base</th>
                            <th className="text-right">%</th>
                            <th className="text-right">Comissão</th>
                            <th>Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sc.lines.map((l) => (
                            <tr key={l.key} className={l.closedIn ? "text-slate-400" : undefined}>
                              <td className="whitespace-nowrap">{formatDate(l.date)}</td>
                              <td>
                                <Badge tone={KIND_TONE[l.kind]}>{COMMISSION_LINE_LABEL[l.kind]}</Badge>
                                {l.docNumber != null && <span className="ml-1 text-xs">nº {l.docNumber}</span>}
                                {l.note && <span className="block text-xs text-slate-500">{l.note}</span>}
                              </td>
                              <td className="whitespace-nowrap">
                                {print ? (
                                  `nº ${l.saleNumber ?? "—"}`
                                ) : (
                                  <Link href={`/vendas/${l.saleId}`} className="text-brand-700 hover:underline">
                                    nº {l.saleNumber ?? "—"}
                                  </Link>
                                )}
                              </td>
                              <td className="hidden max-w-[200px] truncate md:table-cell">{l.customerName ?? "Consumidor"}</td>
                              <td className="tabular whitespace-nowrap text-right">{formatMoney(l.base)}</td>
                              <td className="tabular whitespace-nowrap text-right">{l.rateBps == null ? "—" : formatBps(l.rateBps)}</td>
                              <td className={`tabular whitespace-nowrap text-right font-medium ${l.amount < 0 ? "text-red-700" : ""}`}>{formatMoney(l.amount)}</td>
                              <td className="whitespace-nowrap text-xs">{l.closedIn ? (l.closedIn.otherBase ? `Fechada (outro critério) nº ${l.closedIn.number}` : `Fechada nº ${l.closedIn.number}`) : "A fechar"}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold">
                            <td colSpan={4} className="hidden md:table-cell">A fechar</td>
                            <td colSpan={3} className="md:hidden">A fechar</td>
                            <td className="tabular text-right">{formatMoney(sc.openBase)}</td>
                            <td />
                            <td className="tabular text-right">{formatMoney(sc.openAmount)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                  {!print && !sc.closing && sc.openAmount > 0 && (
                    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                      <p className="text-sm text-slate-600">
                        A pagar a {sc.sellerName}: <strong className="text-ink">{formatMoney(sc.openAmount)}</strong>
                      </p>
                      <CloseCommissionForm from={report.from} to={report.to} branchId={report.branchId} sellerId={sc.sellerId} sellerName={sc.sellerName} base={report.base} amountLabel={formatMoney(sc.openAmount)} defaultDue={defaultDue} />
                    </div>
                  )}
                  {!print && !sc.closing && sc.openAmount < 0 && (
                    <p className="no-print border-t border-line px-4 py-2 text-xs text-slate-500">Saldo negativo (devoluções/estornos maiores que as vendas): amplie o período para compensar antes de fechar.</p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );

  if (print) {
    return (
      <div className="flex flex-col gap-4">
        <PrintStyles paper="A4" />
        <div className="no-print flex gap-2">
          <AutoPrint enabled />
          <Link href={`/vendas/comissoes${qs({ print: null }, params)}`} className={buttonClass("secondary")}>
            Voltar
          </Link>
        </div>
        <article className="print-doc space-y-3 bg-white p-4 text-black" aria-label="Relatório de comissões">
          <header className="border-b border-black pb-2">
            <h1 className="text-lg font-bold">Relatório de comissões de vendedores</h1>
            <p className="text-sm">
              {s.company.tradeName || s.company.name} · {scopeLabel} · {formatDate(q.from)} a {formatDate(q.to)} · Critério: {report ? COMMISSION_BASE_LABEL[report.base] : "—"}
            </p>
            <p className="text-xs">Emitido em {formatDateTime(new Date().toISOString())} por {s.user.name}</p>
          </header>
          {body}
        </article>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Comissões de vendedores"
        crumbs={[{ label: "Vendas" }, { label: "Comissões" }]}
        description="Apuração por período, filial e vendedor sobre as vendas concluídas. O fechamento gera a conta a pagar ao vendedor no Financeiro; reabrir só cancela o título enquanto ele estiver em aberto."
        actions={
          <>
            <Link href={printHref} className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden /> Imprimir
            </Link>
            {canDo(s.user, "data.export") && (
              <a className={buttonClass("secondary")} href={exportHref}>
                <Download className="size-4" aria-hidden /> Exportar CSV
              </a>
            )}
          </>
        }
      />
      <div className="no-print mb-4 rounded-lg border border-line bg-white p-3">
        <form method="get" action="/vendas/comissoes" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            De
            <input type="date" name="de" defaultValue={q.from} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Até
            <input type="date" name="ate" defaultValue={q.to} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          {accessible.length > 1 && (
            <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-slate-600">
              Filial
              <select name="filial" defaultValue={q.branchId ?? ""} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm">
                <option value="">{fullAccess ? "Todas as filiais" : "Todas as suas filiais"}</option>
                {accessible.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-slate-600">
            Vendedor
            <select name="vendedor" defaultValue={q.sellerId ?? ""} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm">
              <option value="">Todos com comissão</option>
              {sellers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.loginDisabled ? " (sem acesso)" : ""}
                  {v.active ? "" : " — inativo"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-slate-600">
            Critério
            <select name="base" defaultValue={sp(params, "base")} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm">
              <option value="">Padrão da empresa{report ? ` (${COMMISSION_BASE_LABEL[report.base].toLowerCase()})` : ""}</option>
              <option value="invoiced">{COMMISSION_BASE_LABEL.invoiced}</option>
              <option value="received">{COMMISSION_BASE_LABEL.received}</option>
            </select>
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Apurar
          </button>
          <span className="flex flex-wrap gap-1">
            <Link href={periodLink(prevMonth)} className={buttonClass("ghost", "sm")}>
              Mês anterior
            </Link>
            <Link href={periodLink(thisMonth)} className={buttonClass("ghost", "sm")}>
              Mês atual
            </Link>
          </span>
        </form>
      </div>
      <div className="grid gap-4 2xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 2xl:col-span-2">{body}</div>
        <div className="space-y-4">
          <Card title="Fechamentos no período" description="Títulos a pagar gerados para os vendedores (mais recentes primeiro)." bodyClass="p-0">
            {closings.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">Nenhum fechamento que alcance este período.</p>
            ) : (
              <ul className="divide-y divide-line">
                {closings.map((c) => (
                  <li key={c.titleId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{c.sellerName}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDate(c.from)} a {formatDate(c.to)} · {c.branchId ? (branchName.get(c.branchId) ?? "Filial") : "Todas as filiais"} · {c.base === "received" ? "recebido" : "faturado"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular">{formatMoney(c.total)}</span>
                      <Link href={`/financeiro/pagar/${c.titleId}`} className="text-brand-700 hover:underline">
                        nº {c.number}
                      </Link>
                      <StatusBadge kind="title" status={c.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Como a comissão é apurada">
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
              <li>Vendedor da venda (ou o operador, quando não informado) e percentual do cadastro em Vendas › Vendedores — o da categoria do produto prevalece sobre o geral.</li>
              <li>Faturada: valor líquido dos itens (após descontos, sem acréscimos/juros) na data da venda; devoluções abatem proporcionalmente na data da devolução.</li>
              <li>Recebida: à vista na data da venda; a prazo, conforme as parcelas recebidas no período.</li>
              <li>Venda cancelada não conta; se já estava fechada, o estorno entra no período do cancelamento.</li>
              <li>O que já foi fechado aparece em cinza e não é pago de novo, mesmo em períodos sobrepostos.</li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Critério padrão em Administração › Parâmetros › Vendas e PDV. <Link href="/vendas/vendedores" className="text-brand-700 hover:underline">Percentuais dos vendedores</Link>
            </p>
          </Card>
          <Card title="Histórico">
            <Timeline store={s.ctx.store} refs={[`commissions:${s.ctx.companyId}`]} limit={15} />
          </Card>
        </div>
      </div>
    </>
  );
}
