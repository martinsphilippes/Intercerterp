import Link from "next/link";
import { AlertTriangle, Ban, BookOpen, CalendarClock, Download, FileArchive, Receipt, Scale, Send } from "lucide-react";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { FilterBar } from "@/components/ui/filters";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, Notice } from "@/components/ui/empty";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, FormGrid, Input, Checkbox } from "@/components/ui/form";
import { paginate, parseList, qs, sp, type SearchParams } from "@/lib/list";
import { formatBps, formatMoney, formatQty, roundDiv } from "@/lib/money";
import { addMonths, diffDays, formatDate, formatDateTime, formatMonth, monthStart, toLocalDate, today, dayRange } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { DOC_STATUS_LABEL, MODEL_LABEL } from "@/domain/fiscal/service";
import { isRevenue, periodDocuments, summarize, sumBy } from "@/domain/fiscal/reports";
import { getAccountingSchedule, packageHistory } from "@/domain/fiscal/export";
import { displayStatus, getTemplates, listObligations, OBLIGATION_KIND_LABEL, OBLIGATION_STATUS_LABEL, OBLIGATION_SUPPORT } from "@/domain/fiscal/obligations";
import { getIntegration } from "@/domain/integrations";
import { bookRows, cancelRows, cfopRows, monthOptions, ncmRows, periodDocRows, previousFilter, rejectRows, reportFilter, serviceRows } from "./queries";
import { StackedByModel } from "./charts";
import { CompleteObligationButton, NewObligationButton, TemplatesEditor } from "./obligation-ui";
import { deleteObligationAction, generateObligationsAction, generatePackageAction, obligationStatusAction, saveScheduleAction } from "../actions";
import { FormDialogButton } from "../_components/form-dialog";

export const metadata = { title: "Relatórios fiscais" };

const TABS = [
  { key: "resumo", label: "Resumo" },
  { key: "documentos", label: "Documentos do período" },
  { key: "livro", label: "Livro de saídas" },
  { key: "ncm", label: "Tributos por NCM" },
  { key: "cancelamentos", label: "Cancelamentos" },
  { key: "rejeicoes", label: "Rejeições" },
  { key: "contabil", label: "Resumo contábil" },
  { key: "exportacao", label: "Exportação à contabilidade" },
  { key: "obrigacoes", label: "Obrigações" },
];

const pctChange = (cur: number, prev: number) => (prev ? roundDiv((cur - prev) * 10000, prev) : null);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  const params = await searchParams;
  const tab = sp(params, "tab") || "resumo";
  const f = reportFilter(s.ctx, params);
  const p = parseList(params, { sort: null as any, pageSize: 50 });
  const branches = s.consolidated ? await lookups.branches(s.ctx) : [];
  const base = `/fiscal/relatorios${qs({ tab: null, page: null, sort: null, dir: null, crit: null }, params)}`;
  const withTab = (t: string, extra: Record<string, string | null> = {}) => `/fiscal/relatorios${qs({ tab: t, page: null, ...extra }, params)}`;
  const periodLabel = f.period ? formatMonth(f.period) : `${formatDate(f.from)} a ${formatDate(f.to)}`;
  return (
    <>
      <PageHeader
        title="Relatórios fiscais e obrigações"
        crumbs={[{ label: "Fiscal" }, { label: "Relatórios e obrigações" }]}
        description={`Documentos, impostos e entregas fiscais — ${periodLabel}${s.consolidated ? " · todas as filiais" : ` · ${s.branch?.name}`}. Cada total informa os estados incluídos.`}
        actions={
          <>
            <Link href={withTab("exportacao")} className={buttonClass("secondary")}><CalendarClock className="size-4" /> Agendar envio</Link>
            <Link href={withTab("exportacao")} className={buttonClass("accent")}><Download className="size-4" /> Exportar</Link>
          </>
        }
      />
      <FilterBar
        basePath="/fiscal/relatorios"
        values={{ ...params, period: f.period ?? "" }}
        filters={[
          { type: "select", name: "period", label: "Período", options: monthOptions(), all: "Mês corrente" },
          ...(s.consolidated ? [{ type: "select" as const, name: "branch", label: "Empresa / filial", options: branches, all: "Todas as filiais" }] : []),
          { type: "select", name: "model", label: "Documento", options: [{ value: "nfe", label: "NF-e (modelo 55)" }, { value: "nfce", label: "NFC-e (modelo 65)" }, { value: "nfse", label: "NFS-e (serviços)" }], all: "Todos os documentos" },
          { type: "select", name: "sim", label: "Simulação", options: [{ value: "0", label: "Excluir documentos simulados" }], all: "Incluir (identificados)" },
        ]}
      >
        <input type="hidden" name="tab" value={tab} />
      </FilterBar>
      <LinkTabs basePath={base} active={tab} tabs={TABS} />
      {tab === "resumo" && <Summary s={s} f={f} withTab={withTab} />}
      {tab === "documentos" && <DocsTab s={s} params={params} p={p} />}
      {tab === "livro" && <SimpleTable id="fiscal-livro" exportKey="fiscal-livro-saidas" params={params} p={p} rows={await bookRows(s.ctx, params)} kind="book" />}
      {tab === "ncm" && <SimpleTable id="fiscal-ncm" exportKey="fiscal-ncm" params={params} p={p} rows={await ncmRows(s.ctx, params)} kind="ncm" />}
      {tab === "cancelamentos" && <SimpleTable id="fiscal-cancel" exportKey="fiscal-cancelamentos" params={params} p={p} rows={await cancelRows(s.ctx, params)} kind="cancel" />}
      {tab === "rejeicoes" && <SimpleTable id="fiscal-rej" exportKey="fiscal-rejeicoes" params={params} p={p} rows={await rejectRows(s.ctx, params)} kind="reject" />}
      {tab === "contabil" && <AccountingTab s={s} params={params} f={f} />}
      {tab === "exportacao" && <ExportTab s={s} f={f} />}
      {tab === "obrigacoes" && <ObligationsTab s={s} f={f} />}
    </>
  );
}

async function Summary({ s, f, withTab }: { s: any; f: any; withTab: (t: string, e?: Record<string, string | null>) => string }) {
  const docs = await periodDocuments(s.ctx, f);
  const sum = summarize(docs, f);
  const pf = previousFilter(f);
  const prev = summarize(await periodDocuments(s.ctx, pf), pf);
  const ch = pctChange(sum.gross, prev.gross);
  const issued = docs.filter((d) => ["authorized", "cancelled"].includes(d.status));
  const approx = sumBy(docs.filter(isRevenue), (d) => d.totals?.approxTax ?? 0) + sum.taxes.iss;
  const cancelled = docs.filter((d) => d.status === "cancelled").length;
  const rejected = docs.filter((d) => ["rejected", "denied"].includes(d.status)).length;
  // série de 6 meses (quantidade emitida: autorizados + cancelados)
  const sixFrom = addMonths(monthStart(f.to), -5);
  const six = await periodDocuments(s.ctx, { ...f, from: sixFrom, to: f.to });
  const months = Array.from({ length: 6 }, (_, i) => addMonths(sixFrom, i).slice(0, 7));
  const monthly = months.map((m) => {
    const r: Record<string, any> = { month: formatMonth(m), nfe: 0, nfce: 0, nfse: 0 };
    for (const d of six) if (["authorized", "cancelled"].includes(d.status) && toLocalDate(d.issuedAt).startsWith(m)) r[d.model]++;
    return r;
  });
  const daily = sum.daily.map((d) => ({ ...d, day: d.date.slice(8, 10) + "/" + d.date.slice(5, 7) }));
  const byModel = (["nfe", "nfce", "nfse"] as const).filter((m) => !f.model || f.model === m).map((m) => {
    const md = docs.filter((d) => d.model === m);
    const rej = md.filter((d) => ["rejected", "denied"].includes(d.status)).length;
    const pend = md.filter((d) => ["draft", "pending", "queued", "processing", "error"].includes(d.status)).length;
    return { m, issued: md.filter((d) => ["authorized", "cancelled"].includes(d.status)).length, value: sumBy(md.filter(isRevenue), (d) => d.total), cancelled: md.filter((d) => d.status === "cancelled").length, rej, pend };
  });
  const obligations = (await listObligations(s.ctx, {})).filter((o) => o.status !== "done" || (o.deliveredAt ?? "").slice(0, 7) >= f.from.slice(0, 7)).slice(0, 6);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faturamento fiscal" value={formatMoney(sum.gross)} hint={<span>{ch == null ? "Sem base no período anterior" : <span className={ch >= 0 ? "text-emerald-700" : "text-red-700"}>{ch >= 0 ? "↑" : "↓"} {formatBps(Math.abs(ch), 1)} sobre {formatDate(pf.from)}–{formatDate(pf.to)}</span>} · autorizadas de saída{sum.returns ? ` · devoluções ${formatMoney(sum.returns)}` : ""}</span>} href={withTab("documentos", { crit: "revenue" })} tone="good" />
        <Stat label="Documentos emitidos" value={issued.length.toLocaleString("pt-BR")} hint={`${sum.revenueCount + sum.returnsCount} autorizados · ${cancelled} cancelados (autorizados + cancelados)`} href={withTab("documentos", { crit: "issued" })} />
        <Stat label="Tributos estimados" value={formatMoney(approx)} hint={sum.gross ? `${formatBps(roundDiv(approx * 10000, sum.gross))} do faturamento · ICMS ${formatMoney(sum.taxes.icms)} · ISS ${formatMoney(sum.taxes.iss)}` : "Sem faturamento"} href={withTab("contabil")} />
        <Stat label="Pendências fiscais" value={sum.pendingCount} hint={`${rejected} rejeição(ões) · ${sum.pendingCount - rejected} sem retorno/pendentes · cancelamentos (${cancelled}) não são pendência`} href={withTab("documentos", { crit: "pending" })} tone={sum.pendingCount ? "warn" : "default"} />
      </div>
      {sum.simulatedCount > 0 && <Notice tone="sim">{sum.simulatedCount} documento(s) do período são de SIMULAÇÃO — sem validade fiscal; aparecem identificados em todos os relatórios e no pacote. Use o filtro “Simulação” para excluí-los.</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Emissões por período" description="Quantidade de documentos autorizados + cancelados, últimos 6 meses">
          <StackedByModel data={monthly} xKey="month" />
          <table className="mt-2 w-full text-xs text-slate-600">
            <thead><tr><th className="text-left">Mês</th><th className="text-right">NF-e</th><th className="text-right">NFC-e</th><th className="text-right">NFS-e</th></tr></thead>
            <tbody>{monthly.map((r) => <tr key={r.month}><td>{r.month}</td><td className="tabular text-right">{r.nfe}</td><td className="tabular text-right">{r.nfce}</td><td className="tabular text-right">{r.nfse}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Obrigações e prazos" actions={<Link className="text-xs text-brand-700 underline" href={withTab("obrigacoes")}>Calendário</Link>}>
          {obligations.length === 0 ? (
            <EmptyState title="Sem obrigações cadastradas" description="Gere as obrigações do calendário na aba Obrigações." />
          ) : (
            <ul className="space-y-3">
              {obligations.map((o) => {
                const d = diffDays(today(), o.dueDate);
                return (
                  <li key={o.id}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{o.name} <span className="text-xs text-slate-500">({o.period})</span></span>
                      <StatusBadge kind="obligation" status={o.display} />
                    </div>
                    <p className="text-xs text-slate-500">{o.status === "done" ? `Concluída em ${formatDate(o.deliveredAt)}${o.proofFileId || o.exportFileId ? " · com comprovação" : ""}` : d < 0 ? `Venceu há ${-d} dia(s) (${formatDate(o.dueDate)})` : d === 0 ? "Vence hoje" : `Vence em ${d} dia(s) (${formatDate(o.dueDate)})`}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Vencimentos são parâmetros da empresa (calendário editável), não prazos legais universais.</p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Resumo por documento" actions={<Link href={withTab("documentos")} className={buttonClass("secondary", "sm")}>Ver detalhamento</Link>} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Documento</th><th className="text-right">Emitidos</th><th className="text-right">Valor autorizado</th><th className="text-right">Cancelados</th><th>Situação</th></tr></thead>
            <tbody>
              {byModel.map((r) => (
                <tr key={r.m}>
                  <td><Link className="font-medium text-brand-700 hover:underline" href={`/fiscal/${r.m}?from=${f.from}&to=${f.to}`}>{MODEL_LABEL[r.m]}</Link><span className="block text-xs text-slate-500">{r.m === "nfe" ? "Modelo 55" : r.m === "nfce" ? "Modelo 65" : "Serviços"}</span></td>
                  <td className="tabular text-right">{r.issued}</td>
                  <td className="tabular text-right">{formatMoney(r.value)}</td>
                  <td className="tabular text-right">{r.cancelled}</td>
                  <td>{r.rej ? <Link href={`/fiscal/${r.m}?status=rejected,denied&from=${f.from}&to=${f.to}`}><Badge tone="warn">{r.rej} rejeição(ões)</Badge></Link> : r.pend ? <Badge tone="info">{r.pend} pendente(s)</Badge> : <Badge tone="good">Regular</Badge>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold"><td className="px-3 py-2">Total</td><td className="tabular px-3 text-right">{sumBy(byModel, (r) => r.issued)}</td><td className="tabular px-3 text-right">{formatMoney(sumBy(byModel, (r) => r.value))}</td><td className="tabular px-3 text-right">{sumBy(byModel, (r) => r.cancelled)}</td><td /></tr></tfoot>
          </table>
        </Card>
        <Card title="Relatórios rápidos">
          <div className="grid grid-cols-2 gap-2">
            {[
              { t: "livro", label: "Livro de saídas", icon: BookOpen },
              { t: "ncm", label: "Tributos por NCM", icon: Receipt },
              { t: "cancelamentos", label: "Cancelamentos", icon: Ban },
              { t: "rejeicoes", label: "Rejeições", icon: AlertTriangle },
              { t: "exportacao", label: "XML do período", icon: FileArchive },
              { t: "contabil", label: "Resumo contábil", icon: Scale },
            ].map((x) => (
              <Link key={x.t} href={withTab(x.t)} className="focus-ring flex items-center gap-2 rounded-md border border-line px-3 py-3 text-sm hover:border-brand-300 hover:bg-brand-50">
                <x.icon className="size-4 text-brand-700" /> {x.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Faturamento autorizado por dia" description={`Notas autorizadas de saída (exceto devoluções), por data de emissão — ${formatDate(f.from)} a ${formatDate(f.to)}`}>
        <StackedByModel data={daily} xKey="day" money height={220} />
      </Card>
      <Card title="Critério dos totais (estados incluídos e excluídos)">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="text-sm">
            <p className="font-medium text-emerald-800">Entram no faturamento</p>
            <p className="text-slate-600">Autorizadas de saída (NF-e, NFC-e, NFS-e), exceto finalidade devolução: {sum.revenueCount} documento(s), {formatMoney(sum.gross)}. Devoluções de venda autorizadas (entrada) são deduzidas no líquido: {formatMoney(sum.net)}.</p>
            <p className="mt-2 font-medium text-slate-700">Ficam fora</p>
            <p className="text-slate-600">Canceladas, rejeitadas, denegadas, descartadas, rascunhos, pendentes, na fila, processando e com erro.</p>
          </div>
          <table className="table-base w-full text-sm">
            <thead><tr><th>Situação</th><th className="text-right">Qtd</th><th className="text-right">Valor</th></tr></thead>
            <tbody>
              {Object.entries(sum.byStatus).map(([st, v]) => (
                <tr key={st}><td><Link href={withTab("documentos", { crit: st })}><StatusBadge kind="fiscal" status={st} /></Link></td><td className="tabular text-right">{v.count}</td><td className="tabular text-right">{formatMoney(v.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function DocsTab({ s, params, p }: { s: any; params: SearchParams; p: any }) {
  const all = await periodDocRows(s.ctx, params);
  const { rows, total } = paginate(all, p);
  const crit = sp(params, "crit");
  const cols: Column<any>[] = [
    { key: "number", label: "Documento", fixed: true, cell: (r) => `${r.modelLabel} ${r.number ?? r.ref}` },
    { key: "issuedAt", label: "Emissão", sortable: true, cell: (r) => formatDateTime(r.issuedAt) },
    { key: "recipientName", label: "Destinatário/tomador", cell: (r) => r.recipientName ?? "—" },
    { key: "operationType", label: "Operação", cell: (r) => `${r.operationType === "entrada" ? "Entrada" : "Saída"}${r.purpose === "devolucao" ? " · devolução" : ""}` },
    { key: "status", label: "Situação", cell: (r) => <span className="flex gap-1"><StatusBadge kind="fiscal" status={r.status} /><SimBadge show={Boolean(r.isSimulated)} /></span> },
    { key: "icms", label: "ICMS", align: "right", hidden: true, cell: (r) => formatMoney(r.icms) },
    { key: "iss", label: "ISS", align: "right", hidden: true, cell: (r) => formatMoney(r.iss) },
    { key: "approxTax", label: "Trib. aprox.", align: "right", cell: (r) => formatMoney(r.approxTax) },
    { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
  ];
  const critLabel: Record<string, string> = { revenue: "Faturamento (autorizadas de saída, exceto devolução)", returns: "Devoluções recebidas", pending: "Pendências", issued: "Emitidos (autorizados + cancelados)" };
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {["", "revenue", "issued", "returns", "pending", "cancelled", "rejected"].map((c) => (
          <Link key={c} href={`/fiscal/relatorios${qs({ crit: c || null, page: null }, params)}`} className={`rounded-full px-3 py-1 ring-1 ${crit === c ? "bg-brand-800 text-white ring-brand-800" : "bg-white text-slate-600 ring-line"}`}>
            {c ? (critLabel[c] ?? DOC_STATUS_LABEL[c]) : "Todos"}
          </Link>
        ))}
      </div>
      <DataTable id="fiscal-period-docs" basePath="/fiscal/relatorios" params={params} columns={cols} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey="fiscal-documentos" rowHref={(r) => `/fiscal/${r.model}/${r.id}`} totals={{ total: formatMoney(sumBy(all, (r) => r.total)), approxTax: formatMoney(sumBy(all, (r) => r.approxTax)) }} />
    </>
  );
}

function SimpleTable({ id, exportKey, params, p, rows, kind }: { id: string; exportKey: string; params: SearchParams; p: any; rows: any[]; kind: "book" | "ncm" | "cancel" | "reject" }) {
  const sorted = paginate(rows.map((r, i) => ({ ...r, id: r.id ?? String(i) })), p);
  let cols: Column<any>[] = [];
  let totals: Record<string, React.ReactNode> = {};
  let note = "";
  if (kind === "book") {
    note = "Livro (registro) de saídas: notas de produto de saída autorizadas e canceladas emitidas no período, um lançamento por CFOP. Canceladas aparecem zeradas com observação. Relatório de apoio — não substitui a EFD/SPED.";
    cols = [
      { key: "date", label: "Data", sortable: true, fixed: true, cell: (r) => formatDate(r.date) },
      { key: "modelLabel", label: "Espécie", cell: (r) => <Link className="text-brand-700 hover:underline" href={`/fiscal/${r.model}/${r.docId}`}>{r.modelLabel}</Link> },
      { key: "series", label: "Série", cell: (r) => r.series },
      { key: "number", label: "Número", sortable: true, cell: (r) => r.number },
      { key: "recipient", label: "Destinatário", cell: (r) => r.recipient },
      { key: "uf", label: "UF", cell: (r) => r.uf || "—" },
      { key: "cfop", label: "CFOP", sortable: true, cell: (r) => r.cfop },
      { key: "value", label: "Valor contábil", align: "right", sortable: true, cell: (r) => formatMoney(r.value) },
      { key: "icmsBase", label: "Base ICMS", align: "right", cell: (r) => formatMoney(r.icmsBase) },
      { key: "icms", label: "ICMS", align: "right", cell: (r) => formatMoney(r.icms) },
      { key: "exemptOther", label: "Isentas/outras", align: "right", cell: (r) => formatMoney(r.exemptOther) },
      { key: "note", label: "Observações", cell: (r) => <span className="text-xs">{r.note}</span> },
    ];
    totals = { value: formatMoney(sumBy(rows, (r) => r.value)), icmsBase: formatMoney(sumBy(rows, (r) => r.icmsBase)), icms: formatMoney(sumBy(rows, (r) => r.icms)), exemptOther: formatMoney(sumBy(rows, (r) => r.exemptOther)) };
  } else if (kind === "ncm") {
    note = "Somente notas autorizadas de saída (critério do faturamento), agrupadas pelo NCM do item.";
    cols = [
      { key: "ncm", label: "NCM", fixed: true, sortable: true, cell: (r) => <span className="font-mono">{r.ncm}</span> },
      { key: "description", label: "Descrição (exemplo)", cell: (r) => r.description },
      { key: "docs", label: "Documentos", align: "right", sortable: true, cell: (r) => r.docs },
      { key: "qty", label: "Quantidade", align: "right", cell: (r) => formatQty(r.qty) },
      { key: "value", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.value) },
      { key: "icms", label: "ICMS", align: "right", cell: (r) => formatMoney(r.icms) },
      { key: "pis", label: "PIS", align: "right", cell: (r) => formatMoney(r.pis) },
      { key: "cofins", label: "COFINS", align: "right", cell: (r) => formatMoney(r.cofins) },
    ];
    totals = { value: formatMoney(sumBy(rows, (r) => r.value)), icms: formatMoney(sumBy(rows, (r) => r.icms)), pis: formatMoney(sumBy(rows, (r) => r.pis)), cofins: formatMoney(sumBy(rows, (r) => r.cofins)) };
  } else if (kind === "cancel") {
    note = "Cancelamentos homologados com instante de cancelamento no período (independe da data de emissão).";
    cols = [
      { key: "cancelledAt", label: "Cancelado em", fixed: true, sortable: true, cell: (r) => formatDateTime(r.cancelledAt) },
      { key: "modelLabel", label: "Documento", cell: (r) => <Link className="text-brand-700 hover:underline" href={`/fiscal/${r.model}/${r.id}`}>{r.modelLabel} {r.number ?? ""}</Link> },
      { key: "issuedAt", label: "Emitido em", cell: (r) => formatDateTime(r.issuedAt) },
      { key: "recipient", label: "Destinatário", cell: (r) => r.recipient || "—" },
      { key: "reason", label: "Justificativa", cell: (r) => <span className="text-xs">{r.reason}</span> },
      { key: "simLabel", label: "", cell: (r) => <SimBadge show={r.simulated} /> },
      { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    ];
    totals = { total: formatMoney(sumBy(rows, (r) => r.total)) };
  } else {
    note = "Retornos de rejeição/denegação recebidos no período — inclusive de documentos depois corrigidos e autorizados (veja a situação atual).";
    cols = [
      { key: "occurredAt", label: "Retorno em", fixed: true, sortable: true, cell: (r) => formatDateTime(r.occurredAt) },
      { key: "modelLabel", label: "Documento", cell: (r) => <Link className="text-brand-700 hover:underline" href={`/fiscal/${r.model}/${r.docId}`}>{r.modelLabel} {r.numberOrRef}</Link> },
      { key: "statusLabel", label: "Retorno", cell: (r) => <StatusBadge kind="fiscal" status={r.status} /> },
      { key: "message", label: "Mensagem do provedor", cell: (r) => <span className="text-xs">{r.message}</span> },
      { key: "currentLabel", label: "Situação atual", cell: (r) => <StatusBadge kind="fiscal" status={r.currentStatus} /> },
      { key: "total", label: "Valor", align: "right", cell: (r) => formatMoney(r.total) },
    ];
  }
  return (
    <>
      <p className="mb-3 text-xs text-slate-500">{note}</p>
      <DataTable id={id} basePath="/fiscal/relatorios" params={params} columns={cols} rows={sorted.rows} total={sorted.total} page={p.page} pageSize={p.pageSize} exportKey={exportKey} totals={Object.keys(totals).length ? totals : undefined} />
    </>
  );
}

async function AccountingTab({ s, params, f }: { s: any; params: SearchParams; f: any }) {
  const cfop = await cfopRows(s.ctx, params);
  const services = await serviceRows(s.ctx, params);
  const docs = await periodDocuments(s.ctx, f);
  const sum = summarize(docs, f);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Receita bruta fiscal" value={formatMoney(sum.gross)} hint="Autorizadas de saída" />
        <Stat label="(−) Devoluções recebidas" value={formatMoney(sum.returns)} hint={`${sum.returnsCount} NF-e de entrada (devolução)`} />
        <Stat label="Receita líquida fiscal" value={formatMoney(sum.net)} />
        <Stat label="ICMS / PIS / COFINS / ISS" value={formatMoney(sum.taxes.icms + sum.taxes.pis + sum.taxes.cofins + sum.taxes.iss)} hint={`${formatMoney(sum.taxes.icms)} / ${formatMoney(sum.taxes.pis)} / ${formatMoney(sum.taxes.cofins)} / ${formatMoney(sum.taxes.iss)}`} />
      </div>
      <Card title="Por CFOP (mercadorias)" bodyClass="p-0">
        <DataTable id="fiscal-cfop" basePath="/fiscal/relatorios" params={params} rows={cfop} total={cfop.length} page={1} pageSize={500} exportKey="fiscal-cfop" columns={[
          { key: "cfop", label: "CFOP", fixed: true, cell: (r) => <span className="font-mono">{r.cfop}</span> },
          { key: "direction", label: "Natureza", cell: (r) => r.direction },
          { key: "docs", label: "Documentos", align: "right", cell: (r) => r.docs },
          { key: "value", label: "Valor contábil", align: "right", cell: (r) => formatMoney(r.value) },
          { key: "icmsBase", label: "Base ICMS", align: "right", cell: (r) => formatMoney(r.icmsBase) },
          { key: "icms", label: "ICMS", align: "right", cell: (r) => formatMoney(r.icms) },
          { key: "pis", label: "PIS", align: "right", cell: (r) => formatMoney(r.pis) },
          { key: "cofins", label: "COFINS", align: "right", cell: (r) => formatMoney(r.cofins) },
        ]} totals={{ value: formatMoney(sumBy(cfop, (r) => r.value)), icms: formatMoney(sumBy(cfop, (r) => r.icms)) }} />
      </Card>
      <Card title="Serviços (NFS-e) por item da LC 116" bodyClass="p-0">
        <DataTable id="fiscal-servicos" basePath="/fiscal/relatorios" params={params} rows={services} total={services.length} page={1} pageSize={500} exportKey="fiscal-servicos" columns={[
          { key: "serviceListItem", label: "Item LC 116", fixed: true, cell: (r) => r.serviceListItem },
          { key: "docs", label: "NFS-e", align: "right", cell: (r) => r.docs },
          { key: "amount", label: "Serviços", align: "right", cell: (r) => formatMoney(r.amount) },
          { key: "base", label: "Base ISS", align: "right", cell: (r) => formatMoney(r.base) },
          { key: "iss", label: "ISS calculado", align: "right", cell: (r) => formatMoney(r.iss) },
          { key: "issWithheld", label: "ISS retido", align: "right", cell: (r) => formatMoney(r.issWithheld) },
          { key: "federalWithheld", label: "Retenções federais", align: "right", cell: (r) => formatMoney(r.federalWithheld) },
          { key: "net", label: "Líquido", align: "right", cell: (r) => formatMoney(r.net) },
        ]} totals={{ amount: formatMoney(sumBy(services, (r) => r.amount)), iss: formatMoney(sumBy(services, (r) => r.iss)), net: formatMoney(sumBy(services, (r) => r.net)) }} />
      </Card>
      <p className="text-xs text-slate-500">Resumo de apoio à escrituração pela contabilidade. Não é apuração de PGDAS-D nem arquivo SPED.</p>
    </div>
  );
}

async function ExportTab({ s, f }: { s: any; f: any }) {
  const sch = await getAccountingSchedule(s.ctx);
  const integ = await getIntegration(s.ctx.store, s.ctx.companyId, null, "accounting");
  const history = await packageHistory(s.ctx);
  const logs = (await listAll(s.ctx.store, "integration_logs", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "kind", "accounting"]], orderBy: [{ field: "occurredAt", dir: "desc" }] }, 30)).slice(0, 15);
  const canCfg = canDo(s.user, "fiscal.configure");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Pacote do período para a contabilidade" description={`${formatDate(f.from)} a ${formatDate(f.to)}${f.branchId || s.ctx.branchId ? " · filial atual" : " · todas as filiais"}`}>
        <p className="mb-3 text-sm text-slate-600">ZIP com os <b>XMLs armazenados</b> (autorizados e cancelados; os de simulação em pasta separada e identificada) e relatórios <b>CSV</b> (livro de saídas, CFOP, NCM, serviços, cancelamentos, rejeições, documentos) + LEIA-ME com critérios e manifesto SHA-256. Não é arquivo de obrigação acessória.</p>
        <ActionForm action={generatePackageAction} className="space-y-3">
          <input type="hidden" name="from" value={f.from} />
          <input type="hidden" name="to" value={f.to} />
          {f.branchId && <input type="hidden" name="branch" value={f.branchId} />}
          <Field label="Enviar para (opcional)" hint={integ?.config?.accountantEmail ? `Padrão: ${integ.config.accountantEmail} (integração Área da contabilidade)` : "Configure o e-mail da contabilidade em Integrações."}><Input type="email" name="to" placeholder={integ?.config?.accountantEmail ?? "contabilidade@exemplo.com.br"} /></Field>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="submit" name="intent" value="generate" className={buttonClass("secondary")}><FileArchive className="size-4" /> Gerar pacote (download)</button>
            <button type="submit" name="intent" value="send" className={buttonClass("accent")}><Send className="size-4" /> Gerar e enviar à contabilidade</button>
          </div>
        </ActionForm>
      </Card>
      <Card title="Agendamento mensal" description="Rotina diária verifica: a partir do dia configurado, gera o pacote do mês anterior e envia pelo canal da integração “contabilidade”; o resultado real fica no histórico.">
        <ActionForm action={saveScheduleAction} className="space-y-3">
          <Checkbox name="enabled" label="Enviar automaticamente todo mês" defaultChecked={sch.enabled} disabled={!canCfg} />
          <FormGrid cols={2}>
            <Field label="Dia do envio (1–28)"><Input type="number" name="day" min={1} max={28} defaultValue={sch.day} disabled={!canCfg} /></Field>
          </FormGrid>
          <p className="text-xs text-slate-500">Última execução: {sch.lastRunAt ? `${formatDateTime(sch.lastRunAt)} — ${sch.lastResult}` : "nunca"} · último período enviado: {sch.lastPeriod ?? "—"}</p>
          {!integ && <Notice tone="warn">Integração “Área da contabilidade” não configurada: o envio agendado registrará falha. <Link className="underline" href="/administracao/integracoes/accounting">Configurar</Link></Notice>}
          {canCfg && <div className="flex justify-end"><button type="submit" className={buttonClass("primary")}>Salvar agendamento</button></div>}
        </ActionForm>
      </Card>
      <Card title="Pacotes gerados" bodyClass="p-0">
        {history.length === 0 ? <EmptyState title="Nenhum pacote gerado" /> : (
          <table className="table-base w-full text-sm">
            <thead><tr><th>Arquivo</th><th>Gerado em</th><th className="text-right">Tamanho</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td><a className="text-brand-700 hover:underline" href={`/api/files/${h.id}`}>{h.name}</a></td><td>{formatDateTime(h.createdAt)}</td><td className="tabular text-right">{((h.sizeBytes ?? 0) / 1024).toFixed(1)} KB</td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title="Envios à contabilidade (resultado real)" bodyClass="p-0">
        {logs.length === 0 ? <EmptyState title="Nenhum envio registrado" /> : (
          <ul className="divide-y divide-line text-sm">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-2">
                <div className="flex items-center gap-2"><Badge tone={l.status === "success" ? "good" : l.status === "failure" ? "bad" : "neutral"}>{l.status === "success" ? "Entregue" : l.status === "failure" ? "Falhou" : "Info"}</Badge><span className="text-xs text-slate-500">{formatDateTime(l.occurredAt)} · {l.action}</span></div>
                <p className="mt-0.5 text-xs text-slate-700">{l.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

async function ObligationsTab({ s, f }: { s: any; f: any }) {
  const month = (f.period ?? f.from.slice(0, 7)) as string;
  const all = await listObligations(s.ctx, {});
  const inMonth = all.filter((o) => o.dueDate.slice(0, 7) === month);
  const open = all.filter((o) => !["done", "waived"].includes(o.status));
  const templates = await getTemplates(s.ctx);
  const users = await lookups.users(s.ctx);
  const userMap = new Map(users.map((u) => [u.value, u.label]));
  const kinds = Object.entries(OBLIGATION_KIND_LABEL).map(([value, label]) => ({ value, label }));
  const canEdit = canDo(s.user, "fiscal.issue");
  // calendário do mês
  const first = `${month}-01`;
  const startDow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const daysIn = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells = Array.from({ length: startDow + daysIn }, (_, i) => (i < startDow ? null : i - startDow + 1));
  const t = today();
  const tplReq = new Map(templates.map((x) => [x.key, x.requiresProof]));
  const list = [...open.filter((o) => o.dueDate.slice(0, 7) !== month), ...inMonth].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  void dayRange;
  return (
    <div className="space-y-4">
      <Notice tone="info">O sistema acompanha as obrigações (calendário, situação, responsável e comprovação). Ele não gera PGDAS-D, DEFIS nem SPED; produz o pacote de XML e os relatórios CSV de apoio. Datas de vencimento são parâmetros editáveis abaixo.</Notice>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card title={`Calendário — ${formatMonth(month)}`}>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-500">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}
            {cells.map((d, i) => {
              const date = d ? `${month}-${String(d).padStart(2, "0")}` : "";
              const items = d ? inMonth.filter((o) => o.dueDate === date) : [];
              return (
                <div key={i} className={`min-h-14 rounded border p-1 text-left ${!d ? "border-transparent" : date === t ? "border-brand-400 bg-brand-50" : "border-line"}`}>
                  {d && <span className="text-[10px] text-slate-500">{d}</span>}
                  {items.map((o) => <span key={o.id} title={o.name} className={`mt-0.5 block truncate rounded px-1 text-[10px] ${o.display === "done" ? "bg-emerald-100 text-emerald-800" : o.display === "late" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{o.name}</span>)}
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Obrigações (abertas e do mês)" actions={canEdit && <><ActionButton action={generateObligationsAction} label="Gerar da competência" size="sm" /><NewObligationButton kinds={kinds} users={users} defaultPeriod={addMonths(monthStart(t), -1).slice(0, 7)} /></>} bodyClass="p-0">
          {list.length === 0 ? <EmptyState title="Nenhuma obrigação" description="Use “Gerar da competência” para criar a partir do calendário." /> : (
            <ul className="divide-y divide-line">
              {list.map((o) => (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{o.name} <span className="text-xs text-slate-500">· competência {o.period}</span></p>
                      <p className="text-xs text-slate-500">{OBLIGATION_KIND_LABEL[o.kind] ?? o.kind} · vence {formatDate(o.dueDate)}{o.responsibleId ? ` · resp. ${userMap.get(o.responsibleId) ?? "—"}` : ""}</p>
                    </div>
                    <StatusBadge kind="obligation" status={o.display} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{OBLIGATION_SUPPORT[o.kind]}</p>
                  {o.status === "done" ? (
                    <p className="mt-1 text-xs text-emerald-800">
                      Concluída em {formatDate(o.deliveredAt)}{o.receiptNumber ? ` · ${o.receiptNumber}` : ""}{o.amount ? ` · ${formatMoney(o.amount)}` : ""}
                      {o.proofFileId && <> · <a className="underline" href={`/api/files/${o.proofFileId}`}>comprovante</a></>}
                      {o.exportFileId && <> · <a className="underline" href={`/api/files/${o.exportFileId}`}>pacote enviado</a></>}
                    </p>
                  ) : (
                    canEdit && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <CompleteObligationButton id={o.id} name={o.name} requiresProof={Boolean(tplReq.get(o.templateKey))} today={t} support={OBLIGATION_SUPPORT[o.kind] ?? ""} />
                        {o.status !== "in_progress" && <ActionButton action={obligationStatusAction.bind(null, o.id, "in_progress")} label="Em andamento" size="sm" variant="ghost" />}
                        <FormDialogButton action={obligationStatusAction.bind(null, o.id, "waived")} label="Dispensar" size="sm" variant="ghost" title="Dispensar obrigação" name="reason" fieldLabel="Motivo" min={5} max={300} />
                        {o.kind === "xml_contabilidade" && <Link href={`/fiscal/relatorios?tab=exportacao&period=${o.period}`} className={buttonClass("ghost", "sm")}>Gerar pacote</Link>}
                        {canDo(s.user, "fiscal.configure") && <ActionButton action={deleteObligationAction.bind(null, o.id)} label="Excluir" size="sm" variant="ghost" confirm="Excluir esta obrigação?" />}
                      </div>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Calendário de obrigações (modelos)" description="Parâmetros da empresa: vencimento no mês seguinte à competência (mensal) ou no mês indicado do ano seguinte (anual). A rotina diária gera as obrigações e avisa vencimentos (≤ 5 dias) e atrasos.">
        {canDo(s.user, "fiscal.configure") ? <TemplatesEditor initial={templates} kinds={kinds} /> : <p className="text-sm text-slate-500">Somente usuários com permissão de configuração fiscal alteram o calendário.</p>}
      </Card>
      <Card title="Histórico (todas as obrigações)" bodyClass="p-0">
        <table className="table-base w-full text-sm">
          <thead><tr><th>Obrigação</th><th>Competência</th><th>Vencimento</th><th>Situação</th><th>Entrega</th></tr></thead>
          <tbody>{all.slice(-50).reverse().map((o) => <tr key={o.id}><td>{o.name}</td><td>{o.period}</td><td>{formatDate(o.dueDate)}</td><td><StatusBadge kind="obligation" status={displayStatus(o)} /></td><td>{o.deliveredAt ? formatDate(o.deliveredAt) : "—"}</td></tr>)}</tbody>
        </table>
      </Card>
      <p className="text-xs text-slate-500">{OBLIGATION_STATUS_LABEL.due_soon}: vence em até 5 dias.</p>
    </div>
  );
}
