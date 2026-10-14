import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { formatDate, today } from "@/lib/dates";
import { QTY } from "@/lib/money";
import { balanceId } from "./stock";
import { daysToExpiry, expiryStatus, lotsFromMovements, normLot, sortFefo, unlottedQty, type LotEntry, type LotPart } from "./lot-calc";

/**
 * Lotes e validades (EST-02) — consultas, conferência da escolha de lote na venda, alertas e rastro fiscal.
 * O saldo por lote é mantido por `postMovements` (src/domain/stock.ts) para produtos com `lotControl`.
 * Liga/desliga: `feature.lotes` (padrão DESLIGADO). Desligado: o PDV não oferece a escolha, a conferência não exige lote,
 * não há alertas nem relatório — e nenhum produto pode ser marcado com controle de lote.
 */

export const LOT_EXPIRY_DAYS_KEY = "stock.lotExpiryAlertDays";
export const LOT_EXPIRY_DAYS_DEFAULT = 30;

export function lotsEnabled(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, "lotes", false);
}

export async function lotAlertDays(store: Store, companyId: string, branchId: string | null | undefined) {
  const n = Number(await getSetting(store, companyId, branchId, LOT_EXPIRY_DAYS_KEY, LOT_EXPIRY_DAYS_DEFAULT));
  return Number.isFinite(n) && n >= 0 ? Math.min(365, Math.round(n)) : LOT_EXPIRY_DAYS_DEFAULT;
}

/**
 * Liga/desliga o controle de lote do produto. Ligar exige o recurso `feature.lotes`; o saldo existente fica "sem lote"
 * (classifique-o por inventário com contagem por lote). Desligar só com todos os lotes zerados (venda, perda, devolução
 * ou inventário) — o saldo por lote nunca é apagado fora de um movimento.
 */
export async function setLotControl(ctx: Ctx, productId: string, on: boolean) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("products", productId);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  assert(p.type !== "service", "Serviços não têm estoque nem lote.");
  if (Boolean(p.lotControl) === on) return p;
  if (on && !(await lotsEnabled(ctx.store, ctx.companyId, ctx.branchId))) throw new BusinessError("O controle de lotes e validades está desligado em Administração › Parâmetros › Recursos.", "feature_off");
  if (!on) {
    const bals = await listAll(ctx.store, "stock_balances", { filters: [["eq", "productId", productId]] });
    const withLots = bals.filter((b) => ((b.lots ?? []) as LotEntry[]).some((l) => l.qty !== 0));
    assert(!withLots.length, `Ainda há saldo em lotes (${withLots.length} depósito(s)). Zere os lotes por venda, perda ou inventário antes de desligar o controle.`, "lots_with_balance");
  }
  const u = await ctx.store.update("products", productId, { lotControl: on });
  await audit(ctx, { module: "products", action: on ? "product.lot_control_on" : "product.lot_control_off", entityType: "product", entityId: productId, summary: `${on ? "Controle de lote e validade ligado" : "Controle de lote e validade desligado"} — ${p.name}`, related: [`product:${productId}`] });
  return u;
}

/** Lotes de um SKU num depósito (FEFO) com o saldo sem lote. */
export async function balanceLots(store: Store, warehouseId: string, skuId: string) {
  const bal = await store.get("stock_balances", balanceId(warehouseId, skuId));
  const lots = sortFefo(((bal?.lots ?? []) as LotEntry[]).filter((l) => l.qty !== 0));
  return { physical: bal?.physical ?? 0, reserved: bal?.reserved ?? 0, lots, unlotted: unlottedQty(bal?.physical ?? 0, lots) };
}

/** Saldo por lote reconstruído a partir dos movimentos do saldo (conferência: deve ser igual a `stock_balances.lots`). */
export async function lotsFromLedger(store: Store, warehouseId: string, skuId: string) {
  const movs = await listAll(store, "stock_movements", { filters: [["eq", "balanceId", balanceId(warehouseId, skuId)]], orderBy: [{ field: "seq" }] });
  return lotsFromMovements(movs as Array<{ lots?: LotPart[] | null }>);
}

/**
 * Lote escolhido no PDV: só para produto com controle de lote e recurso ligado; o lote precisa existir no depósito da venda,
 * estar dentro da validade e ter saldo para a quantidade (somadas as linhas do mesmo lote), salvo venda sem saldo permitida.
 * Devolve o lote normalizado por linha (null = FEFO automático).
 */
export async function checkSaleLots(
  ctx: Ctx,
  input: { branchId: string; warehouseId: string; allowNegative: boolean; lines: Array<{ skuId: string; skuCode: string; product: Doc; qty: number; lot?: string | null }> },
): Promise<Array<string | null>> {
  const out = input.lines.map(() => null as string | null);
  if (!input.lines.some((l) => normLot(l.lot))) return out;
  if (!(await lotsEnabled(ctx.store, ctx.companyId, input.branchId))) return out;
  const need = new Map<string, number>();
  input.lines.forEach((l, idx) => {
    const lot = normLot(l.lot);
    if (!lot || !l.product.lotControl || l.product.type === "service") return;
    out[idx] = lot;
    const k = `${l.skuId}|${lot}`;
    need.set(k, (need.get(k) ?? 0) + l.qty);
  });
  const ref = today();
  for (const [k, q] of need) {
    const [skuId, lot] = k.split("|");
    const line = input.lines.find((l) => l.skuId === skuId)!;
    const { lots } = await balanceLots(ctx.store, input.warehouseId, skuId);
    const entry = lots.find((l) => l.lot === lot);
    if (!entry) throw new BusinessError(`${line.skuCode}: lote ${lot} sem saldo no depósito da venda. Escolha outro lote ou deixe a seleção automática (FEFO).`, "lot_not_found");
    if (entry.expiry && entry.expiry < ref) throw new BusinessError(`${line.skuCode}: lote ${lot} vencido em ${formatDate(entry.expiry)} — não pode ser vendido.`, "lot_expired");
    if (entry.qty < q && !input.allowNegative) throw new BusinessError(`${line.skuCode}: lote ${lot} com saldo ${entry.qty / QTY}, vendido ${q / QTY}. Divida a quantidade entre lotes ou use a seleção automática.`, "lot_insufficient");
  }
  return out;
}

/** Conferência do recebimento: produto com controle de lote exige o lote (digitado ou do XML) — recurso ligado. */
export async function receiptLotBlockers(ctx: Ctx, r: Doc): Promise<string[]> {
  const items = ((r.items ?? []) as any[]).filter((i) => !i.ignore && i.skuId && i.receivedQty > 0);
  if (!items.length || !(await lotsEnabled(ctx.store, ctx.companyId, r.branchId))) return [];
  const out: string[] = [];
  for (const it of items) {
    if (normLot(it.lot) || (it.rastro ?? []).length) continue;
    const sku = await ctx.store.get("skus", it.skuId);
    const product = sku ? await ctx.store.get("products", sku.productId) : null;
    if (product?.lotControl) out.push(`Informe o lote (e a validade) de "${it.description ?? sku?.sku}" — produto com controle de lote e validade.`);
  }
  return out;
}

/**
 * Lotes do XML quando a nota traz mais de um lote para o item (grupo rastro repetido): a quantidade de cada lote é
 * convertida pelo fator do item; só vale quando o recebido é o faturado (senão entra tudo no lote da conferência).
 */
export function receiptLotSplit(it: { rastro?: Array<{ nLote: string; qLote: number; dFab: string | null; dVal: string | null }> | null; receivedQty: number; invoicedQty?: number; conversionFactor?: number }): LotPart[] | null {
  const rastro = it.rastro ?? [];
  if (rastro.length < 2 || it.receivedQty !== it.invoicedQty) return null;
  const factor = it.conversionFactor ?? QTY;
  const parts: LotPart[] = rastro.map((r) => ({ lot: normLot(r.nLote), expiry: r.dVal, mfg: r.dFab, qty: Math.round((r.qLote * factor) / QTY) }));
  const sum = parts.reduce((a, p) => a + p.qty, 0);
  if (parts.some((p) => !p.lot || p.qty <= 0) || Math.abs(sum - it.receivedQty) > parts.length) return null;
  parts[parts.length - 1].qty += it.receivedQty - sum;
  return parts;
}

/** Rastro (NF-e/NFC-e) a partir das partes de lote gravadas no movimento de saída do item. */
export function rastroOf(movement: Doc | null | undefined): Array<{ nLote: string; qLote: number; dFab: string | null; dVal: string | null }> {
  const parts = ((movement?.lots ?? []) as LotPart[]).filter((p) => p.lot && p.qty < 0);
  return parts.map((p) => ({ nLote: p.lot!, qLote: -p.qty, dFab: p.mfg ?? null, dVal: p.expiry ?? null }));
}

export interface LotRow {
  balanceId: string;
  branchId: string;
  warehouseId: string;
  warehouseName: string;
  skuId: string;
  sku: string;
  productId: string;
  name: string;
  unitCode: string | null;
  lot: string;
  expiry: string | null;
  mfg: string | null;
  qty: number;
  status: "expired" | "expiring" | "ok" | "none";
  days: number | null;
}

/** Lotes com saldo (relatório de validades e alertas) — produtos com controle de lote. */
export async function listLots(store: Store, companyId: string, opts: { branchId?: string | null; alertDays: number; ref?: string; status?: "expired" | "expiring" | "ok" | "attention" | null; q?: string | null }): Promise<LotRow[]> {
  const ref = opts.ref ?? today();
  const products = await listAll(store, "products", { filters: [["eq", "companyId", companyId], ["eq", "lotControl", true]] });
  if (!products.length) return [];
  const pmap = new Map(products.map((p) => [p.id, p]));
  const rows: LotRow[] = [];
  const whs = new Map((await listAll(store, "warehouses", { filters: [["eq", "companyId", companyId]] })).map((w) => [w.id, w]));
  const skuCache = new Map<string, Doc | null>();
  const ids = [...pmap.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const filters: any[] = [["eq", "productId", ids.slice(i, i + 100)]];
    if (opts.branchId) filters.push(["eq", "branchId", opts.branchId]);
    const bals = await listAll(store, "stock_balances", { filters });
    for (const b of bals) {
      for (const l of (b.lots ?? []) as LotEntry[]) {
        if (!(l.qty > 0)) continue;
        if (!skuCache.has(b.skuId)) skuCache.set(b.skuId, await store.get("skus", b.skuId));
        const sku = skuCache.get(b.skuId);
        const p = pmap.get(b.productId)!;
        const status = expiryStatus(l.expiry, ref, opts.alertDays);
        rows.push({
          balanceId: b.id, branchId: b.branchId, warehouseId: b.warehouseId, warehouseName: whs.get(b.warehouseId)?.name ?? "—", skuId: b.skuId, sku: sku?.sku ?? "", productId: p.id,
          name: sku?.name ?? p.name, unitCode: sku?.unitCode ?? p.unitCode ?? null, lot: l.lot, expiry: l.expiry ?? null, mfg: l.mfg ?? null, qty: l.qty, status, days: l.expiry ? daysToExpiry(l.expiry, ref) : null,
        });
      }
    }
  }
  const q = (opts.q ?? "").trim().toLowerCase();
  return rows
    .filter((r) => !opts.status || (opts.status === "attention" ? r.status === "expired" || r.status === "expiring" : r.status === opts.status))
    .filter((r) => !q || `${r.sku} ${r.name} ${r.lot}`.toLowerCase().includes(q))
    .sort((a, b) => (a.expiry ?? "9999-99-99").localeCompare(b.expiry ?? "9999-99-99") || a.name.localeCompare(b.name));
}

const lotOccurrence = (r: { balanceId: string; lot: string }, kind: "expired" | "expiring") => `lot_expiry:${r.balanceId}:${r.lot}:${kind}`;

/**
 * Rotina diária `stock.lot_expiry`: lotes vencidos e a vencer em N dias (parâmetro `stock.lotExpiryAlertDays`) com saldo
 * geram uma ocorrência por lote e situação (deduplicada); lotes que zeraram, foram ajustados ou mudaram de situação têm a
 * ocorrência anterior resolvida. Recurso desligado: nada é avisado e as ocorrências abertas são resolvidas.
 */
export async function notifyLotExpiry(store: Store, companyId: string, ref = today()) {
  const on = await lotsEnabled(store, companyId, null);
  const days = await lotAlertDays(store, companyId, null);
  const rows = on ? await listLots(store, companyId, { alertDays: days, ref, status: "attention" }) : [];
  const live = new Set<string>();
  let notified = 0;
  for (const r of rows) {
    const kind = r.status === "expired" ? "expired" : "expiring";
    const key = lotOccurrence(r, kind);
    live.add(key);
    notified += await notify(store, {
      companyId, branchId: r.branchId, type: "deadline", priority: kind === "expired" ? "high" : "normal",
      title: kind === "expired" ? `Lote vencido: ${r.name} — lote ${r.lot}` : `Lote a vencer em ${r.days} dia(s): ${r.name} — lote ${r.lot}`,
      body: `${r.sku} · ${r.warehouseName}: ${r.qty / QTY} ${r.unitCode ?? "un"} com validade ${formatDate(r.expiry)}.${kind === "expired" ? " Retire da venda e registre a perda ou a devolução ao fornecedor." : " Priorize a venda (FEFO) ou negocie a troca com o fornecedor."}`,
      link: `/estoque/validades?situacao=${kind === "expired" ? "expired" : "expiring"}`, originType: "stock_balance", originId: r.balanceId, occurrenceKey: key, audience: { module: "stock" },
    });
  }
  const open = await listAll(store, "notifications", { filters: [["eq", "companyId", companyId], ["eq", "type", "deadline"], ["eq", "occurrenceStatus", "open"]] });
  let resolved = 0;
  for (const k of new Set(open.map((n) => n.occurrenceKey).filter((x): x is string => Boolean(x) && x.startsWith("lot_expiry:")))) {
    if (!live.has(k)) resolved += await resolveOccurrence(store, k);
  }
  return { lots: rows.length, notified, resolved };
}

/** Ocorrência de alerta de um lote (para testes e links). */
export const lotExpiryOccurrence = lotOccurrence;

/** id determinístico do movimento de venda de um item (usado pelo rastro fiscal). */
export const saleMovementId = (saleId: string, seq: number) => detId("mov", `sale:${saleId}:${seq}`);
