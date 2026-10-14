import { Fragment } from "react";
import Link from "@/components/ui/link";
import { Download, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatBps, formatMoney, roundDiv } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { paginate, parseList, qs, sp, type SearchParams } from "@/lib/list";
import { canDo } from "@/lib/permissions";
import { AGING_BUCKETS, computeAging, computeDre, dreRows, type AgingItem } from "@/domain/finance-reports";
import { AutoPrint } from "@/app/(app)/vendas/sale-widgets";
import { HowWeCalculate, PrintHeader, PrintStyles, ReportFilters, ScopeLine } from "../_components/report-ui";
import { reportQs } from "../params";
import { financeReportParams } from "./params";

export const metadata = { title: "Relatórios financeiros" };

const ORIGIN: Record<string, string> = { sale: "Venda a prazo", sale_card: "Recebível de cartão", manual: "Lançamento manual", purchase_receipt: "Compra", fiscal_document: "Documento fiscal", commission: "Comissão", renegotiation: "Renegociação" };

/** FIN-22 — DRE gerencial por competência e aging de contas a receber/pagar (filtros na URL, impressão e CSV). */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  await requireFeaturePage(s, "dre");
  const params = await searchParams;
  const fp = await financeReportParams(s, params);
  const print = sp(params, "print") === "1";
  const base = "/relatorios/financeiros";
  const keepQs = reportQs(params);
  const canExport = canDo(s.user, "data.export");
  const company = String(s.company.tradeName || s.company.name);
  const title = fp.aba === "dre" ? "DRE gerencial" : fp.aba === "receber" ? "Aging — contas a receber" : "Aging — contas a pagar";
  const exportHref = fp.aba === "dre" ? `/api/export/fin-dre${qs({ page: null, print: null }, params)}` : `/api/export/fin-aging${qs({ page: null, print: null, aba: fp.aba }, params)}`;
  return (
    <>
      <PrintStyles />
      <PrintHeader title={fp.aba === "dre" ? title : `${title} — posição em ${formatDate(fp.ref)}`} company={company} user={s.user.name} rp={fp} />
      <PageHeader
        title="Relatórios financeiros"
        crumbs={[{ label: "Financeiro" }, { label: "Relatórios financeiros" }]}
        description="DRE gerencial pelo regime de competência (plano de contas e custo das vendas) e aging das contas a receber e a pagar por faixa de atraso."
        actions={
          <>
            {print ? (
              <AutoPrint enabled />
            ) : (
              <Link href={`${base}${qs({ print: "1", page: null }, params)}`} className={buttonClass("secondary")}>
                <Printer className="size-4" aria-hidden /> Imprimir
              </Link>
            )}
            {canExport && (
              <a className={buttonClass("secondary")} href={exportHref}>
                <Download className="size-4" aria-hidden /> Exportar CSV
              </a>
            )}
          </>
        }
      />
      <LinkTabs
        basePath={`${base}${keepQs}`}
        param="aba"
        active={fp.aba}
        tabs={[
          { key: "dre", label: "DRE gerencial" },
          { key: "receber", label: "Aging — a receber" },
          { key: "pagar", label: "Aging — a pagar" },
        ]}
      />
      {fp.aba === "dre" ? <Dre s={s} fp={fp} params={params} company={company} /> : <Aging s={s} fp={fp} params={params} print={print} company={company} />}
    </>
  );
}

type FP = Awaited<ReturnType<typeof financeReportParams>>;
type S = Awaited<ReturnType<typeof requireSession>>;

async function Dre({ s, fp, params, company }: { s: S; fp: FP; params: SearchParams; company: string }) {
  const r = await computeDre(s.ctx, { from: fp.period.from, to: fp.period.to, branchIds: fp.domainBranchIds });
  const rows = dreRows(r);
  const firstOutside = rows.findIndex((x) => x.kind === "outside");
  const gross = r.sections.find((x) => x.key === "Receita bruta")!.total;
  const showMonths = r.months.length > 1 && r.months.length <= 12;
  const av = (v: number) => (gross > 0 ? formatBps(roundDiv(v * 10000, gross), 1) : "—");
  const money = (v: number | undefined) => (v ? formatMoney(v) : <span className="text-slate-400">—</span>);
  return (
    <>
      <ReportFilters basePath="/relatorios/financeiros" params={params} rp={fp} keep={["aba"]} help="Competência: títulos pela data de competência, vendas à vista e tarifas pela data do lançamento, devoluções pela data do movimento; CMV pela data de cada venda/devolução. Datas inclusivas, horário de Brasília." />
      <ScopeLine rp={fp} company={company} />
      {r.counts.unclassified > 0 && (
        <div className="no-print mb-4">
          <Notice tone="warn" title="Categorias sem grupo do DRE">
            {r.counts.unclassified} lançamento(s) sem grupo no plano de contas foram classificados pela origem (vendas → receita bruta; tarifas → despesas financeiras; demais → outras receitas/despesas). Defina o grupo em <Link className="underline" href="/financeiro/cadastros?tab=categorias">Financeiro › Cadastros › Categorias</Link>.
          </Notice>
        </div>
      )}
      <Card bodyClass="p-0">
        {r.counts.items === 0 && r.check.cmv === 0 ? (
          <EmptyState title="Sem movimento no período" description="Nenhum título, lançamento ou venda com competência no recorte." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th className="min-w-[260px]">Demonstração do resultado</th>
                  {showMonths && r.months.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}
                  <th className="text-right">Total</th>
                  <th className="text-right" title="Análise vertical: % da receita bruta">% RB</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const outside = firstOutside >= 0 && i >= firstOutside;
                  return (
                    <Fragment key={i}>
                      {i === firstOutside && (
                        <tr>
                          <td colSpan={(showMonths ? r.months.length : 0) + 3} className="bg-slate-50 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Fora do resultado (informativo)
                          </td>
                        </tr>
                      )}
                      <tr className={cn(row.kind === "subtotal" && "bg-brand-50/60 font-semibold", (row.kind === "section" || row.kind === "outside") && "font-medium")}>
                        <td style={{ paddingLeft: row.level === 2 ? "2rem" : undefined }} className={cn(row.level === 2 && "text-slate-600")}>
                          {row.label}
                        </td>
                        {showMonths && r.months.map((m) => <td key={m.key} className="tabular text-right">{money(row.months[m.key])}</td>)}
                        <td className={cn("tabular text-right", row.total < 0 && row.kind === "subtotal" && "text-red-700")}>{row.kind === "line" ? money(row.total) : formatMoney(row.total)}</td>
                        <td className="tabular text-right text-xs text-slate-500">{outside ? "" : av(row.total)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Resultado pela competência" value={formatMoney(r.check.competenceResult)} hint="Mesmo total da visão Competência do fluxo de caixa" href={`/financeiro/fluxo-caixa?tab=competencia&from=${fp.period.from}&to=${fp.period.to}`} />
        <Stat label="(−) Fora do resultado" value={formatMoney(r.check.outsideTotal)} hint="Compras de mercadorias (estoque) e investimentos" />
        <Stat label="(−) CMV" value={formatMoney(r.check.cmv)} hint="Custo registrado nas vendas − custo das devoluções" />
        <Stat label="(=) Resultado do DRE" value={formatMoney(r.check.result)} tone={r.check.difference === 0 ? (r.check.result >= 0 ? "good" : "bad") : "warn"} hint={r.check.difference === 0 ? "Conferido com a competência (diferença zero)" : `Diferença de ${formatMoney(r.check.difference)}`} />
      </div>
      <HowWeCalculate
        items={[
          ["Base", "Os mesmos itens da visão “Competência” do Fluxo de caixa: títulos (exceto cancelados e renegociações) pela data de competência; vendas à vista, cancelamentos, devoluções pagas e tarifas pela data do lançamento; abatimentos de devolução pela data do abatimento."],
          ["Grupos", "Cada valor entra no grupo do DRE da sua categoria; categoria sem grupo usa o da categoria pai (plano de contas em hierarquia). Sem grupo nenhum: vendas → receita bruta, tarifas → despesas financeiras, compras → fora do resultado, demais → outras receitas/despesas."],
          ["Deduções", "Categorias do grupo “Deduções” (ex.: impostos sobre vendas) e as devoluções de vendas (reembolsadas ou abatidas do título)."],
          ["CMV", "Custo histórico registrado em cada item vendido (custo médio no momento da venda) menos o custo dos itens devolvidos — o mesmo dos relatórios gerenciais. As compras de mercadorias (categorias do grupo CMV) vão para o estoque e aparecem só como informação."],
          ["Conferência", "Resultado do DRE = resultado pela competência − itens fora do resultado − CMV. A diferença exibida deve ser sempre zero."],
          ["Filial", "Pela filial do título ou do lançamento; no consolidado, toda a empresa."],
        ]}
      />
    </>
  );
}

async function Aging({ s, fp, params, print, company }: { s: S; fp: FP; params: SearchParams; print: boolean; company: string }) {
  const kind = fp.aba === "pagar" ? "payable" : "receivable";
  const r = await computeAging(s.ctx, { kind, ref: fp.ref, branchIds: fp.domainBranchIds, bucket: fp.faixa });
  const base = "/relatorios/financeiros";
  const lp = parseList(params, { sort: "daysLate", dir: "desc", pageSize: print ? 200 : 50 });
  const { rows, total } = print ? { rows: r.items, total: r.items.length } : paginate(r.items as Array<AgingItem & { id?: string }>, lp);
  const tableRows = rows.map((x) => ({ ...x, id: x.installmentId }));
  const titleHref = (titleId: string) => `/financeiro/${kind === "receivable" ? "receber" : "pagar"}/${titleId}`;
  const bucketLabel = (k: string) => AGING_BUCKETS.find((b) => b.key === k)?.label ?? k;
  const columns: Column<(typeof tableRows)[number]>[] = [
    { key: "partyName", label: kind === "receivable" ? "Cliente / pagador" : "Fornecedor / favorecido", sortable: true, fixed: true, cell: (x) => <span className="font-medium">{x.partyName}</span> },
    { key: "titleNumber", label: "Título / parcela", cell: (x) => <Link className="whitespace-nowrap text-brand-700 hover:underline" href={titleHref(x.titleId)}>nº {x.titleNumber ?? "—"} · {x.number}/{x.installments}</Link> },
    { key: "description", label: "Descrição", hidden: true, cell: (x) => <span className="text-xs">{x.description}</span> },
    { key: "originType", label: "Origem", hidden: true, cell: (x) => ORIGIN[x.originType ?? ""] ?? x.originType ?? "—" },
    { key: "dueDate", label: "Vencimento", sortable: true, cell: (x) => formatDate(x.dueDate) },
    { key: "daysLate", label: "Dias de atraso", align: "right", sortable: true, cell: (x) => (x.daysLate > 0 ? <span className="font-medium text-red-700">{x.daysLate}</span> : <span className="text-slate-500">{x.daysLate === 0 ? "vence hoje" : `vence em ${-x.daysLate}`}</span>) },
    { key: "bucket", label: "Faixa", cell: (x) => <Badge tone={x.bucket === "current" ? "good" : x.bucket === "d1_30" ? "warn" : "bad"}>{bucketLabel(x.bucket)}</Badge> },
    { key: "balance", label: "Saldo em aberto", align: "right", sortable: true, cell: (x) => formatMoney(x.balance) },
  ];
  return (
    <>
      <form method="get" action={base} className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
        <input type="hidden" name="aba" value={fp.aba} />
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Posição em
          <input type="date" name="ref" defaultValue={fp.ref} className={cn(inputClass, "h-9")} />
        </label>
        {fp.branchOptions.length > 1 && (
          <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-slate-600">
            Filial
            <select name="filial" defaultValue={fp.filial} className={cn(inputClass, "h-9")}>
              {fp.branchOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-slate-600">
          Faixa
          <select name="faixa" defaultValue={fp.faixa ?? ""} className={cn(inputClass, "h-9")}>
            <option value="">Todas</option>
            {AGING_BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass("primary")}>
          Aplicar
        </button>
        <Link href={`${base}?aba=${fp.aba}`} className={buttonClass("ghost")}>
          Limpar
        </Link>
        <p className="basis-full text-xs text-slate-500">Saldo atual de cada parcela em aberto (inclusive parciais), classificado pelos dias de atraso na data da posição. Títulos cancelados e parcelas quitadas ou renegociadas não entram.</p>
      </form>
      <p className="mb-3 text-xs text-slate-500">
        <strong className="font-semibold text-slate-700">Empresa:</strong> {company} · <strong className="font-semibold text-slate-700">Filial:</strong> {fp.branchName} · <strong className="font-semibold text-slate-700">Posição em:</strong> {formatDate(fp.ref)}
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {AGING_BUCKETS.map((b) => (
          <Stat key={b.key} label={b.label} value={formatMoney(r.totals[b.key])} hint={`${r.counts[b.key]} parcela(s)`} tone={b.key === "current" ? "default" : b.key === "d1_30" ? "warn" : r.totals[b.key] ? "bad" : "default"} href={`${base}${qs({ faixa: fp.faixa === b.key ? null : b.key, page: null, print: null }, params)}`} />
        ))}
        <Stat label="Total em aberto" value={formatMoney(r.totals.total)} hint={`Vencido: ${formatMoney(r.totals.overdue)}`} />
      </div>
      <Card title={kind === "receivable" ? "Por cliente" : "Por fornecedor"} bodyClass="p-0" className="mb-4">
        {r.rows.length === 0 ? (
          <EmptyState title="Nada em aberto nesta posição" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>{kind === "receivable" ? "Cliente / pagador" : "Fornecedor / favorecido"}</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b.key} className="text-right">
                      {b.label}
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                  <th className="text-right">Maior atraso</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.slice(0, print ? 1000 : 100).map((row) => (
                  <tr key={row.partyKey}>
                    <td className="font-medium">
                      {row.partyName}
                      <span className="block text-xs font-normal text-slate-500">{row.count} parcela(s)</span>
                    </td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b.key} className={cn("tabular text-right", !row.buckets[b.key] && "text-slate-400")}>
                        {row.buckets[b.key] ? formatMoney(row.buckets[b.key]) : "—"}
                      </td>
                    ))}
                    <td className="tabular text-right font-semibold">{formatMoney(row.total)}</td>
                    <td className="tabular text-right">{row.maxDaysLate > 0 ? `${row.maxDaysLate} dia(s)` : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>Total</td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b.key} className="tabular text-right">
                      {formatMoney(r.totals[b.key])}
                    </td>
                  ))}
                  <td className="tabular text-right">{formatMoney(r.totals.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {!print && r.rows.length > 100 && <p className="px-4 py-2 text-xs text-slate-500">Mostrando os 100 maiores saldos de {r.rows.length}. A exportação traz todas as parcelas.</p>}
          </div>
        )}
      </Card>
      <DataTable
        id={`fin-aging-${kind}`}
        basePath={base}
        params={params}
        columns={columns}
        rows={tableRows}
        total={total}
        page={print ? 1 : lp.page}
        pageSize={print ? Math.max(1, total) : lp.pageSize}
        totals={{ balance: formatMoney(r.totals.total) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma parcela em aberto no recorte.</div>}
      />
    </>
  );
}
