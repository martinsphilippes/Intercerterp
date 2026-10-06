import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { lookups } from "@/lib/server/lookups";
import { COMPENSATION_LABEL, REFUND_METHOD_LABEL } from "@/domain/sales";
import { queryReturns, salesPeriod, type ReturnRow } from "../queries";

export const metadata = { title: "Trocas e devoluções" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("sales");
  const params = await searchParams;
  const p = parseList(params, { sort: "createdAt", dir: "desc" });
  const { from, to } = salesPeriod(p.f);
  const all = await queryReturns(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const branches = await lookups.branches(s.ctx);
  const sum = (arr: ReturnRow[]) => arr.reduce((a, r) => a + r.itemsTotal, 0);
  const vouchersOpen = all.filter((r) => (r.voucherBalance ?? 0) > 0);
  const pendingExchanges = all.filter((r) => r.kind === "exchange" && !r.exchangeSaleId);
  const base = "/vendas/devolucoes";
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  const columns: Column<ReturnRow>[] = [
    { key: "number", label: "Devolução", sortable: true, fixed: true, cell: (r) => `nº ${r.number}` },
    { key: "createdAt", label: "Data", sortable: true, cell: (r) => formatDateTime(r.createdAt) },
    { key: "branchName", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branchName },
    { key: "saleNumber", label: "Venda", sortable: true, cell: (r) => <Link className="text-brand-700 hover:underline" href={`/vendas/${r.saleId}`}>nº {r.saleNumber}</Link> },
    { key: "customerName", label: "Cliente", sortable: true, cell: (r) => r.customerName },
    { key: "compensation", label: "Compensação", cell: (r) => `${COMPENSATION_LABEL[r.compensation] ?? r.compensation}${r.refundMethod ? ` — ${REFUND_METHOD_LABEL[r.refundMethod] ?? r.refundMethod}` : ""}` },
    { key: "reason", label: "Motivo", cell: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span> },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status} /> },
    { key: "itemsTotal", label: "Valor", align: "right", sortable: true, cell: (r) => formatMoney(r.itemsTotal) },
    { key: "costTotal", label: "Custo revertido", align: "right", sortable: true, cell: (r) => formatMoney(r.costTotal) },
    { key: "voucherCode", label: "Vale / saldo", cell: (r) => (r.voucherCode ? <span className="font-mono text-xs">{r.voucherCode}<span className="block font-sans">{formatMoney(r.voucherBalance)}</span></span> : "—") },
    { key: "exchange", label: "Troca", cell: (r) => (r.kind !== "exchange" ? "—" : r.exchangeSaleId ? <Link className="text-brand-700 hover:underline" href={`/vendas/${r.exchangeSaleId}`}>{r.difference >= 0 ? `+${formatMoney(r.difference)} pago` : `${formatMoney(-r.difference)} em vale`}</Link> : <span className="text-amber-700">aguardando nova venda</span>) },
    { key: "userName", label: "Registrado por", hidden: true, cell: (r) => r.userName },
  ];
  return (
    <>
      <PageHeader title="Trocas e devoluções" crumbs={[{ label: "Vendas e caixa" }, { label: "Trocas e devoluções" }]} description={`Devoluções de ${formatDate(from)} a ${formatDate(to)}. Para registrar uma nova, abra a venda de origem (Histórico de vendas → Troca ou devolução).`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devoluções no recorte" value={all.length} hint={`${formatMoney(sum(all))} devolvidos`} />
        <Stat label="Em vale-crédito" value={formatMoney(sum(all.filter((r) => r.compensation === "store_credit")))} href={link({ compensacao: "store_credit" })} hint={`${vouchersOpen.length} vale(s) com saldo`} />
        <Stat label="Estornos" value={formatMoney(sum(all.filter((r) => r.compensation === "refund")))} href={link({ compensacao: "refund" })} />
        <Stat label="Trocas aguardando nova venda" value={pendingExchanges.length} tone={pendingExchanges.length ? "warn" : "default"} href={link({ tipo: "exchange" })} hint={formatMoney(sum(pendingExchanges))} />
      </div>
      <FilterBar
        basePath={base}
        values={params}
        filters={[
          { type: "search", placeholder: "Nº da devolução ou venda, cliente, motivo ou vale" },
          { type: "date", name: "de", label: "De" },
          { type: "date", name: "ate", label: "Até" },
          { type: "select", name: "tipo", label: "Tipo", options: [{ value: "return", label: "Devolução" }, { value: "exchange", label: "Troca" }] },
          { type: "select", name: "compensacao", label: "Compensação", options: Object.entries(COMPENSATION_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "completed", label: "Concluída" }, { value: "processing", label: "Em processamento (estorno de cartão)" }] },
          ...(s.ctx.branchId ? [] : [{ type: "select" as const, name: "filial", label: "Filial", options: branches }]),
        ]}
      />
      <DataTable
        id="returns"
        basePath={base}
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="returns"
        rowHref={(r) => `${base}/${r.id}`}
        totals={{ itemsTotal: formatMoney(sum(all)), costTotal: formatMoney(all.reduce((a, r) => a + r.costTotal, 0)) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma troca ou devolução no recorte.</div>}
      />
    </>
  );
}
