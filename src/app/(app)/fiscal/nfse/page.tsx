import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { SimBadge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getFiscalConfig } from "@/domain/fiscal/service";
import { queryDocuments, listPeriod, sliceStats, type DocRow } from "../queries";
import { STATUS_OPTIONS } from "../labels";

export const metadata = { title: "NFS-e" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  const params = await searchParams;
  const p = parseList(params, { sort: "issuedAt", dir: "desc" });
  const all = await queryDocuments(s.ctx, "nfse", p);
  const { rows, total } = paginate(all, p);
  const st = sliceStats(all);
  const { from, to } = listPeriod(p);
  const branches = s.consolidated ? await lookups.branches(s.ctx) : [];
  const cfg = s.ctx.branchId ? await getFiscalConfig(s.ctx.store, s.ctx.companyId, s.ctx.branchId) : null;
  const link = (extra: Record<string, string | null>) => `/fiscal/nfse${qs({ ...extra, page: null }, { ...params, from, to })}`;
  const canIssue = can(s.user, "fiscal", "create") && canDo(s.user, "fiscal.issue");
  const authorized = all.filter((r) => r.status === "authorized");
  const iss = authorized.reduce((a, r) => a + r.issValue, 0);
  const issW = authorized.reduce((a, r) => a + r.issWithheld, 0);
  const net = authorized.reduce((a, r) => a + r.netValue, 0);
  const columns: Column<DocRow>[] = [
    { key: "number", label: "NFS-e / RPS", sortable: true, fixed: true, cell: (r) => <span>{r.number ? `nº ${r.number}` : "—"}<span className="block text-xs text-slate-500">{r.rpsNumber ? `RPS ${r.rpsNumber}/${r.rpsSeries ?? "1"}` : "RPS na transmissão"}</span></span> },
    { key: "issuedAt", label: "Emissão", sortable: true, cell: (r) => formatDateTime(r.issuedAt) },
    { key: "competence", label: "Competência", sortable: true, cell: (r) => formatDate(r.competence) },
    { key: "recipientName", label: "Tomador", sortable: true, cell: (r) => <span>{r.recipientLabel}{r.recipientDoc && <span className="block text-xs text-slate-500">{formatDoc(r.recipientDoc)}</span>}</span> },
    { key: "serviceItem", label: "Item LC 116", cell: (r) => r.serviceItem ?? "—" },
    ...(s.consolidated ? [{ key: "branchName", label: "Filial", cell: (r: DocRow) => r.branchName }] : []),
    { key: "verificationCode", label: "Cód. verificação", hidden: true, cell: (r) => r.verificationCode ?? "—" },
    { key: "status", label: "Situação", cell: (r) => <span className="flex items-center gap-1"><StatusBadge kind="fiscal" status={r.status} /><SimBadge show={Boolean(r.isSimulated)} /></span> },
    { key: "total", label: "Serviços", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    { key: "issValue", label: "ISS", align: "right", sortable: true, cell: (r) => formatMoney(r.issValue) },
    { key: "issWithheld", label: "ISS retido", align: "right", hidden: true, cell: (r) => (r.issWithheld ? formatMoney(r.issWithheld) : "—") },
    { key: "netValue", label: "Líquido", align: "right", sortable: true, cell: (r) => formatMoney(r.netValue) },
  ];
  return (
    <>
      <PageHeader
        title="Gestão e emissão de NFS-e"
        crumbs={[{ label: "Fiscal" }, { label: "NFS-e" }]}
        description={`Notas de serviço — período ${formatDate(from)} a ${formatDate(to)}. Padrão configurado: ${cfg?.nfseStandard === "nacional" ? "NFS-e nacional (DPS)" : "municipal via provedor"}.`}
        actions={
          <>
            <LinkButton href="/produtos?tipo=service" variant="ghost"><Package className="size-4" /> Cadastro de serviços</LinkButton>
            {canIssue && (s.branch ? <LinkButton href="/fiscal/nfse/nova" variant="primary"><Plus className="size-4" /> Nova NFS-e</LinkButton> : <span className="text-xs text-slate-500">Selecione uma filial para emitir.</span>)}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Autorizadas (serviços)" value={formatMoney(st.authorized.total)} hint={`${st.authorized.count} NFS-e · líquido ${formatMoney(net)}`} href={link({ status: "authorized" })} tone="good" />
        <Stat label="ISS calculado / retido" value={`${formatMoney(iss)} / ${formatMoney(issW)}`} hint="Somente autorizadas do recorte" href={link({ status: "authorized" })} />
        <Stat label="Pendentes / processando" value={st.pending.count} hint="RPS em lote, fila, rascunho ou erro" href={link({ status: "draft,pending,queued,processing,error" })} tone={st.pending.count ? "warn" : "default"} />
        <Stat label="Rejeitadas / canceladas" value={`${st.rejected.count} / ${st.cancelled.count}`} href={link({ status: "rejected,denied,cancelled" })} tone={st.rejected.count ? "bad" : "default"} />
      </div>
      <FilterBar
        basePath="/fiscal/nfse"
        values={{ ...params, from, to }}
        filters={[
          { type: "search", placeholder: "Número, RPS, tomador ou CPF/CNPJ" },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
          { type: "select", name: "status", label: "Situação", options: STATUS_OPTIONS.filter((o) => o.value !== "unused") },
          { type: "select", name: "sim", label: "Ambiente", options: [{ value: "0", label: "Somente reais" }, { value: "1", label: "Somente simulação" }] },
          ...(s.consolidated ? [{ type: "select" as const, name: "branch", label: "Filial", options: branches }] : []),
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
        totals={{ total: formatMoney(st.total), issValue: formatMoney(all.reduce((a, r) => a + r.issValue, 0)), netValue: formatMoney(all.reduce((a, r) => a + r.netValue, 0)) }}
        footer={st.simulated ? <p className="border-t border-line px-3 py-2 text-xs text-fuchsia-800">{st.simulated} NFS-e do recorte são de SIMULAÇÃO — sem validade fiscal.</p> : null}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma NFS-e no recorte. {canIssue && s.branch && <Link className="text-brand-700 underline" href="/fiscal/nfse/nova">Emitir NFS-e</Link>}</div>}
      />
    </>
  );
}
