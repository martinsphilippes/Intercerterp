import Link from "@/components/ui/link";
import { FileUp } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime, monthStart, today } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryReceipts } from "./queries";

export const metadata = { title: "Recebimento de mercadorias" };

type Row = Awaited<ReturnType<typeof queryReceipts>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const params = await searchParams;
  const p = parseList(params, { sort: "number", dir: "desc" });
  const all = await queryReceipts(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const suppliers = await lookups.suppliers(s.ctx);
  const sum = (list: Row[], k: keyof Row) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const base = await queryReceipts(s.ctx, { ...p, f: { ...p.f, status: "", divergence: "" } });
  const drafts = base.filter((r) => ["draft", "confirming"].includes(r.status));
  const month = today().slice(0, 7);
  const confirmedMonth = base.filter((r) => r.status === "confirmed" && (r.confirmedAt ?? "").slice(0, 7) === month);
  const withDiv = base.filter((r) => r.divergenceCount > 0);
  const columns: Column<Row>[] = [
    { key: "number", label: "Recebimento", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}{!r.hasXml && <span className="block text-xs font-normal text-slate-500">sem XML</span>}</span> },
    { key: "nfeNumber", label: "NF-e", cell: (r) => (r.nfeNumber ? <span>{r.nfeNumber}{r.nfeSeries ? ` / ${r.nfeSeries}` : ""}<span className="block text-xs text-slate-500">{formatDate(r.nfeIssueDate)}</span></span> : "—") },
    { key: "supplierName", label: "Fornecedor", sortable: true, cell: (r) => <Link className="hover:underline" href={`/fornecedores/${r.supplierId}`}>{r.supplierName}</Link> },
    { key: "orders", label: "Pedidos", cell: (r) => (r.orderNumbers.length ? r.orderNumbers.map((o: any) => <Link key={o.id} className="mr-1 text-brand-700 hover:underline" href={`/compras/pedidos/${o.id}`}>nº {o.number}</Link>) : <span className="text-slate-400">sem pedido</span>) },
    { key: "itemsCount", label: "Itens", align: "right", sortable: true, cell: (r) => <span>{r.itemsCount}<span className="block text-xs text-slate-500">{formatQty(r.receivedUnits)} un.</span></span> },
    { key: "invoicedTotal", label: "Faturado (NF-e)", align: "right", sortable: true, cell: (r) => formatMoney(r.invoicedTotal) },
    { key: "dueTotal", label: "Devido (recebido)", align: "right", sortable: true, cell: (r) => formatMoney(r.dueTotal) },
    { key: "divergenceCount", label: "Divergências", align: "right", sortable: true, cell: (r) => (r.divergenceCount ? <Badge tone="bad">{r.divergenceCount}</Badge> : <span className="text-slate-400">0</span>) },
    { key: "date", label: "Data", sortable: true, cell: (r) => formatDateTime(r.date) },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="receipt" status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Recebimento de mercadorias"
        crumbs={[{ label: "Compras" }, { label: "Recebimentos" }]}
        description="Importe a NF-e (XML), confira produtos e quantidades e conclua a entrada física e financeira. A mesma chave nunca gera estoque ou contas a pagar em duplicidade."
        actions={canDo(s.user, "purchase.receive") && s.ctx.branchId && <LinkButton href="/compras/recebimentos/novo" variant="accent"><FileUp className="size-4" /> Receber mercadorias</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Em conferência" value={drafts.length} hint={formatMoney(sum(drafts, "invoicedTotal")) + " faturado"} href="/compras/recebimentos?status=draft" tone={drafts.length ? "warn" : "default"} />
        <Stat label="Entradas confirmadas no mês" value={formatMoney(sum(confirmedMonth, "dueTotal"))} hint={`${confirmedMonth.length} recebimento(s) desde ${formatDate(monthStart(today()))}`} href={`/compras/recebimentos?status=confirmed&from=${monthStart(today())}`} />
        <Stat label="Com divergência" value={withDiv.length} hint="Quantidade, custo, item fora do pedido ou valor" href="/compras/recebimentos?divergence=1" tone={withDiv.length ? "bad" : "default"} />
        <Stat label="Faturado × devido (recorte)" value={formatMoney(sum(base, "invoicedTotal") - sum(base, "dueTotal"))} hint="Diferença registrada como divergência" />
      </div>
      <FilterBar
        basePath="/compras/recebimentos"
        values={params}
        filters={[
          { type: "search", placeholder: "Número, NF-e, chave de acesso ou fornecedor" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "draft", label: "Em conferência" }, { value: "confirmed", label: "Confirmado" }, { value: "cancelled", label: "Cancelado" }] },
          { type: "select", name: "supplier", label: "Fornecedor", options: suppliers },
          { type: "select", name: "divergence", label: "Divergência", options: [{ value: "1", label: "Somente com divergência" }] },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
        ]}
      />
      <DataTable
        id="receipts"
        basePath="/compras/recebimentos"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="receipts"
        rowHref={(r) => `/compras/recebimentos/${r.id}`}
        totals={{ invoicedTotal: formatMoney(sum(all, "invoicedTotal")), dueTotal: formatMoney(sum(all, "dueTotal")), divergenceCount: sum(all, "divergenceCount") }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum recebimento no recorte.</div>}
      />
    </>
  );
}
