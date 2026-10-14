import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Timeline } from "@/components/ui/timeline";
import { cn } from "@/components/ui/cn";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { paginate, parseList, qs, sp, type SearchParams } from "@/lib/list";
import { canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { ACQUIRER_STATUS_LABEL, ACQUIRER_STATUS_TONE, acquirerReportLines, type AcquirerMatch, type AcquirerStatus } from "@/domain/card-reconciliation";
import { AutoPrint } from "@/app/(app)/vendas/sale-widgets";
import { PrintStyles } from "@/app/(app)/relatorios/_components/report-ui";

export const metadata = { title: "Relatório do arquivo da adquirente" };

const FILTERS = [
  { value: "", label: "Todas as linhas" },
  { value: "divergencias", label: "Somente divergências" },
  ...(Object.keys(ACQUIRER_STATUS_LABEL) as AcquirerStatus[]).map((k) => ({ value: k, label: ACQUIRER_STATUS_LABEL[k] })),
];

/** Relatório de uma conciliação com o arquivo da adquirente: baixadas, divergências e linhas não tratadas. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  await requireFeaturePage(s, "taxasCartao");
  const { id } = await params;
  const q = await searchParams;
  const imp = await s.ctx.store.get("bank_imports", id);
  if (!imp || imp.companyId !== s.ctx.companyId || imp.kind !== "acquirer") notFound();
  const filter = sp(q, "situacao");
  const print = sp(q, "print") === "1";
  const all = acquirerReportLines(imp, filter || null);
  const p = parseList(q, { pageSize: print ? 200 : 50 });
  const { rows, total } = print ? { rows: all, total: all.length } : paginate(all, { ...p, sort: null });
  const sum = imp.summary ?? {};
  const by = sum.byStatus ?? {};
  const [users, acc] = await Promise.all([nameMap(s.ctx, "users"), s.ctx.store.get("financial_accounts", imp.accountId)]);
  type L = AcquirerMatch & { id: string };
  const columns: Column<L>[] = [
    { key: "lineNo", label: "Linha", fixed: true, cell: (r) => r.lineNo },
    { key: "nsu", label: "NSU / bandeira", cell: (r) => <span className="whitespace-nowrap">{r.nsu ?? r.authCode ?? "—"}<span className="block text-xs text-slate-500">{r.brand ?? "—"}</span></span> },
    { key: "installmentLabel", label: "Parcela", cell: (r) => r.installmentLabel ?? "—" },
    { key: "creditDate", label: "Crédito", cell: (r) => <span className="whitespace-nowrap">{formatDate(r.creditDate)}{r.expectedDate && r.expectedDate !== r.creditDate && <span className="block text-xs text-slate-500">previsto {formatDate(r.expectedDate)}</span>}</span> },
    { key: "gross", label: "Bruto", align: "right", cell: (r) => formatMoney(r.gross) },
    { key: "fee", label: "Taxa cobrada", align: "right", cell: (r) => <span className={cn(r.feeDiff ? "font-medium text-amber-700" : undefined)}>{formatMoney(r.fee)}</span> },
    { key: "expectedFee", label: "Taxa prevista", align: "right", cell: (r) => (r.expectedFee == null ? "—" : formatMoney(r.expectedFee)) },
    { key: "net", label: "Líquido", align: "right", cell: (r) => formatMoney(r.net) },
    {
      key: "titleId",
      label: "Recebível",
      cell: (r) =>
        r.titleId ? (
          <span className="whitespace-nowrap text-xs">
            {r.saleId && r.saleNumber ? <Link className="text-brand-700 hover:underline" href={`/vendas/${r.saleId}`}>Venda nº {r.saleNumber}</Link> : `Título nº ${r.titleNumber ?? "—"}`}
            <Link className="block text-slate-500 hover:underline" href={`/financeiro/receber/${r.titleId}`}>ver título</Link>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      label: "Situação",
      cell: (r) => (
        <span className="block min-w-[240px]">
          <Badge tone={ACQUIRER_STATUS_TONE[r.status as AcquirerStatus] ?? "neutral"}>{ACQUIRER_STATUS_LABEL[r.status as AcquirerStatus] ?? r.status}</Badge>
          <span className="mt-0.5 block text-xs text-slate-600">{r.message}</span>
        </span>
      ),
    },
  ];
  const problems = ["divergent", "not_found", "ambiguous", "duplicate", "invalid", "error"].reduce((a, k) => a + (by[k] ?? 0), 0);
  const base = `/financeiro/cartoes/adquirente/${id}`;
  return (
    <>
      <PrintStyles />
      <PageHeader
        title={`Arquivo da adquirente — ${imp.fileName}`}
        crumbs={[{ label: "Financeiro" }, { label: "Recebíveis de cartão", href: "/financeiro/cartoes" }, { label: "Arquivo da adquirente", href: "/financeiro/cartoes/adquirente" }, { label: "Relatório" }]}
        description={`Conta ${acc?.name ?? "—"} · importado por ${users.get(imp.createdBy) ?? "—"} em ${formatDateTime(imp.createdAt)}${filter ? ` · filtro: ${FILTERS.find((f) => f.value === filter)?.label ?? filter}` : ""}`}
        actions={
          <>
            {print ? (
              <AutoPrint enabled />
            ) : (
              <Link href={`${base}${qs({ print: "1", page: null }, q)}`} className={buttonClass("secondary")}>
                <Printer className="size-4" aria-hidden /> Imprimir
              </Link>
            )}
            {canDo(s.user, "data.export") && (
              <a className={buttonClass("secondary")} href={`/api/export/fin-acquirer-lines${qs({ import: id, situacao: filter || null })}`}>
                <Download className="size-4" aria-hidden /> Exportar CSV
              </a>
            )}
            {imp.fileId && (
              <a className={buttonClass("ghost")} href={`/api/files/${imp.fileId}`}>
                <Download className="size-4" aria-hidden /> Arquivo original
              </a>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Baixadas" value={by.applied ?? 0} tone="good" hint={`Bruto ${formatMoney(sum.matchedGross ?? 0)} · taxas ${formatMoney(sum.matchedFee ?? 0)}`} href={`${base}?situacao=applied`} />
        <Stat label="Divergências" value={problems} tone={problems ? "warn" : "default"} hint="Não baixadas: valor divergente, sem correspondência, ambíguas, repetidas, inválidas" href={`${base}?situacao=divergencias`} />
        <Stat label="Já liquidadas" value={by.already_settled ?? 0} href={`${base}?situacao=already_settled`} />
        <Stat label="Crédito futuro" value={by.future ?? 0} hint="Reimporte o arquivo a partir da data do crédito" href={`${base}?situacao=future`} />
        <Stat label="Taxa cobrada × prevista" value={`${(sum.feeDiff ?? 0) > 0 ? "+ " : ""}${formatMoney(sum.feeDiff ?? 0)}`} tone={(sum.feeDiff ?? 0) > 0 ? "bad" : "default"} hint={`${sum.withFlags ?? 0} linha(s) baixada(s) com diferença`} />
      </div>
      <Card title="Resumo" className="mb-4">
        <DefinitionList
          cols={4}
          items={[
            { label: "Linhas lidas", value: sum.lines ?? 0 },
            { label: "Bruto do arquivo", value: formatMoney(sum.gross ?? 0) },
            { label: "Taxas do arquivo", value: formatMoney(sum.fee ?? 0) },
            { label: "Líquido do arquivo", value: formatMoney(sum.net ?? 0) },
            { label: "Taxa prevista das baixadas", value: formatMoney(sum.expectedFee ?? 0) },
            { label: "Conta de crédito", value: acc?.name ?? "—" },
            { label: "Situação", value: imp.status === "completed" ? "Concluída" : "Em processamento (reaplique o arquivo para concluir)" },
            { label: "Identidade do arquivo", value: <code className="text-xs">{String(imp.fileHash ?? "").slice(0, 16)}…</code> },
          ]}
        />
      </Card>
      <form method="get" action={base} className="no-print mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
        <label className="flex min-w-[220px] flex-col gap-1 text-xs font-medium text-slate-600">
          Situação
          <select name="situacao" defaultValue={filter} className="h-9 rounded-md border border-line bg-white px-2 text-sm">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass("primary")}>
          Filtrar
        </button>
      </form>
      <DataTable id="fin-acquirer-lines" basePath={base} params={q} columns={columns} rows={rows} total={total} page={print ? 1 : p.page} pageSize={print ? Math.max(1, total) : p.pageSize} empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma linha nesta situação.</div>} />
      {!print && (
        <Card title="Histórico" className="mt-4">
          <Timeline store={s.ctx.store} refs={[`bank_import:${id}`]} />
        </Card>
      )}
    </>
  );
}
