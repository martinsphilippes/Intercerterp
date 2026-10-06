import Link from "@/components/ui/link";
import { Monitor, RefreshCw, WifiOff, Wifi } from "lucide-react";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { ActionButton } from "@/components/ui/action-form";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getFiscalConfig, numberingGaps, DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { queryDocuments, listPeriod, sliceStats, type DocRow } from "../queries";
import { STATUS_OPTIONS } from "../labels";
import { DisableDialog } from "../_components/disable-dialog";
import { DocStatus, FiscalStatusBar, RowActions, StatusTabs } from "../_components/list-parts";
import { PeriodLinks } from "../_components/period-links";
import { FormDialogButton } from "../_components/form-dialog";
import { batchRetransmitAction, toggleContingencyAction } from "../actions";
import { cscRefProblem } from "@/domain/integrations";

export const metadata = { title: "NFC-e" };

const inStatus = (r: DocRow, st: string) => !st || st.split(",").includes(r.status);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  const params = await searchParams;
  const p = parseList(params, { sort: "issuedAt", dir: "desc" });
  const base = await queryDocuments(s.ctx, "nfce", { ...p, f: { ...p.f, status: "" } });
  const status = p.f.status ?? "";
  const all = base.filter((r) => inStatus(r, status));
  const { rows, total } = paginate(all, p);
  const st = sliceStats(base);
  const { from, to } = listPeriod(p, today());
  const pp = { ...params, from, to };
  const [branches, terminals, users] = await Promise.all([s.consolidated ? lookups.branches(s.ctx) : Promise.resolve([]), lookups.terminals(s.ctx, s.ctx.branchId), lookups.users(s.ctx)]);
  const cfg = s.ctx.branchId ? await getFiscalConfig(s.ctx.store, s.ctx.companyId, s.ctx.branchId) : null;
  const gaps = s.ctx.branchId ? await numberingGaps(s.ctx, s.ctx.branchId, "nfce") : [];
  // fila de pendentes (independente do período): o que ainda não tem retorno definitivo
  const queueFilters: any[] = [["eq", "companyId", s.ctx.companyId], ["eq", "model", "nfce"], ["eq", "status", ["queued", "error", "pending", "processing"]]];
  if (s.ctx.branchId) queueFilters.push(["eq", "branchId", s.ctx.branchId]);
  const queueAll = await listAll(s.ctx.store, "fiscal_documents", { filters: queueFilters, orderBy: [{ field: "issuedAt", dir: "asc" }] });
  const rejectedAll = await listAll(s.ctx.store, "fiscal_documents", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "model", "nfce"], ["eq", "status", "rejected"], ...(s.ctx.branchId ? [["eq", "branchId", s.ctx.branchId] as any] : [])] });
  // inutilizações não homologadas não são transmitidas nem corrigidas como documento (o lote as ignora): listadas à parte
  const queue = queueAll.filter((d) => d.originType !== "disable");
  const rejectedOpen = rejectedAll.filter((d) => d.originType !== "disable");
  const disablesOpen = [...queueAll, ...rejectedAll].filter((d) => d.originType === "disable");
  const link = (extra: Record<string, string | null>) => `/fiscal/nfce${qs({ ...extra, page: null }, pp)}`;
  const canFix = canDo(s.user, "fiscal.issue") && Boolean(s.branch);
  const count = (x: string) => base.filter((r) => inStatus(r, x)).length;
  const cscOk = cfg ? (cfg.provider === "simulated" ? null : Boolean(cfg.cscId && cfg.cscTokenRef && !cscRefProblem(cfg.cscTokenRef) && process.env[cfg.cscTokenRef])) : null;
  const seriesInUse = [...new Set((await listAll(s.ctx.store, "terminals", { filters: [["eq", "companyId", s.ctx.companyId], ...(s.ctx.branchId ? [["eq", "branchId", s.ctx.branchId] as any] : [])] })).map((t) => t.nfceSeries ?? cfg?.nfceSeries ?? 1))].sort();
  const columns: Column<DocRow>[] = [
    { key: "number", label: "NFC-e", sortable: true, fixed: true, cell: (r) => <span>{r.numberLabel}<span className="block text-xs font-normal text-slate-500">Série {r.series ?? "—"}</span></span> },
    { key: "issuedAt", label: "Data / hora", sortable: true, cell: (r) => formatDateTime(r.issuedAt) },
    { key: "saleNumber", label: "Venda / consumidor", sortable: true, cell: (r) => <span>{r.originHref ? <Link className="text-brand-700 hover:underline" href={r.originHref}>Venda nº {r.saleNumber ?? "—"}</Link> : "—"}<span className="block text-xs text-slate-500">{r.recipientLabel}{r.recipientDoc ? ` • ${formatDoc(r.recipientDoc)}` : ""}</span></span> },
    { key: "terminalCode", label: "Caixa / operador", sortable: true, cell: (r) => <span>{r.terminalCode}<span className="block text-xs text-slate-500">{r.operatorName}</span></span> },
    { key: "paymentLabel", label: "Pagamento", cell: (r) => r.paymentLabel },
    ...(s.consolidated ? [{ key: "branchName", label: "Filial", cell: (r: DocRow) => r.branchName }] : []),
    { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    { key: "protocol", label: "Protocolo", hidden: true, cell: (r) => r.protocol ?? "—" },
    { key: "status", label: "Situação", cell: (r) => <DocStatus d={r} /> },
    { key: "actions", label: "Ações", fixed: true, cell: (r) => <RowActions d={r} canIssue={canFix} branchId={s.ctx.branchId} /> },
  ];
  return (
    <>
      <PageHeader
        title="NFC-e e documentos do PDV"
        crumbs={[{ label: "Fiscal" }, { label: "NFC-e" }]}
        description={`Vendas fiscais do caixa, contingência, cancelamentos e transmissões — período ${formatDate(from)} a ${formatDate(to)}. Retransmitir nunca cria documento, venda ou recebimento novo.`}
        actions={
          <>
            {s.ctx.branchId && canDo(s.user, "fiscal.cancel") && <DisableDialog model="nfce" series={String(cfg?.nfceSeries ?? 1)} gaps={gaps} />}
            {s.branch && canDo(s.user, "fiscal.configure") && cfg && (cfg.contingency ? (
              <ActionButton action={toggleContingencyAction.bind(null, false)} label="Encerrar contingência" icon={<Wifi className="size-4" />} confirm="Encerrar a contingência e liberar a fila para transmissão?" />
            ) : (
              <FormDialogButton action={toggleContingencyAction.bind(null, true)} label="Ativar contingência" icon={<WifiOff className="size-4" />} title="Ativar contingência da filial" name="reason" fieldLabel="Motivo (ex.: SEFAZ indisponível, sem internet)" min={5} max={300} description="Com a contingência ativa, as NFC-e novas ficam retidas na fila do sistema (não transmitidas e não autorizadas). O cupom impresso traz a tarja 'pendente de autorização'. A contingência offline legal (tpEmis 9) é feita pelo provedor quando habilitada nele." submitLabel="Ativar contingência" />
            ))}
            {can(s.user, "pdv", "view") && <LinkButton href="/pdv" variant="accent"><Monitor className="size-4" /> Abrir PDV</LinkButton>}
          </>
        }
      />
      {s.ctx.branchId && (
        <FiscalStatusBar
          cfg={cfg}
          model="nfce"
          canTest={can(s.user, "fiscal", "view")}
          extra={
            <>
              <span>CSC: {cscOk == null ? "não exigido na simulação" : cscOk ? <Badge tone="good">configurado</Badge> : cfg?.cscTokenRef && cscRefProblem(cfg.cscTokenRef) ? <Badge tone="bad">variável com nome não permitido</Badge> : <Badge tone="bad">ausente (ID ou variável)</Badge>}</span>
              <span>Série(s) em uso: {seriesInUse.join(", ") || cfg?.nfceSeries || 1}</span>
            </>
          }
        />
      )}
      {cfg?.contingency && (
        <div className="mb-4">
          <Notice tone="warn" title={`Contingência ativa desde ${formatDateTime(cfg.contingencySince)}`}>
            Motivo: {cfg.contingencyReason ?? "—"}. As NFC-e novas ficam retidas na fila e não são consideradas autorizadas. Ao normalizar, encerre a contingência (a fila é liberada) ou use a retransmissão em lote.
          </Notice>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={from === to && to === today() ? "Autorizadas hoje" : "Autorizadas no período"} value={st.authorized.count} hint={`${formatMoney(st.authorized.total)} em vendas`} href={link({ status: "authorized" })} tone="good" />
        <Stat label="Pendentes de transmissão" value={queue.length} hint={queue.length ? `${queue.filter((d) => d.contingency).length} em contingência · todos os períodos` : "Nenhuma NFC-e pendente"} href="#pendencias" tone={queue.length ? "warn" : "default"} />
        <Stat label="Rejeitadas (abertas)" value={rejectedOpen.length} hint="Precisam de correção — todos os períodos" href={`/fiscal/nfce?status=rejected&from=2000-01-01&to=${today()}`} tone={rejectedOpen.length ? "bad" : "default"} />
        <Stat label={from === to && to === today() ? "Canceladas hoje" : "Canceladas no período"} value={st.cancelled.count} hint={`${formatMoney(st.cancelled.total)} cancelados`} href={link({ status: "cancelled" })} />
      </div>
      {disablesOpen.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title={`Inutilizações não homologadas (${disablesOpen.length})`}>
            {disablesOpen.slice(0, 10).map((d) => `Série ${d.series ?? "—"} nº ${d.service?.disableFrom ?? d.number ?? "—"}–${d.service?.disableTo ?? d.number ?? "—"} (${DOC_STATUS_LABEL[d.status] ?? d.status})`).join("; ")}
            {disablesOpen.length > 10 ? "; …" : ""}. Inutilização não é retransmitida em lote: repita a inutilização da mesma faixa em “Inutilizar numeração”.
          </Notice>
        </div>
      )}
      {(queue.length > 0 || rejectedOpen.length > 0) && (
        <Card
          title={<span id="pendencias">Pendências e contingência</span>}
          description="Documentos sem retorno definitivo. A retransmissão usa a mesma referência: consulta antes de reenviar e nunca duplica documento, venda ou recebimento."
          actions={canFix && queue.length > 0 && <ActionButton action={batchRetransmitAction.bind(null, "nfce")} label={`Retransmitir/consultar em lote (${queue.length})`} variant="primary" icon={<RefreshCw className="size-4" />} confirm={`Processar ${queue.length} documento(s) pendente(s) agora?`} />}
          className="mb-4"
          bodyClass="p-0"
        >
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Documento</th><th>Emissão</th><th>Situação</th><th>Mensagem</th><th className="text-right">Tentativas</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {[...queue, ...rejectedOpen].slice(0, 50).map((d) => (
                  <tr key={d.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/fiscal/nfce/${d.id}`}>{d.number ? `nº ${d.number}/${d.series}` : d.ref}</Link> {d.contingency && <Badge tone="warn">Contingência</Badge>}</td>
                    <td>{formatDateTime(d.issuedAt)}</td>
                    <td><StatusBadge kind="fiscal" status={d.status} /></td>
                    <td className="max-w-md truncate text-xs text-slate-600" title={d.statusMessage ?? ""}>{d.statusMessage ?? DOC_STATUS_LABEL[d.status]}</td>
                    <td className="tabular text-right">{d.attempts ?? 0}</td>
                    <td className="tabular text-right">{formatMoney(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <FilterBar
        basePath="/fiscal/nfce"
        values={pp}
        filters={[
          { type: "search", placeholder: "Número, venda, consumidor, CPF ou chave" },
          { type: "select", name: "status", label: "Situação", options: STATUS_OPTIONS },
          { type: "select", name: "terminal", label: "Caixa", options: terminals, all: "Todos os caixas" },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
          { type: "text", name: "sale", label: "Venda nº", placeholder: "Número" },
          { type: "select", name: "operator", label: "Operador", options: users },
          { type: "select", name: "contingency", label: "Contingência", options: [{ value: "1", label: "Em contingência (retidas na fila ou emitidas offline pelo provedor)" }] },
          { type: "select", name: "sim", label: "Ambiente", options: [{ value: "0", label: "Somente reais" }, { value: "1", label: "Somente simulação" }] },
          ...(s.consolidated ? [{ type: "select" as const, name: "branch", label: "Filial", options: branches }] : []),
        ]}
      />
      <PeriodLinks basePath="/fiscal/nfce" params={params} from={from} to={to} />
      <StatusTabs
        basePath="/fiscal/nfce"
        params={pp}
        tabs={[
          { label: "Todas", status: "", count: base.length },
          { label: "Autorizadas", status: "authorized", count: count("authorized") },
          { label: "Pendentes/offline", status: "queued,processing,pending,error", count: count("queued,processing,pending,error") },
          { label: "Com erro", status: "rejected,denied", count: count("rejected,denied") },
          { label: "Canceladas", status: "cancelled,discarded", count: count("cancelled,discarded") },
        ]}
      />
      <DataTable
        id="fiscal-nfce"
        basePath="/fiscal/nfce"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="fiscal-nfce"
        rowHref={(r) => `/fiscal/nfce/${r.id}`}
        totals={{ total: formatMoney(all.reduce((a, r) => a + (r.total ?? 0), 0)) }}
        footer={st.simulated ? <p className="border-t border-line px-3 py-2 text-xs text-fuchsia-800">{st.simulated} cupom(ns) do período são de SIMULAÇÃO — sem validade fiscal.</p> : null}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma NFC-e no recorte. As NFC-e são emitidas automaticamente pelas vendas do <Link className="text-brand-700 underline" href="/pdv">PDV</Link>.</div>}
      />
    </>
  );
}
