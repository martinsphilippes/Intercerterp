import Link from "@/components/ui/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatPhone } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { ORDER_STATUS_LABEL, QUOTE_STATUS_LABEL, type SalesDocType } from "@/domain/sales-documents";
import { docsPeriod, queryDocuments, type DocRow } from "./queries";

/** Lista de orçamentos ou pedidos de venda (mesma consulta para tela e filtros; período pela data de criação). */
export async function DocumentsList({ type, searchParams }: { type: SalesDocType; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("sales");
  await requireFeaturePage(s, "documentoComercial");
  const params = await searchParams;
  const p = parseList(params, { sort: "createdAt", dir: "desc" });
  const quote = type === "quote";
  const base = quote ? "/vendas/orcamentos" : "/vendas/pedidos";
  const all = await queryDocuments(s.ctx, type, p);
  const { rows, total } = paginate(all, p);
  const { from, to } = docsPeriod(p.f);
  const [customers, users, branches] = await Promise.all([lookups.customers(s.ctx), lookups.users(s.ctx), lookups.branches(s.ctx)]);
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  const sum = (list: DocRow[]) => list.reduce((a, r) => a + r.total, 0);
  const labels = quote ? QUOTE_STATUS_LABEL : ORDER_STATUS_LABEL;
  const canCreate = Boolean(s.ctx.branchId) && canDo(s.user, quote ? "sales_doc.quote" : "sales_doc.order");
  const stats = quote
    ? [
        { label: "Em aberto", list: all.filter((r) => ["draft", "sent", "approved"].includes(r.status)), href: link({ situacao: null }) },
        { label: "Aprovados", list: all.filter((r) => r.status === "approved"), href: link({ situacao: "approved" }) },
        { label: "Vencem em até 3 dias", list: all.filter((r) => r.expiringSoon), href: link({ validade: "vencendo" }), tone: "warn" as const },
        { label: "Convertidos", list: all.filter((r) => r.status === "converted"), href: link({ situacao: "converted" }), tone: "good" as const },
      ]
    : [
        { label: "Abertos", list: all.filter((r) => r.status === "open"), href: link({ situacao: "open" }) },
        { label: "Parcialmente faturados", list: all.filter((r) => r.status === "partial"), href: link({ situacao: "partial" }), tone: "warn" as const },
        { label: "Faturados", list: all.filter((r) => r.status === "invoiced"), href: link({ situacao: "invoiced" }), tone: "good" as const },
        { label: "Reserva expirada", list: all.filter((r) => r.reservationStatus === "expired" && ["open", "partial"].includes(r.status)), href: link({ reserva: "expired" }), tone: "warn" as const },
      ];
  const columns: Column<DocRow>[] = [
    { key: "number", label: quote ? "Orçamento" : "Pedido", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}<span className="block text-xs font-normal text-slate-500">{formatDate(r.createdAt)}</span></span> },
    { key: "customerName", label: "Cliente", sortable: true, cell: (r) => <span>{r.customerId ? <Link className="hover:underline" href={`/clientes/${r.customerId}`}>{r.customerName}</Link> : r.customerName}{r.customerPhone && <span className="block text-xs text-slate-500">{formatPhone(r.customerPhone)}</span>}</span> },
    { key: "branchName", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branchName },
    { key: "sellerName", label: "Vendedor", cell: (r) => r.sellerName ?? "—" },
    ...(quote
      ? [{ key: "validUntil", label: "Validade", sortable: true, cell: (r: DocRow) => <span className="whitespace-nowrap">{formatDate(r.validUntil)}{r.expiringSoon && <Badge tone="warn" className="ml-1">vence logo</Badge>}</span> } as Column<DocRow>]
      : [
          { key: "deliveryDate", label: "Entrega", sortable: true, cell: (r: DocRow) => formatDate(r.deliveryDate) } as Column<DocRow>,
          { key: "progress", label: "Faturado", cell: (r: DocRow) => <span className="tabular whitespace-nowrap">{formatQty(r.invoicedQtyTotal)} de {formatQty(r.qtyTotal)}</span> } as Column<DocRow>,
          { key: "reservationStatus", label: "Reserva", cell: (r: DocRow) => (["open", "partial"].includes(r.status) ? <StatusBadge kind="reservation" status={r.reservationStatus ?? "none"} /> : "—") } as Column<DocRow>,
        ]),
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind={quote ? "sales_quote" : "sales_order"} status={r.status} /> },
    { key: "itemsCount", label: "Itens", align: "right", hidden: true, cell: (r) => r.itemsCount },
    { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => <span className={["cancelled", "rejected", "expired"].includes(r.status) ? "text-slate-400 line-through" : "font-semibold"}>{formatMoney(r.total)}</span> },
  ];
  return (
    <>
      <PageHeader
        title={quote ? "Orçamentos" : "Pedidos de venda"}
        crumbs={[{ label: "Vendas e caixa" }, { label: quote ? "Orçamentos" : "Pedidos de venda" }]}
        description={`${quote ? "Propostas com validade, enviadas pelo WhatsApp/e-mail e convertidas em pedido ou vendidas no PDV" : "Pedidos com reserva de estoque e faturamento parcial no PDV ou em NF-e"} · criados de ${formatDate(from)} a ${formatDate(to)}${s.ctx.branchId ? ` · ${s.branch?.name}` : " · todas as filiais (consolidado)"}.`}
        actions={
          <>
            <LinkButton href={quote ? "/vendas/pedidos" : "/vendas/orcamentos"}>{quote ? "Pedidos de venda" : "Orçamentos"}</LinkButton>
            {canCreate && <LinkButton href={`${base}/novo`} variant="accent"><Plus className="size-4" /> {quote ? "Novo orçamento" : "Novo pedido"}</LinkButton>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((st) => (
          <Stat key={st.label} label={st.label} value={st.list.length.toLocaleString("pt-BR")} hint={formatMoney(sum(st.list))} href={st.href} tone={st.tone ?? "default"} />
        ))}
      </div>
      <FilterBar
        basePath={base}
        values={params}
        filters={[
          { type: "search", placeholder: `Nº do ${quote ? "orçamento" : "pedido"}, cliente, CPF/CNPJ ou telefone` },
          { type: "select", name: "situacao", label: "Situação", options: Object.entries(labels).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "cliente", label: "Cliente", options: customers },
          { type: "select", name: "vendedor", label: "Vendedor", options: users },
          ...(s.ctx.branchId ? [] : [{ type: "select" as const, name: "filial", label: "Filial", options: branches }]),
          ...(quote ? [{ type: "select" as const, name: "validade", label: "Validade", options: [{ value: "vencendo", label: "Vence em até 3 dias" }] }] : [{ type: "select" as const, name: "reserva", label: "Reserva", options: [{ value: "active", label: "Estoque reservado" }, { value: "expired", label: "Reserva expirada" }, { value: "released", label: "Reserva liberada" }, { value: "none", label: "Sem reserva" }] }]),
          { type: "date", name: "de", label: "Criado de" },
          { type: "date", name: "ate", label: "até" },
        ]}
      />
      <DataTable
        id={quote ? "sales-quotes" : "sales-orders"}
        basePath={base}
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(r) => `${base}/${r.id}`}
        totals={{ total: formatMoney(sum(all.filter((r) => !["cancelled", "rejected", "expired"].includes(r.status)))) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">{quote ? "Nenhum orçamento no recorte." : "Nenhum pedido no recorte."} {canCreate && <Link className="text-brand-700 underline" href={`${base}/novo`}>{quote ? "Criar orçamento" : "Criar pedido"}</Link>}</div>}
      />
    </>
  );
}
