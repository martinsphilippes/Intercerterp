import Link from "next/link";
import { FilePlus2, Settings } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getFiscalConfig, numberingGaps } from "@/domain/fiscal/service";
import { queryDocuments, listPeriod, sliceStats, type DocRow } from "../queries";
import { STATUS_OPTIONS, OP_LABEL, formatKey } from "../labels";
import { DisableDialog } from "../_components/disable-dialog";
import { DocStatus, FiscalStatusBar, RowActions, StatusTabs } from "../_components/list-parts";
import { PeriodLinks } from "../_components/period-links";

export const metadata = { title: "NF-e" };

const inStatus = (r: DocRow, st: string) => !st || st.split(",").includes(r.status);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  const params = await searchParams;
  const p = parseList(params, { sort: "issuedAt", dir: "desc" });
  // recorte do período sem o filtro de situação (indicadores e abas); a tabela aplica a situação
  const base = await queryDocuments(s.ctx, "nfe", { ...p, f: { ...p.f, status: "" } });
  const status = p.f.status ?? "";
  const all = base.filter((r) => inStatus(r, status));
  const { rows, total } = paginate(all, p);
  const st = sliceStats(base);
  const { from, to } = listPeriod(p);
  const branches = s.consolidated ? await lookups.branches(s.ctx) : [];
  const cfg = s.ctx.branchId ? await getFiscalConfig(s.ctx.store, s.ctx.companyId, s.ctx.branchId) : null;
  const gaps = s.ctx.branchId ? await numberingGaps(s.ctx, s.ctx.branchId, "nfe") : [];
  const pp = { ...params, from, to };
  const link = (extra: Record<string, string | null>) => `/fiscal/nfe${qs({ ...extra, page: null }, pp)}`;
  const canIssue = can(s.user, "fiscal", "create") && canDo(s.user, "fiscal.issue");
  const count = (st: string) => base.filter((r) => inStatus(r, st)).length;
  const columns: Column<DocRow>[] = [
    { key: "number", label: "Número", sortable: true, fixed: true, cell: (r) => <span>{r.numberLabel}<span className="block text-xs font-normal text-slate-500">{r.number ? `Série ${r.series}` : r.status === "draft" ? "Rascunho" : `Série ${r.series ?? "—"}`}</span></span> },
    { key: "issuedAt", label: "Emissão", sortable: true, cell: (r) => (r.attempts || r.status !== "draft" ? formatDateTime(r.issuedAt) : <span className="text-slate-400">Não emitida</span>) },
    { key: "recipientName", label: "Destinatário", sortable: true, cell: (r) => <span>{r.recipientLabel}{r.recipientDoc && <span className="block text-xs text-slate-500">{formatDoc(r.recipientDoc)}</span>}</span> },
    { key: "nature", label: "Operação", cell: (r) => <span>{r.nature}<span className="block text-xs text-slate-500">{OP_LABEL[r.operationType] ?? r.operationType}{r.purpose && r.purpose !== "normal" ? ` · ${r.purpose === "devolucao" ? "devolução" : r.purpose}` : ""}</span></span> },
    { key: "origin", label: "Origem", hidden: true, cell: (r) => (r.originHref ? <Link className="text-brand-700 hover:underline" href={r.originHref}>{r.originLabel}</Link> : r.originLabel) },
    ...(s.consolidated ? [{ key: "branchName", label: "Filial", cell: (r: DocRow) => r.branchName }] : []),
    { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    { key: "protocol", label: "Protocolo", cell: (r) => <span className="font-mono text-xs">{r.protocol ?? "—"}</span> },
    { key: "accessKey", label: "Chave de acesso", hidden: true, cell: (r) => <span className="font-mono text-[11px]">{formatKey(r.accessKey)}</span> },
    { key: "status", label: "Situação", cell: (r) => <span className="flex flex-wrap items-center gap-1"><DocStatus d={r} />{r.correctionCount ? <Badge tone="info">CC-e</Badge> : null}</span> },
    { key: "actions", label: "Ações", fixed: true, cell: (r) => <RowActions d={r} canIssue={canIssue && Boolean(s.branch)} /> },
  ];
  return (
    <>
      <PageHeader
        title="NF-e de produtos"
        crumbs={[{ label: "Fiscal" }, { label: "NF-e" }]}
        description={`Emita, acompanhe e gerencie documentos modelo 55 — período ${formatDate(from)} a ${formatDate(to)} (data de emissão). Situação conforme o último retorno real do provedor: enviado ≠ processando ≠ autorizado.`}
        actions={
          <>
            {s.ctx.branchId && canDo(s.user, "fiscal.cancel") && <DisableDialog model="nfe" series={String(cfg?.nfeSeries ?? 1)} gaps={gaps} />}
            <LinkButton href="/fiscal/configuracoes" variant="ghost"><Settings className="size-4" /> Configurações</LinkButton>
            {canIssue && (s.branch ? <LinkButton href="/fiscal/nfe/nova" variant="accent"><FilePlus2 className="size-4" /> Emitir NF-e</LinkButton> : <span className="text-xs text-slate-500">Selecione uma filial para emitir.</span>)}
          </>
        }
      />
      {s.ctx.branchId && <FiscalStatusBar cfg={cfg} model="nfe" canTest={can(s.user, "fiscal", "view")} extra={<span>Modelo 55 · Série {cfg?.nfeSeries ?? 1}</span>} />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Autorizadas no período" value={st.authorized.count} hint={`${formatMoney(st.authorized.total)} faturados (entram no faturamento fiscal)`} href={link({ status: "authorized" })} tone="good" />
        <Stat label="Em processamento" value={base.filter((r) => ["queued", "processing"].includes(r.status)).length} hint="Na fila ou aguardando retorno da SEFAZ" href={link({ status: "queued,processing" })} tone="warn" />
        <Stat label="Rejeitadas / com erro" value={base.filter((r) => ["rejected", "denied", "error"].includes(r.status)).length} hint="Precisam de correção e retransmissão (mesma referência)" href={link({ status: "rejected,denied,error" })} tone={st.rejected.count ? "bad" : "default"} />
        <Stat label="Canceladas" value={st.cancelled.count} hint={`${formatMoney(st.cancelled.total)} cancelados — fora do faturamento`} href={link({ status: "cancelled" })} />
      </div>
      <FilterBar
        basePath="/fiscal/nfe"
        values={pp}
        filters={[
          { type: "search", placeholder: "Número, chave, destinatário ou CPF/CNPJ" },
          { type: "select", name: "status", label: "Situação", options: STATUS_OPTIONS },
          { type: "select", name: "op", label: "Operação", options: [{ value: "saida", label: "Saída" }, { value: "entrada", label: "Entrada" }] },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
          { type: "select", name: "purpose", label: "Finalidade", options: [{ value: "normal", label: "Normal" }, { value: "devolucao", label: "Devolução" }, { value: "complementar", label: "Complementar" }, { value: "ajuste", label: "Ajuste" }] },
          { type: "select", name: "origin", label: "Origem", options: [{ value: "manual", label: "Avulsa" }, { value: "sale", label: "Venda" }, { value: "transfer", label: "Transferência" }, { value: "return", label: "Devolução de venda" }, { value: "purchase_order", label: "Devolução a fornecedor" }, { value: "disable", label: "Inutilização" }] },
          { type: "select", name: "sim", label: "Ambiente", options: [{ value: "0", label: "Somente reais" }, { value: "1", label: "Somente simulação" }] },
          ...(s.consolidated ? [{ type: "select" as const, name: "branch", label: "Filial", options: branches }] : []),
        ]}
      />
      <PeriodLinks basePath="/fiscal/nfe" params={params} from={from} to={to} />
      <StatusTabs
        basePath="/fiscal/nfe"
        params={pp}
        tabs={[
          { label: "Todas", status: "", count: base.length },
          { label: "Autorizadas", status: "authorized", count: count("authorized") },
          { label: "Processando", status: "queued,processing", count: count("queued,processing") },
          { label: "Com erro", status: "rejected,denied,error", count: count("rejected,denied,error") },
          { label: "Rascunhos e pendências", status: "draft,pending", count: count("draft,pending") },
          { label: "Canceladas", status: "cancelled", count: count("cancelled") },
          { label: "Descartadas/inutilizadas", status: "discarded,unused", count: count("discarded,unused") },
        ]}
      />
      <DataTable
        id="fiscal-nfe"
        basePath="/fiscal/nfe"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="fiscal-nfe"
        rowHref={(r) => `/fiscal/nfe/${r.id}`}
        totals={{ total: formatMoney(all.reduce((a, r) => a + (r.total ?? 0), 0)) }}
        footer={<p className="border-t border-line px-3 py-2 text-xs text-slate-500">Total do recorte soma todos os documentos listados (inclusive cancelados/rejeitados); o faturamento considera apenas autorizadas. {st.simulated ? <span className="text-fuchsia-800">{st.simulated} documento(s) do período são de SIMULAÇÃO — sem validade fiscal.</span> : null}</p>}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma NF-e no recorte. {canIssue && s.branch && <Link className="text-brand-700 underline" href="/fiscal/nfe/nova">Emitir NF-e</Link>}</div>}
      />
    </>
  );
}
