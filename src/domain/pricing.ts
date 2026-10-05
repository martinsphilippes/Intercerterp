import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { today } from "@/lib/dates";

/**
 * Resolução de preço: tabela informada (ou padrão da filial/empresa), preço específico da filial
 * tem prioridade sobre o geral, vigência pela data, e preço de atacado quando a quantidade atinge o mínimo.
 */
export interface ResolvedPrice {
  skuId: string;
  price: number;
  listPrice: number;
  wholesale: boolean;
  maxDiscountBps: number | null;
  priceTableId: string | null;
  priceId: string | null;
}

export const priceScopeKey = (tableId: string, skuId: string, branchId: string | null | undefined, validFrom: string | null | undefined) => `${tableId}|${skuId}|${branchId ?? "*"}|${validFrom ?? ""}`;

export async function defaultPriceTableId(store: Store, companyId: string): Promise<string | null> {
  const res = await store.list("price_tables", { filters: [["eq", "companyId", companyId], ["eq", "isDefault", true], ["eq", "active", true]], limit: 1 });
  return res.items[0]?.id ?? null;
}

export async function resolvePrices(
  store: Store,
  input: { companyId: string; branchId: string | null; priceTableId?: string | null; items: Array<{ skuId: string; qty: number }>; date?: string },
): Promise<ResolvedPrice[]> {
  const date = input.date ?? today();
  const tableId = input.priceTableId ?? (await defaultPriceTableId(store, input.companyId));
  const defaultTable = await defaultPriceTableId(store, input.companyId);
  const skuIds = [...new Set(input.items.map((i) => i.skuId))];
  const prices = skuIds.length ? await listAll(store, "prices", { filters: [["eq", "skuId", skuIds]] }) : [];
  const pick = (skuId: string, table: string | null) => {
    const cands = prices.filter(
      (p) => p.skuId === skuId && p.priceTableId === table && (!p.branchId || p.branchId === input.branchId) && (!p.validFrom || p.validFrom <= date) && (!p.validTo || p.validTo >= date),
    );
    cands.sort((a, b) => (a.branchId ? 0 : 1) - (b.branchId ? 0 : 1) || String(b.validFrom ?? "").localeCompare(String(a.validFrom ?? "")));
    return cands[0] ?? null;
  };
  return input.items.map((i) => {
    const p = (tableId ? pick(i.skuId, tableId) : null) ?? (defaultTable && defaultTable !== tableId ? pick(i.skuId, defaultTable) : null);
    if (!p) return { skuId: i.skuId, price: 0, listPrice: 0, wholesale: false, maxDiscountBps: null, priceTableId: tableId, priceId: null };
    const wholesale = Boolean(p.wholesalePrice && p.wholesaleMinQty && i.qty >= p.wholesaleMinQty);
    return {
      skuId: i.skuId,
      price: wholesale ? p.wholesalePrice : p.price,
      listPrice: p.price,
      wholesale,
      maxDiscountBps: p.maxDiscountBps ?? null,
      priceTableId: p.priceTableId,
      priceId: p.id,
    };
  });
}
