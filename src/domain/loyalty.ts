import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { addDays, today, toLocalDate } from "@/lib/dates";
import { formatMoney, roundDiv } from "@/lib/money";
import { BusinessError } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting, isFeatureOn } from "@/lib/core/settings";

/**
 * Programa de fidelidade (CAD-21) — pontos por empresa, sem "carteira" nova: cada venda identificada que acumula pontos
 * gera um registro em `credit_vouchers` com `kind = "loyalty"` (saldo em PONTOS, validade própria, `saleId`) e os
 * movimentos em `credit_voucher_moves` (earn / redeem / reverse / restore). Ver docs/regras-assumidas.md §32.
 *
 *  - Acúmulo: depois do commit da venda concluída com cliente (idempotente: registro com id determinístico pela venda),
 *    pontos = ⌊(total − valor pago com pontos) × pontos por R$ ÷ 100⌋.
 *  - Resgate: no PDV como forma de pagamento "Pontos de fidelidade" (meio sintético, sem cadastro em payment_methods):
 *    pontos usados = ⌈valor ÷ valor do ponto⌉, mínimo do parâmetro, consumindo os registros que vencem primeiro (FIFO).
 *  - Estorno: devolução estorna os pontos acumulados na proporção do valor devolvido (a última devolução fecha o
 *    restante); cancelamento estorna o restante e devolve os pontos usados no pagamento aos mesmos registros.
 *    O estorno nunca deixa saldo negativo: o que já foi gasto fica registrado como "não estornado" no movimento/auditoria.
 *  - Validade: registro vencido deixa de contar no saldo e não é aceito no resgate (sem rotina: leitura pela data).
 * Liga/desliga: `feature.fidelidade` (Parâmetros › Recursos), DESLIGADO por padrão (muda o cupom e o pagamento).
 */

export const LOYALTY_METHOD_ID = "loyalty";
export const LOYALTY_METHOD_NAME = "Pontos de fidelidade";
/** Meio de pagamento sintético do resgate (não existe em payment_methods). */
export const loyaltyMethod = (): Doc => ({ id: LOYALTY_METHOD_ID, kind: "loyalty", name: LOYALTY_METHOD_NAME, active: true, requiresCustomer: true, createdAt: "", updatedAt: "" }) as Doc;

export interface LoyaltyParams {
  /** pontos ganhos por R$ 1,00 */
  pointsPerReal: number;
  /** valor de 1 ponto no resgate (centavos) */
  pointValue: number;
  /** dias de validade dos pontos (0 = não vencem) */
  validityDays: number;
  /** mínimo de pontos por resgate */
  minRedeemPoints: number;
}

export const LOYALTY_DEFAULTS: LoyaltyParams = { pointsPerReal: 1, pointValue: 1, validityDays: 365, minRedeemPoints: 100 };

export function loyaltyEnabled(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, "fidelidade", false);
}

/** Parâmetros do programa (por empresa). */
export async function loyaltyParams(store: Store, companyId: string): Promise<LoyaltyParams> {
  const n = async (key: keyof LoyaltyParams, min: number) => {
    const v = Number(await getSetting(store, companyId, null, `loyalty.${key}`, LOYALTY_DEFAULTS[key]));
    return Number.isFinite(v) ? Math.max(min, Math.round(v)) : LOYALTY_DEFAULTS[key];
  };
  return { pointsPerReal: await n("pointsPerReal", 0), pointValue: await n("pointValue", 1), validityDays: await n("validityDays", 0), minRedeemPoints: await n("minRedeemPoints", 1) };
}

/** Pontos ganhos sobre um valor em centavos (arredonda para baixo). */
export function pointsFor(amount: number, p: Pick<LoyaltyParams, "pointsPerReal">): number {
  return amount > 0 ? Math.floor((amount * p.pointsPerReal) / 100) : 0;
}

/** Pontos necessários para pagar um valor (arredonda para cima: o ponto não é fracionado). */
export function pointsForAmount(amount: number, p: Pick<LoyaltyParams, "pointValue">): number {
  return amount > 0 ? Math.ceil(amount / Math.max(1, p.pointValue)) : 0;
}

export const isLoyalty = (v: Pick<Doc, "kind"> | null | undefined) => v?.kind === "loyalty";

/** Registros de pontos com saldo e dentro da validade, do que vence primeiro ao último. */
export async function loyaltyVouchers(store: Store, companyId: string, customerId: string, date = today()) {
  const rows = await listAll(store, "credit_vouchers", { filters: [["eq", "customerId", customerId], ["eq", "status", "active"]] });
  return rows
    .filter((v) => v.companyId === companyId && v.kind === "loyalty" && (v.balance ?? 0) > 0 && (!v.expiresAt || v.expiresAt >= date))
    .sort((a, b) => String(a.expiresAt ?? "9999").localeCompare(String(b.expiresAt ?? "9999")) || String(a.createdAt).localeCompare(String(b.createdAt)) || (a.id < b.id ? -1 : 1));
}

export interface LoyaltyBalance {
  points: number;
  value: number;
  nextExpiry: { date: string; points: number } | null;
}

export async function loyaltyBalance(store: Store, companyId: string, customerId: string, date = today()): Promise<LoyaltyBalance> {
  const [rows, p] = await Promise.all([loyaltyVouchers(store, companyId, customerId, date), loyaltyParams(store, companyId)]);
  const points = rows.reduce((a, v) => a + v.balance, 0);
  const first = rows.find((v) => v.expiresAt);
  const nextExpiry = first ? { date: first.expiresAt, points: rows.filter((v) => v.expiresAt === first.expiresAt).reduce((a, v) => a + v.balance, 0) } : null;
  return { points, value: points * p.pointValue, nextExpiry };
}

/** Plano FIFO de consumo de `points` pontos (null = saldo insuficiente). */
export function planRedemption(vouchers: Doc[], points: number): Array<{ voucher: Doc; take: number }> | null {
  const plan: Array<{ voucher: Doc; take: number }> = [];
  let rest = points;
  for (const v of vouchers) {
    if (rest <= 0) break;
    const take = Math.min(rest, v.balance);
    if (take > 0) plan.push({ voucher: v, take });
    rest -= take;
  }
  return rest > 0 ? null : plan;
}

/** Máximo de registros de pontos consumidos num único pagamento (limite de escrita da transação da venda). */
export const MAX_REDEEM_VOUCHERS = 15;

/**
 * Valida o resgate (pontos, mínimo, saldo) e devolve o plano FIFO. Usado na preparação e, de novo, dentro da tentativa
 * de gravação da venda (saldo relido: resgates concorrentes).
 */
export async function prepareRedemption(store: Store, companyId: string, customerId: string, amount: number, p: LoyaltyParams, alreadyPlanned = new Map<string, number>()) {
  const points = pointsForAmount(amount, p);
  if (points < p.minRedeemPoints) throw new BusinessError(`Resgate mínimo de ${p.minRedeemPoints} pontos (${formatMoney(p.minRedeemPoints * p.pointValue)}).`, "loyalty_min");
  const vouchers = (await loyaltyVouchers(store, companyId, customerId)).map((v) => ({ ...v, balance: v.balance - (alreadyPlanned.get(v.id) ?? 0) })).filter((v) => v.balance > 0);
  const plan = planRedemption(vouchers, points);
  if (!plan) throw new BusinessError(`Saldo de pontos insuficiente: ${vouchers.reduce((a, v) => a + v.balance, 0)} disponíveis, ${points} necessários.`, "loyalty_balance");
  if (plan.length > MAX_REDEEM_VOUCHERS) throw new BusinessError(`Os pontos estão espalhados em muitos registros: resgate até ${vouchers.slice(0, MAX_REDEEM_VOUCHERS).reduce((a, v) => a + v.balance, 0)} pontos por pagamento e use outro pagamento de pontos para o restante.`, "loyalty_split");
  return { points, plan };
}

const voucherCode = (prefix: string, number: number | string, id: string) => `${prefix}${String(number).padStart(6, "0")}${id.slice(0, 4).toUpperCase()}`;

/**
 * Acúmulo de pontos da venda concluída (gancho pós-commit, idempotente). Recurso desligado, venda sem cliente,
 * cancelada ou sem pontos: nada é gravado.
 */
export async function earnLoyaltyForSale(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (sale.status !== "completed" || !sale.customerId || sale.loyaltyPoints != null) return null;
  if (!(await loyaltyEnabled(ctx.store, sale.companyId, sale.branchId))) return null;
  const voucherId = detId("voucher", `loyalty:${sale.id}`);
  if (await ctx.store.get("credit_vouchers", voucherId)) return null;
  const p = await loyaltyParams(ctx.store, sale.companyId);
  const pays = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", sale.id]] });
  const viaPoints = pays.filter((x) => x.methodKind === "loyalty").reduce((a, x) => a + x.amount, 0);
  const points = pointsFor(sale.total - viaPoints, p);
  const date = toLocalDate(sale.completedAt);
  const base = { companyId: sale.companyId, branchId: sale.branchId, createdBy: ctx.user.id };
  try {
    await ctx.store.transaction(async (t) => {
      if (points > 0) {
        await t.create("credit_vouchers", { ...base, customerId: sale.customerId, code: voucherCode("FD", sale.number, voucherId), originalAmount: points, balance: points, status: "active", kind: "loyalty", saleId: sale.id, expiresAt: p.validityDays > 0 ? addDays(date, p.validityDays) : null, seq: 0 }, voucherId);
        await t.create("credit_voucher_moves", { ...base, voucherId, seq: 0, kind: "earn", amount: points, balanceAfter: points, saleId: sale.id, idemKey: `loyalty-earn:${sale.id}` }, detId("vmove", `loyalty-earn:${sale.id}`));
      }
      await t.update("sales", sale.id, { loyaltyPoints: points, loyaltyPointsReversed: 0 });
    });
  } catch (e) {
    if (isConflict(e)) return null; // outra execução já acumulou
    throw e;
  }
  if (points > 0) {
    await audit(ctx, { module: "sales", action: "loyalty.earn", entityType: "sale", entityId: sale.id, summary: `Fidelidade: ${points} ponto(s) acumulado(s) na venda nº ${sale.number}${p.validityDays > 0 ? ` (validade ${p.validityDays} dias)` : ""}`, related: [`customer:${sale.customerId}`, `credit_voucher:${voucherId}`] });
  }
  return points;
}

/** Debita pontos do cliente (primeiro do registro da venda, depois FIFO), sem deixar saldo negativo. */
async function debitPlan(store: Store, sale: Doc, points: number) {
  const own = await store.get("credit_vouchers", detId("voucher", `loyalty:${sale.id}`));
  const others = await loyaltyVouchers(store, sale.companyId, sale.customerId);
  const ordered = [...(own && own.status === "active" && own.balance > 0 ? [own] : []), ...others.filter((v) => v.id !== own?.id)];
  const plan: Array<{ voucher: Doc; take: number }> = [];
  let rest = points;
  for (const v of ordered.slice(0, 20)) {
    if (rest <= 0) break;
    const take = Math.min(rest, v.balance);
    if (take > 0) plan.push({ voucher: v, take });
    rest -= take;
  }
  return { plan, shortfall: Math.max(0, rest) };
}

/** Estorno idempotente (marcador em `operations`) de pontos acumulados e, no cancelamento, devolução dos pontos usados. */
async function applyReversal(ctx: Ctx, sale: Doc, markerKey: string, points: number, opts: { returnId?: string | null; restore?: Doc[]; reason: string }) {
  const markerId = detId("loyaltyrev", markerKey);
  if (await ctx.store.get("operations", markerId)) return null;
  const base = { companyId: sale.companyId, branchId: sale.branchId, createdBy: ctx.user.id };
  let result: { reversed: number; shortfall: number; restored: number } | null = null;
  await retryOnConflict(async () => {
    if (await ctx.store.get("operations", markerId)) return;
    const restore = opts.restore ?? [];
    // devolve os pontos usados no pagamento (cancelamento) antes de estornar os acumulados
    const restoredBy = new Map<string, number>();
    for (const m of restore) restoredBy.set(m.voucherId, (restoredBy.get(m.voucherId) ?? 0) - m.amount);
    const { plan, shortfall } = points > 0 ? await debitPlan(ctx.store, sale, points) : { plan: [], shortfall: 0 };
    await ctx.store.transaction(async (t) => {
      await t.create("operations", { companyId: sale.companyId, type: "loyalty_reverse", status: "done", entityType: "sale", entityId: sale.id, createdBy: ctx.user.id, result: { points, shortfall, returnId: opts.returnId ?? null } }, markerId);
      const running = new Map<string, number>();
      for (const m of restore) {
        const v = await ctx.store.getOrThrow("credit_vouchers", m.voucherId);
        const after = (running.get(v.id) ?? v.balance ?? 0) - m.amount;
        running.set(v.id, after);
        await t.increment("credit_vouchers", v.id, "balance", -m.amount);
        await t.update("credit_vouchers", v.id, { status: "active" });
        await t.create("credit_voucher_moves", { ...base, voucherId: v.id, seq: 0, kind: "restore", amount: -m.amount, balanceAfter: after, saleId: sale.id, idemKey: `loyalty-restore:${m.id}` }, detId("vmove", `loyalty-restore:${m.id}`));
      }
      for (const { voucher, take } of plan) {
        const extra = restoredBy.get(voucher.id) ?? 0;
        await t.increment("credit_vouchers", voucher.id, "balance", -take, { min: 0 });
        const after = voucher.balance + extra - take;
        await t.create("credit_voucher_moves", { ...base, voucherId: voucher.id, seq: 0, kind: "reverse", amount: -take, balanceAfter: after, saleId: sale.id, returnId: opts.returnId ?? null, idemKey: `${markerKey}:${voucher.id}` }, detId("vmove", `${markerKey}:${voucher.id}`));
        if (after === 0) await t.update("credit_vouchers", voucher.id, { status: "used" });
      }
      if (points > 0) await t.increment("sales", sale.id, "loyaltyPointsReversed", points);
    });
    result = { reversed: points - shortfall, shortfall, restored: restore.reduce((a, m) => a - m.amount, 0) };
  });
  if (result) {
    const r = result as { reversed: number; shortfall: number; restored: number };
    await audit(ctx, {
      module: "sales", action: "loyalty.reverse", entityType: "sale", entityId: sale.id,
      summary: `Fidelidade (${opts.reason}) — venda nº ${sale.number}: ${r.reversed} ponto(s) estornado(s)${r.shortfall ? `; ${r.shortfall} já usado(s) pelo cliente, não estornado(s)` : ""}${r.restored ? `; ${r.restored} ponto(s) do pagamento devolvido(s)` : ""}`,
      related: [`customer:${sale.customerId}`, opts.returnId ? `return:${opts.returnId}` : ""].filter(Boolean),
    });
  }
  return result;
}

/** Devolução: estorna os pontos da venda na proporção do valor devolvido (a devolução que completa o total fecha o restante). */
export async function reverseLoyaltyForReturn(ctx: Ctx, returnId: string) {
  const ret = await ctx.store.getOrThrow("returns", returnId);
  const sale = await ctx.store.getOrThrow("sales", ret.saleId);
  const earned = sale.loyaltyPoints ?? 0;
  if (earned <= 0 || !sale.customerId) return null;
  const remaining = earned - (sale.loyaltyPointsReversed ?? 0);
  if (remaining <= 0) return null;
  const all = (sale.returnedTotal ?? 0) >= sale.total;
  const points = Math.min(remaining, all ? remaining : roundDiv(earned * (ret.itemsTotal ?? 0), Math.max(1, sale.total)));
  if (points <= 0) return null;
  return applyReversal(ctx, sale, `return:${returnId}`, points, { returnId, reason: `devolução nº ${ret.number}` });
}

/** Cancelamento: estorna o que restou dos pontos acumulados e devolve os pontos usados no pagamento. */
export async function reverseLoyaltyForCancel(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (sale.status !== "cancelled") return null;
  const redeemed = (await listAll(ctx.store, "credit_voucher_moves", { filters: [["eq", "saleId", saleId]] })).filter((m) => m.kind === "redeem");
  const remaining = sale.customerId ? Math.max(0, (sale.loyaltyPoints ?? 0) - (sale.loyaltyPointsReversed ?? 0)) : 0;
  if (!redeemed.length && remaining <= 0) return null;
  return applyReversal(ctx, sale, `cancel:${saleId}`, remaining, { restore: redeemed, reason: "cancelamento" });
}

/** Extrato de pontos do cliente (movimentos mais recentes primeiro). */
export async function loyaltyStatement(store: Store, companyId: string, customerId: string, limit = 30) {
  const vouchers = (await listAll(store, "credit_vouchers", { filters: [["eq", "customerId", customerId]] })).filter((v) => v.companyId === companyId && v.kind === "loyalty");
  if (!vouchers.length) return { vouchers, moves: [] as Doc[] };
  const moves: Doc[] = [];
  const ids = vouchers.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 100) moves.push(...(await listAll(store, "credit_voucher_moves", { filters: [["eq", "voucherId", ids.slice(i, i + 100)]] })));
  moves.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { vouchers, moves: moves.slice(0, limit) };
}

export const LOYALTY_MOVE_LABEL: Record<string, string> = { earn: "Acúmulo", redeem: "Resgate", reverse: "Estorno", restore: "Devolução de resgate" };
