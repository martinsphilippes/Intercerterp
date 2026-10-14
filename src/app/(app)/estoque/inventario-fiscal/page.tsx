import Link from "@/components/ui/link";
import { Boxes, ClipboardList, Download, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/tabs";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { paginate, parseList, qs, sp, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { lookups } from "@/lib/server/lookups";
import { compareWithCurrent, fiscalInventory, lastYearEnd, type FiscalInventoryGroup, type FiscalInventoryResult, type FiscalInventoryRow } from "@/domain/inventory-fiscal";
import { AutoPrint } from "../../vendas/sale-widgets";
import { PrintStyles } from "../../vendas/print-styles";
import { branchOptions, warehouseOptions } from "../queries";
import { inventoryParams } from "./params";

export const metadata = { title: "Inventário em data-base" };

const VIEWS = [
  { key: "itens", label: "Itens" },
  { key: "ncm", label: "Totais por NCM" },
  { key: "categoria", label: "Totais por categoria" },
] as const;

/** Inventário em data-base (EST-05): saldo e custo médio de cada SKU × depósito reconstruídos dos movimentos. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("stock");
  await requireFeaturePage(s, "inventarioFiscal");
  const params = await searchParams;
  const p = parseList(params, { dir: "asc" });
  const { filters, branchId } = inventoryParams(s, params);
  const view = VIEWS.some((v) => v.key === sp(params, "visao")) ? sp(params, "visao") : "itens";
  const print = sp(params, "print") === "1";
  let error: string | null = null;
  const res: FiscalInventoryResult | null = await fiscalInventory(s.ctx.store, s.ctx.companyId, filters).catch((e) => {
    error = e?.message ?? String(e);
    return null;
  });
  const isToday = filters.date === today();
  const conference = res && isToday && !print ? await compareWithCurrent(s.ctx.store, s.ctx.companyId, { ...filters }) : null;
  const branches = branchOptions(s.branches);
  const scopeLabel = branchId ? (branches.find((b) => b.value === branchId)?.label ?? "Filial") : "Todas as filiais permitidas";
  const base = "/estoque/inventario-fiscal";
  const exportOf = (formato: string | null) => `/api/export/stock-fiscal-inventory${qs({ page: null, pageSize: null, print: null, visao: null, sort: null, dir: null, data: filters.date, formato }, params)}`;

  if (print) return <PrintBook s={s} res={res} error={error} scopeLabel={scopeLabel} params={params} />;

  const [warehouses, categories] = await Promise.all([warehouseOptions(s.ctx, branchId), lookups.categories(s.ctx)]);
  const all = res?.rows ?? [];
  const { rows, total } = paginate(all, p);
  const columns: Column<FiscalInventoryRow>[] = [
    { key: "ncm", label: "NCM", sortable: true, cell: (r) => <span className="font-mono text-xs">{r.ncm || "—"}</span> },
    { key: "productName", label: "Produto / SKU", sortable: true, fixed: true, cell: (r) => <span className="block min-w-48">{r.skuName}<span className="block font-mono text-xs font-normal text-slate-500">{r.skuCode}</span></span> },
    { key: "categoryName", label: "Categoria", sortable: true, hidden: true, cell: (r) => <span className="text-xs">{r.categoryName}</span> },
    { key: "warehouseName", label: "Filial · depósito", sortable: true, cell: (r) => <span className="block whitespace-nowrap text-xs">{r.branchName}<span className="block text-slate-500">{r.warehouseName}{r.warehouseKind === "damaged" && <Badge tone="warn" className="ml-1">avarias</Badge>}{r.warehouseKind === "consumption" && <Badge className="ml-1">uso e consumo</Badge>}</span></span> },
    { key: "qty", label: "Quantidade", align: "right", sortable: true, cell: (r) => <span className={`whitespace-nowrap ${r.negative ? "text-red-700" : ""}`}>{formatQty(r.qty)} <span className="text-xs text-slate-400">{r.unitCode}</span></span> },
    { key: "avgCost", label: "Custo médio na data", align: "right", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatMoney(r.avgCost)}</span> },
    { key: "value", label: "Valor", align: "right", sortable: true, cell: (r) => (r.negative ? <Badge tone="bad">Negativo — não valorizado</Badge> : <span className="whitespace-nowrap">{formatMoney(r.value)}</span>) },
    { key: "lastMovementAt", label: "Último movimento até a data", sortable: true, hidden: true, cell: (r) => (r.lastMovementAt ? <Link className="text-brand-700 hover:underline" href={`/estoque/movimentos${qs({ sku: r.skuId, deposito: r.warehouseId, filial: r.branchId, ate: filters.date, de: r.lastMovementAt.slice(0, 10) })}`}>{formatDateTime(r.lastMovementAt)}</Link> : "—") },
  ];
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  const groups: FiscalInventoryGroup[] = view === "ncm" ? (res?.byNcm ?? []) : (res?.byCategory ?? []);
  const canExport = canDo(s.user, "data.export");

  return (
    <>
      <PageHeader
        title="Inventário em data-base"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Inventário em data-base" }]}
        description={`Estoque existente ao fim do dia ${formatDate(filters.date)} — ${scopeLabel}. Quantidades reconstruídas dos movimentos de estoque até a data, valorizadas pelo custo médio vigente naquele momento. Base do Livro de Registro de Inventário entregue ao contador.`}
        actions={
          <>
            <Link href={link({ print: "1" })} className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden /> Imprimir livro
            </Link>
            {canExport && (
              <>
                <a className={buttonClass("secondary")} href={exportOf(null)}>
                  <Download className="size-4" aria-hidden /> CSV
                </a>
                <a className={buttonClass("secondary")} href={exportOf("xlsx")}>
                  <Download className="size-4" aria-hidden /> XLSX
                </a>
              </>
            )}
            <LinkButton href="/estoque"><Boxes className="size-4" /> Saldos atuais</LinkButton>
            <LinkButton href="/estoque/inventarios"><ClipboardList className="size-4" /> Inventários</LinkButton>
          </>
        }
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <FilterBar
        basePath={base}
        values={{ ...params, data: filters.date }}
        filters={[
          { type: "date", name: "data", label: "Data-base" },
          { type: "search", placeholder: "Produto, código, SKU ou GTIN" },
          { type: "select", name: "filial", label: "Filial", options: [{ value: "all", label: "Todas (consolidado)" }, ...branches], all: s.branch ? `Atual (${s.branch.name})` : "Todas" },
          { type: "select", name: "deposito", label: "Depósito", options: warehouses },
          { type: "select", name: "tipoDeposito", label: "Tipo de depósito", options: [{ value: "available", label: "Disponível para venda (venda e almoxarifado)" }, { value: "consumption", label: "Uso e consumo" }, { value: "damaged", label: "Avarias" }] },
          { type: "select", name: "categoria", label: "Categoria", options: categories },
          { type: "text", name: "ncm", label: "NCM (ou início)", placeholder: "ex.: 4820" },
        ]}
      >
        <span className="flex flex-wrap gap-1 self-end">
          <Link href={link({ data: lastYearEnd() })} className={buttonClass("ghost", "sm")}>31/12 do ano anterior</Link>
          <Link href={link({ data: today() })} className={buttonClass("ghost", "sm")}>Hoje</Link>
        </span>
      </FilterBar>
      {res && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Valor do inventário" value={formatMoney(res.totals.value)} hint="Quantidade × custo médio na data" />
          <Stat label="Itens com saldo" value={res.totals.positives} hint="SKU × depósito com quantidade positiva" />
          <Stat label="Saldos negativos" value={res.totals.negatives} hint="Não valorizados — corrija por inventário" tone={res.totals.negatives ? "bad" : "default"} />
          <Stat label="NCM distintos" value={res.byNcm.length} hint={`${res.byCategory.length} categoria(s)`} href={link({ visao: "ncm" })} />
        </div>
      )}
      {conference && (
        <div className="mb-4">
          {conference.ok ? (
            <Notice tone="good" title="Conferência com o saldo atual">Na data de hoje o inventário reconstruído confere com os saldos de estoque ({conference.checked} saldo(s) conferido(s): mesma quantidade e mesmo valor pelo custo médio).</Notice>
          ) : (
            <Notice tone="warn" title="Diferença com o saldo atual">
              {conference.differences.length} saldo(s) com diferença entre os movimentos até hoje e o saldo atual (movimento com data futura ou saldo alterado fora da movimentação):{" "}
              {conference.differences.slice(0, 5).map((d) => `${d.skuCode} em ${d.warehouseName} (${formatQty(d.inventoryQty)} × ${formatQty(d.currentQty)})`).join("; ")}
              {conference.differences.length > 5 ? "…" : "."}
            </Notice>
          )}
        </div>
      )}
      <LinkTabs tabs={VIEWS.map((v) => ({ key: v.key, label: v.label }))} active={view} basePath={`${base}${qs({ visao: null, page: null }, params)}`} param="visao" />
      {view === "itens" ? (
        <DataTable
          id="stock-fiscal-inventory"
          basePath={base}
          params={params}
          columns={columns}
          rows={rows}
          total={total}
          page={p.page}
          pageSize={p.pageSize}
          rowHref={(r) => `/produtos/${r.productId}?tab=estoque`}
          totals={{ value: formatMoney(res?.totals.value ?? 0) }}
        />
      ) : (
        <Card bodyClass="p-0" title={view === "ncm" ? "Totais por classificação fiscal (NCM)" : "Totais por categoria"} description="Somente saldos positivos (valorizados).">
          <GroupTable groups={groups} label={view === "ncm" ? "NCM" : "Categoria"} total={res?.totals.value ?? 0} drill={(g) => (view === "ncm" ? link({ visao: "itens", ncm: g.key === "-" ? null : g.key }) : link({ visao: "itens", categoria: g.key === "-" ? null : g.key }))} />
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Mercadorias em trânsito entre filiais (expedidas e ainda não recebidas) não estão em nenhum depósito e não entram nesta listagem; consulte Saldos › Em trânsito. Quantidade = soma dos movimentos até 23:59 da data-base (fuso da instalação); custo médio = o registrado no último movimento até a data.
      </p>
    </>
  );
}

function GroupTable({ groups, label, total, drill }: { groups: FiscalInventoryGroup[]; label: string; total: number; drill?: (g: FiscalInventoryGroup) => string }) {
  if (!groups.length) return <p className="px-4 py-3 text-sm text-slate-500">Nenhum saldo positivo no recorte.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table-base w-full text-sm">
        <thead>
          <tr>
            <th>{label}</th>
            <th className="text-right">Itens</th>
            <th className="text-right">Valor</th>
            <th className="text-right">% do total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td>{drill ? <Link className="text-brand-700 hover:underline" href={drill(g)}>{g.label}</Link> : g.label}</td>
              <td className="tabular text-right">{g.items}</td>
              <td className="tabular text-right">{formatMoney(g.value)}</td>
              <td className="tabular text-right">{total ? `${((g.value / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 font-semibold">
            <td>Total</td>
            <td className="tabular text-right">{groups.reduce((a, g) => a + g.items, 0)}</td>
            <td className="tabular text-right">{formatMoney(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Impressão no modelo do Livro de Registro de Inventário (simplificado): estoques existentes na data, agrupados por
 * classificação fiscal (NCM), com discriminação, quantidade, unidade, valor unitário e valor parcial; subtotal por NCM
 * e total geral. Saldos negativos não entram no livro (listados à parte para correção).
 */
function PrintBook({ s, res, error, scopeLabel, params }: { s: Awaited<ReturnType<typeof requireSession>>; res: FiscalInventoryResult | null; error: string | null; scopeLabel: string; params: SearchParams }) {
  const rows = (res?.rows ?? []).filter((r) => !r.negative);
  const negatives = (res?.rows ?? []).filter((r) => r.negative);
  const byNcm = new Map<string, FiscalInventoryRow[]>();
  for (const r of rows) byNcm.set(r.ncm || "", [...(byNcm.get(r.ncm || "") ?? []), r]);
  const company = s.company;
  return (
    <div className="flex flex-col gap-4">
      <PrintStyles paper="A4" />
      <div className="no-print flex gap-2">
        <AutoPrint enabled />
        <Link href={`/estoque/inventario-fiscal${qs({ print: null }, params)}`} className={buttonClass("secondary")}>
          Voltar
        </Link>
      </div>
      <article className="print-doc space-y-3 bg-white p-4 text-black" aria-label="Livro de Registro de Inventário">
        <header className="border-b border-black pb-2">
          <h1 className="text-lg font-bold">Livro de Registro de Inventário</h1>
          <p className="text-sm">
            {company.name}
            {company.cnpj ? ` · CNPJ ${formatDoc(company.cnpj)}` : ""}
            {company.ie ? ` · IE ${company.ie}` : ""}
          </p>
          <p className="text-sm">
            Estoques existentes em <strong>{res ? formatDate(res.date) : "—"}</strong> · {scopeLabel} · valorização pelo custo médio ponderado
          </p>
          <p className="text-xs">Emitido em {formatDateTime(new Date().toISOString())} por {s.user.name} · documento de apoio (modelo simplificado) — a escrituração oficial é responsabilidade do contador.</p>
        </header>
        {error && <p className="text-sm">{error}</p>}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">Classificação fiscal</th>
              <th className="py-1 pr-2">Discriminação</th>
              <th className="py-1 pr-2 text-right">Quantidade</th>
              <th className="py-1 pr-2">Unid.</th>
              <th className="py-1 pr-2 text-right">Valor unitário</th>
              <th className="py-1 pr-2 text-right">Valor parcial</th>
              <th className="py-1 text-right">Valor total</th>
            </tr>
          </thead>
          <tbody>
            {[...byNcm.entries()].map(([ncm, list]) => (
              <NcmBlock key={ncm || "-"} ncm={ncm} list={list} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td colSpan={6} className="py-1">Total geral do inventário</td>
              <td className="py-1 text-right">{formatMoney(res?.totals.value ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
        {negatives.length > 0 && (
          <p className="text-xs">
            Atenção: {negatives.length} saldo(s) negativo(s) na data não foram incluídos ({negatives.slice(0, 10).map((r) => `${r.skuCode} em ${r.warehouseName}: ${formatQty(r.qty)}`).join("; ")}
            {negatives.length > 10 ? "…" : ""}). Corrija por inventário antes de entregar o livro.
          </p>
        )}
      </article>
    </div>
  );
}

function NcmBlock({ ncm, list }: { ncm: string; list: FiscalInventoryRow[] }) {
  const subtotal = list.reduce((a, r) => a + r.value, 0);
  return (
    <>
      {list.map((r, i) => (
        <tr key={r.id} className="align-top">
          <td className="py-0.5 pr-2 font-mono">{i === 0 ? ncm || "Sem NCM" : ""}</td>
          <td className="py-0.5 pr-2">
            {r.skuName} <span className="text-[10px]">({r.skuCode}{r.warehouseKind === "damaged" ? " · avarias" : r.warehouseKind === "consumption" ? " · uso e consumo" : ""} · {r.branchName})</span>
          </td>
          <td className="py-0.5 pr-2 text-right">{formatQty(r.qty)}</td>
          <td className="py-0.5 pr-2">{r.unitCode}</td>
          <td className="py-0.5 pr-2 text-right">{formatMoney(r.avgCost)}</td>
          <td className="py-0.5 pr-2 text-right">{formatMoney(r.value)}</td>
          <td className="py-0.5 text-right">{i === list.length - 1 ? formatMoney(subtotal) : ""}</td>
        </tr>
      ))}
    </>
  );
}
