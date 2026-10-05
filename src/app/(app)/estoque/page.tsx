import Link from "next/link";
import { ArrowLeftRight, ClipboardList, Truck } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { lookups } from "@/lib/server/lookups";
import { queryBalances, branchScope, type BalanceRow } from "./queries";

export const metadata = { title: "Saldos de estoque" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("stock");
  const params = await searchParams;
  const p = parseList(params, { sort: "productName", dir: "asc" });
  const all = await queryBalances(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const scope = branchScope(s.ctx, p.f);
  const [branches, warehouses, categories] = await Promise.all([lookups.branches(s.ctx), lookups.warehouses(s.ctx, scope), lookups.categories(s.ctx)]);
  const columns: Column<BalanceRow>[] = [
    { key: "productName", label: "Produto / SKU", sortable: true, fixed: true, cell: (r) => <span className="block min-w-48">{r.skuName}{!r.productActive && <Badge className="ml-2">Inativo</Badge>}<span className="block font-mono text-xs font-normal text-slate-500">{r.skuCode}</span></span> },
    { key: "warehouseName", label: "Filial · depósito", sortable: true, cell: (r) => <span className="block whitespace-nowrap text-xs">{r.branchName}<span className="block text-slate-500">{r.warehouseName}{r.warehouseKind === "damaged" && <Badge tone="warn" className="ml-1">avarias</Badge>}</span></span> },
    { key: "location", label: "Local", hidden: true, cell: (r) => r.location ?? "—" },
    { key: "physical", label: "Físico", align: "right", sortable: true, cell: (r) => <span className={`whitespace-nowrap ${r.physical < 0 ? "text-red-700" : ""}`}>{formatQty(r.physical)} <span className="text-xs text-slate-400">{r.unitCode}</span></span> },
    { key: "reserved", label: "Reservado", align: "right", sortable: true, cell: (r) => (r.reserved ? formatQty(r.reserved) : "—") },
    { key: "available", label: "Disponível", align: "right", sortable: true, cell: (r) => <span className={`font-semibold ${r.belowMin ? "text-amber-700" : ""}`}>{formatQty(r.available)}</span> },
    { key: "inTransit", label: "Em trânsito", align: "right", sortable: true, cell: (r) => (r.inTransit ? <Link className="text-brand-700 hover:underline" href={`/estoque/transferencias?status=in_transit,partial&q=${encodeURIComponent(r.skuCode)}&filial=all`}>{formatQty(r.inTransit)}</Link> : "—") },
    { key: "minQty", label: "Mínimo", align: "right", sortable: true, cell: (r) => (r.minQty ? formatQty(r.minQty) : "—") },
    { key: "maxQty", label: "Máx./alvo", align: "right", hidden: true, cell: (r) => (r.maxQty ? formatQty(r.maxQty) : "—") },
    { key: "safetyQty", label: "Segurança", align: "right", hidden: true, cell: (r) => (r.safetyQty ? formatQty(r.safetyQty) : "—") },
    { key: "avgCost", label: "Custo médio", align: "right", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatMoney(r.avgCost)}</span> },
    { key: "value", label: "Valor", align: "right", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatMoney(r.value)}</span> },
    { key: "lastMovementAt", label: "Último movimento", sortable: true, hidden: true, cell: (r) => (r.lastMovementAt ? <Link className="text-brand-700 hover:underline" href={`/estoque/movimentos?sku=${r.skuId}&deposito=${r.warehouseId}&filial=${r.branchId}`}>{formatDateTime(r.lastMovementAt)}</Link> : "—") },
    { key: "status", label: "Situação", cell: (r) => (r.physical < 0 ? <Badge tone="bad">Negativo</Badge> : r.belowMin ? <Badge tone="warn">Abaixo do mínimo</Badge> : r.physical === 0 ? <Badge>Sem saldo</Badge> : <Badge tone="good">Normal</Badge>) },
  ];
  const sum = (k: "physical" | "reserved" | "available" | "inTransit" | "value") => all.reduce((a, r) => a + ((r as any)[k] ?? 0), 0);
  const base = "/estoque";
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  return (
    <>
      <PageHeader
        title="Saldos de estoque"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Saldos" }]}
        description={`Físico, reservado, disponível (físico − reservado), em trânsito e valor pelo custo médio ponderado — ${scope ? branches.find((b) => b.value === scope)?.label ?? "filial" : "todas as filiais"}.`}
        actions={
          <>
            <LinkButton href="/estoque/movimentos"><ArrowLeftRight className="size-4" /> Movimentos</LinkButton>
            <LinkButton href="/estoque/transferencias"><Truck className="size-4" /> Transferências</LinkButton>
            <LinkButton href="/estoque/inventarios"><ClipboardList className="size-4" /> Inventários</LinkButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Valor em estoque" value={formatMoney(sum("value"))} hint={`${all.length} saldos no recorte · físico × custo médio`} />
        <Stat label="Físico" value={formatQty(sum("physical"))} hint="Soma das quantidades (unidades mistas)" />
        <Stat label="Reservado" value={formatQty(sum("reserved"))} hint="Transferências separadas e pré-vendas" href={link({ situacao: "reserved" })} />
        <Stat label="Em trânsito" value={formatQty(sum("inTransit"))} hint="Expedido, ainda não recebido" href={link({ situacao: "transit" })} tone={sum("inTransit") ? "warn" : "default"} />
        <Stat label="Abaixo do mínimo" value={all.filter((r) => r.belowMin).length} hint="Disponível < mínimo" href={link({ situacao: "below_min" })} tone={all.some((r) => r.belowMin) ? "warn" : "default"} />
      </div>
      <FilterBar
        basePath={base}
        values={params}
        filters={[
          { type: "search", placeholder: "Produto, SKU ou código de barras" },
          { type: "select", name: "filial", label: "Filial", options: [{ value: "all", label: "Todas (consolidado)" }, ...branches], all: s.branch ? `Atual (${s.branch.name})` : "Todas" },
          { type: "select", name: "deposito", label: "Depósito", options: warehouses },
          { type: "select", name: "categoria", label: "Categoria", options: categories },
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "positive", label: "Com saldo" }, { value: "zero", label: "Sem saldo" }, { value: "negative", label: "Negativo" }, { value: "below_min", label: "Abaixo do mínimo" }, { value: "reserved", label: "Com reserva" }, { value: "transit", label: "Em trânsito" }] },
          { type: "select", name: "tipoDeposito", label: "Tipo de depósito", options: [{ value: "available", label: "Disponível para venda" }, { value: "damaged", label: "Avarias" }] },
        ]}
      />
      <DataTable
        id="stock-balances"
        basePath={base}
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="stock-balances"
        rowHref={(r) => `/produtos/${r.productId}?tab=estoque`}
        totals={{ physical: formatQty(sum("physical")), reserved: formatQty(sum("reserved")), available: formatQty(sum("available")), inTransit: formatQty(sum("inTransit")), value: formatMoney(sum("value")) }}
      />
    </>
  );
}
