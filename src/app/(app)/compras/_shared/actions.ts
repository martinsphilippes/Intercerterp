"use server";

import { runAction } from "@/lib/server/action";
import { listAll } from "@/lib/db";
import { searchable } from "@/lib/core/text";

export interface SkuHit {
  id: string;
  sku: string;
  name: string;
  unitCode: string;
  barcode: string | null;
  costAcquisition: number;
  supplierCode: string | null;
  lastCost: number | null;
  leadTimeDays: number | null;
  minQty: number | null;
  multiple: number | null;
}

/** Pesquisa de SKUs de produto (nome, SKU, código de barras ou código do fornecedor) com dados do vínculo do fornecedor. */
export async function searchSkusAction(q: string, supplierId?: string | null) {
  return runAction({ module: "purchases" }, async (s) => {
    const term = (q ?? "").trim();
    if (term.length < 2) return [] as SkuHit[];
    const store = s.ctx.store;
    const res = await store.list("skus", { filters: [["eq", "companyId", s.ctx.companyId], ["or", [["contains", "searchText", searchable(term)], ["eq", "barcode", term], ["eq", "sku", term.toUpperCase()]]]], limit: 15 });
    const items = [...res.items];
    if (supplierId) {
      const byCode = await store.list("supplier_products", { filters: [["eq", "supplierId", supplierId], ["eq", "supplierCode", term]], limit: 5 });
      for (const sp of byCode.items) if (!items.some((i) => i.id === sp.skuId)) {
        const sku = await store.get("skus", sp.skuId);
        if (sku) items.unshift(sku);
      }
    }
    if (!items.length) return [] as SkuHit[];
    const sps = supplierId ? await listAll(store, "supplier_products", { filters: [["eq", "supplierId", supplierId], ["eq", "skuId", items.map((i) => i.id)]] }) : [];
    const products = new Map((await listAll(store, "products", { filters: [["eq", "id", [...new Set(items.map((i) => i.productId))]]] })).map((p) => [p.id, p]));
    return items
      .filter((i) => i.active !== false && products.get(i.productId)?.type !== "service")
      .map((i): SkuHit => {
        const sp = sps.find((x) => x.skuId === i.id);
        return { id: i.id, sku: i.sku, name: i.name ?? i.sku, unitCode: i.unitCode ?? "UN", barcode: i.barcode ?? null, costAcquisition: i.costAcquisition ?? 0, supplierCode: sp?.supplierCode ?? null, lastCost: sp?.lastCost ?? null, leadTimeDays: sp?.leadTimeDays ?? null, minQty: sp?.minQty ?? null, multiple: sp?.multiple ?? null };
      });
  });
}

/** Último custo/código do fornecedor para uma lista de SKUs (sugestão de custo no pedido). */
export async function supplierCostsAction(supplierId: string, skuIds: string[]) {
  return runAction({ module: "purchases" }, async (s) => {
    if (!supplierId || !skuIds.length) return {} as Record<string, { lastCost: number | null; supplierCode: string | null; leadTimeDays: number | null }>;
    const sps = await listAll(s.ctx.store, "supplier_products", { filters: [["eq", "supplierId", supplierId], ["eq", "skuId", skuIds]] });
    return Object.fromEntries(sps.map((sp) => [sp.skuId, { lastCost: sp.lastCost ?? null, supplierCode: sp.supplierCode ?? null, leadTimeDays: sp.leadTimeDays ?? null }]));
  });
}
