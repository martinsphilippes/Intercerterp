import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { ORDER_STATUS_LABEL } from "@/domain/purchase-calc";
import { queryOrders } from "./queries";

export const metadata = { title: "Pedidos de compra" };

type Row = Awaited<ReturnType<typeof queryOrders>>[number];
const ORIGIN: Record<string, string> = { manual: "Manual", quotation: "Cotação", replenishment: "Reposição" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const params = await searchParams;
  const p = parseList(params, { sort: "number", dir: "desc" });
  const all = await queryOrders(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const suppliers = await lookups.suppliers(s.ctx);
  const sum = (list: Row[], k: keyof Row) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  // indicadores sobre a mesma consulta, sem o filtro de situação (cada um abre o recorte correspondente)
  const base = await queryOrders(s.ctx, { ...p, f: { ...p.f, status: "" } });
  const pending = base.filter((r) => ["draft", "in_review", "adjust"].includes(r.status));
  const toSend = base.filter((r) => r.awaitingSend);
  const open = base.filter((r) => ["approved", "sent", "partial"].includes(r.status));
  const late = open.filter((r) => r.overdue);
  const qsKeep = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p.f)) if (k !== "status" && k !== "late" && v) u.set(k, v);
    if (p.q) u.set("q", p.q);
    for (const [k, v] of Object.entries(extra)) u.set(k, v);
    return `/compras/pedidos?${u.toString()}`;
  };
  const columns: Column<Row>[] = [
    { key: "number", label: "Pedido", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}{(r.revision ?? 1) > 1 && <span className="ml-1 text-xs font-normal text-slate-500">rev. {r.revision}</span>}</span> },
    { key: "supplierName", label: "Fornecedor", sortable: true, cell: (r) => <Link className="hover:underline" href={`/fornecedores/${r.supplierId}`}>{r.supplierName}</Link> },
    { key: "branchName", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branchName },
    { key: "origin", label: "Origem", cell: (r) => (r.quotationId ? <Link className="hover:underline" href={`/compras/cotacoes/${r.quotationId}`}>{ORIGIN[r.origin] ?? r.origin}</Link> : ORIGIN[r.origin] ?? r.origin) },
    { key: "createdAt", label: "Criado em", sortable: true, cell: (r) => formatDate(r.createdAt) },
    { key: "expectedDate", label: "Previsão", sortable: true, cell: (r) => <span className={r.overdue ? "text-red-700" : undefined}>{formatDate(r.expectedDate)}</span> },
    { key: "paymentTermsText", label: "Pagamento", hidden: true, cell: (r) => r.paymentTermsText ?? "—" },
    { key: "freight", label: "Frete", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.freight) },
    { key: "total", label: "Total", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    { key: "receivedValue", label: "Recebido", align: "right", sortable: true, cell: (r) => (r.receivedValue ? formatMoney(r.receivedValue) : "—") },
    { key: "remainingValue", label: "Saldo a receber", align: "right", sortable: true, cell: (r) => (r.remainingValue ? formatMoney(r.remainingValue) : "—") },
    { key: "status", label: "Situação", cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge kind="purchase" status={r.status} />{r.awaitingSend && r.status === "sent" && <Badge tone="warn">revisão não enviada</Badge>}</span> },
  ];
  return (
    <>
      <PageHeader
        title="Pedidos de compra"
        crumbs={[{ label: "Compras" }, { label: "Pedidos" }]}
        description={`${s.ctx.branchId ? `Filial ${s.branch?.name}` : "Todas as filiais (consolidado)"}. Aprovação não significa envio: registre o envio e o recebimento separadamente.`}
        actions={can(s.user, "purchases", "create") && s.ctx.branchId && <LinkButton href="/compras/pedidos/novo" variant="primary"><Plus className="size-4" /> Novo pedido</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Em rascunho, análise ou ajuste" value={formatMoney(sum(pending, "total"))} hint={`${pending.length} pedido(s)`} href={qsKeep({ status: "pending" })} />
        <Stat label="Aprovados aguardando envio" value={formatMoney(sum(toSend, "total"))} hint={`${toSend.length} pedido(s)`} href={qsKeep({ status: "to_send" })} tone={toSend.length ? "warn" : "default"} />
        <Stat label="Saldo a receber" value={formatMoney(sum(open, "remainingValue"))} hint={`${open.length} aprovados/enviados/parciais`} href={qsKeep({ status: "open" })} />
        <Stat label="Entregas atrasadas" value={late.length} hint="Previsão vencida com saldo a receber" href={qsKeep({ status: "open", late: "1" })} tone={late.length ? "bad" : "default"} />
      </div>
      <FilterBar
        basePath="/compras/pedidos"
        values={params}
        filters={[
          { type: "search", placeholder: "Número do pedido ou fornecedor" },
          {
            type: "select",
            name: "status",
            label: "Situação",
            options: [
              { value: "pending", label: "Rascunho/análise/ajuste" },
              { value: "open", label: "Em aberto (a receber)" },
              { value: "to_send", label: "Aprovados a enviar" },
              ...Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ],
          },
          { type: "select", name: "supplier", label: "Fornecedor", options: suppliers },
          { type: "select", name: "origin", label: "Origem", options: Object.entries(ORIGIN).map(([value, label]) => ({ value, label })) },
          { type: "date", name: "from", label: "Criado de" },
          { type: "date", name: "to", label: "até" },
        ]}
      />
      <DataTable
        id="purchase-orders"
        basePath="/compras/pedidos"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="purchase_orders"
        rowHref={(r) => `/compras/pedidos/${r.id}`}
        totals={{ total: formatMoney(sum(all, "total")), receivedValue: formatMoney(sum(all, "receivedValue")), remainingValue: formatMoney(sum(all, "remainingValue")), freight: formatMoney(sum(all, "freight")) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum pedido no recorte.</div>}
      />
    </>
  );
}
