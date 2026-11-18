import crypto from "node:crypto";
import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { nowIso, today } from "@/lib/dates";
import { QTY, pct } from "@/lib/money";
import { onlyDigits } from "@/lib/core/text";
import { publicProduct, storePrices, storeStock } from "./catalog";
import { deliveryOptions, type CartLine, type DeliveryOption } from "./shipping";
import { checkoutOf } from "./store";

/**
 * Carrinho da vitrine (Tela 63). Identificado por um token aleatório no cookie do navegador; guarda só SKU e
 * quantidade — preço, disponibilidade, desconto e frete são recalculados a cada leitura (o navegador nunca dita valor).
 */

export const CART_MAX_LINES = 30;
export const CART_MAX_UNITS = 99;
/** cotação de frete guardada no carrinho vale por 30 minutos (ou até mudar itens/cupom/CEP) */
const QUOTE_TTL_MS = 30 * 60 * 1000;

export const cartId = (storeId: string, token: string) => detId("scart", storeId, token);
export const validCartToken = (t: string | null | undefined): t is string => /^[0-9a-f]{32}$/.test(String(t ?? ""));

export async function getCart(store: Store, st: Doc, token: string | null | undefined): Promise<Doc | null> {
  if (!validCartToken(token)) return null;
  const c = await unscoped(store).get("store_carts", cartId(st.id, token));
  return c && c.storeId === st.id ? c : null;
}

async function ensureCart(store: Store, st: Doc, token: string): Promise<Doc> {
  const cur = await getCart(store, st, token);
  if (cur) return cur;
  try {
    return await unscoped(store).create(
      "store_carts",
      { companyId: st.companyId, branchId: null, createdBy: "storefront", storeId: st.id, token, items: [], itemsCount: 0, subtotal: 0, couponCode: null, customer: null, address: null, delivery: null, marketingConsent: false, status: "open", orderId: null, lastActivityAt: nowIso(), recoveryDraft: null, recoveryAt: null },
      cartId(st.id, token),
    );
  } catch (e) {
    if (isConflict(e)) return (await getCart(store, st, token))!;
    throw e;
  }
}

async function saveItems(store: Store, cart: Doc, items: Array<{ skuId: string; productId: string; qty: number }>, extra: Record<string, unknown> = {}) {
  return unscoped(store).update("store_carts", cart.id, { items, itemsCount: items.reduce((a, i) => a + Math.round(i.qty / QTY), 0), lastActivityAt: nowIso(), delivery: cart.delivery ? { ...cart.delivery, options: null, quotedAt: null } : null, ...extra });
}

function assertOpen(cart: Doc) {
  if (cart.status !== "open") throw new BusinessError("Este carrinho já virou pedido. Atualize a página para começar outra compra.", "cart_closed");
}

/** Adiciona (ou soma) um SKU da vitrine; a quantidade fica limitada ao disponível. */
export async function addToCart(store: Store, st: Doc, token: string, input: { productSlug: string; skuId?: string | null; qty: number }) {
  assert(validCartToken(token), "Carrinho inválido: recarregue a página.");
  const pub = await publicProduct(store, st, input.productSlug);
  assert(pub, "Produto indisponível na loja.");
  const variant = input.skuId ? pub!.variants.find((v) => v.skuId === input.skuId) : pub!.variants.length === 1 ? pub!.variants[0] : null;
  assert(variant, "Escolha a variação (tamanho, cor) antes de adicionar ao carrinho.");
  const units = Math.max(1, Math.min(CART_MAX_UNITS, Math.floor(Number(input.qty) || 1)));
  const cart = await ensureCart(store, st, token);
  assertOpen(cart);
  const items = [...((cart.items ?? []) as Array<{ skuId: string; productId: string; qty: number }>)];
  const cur = items.find((i) => i.skuId === variant!.skuId);
  const wanted = (cur ? Math.round(cur.qty / QTY) : 0) + units;
  if (variant!.available < 1) throw new BusinessError("Produto sem estoque disponível no momento.", "out_of_stock");
  const finalUnits = Math.min(wanted, variant!.available, CART_MAX_UNITS);
  if (cur) cur.qty = finalUnits * QTY;
  else {
    assert(items.length < CART_MAX_LINES, `O carrinho aceita até ${CART_MAX_LINES} produtos diferentes.`);
    items.push({ skuId: variant!.skuId, productId: pub!.product.id, qty: finalUnits * QTY });
  }
  await saveItems(store, cart, items);
  return { added: finalUnits - (cur ? wanted - units : 0), limited: finalUnits < wanted, available: variant!.available };
}

export async function setCartQty(store: Store, st: Doc, token: string, skuId: string, units: number) {
  const cart = await getCart(store, st, token);
  if (!cart) return;
  assertOpen(cart);
  const items = ((cart.items ?? []) as Array<{ skuId: string; productId: string; qty: number }>).map((i) => ({ ...i }));
  const idx = items.findIndex((i) => i.skuId === skuId);
  if (idx < 0) return;
  const n = Math.floor(Number(units) || 0);
  if (n <= 0) items.splice(idx, 1);
  else items[idx].qty = Math.min(n, CART_MAX_UNITS) * QTY;
  await saveItems(store, cart, items);
}

// ───────────────────────────── Cupons

export function normalizeCouponCode(v: string | null | undefined) {
  return String(v ?? "").trim().toUpperCase();
}

/** Desconto do cupom sobre os produtos (sem frete), respeitando compra mínima e teto por pedido. */
export function couponDiscount(coupon: Doc | null, goods: number): { discount: number; problem: string | null } {
  if (!coupon) return { discount: 0, problem: null };
  if (!coupon.active) return { discount: 0, problem: "Cupom pausado." };
  const d = today();
  if (coupon.validFrom && d < coupon.validFrom) return { discount: 0, problem: "Cupom ainda não está valendo." };
  if (coupon.validTo && d > coupon.validTo) return { discount: 0, problem: "Cupom expirado." };
  if (coupon.usageLimit && (coupon.usedCount ?? 0) >= coupon.usageLimit) return { discount: 0, problem: "Cupom esgotado." };
  if (coupon.minOrder && goods < coupon.minOrder) return { discount: 0, problem: `Cupom válido em compras a partir de ${(coupon.minOrder / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.` };
  let discount = coupon.percentBps ? pct(goods, coupon.percentBps) : 0;
  if (coupon.capAmount && coupon.capAmount > 0) discount = Math.min(discount, coupon.capAmount);
  return { discount: Math.min(discount, goods), problem: null };
}

export async function couponByCode(store: Store, st: Doc, code: string): Promise<Doc | null> {
  const c = normalizeCouponCode(code);
  if (!c) return null;
  return unscoped(store).get("store_coupons", detId("scoupon", st.id, c));
}

export async function applyCoupon(store: Store, st: Doc, token: string, code: string) {
  const cart = await getCart(store, st, token);
  assert(cart, "Carrinho vazio.");
  assertOpen(cart!);
  const coupon = await couponByCode(store, st, code);
  if (!coupon) throw new BusinessError("Cupom não encontrado.", "coupon_invalid");
  const view = await cartView(store, st, token);
  const { problem } = couponDiscount(coupon, view?.subtotal ?? 0);
  if (problem) throw new BusinessError(problem, "coupon_invalid");
  await unscoped(store).update("store_carts", cart!.id, { couponCode: coupon.code, lastActivityAt: nowIso(), delivery: cart!.delivery ? { ...cart!.delivery, options: null, quotedAt: null } : null });
}

export async function removeCoupon(store: Store, st: Doc, token: string) {
  const cart = await getCart(store, st, token);
  if (!cart) return;
  await unscoped(store).update("store_carts", cart.id, { couponCode: null, lastActivityAt: nowIso(), delivery: cart.delivery ? { ...cart.delivery, options: null, quotedAt: null } : null });
}

// ───────────────────────────── Entrega no carrinho

export async function setDeliveryZip(store: Store, st: Doc, token: string, zip: string) {
  const cart = await getCart(store, st, token);
  assert(cart, "Carrinho vazio.");
  const z = onlyDigits(zip);
  assert(z.length === 8, "CEP inválido: informe os 8 dígitos.");
  await unscoped(store).update("store_carts", cart!.id, { delivery: { zip: z, selectedId: cart!.delivery?.selectedId ?? null, options: null, quotedAt: null }, lastActivityAt: nowIso() });
}

export async function selectDelivery(store: Store, st: Doc, token: string, optionId: string) {
  const cart = await getCart(store, st, token);
  assert(cart, "Carrinho vazio.");
  await unscoped(store).update("store_carts", cart!.id, { delivery: { ...(cart!.delivery ?? {}), selectedId: String(optionId).slice(0, 80) }, lastActivityAt: nowIso() });
}

// ───────────────────────────── Leitura com totais

export interface CartViewLine {
  skuId: string;
  productId: string;
  slug: string | null;
  title: string;
  variant: string;
  sku: string;
  imageFileId: string | null;
  categoryName: string | null;
  units: number;
  unitPrice: number;
  lineTotal: number;
  availableUnits: number;
  problem: string | null;
}

export interface CartView {
  cart: Doc;
  lines: CartViewLine[];
  units: number;
  subtotal: number;
  coupon: Doc | null;
  couponProblem: string | null;
  discount: number;
  delivery: { zip: string | null; options: DeliveryOption[]; selected: DeliveryOption | null; problems: string[] };
  shipping: number;
  total: number;
  /** pendências que impedem seguir para o checkout */
  blockers: string[];
}

const itemsKey = (lines: Array<{ skuId: string; qty: number }>, discount: number, coupon: string | null) =>
  crypto.createHash("sha256").update(JSON.stringify([lines.map((l) => [l.skuId, l.qty]), discount, coupon])).digest("hex").slice(0, 16);

/** Carrinho com preços, disponibilidade, cupom e frete recalculados (a cotação fica guardada até mudar algo). */
export async function cartView(store: Store, st: Doc, token: string | null | undefined, opts: { requote?: boolean } = {}): Promise<CartView | null> {
  const cart = await getCart(store, st, token);
  if (!cart) return null;
  const raw = (cart.items ?? []) as Array<{ skuId: string; productId: string; qty: number }>;
  const base = unscoped(store);
  const skus = raw.length ? (await listAll(base, "skus", { filters: [["eq", "id", raw.map((r) => r.skuId)]] })).filter((s) => s.companyId === st.companyId) : [];
  const listings = new Map<string, Doc>();
  for (const r of raw) {
    const l = (await listAll(base, "store_products", { filters: [["eq", "storeId", st.id], ["eq", "productId", r.productId]] }))[0];
    if (l) listings.set(r.productId, l);
  }
  const prices = await storePrices(store, st, skus, listings);
  const stock = await storeStock(store, st, skus.map((s) => s.id));
  const cats = new Map<string, string>();
  const lines: CartViewLine[] = [];
  for (const r of raw) {
    const sku = skus.find((s) => s.id === r.skuId);
    const l = listings.get(r.productId);
    const product = sku ? await base.get("products", sku.productId) : null;
    const units = Math.round(r.qty / QTY);
    const availableUnits = Math.floor((stock.get(r.skuId) ?? 0) / QTY);
    const sellable = Boolean(sku && sku.active !== false && l?.published && !(l.issues ?? []).some((i: { blocking?: boolean }) => i.blocking) && product && product.active !== false);
    const price = prices.get(r.skuId) ?? 0;
    const catId = l?.categoryId ?? product?.categoryId ?? null;
    if (catId && !cats.has(catId)) cats.set(catId, (await base.get("categories", catId))?.name ?? "");
    const attrs = (sku?.attributes ?? {}) as Record<string, string>;
    let problem: string | null = null;
    if (!sellable || !(price > 0)) problem = "Produto indisponível na loja: remova para continuar.";
    else if (availableUnits < 1) problem = "Sem estoque no momento: remova para continuar.";
    else if (units > availableUnits) problem = `Restam ${availableUnits} unidade(s): ajuste a quantidade.`;
    lines.push({
      skuId: r.skuId,
      productId: r.productId,
      slug: l?.slug ?? null,
      title: l?.title ?? product?.name ?? "Produto",
      variant: Object.values(attrs).filter(Boolean).join(" · "),
      sku: sku?.sku ?? "",
      imageFileId: (l?.images ?? [])[0] ?? product?.imageFileId ?? null,
      categoryName: catId ? cats.get(catId) || null : null,
      units,
      unitPrice: price,
      lineTotal: price * units,
      availableUnits,
      problem,
    });
  }
  const subtotal = lines.filter((l) => !l.problem).reduce((a, l) => a + l.lineTotal, 0);
  const coupon = cart.couponCode ? await couponByCode(store, st, cart.couponCode) : null;
  const cd = couponDiscount(coupon, subtotal);
  const discount = cd.discount;
  const goods = subtotal - discount;
  // frete: cotação guardada enquanto itens, desconto e CEP forem os mesmos
  const zip: string | null = cart.delivery?.zip ?? null;
  const key = itemsKey(raw, discount, cart.couponCode ?? null);
  let options: DeliveryOption[] = (cart.delivery?.options as DeliveryOption[] | null) ?? [];
  let problems: string[] = (cart.delivery?.problems as string[] | null) ?? [];
  const fresh = cart.delivery?.quotedAt && cart.delivery?.key === key && Date.now() - Date.parse(cart.delivery.quotedAt) < QUOTE_TTL_MS;
  if ((opts.requote || !fresh) && lines.length) {
    const cartLines: CartLine[] = lines.filter((l) => !l.problem).map((l) => ({ skuId: l.skuId, productId: l.productId, qty: l.units * QTY, unitPrice: l.unitPrice }));
    const res = await deliveryOptions(store, st, { zip, lines: cartLines, goodsAfterDiscount: goods, freeShipping: Boolean(coupon?.freeShipping && !cd.problem) });
    options = res.options;
    problems = res.problems;
    await base.update("store_carts", cart.id, { delivery: { zip, selectedId: cart.delivery?.selectedId ?? null, options, problems, quotedAt: nowIso(), key }, subtotal }).catch(() => undefined);
  }
  const selected = options.find((o) => o.id === cart.delivery?.selectedId) ?? null;
  const shipping = selected?.price ?? 0;
  const blockers: string[] = [];
  if (!lines.length) blockers.push("Seu carrinho está vazio.");
  if (lines.some((l) => l.problem)) blockers.push("Há produtos indisponíveis ou acima do estoque no carrinho.");
  const min = checkoutOf(st).minOrder;
  if (min > 0 && goods < min) blockers.push(`Pedido mínimo da loja: ${(min / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em produtos.`);
  return {
    cart,
    lines,
    units: lines.reduce((a, l) => a + l.units, 0),
    subtotal,
    coupon: cd.problem ? null : coupon,
    couponProblem: cart.couponCode ? cd.problem : null,
    discount,
    delivery: { zip, options, selected, problems },
    shipping,
    total: goods + shipping,
    blockers,
  };
}

/** Dados de contato informados no checkout (para retomar a compra) — só com consentimento para mensagens. */
export async function saveCartContact(store: Store, st: Doc, token: string, input: { name: string; email: string; phone: string; marketingConsent: boolean }) {
  const cart = await getCart(store, st, token);
  if (!cart || cart.status !== "open") return;
  await unscoped(store).update("store_carts", cart.id, {
    customer: { name: input.name.trim().slice(0, 120), email: input.email.trim().toLowerCase().slice(0, 200), phone: onlyDigits(input.phone).slice(0, 13) },
    marketingConsent: Boolean(input.marketingConsent),
    lastActivityAt: nowIso(),
  });
}
