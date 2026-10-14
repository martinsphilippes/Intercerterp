import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { assert } from "@/lib/core/errors";
import { addDays, startOfLocalDay, today } from "@/lib/dates";
import { normalizeSearch } from "@/lib/list";
import { QTY, roundDiv } from "@/lib/money";
import { onlyDigits } from "@/lib/core/text";
import { categoryDescendants, categoryPath } from "./products";

/**
 * Inventário em data-base (EST-05 — "inventário fiscal"). Reconstrói, a partir de `stock_movements`, o saldo de cada
 * SKU em cada depósito ao fim do dia da data-base (no fuso da instalação), valorizado pelo custo médio vigente
 * naquele momento:
 *  - quantidade = soma das quantidades dos movimentos do saldo com `occurredAt` < início do dia seguinte (o saldo
 *    começa em zero e só muda por movimento — igual ao `balanceAfter` do último movimento quando as datas seguem a
 *    sequência; a soma também é correta para movimentos com data retroativa);
 *  - custo médio = `avgCostAfter` do último movimento (maior `seq`) até a data-base;
 *  - valor = quantidade × custo médio (centavos, half-up). Saldo negativo aparece sinalizado e não é valorizado.
 * Nada é gravado. Na data de hoje o resultado bate com `stock_balances` (conferência `compareWithCurrent`).
 */

export interface FiscalInventoryFilters {
  /** data-base "aaaa-mm-dd" (até hoje) */
  date: string;
  /** filiais do recorte; null = todas as da empresa */
  branchIds: string[] | null;
  warehouseId?: string | null;
  /** categoria (inclui subcategorias) */
  categoryId?: string | null;
  /** NCM completo ou prefixo (capítulo/posição) */
  ncm?: string | null;
  /** busca por produto, código, SKU ou GTIN */
  q?: string | null;
  /** "available" | "damaged" — tipo de depósito */
  warehouseKind?: string | null;
}

export interface FiscalInventoryRow {
  id: string;
  balanceId: string;
  branchId: string;
  branchName: string;
  warehouseId: string;
  warehouseName: string;
  warehouseKind: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  ncm: string;
  categoryId: string | null;
  categoryName: string;
  qty: number;
  avgCost: number;
  value: number;
  negative: boolean;
  lastMovementAt: string | null;
}

export interface FiscalInventoryGroup {
  key: string;
  label: string;
  items: number;
  value: number;
}

export interface FiscalInventoryResult {
  date: string;
  /** instante limite (exclusivo): início do dia seguinte à data-base */
  cutoff: string;
  rows: FiscalInventoryRow[];
  totals: { items: number; value: number; negatives: number; positives: number };
  byNcm: FiscalInventoryGroup[];
  byCategory: FiscalInventoryGroup[];
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Data-base válida (aaaa-mm-dd, até hoje). */
export function assertBaseDate(date: string) {
  assert(isDate(date), "Informe uma data-base válida.");
  assert(date <= today(), "A data-base não pode ser futura.");
}

/** Último dia do ano anterior (data-base usual do Livro de Registro de Inventário). */
export function lastYearEnd(ref = today()): string {
  return `${Number(ref.slice(0, 4)) - 1}-12-31`;
}

interface Lookups {
  branch: Map<string, Doc>;
  warehouse: Map<string, Doc>;
  product: Map<string, Doc>;
  sku: Map<string, Doc>;
  categories: Doc[];
}

async function lookups(store: Store, companyId: string): Promise<Lookups> {
  const cid: any[] = [["eq", "companyId", companyId]];
  const [branches, warehouses, products, skus, categories] = await Promise.all([
    listAll(store, "branches", { filters: cid }),
    listAll(store, "warehouses", { filters: cid }),
    listAll(store, "products", { filters: cid }),
    listAll(store, "skus", { filters: cid }),
    listAll(store, "categories", { filters: cid }),
  ]);
  return {
    branch: new Map(branches.map((b) => [b.id, b])),
    warehouse: new Map(warehouses.map((w) => [w.id, w])),
    product: new Map(products.map((p) => [p.id, p])),
    sku: new Map(skus.map((s) => [s.id, s])),
    categories,
  };
}

function matchesQ(q: string, sku: Doc | undefined, product: Doc | undefined): boolean {
  if (!q) return true;
  const n = normalizeSearch(q);
  const up = q.trim().toUpperCase();
  return Boolean(
    (sku && (sku.sku === up || sku.barcode === q.trim() || (sku.extraBarcodes ?? []).includes(q.trim()) || normalizeSearch(sku.searchText ?? sku.name ?? "").includes(n))) ||
      (product && (normalizeSearch(product.name ?? "").includes(n) || String(product.code ?? "").toUpperCase() === up)),
  );
}

function group(rows: FiscalInventoryRow[], keyOf: (r: FiscalInventoryRow) => string, labelOf: (r: FiscalInventoryRow) => string): FiscalInventoryGroup[] {
  const m = new Map<string, FiscalInventoryGroup>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { key: k, label: labelOf(r), items: 0, value: 0 };
    g.items += 1;
    g.value += r.value;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

/** Saldo e custo médio de cada SKU × depósito na data-base, valorizados (ver regra no topo do arquivo). */
export async function fiscalInventory(store: Store, companyId: string, f: FiscalInventoryFilters): Promise<FiscalInventoryResult> {
  assertBaseDate(f.date);
  const cutoff = startOfLocalDay(addDays(f.date, 1));
  const lk = await lookups(store, companyId);
  const filters: any[] = [["eq", "companyId", companyId], ["lt", "occurredAt", cutoff]];
  if (f.branchIds) filters.push(["eq", "branchId", f.branchIds.length ? f.branchIds : ["__none__"]]);
  if (f.warehouseId) filters.push(["eq", "warehouseId", f.warehouseId]);
  const movs = await listAll(store, "stock_movements", { filters });
  const byBalance = new Map<string, { qty: number; last: Doc }>();
  for (const m of movs) {
    const cur = byBalance.get(m.balanceId);
    if (!cur) byBalance.set(m.balanceId, { qty: m.qty ?? 0, last: m });
    else {
      cur.qty += m.qty ?? 0;
      if ((m.seq ?? 0) > (cur.last.seq ?? 0)) cur.last = m;
    }
  }
  const cats = f.categoryId ? new Set(categoryDescendants(lk.categories as any, f.categoryId)) : null;
  const ncmPrefix = onlyDigits(f.ncm ?? "");
  const q = (f.q ?? "").trim();
  const rows: FiscalInventoryRow[] = [];
  for (const [balanceId, { qty, last }] of byBalance) {
    if (qty === 0) continue;
    const sku = lk.sku.get(last.skuId);
    const product = lk.product.get(last.productId ?? sku?.productId);
    const wh = lk.warehouse.get(last.warehouseId);
    if (f.warehouseKind && (wh?.kind ?? "available") !== f.warehouseKind) continue;
    if (cats && !(product?.categoryId && cats.has(product.categoryId))) continue;
    const ncm = String(product?.ncm ?? "");
    if (ncmPrefix && !ncm.startsWith(ncmPrefix)) continue;
    if (!matchesQ(q, sku, product)) continue;
    const avgCost = (last.avgCostAfter as number) ?? 0;
    const negative = qty < 0;
    rows.push({
      id: balanceId,
      balanceId,
      branchId: last.branchId,
      branchName: lk.branch.get(last.branchId)?.name ?? "—",
      warehouseId: last.warehouseId,
      warehouseName: wh?.name ?? "—",
      warehouseKind: wh?.kind ?? "available",
      skuId: last.skuId,
      skuCode: sku?.sku ?? "—",
      skuName: sku?.name ?? product?.name ?? "—",
      productId: product?.id ?? last.productId ?? "",
      productCode: product?.code ?? "",
      productName: product?.name ?? sku?.name ?? "—",
      unitCode: sku?.unitCode ?? product?.unitCode ?? "UN",
      ncm,
      categoryId: product?.categoryId ?? null,
      categoryName: product?.categoryId ? categoryPath(lk.categories as any, product.categoryId) || "—" : "Sem categoria",
      qty,
      avgCost,
      value: negative ? 0 : roundDiv(qty * avgCost, QTY),
      negative,
      lastMovementAt: last.occurredAt ?? null,
    });
  }
  rows.sort((a, b) => a.ncm.localeCompare(b.ncm) || a.productName.localeCompare(b.productName, "pt-BR") || a.skuCode.localeCompare(b.skuCode) || a.branchName.localeCompare(b.branchName, "pt-BR") || a.warehouseName.localeCompare(b.warehouseName, "pt-BR"));
  const valued = rows.filter((r) => !r.negative);
  return {
    date: f.date,
    cutoff,
    rows,
    totals: { items: rows.length, value: valued.reduce((a, r) => a + r.value, 0), negatives: rows.length - valued.length, positives: valued.length },
    byNcm: group(valued, (r) => r.ncm || "-", (r) => r.ncm || "Sem NCM"),
    byCategory: group(valued, (r) => r.categoryId ?? "-", (r) => r.categoryName),
  };
}

export interface InventoryConference {
  ok: boolean;
  checked: number;
  differences: Array<{ balanceId: string; skuCode: string; warehouseName: string; inventoryQty: number; currentQty: number; inventoryValue: number; currentValue: number }>;
}

/**
 * Conferência da data de HOJE com o saldo atual (`stock_balances`): mesma quantidade e mesmo valor (físico × custo
 * médio) em cada SKU × depósito do recorte. Diferença indica movimento com data futura ou saldo alterado fora de
 * `postMovements`.
 */
export async function compareWithCurrent(store: Store, companyId: string, f: Omit<FiscalInventoryFilters, "date">): Promise<InventoryConference> {
  const inv = await fiscalInventory(store, companyId, { ...f, date: today() });
  const filters: any[] = [["eq", "companyId", companyId]];
  if (f.branchIds) filters.push(["eq", "branchId", f.branchIds.length ? f.branchIds : ["__none__"]]);
  if (f.warehouseId) filters.push(["eq", "warehouseId", f.warehouseId]);
  const bals = await listAll(store, "stock_balances", { filters });
  const invById = new Map(inv.rows.map((r) => [r.balanceId, r]));
  const sku = new Map((await listAll(store, "skus", { filters: [["eq", "companyId", companyId]] })).map((s) => [s.id, s]));
  const wh = new Map((await listAll(store, "warehouses", { filters: [["eq", "companyId", companyId]] })).map((w) => [w.id, w]));
  const differences: InventoryConference["differences"] = [];
  let checked = 0;
  const seen = new Set<string>();
  for (const b of bals) {
    const r = invById.get(b.id);
    // fora do recorte de filtros da listagem (categoria, NCM, busca): só confere o que o inventário listou
    if (!r && (f.categoryId || f.ncm || f.q || f.warehouseKind)) continue;
    checked++;
    seen.add(b.id);
    const currentQty = (b.physical as number) ?? 0;
    const currentValue = currentQty < 0 ? 0 : roundDiv(currentQty * ((b.avgCost as number) ?? 0), QTY);
    const inventoryQty = r?.qty ?? 0;
    const inventoryValue = r?.value ?? 0;
    if (currentQty !== inventoryQty || (currentQty !== 0 && currentValue !== inventoryValue)) {
      differences.push({ balanceId: b.id, skuCode: sku.get(b.skuId)?.sku ?? b.skuId, warehouseName: wh.get(b.warehouseId)?.name ?? "—", inventoryQty, currentQty, inventoryValue, currentValue });
    }
  }
  for (const r of inv.rows) if (!seen.has(r.balanceId)) differences.push({ balanceId: r.balanceId, skuCode: r.skuCode, warehouseName: r.warehouseName, inventoryQty: r.qty, currentQty: 0, inventoryValue: r.value, currentValue: 0 });
  return { ok: differences.length === 0, checked, differences };
}
