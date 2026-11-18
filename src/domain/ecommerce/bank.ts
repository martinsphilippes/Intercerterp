import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { allocate } from "@/lib/money";
import { nowIso, today } from "@/lib/dates";
import { commerceEvent, requireStore } from "./common";
import { bankFor } from "./providers";

/**
 * Banco Intercert e repasses (Tela 57). Cada pagamento aprovado gera uma transação do gateway (bruto, taxa, líquido,
 * crédito previsto) ligada ao recebível do pedido no financeiro. A conciliação confirma o crédito: baixa as parcelas do
 * recebível na conta da loja com a taxa como despesa — pagamento aprovado, crédito no banco e conciliação são etapas
 * distintas. O repasse (transferência) fica em rascunho até a ligação com o Banco Intercert.
 */

export type GatewayTxStatus = "awaiting_credit" | "credited" | "partial" | "reconciled" | "refunded" | "divergent";

export const GATEWAY_TX_LABEL: Record<GatewayTxStatus, string> = {
  awaiting_credit: "Crédito previsto",
  credited: "Creditado — a conciliar",
  partial: "Conciliado em parte",
  reconciled: "Conciliado",
  refunded: "Estornado",
  divergent: "Divergente",
};

export async function gatewayTransactions(ctx: Ctx, filter: "all" | GatewayTxStatus = "all") {
  const st = await requireStore(ctx);
  const rows = await listAll(unscoped(ctx.store), "gateway_transactions", { filters: [["eq", "storeId", st.id]] }, 5000);
  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const orders = new Map((await listAll(unscoped(ctx.store), "online_orders", { filters: [["eq", "id", [...new Set(filtered.map((r) => r.orderId))].slice(0, 500)]] })).map((o) => [o.id, o]));
  return filtered
    .map((r) => ({ tx: r, order: orders.get(r.orderId) ?? null }))
    .sort((a, b) => String(b.tx.createdAt).localeCompare(String(a.tx.createdAt)));
}

export async function bankOverview(ctx: Ctx) {
  const st = await requireStore(ctx);
  const rows = await listAll(unscoped(ctx.store), "gateway_transactions", { filters: [["eq", "storeId", st.id]] }, 5000);
  const live = rows.filter((r) => r.status !== "refunded");
  const credited = live.filter((r) => ["credited", "partial", "reconciled"].includes(r.status));
  const reconciled = live.filter((r) => r.status === "reconciled");
  const provider = await bankFor(ctx.store, ctx.companyId);
  const payouts = await listAll(unscoped(ctx.store), "store_payouts", { filters: [["eq", "storeId", st.id]] });
  const inPayouts = payouts.filter((p) => p.status !== "cancelled").reduce((a, p) => a + (p.amount ?? 0), 0);
  return {
    expectedNet: live.filter((r) => r.status === "awaiting_credit").reduce((a, r) => a + (r.net ?? 0), 0),
    creditedNet: credited.reduce((a, r) => a + (r.net ?? 0), 0),
    reconciledNet: reconciled.reduce((a, r) => a + (r.net ?? 0), 0),
    reconciledCount: reconciled.length,
    fees: live.reduce((a, r) => a + (r.fee ?? 0), 0),
    gross: live.reduce((a, r) => a + (r.gross ?? 0), 0),
    available: Math.max(0, reconciled.reduce((a, r) => a + (r.net ?? 0), 0) - inPayouts),
    provider: { id: provider.id, label: provider.label, simulated: provider.simulated },
    accountId: st.payments?.bankAccountId ?? null,
    payouts: payouts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

/**
 * Simulação do extrato: transações com crédito previsto até hoje passam a "creditado" (o banco real informará o crédito
 * efetivo — data e valor — pela integração). Idempotente.
 */
export async function simulateCredits(ctx: Ctx) {
  const st = await requireStore(ctx);
  const provider = await bankFor(ctx.store, ctx.companyId);
  if (!provider.simulated) throw new BusinessError("A conta está ligada ao Banco Intercert: os créditos vêm do extrato do banco.", "bank_live");
  const rows = await listAll(unscoped(ctx.store), "gateway_transactions", { filters: [["eq", "storeId", st.id], ["eq", "status", "awaiting_credit"]] }, 5000);
  let n = 0;
  for (const r of rows) {
    if (!r.expectedAt || r.expectedAt > today()) continue;
    await unscoped(ctx.store).update("gateway_transactions", r.id, { status: "credited", creditedAt: r.expectedAt });
    await commerceEvent(ctx.store, { companyId: ctx.companyId, storeId: st.id, area: "bank", action: "bank.credit", status: "ok", reference: r.providerRef ?? r.id, orderId: r.orderId, externalKey: `credit:${r.id}`, diagnostic: "Crédito simulado no prazo do meio de pagamento (sem valor financeiro).", subject: `order:${r.orderId}` });
    n++;
  }
  return n;
}

/** Conciliação de uma transação: baixa as parcelas vencidas do recebível na conta escolhida, com a taxa do gateway. */
export async function reconcileTransaction(ctx: Ctx, txId: string, accountId: string) {
  requireAction(ctx, "ecommerce.finance");
  const st = await requireStore(ctx);
  const base = unscoped(ctx.store);
  const tx = await base.getOrThrow("gateway_transactions", txId);
  assert(tx.storeId === st.id, "Transação de outra loja.");
  assert(["credited", "partial"].includes(tx.status), tx.status === "awaiting_credit" ? "Aguarde o crédito do gateway (previsto para " + String(tx.expectedAt ?? "").split("-").reverse().join("/") + ")." : "Transação já conciliada ou estornada.");
  assert(tx.titleId, "Transação sem recebível vinculado.");
  const { assertUsableAccount, settleInstallment, refreshTitleStatus } = await import("../finance");
  await assertUsableAccount(ctx, accountId);
  const insts = (await listAll(ctx.store, "installments", { filters: [["eq", "titleId", tx.titleId]] })).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const all = insts.reduce((a, i) => a + (i.amount ?? 0), 0);
  const fees = allocate(tx.fee ?? 0, insts.map((i) => i.amount ?? 0));
  const due = insts.map((i, k) => ({ i, fee: fees[k] })).filter(({ i }) => (i.balance ?? 0) > 0 && i.status !== "cancelled" && i.dueDate <= today());
  assert(due.length || insts.every((i) => (i.balance ?? 0) === 0), "Nenhuma parcela creditada a conciliar ainda.");
  for (const { i, fee } of due) {
    await settleInstallment(ctx, { installmentId: i.id, date: i.dueDate, principal: i.balance, fee, accountId, methodKind: "gateway_settlement", reference: tx.providerRef ?? null, notes: `Conciliação do gateway — pedido ${tx.orderId}`, idemKey: `gwsettle:${i.id}`, skipApprovalCheck: true });
  }
  await refreshTitleStatus(ctx.store, tx.titleId);
  const fresh = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", tx.titleId]] });
  const open = fresh.filter((i) => (i.balance ?? 0) > 0 && i.status !== "cancelled");
  const status: GatewayTxStatus = open.length ? "partial" : "reconciled";
  await base.update("gateway_transactions", tx.id, { status, accountId, reconciledAt: status === "reconciled" ? nowIso() : null, installmentId: due[0]?.i.id ?? tx.installmentId ?? null });
  await commerceEvent(ctx.store, { companyId: ctx.companyId, storeId: st.id, area: "bank", action: "bank.reconcile", status: "ok", reference: tx.providerRef ?? tx.id, orderId: tx.orderId, diagnostic: `${due.length} parcela(s) baixada(s) na conta; ${status === "reconciled" ? "transação conciliada" : `${open.length} parcela(s) futura(s)`}.`, subject: `order:${tx.orderId}` });
  await audit(ctx, { module: "finance", action: "ecommerce.reconcile", entityType: "gateway_transaction", entityId: tx.id, summary: `Conciliação do gateway: ${due.length} parcela(s) do pedido baixada(s)${status === "partial" ? " (parcelas futuras pendentes)" : ""}`, related: [`store:${st.id}`, `title:${tx.titleId}`] });
  void all;
  return base.get("gateway_transactions", tx.id);
}

/** Conta financeira padrão da loja para os créditos do gateway (Banco Intercert). */
export async function setSettlementAccount(ctx: Ctx, accountId: string) {
  requireAction(ctx, "ecommerce.finance");
  const st = await requireStore(ctx);
  const { assertUsableAccount } = await import("../finance");
  await assertUsableAccount(ctx, accountId);
  await unscoped(ctx.store).update("stores", st.id, { payments: { ...(st.payments ?? {}), bankAccountId: accountId } });
  await audit(ctx, { module: "finance", action: "ecommerce.bank_account", entityType: "store", entityId: st.id, summary: "Conta dos créditos da loja virtual definida", related: [`store:${st.id}`] });
}

/** Prepara a solicitação de repasse (rascunho): nenhuma movimentação até a ligação com o Banco Intercert. */
export async function preparePayout(ctx: Ctx, input: { amount: number; notes?: string | null; idemKey: string }) {
  requireAction(ctx, "ecommerce.finance");
  const st = await requireStore(ctx);
  const ov = await bankOverview(ctx);
  assert(input.amount > 0, "Informe o valor do repasse.");
  assert(input.amount <= ov.available, "O repasse não pode passar do valor conciliado ainda não repassado.");
  const provider = await bankFor(ctx.store, ctx.companyId);
  const res = await provider.requestPayout({ amount: input.amount, reference: input.idemKey });
  const id = detId("payout", st.id, input.idemKey);
  const base = unscoped(ctx.store);
  const existing = await base.get("store_payouts", id);
  if (existing) return existing;
  const doc = await base.create("store_payouts", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, storeId: st.id, amount: Math.round(input.amount), status: res.status, destinationAccountId: st.payments?.bankAccountId ?? null, transactionIds: [], requestedBy: ctx.user.name, requestedAt: nowIso(), providerRef: res.providerRef, notes: [input.notes?.trim(), res.message].filter(Boolean).join(" — ").slice(0, 500) }, id);
  await audit(ctx, { module: "finance", action: "ecommerce.payout", entityType: "store_payout", entityId: doc.id, summary: `Repasse preparado em rascunho (${(input.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`, related: [`store:${st.id}`] });
  return doc;
}
