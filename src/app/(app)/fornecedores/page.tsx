import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { querySuppliers } from "./queries";

export const metadata = { title: "Fornecedores" };

type Row = Awaited<ReturnType<typeof querySuppliers>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("suppliers");
  const params = await searchParams;
  const p = parseList(params, { sort: "label", dir: "asc" });
  const all = await querySuppliers(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const sum = (k: keyof Row) => all.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const columns: Column<Row>[] = [
    { key: "label", label: "Fornecedor", sortable: true, fixed: true, cell: (r) => <span>{r.label}{r.tradeName && r.tradeName !== r.name && <span className="block text-xs font-normal text-slate-500">{r.name}</span>}</span> },
    { key: "code", label: "Código", sortable: true, cell: (r) => r.code },
    { key: "doc", label: "CNPJ/CPF", cell: (r) => (r.doc ? <span className="whitespace-nowrap">{formatDoc(r.doc)}</span> : <span className="text-slate-400">—</span>) },
    { key: "contact", label: "Contato", hidden: true, cell: (r) => <span className="text-slate-600">{r.email || formatPhone(r.phone) || "—"}</span> },
    { key: "city", label: "Cidade", hidden: true, cell: (r) => (r.city ? `${r.city}/${r.uf}` : "—") },
    { key: "leadTimeDays", label: "Prazo entrega", align: "right", sortable: true, cell: (r) => (r.leadTimeDays != null ? `${r.leadTimeDays} d` : "—") },
    { key: "minOrderValue", label: "Pedido mínimo", align: "right", sortable: true, hidden: true, cell: (r) => (r.minOrderValue ? formatMoney(r.minOrderValue) : "—") },
    { key: "products", label: "Produtos", align: "right", sortable: true, cell: (r) => r.products },
    { key: "openOrdersValue", label: "Pedidos a receber", align: "right", sortable: true, cell: (r) => (r.openOrders ? <Link className="hover:underline" href={`/compras/pedidos?supplier=${r.id}&status=open`}>{formatMoney(r.openOrdersValue)} <span className="text-xs text-slate-500">({r.openOrders})</span></Link> : "—") },
    { key: "purchased", label: "Comprado (recebido)", align: "right", sortable: true, cell: (r) => formatMoney(r.purchased) },
    { key: "lastPurchase", label: "Último recebimento", sortable: true, cell: (r) => formatDate(r.lastPurchase) },
    { key: "payable", label: "A pagar", align: "right", sortable: true, cell: (r) => (r.payable ? <span className={r.overdue ? "text-red-700" : "text-amber-700"}>{formatMoney(r.payable)}</span> : "—") },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Gestão de fornecedores"
        crumbs={[{ label: "Compras" }, { label: "Fornecedores" }]}
        description="Cadastro único por CPF/CNPJ com produtos fornecidos, custos e prazos recentes, propostas, pedidos e títulos."
        actions={can(s.user, "suppliers", "create") && <LinkButton href="/fornecedores/novo" variant="primary"><Plus className="size-4" /> Novo fornecedor</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fornecedores no recorte" value={all.length.toLocaleString("pt-BR")} hint={`${all.filter((r) => r.status === "active").length} ativos · ${all.filter((r) => r.status === "inactive").length} inativos`} />
        <Stat label="A receber de pedidos em aberto" value={formatMoney(sum("openOrdersValue"))} hint="Aprovados, enviados e parciais (saldo)" href="/compras/pedidos?status=open" />
        <Stat label="Comprado (recebimentos confirmados)" value={formatMoney(sum("purchased"))} hint="Todo o período · valor devido" href="/compras/recebimentos?status=confirmed" />
        <Stat label="A pagar em aberto" value={formatMoney(sum("payable"))} hint={sum("overdue") ? `${formatMoney(sum("overdue"))} vencido` : "Nada vencido"} tone={sum("overdue") ? "bad" : "default"} href="/fornecedores?open=payable" />
      </div>
      <FilterBar
        basePath="/fornecedores"
        values={params}
        filters={[
          { type: "search", placeholder: "Razão social, fantasia, CNPJ/CPF, código ou e-mail" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Ativo" }, { value: "draft", label: "Rascunho" }, { value: "inactive", label: "Inativo" }] },
          { type: "select", name: "personType", label: "Tipo", options: [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }] },
          { type: "select", name: "open", label: "Pendências", options: [{ value: "orders", label: "Com pedidos a receber" }, { value: "payable", label: "Com títulos a pagar" }] },
        ]}
      />
      <DataTable
        id="suppliers"
        basePath="/fornecedores"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="suppliers"
        rowHref={(r) => `/fornecedores/${r.id}`}
        totals={{ openOrdersValue: formatMoney(sum("openOrdersValue")), purchased: formatMoney(sum("purchased")), payable: formatMoney(sum("payable")), products: sum("products") }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum fornecedor no recorte. <Link className="text-brand-700 underline" href="/fornecedores/novo">Cadastrar fornecedor</Link></div>}
      />
    </>
  );
}
