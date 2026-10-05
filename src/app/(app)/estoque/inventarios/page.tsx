import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryInventories, branchScope, type InventoryRow } from "../queries";
import { NewInventoryButton } from "./new-inventory";

export const metadata = { title: "Inventário e contagem" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("stock");
  const params = await searchParams;
  const p = parseList(params, { sort: "baseAt", dir: "desc" });
  const all = await queryInventories(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const scope = branchScope(s.ctx, p.f);
  const [branches, warehouses, categories, users] = await Promise.all([lookups.branches(s.ctx), lookups.warehouses(s.ctx, scope), lookups.categories(s.ctx), lookups.users(s.ctx)]);
  const own = s.ctx.branchId ? (await listAll(s.ctx.store, "warehouses", { filters: [["eq", "branchId", s.ctx.branchId]] })).map((w) => ({ value: w.id, label: w.name })) : [];
  const locations = s.ctx.branchId ? [...new Set((await listAll(s.ctx.store, "stock_balances", { filters: [["eq", "branchId", s.ctx.branchId], ["notNull", "location"]] })).map((b) => String(b.location)))].sort() : [];
  const columns: Column<InventoryRow>[] = [
    { key: "code", label: "Inventário", sortable: true, fixed: true, cell: (r) => <span className="font-mono">{r.code ?? `nº ${r.number}`}</span> },
    { key: "baseAt", label: "Início (base)", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.baseAt)}<span className="block text-xs text-slate-500">por {r.createdByName}</span></span> },
    { key: "warehouseName", label: "Filial · depósito", sortable: true, cell: (r) => <span className="text-xs">{r.branchName}<span className="block text-slate-500">{r.warehouseName}</span></span> },
    { key: "scopeLabel", label: "Escopo", cell: (r) => r.scopeLabel },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="inventory" status={r.status} /> },
    {
      key: "counted",
      label: "Progresso",
      cell: (r) => (
        <span className="block min-w-28">
          <span className="tabular text-xs">{r.counted} de {r.itemsTotal}</span>
          <span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-brand-600" style={{ width: `${r.itemsTotal ? Math.round((r.counted / r.itemsTotal) * 100) : 0}%` }} /></span>
        </span>
      ),
    },
    { key: "withDiff", label: "Com diferença", align: "right", sortable: true, cell: (r) => r.withDiff },
    { key: "diffValue", label: "Impacto (custo médio)", align: "right", sortable: true, cell: (r) => <span className={r.diffValue < 0 ? "text-red-700" : r.diffValue > 0 ? "text-emerald-700" : ""}>{formatMoney(r.diffValue)}</span> },
    { key: "completedAt", label: "Concluído", sortable: true, cell: (r) => (r.completedAt ? <span className="text-xs">{formatDateTime(r.completedAt)}<span className="block text-slate-500">{r.completedByName}</span></span> : "—") },
  ];
  const open = all.filter((i) => ["open", "counting"].includes(i.status));
  return (
    <>
      <PageHeader
        title="Inventário e contagem"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Inventários" }]}
        description="Compare a contagem física com o saldo esperado (base + movimentos até a contagem de cada item) e conclua lançando um ajuste por item, uma única vez."
        actions={can(s.user, "stock", "create") && s.ctx.branchId && own.length > 0 && <NewInventoryButton warehouses={own} categories={categories} locations={locations} users={users} currentUserId={s.user.id} />}
      />
      {!s.ctx.branchId && <div className="mb-4"><Notice tone="info">Contexto consolidado: consulta de todas as filiais. Para abrir ou contar um inventário, selecione uma filial.</Notice></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Em andamento" value={open.length} hint="Abertos ou em contagem" href="/estoque/inventarios?status=open,counting" tone={open.length ? "warn" : "default"} />
        <Stat label="Itens em contagem" value={open.reduce((a, i) => a + i.itemsTotal, 0)} hint={`${open.reduce((a, i) => a + i.counted, 0)} já contados`} />
        <Stat label="Concluídos no recorte" value={all.filter((i) => i.status === "completed").length} href="/estoque/inventarios?status=completed" />
        <Stat label="Impacto dos concluídos" value={formatMoney(all.filter((i) => i.status === "completed").reduce((a, i) => a + i.diffValue, 0))} hint={`${formatQty(all.filter((i) => i.status === "completed").reduce((a, i) => a + i.diffQty, 0))} un. líquidas`} />
      </div>
      <FilterBar
        basePath="/estoque/inventarios"
        values={params}
        filters={[
          { type: "search", placeholder: "Número do inventário" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "open,counting", label: "Em andamento" }, { value: "open", label: "Aberto" }, { value: "counting", label: "Em contagem" }, { value: "completed", label: "Concluído" }, { value: "cancelled", label: "Cancelado" }] },
          { type: "select", name: "filial", label: "Filial", options: [{ value: "all", label: "Todas (consolidado)" }, ...branches], all: s.branch ? `Atual (${s.branch.name})` : "Todas" },
          { type: "select", name: "deposito", label: "Depósito", options: warehouses },
          { type: "date", name: "de", label: "Base de" },
          { type: "date", name: "ate", label: "Base até" },
        ]}
      />
      <DataTable id="inventories" basePath="/estoque/inventarios" params={params} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey="inventories" rowHref={(r) => `/estoque/inventarios/${r.id}`} totals={{ diffValue: formatMoney(all.reduce((a, i) => a + i.diffValue, 0)) }} />
    </>
  );
}
