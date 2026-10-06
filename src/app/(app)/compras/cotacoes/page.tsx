import Link from "@/components/ui/link";
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
import { queryQuotations } from "./queries";

export const metadata = { title: "Cotações" };

type Row = Awaited<ReturnType<typeof queryQuotations>>[number];
const ORIGIN: Record<string, string> = { manual: "Manual", replenishment: "Reposição", need: "Necessidade (pedido)" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const params = await searchParams;
  const p = parseList(params, { sort: "number", dir: "desc" });
  const all = await queryQuotations(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const base = await queryQuotations(s.ctx, { ...p, f: { ...p.f, status: "" } });
  const open = base.filter((r) => r.status === "open");
  const columns: Column<Row>[] = [
    { key: "number", label: "Cotação", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}<span className="block max-w-[260px] truncate text-xs font-normal text-slate-500">{r.title}</span></span> },
    { key: "origin", label: "Origem", cell: (r) => ORIGIN[r.origin] ?? r.origin },
    { key: "createdAt", label: "Criada em", sortable: true, cell: (r) => formatDate(r.createdAt) },
    { key: "itemsCount", label: "Produtos", align: "right", sortable: true, cell: (r) => r.itemsCount },
    { key: "proposalsCount", label: "Propostas", align: "right", sortable: true, cell: (r) => <span>{r.proposalsCount} de {r.suppliersCount}{r.expiredCount > 0 && <Badge tone="bad" className="ml-1">{r.expiredCount} vencida(s)</Badge>}</span> },
    { key: "supplierNames", label: "Fornecedores", hidden: true, cell: (r) => r.supplierNames },
    { key: "responseDue", label: "Respostas até", sortable: true, cell: (r) => formatDate(r.responseDue) },
    { key: "selectedTotal", label: "Seleção (com frete)", align: "right", sortable: true, cell: (r) => (r.selectedTotal != null ? <span>{formatMoney(r.selectedTotal)}<span className="block text-xs text-slate-500">{r.selectedSuppliers} fornecedor(es)</span></span> : "—") },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="quotation" status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Cotação e comparação de fornecedores"
        crumbs={[{ label: "Compras" }, { label: "Cotações" }]}
        description="Compare propostas por preço líquido, frete, pedido mínimo, validade, disponibilidade e prazo. O menor preço unitário não garante a menor compra total."
        actions={can(s.user, "purchases", "create") && s.ctx.branchId && <LinkButton href="/compras/cotacoes/nova" variant="accent"><Plus className="size-4" /> Nova cotação</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cotações em comparação" value={open.length} hint={`${open.filter((r) => r.proposalsCount < r.suppliersCount).length} aguardando propostas`} href="/compras/cotacoes?status=open" />
        <Stat label="Propostas vencidas (abertas)" value={open.reduce((a, r) => a + r.expiredCount, 0)} hint="Não entram na sugestão; aprovação segue a política" tone={open.some((r) => r.expiredCount) ? "warn" : "default"} href="/compras/cotacoes?status=open" />
        <Stat label="Seleções em aberto" value={formatMoney(open.reduce((a, r) => a + (r.selectedTotal ?? 0), 0))} hint="Total com frete das seleções atuais" />
        <Stat label="Com pedidos gerados" value={base.filter((r) => r.status === "closed").length} href="/compras/cotacoes?status=closed" />
      </div>
      <FilterBar
        basePath="/compras/cotacoes"
        values={params}
        filters={[
          { type: "search", placeholder: "Número, título, produto ou fornecedor" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "open", label: "Aberta (em comparação)" }, { value: "closed", label: "Pedidos gerados" }, { value: "cancelled", label: "Cancelada" }] },
          { type: "select", name: "origin", label: "Origem", options: Object.entries(ORIGIN).map(([value, label]) => ({ value, label })) },
        ]}
      />
      <DataTable id="quotations" basePath="/compras/cotacoes" params={params} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey="quotations" rowHref={(r) => `/compras/cotacoes/${r.id}`} empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma cotação. <Link className="text-brand-700 underline" href="/compras/cotacoes/nova">Criar cotação</Link> ou gere a partir do planejamento de reposição.</div>} />
    </>
  );
}
