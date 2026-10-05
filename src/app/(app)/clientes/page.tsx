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

const formatMonthYear = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryCustomers, customerKpis } from "./queries";
import { Eye, Pencil, ShoppingCart } from "lucide-react";

export const metadata = { title: "Clientes" };

type Row = Awaited<ReturnType<typeof queryCustomers>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("customers");
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const all = await queryCustomers(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const sellers = await lookups.users(s.ctx);
  const k = await customerKpis(s.ctx);
  const columns: Column<Row>[] = [
    {
      key: "name", label: "Cliente", sortable: true, fixed: true, className: "min-w-[240px]",
      cell: (r) => (
        <span className="block">
          <span className="font-medium">{r.name}</span>
          {r.vip && <Badge tone="accent" className="ml-2">VIP</Badge>}
          <span className="block text-xs font-normal text-slate-500">Cliente desde {formatMonthYear(r.createdAt)} · {r.purchases} compra{r.purchases === 1 ? "" : "s"}</span>
        </span>
      ),
    },
    { key: "code", label: "Código", sortable: true, hidden: true, cell: (r) => r.code },
    { key: "doc", label: "CPF/CNPJ", cell: (r) => (r.doc ? formatDoc(r.doc) : <span className="text-slate-400">—</span>) },
    { key: "contact", label: "Contato", cell: (r) => <span className="block text-slate-600">{formatPhone(r.mobile || r.phone) || "—"}<span className="block text-xs text-slate-500">{r.email ?? ""}</span></span> },
    { key: "city", label: "Cidade", hidden: true, cell: (r) => (r.city ? `${r.city}/${r.uf}` : "—") },
    { key: "lastPurchase", label: "Última compra", sortable: true, cell: (r) => (r.lastPurchase ? <span className="block">{formatDate(r.lastPurchase)}<span className="tabular block text-xs text-slate-500">{formatMoney(r.lastPurchaseValue)}</span></span> : "—") },
    { key: "totalPurchased", label: "Total comprado (líq.)", align: "right", sortable: true, cell: (r) => formatMoney(r.totalPurchased) },
    { key: "ticket", label: "Ticket médio", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.ticket) },
    { key: "creditAvailable", label: "Crédito disponível", align: "right", sortable: true, cell: (r) => (r.creditLimit ? formatMoney(r.creditAvailable) : <span className="text-xs text-slate-400">sem limite</span>) },
    { key: "openBalance", label: "Em aberto", align: "right", sortable: true, cell: (r) => (r.openBalance ? <span className="text-amber-700">{formatMoney(r.openBalance)}</span> : "—") },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status} /> },
    {
      key: "actions", label: "Ações", fixed: true,
      cell: (r) => (
        <span className="flex items-center gap-1">
          <Link href={`/clientes/${r.id}`} title="Visualizar" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Eye className="size-4" /></Link>
          {can(s.user, "customers", "edit") && <Link href={`/clientes/${r.id}/editar`} title="Editar" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="size-4" /></Link>}
          {can(s.user, "pdv", "create") && r.status === "active" && <Link href={`/pdv?cliente=${r.id}`} title="Nova venda para o cliente" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><ShoppingCart className="size-4" /></Link>}
        </span>
      ),
    },
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
        <Stat label="Total de clientes" value={k.total.toLocaleString("pt-BR")} hint={`+${k.newThisMonth} cadastrados neste mês`} href="/clientes" />
        <Stat label="Compradores ativos" value={k.buyers90.toLocaleString("pt-BR")} hint="Compraram nos últimos 90 dias (não é a situação cadastral)" href="/clientes?buyer=90" />
        <Stat label="Ticket médio de clientes" value={formatMoney(k.ticket30)} hint={`Últimos 30 dias · ${k.sales30} vendas identificadas`} />
        <Stat label="Aniversariantes" value={k.birthdays7} hint="Nos próximos 7 dias" href="/clientes?birthday=7" tone={k.birthdays7 ? "warn" : "default"} />
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
          { type: "select", name: "buyer", label: "Atividade", options: [{ value: "90", label: "Compraram em 90 dias" }] },
          { type: "select", name: "birthday", label: "Aniversário", options: [{ value: "7", label: "Próximos 7 dias" }] },
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
        totals={{ totalPurchased: formatMoney(sum("totalPurchased")), openBalance: formatMoney(sum("openBalance")), creditAvailable: formatMoney(sum("creditAvailable")) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum cliente no recorte. <Link className="text-brand-700 underline" href="/clientes/novo">Cadastrar cliente</Link></div>}
      />
    </>
  );
}
