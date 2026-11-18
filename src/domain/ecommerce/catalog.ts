import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { QTY } from "@/lib/money";
import { searchable } from "@/lib/core/text";
import { resolvePrices } from "../pricing";
import { defaultWarehouse } from "../stock";
import { commerceEvent, requireStore, slugify } from "./common";
import { shippingOf } from "./store";

/**
 * Catálogo digital (Tela 52) e leituras públicas da vitrine (Telas 61–62).
 *
 * Produto, SKU, preço e estoque são os do ERP: a loja guarda só o complemento comercial (título, descrição, fotos,
 * medidas para o frete, destaque, preço promocional opcional) em `store_products`. Disponível na loja = físico − reservado
 * no depósito padrão da filial que atende os pedidos, menos o estoque de segurança da loja — reservas de pedidos (on-line,
 * pedidos de venda, transferências) reduzem a disponibilidade de todos os canais ao mesmo tempo.
 */

export interface ListingIssue {
  code: string;
  label: string;
  /** impede a venda (o produto não aparece na vitrine) */
  blocking: boolean;
}

export interface ListingInput {
  title: string;
  slug?: string | null;
  description: string;
  categoryId?: string | null;
  images: string[];
  priceOverride?: number | null;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  heightCm?: number | null;
  widthCm?: number | null;
  lengthCm?: number | null;
  featured: boolean;
  published: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export const MAX_IMAGES = 6;

async function listingsOf(store: Store, storeId: string) {
  return listAll(unscoped(store), "store_products", { filters: [["eq", "storeId", storeId]] });
}

export async function listingOf(store: Store, storeId: string, productId: string) {
  return unscoped(store).get("store_products", detId("slisting", storeId, productId));
}

async function uniqueListingSlug(store: Store, storeId: string, base: string, selfId?: string) {
  const root = slugify(base) || "produto";
  const rows = await listingsOf(store, storeId);
  const used = new Set(rows.filter((r) => r.id !== selfId).map((r) => r.slug));
  if (!used.has(root)) return root;
  for (let i = 2; i < 500; i++) if (!used.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now().toString(36)}`;
}

/** Pendências do produto para a venda on-line (recalculadas ao salvar, validar e abrir o catálogo). */
export function computeIssues(input: { st: Doc; product: Doc; skus: Doc[]; listing: Doc | null; price: number }): ListingIssue[] {
  const { st, product, skus, listing, price } = input;
  const out: ListingIssue[] = [];
  const ship = shippingOf(st);
  if (product.active === false || (product.status && product.status !== "active")) out.push({ code: "inactive", label: "Produto inativo no ERP", blocking: true });
  if (product.type === "service") out.push({ code: "service", label: "Serviço não é vendido na loja", blocking: true });
  if (product.composition === "kit") out.push({ code: "kit", label: "Kit: a venda on-line de kits (baixa pelos componentes) ainda não é suportada", blocking: true });
  if (!skus.some((s) => s.active !== false)) out.push({ code: "no_sku", label: "Sem variação (SKU) ativa", blocking: true });
  if (!(price > 0)) out.push({ code: "no_price", label: "Sem preço de venda", blocking: true });
  if (!product.ncm) out.push({ code: "no_ncm", label: "NCM ausente (exigido na nota fiscal)", blocking: true });
  const weight = listing?.weightGrams || product.weightGrams || 0;
  if ((ship.modes.carrier.enabled || ship.modes.third_party.enabled) && !(weight > 0)) out.push({ code: "no_weight", label: "Peso pendente", blocking: true });
  const images = (listing?.images ?? []).length || (product.imageFileId ? 1 : 0);
  if (!images) out.push({ code: "no_image", label: "Sem foto (a vitrine mostra a ilustração da categoria)", blocking: false });
  if (String(listing?.description ?? product.description ?? "").trim().length < 20) out.push({ code: "short_description", label: "Descrição curta", blocking: false });
  return out;
}

export const hasBlocking = (issues: ListingIssue[] | null | undefined) => (issues ?? []).some((i) => i.blocking);

/** Preço da loja por produto: o preço promocional da loja (quando definido) ou o da tabela padrão do ERP para a filial. */
export async function storePrices(store: Store, st: Doc, skus: Doc[], listings: Map<string, Doc>) {
  const branchId = st.fulfillmentBranchId ?? st.branchId ?? null;
  const resolved = await resolvePrices(store, { companyId: st.companyId, branchId, items: skus.map((s) => ({ skuId: s.id, qty: QTY })) });
  const out = new Map<string, number>();
  for (const r of resolved) {
    const sku = skus.find((s) => s.id === r.skuId)!;
    const override = listings.get(sku.productId)?.priceOverride;
    out.set(r.skuId, override && override > 0 ? override : r.price);
  }
  return out;
}

/** Disponível para a loja por SKU (milésimos) no depósito padrão da filial, descontado o estoque de segurança. */
export async function storeStock(store: Store, st: Doc, skuIds: string[], branchId?: string | null) {
  const out = new Map<string, number>();
  const bId = branchId ?? st.fulfillmentBranchId ?? st.branchId;
  if (!skuIds.length || !bId) return out;
  const wh = await defaultWarehouse(unscoped(store), bId).catch(() => null);
  if (!wh) return out;
  const safety = Math.max(0, Number(st.safetyStockQty ?? 0));
  for (let i = 0; i < skuIds.length; i += 100) {
    const chunk = skuIds.slice(i, i + 100);
    const bals = await listAll(unscoped(store), "stock_balances", { filters: [["eq", "warehouseId", wh.id], ["eq", "skuId", chunk]] });
    for (const b of bals) out.set(b.skuId, Math.max(0, (b.physical ?? 0) - (b.reserved ?? 0) - safety));
  }
  for (const id of skuIds) if (!out.has(id)) out.set(id, 0);
  return out;
}

// ───────────────────────────── Gestão (Tela 52)

export interface CatalogRow {
  product: Doc;
  skus: Doc[];
  listing: Doc | null;
  price: number;
  /** disponível somado das variações (milésimos) */
  available: number;
  issues: ListingIssue[];
  categoryName: string | null;
}

/** Produtos do ERP disponíveis para o comércio digital (marcados "venda on-line" ou já no catálogo), com a situação na loja. */
export async function catalogRows(ctx: Ctx, opts: { show?: "all" | "in_store" | "published" | "issues" | "off"; q?: string | null } = {}): Promise<CatalogRow[]> {
  const st = await requireStore(ctx);
  const listings = await listingsOf(ctx.store, st.id);
  const byProduct = new Map(listings.map((l) => [l.productId, l]));
  const products = (await listAll(ctx.store, "products", { filters: [["eq", "companyId", ctx.companyId]] })).filter((p) => p.type !== "service" && (p.availableEcommerce || byProduct.has(p.id)));
  const ids = products.map((p) => p.id);
  const skus: Doc[] = [];
  for (let i = 0; i < ids.length; i += 100) skus.push(...(await listAll(ctx.store, "skus", { filters: [["eq", "productId", ids.slice(i, i + 100)]] })));
  const prices = await storePrices(ctx.store, st, skus, byProduct);
  const stock = await storeStock(ctx.store, st, skus.map((s) => s.id));
  const cats = new Map((await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] })).map((c) => [c.id, c.name]));
  const q = String(opts.q ?? "").trim().toLowerCase();
  const rows: CatalogRow[] = [];
  for (const p of products) {
    const own = skus.filter((s) => s.productId === p.id);
    const listing = byProduct.get(p.id) ?? null;
    const price = Math.min(...own.map((s) => prices.get(s.id) ?? 0).filter((v) => v > 0), Number.MAX_SAFE_INTEGER);
    const issues = computeIssues({ st, product: p, skus: own, listing, price: price === Number.MAX_SAFE_INTEGER ? 0 : price });
    if (listing && JSON.stringify(listing.issues ?? []) !== JSON.stringify(issues)) {
      await unscoped(ctx.store).update("store_products", listing.id, { issues }).catch(() => undefined);
    }
    const row: CatalogRow = {
      product: p,
      skus: own,
      listing,
      price: price === Number.MAX_SAFE_INTEGER ? 0 : price,
      available: own.reduce((a, s) => a + (stock.get(s.id) ?? 0), 0),
      issues,
      categoryName: cats.get(listing?.categoryId ?? p.categoryId) ?? null,
    };
    if (q && !`${p.name} ${p.code ?? ""} ${own.map((s) => s.sku).join(" ")} ${listing?.title ?? ""}`.toLowerCase().includes(q)) continue;
    const show = opts.show ?? "all";
    if (show === "in_store" && !listing) continue;
    if (show === "published" && !listing?.published) continue;
    if (show === "off" && listing?.published) continue;
    if (show === "issues" && !issues.some((i) => i.blocking)) continue;
    rows.push(row);
  }
  return rows.sort((a, b) => Number(Boolean(b.listing?.published)) - Number(Boolean(a.listing?.published)) || String(a.product.name).localeCompare(String(b.product.name)));
}

/** Coloca produtos no catálogo da loja (rascunho, fora da vitrine) com os dados do cadastro do ERP. Idempotente. */
export async function addToCatalog(ctx: Ctx, productIds: string[]): Promise<number> {
  requireAction(ctx, "ecommerce.catalog");
  const st = await requireStore(ctx);
  let added = 0;
  for (const pid of [...new Set(productIds)].slice(0, 500)) {
    const p = await ctx.store.get("products", pid);
    if (!p || p.companyId !== ctx.companyId || p.type === "service") continue;
    if (await listingOf(ctx.store, st.id, pid)) continue;
    const slug = await uniqueListingSlug(ctx.store, st.id, p.name);
    try {
      await unscoped(ctx.store).create(
        "store_products",
        {
          companyId: ctx.companyId,
          branchId: null,
          createdBy: ctx.user.id,
          storeId: st.id,
          productId: p.id,
          published: false,
          title: String(p.name).slice(0, 200),
          slug,
          description: p.description ?? "",
          categoryId: p.categoryId ?? null,
          images: [],
          priceOverride: null,
          compareAtPrice: null,
          weightGrams: p.weightGrams ?? null,
          heightCm: null,
          widthCm: null,
          lengthCm: null,
          featured: false,
          sortOrder: 0,
          seoTitle: null,
          seoDescription: null,
          issues: [],
          searchText: searchable(p.name, p.code),
          updatedBy: ctx.user.id,
        },
        detId("slisting", st.id, p.id),
      );
      if (!p.availableEcommerce) await ctx.store.update("products", p.id, { availableEcommerce: true });
      added++;
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  if (added) await audit(ctx, { module: "sales", action: "ecommerce.catalog_add", entityType: "store", entityId: st.id, summary: `${added} produto(s) incluído(s) no catálogo digital`, related: [`store:${st.id}`] });
  return added;
}

/** Tela 52 (Editar): conteúdo da vitrine, preço da loja, medidas, fotos e presença. */
export async function saveListing(ctx: Ctx, productId: string, input: ListingInput): Promise<Doc> {
  requireAction(ctx, "ecommerce.catalog");
  const st = await requireStore(ctx);
  let listing = await listingOf(ctx.store, st.id, productId);
  if (!listing) {
    await addToCatalog(ctx, [productId]);
    listing = await listingOf(ctx.store, st.id, productId);
  }
  assert(listing, "Produto não encontrado no catálogo da loja.");
  const product = await ctx.store.getOrThrow("products", productId);
  const title = input.title.trim();
  assert(title.length >= 2, "Informe o título do produto na loja.");
  const price = input.priceOverride != null && input.priceOverride > 0 ? Math.round(input.priceOverride) : null;
  const compare = input.compareAtPrice != null && input.compareAtPrice > 0 ? Math.round(input.compareAtPrice) : null;
  if (compare != null) assert(price == null || compare > price, "O preço “de” precisa ser maior que o preço da loja.");
  const images = [...new Set(input.images.filter(Boolean))].slice(0, MAX_IMAGES);
  for (const f of images) {
    const meta = await ctx.store.get("files", f);
    assert(meta && meta.companyId === ctx.companyId && meta.kind === "store_image", "Foto inválida: envie a imagem pela tela do produto na loja.");
  }
  if (input.categoryId) {
    const cat = await ctx.store.get("categories", input.categoryId);
    assert(cat && cat.companyId === ctx.companyId, "Categoria inválida.");
  }
  const slug = await uniqueListingSlug(ctx.store, st.id, input.slug?.trim() || title, listing!.id);
  const dims = (v: number | null | undefined, max: number) => (v != null && v > 0 ? Math.min(max, Math.round(v)) : null);
  const patch = {
    title: title.slice(0, 200),
    slug,
    description: input.description.trim().slice(0, 8000),
    categoryId: input.categoryId || product.categoryId || null,
    images,
    priceOverride: price,
    compareAtPrice: compare,
    weightGrams: dims(input.weightGrams, 1_000_000),
    heightCm: dims(input.heightCm, 400),
    widthCm: dims(input.widthCm, 400),
    lengthCm: dims(input.lengthCm, 400),
    featured: Boolean(input.featured),
    published: Boolean(input.published),
    seoTitle: input.seoTitle?.trim().slice(0, 70) || null,
    seoDescription: input.seoDescription?.trim().slice(0, 160) || null,
    searchText: searchable(title, product.code, product.name),
    updatedBy: ctx.user.id,
  };
  // peso informado na loja completa o cadastro do produto quando ele não tinha (uma referência só para o frete)
  if (patch.weightGrams && !product.weightGrams) await ctx.store.update("products", productId, { weightGrams: patch.weightGrams });
  const after = await unscoped(ctx.store).update("store_products", listing!.id, patch);
  const revalidated = await validateListings(ctx, [productId], { silent: true });
  await audit(ctx, { module: "sales", action: "ecommerce.listing_save", entityType: "store_product", entityId: listing!.id, summary: `Produto “${title}” atualizado no catálogo digital${patch.published ? " (na vitrine)" : ""}`, before: { title: listing!.title, priceOverride: listing!.priceOverride, published: listing!.published }, after: { title: patch.title, priceOverride: patch.priceOverride, published: patch.published }, related: [`store:${st.id}`, `product:${productId}`] });
  return revalidated[0] ?? after;
}

/** Liga/desliga a presença na vitrine de vários produtos (os com pendência bloqueante entram, mas não aparecem). */
export async function setPresence(ctx: Ctx, productIds: string[], published: boolean) {
  requireAction(ctx, "ecommerce.catalog");
  const st = await requireStore(ctx);
  if (published) await addToCatalog(ctx, productIds);
  let n = 0;
  for (const pid of productIds) {
    const l = await listingOf(ctx.store, st.id, pid);
    if (!l || Boolean(l.published) === published) continue;
    await unscoped(ctx.store).update("store_products", l.id, { published, updatedBy: ctx.user.id });
    n++;
  }
  if (n) await audit(ctx, { module: "sales", action: "ecommerce.listing_presence", entityType: "store", entityId: st.id, summary: `${n} produto(s) ${published ? "colocado(s) na" : "retirado(s) da"} vitrine`, related: [`store:${st.id}`] });
  return n;
}

/**
 * "Validar seleção para envio" (Tela 52): recalcula as pendências e registra no monitor uma falha por produto com
 * pendência bloqueante (cadastro de origem para correção) ou um evento concluído. Revalidar um produto já correto não
 * gera nada novo além do registro da validação.
 */
export async function validateListings(ctx: Ctx, productIds: string[], opts: { silent?: boolean } = {}): Promise<Doc[]> {
  requireAction(ctx, "ecommerce.catalog");
  const st = await requireStore(ctx);
  const out: Doc[] = [];
  const listings = new Map<string, Doc>();
  for (const pid of productIds) {
    const l = await listingOf(ctx.store, st.id, pid);
    if (l) listings.set(pid, l);
  }
  const skus: Doc[] = [];
  const ids = [...listings.keys()];
  for (let i = 0; i < ids.length; i += 100) skus.push(...(await listAll(ctx.store, "skus", { filters: [["eq", "productId", ids.slice(i, i + 100)]] })));
  const prices = await storePrices(ctx.store, st, skus, listings);
  for (const [pid, l] of listings) {
    const product = await ctx.store.get("products", pid);
    if (!product) continue;
    const own = skus.filter((s) => s.productId === pid);
    const ps = own.map((s) => prices.get(s.id) ?? 0).filter((v) => v > 0);
    const issues = computeIssues({ st, product, skus: own, listing: l, price: ps.length ? Math.min(...ps) : 0 });
    const after = await unscoped(ctx.store).update("store_products", l.id, { issues });
    out.push(after);
    if (opts.silent && !hasBlocking(issues)) continue;
    const blocking = issues.filter((i) => i.blocking);
    await commerceEvent(ctx.store, {
      companyId: ctx.companyId,
      storeId: st.id,
      area: "catalog",
      action: "catalog.validate",
      status: blocking.length ? "failed" : "ok",
      reference: l.title,
      diagnostic: blocking.length ? `Falha de validação: ${blocking.map((b) => b.label.toLowerCase()).join("; ")}. Corrija o cadastro do produto e reprocesse.` : "Produto pronto para a vitrine e para os conectores.",
      subject: `product:${pid}`,
    });
  }
  return out;
}

// ───────────────────────────── Vitrine (Telas 61–62)

export interface PublicCard {
  productId: string;
  slug: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  imageFileId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  available: boolean;
  featured: boolean;
}

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  count: number;
}

/** Itens vendáveis da vitrine: publicados, sem pendência bloqueante e com preço — leitura com o Store restrito à empresa. */
async function sellable(store: Store, st: Doc) {
  const listings = (await listingsOf(store, st.id)).filter((l) => l.published && !hasBlocking(l.issues));
  const byProduct = new Map(listings.map((l) => [l.productId, l]));
  const pids = listings.map((l) => l.productId);
  const products: Doc[] = [];
  const skus: Doc[] = [];
  for (let i = 0; i < pids.length; i += 100) {
    const chunk = pids.slice(i, i + 100);
    products.push(...(await listAll(unscoped(store), "products", { filters: [["eq", "id", chunk]] })));
    skus.push(...(await listAll(unscoped(store), "skus", { filters: [["eq", "productId", chunk]] })));
  }
  const live = products.filter((p) => p.companyId === st.companyId && p.active !== false && (!p.status || p.status === "active"));
  const activeSkus = skus.filter((s) => s.companyId === st.companyId && s.active !== false && live.some((p) => p.id === s.productId));
  const prices = await storePrices(store, st, activeSkus, byProduct);
  const stock = await storeStock(store, st, activeSkus.map((s) => s.id));
  return { listings, byProduct, products: live, skus: activeSkus, prices, stock };
}

export async function publicCatalog(store: Store, st: Doc, opts: { q?: string | null; category?: string | null } = {}) {
  const data = await sellable(store, st);
  const cats = new Map((await listAll(unscoped(store), "categories", { filters: [["eq", "companyId", st.companyId]] })).map((c) => [c.id, c]));
  const cards: PublicCard[] = [];
  for (const p of data.products) {
    const l = data.byProduct.get(p.id)!;
    const own = data.skus.filter((s) => s.productId === p.id);
    const ps = own.map((s) => data.prices.get(s.id) ?? 0).filter((v) => v > 0);
    if (!ps.length) continue;
    const catId = l.categoryId ?? p.categoryId ?? null;
    cards.push({
      productId: p.id,
      slug: l.slug,
      title: l.title,
      price: Math.min(...ps),
      compareAtPrice: l.compareAtPrice ?? null,
      imageFileId: (l.images ?? [])[0] ?? p.imageFileId ?? null,
      categoryId: catId,
      categoryName: catId ? (cats.get(catId)?.name ?? null) : null,
      available: own.some((s) => (data.stock.get(s.id) ?? 0) >= QTY),
      featured: Boolean(l.featured),
    });
  }
  const categories: PublicCategory[] = [];
  for (const c of cards) {
    if (!c.categoryId || !c.categoryName) continue;
    const cur = categories.find((x) => x.id === c.categoryId);
    if (cur) cur.count++;
    else categories.push({ id: c.categoryId, name: c.categoryName, slug: slugify(c.categoryName), count: 1 });
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));
  let filtered = cards;
  if (opts.category) filtered = filtered.filter((c) => c.categoryId && slugify(c.categoryName ?? "") === opts.category);
  const q = slugify(String(opts.q ?? "")).replace(/-/g, " ").trim();
  if (q) {
    const terms = q.split(/\s+/);
    filtered = filtered.filter((c) => {
      const l = data.byProduct.get(c.productId);
      const hay = slugify(`${c.title} ${c.categoryName ?? ""} ${l?.searchText ?? ""} ${data.skus.filter((s) => s.productId === c.productId).map((s) => s.sku).join(" ")}`).replace(/-/g, " ");
      return terms.every((t) => hay.includes(t));
    });
  }
  filtered.sort((a, b) => Number(b.available) - Number(a.available) || Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title));
  return { cards: filtered, all: cards, categories };
}

export interface PublicVariant {
  skuId: string;
  sku: string;
  label: string;
  attributes: Record<string, string>;
  price: number;
  /** disponível em unidades inteiras (limite da quantidade no carrinho) */
  available: number;
}

export async function publicProduct(store: Store, st: Doc, slug: string) {
  const data = await sellable(store, st);
  const l = data.listings.find((x) => x.slug === slug);
  if (!l) return null;
  const p = data.products.find((x) => x.id === l.productId);
  if (!p) return null;
  const variants: PublicVariant[] = data.skus
    .filter((s) => s.productId === p.id && (data.prices.get(s.id) ?? 0) > 0)
    .map((s) => {
      const attrs = (s.attributes ?? {}) as Record<string, string>;
      const label = Object.values(attrs).filter(Boolean).join(" · ") || "Único";
      return { skuId: s.id, sku: s.sku, label, attributes: attrs, price: data.prices.get(s.id)!, available: Math.floor((data.stock.get(s.id) ?? 0) / QTY) };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  if (!variants.length) return null;
  const catId = l.categoryId ?? p.categoryId ?? null;
  const category = catId ? await unscoped(store).get("categories", catId) : null;
  const brand = p.brandId ? await unscoped(store).get("brands", p.brandId) : null;
  const images: string[] = (l.images ?? []).length ? l.images : p.imageFileId ? [p.imageFileId] : [];
  return { listing: l, product: p, variants, category: category && category.companyId === st.companyId ? category : null, brand: brand && brand.companyId === st.companyId ? brand : null, images };
}

/** Uma imagem pode ser servida publicamente só se for da identidade da loja ou de um produto da vitrine. */
export async function isPublicImage(store: Store, st: Doc, fileId: string): Promise<boolean> {
  if (st.theme?.logoFileId === fileId || st.theme?.heroFileId === fileId) return true;
  const listings = (await listingsOf(store, st.id)).filter((l) => l.published);
  if (listings.some((l) => (l.images ?? []).includes(fileId))) return true;
  const pids = listings.filter((l) => !(l.images ?? []).length).map((l) => l.productId);
  for (let i = 0; i < pids.length; i += 100) {
    const ps = await listAll(unscoped(store), "products", { filters: [["eq", "id", pids.slice(i, i + 100)]] });
    if (ps.some((p) => p.imageFileId === fileId && p.companyId === st.companyId)) return true;
  }
  return false;
}

/** Sitemap: produtos vendáveis com data de atualização. */
export async function sitemapEntries(store: Store, st: Doc) {
  const data = await sellable(store, st);
  return data.listings.filter((l) => data.products.some((p) => p.id === l.productId)).map((l) => ({ slug: l.slug, updatedAt: l.updatedAt ?? l.createdAt ?? null }));
}

export function assertCatalogLimit(n: number) {
  if (n > 500) throw new BusinessError("Selecione no máximo 500 produtos por vez.");
}
