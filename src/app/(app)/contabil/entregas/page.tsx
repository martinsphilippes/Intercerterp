import Link from "@/components/ui/link";
import { Download } from "lucide-react";
import { requireFirmSession } from "../guard";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/empty";
import { paginate, parseList, sp, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime, formatMonth, monthEnd, monthStart } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { listDeliveries } from "@/domain/accounting";
import { queryPortfolio, portfolioRefs } from "../queries";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Caixa de entrada" };

const DELIVERY_STATUS = [
  { value: "received", label: "Recebida — a conferir" },
  { value: "reviewed", label: "Conferida" },
];
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const formatSize = (bytes: number | null | undefined) => {
  const b = Number(bytes) || 0;
  return b < 1024 * 1024 ? `${(b / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB` : `${(b / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

interface Row {
  id: string;
  clientId: string;
  clientName: string;
  clientCode: string | null;
  period: string;
  periodFrom: string | null;
  periodTo: string | null;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  xmlCount: number;
  simulatedXml: number;
  missingXml: number;
  docs: number;
  receivedAt: string;
  status: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  notes: string | null;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireFirmSession();
  const params = await searchParams;
  const p = parseList(params, { sort: "receivedAt", dir: "desc" });
  const clientId = sp(params, "cliente").trim();
  const status = sp(params, "status").trim();
  const periodInput = sp(params, "periodo").trim();
  const periodOk = !periodInput || PERIOD_RE.test(periodInput);
  const period = periodOk ? periodInput : "";
  const filtered = Boolean(clientId || status || period);

  const [deliveries, clients, refs] = await Promise.all([
    listDeliveries(s.ctx, { clientId: clientId || null, status: status || null, period: period || null }),
    queryPortfolio(s.ctx, { q: "", f: {} }),
    portfolioRefs(s.ctx),
  ]);
  // contadores da caixa inteira (independentes do recorte) para os indicadores e o estado vazio
  const all = filtered ? await listDeliveries(s.ctx, {}) : deliveries;
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const rows: Row[] = deliveries.map((d) => {
    const c = clientById.get(d.clientId);
    return {
      id: d.id,
      clientId: d.clientId,
      clientName: c?.name ?? "Cliente fora da carteira",
      clientCode: c?.code ?? null,
      period: d.period,
      periodFrom: d.periodFrom ?? d.payload?.from ?? null,
      periodTo: d.periodTo ?? d.payload?.to ?? null,
      fileId: d.fileId,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes ?? 0,
      xmlCount: d.payload?.xmlCount ?? 0,
      simulatedXml: d.payload?.simulatedXml ?? 0,
      missingXml: d.payload?.missingXml ?? 0,
      docs: d.payload?.docs ?? 0,
      receivedAt: d.receivedAt,
      status: d.status,
      reviewedAt: d.reviewedAt ?? null,
      reviewedByName: d.reviewedBy ? (refs.userName.get(d.reviewedBy) ?? "—") : null,
      notes: d.notes ?? null,
    };
  });
  const { rows: pageRows, total } = paginate(rows, p);
  const canReview = can(s.user, "accounting", "edit");
  const toReview = all.filter((d) => d.status === "received").length;
  const reviewed = all.filter((d) => d.status === "reviewed").length;
  const clientsWithDeliveries = new Set(all.map((d) => d.clientId)).size;
  const lastPeriod = all.reduce<string | null>((a, d) => (a && a >= d.period ? a : d.period), null);
  const sum = (k: "xmlCount" | "docs" | "missingXml") => rows.reduce((a, r) => a + r[k], 0);

  const columns: Column<Row>[] = [
    {
      key: "clientName", label: "Cliente", sortable: true, fixed: true, className: "min-w-[150px]",
      cell: (r) => (
        <span className="block">
          <span className="font-medium">{r.clientName}</span>
          {r.clientCode && <span className="block text-xs font-normal text-slate-500">{r.clientCode}</span>}
        </span>
      ),
    },
    {
      key: "period", label: "Período", sortable: true,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          {formatMonth(r.period)}
          {/* pacote parcial (não cobre o mês inteiro): mostra o intervalo exato */}
          {r.periodFrom && r.periodTo && (r.periodFrom !== monthStart(r.periodFrom) || r.periodTo !== monthEnd(r.periodFrom)) && (
            <span className="block text-xs text-slate-500">{formatDate(r.periodFrom)} a {formatDate(r.periodTo)}</span>
          )}
        </span>
      ),
    },
    {
      key: "file", label: "Arquivo",
      cell: (r) => (
        <span className="block">
          <a href={`/api/files/${r.fileId}`} className="inline-flex max-w-[200px] items-center gap-1 text-brand-700 hover:underline" title={`Baixar ${r.fileName}`}>
            <Download className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{r.fileName}</span>
          </a>
          <span className="block text-xs text-slate-500">{formatSize(r.sizeBytes)}</span>
        </span>
      ),
    },
    {
      key: "xmlCount", label: "Conteúdo", sortable: true,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="tabular">{r.xmlCount.toLocaleString("pt-BR")} XML · {r.docs.toLocaleString("pt-BR")} {r.docs === 1 ? "documento" : "documentos"}</span>
          {r.missingXml > 0 && <Badge tone="warn" className="ml-1.5">{r.missingXml.toLocaleString("pt-BR")} XML {r.missingXml === 1 ? "ausente" : "ausentes"}</Badge>}
          {r.simulatedXml > 0 && <span className="block text-xs text-fuchsia-700">{r.simulatedXml.toLocaleString("pt-BR")} de simulação</span>}
        </span>
      ),
    },
    { key: "receivedAt", label: "Recebida em", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.receivedAt)}</span> },
    {
      key: "status", label: "Situação", sortable: true,
      cell: (r) => (
        <span className="block">
          <StatusBadge kind="delivery" status={r.status} />
          {r.status === "reviewed" && r.reviewedAt && (
            <span className="mt-1 block text-xs text-slate-500">
              por {r.reviewedByName ?? "—"} · <span className="whitespace-nowrap">{formatDateTime(r.reviewedAt)}</span>
            </span>
          )}
          {r.notes && (
            <span className="block max-w-[220px] text-xs italic text-slate-600" title={r.notes}>
              “{r.notes}”
            </span>
          )}
        </span>
      ),
    },
    {
      key: "actions", label: "Ação", fixed: true,
      cell: (r) => (canReview ? <ReviewForm id={r.id} status={r.status} fileName={r.fileName} notes={r.notes} /> : <span className="text-xs text-slate-400">Somente consulta</span>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Caixa de entrada"
        crumbs={[{ label: "Carteira" }, { label: "Caixa de entrada" }]}
        description="Entregas recebidas automaticamente das empresas vinculadas ao ERP: o pacote mensal de XMLs e relatórios chega aqui assim que a empresa o gera, pronto para conferência e download."
      />
      <section aria-label="Resumo da caixa de entrada" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="A conferir" value={toReview.toLocaleString("pt-BR")} href="/contabil/entregas?status=received" tone={toReview ? "warn" : "default"} hint="Recebidas e ainda não conferidas" />
        <Stat label="Conferidas" value={reviewed.toLocaleString("pt-BR")} href="/contabil/entregas?status=reviewed" hint="Podem ser reabertas se necessário" />
        <Stat label="Clientes com entregas" value={clientsWithDeliveries.toLocaleString("pt-BR")} href="/contabil/clientes?vinculo=active" hint="Somente empresas vinculadas enviam pacotes" />
        <Stat label="Último período recebido" value={lastPeriod ? formatMonth(lastPeriod) : "—"} href={lastPeriod ? `/contabil/entregas?periodo=${lastPeriod}` : undefined} hint={lastPeriod ? "Abre as entregas desse mês" : "Nenhum pacote recebido ainda"} />
      </section>
      <FilterBar
        basePath="/contabil/entregas"
        values={params}
        filters={[
          { type: "select", name: "cliente", label: "Cliente", options: clients.map((c) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name })) },
          { type: "select", name: "status", label: "Situação", options: DELIVERY_STATUS, all: "Todas" },
          { type: "text", name: "periodo", label: "Período (AAAA-MM)", placeholder: "AAAA-MM" },
        ]}
      />
      {!periodOk && (
        <div className="mb-4">
          <Notice tone="warn">Período “{periodInput}” inválido: informe ano e mês no formato AAAA-MM. O filtro de período foi ignorado.</Notice>
        </div>
      )}
      <DataTable
        id="accounting-deliveries"
        basePath="/contabil/entregas"
        params={params}
        columns={columns}
        rows={pageRows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(r) => `/contabil/clientes/${r.clientId}`}
        exportKey={canDo(s.user, "data.export") ? "accounting_deliveries" : undefined}
        totals={rows.length ? { xmlCount: `${sum("xmlCount").toLocaleString("pt-BR")} XML · ${sum("docs").toLocaleString("pt-BR")} doc.${sum("missingXml") ? ` · ${sum("missingXml").toLocaleString("pt-BR")} ausente(s)` : ""}` } : undefined}
        empty={
          all.length === 0 ? (
            <EmptyState
              title="Nenhuma entrega na caixa de entrada"
              description="As entregas chegam sozinhas: quando uma empresa vinculada ao ERP gera o pacote mensal de XMLs e relatórios, ele aparece aqui para conferência, sem pedir nem anexar arquivos. Para receber, vincule o cliente pela ficha dele (código de vínculo aceito pela empresa no ERP)."
              action={
                <Link href="/contabil/clientes" className="text-sm text-brand-700 underline">
                  Ir para os clientes
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="Nenhuma entrega no recorte"
              description="Ajuste os filtros de cliente, situação ou período."
              action={
                <Link href="/contabil/entregas" className="text-sm text-brand-700 underline">
                  Limpar filtros
                </Link>
              }
            />
          )
        }
      />
    </>
  );
}
