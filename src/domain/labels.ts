import { listAll } from "@/lib/db";
import { assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { normalizeSearch } from "@/lib/list";
import { QTY } from "@/lib/money";
import { categoryDescendants } from "./products";
import { defaultPriceTableId, resolvePrices } from "./pricing";
import { getReceipt, type ReceiptItem } from "./receipts";

/**
 * Etiquetas de produtos (CAD-17): gôndola, adesiva pequena e folha A4, com nome, preço da tabela escolhida (resolução
 * igual à do PDV: preço da filial → geral, vigência do dia) e código de barras (EAN-13 do SKU ou Code 128 do
 * GTIN/SKU). Impressão pelo navegador (`?print=1`); nada é gravado.
 */

export type LabelModel = "gondola" | "adesiva" | "a4";

export const LABEL_MODELS: Array<{ value: LabelModel; label: string; hint: string }> = [
  { value: "gondola", label: "Gôndola — nome, preço e código de barras", hint: "Etiqueta de prateleira (≈ 64 × 34 mm), 3 por linha, 21 por folha A4." },
  { value: "adesiva", label: "Adesiva pequena — 2 colunas", hint: "Rolo de 2 colunas (50 × 25 mm cada), para colar no produto." },
  { value: "a4", label: "Folha A4 — 30 por folha", hint: "Folha de etiquetas 3 × 10 (≈ 66 × 25 mm, tipo Pimaco 6180)." },
];

/** Limite de etiquetas por impressão (proteção do navegador). */
export const MAX_LABELS = 2000;
export const MAX_COPIES = 500;

export interface LabelRequest {
  skuId: string;
  copies: number;
}

export interface LabelItem {
  skuId: string;
  productId: string;
  sku: string;
  name: string;
  unitCode: string | null;
  barcode: string | null;
  price: number | null;
  copies: number;
}

/** Converte "skuId:qtd,skuId:qtd" (URL) em pedidos de etiqueta. */
export function parseLabelParam(raw: string | null | undefined): LabelRequest[] {
  if (!raw) return [];
  const out = new Map<string, number>();
  for (const part of raw.split(",")) {
    const [id, q] = part.split(":");
    const skuId = (id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(skuId)) continue;
    const n = Math.max(1, Math.min(MAX_COPIES, Math.floor(Number(q) || 1)));
    out.set(skuId, (out.get(skuId) ?? 0) + n);
  }
  return [...out].map(([skuId, copies]) => ({ skuId, copies: Math.min(copies, MAX_COPIES) }));
}

export function formatLabelParam(items: LabelRequest[]): string {
  return items.map((i) => `${i.skuId}:${i.copies}`).join(",");
}

/** Dados das etiquetas (preço resolvido na tabela e filial do contexto). */
export async function labelItems(ctx: Ctx, input: { items: LabelRequest[]; priceTableId?: string | null }): Promise<LabelItem[]> {
  requirePerm(ctx, "products", "view");
  const reqs = input.items.filter((i) => i.copies > 0);
  const total = reqs.reduce((a, i) => a + i.copies, 0);
  assert(total <= MAX_LABELS, `No máximo ${MAX_LABELS} etiquetas por impressão (pedido: ${total}).`);
  if (!reqs.length) return [];
  const ids = [...new Set(reqs.map((r) => r.skuId))];
  const skus = [];
  for (let i = 0; i < ids.length; i += 100) skus.push(...(await listAll(ctx.store, "skus", { filters: [["eq", "id", ids.slice(i, i + 100)]] })));
  const own = new Map(skus.filter((s) => s.companyId === ctx.companyId).map((s) => [s.id, s]));
  const tableId = input.priceTableId || (await defaultPriceTableId(ctx.store, ctx.companyId));
  const prices = await resolvePrices(ctx.store, { companyId: ctx.companyId, branchId: ctx.branchId, priceTableId: tableId, items: [...own.keys()].map((skuId) => ({ skuId, qty: QTY })) });
  const priceBy = new Map(prices.map((p) => [p.skuId, p.priceId ? p.listPrice : null]));
  return reqs
    .filter((r) => own.has(r.skuId))
    .map((r) => {
      const s = own.get(r.skuId)!;
      return { skuId: s.id, productId: s.productId, sku: s.sku, name: s.name ?? s.sku, unitCode: s.unitCode ?? null, barcode: s.barcode || null, price: priceBy.get(s.id) ?? null, copies: r.copies };
    });
}

/** Etiquetas sugeridas por um recebimento concluído: uma por unidade recebida (fração arredonda para cima). */
export async function receiptLabelRequests(ctx: Ctx, receiptId: string): Promise<{ number: number; items: LabelRequest[] }> {
  requirePerm(ctx, "purchases", "view");
  const r = await getReceipt(ctx, receiptId);
  assert(r.status === "confirmed", `Recebimento nº ${r.number} ainda não foi concluído.`);
  const by = new Map<string, number>();
  for (const it of (r.items ?? []) as ReceiptItem[]) {
    if (it.ignore || !it.skuId || !(it.receivedQty > 0)) continue;
    by.set(it.skuId, (by.get(it.skuId) ?? 0) + it.receivedQty);
  }
  return { number: r.number, items: [...by].map(([skuId, qty]) => ({ skuId, copies: Math.min(MAX_COPIES, Math.max(1, Math.ceil(qty / QTY))) })) };
}

/** Busca de SKUs ativos para montar a fila de etiquetas (texto e/ou categoria). */
export async function searchLabelSkus(ctx: Ctx, input: { q?: string | null; categoryId?: string | null; limit?: number }) {
  requirePerm(ctx, "products", "view");
  const q = normalizeSearch(input.q ?? "");
  assert(q || input.categoryId, "Digite parte do nome, código, SKU ou GTIN, ou escolha uma categoria.");
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "type", "product"]];
  if (input.categoryId) {
    const cats = await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] });
    filters.push(["eq", "categoryId", categoryDescendants(cats, input.categoryId)]);
  }
  const products = (await listAll(ctx.store, "products", { filters })).filter((p) => p.status !== "inactive");
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: Array<{ skuId: string; sku: string; name: string; barcode: string | null; productCode: string }> = [];
  const limit = Math.min(input.limit ?? 60, 200);
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length && out.length < limit; i += 100) {
    const skus = await listAll(ctx.store, "skus", { filters: [["eq", "productId", ids.slice(i, i + 100)]] });
    for (const s of skus) {
      if (s.active === false) continue;
      const p = byId.get(s.productId)!;
      const hay = [s.name, s.sku, s.barcode, ...(s.extraBarcodes ?? []), p.code, p.name].filter(Boolean).map((x: string) => normalizeSearch(x));
      if (q && !hay.some((h) => h.includes(q))) continue;
      out.push({ skuId: s.id, sku: s.sku, name: s.name ?? p.name, barcode: s.barcode || null, productCode: p.code ?? "" });
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
