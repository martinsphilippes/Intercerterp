import { detId, isConflict, listAll } from "@/lib/db";
import { nowIso } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, type Ctx } from "@/lib/core/ctx";
import { getIntegration, logIntegration } from "../integrations";
import { pixProviderFrom, REFUND_DONE_STATUSES, simulatedPix, type ProviderCharge } from "./providers";

/**
 * Intenções de pagamento Pix. Regras:
 *  - Intenção ≠ confirmação: a venda só usa o Pix depois do retorno "confirmado" do provedor.
 *  - Antes de criar nova cobrança para o mesmo atendimento, consulta-se a referência anterior
 *    (timeout/falha de rede não gera cobrança duplicada).
 */

async function providerFor(ctx: Ctx) {
  const integ = await getIntegration(ctx.store, ctx.companyId, ctx.branchId, "pix");
  const provider = pixProviderFrom(integ);
  return { integ, provider };
}

/**
 * Cobrança "cancelada" apenas localmente (sem confirmação do provedor) e ainda dentro da validade:
 * pode continuar pagável no provedor e deve ser reconsultada.
 */
export function maybePayable(intent: { status?: string; cancelConfirmedAt?: string | null; expiresAt?: string | null }) {
  return intent.status === "cancelled" && !intent.cancelConfirmedAt && (!intent.expiresAt || intent.expiresAt > nowIso());
}

async function refresh(ctx: Ctx, intent: any) {
  const { integ, provider } = await providerFor(ctx);
  const p = intent.isSimulated ? simulatedPix() : provider;
  if (!p) return intent;
  let charge: ProviderCharge | null = null;
  try {
    charge = await p.findByReference(intent.reference);
  } catch (e: any) {
    await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: ctx.branchId, integrationId: integ?.id, kind: "pix", action: "query", status: "failure", message: e.message });
    return ctx.store.update("payment_intents", intent.id, { lastCheckedAt: nowIso(), errorMessage: e.message.slice(0, 500) });
  }
  if (!charge) return ctx.store.update("payment_intents", intent.id, { lastCheckedAt: nowIso() });
  let status = charge.status;
  if (status === "pending" && intent.expiresAt && intent.expiresAt < nowIso()) status = "expired";
  return ctx.store.update("payment_intents", intent.id, {
    status,
    providerId: charge.providerId,
    lastCheckedAt: nowIso(),
    raw: charge.raw ?? null,
    errorMessage: null,
    ...(status === "cancelled" && !intent.cancelConfirmedAt ? { cancelConfirmedAt: nowIso() } : {}),
  });
}

export async function createPixIntent(ctx: Ctx, input: { cartId: string; amount: number; description: string; payerEmail?: string }) {
  const branchId = requireBranch(ctx);
  assert(input.amount > 0, "Valor do Pix deve ser positivo.");
  const { integ, provider } = await providerFor(ctx);
  if (!provider) throw new BusinessError("Pix não configurado ou sem credencial para esta filial. Configure em Administração → Integrações ou registre o Pix manualmente com comprovante.", "pix_not_configured");

  // 1) Consulta cobranças anteriores do mesmo atendimento antes de criar outra.
  const previous = await listAll(ctx.store, "payment_intents", { filters: [["eq", "cartId", input.cartId], ["eq", "kind", "pix"]] });
  for (const prev of previous) {
    // "cancelada" só localmente e ainda válida também é reconsultada: pode ter sido paga depois do cancelamento
    if (["pending", "unknown"].includes(prev.status) || maybePayable(prev)) {
      const updated = await refresh(ctx, prev);
      if (updated.status === "confirmed" && updated.amount === input.amount && !updated.saleId) return updated;
      if (updated.status === "pending" && updated.amount === input.amount) return updated;
    } else if (prev.status === "confirmed" && prev.amount === input.amount && !prev.saleId) {
      return prev;
    }
  }

  const reference = `pix-${input.cartId.slice(0, 12)}-${previous.length + 1}`;
  const id = detId("intent", reference);
  let intent;
  try {
    intent = await ctx.store.create(
      "payment_intents",
      { companyId: ctx.companyId, branchId, createdBy: ctx.user.id, provider: provider.id, kind: "pix", amount: input.amount, status: "unknown", reference, cartId: input.cartId, attempts: 1, isSimulated: provider.simulated },
      id,
    );
  } catch (e) {
    if (!isConflict(e)) throw e;
    intent = await ctx.store.getOrThrow("payment_intents", id);
  }
  const t0 = Date.now();
  try {
    const charge = await provider.createPix({ reference, amount: input.amount, description: input.description, payerEmail: input.payerEmail });
    await logIntegration(ctx.store, { companyId: ctx.companyId, branchId, integrationId: integ?.id, kind: "pix", action: "create_charge", status: "success", message: `Cobrança ${reference} criada (${charge.status})`, durationMs: Date.now() - t0 });
    return ctx.store.update("payment_intents", intent.id, {
      status: charge.status,
      providerId: charge.providerId,
      qrCode: charge.qrCode ?? null,
      qrCodeImage: charge.qrCodeImage ?? null,
      expiresAt: charge.expiresAt ?? null,
      raw: charge.raw ?? null,
      lastCheckedAt: nowIso(),
    });
  } catch (e: any) {
    // Estado "unknown": a próxima tentativa consulta a referência antes de recriar.
    await logIntegration(ctx.store, { companyId: ctx.companyId, branchId, integrationId: integ?.id, kind: "pix", action: "create_charge", status: "failure", message: e.message, durationMs: Date.now() - t0 });
    await ctx.store.update("payment_intents", intent.id, { status: "unknown", errorMessage: String(e.message).slice(0, 500) });
    throw new BusinessError(`Falha ao gerar cobrança Pix: ${e.message}. A referência ${reference} será consultada antes de nova tentativa.`, "pix_failure");
  }
}

export async function checkIntent(ctx: Ctx, intentId: string) {
  const intent = await ctx.store.getOrThrow("payment_intents", intentId);
  assert(intent.companyId === ctx.companyId, "Cobrança de outra empresa.");
  if (["confirmed", "failed", "refunded"].includes(intent.status)) return intent;
  if (intent.status === "cancelled" && !maybePayable(intent)) return intent;
  return refresh(ctx, intent);
}

/** Somente para o provedor de simulação: altera o estado de forma explícita e rotulada. */
export async function simulateIntent(ctx: Ctx, intentId: string, status: "confirmed" | "failed") {
  const intent = await ctx.store.getOrThrow("payment_intents", intentId);
  assert(intent.companyId === ctx.companyId, "Cobrança de outra empresa.");
  assert(intent.isSimulated, "Somente cobranças de simulação podem ser confirmadas manualmente.");
  assert(!intent.saleId, "Cobrança já vinculada a uma venda.");
  assert(["pending", "unknown"].includes(intent.status), `Cobrança ${intent.status === "confirmed" ? "já confirmada" : "encerrada"} — não pode ser alterada.`);
  const sim = simulatedPix();
  // o estado do provedor de simulação é volátil (memória do servidor): reconstitui a cobrança se necessário
  if (!(await sim.findByReference(intent.reference))) await sim.createPix({ reference: intent.reference, amount: intent.amount, description: "Cobrança de simulação reconstituída" });
  sim.setStatus(intent.reference, status);
  const updated = await refresh(ctx, intent);
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: ctx.branchId, kind: "pix", action: "simulate", status: "info", message: `SIMULAÇÃO: cobrança ${intent.reference} marcada como ${status === "confirmed" ? "confirmada" : "falha"} por ${ctx.user.name}` });
  return updated;
}

/** Cobranças Pix do atendimento (mais recente primeiro). */
export async function cartIntents(ctx: Ctx, cartId: string) {
  const rows = await listAll(ctx.store, "payment_intents", { filters: [["eq", "cartId", cartId], ["eq", "companyId", ctx.companyId]] });
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function cancelIntent(ctx: Ctx, intentId: string) {
  const intent = await ctx.store.getOrThrow("payment_intents", intentId);
  assert(intent.companyId === ctx.companyId, "Cobrança de outra empresa.");
  if (intent.saleId) throw new BusinessError("Cobrança já vinculada a uma venda.");
  return cancelIntentAtProvider(ctx, intent);
}

/**
 * Cancela a cobrança NO PROVEDOR antes de marcá-la como cancelada: consulta a situação atual (se já foi paga,
 * devolve "confirmed" sem cancelar) e só grava "cancelled" quando o provedor confirma. Sem confirmação
 * (falha de rede, provedor sem credencial), a cobrança mantém a situação real e o pedido fica registrado.
 */
export async function cancelIntentAtProvider(ctx: Ctx, intent: any) {
  if (intent.status === "cancelled" && intent.cancelConfirmedAt) return intent;
  if (["confirmed", "failed", "expired", "refunded"].includes(intent.status)) return intent;
  const { integ, provider } = await providerFor(ctx);
  const p = intent.isSimulated ? simulatedPix() : provider;
  const log = (status: "success" | "failure" | "info", message: string) =>
    logIntegration(ctx.store, { companyId: ctx.companyId, branchId: ctx.branchId, integrationId: integ?.id, kind: "pix", action: "cancel_charge", status, message });
  const pendingCancel = (message: string) => ctx.store.update("payment_intents", intent.id, { cancelRequestedAt: nowIso(), lastCheckedAt: nowIso(), errorMessage: message.slice(0, 500) });
  if (!p) {
    await pendingCancel("Cancelamento não enviado: Pix sem provedor/credencial configurado.");
    throw new BusinessError(`Não foi possível cancelar a cobrança Pix ${intent.reference} no provedor (Pix sem provedor/credencial configurado nesta filial). Ela pode continuar pagável até expirar: confira o recebimento antes de liberar o cliente.`, "pix_cancel_failed");
  }
  let charge: ProviderCharge | null;
  try {
    charge = await p.findByReference(intent.reference);
  } catch (e: any) {
    await log("failure", `Consulta antes do cancelamento de ${intent.reference}: ${e.message}`);
    await pendingCancel(e.message);
    throw new BusinessError(`Não foi possível consultar a cobrança Pix ${intent.reference} no provedor (${e.message}). Ela não foi cancelada e pode continuar pagável: tente novamente.`, "pix_cancel_failed");
  }
  if (!charge) {
    // nunca registrada no provedor: nada a cancelar lá; continua sendo reconsultada até a validade
    await log("info", `Cobrança ${intent.reference} não localizada no provedor; marcada como cancelada localmente.`);
    return ctx.store.update("payment_intents", intent.id, { status: "cancelled", cancelRequestedAt: nowIso(), lastCheckedAt: nowIso(), errorMessage: "Cobrança não localizada no provedor ao cancelar (será reconsultada até a validade)." });
  }
  if (charge.status === "confirmed") {
    return ctx.store.update("payment_intents", intent.id, { status: "confirmed", providerId: charge.providerId, raw: charge.raw ?? null, lastCheckedAt: nowIso(), errorMessage: null });
  }
  if (charge.status !== "pending" && charge.status !== "unknown") {
    return ctx.store.update("payment_intents", intent.id, { status: charge.status, providerId: charge.providerId, lastCheckedAt: nowIso(), errorMessage: null, ...(charge.status === "cancelled" ? { cancelConfirmedAt: nowIso() } : {}) });
  }
  try {
    const after = await p.cancel(charge.providerId);
    if (after.status === "cancelled") {
      await log("success", `Cobrança ${intent.reference} cancelada no provedor.`);
      return ctx.store.update("payment_intents", intent.id, { status: "cancelled", providerId: after.providerId, cancelRequestedAt: nowIso(), cancelConfirmedAt: nowIso(), lastCheckedAt: nowIso(), errorMessage: null });
    }
    if (after.status === "confirmed") {
      await log("info", `Cobrança ${intent.reference} já estava paga ao pedir o cancelamento.`);
      return ctx.store.update("payment_intents", intent.id, { status: "confirmed", providerId: after.providerId, lastCheckedAt: nowIso(), errorMessage: null });
    }
    await log("failure", `Cancelamento de ${intent.reference} não confirmado (situação ${after.status}).`);
    await pendingCancel(`Cancelamento não confirmado pelo provedor (situação ${after.status}).`);
    throw new BusinessError(`O provedor não confirmou o cancelamento da cobrança Pix ${intent.reference} (situação: ${after.status}). Ela pode continuar pagável: consulte novamente antes de liberar o cliente.`, "pix_cancel_pending");
  } catch (e: any) {
    if (e instanceof BusinessError) throw e;
    await log("failure", `Cancelamento de ${intent.reference}: ${e.message}`);
    await pendingCancel(e.message);
    throw new BusinessError(`Não foi possível cancelar a cobrança Pix ${intent.reference} no provedor (${e.message}). Ela pode continuar pagável até expirar: tente novamente.`, "pix_cancel_failed");
  }
}

/**
 * Estorno de Pix integrado no provedor (cancelamento de venda). Devolve `done` somente quando o provedor
 * confirma a devolução; caso contrário o estorno fica pendente no provedor (o chamador mantém o estado honesto).
 */
export async function refundIntentAtProvider(ctx: Ctx, intent: any, amount: number): Promise<{ done: boolean; status: string | null; message: string | null }> {
  const { integ, provider } = await providerFor(ctx);
  const p = intent.isSimulated ? simulatedPix() : provider;
  const log = (status: "success" | "failure", message: string) =>
    logIntegration(ctx.store, { companyId: ctx.companyId, branchId: ctx.branchId, integrationId: integ?.id, kind: "pix", action: "refund", status, message });
  if (!p) return { done: false, status: null, message: "Pix sem provedor/credencial configurado: estorno pendente no provedor." };
  if (!intent.providerId) return { done: false, status: null, message: "Cobrança sem identificador do provedor: estorno pendente no provedor." };
  try {
    const r = await p.refund(intent.providerId, amount);
    if (REFUND_DONE_STATUSES.includes(r.status)) {
      await log("success", `Estorno de ${intent.reference} confirmado pelo provedor (${r.status}).`);
      return { done: true, status: r.status, message: null };
    }
    await log("failure", `Estorno de ${intent.reference} não confirmado (situação ${r.status}).`);
    return { done: false, status: r.status, message: `Provedor respondeu "${r.status}" ao estorno.` };
  } catch (e: any) {
    await log("failure", `Estorno de ${intent.reference}: ${e.message}`);
    return { done: false, status: null, message: String(e.message ?? e).slice(0, 400) };
  }
}
