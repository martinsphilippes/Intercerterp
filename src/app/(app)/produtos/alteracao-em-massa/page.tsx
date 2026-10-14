import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filters";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { parseList, type SearchParams } from "@/lib/list";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { categoryPath } from "@/domain/products";
import { defaultPriceTableId, priceMetrics, priceScopeKey } from "@/domain/pricing";
import { BULK_FIELDS } from "@/domain/product-bulk";
import { PRICE_RULES } from "@/domain/price-adjust";
import { queryProducts } from "../queries";
import { BulkEditor, type BulkRow } from "./bulk-editor";

export const metadata = { title: "Alteração em massa" };

/** Máximo de linhas (SKUs) carregadas na tela; refine os filtros acima disso. */
const MAX_ROWS = 500;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("products");
  await requireFeaturePage(s, "alteracaoMassa");
  if (!canDo(s.user, "products.bulk_edit")) redirect("/sem-permissao");
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const [categories, brands, suppliers, tables, taxGroups, allCats, defTable] = await Promise.all([
    lookups.categories(s.ctx),
    lookups.brands(s.ctx),
    lookups.suppliers(s.ctx),
    lookups.priceTables(s.ctx),
    lookups.taxGroups(s.ctx),
    listAll(s.ctx.store, "categories", { filters: [["eq", "companyId", s.ctx.companyId]] }),
    defaultPriceTableId(s.ctx.store, s.ctx.companyId),
  ]);
  const tableParam = typeof params.tabela === "string" ? params.tabela : "";
  const tableId = tables.some((t) => t.value === tableParam) ? tableParam : (defTable ?? tables[0]?.value ?? "");
  // mesma consulta (e filtros) da lista de produtos
  const { rows: products } = await queryProducts(s.ctx, p);
  const productIds = products.map((r) => r.id);
  const skus: any[] = [];
  for (let i = 0; i < productIds.length && skus.length < MAX_ROWS + 1; i += 100) skus.push(...(await listAll(s.ctx.store, "skus", { filters: [["eq", "productId", productIds.slice(i, i + 100)]] })));
  const shown = skus.filter((x) => x.active !== false).slice(0, MAX_ROWS);
  const prices = new Map<string, number>();
  if (tableId) {
    const ids = shown.map((x) => x.id);
    for (let i = 0; i < ids.length; i += 100) {
      for (const pr of await listAll(s.ctx.store, "prices", { filters: [["eq", "priceTableId", tableId], ["eq", "skuId", ids.slice(i, i + 100)]] })) {
        if (pr.scopeKey === priceScopeKey(tableId, pr.skuId, null, null)) prices.set(pr.skuId, pr.price);
      }
    }
  }
  const byId = new Map(products.map((r) => [r.id, r]));
  const rows: BulkRow[] = shown
    .map((x) => {
      const prod = byId.get(x.productId)!;
      const price = prices.get(x.id) ?? null;
      const cost = x.costTotal ?? x.costAcquisition ?? 0;
      return {
        skuId: x.id,
        productId: x.productId,
        sku: x.sku,
        name: x.name ?? prod.name,
        category: prod.categoryId ? categoryPath(allCats, prod.categoryId) : "—",
        brand: prod.brandName ?? "—",
        status: prod.status,
        type: prod.type,
        cost,
        price,
        marginBps: priceMetrics(price, cost > 0 ? cost : null).marginBps,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const truncated = skus.filter((x) => x.active !== false).length > MAX_ROWS;
  const canEdit = can(s.user, "products", "edit");
  return (
    <>
      <PageHeader
        title="Alteração em massa"
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Alteração em massa" }]}
        description="Filtre, marque os produtos e escolha a alteração: reajuste de preço (%, margem, markup ou valor fixo, com arredondamento comercial) ou campos do cadastro. A prévia é obrigatória e toda alteração fica no histórico."
      />
      <FilterBar
        basePath="/produtos/alteracao-em-massa"
        values={{ ...params, tabela: tableId }}
        filters={[
          { type: "search", placeholder: "Produto, código, SKU, GTIN ou NCM" },
          { type: "select", name: "category", label: "Categoria", options: categories },
          { type: "select", name: "brand", label: "Marca", options: brands },
          { type: "select", name: "supplier", label: "Fornecedor", options: suppliers },
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }, { value: "draft", label: "Rascunho" }] },
          { type: "select", name: "type", label: "Tipo", options: [{ value: "product", label: "Produto" }, { value: "service", label: "Serviço" }] },
          { type: "select", name: "tabela", label: "Tabela de preço", all: "Padrão", options: tables },
        ]}
      />
      {truncated && <div className="mb-4"><Notice tone="warn">Mais de {MAX_ROWS} itens no filtro: só os {MAX_ROWS} primeiros aparecem. Refine os filtros para alcançar os demais.</Notice></div>}
      {!canEdit && <div className="mb-4"><Notice tone="warn">Você pode gerar a prévia, mas aplicar exige a permissão de alterar produtos.</Notice></div>}
      <BulkEditor
        key={`${tableId}|${JSON.stringify(params)}`}
        rows={rows}
        tableId={tableId}
        tableName={tables.find((t) => t.value === tableId)?.label ?? "—"}
        canEdit={canEdit}
        options={{ categories, brands, taxGroups, rules: PRICE_RULES, fields: BULK_FIELDS }}
      />
    </>
  );
}
