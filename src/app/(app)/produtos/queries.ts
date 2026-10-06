import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { today } from "@/lib/dates";
import { QTY, roundDiv } from "@/lib/money";
import { categoryDescendants, categoryPath, fiscalIssues, fiscalStatus } from "@/domain/products";
import { defaultPriceTableId, priceMetrics } from "@/domain/pricing";
import { canSeeBranch } from "../estoque/queries";

export type ProductRow = Awaited<ReturnType<typeof queryProducts>>["rows"][number];

/**
 * Consulta única da lista de produtos (tela e exportação).
 * Saldo por filial = físico − reservado nos depósitos de estoque disponível (trânsito e avarias não entram).
 * Só as filiais permitidas ao usuário (`ctx.user.branchIds`) entram: colunas, totais, valor, trânsito e exportação.
 * Preço = tabela padrão, preço geral vigente hoje (faixa mín–máx entre variações).
 */
export async function queryProducts(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const cid = ctx.companyId;
  const filters: any[] = [["eq", "companyId", cid]];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.type) filters.push(["eq", "type", p.f.type]);
  if (p.f.brand) filters.push(["eq", "brandId", p.f.brand]);
  if (p.f.supplier) filters.push(["eq", "supplierId", p.f.supplier]);
  if (p.f.pdv === "1" || p.f.pdv === "0") filters.push(["eq", "availablePdv", p.f.pdv === "1"]);
  if (p.f.ecommerce === "1") filters.push(["eq", "availableEcommerce", true]);
  const categories = await listAll(ctx.store, "categories", { filters: [["eq", "companyId", cid]] });
  if (p.f.category) filters.push(["eq", "categoryId", categoryDescendants(categories, p.f.category)]);
  const [products, skus, allBranches, warehouses, allBalances, brands, taxGroups] = await Promise.all([
    listAll(ctx.store, "products", { filters, orderBy: [{ field: "name", dir: "asc" }] }),
    listAll(ctx.store, "skus", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", cid]], orderBy: [{ field: "code", dir: "asc" }] }),
    listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "stock_balances", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "brands", { filters: [["eq", "companyId", cid]] }),
    listAll(ctx.store, "tax_groups", { filters: [["eq", "companyId", cid]] }),
  ]);
  // filiais fora do alcance do usuário não aparecem (nem somam em totais, valor, trânsito ou exportação)
  const branches = allBranches.filter((b) => canSeeBranch(ctx, b.id));
  const balances = allBalances.filter((b) => canSeeBranch(ctx, b.branchId));
  const tableId = await defaultPriceTableId(ctx.store, cid);
  const prices = tableId ? await listAll(ctx.store, "prices", { filters: [["eq", "priceTableId", tableId]] }) : [];
  const date = today();
  // preço geral (sem filial) vigente hoje; com várias vigências, a de início mais recente prevalece (como no PDV)
  const current = new Map<string, { price: number; from: string }>();
  for (const pr of prices) {
    if (pr.branchId || (pr.validFrom && pr.validFrom > date) || (pr.validTo && pr.validTo < date)) continue;
    const cur = current.get(pr.skuId);
    if (!cur || String(pr.validFrom ?? "") > cur.from) current.set(pr.skuId, { price: pr.price, from: String(pr.validFrom ?? "") });
  }
  const priceBySku = new Map([...current].map(([k, v]) => [k, v.price]));
  const whKind = new Map(warehouses.map((w) => [w.id, w.kind]));
  const skusByProduct = new Map<string, any[]>();
  for (const s of skus) skusByProduct.set(s.productId, [...(skusByProduct.get(s.productId) ?? []), s]);
  const balByProduct = new Map<string, any[]>();
  for (const b of balances) if (b.productId) balByProduct.set(b.productId, [...(balByProduct.get(b.productId) ?? []), b]);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const tgById = new Map(taxGroups.map((t) => [t.id, t]));

  const q = p.q ? normalizeSearch(p.q) : "";
  const qUpper = p.q.trim().toUpperCase();
  const rows = products
    .map((prod) => {
      const ps = skusByProduct.get(prod.id) ?? [];
      const activeSkus = ps.filter((s) => s.active !== false);
      const skuPrices = activeSkus.map((s) => priceBySku.get(s.id)).filter((x): x is number => x != null);
      const costs = activeSkus.map((s) => s.costTotal ?? 0);
      const bals = balByProduct.get(prod.id) ?? [];
      const stock: Record<string, number> = {};
      const minByBranch: Record<string, number> = {};
      const valueByBranch: Record<string, number> = {};
      let physicalTotal = 0;
      let available = 0;
      let value = 0;
      let inTransit = 0;
      const belowMinBranches: string[] = [];
      for (const b of bals) {
        inTransit += b.inTransit ?? 0;
        if (whKind.get(b.warehouseId) !== "available") continue;
        const av = (b.physical ?? 0) - (b.reserved ?? 0);
        stock[b.branchId] = (stock[b.branchId] ?? 0) + av;
        minByBranch[b.branchId] = (minByBranch[b.branchId] ?? 0) + (b.minQty ?? 0);
        physicalTotal += b.physical ?? 0;
        available += av;
        const v = roundDiv((b.physical ?? 0) * (b.avgCost ?? 0), QTY);
        value += v;
        valueByBranch[b.branchId] = (valueByBranch[b.branchId] ?? 0) + v;
        if (b.minQty && (b.physical ?? 0) - (b.reserved ?? 0) <= b.minQty && !belowMinBranches.includes(b.branchId)) belowMinBranches.push(b.branchId);
      }
      const price = skuPrices.length ? Math.min(...skuPrices) : null;
      const priceMax = skuPrices.length ? Math.max(...skuPrices) : null;
      const cost = costs.length ? Math.min(...costs) : null;
      const m = priceMetrics(price, cost);
      const tg = prod.taxGroupId ? tgById.get(prod.taxGroupId) : null;
      const issues = fiscalIssues(prod, tg);
      const fiscal = fiscalStatus(prod, tg);
      return {
        ...prod,
        categoryName: categoryPath(categories, prod.categoryId) || null,
        brandName: prod.brandId ? (brandName.get(prod.brandId) ?? null) : null,
        skuCount: activeSkus.length,
        skuCodes: activeSkus.map((s) => s.sku).join(", "),
        mainSku: activeSkus[0]?.sku ?? ps[0]?.sku ?? null,
        barcodes: ps.map((s) => s.barcode).filter(Boolean).join(", "),
        price,
        priceMax,
        cost,
        marginBps: m.marginBps,
        stock,
        minByBranch,
        valueByBranch,
        fiscal,
        gtins: ps.map((s) => s.barcode).filter(Boolean) as string[],
        stockText: branches.map((b) => `${b.code ?? b.name}: ${(stock[b.id] ?? 0) / QTY}`).join("; "),
        physicalTotal,
        available,
        inTransit,
        stockValue: value,
        belowMinBranches,
        /** abaixo do mínimo na filial selecionada (ou em alguma, no consolidado) */
        belowMin: ctx.branchId ? belowMinBranches.includes(ctx.branchId) : belowMinBranches.length > 0,
        /** disponível na filial selecionada (ou total, no consolidado) */
        scopeAvailable: ctx.branchId ? (stock[ctx.branchId] ?? 0) : available,
        scopeValue: ctx.branchId ? (valueByBranch[ctx.branchId] ?? 0) : value,
        fiscalPending: fiscal.status !== "ok",
        fiscalIssues: issues,
        _search: [ps.map((s) => s.sku), ps.map((s) => s.barcode), ps.flatMap((s) => s.extraBarcodes ?? [])].flat().filter(Boolean) as string[],
      };
    })
    .filter((r) => {
      if (!q) return true;
      return normalizeSearch(r.searchText ?? r.name).includes(q) || normalizeSearch(r.name).includes(q) || (r.ncm && r.ncm.startsWith(q.replace(/\D/g, "") || "x")) || (r._search as string[]).some((x: string) => x.toUpperCase() === qUpper || normalizeSearch(x).includes(q)) || String(r.code ?? "").toUpperCase() === qUpper;
    })
    .filter((r) => {
      switch (p.f.stock) {
        case "zero":
          return r.type === "product" && r.scopeAvailable <= 0;
        case "negative":
          return r.type === "product" && Object.values(r.stock as Record<string, number>).some((v) => v < 0);
        case "below_min":
          return r.type === "product" && r.belowMin;
        case "in_stock":
          return r.scopeAvailable > 0;
        case "transit":
          return r.inTransit > 0;
        default:
          return true;
      }
    })
    .filter((r) => (p.f.fiscal === "pending" ? r.fiscalPending : p.f.fiscal ? r.fiscal.status === p.f.fiscal : true));
  return { rows, branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code as string | null })) };
}
