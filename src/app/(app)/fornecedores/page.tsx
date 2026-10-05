import Link from "next/link";
import { Eye, Pencil, Plus, ShoppingCart, Star } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, monthStart, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { SUPPLIER_CATEGORIES } from "@/domain/suppliers";
import { querySuppliers, negotiatedTerm } from "./queries";

export const metadata = { title: "Fornecedores" };

type Row = Awaited<ReturnType<typeof querySuppliers>>[number];

function initials(name: string) {
  return name.split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("suppliers");
  const params = await searchParams;
  const p = parseList(params, { sort: "label", dir: "asc" });
  const [all, term] = await Promise.all([querySuppliers(s.ctx, p), negotiatedTerm(s.ctx)]);
  const { rows, total } = paginate(all, p);
  const sum = (k: keyof Row) => all.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const canEdit = can(s.user, "suppliers", "edit");
  const canBuy = can(s.user, "purchases", "create");
  const columns: Column<Row>[] = [
    {
      key: "label",
      label: "Fornecedor",
      sortable: true,
      fixed: true,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">{initials(r.label)}</span>
          <span>
            {r.label}
            <span className="block text-xs font-normal text-slate-500">{[r.city && `${r.city} — ${r.uf}`, `${r.products} produto(s)`].filter(Boolean).join(" · ")}</span>
          </span>
        </span>
      ),
    },
    { key: "doc", label: "CNPJ/CPF", cell: (r) => (r.doc ? <span className="whitespace-nowrap">{formatDoc(r.doc)}</span> : <span className="text-slate-400">—</span>) },
    { key: "category", label: "Categoria", sortable: true, cell: (r) => r.category ?? "—" },
    { key: "code", label: "Código", sortable: true, hidden: true, cell: (r) => r.code },
    { key: "leadTimeDays", label: "Prazo entrega", align: "right", sortable: true, hidden: true, cell: (r) => (r.leadTimeDays != null ? `${r.leadTimeDays} d` : "—") },
    { key: "minOrderValue", label: "Pedido mínimo", align: "right", sortable: true, hidden: true, cell: (r) => (r.minOrderValue ? formatMoney(r.minOrderValue) : "—") },
    { key: "openOrdersValue", label: "Pedidos a receber", align: "right", sortable: true, hidden: true, cell: (r) => (r.openOrders ? <Link className="hover:underline" href={`/compras/pedidos?supplier=${r.id}&status=open`}>{formatMoney(r.openOrdersValue)} ({r.openOrders})</Link> : "—") },
    { key: "lastPurchase", label: "Última compra", sortable: true, cell: (r) => (r.lastPurchase ? <span>{formatDate(r.lastPurchase)}<Link href={`/compras/recebimentos/${r.lastReceiptId}`} className="block text-xs text-brand-700 hover:underline">{r.lastDoc}</Link></span> : "—") },
    { key: "purchased", label: "Total comprado", align: "right", sortable: true, cell: (r) => formatMoney(r.purchased) },
    { key: "payable", label: "Saldo a pagar", align: "right", sortable: true, cell: (r) => (r.payable ? <Link href={`/fornecedores/${r.id}?tab=titulos`} className={r.overdue ? "text-red-700 hover:underline" : "text-amber-700 hover:underline"}>{formatMoney(r.payable)}</Link> : "—") },
    {
      key: "score",
      label: "Desempenho",
      align: "right",
      sortable: true,
      cell: (r) =>
        r.score != null ? (
          <span className="inline-flex items-center gap-1" title={`Pontualidade ${r.onTimeRate != null ? (r.onTimeRate / 100).toFixed(0) + "%" : "—"} · conformidade ${r.conformityRate != null ? (r.conformityRate / 100).toFixed(0) + "%" : "—"} (recebimentos confirmados)`}>
            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden /> {(r.score / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })}
          </span>
        ) : (
          <span className="text-xs text-slate-400" title="Sem recebimentos confirmados">sem dados</span>
        ),
    },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="supplier" status={r.status} /> },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      fixed: true,
      cell: (r) => (
        <span className="flex justify-end gap-1">
          <Link href={`/fornecedores/${r.id}`} className={buttonClass("ghost", "sm")} aria-label={`Ver ${r.label}`} title="Ver fornecedor"><Eye className="size-4" /></Link>
          {canEdit && <Link href={`/fornecedores/${r.id}/editar`} className={buttonClass("ghost", "sm")} aria-label={`Editar ${r.label}`} title="Editar"><Pencil className="size-4" /></Link>}
          {canBuy && r.status === "active" && <Link href={`/compras/pedidos/novo?fornecedor=${r.id}`} className={buttonClass("ghost", "sm")} aria-label={`Novo pedido para ${r.label}`} title="Novo pedido"><ShoppingCart className="size-4" /></Link>}
        </span>
      ),
    },
  ];
  const termDelta = term.current != null && term.previous != null ? term.current - term.previous : null;
  return (
    <>
      <PageHeader
        title="Fornecedores"
        crumbs={[{ label: "Compras" }, { label: "Fornecedores" }]}
        description="Cadastros, contatos, compras, condições comerciais e situação financeira — identidade única por CPF/CNPJ em cotação, pedido, recebimento e financeiro."
        actions={can(s.user, "suppliers", "create") && <LinkButton href="/fornecedores/novo" variant="accent"><Plus className="size-4" /> Novo fornecedor</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fornecedores no recorte" value={all.length.toLocaleString("pt-BR")} hint={`${all.filter((r) => r.status === "active").length} ativos · ${all.filter((r) => r.status === "blocked").length} bloqueados · ${all.filter((r) => r.status === "draft").length} docs. pendentes`} />
        <Stat label="Compras neste mês" value={formatMoney(sum("purchasedMonth"))} hint={`${sum("receiptsMonth")} recebimento(s) confirmados desde ${formatDate(monthStart(today()))}`} href={`/compras/recebimentos?status=confirmed&from=${monthStart(today())}`} />
        <Stat label="Prazo médio negociado" value={term.current != null ? `${term.current} dias` : "—"} hint={term.current == null ? "Sem pedidos no mês" : termDelta == null ? `${term.orders} pedido(s) no mês` : `${termDelta >= 0 ? "+" : ""}${termDelta} dias vs. mês anterior · ${term.orders} pedido(s)`} href={`/compras/pedidos?from=${monthStart(today())}`} />
        <Stat label="Saldo a pagar" value={formatMoney(sum("payable"))} hint={`${sum("payableCount")} parcela(s) em aberto${sum("overdue") ? ` · ${formatMoney(sum("overdue"))} vencido` : ""}`} tone={sum("overdue") ? "bad" : "default"} href="/fornecedores?open=payable" />
      </div>
      <FilterBar
        basePath="/fornecedores"
        values={params}
        filters={[
          { type: "search", placeholder: "Razão social, CNPJ, produto ou contato" },
          { type: "select", name: "category", label: "Categoria", all: "Todas as categorias", options: SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: c })) },
          { type: "select", name: "status", label: "Situação", all: "Todas", options: [{ value: "active", label: "Ativo" }, { value: "draft", label: "Docs. pendentes" }, { value: "blocked", label: "Bloqueado" }, { value: "inactive", label: "Inativo" }] },
          { type: "select", name: "personType", label: "Tipo", options: [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }] },
          { type: "select", name: "open", label: "Pendências", options: [{ value: "orders", label: "Com pedidos a receber" }, { value: "payable", label: "Com saldo a pagar" }] },
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
        totals={{ openOrdersValue: formatMoney(sum("openOrdersValue")), purchased: formatMoney(sum("purchased")), payable: formatMoney(sum("payable")) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum fornecedor no recorte. <Link className="text-brand-700 underline" href="/fornecedores/novo">Cadastrar fornecedor</Link></div>}
      />
      <p className="mt-2 text-xs text-slate-500">Desempenho (0–5) é medido: 60% pontualidade (recebimento até a previsão do pedido) + 40% conformidade (itens sem divergência), sobre recebimentos confirmados.</p>
    </>
  );
}
