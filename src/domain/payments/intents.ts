import { detId, isConflict, listAll } from "@/lib/db";
import { nowIso } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, type Ctx } from "@/lib/core/ctx";
import { getIntegration, logIntegration } from "../integrations";
import { pixProviderFrom, simulatedPix, type ProviderCharge } from "./providers";

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
    if (["pending", "unknown"].includes(prev.status)) {
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
  if (["confirmed", "failed", "cancelled", "refunded"].includes(intent.status)) return intent;
  return refresh(ctx, intent);
}

/** Somente para o provedor de simulação: altera o estado de forma explícita e rotulada. */
export async function simulateIntent(ctx: Ctx, intentId: string, status: "confirmed" | "failed") {
  const intent = await ctx.store.getOrThrow("payment_intents", intentId);
  assert(intent.isSimulated, "Somente cobranças de simulação podem ser confirmadas manualmente.");
  simulatedPix().setStatus(intent.reference, status);
  return refresh(ctx, intent);
}

export async function cancelIntent(ctx: Ctx, intentId: string) {
  const intent = await ctx.store.getOrThrow("payment_intents", intentId);
  if (intent.saleId) throw new BusinessError("Cobrança já vinculada a uma venda.");
  return ctx.store.update("payment_intents", intentId, { status: intent.status === "confirmed" ? "confirmed" : "cancelled" });
}
