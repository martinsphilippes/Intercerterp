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
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryCustomers } from "./queries";

export const metadata = { title: "Clientes" };

type Row = Awaited<ReturnType<typeof queryCustomers>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("customers");
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const all = await queryCustomers(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const sellers = await lookups.users(s.ctx);
  const columns: Column<Row>[] = [
    { key: "name", label: "Cliente", sortable: true, fixed: true, cell: (r) => <span>{r.name}{r.vip && <Badge tone="accent" className="ml-2">VIP</Badge>}</span> },
    { key: "code", label: "Código", sortable: true, cell: (r) => r.code },
    { key: "doc", label: "CPF/CNPJ", cell: (r) => (r.doc ? formatDoc(r.doc) : <span className="text-slate-400">—</span>) },
    { key: "contact", label: "Contato", cell: (r) => <span className="text-slate-600">{formatPhone(r.mobile || r.phone) || r.email || "—"}</span> },
    { key: "city", label: "Cidade", hidden: true, cell: (r) => (r.city ? `${r.city}/${r.uf}` : "—") },
    { key: "purchases", label: "Compras", align: "right", sortable: true, cell: (r) => r.purchases },
    { key: "totalPurchased", label: "Total comprado (líq.)", align: "right", sortable: true, cell: (r) => formatMoney(r.totalPurchased) },
    { key: "ticket", label: "Ticket médio", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.ticket) },
    { key: "lastPurchase", label: "Última compra", sortable: true, cell: (r) => formatDate(r.lastPurchase) },
    { key: "openBalance", label: "Em aberto", align: "right", sortable: true, cell: (r) => (r.openBalance ? <span className="text-amber-700">{formatMoney(r.openBalance)}</span> : "—") },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status} /> },
  ];
  const sum = (k: keyof Row) => all.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return (
    <>
      <PageHeader
        title="Gestão de clientes"
        crumbs={[{ label: "Clientes" }]}
        description="Carteira de clientes com histórico real de compras, títulos e créditos."
        actions={can(s.user, "customers", "create") && <LinkButton href="/clientes/novo" variant="primary"><Plus className="size-4" /> Novo cliente</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clientes no recorte" value={all.length.toLocaleString("pt-BR")} hint={`${all.filter((r) => r.status === "active").length} ativos`} />
        <Stat label="Total comprado (líquido)" value={formatMoney(sum("totalPurchased"))} hint="Vendas concluídas − devoluções" />
        <Stat label="Saldo em aberto" value={formatMoney(sum("openBalance"))} href="/financeiro/receber?state=open" tone={sum("openBalance") ? "warn" : "default"} />
        <Stat label="Clientes VIP" value={all.filter((r) => r.vip).length} href="/clientes?vip=1" />
      </div>
      <FilterBar
        basePath="/clientes"
        values={params}
        filters={[
          { type: "search", placeholder: "Nome, CPF/CNPJ, e-mail ou telefone" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Ativo" }, { value: "draft", label: "Rascunho" }, { value: "inactive", label: "Inativo" }] },
          { type: "select", name: "personType", label: "Tipo", options: [{ value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" }] },
          { type: "select", name: "seller", label: "Vendedor", options: sellers },
          { type: "select", name: "balance", label: "Financeiro", options: [{ value: "open", label: "Com saldo em aberto" }] },
          { type: "select", name: "vip", label: "VIP", options: [{ value: "1", label: "Somente VIP" }] },
        ]}
      />
      <DataTable
        id="customers"
        basePath="/clientes"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="customers"
        rowHref={(r) => `/clientes/${r.id}`}
        totals={{ totalPurchased: formatMoney(sum("totalPurchased")), openBalance: formatMoney(sum("openBalance")), purchases: sum("purchases") }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum cliente no recorte. <Link className="text-brand-700 underline" href="/clientes/novo">Cadastrar cliente</Link></div>}
      />
    </>
  );
}
