import Link from "next/link";
import { Plus, Upload, Tags, ImageOff, Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatBps, formatMoney, formatQty } from "@/lib/money";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryProducts, type ProductRow } from "./queries";

export const metadata = { title: "Produtos e serviços" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("products");
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const { rows: all, branches } = await queryProducts(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const [categories, brands, suppliers] = await Promise.all([lookups.categories(s.ctx), lookups.brands(s.ctx), lookups.suppliers(s.ctx)]);
  const branchCols: Column<ProductRow>[] = branches.map((b) => ({
    key: `stock_${b.id}`,
    label: `Disponível · ${b.name.replace(/^Filial — |^Matriz — /, "")}${b.id === s.ctx.branchId ? " (atual)" : ""}`,
    align: "right",
    cell: (r) => {
      if (r.type === "service") return <span className="text-slate-400">—</span>;
      const av = r.stock[b.id] ?? 0;
      const min = r.minByBranch[b.id] ?? 0;
      const tone = av <= 0 ? "text-red-700" : min && av < min ? "text-amber-700" : "";
      return (
        <span className="block">
          <span className={`font-semibold ${tone}`}>{formatQty(av)} {r.unitCode?.toLowerCase()}.</span>
          <span className="block text-xs font-normal text-slate-500">Mínimo: {formatQty(min)}</span>
        </span>
      );
    },
  }));
  const fiscalTone = { ok: "text-emerald-700", review: "text-amber-700", incomplete: "text-red-700" } as const;
  const columns: Column<ProductRow>[] = [
    {
      key: "name",
      label: "Produto",
      sortable: true,
      fixed: true,
      cell: (r) => (
        <span className="flex items-center gap-2">
          {r.imageFileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${r.imageFileId}?inline=1`} alt="" className="size-9 shrink-0 rounded border border-line object-cover" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded border border-dashed border-line text-slate-300">
              <ImageOff className="size-4" aria-hidden />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate">{r.name}</span>
            <span className="block text-xs font-normal text-slate-500">
              <span className="font-mono">{r.code}</span> • {r.gtins.length ? `GTIN ${r.gtins[0]}${r.gtins.length > 1 ? ` +${r.gtins.length - 1}` : ""}` : "Sem GTIN"} • {r.type === "service" ? "Serviço" : r.skuCount > 1 ? `${r.skuCount} variações` : "Produto simples"}
            </span>
          </span>
        </span>
      ),
    },
    { key: "mainSku", label: "SKU", hidden: true, cell: (r) => <span className="font-mono text-xs" title={r.skuCodes}>{r.skuCount > 1 ? `${r.mainSku} +${r.skuCount - 1}` : r.mainSku}</span> },
    { key: "categoryName", label: "Categoria · marca", sortable: true, cell: (r) => <span className="block">{r.categoryName ?? "—"}<span className="block text-xs text-slate-500">{r.brandName ?? "Sem marca"}</span></span> },
    { key: "unitCode", label: "Unidade", hidden: true, cell: (r) => r.unitCode },
    { key: "type", label: "Tipo", hidden: true, cell: (r) => (r.type === "service" ? "Serviço" : "Produto") },
    ...branchCols,
    {
      key: "price",
      label: "Preço",
      align: "right",
      sortable: true,
      cell: (r) => (
        <span className="block">
          <span className="font-semibold">{r.price == null ? <span className="text-amber-700">Sem preço</span> : r.priceMax && r.priceMax !== r.price ? `${formatMoney(r.price)} – ${formatMoney(r.priceMax)}` : formatMoney(r.price)}</span>
          <span className="block text-xs font-normal text-slate-500">Custo total {formatMoney(r.cost)}</span>
        </span>
      ),
    },
    { key: "marginBps", label: "Margem", align: "right", sortable: true, hidden: true, cell: (r) => formatBps(r.marginBps) },
    { key: "available", label: "Disponível total", align: "right", sortable: true, hidden: true, cell: (r) => (r.type === "service" ? "—" : formatQty(r.available)) },
    { key: "stockValue", label: "Valor em estoque", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.stockValue) },
    {
      key: "fiscal",
      label: "Fiscal",
      cell: (r) => (
        <span className="block" title={r.fiscalIssues.join("; ") || undefined}>
          <span className={`text-sm font-medium ${fiscalTone[r.fiscal.status as keyof typeof fiscalTone]}`}>{r.fiscal.label}</span>
          <span className="block text-xs text-slate-500">{r.fiscal.detail}</span>
        </span>
      ),
    },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status} /> },
    { key: "availablePdv", label: "PDV", align: "center", cell: (r) => (r.availablePdv ? <Badge tone="good">Sim</Badge> : <Badge>Não</Badge>) },
    { key: "availableEcommerce", label: "Loja virtual", align: "center", hidden: true, cell: (r) => (r.availableEcommerce ? <Badge tone="info">Sim</Badge> : <Badge>Não</Badge>) },
  ];
  const sum = (k: "available" | "stockValue") => all.reduce((a, r) => a + (r[k] ?? 0), 0);
  const branchTotals = Object.fromEntries(branches.map((b) => [`stock_${b.id}`, formatQty(all.reduce((a, r) => a + (r.stock[b.id] ?? 0), 0))]));
  const canCreate = can(s.user, "products", "create");
  const scopeName = s.branch?.name ?? "todas as filiais";
  const physical = all.filter((r) => r.type === "product" && r.status !== "inactive");
  const low = physical.filter((r) => r.belowMin && r.scopeAvailable > 0).length;
  const zero = physical.filter((r) => r.scopeAvailable <= 0).length;
  return (
    <>
      <PageHeader
        title="Produtos e serviços"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Produtos" }]}
        description={`Cadastro, preços, estoque, variações e tributação. Saldos: disponível (físico − reservado) por filial; indicadores da unidade selecionada (${scopeName}).`}
        actions={
          <>
            <LinkButton href="/produtos/cadastros">
              <Tags className="size-4" /> Cadastros auxiliares
            </LinkButton>
            {canCreate && (
              <LinkButton href="/produtos/importar">
                <Upload className="size-4" /> Importar
              </LinkButton>
            )}
            {canDo(s.user, "data.export") && (
              <a href={`/api/export/products${qs({ page: null, pageSize: null }, params)}`} className="focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-slate-50">
                <Download className="size-4" /> Exportar
              </a>
            )}
            {canCreate && (
              <LinkButton href="/produtos/novo" variant="accent">
                <Plus className="size-4" /> Novo produto
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Produtos ativos" value={all.filter((r) => r.status === "active").length.toLocaleString("pt-BR")} hint={`${all.reduce((a, r) => a + r.skuCount, 0)} variações (SKUs) · ${all.length} no recorte`} href="/produtos?status=active" />
        <Stat label="Valor em estoque" value={formatMoney(all.reduce((a, r) => a + r.scopeValue, 0))} hint={`Custo médio atual · ${scopeName}`} href="/estoque" />
        <Stat label="Estoque baixo" value={low} hint="Abaixo do mínimo (com saldo)" href="/produtos?stock=below_min" tone={low ? "warn" : "default"} />
        <Stat label="Sem estoque" value={zero} hint="Disponível ≤ 0 — reposição necessária" href="/produtos?stock=zero&status=active" tone={zero ? "bad" : "default"} />
        <Stat label="Fiscal a revisar" value={all.filter((r) => r.fiscalPending).length} hint="Incompleto (NCM/tributação) ou revisar (CEST)" href="/produtos?fiscal=pending" tone={all.some((r) => r.fiscalPending) ? "warn" : "default"} />
      </div>
      <FilterBar
        basePath="/produtos"
        values={params}
        filters={[
          { type: "search", placeholder: "Produto, código, SKU, GTIN ou NCM" },
          { type: "select", name: "category", label: "Categoria", options: categories },
          { type: "select", name: "brand", label: "Marca", options: brands },
          { type: "select", name: "supplier", label: "Fornecedor", options: suppliers },
          { type: "select", name: "status", label: "Status", options: [{ value: "active", label: "Ativo" }, { value: "draft", label: "Rascunho" }, { value: "inactive", label: "Inativo" }] },
          { type: "select", name: "type", label: "Tipo", options: [{ value: "product", label: "Produto" }, { value: "service", label: "Serviço" }] },
          { type: "select", name: "pdv", label: "PDV", options: [{ value: "1", label: "Disponível no PDV" }, { value: "0", label: "Fora do PDV" }] },
          { type: "select", name: "stock", label: "Estoque", options: [{ value: "in_stock", label: "Com saldo" }, { value: "zero", label: "Sem saldo" }, { value: "below_min", label: "Abaixo do mínimo" }, { value: "negative", label: "Negativo" }, { value: "transit", label: "Com trânsito" }] },
          { type: "select", name: "fiscal", label: "Fiscal", options: [{ value: "ok", label: "Configurado" }, { value: "review", label: "Revisar" }, { value: "incomplete", label: "Incompleto" }, { value: "pending", label: "Revisar ou incompleto" }] },
        ]}
      />
      <DataTable
        id="products"
        basePath="/produtos"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="products"
        rowHref={(r) => `/produtos/${r.id}`}
        totals={{ ...branchTotals, available: formatQty(sum("available")), stockValue: formatMoney(sum("stockValue")) }}
        empty={
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhum produto no recorte.{" "}
            {canCreate && (
              <Link className="text-brand-700 underline" href="/produtos/novo">
                Cadastrar produto
              </Link>
            )}
          </div>
        }
      />
    </>
  );
}
