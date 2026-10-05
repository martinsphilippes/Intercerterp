import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { searchable } from "@/lib/core/text";
import { resolvePrices } from "@/domain/pricing";
import { availableMap } from "@/domain/stock";

/**
 * Busca de produtos do PDV (Tela 5): descrição, SKU, código de barras e categoria.
 * Consulta limitada e com campos mínimos (o cliente aplica debounce); `code` resolve o SKU exato do leitor.
 * Preço vigente da tabela selecionada (filial/vigência/atacado) e disponível na filial.
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.ctx.companyId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(s.user, "pdv")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const branchId = s.ctx.branchId;
  if (!branchId) return NextResponse.json({ error: "Selecione uma filial" }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const store = s.ctx.store;
  const cid = s.ctx.companyId;
  const limit = Math.min(Number(sp.get("limit")) || 30, 60);
  const q = (sp.get("q") ?? "").trim();
  const code = (sp.get("code") ?? "").trim();
  const category = sp.get("categoria") ?? "";
  const brand = sp.get("marca") ?? "";
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
  const branch = await store.get("branches", branchId);
  const priceTableId = sp.get("tabela") || branch?.defaultPriceTableId || null;

  let skus: Doc[] = [];
  let exact = false;
  if (ids.length) {
    skus = (await listAll(store, "skus", { filters: [["eq", "id", ids]] })).filter((k) => k.companyId === cid);
  } else if (code) {
    // leitor: código de barras (principal ou adicional) ou SKU exato
    const byBarcode = await store.list("skus", { filters: [["eq", "companyId", cid], ["eq", "barcode", code]], limit: 2 });
    let hit = byBarcode.items;
    if (!hit.length) hit = (await store.list("skus", { filters: [["eq", "companyId", cid], ["eq", "sku", code.toUpperCase()]], limit: 2 })).items;
    if (!hit.length) hit = (await store.list("skus", { filters: [["eq", "companyId", cid], ["contains", "extraBarcodes", code]], limit: 2 }).catch(() => ({ items: [] as Doc[] }))).items;
    if (!hit.length) {
      // GTIN do produto (produtos sem variação)
      const prods = (await store.list("products", { filters: [["eq", "companyId", cid], ["eq", "gtin", code]], limit: 2 })).items;
      if (prods.length) hit = (await store.list("skus", { filters: [["eq", "productId", prods.map((p) => p.id)]], limit: 2 })).items;
    }
    skus = hit.filter((k) => k.active !== false);
    exact = skus.length === 1;
  } else {
    const filters: any[] = [["eq", "companyId", cid]];
    if (category || brand) {
      const pf: any[] = [["eq", "companyId", cid]];
      if (category) pf.push(["eq", "categoryId", category]);
      if (brand) pf.push(["eq", "brandId", brand]);
      const prods = await store.list("products", { filters: pf, limit: 200 });
      if (!prods.items.length) return NextResponse.json({ items: [], exact: false, priceTableId });
      filters.push(["eq", "productId", prods.items.map((p) => p.id)]);
    }
    const words = searchable(q).split(" ").filter((w) => w.length >= 1).slice(0, 4);
    for (const w of words) filters.push(["contains", "searchText", w]);
    const res = await store.list("skus", { filters, limit: limit * 2, orderBy: [{ field: "name", dir: "asc" }] });
    skus = res.items.filter((k) => k.active !== false);
  }

  const productIds = [...new Set(skus.map((k) => k.productId))];
  const products = productIds.length ? await listAll(store, "products", { filters: [["eq", "id", productIds]] }) : [];
  const pmap = new Map(products.map((p) => [p.id, p]));
  skus = skus.filter((k) => {
    const p = pmap.get(k.productId);
    return p && p.active !== false && p.status !== "inactive" && (p.availablePdv !== false || p.type === "service");
  });
  if (!ids.length) skus = skus.slice(0, limit);
  const cats = await listAll(store, "categories", { filters: [["eq", "companyId", cid]] });
  const cmap = new Map(cats.map((c) => [c.id, c.name]));
  const brands = await listAll(store, "brands", { filters: [["eq", "companyId", cid]] });
  const bmap = new Map(brands.map((b) => [b.id, b.name]));
  // estoque mínimo da filial (faixa "baixo" do selo de saldo)
  const mins = new Map<string, number>();
  if (skus.length) {
    const bals = await listAll(store, "stock_balances", { filters: [["eq", "branchId", branchId], ["eq", "skuId", skus.map((k) => k.id)]] });
    for (const b of bals) mins.set(b.skuId, (mins.get(b.skuId) ?? 0) + (b.minQty ?? 0));
  }
  const prices = await resolvePrices(store, { companyId: cid, branchId, priceTableId, items: skus.map((k) => ({ skuId: k.id, qty: 1000 })) });
  const priceIds = prices.map((p) => p.priceId).filter(Boolean) as string[];
  const priceDocs = priceIds.length ? await listAll(store, "prices", { filters: [["eq", "id", priceIds]] }) : [];
  const prmap = new Map(priceDocs.map((p) => [p.id, p]));
  const avail = await availableMap(store, branchId, skus.map((k) => k.id));
  const siblings = new Map<string, number>();
  for (const k of skus) siblings.set(k.productId, (siblings.get(k.productId) ?? 0) + 1);

  const items = skus.map((k, i) => {
    const p = pmap.get(k.productId)!;
    const pr = prices[i];
    const doc = pr.priceId ? prmap.get(pr.priceId) : null;
    const service = p.type === "service";
    return {
      skuId: k.id,
      productId: p.id,
      sku: k.sku,
      barcode: k.barcode ?? null,
      name: k.name ?? p.name,
      productName: p.name,
      attributes: k.attributes ?? {},
      unitCode: k.unitCode ?? p.unitCode ?? "UN",
      categoryId: p.categoryId ?? null,
      categoryName: p.categoryId ? (cmap.get(p.categoryId) ?? null) : null,
      brandName: p.brandId ? (bmap.get(p.brandId) ?? null) : null,
      productCode: p.code ?? null,
      minQty: service ? null : (mins.get(k.id) ?? 0),
      service,
      hasVariants: Boolean(p.hasVariants),
      listPrice: doc?.price ?? pr.listPrice ?? 0,
      wholesalePrice: doc?.wholesalePrice ?? null,
      wholesaleMinQty: doc?.wholesaleMinQty ?? null,
      maxDiscountBps: pr.maxDiscountBps,
      priced: pr.price > 0,
      available: service ? null : (avail.get(k.id)?.available ?? 0),
    };
  });
  return NextResponse.json({ items, exact, priceTableId });
}
