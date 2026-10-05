import Link from "next/link";
import { BadgeCheck, CheckSquare, ClipboardList, Eye, FileInput, PackageCheck, Pencil, Plus, Send, Truck } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, monthStart, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { ORDER_STATUS_LABEL } from "@/domain/purchase-calc";
import { queryOrders } from "./queries";

export const metadata = { title: "Pedidos de compra" };

type Row = Awaited<ReturnType<typeof queryOrders>>[number];
const ORIGIN: Record<string, string> = { manual: "Manual", quotation: "Cotação", replenishment: "Reposição" };

function relative(r: Row) {
  if (r.status === "received") return "Recebido";
  if (!r.expectedDate) return ["draft", "in_review", "adjust"].includes(r.status) ? "Não definida" : "—";
  const d = r.daysToExpected ?? 0;
  if (["cancelled", "rejected"].includes(r.status)) return "—";
  if (d < 0) return `Atrasado ${-d} dia(s)`;
  if (d === 0) return "Hoje";
  return `Em ${d} dia(s)`;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const params = await searchParams;
  const p = parseList(params, { sort: "number", dir: "desc" });
  const all = await queryOrders(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const [suppliers, buyers] = await Promise.all([lookups.suppliers(s.ctx), lookups.users(s.ctx)]);
  const sum = (list: Row[], k: keyof Row) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  // indicadores e etapas sobre a mesma consulta, sem o filtro de situação
  const base = await queryOrders(s.ctx, { ...p, f: { ...p.f, status: "", late: "" } });
  const t = today();
  const month = t.slice(0, 7);
  const inMonth = base.filter((r) => r.createdAt.slice(0, 7) === month && r.status !== "cancelled");
  const inReview = base.filter((r) => r.status === "in_review");
  const open = base.filter((r) => ["approved", "sent", "partial"].includes(r.status));
  const next7 = open.filter((r) => r.daysToExpected != null && r.daysToExpected >= 0 && r.daysToExpected <= 7);
  const receivedMonth = base.filter((r) => r.status === "received" && (r.updatedAt ?? "").slice(0, 7) === month);
  const late = open.filter((r) => r.overdue);
  const href = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p.f)) if (!["status", "late"].includes(k) && v) u.set(k, v);
    if (p.q) u.set("q", p.q);
    for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
    const q = u.toString();
    return `/compras/pedidos${q ? `?${q}` : ""}`;
  };
  const stages = [
    { key: "drafting", label: "Em elaboração", hint: "Rascunho e ajuste", icon: ClipboardList, list: base.filter((r) => ["draft", "adjust"].includes(r.status)) },
    { key: "in_review", label: "Em análise", hint: "Aguardando aprovação", icon: BadgeCheck, list: inReview },
    { key: "to_send", label: "Aprovados a enviar", hint: "Registrar envio", icon: Send, list: base.filter((r) => r.status === "approved") },
    { key: "sent", label: "Enviados", hint: "Aguardando entrega", icon: Truck, list: base.filter((r) => r.status === "sent") },
    { key: "partial", label: "Parcialmente recebidos", hint: "Saldo a receber", icon: PackageCheck, list: base.filter((r) => r.status === "partial") },
    { key: "received", label: "Recebidos", hint: "Concluídos", icon: CheckSquare, list: base.filter((r) => r.status === "received") },
  ];
  const canEdit = can(s.user, "purchases", "edit");
  const columns: Column<Row>[] = [
    { key: "number", label: "Pedido", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}{(r.revision ?? 1) > 1 && <span className="ml-1 text-xs font-normal text-slate-500">rev. {r.revision}</span>}<span className="block max-w-[220px] truncate text-xs font-normal text-slate-500">{r.purpose ?? ORIGIN[r.origin] ?? ""}</span></span> },
    { key: "supplierName", label: "Fornecedor", sortable: true, cell: (r) => <span><Link className="hover:underline" href={`/fornecedores/${r.supplierId}`}>{r.supplierName}</Link>{r.supplierDoc && <span className="block whitespace-nowrap text-xs text-slate-500">{formatDoc(r.supplierDoc)}</span>}</span> },
    { key: "branchName", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branchName },
    { key: "origin", label: "Origem", hidden: true, cell: (r) => (r.quotationId ? <Link className="hover:underline" href={`/compras/cotacoes/${r.quotationId}`}>{ORIGIN[r.origin] ?? r.origin}</Link> : ORIGIN[r.origin] ?? r.origin) },
    { key: "createdAt", label: "Solicitado", sortable: true, cell: (r) => formatDate(r.createdAt) },
    { key: "itemsCount", label: "Itens", align: "right", sortable: true, cell: (r) => <span className="whitespace-nowrap">{r.itemsCount} prod.<span className="block text-xs text-slate-500">{formatQty(r.unitsQty)} un.</span></span> },
    { key: "expectedDate", label: "Previsão", sortable: true, cell: (r) => <span>{formatDate(r.expectedDate)}<span className={cn("block text-xs", r.overdue ? "text-red-700" : "text-slate-500")}>{relative(r)}</span></span> },
    { key: "paymentTermsText", label: "Pagamento", hidden: true, cell: (r) => r.paymentTermsText ?? "—" },
    { key: "freight", label: "Frete", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.freight) },
    { key: "total", label: "Valor total", align: "right", sortable: true, cell: (r) => formatMoney(r.total) },
    { key: "remainingValue", label: "Saldo a receber", align: "right", sortable: true, hidden: true, cell: (r) => (r.remainingValue ? formatMoney(r.remainingValue) : "—") },
    { key: "buyerName", label: "Comprador", sortable: true, cell: (r) => <span title={r.buyerName}>{r.buyerName.split(" ")[0]}</span> },
    { key: "status", label: "Situação", cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge kind="purchase" status={r.status} />{r.awaitingSend && r.status === "sent" && <Badge tone="warn">revisão não enviada</Badge>}</span> },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      fixed: true,
      cell: (r) => (
        <span className="flex justify-end gap-0.5">
          <Link href={`/compras/pedidos/${r.id}`} className={buttonClass("ghost", "sm", "px-1.5")} title="Ver pedido" aria-label={`Ver pedido ${r.number}`}><Eye className="size-4" /></Link>
          {canEdit && ["draft", "adjust"].includes(r.status) && <Link href={`/compras/pedidos/${r.id}/editar`} className={buttonClass("ghost", "sm", "px-1.5")} title="Editar" aria-label={`Editar pedido ${r.number}`}><Pencil className="size-4" /></Link>}
          {r.status === "in_review" && r.requestId && <Link href={`/compras/aprovacoes/${r.requestId}`} className={buttonClass("ghost", "sm", "px-1.5")} title="Analisar (aprovar, devolver ou rejeitar)" aria-label={`Analisar pedido ${r.number}`}><BadgeCheck className="size-4" /></Link>}
          {canEdit && r.awaitingSend && <Link href={`/compras/pedidos/${r.id}`} className={buttonClass("ghost", "sm", "px-1.5")} title="Registrar envio ao fornecedor" aria-label={`Enviar pedido ${r.number}`}><Send className="size-4" /></Link>}
          {["approved", "sent", "partial"].includes(r.status) && canDo(s.user, "purchase.receive") && <Link href={`/compras/recebimentos/novo?pedido=${r.id}`} className={buttonClass("ghost", "sm", "px-1.5")} title="Receber mercadorias" aria-label={`Receber pedido ${r.number}`}><PackageCheck className="size-4" /></Link>}
          {r.status === "received" && <Link href={`/compras/pedidos/${r.id}?tab=recebimentos`} className={buttonClass("ghost", "sm", "px-1.5")} title="Ver notas/recebimentos" aria-label={`Recebimentos do pedido ${r.number}`}><FileInput className="size-4" /></Link>}
        </span>
      ),
    },
  ];
  const onTime = receivedMonth.filter((r) => !r.expectedDate || (r.updatedAt ?? "").slice(0, 10) <= r.expectedDate).length;
  return (
    <>
      <PageHeader
        title="Pedidos de compra"
        crumbs={[{ label: "Compras" }, { label: "Pedidos" }]}
        description={`Planeje compras, aprove solicitações e acompanhe o recebimento — ${s.ctx.branchId ? `filial ${s.branch?.name}` : "todas as filiais (consolidado)"}. Aprovado não significa enviado nem recebido.`}
        actions={
          <>
            {can(s.user, "purchases", "create") && <LinkButton href="/compras/cotacoes?status=open"><FileInput className="size-4" /> Importar cotação</LinkButton>}
            {can(s.user, "purchases", "create") && s.ctx.branchId && <LinkButton href="/compras/pedidos/novo" variant="accent"><Plus className="size-4" /> Novo pedido</LinkButton>}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos no mês" value={inMonth.length} hint={`${formatMoney(sum(inMonth, "total"))} em compras desde ${formatDate(monthStart(t))}`} href={href({ from: monthStart(t) })} />
        <Stat label="Aguardando aprovação" value={inReview.length} hint={`${formatMoney(sum(inReview, "total"))} pendentes`} href={href({ status: "in_review" })} tone={inReview.length ? "warn" : "default"} />
        <Stat label="A receber" value={formatMoney(sum(open, "remainingValue"))} hint={`${next7.length} entrega(s) previstas nos próximos 7 dias${late.length ? ` · ${late.length} atrasada(s)` : ""}`} href={href({ status: "open" })} tone={late.length ? "bad" : "default"} />
        <Stat label="Recebidos no mês" value={receivedMonth.length} hint={receivedMonth.length ? `${Math.round((onTime * 100) / receivedMonth.length)}% concluídos até a previsão` : "Nenhum concluído no mês"} href={href({ status: "received" })} tone="good" />
      </div>
      <nav aria-label="Etapas do pedido" className="no-print mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {stages.map((st) => {
          const active = p.f.status === st.key;
          const Icon = st.icon;
          return (
            <Link key={st.key} href={active ? href({}) : href({ status: st.key })} aria-current={active ? "true" : undefined} className={cn("focus-ring flex items-center gap-3 rounded-lg border bg-white p-3 transition-colors hover:border-brand-300", active ? "border-accent-500 ring-1 ring-accent-500" : "border-line")}>
              <Icon className={cn("size-5 shrink-0", active ? "text-accent-600" : "text-brand-700")} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-xs text-slate-500">{st.label}</span>
                <span className="tabular block text-lg font-semibold">{st.list.length}</span>
                <span className="block truncate text-[11px] text-slate-500">{formatMoney(sum(st.list, "total"))}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <FilterBar
        basePath="/compras/pedidos"
        values={params}
        filters={[
          { type: "search", placeholder: "Pedido, fornecedor, produto ou comprador" },
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
          { type: "select", name: "supplier", label: "Fornecedor", all: "Todos os fornecedores", options: suppliers },
          { type: "select", name: "buyer", label: "Comprador", options: buyers },
          { type: "select", name: "origin", label: "Origem", options: Object.entries(ORIGIN).map(([value, label]) => ({ value, label })) },
          { type: "date", name: "from", label: "Solicitado de" },
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
        totals={{ total: formatMoney(sum(all, "total")), remainingValue: formatMoney(sum(all, "remainingValue")), freight: formatMoney(sum(all, "freight")), itemsCount: `${sum(all, "itemsCount")} produto(s)` }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum pedido no recorte.</div>}
      />
    </>
  );
}
