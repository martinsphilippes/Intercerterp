import Link from "next/link";
import { FilePlus2, Package, RefreshCw } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Stat } from "@/components/ui/card";
import { ActionButton } from "@/components/ui/action-form";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatBps, formatMoney, roundDiv } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getFiscalConfig } from "@/domain/fiscal/service";
import { queryDocuments, listPeriod, sliceStats, type DocRow } from "../queries";
import { STATUS_OPTIONS } from "../labels";
import { DocStatus, FiscalStatusBar, RowActions, StatusTabs } from "../_components/list-parts";
import { PeriodLinks } from "../_components/period-links";
import { batchRetransmitAction } from "../actions";

export const metadata = { title: "NFS-e" };

const inStatus = (r: DocRow, st: string) => !st || st.split(",").includes(r.status);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  const params = await searchParams;
  const p = parseList(params, { sort: "issuedAt", dir: "desc" });
  const base = await queryDocuments(s.ctx, "nfse", { ...p, f: { ...p.f, status: "" } });
  const status = p.f.status ?? "";
  const all = base.filter((r) => inStatus(r, status));
  const { rows, total } = paginate(all, p);
  const st = sliceStats(base);
  const { from, to } = listPeriod(p);
  const pp = { ...params, from, to };
  const branches = s.consolidated ? await lookups.branches(s.ctx) : [];
  const cfg = s.ctx.branchId ? await getFiscalConfig(s.ctx.store, s.ctx.companyId, s.ctx.branchId) : null;
  const link = (extra: Record<string, string | null>) => `/fiscal/nfse${qs({ ...extra, page: null }, pp)}`;
  const canIssue = can(s.user, "fiscal", "create") && canDo(s.user, "fiscal.issue");
  const authorized = base.filter((r) => r.status === "authorized");
  const issDue = authorized.reduce((a, r) => a + (r.service?.issDue ?? (r.service?.issWithheld ? 0 : r.issValue)), 0);
  const issBase = authorized.reduce((a, r) => a + (r.service?.base ?? 0), 0);
  const avgRate = issBase ? roundDiv(authorized.reduce((a, r) => a + r.issValue, 0) * 10000, issBase) : 0;
  const processing = base.filter((r) => ["queued", "processing"].includes(r.status));
  const errors = base.filter((r) => ["rejected", "denied", "error"].includes(r.status));
  const count = (x: string) => base.filter((r) => inStatus(r, x)).length;
  const cities = [...new Set(base.map((r) => r.serviceCity).filter(Boolean) as string[])];
  if (s.branch?.cityCode && !cities.includes(s.branch.cityCode)) cities.unshift(s.branch.cityCode);
  const columns: Column<DocRow>[] = [
    { key: "number", label: "NFS-e / RPS", sortable: true, fixed: true, cell: (r) => <span>{r.number ? `NFS-e ${r.number}` : r.status === "draft" ? "Rascunho" : ["rejected", "denied", "error"].includes(r.status) ? "Não gerada" : "Aguardando"}<span className="block text-xs font-normal text-slate-500">{r.rpsNumber ? `RPS ${r.rpsNumber}/${r.rpsSeries ?? "1"}` : "Sem RPS"}</span></span> },
    { key: "issuedAt", label: "Emissão", sortable: true, cell: (r) => formatDateTime(r.issuedAt) },
    { key: "recipientName", label: "Tomador", sortable: true, cell: (r) => <span>{r.recipientLabel}{r.recipientDoc && <span className="block text-xs text-slate-500">{formatDoc(r.recipientDoc)}</span>}</span> },
    { key: "serviceItem", label: "Serviço", cell: (r) => <span className="block max-w-xs truncate" title={r.serviceDescription ?? ""}>{r.serviceDescription ?? "—"}<span className="block text-xs text-slate-500">{["rejected", "error"].includes(r.status) && r.statusMessage ? <span className="text-red-700">{r.statusMessage.slice(0, 60)}</span> : `LC 116: ${r.serviceItem ?? "—"}`}</span></span> },
    { key: "competence", label: "Competência", sortable: true, hidden: true, cell: (r) => formatDate(r.competence) },
    ...(s.consolidated ? [{ key: "branchName", label: "Filial", cell: (r: DocRow) => r.branchName }] : []),
    { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    { key: "issValue", label: "ISS", align: "right", sortable: true, cell: (r) => <span>{formatMoney(r.issValue)}{r.issWithheld ? <span className="block text-xs text-slate-500">retido</span> : null}</span> },
    { key: "netValue", label: "Líquido", align: "right", hidden: true, cell: (r) => formatMoney(r.netValue) },
    { key: "verificationCode", label: "Cód. verificação", hidden: true, cell: (r) => r.verificationCode ?? "—" },
    { key: "status", label: "Situação", cell: (r) => <DocStatus d={r} /> },
    { key: "actions", label: "Ações", fixed: true, cell: (r) => <RowActions d={r} canIssue={canIssue && Boolean(s.branch)} /> },
  ];
  return (
    <>
      <PageHeader
        title="NFS-e de serviços"
        crumbs={[{ label: "Fiscal" }, { label: "NFS-e" }]}
        description={`Emita e acompanhe notas de serviço, RPS e retenções — período ${formatDate(from)} a ${formatDate(to)}. Padrão: ${cfg?.nfseStandard === "nacional" ? "NFS-e nacional (DPS, /v2/nfsen)" : "municipal via provedor (/v2/nfse)"}.`}
        actions={
          <>
            <LinkButton href="/produtos?tipo=service" variant="ghost"><Package className="size-4" /> Cadastro de serviços</LinkButton>
            {canIssue && s.branch && <ActionButton action={batchRetransmitAction.bind(null, "nfse")} label="Consultar RPS" icon={<RefreshCw className="size-4" />} title="Consulta os RPS em processamento e retransmite os pendentes (mesma referência)" />}
            {canIssue && (s.branch ? <LinkButton href="/fiscal/nfse/nova" variant="accent"><FilePlus2 className="size-4" /> Emitir NFS-e</LinkButton> : <span className="text-xs text-slate-500">Selecione uma filial para emitir.</span>)}
          </>
        }
      />
      {s.ctx.branchId && <FiscalStatusBar cfg={cfg} model="nfse" canTest={can(s.user, "fiscal", "view")} extra={<span>Prestador: {s.branch?.cityName ?? "—"}/{s.branch?.uf ?? "—"} (IBGE {s.branch?.cityCode ?? "—"}) · IM {s.branch?.im ?? "—"}</span>} />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Emitidas no período" value={authorized.length} hint={`${formatMoney(st.authorized.total)} em serviços`} href={link({ status: "authorized" })} tone="good" />
        <Stat label="RPS em processamento" value={processing.length} hint="Aguardando retorno do provedor/prefeitura" href={link({ status: "queued,processing" })} tone={processing.length ? "warn" : "default"} />
        <Stat label="Com erro" value={errors.length} hint={errors[0]?.statusMessage?.slice(0, 60) ?? "Sem rejeições no período"} href={link({ status: "rejected,denied,error" })} tone={errors.length ? "bad" : "default"} />
        <Stat label="ISS devido (não retido)" value={formatMoney(issDue)} hint={`Alíquota média ${formatBps(avgRate)} · somente autorizadas`} href={link({ status: "authorized" })} />
      </div>
      <FilterBar
        basePath="/fiscal/nfse"
        values={pp}
        filters={[
          { type: "search", placeholder: "Número, RPS, tomador ou CNPJ/CPF" },
          { type: "select", name: "status", label: "Situação", options: STATUS_OPTIONS.filter((o) => o.value !== "unused") },
          { type: "select", name: "city", label: "Município da prestação", options: cities.map((c) => ({ value: c, label: c === s.branch?.cityCode ? `${c} — ${s.branch?.cityName}` : c })), all: "Todos os municípios" },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
          { type: "select", name: "sim", label: "Ambiente", options: [{ value: "0", label: "Somente reais" }, { value: "1", label: "Somente simulação" }] },
          ...(s.consolidated ? [{ type: "select" as const, name: "branch", label: "Filial", options: branches }] : []),
        ]}
      />
      <PeriodLinks basePath="/fiscal/nfse" params={params} from={from} to={to} />
      <StatusTabs
        basePath="/fiscal/nfse"
        params={pp}
        tabs={[
          { label: "Todas", status: "", count: base.length },
          { label: "Emitidas", status: "authorized", count: count("authorized") },
          { label: "RPS pendentes", status: "queued,processing,pending", count: count("queued,processing,pending") },
          { label: "Com erro", status: "rejected,denied,error", count: count("rejected,denied,error") },
          { label: "Rascunhos", status: "draft", count: count("draft") },
          { label: "Canceladas", status: "cancelled,discarded", count: count("cancelled,discarded") },
        ]}
      />
      <DataTable
        id="fiscal-nfse"
        basePath="/fiscal/nfse"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="fiscal-nfse"
        rowHref={(r) => `/fiscal/nfse/${r.id}`}
        totals={{ total: formatMoney(all.reduce((a, r) => a + (r.total ?? 0), 0)), issValue: formatMoney(all.reduce((a, r) => a + r.issValue, 0)), netValue: formatMoney(all.reduce((a, r) => a + r.netValue, 0)) }}
        footer={st.simulated ? <p className="border-t border-line px-3 py-2 text-xs text-fuchsia-800">{st.simulated} NFS-e do período são de SIMULAÇÃO — sem validade fiscal.</p> : null}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma NFS-e no recorte. {canIssue && s.branch && <Link className="text-brand-700 underline" href="/fiscal/nfse/nova">Emitir NFS-e</Link>}</div>}
      />
    </>
  );
}
