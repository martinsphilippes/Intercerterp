"use server";

import { runAction } from "@/lib/server/action";
import { BusinessError } from "@/lib/core/errors";
import { cancelCart, cartToSaleInput, createCart, ensureOpenCart, parkCart, resumeCart, saveCart, type CartPatch } from "@/domain/carts";
import { finalizeSale, type SalePaymentInput } from "@/domain/sales";
import { cancelIntent, createPixIntent, simulateIntent } from "@/domain/payments/intents";
import { formatMoney } from "@/lib/money";

function plainCart(c: Record<string, any>) {
  return {
    id: c.id as string,
    status: c.status as string,
    terminalId: c.terminalId as string,
    customerId: (c.customerId ?? null) as string | null,
    customerName: (c.customerName ?? null) as string | null,
    cpfOnInvoice: (c.cpfOnInvoice ?? null) as string | null,
    priceTableId: (c.priceTableId ?? null) as string | null,
    items: (c.items ?? []) as any[],
    globalDiscount: (c.globalDiscount ?? 0) as number,
    globalDiscountBps: (c.globalDiscountBps ?? 0) as number,
    surcharge: (c.surcharge ?? 0) as number,
    notes: (c.notes ?? null) as string | null,
    payments: (c.payments ?? []) as any[],
    exchangeReturnId: (c.exchangeReturnId ?? null) as string | null,
    revision: (c.revision ?? 0) as number,
    total: (c.total ?? 0) as number,
    updatedAt: c.updatedAt as string,
  };
}
export type PlainCart = ReturnType<typeof plainCart>;

/** Autosalvamento do atendimento (preserva o atendimento em atualização acidental da página). */
export async function saveCartAction(cartId: string, patch: CartPatch) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => plainCart(await saveCart(s.ctx, cartId, patch)));
}

export async function parkCartAction(cartId: string, name: string | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const { parked, fresh } = await parkCart(s.ctx, cartId, name);
    return { ok: true as const, message: `Pré-venda "${parked.name}" salva (${formatMoney((parked as any).total)}).`, data: plainCart(fresh) };
  });
}

export async function resumeCartAction(cartId: string, terminalId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const c = await resumeCart(s.ctx, cartId, terminalId);
    return { ok: true as const, message: `Pré-venda "${c.name ?? ""}" retomada.`, data: plainCart(c) };
  });
}

export async function cancelCartAction(cartId: string, reason: string | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const c = await cancelCart(s.ctx, cartId, reason);
    const current = await ensureOpenCart(s.ctx, c.terminalId);
    return { ok: true as const, message: "Atendimento cancelado.", data: plainCart(current!) };
  });
}

/** Inicia atendimento de troca: o atual (com itens) vai para espera e um novo recebe a devolução de origem. */
export async function startExchangeAction(terminalId: string, returnId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const ret = await s.ctx.store.getOrThrow("returns", returnId);
    if (ret.companyId !== s.ctx.companyId || ret.kind !== "exchange") throw new BusinessError("Devolução de troca inválida.");
    if (ret.exchangeSaleId) throw new BusinessError("Esta troca já foi concluída.");
    const current = await ensureOpenCart(s.ctx, terminalId, { create: false });
    if (current && (current.items ?? []).length && current.exchangeReturnId !== returnId) await parkCart(s.ctx, current.id, current.name ?? null);
    else if (current && current.exchangeReturnId !== returnId) await cancelCart(s.ctx, current.id, "Atendimento vazio substituído por troca");
    if (current && current.exchangeReturnId === returnId) return { ok: true as const, data: plainCart(current) };
    const fresh = await createCart(s.ctx, terminalId, { exchangeReturnId: returnId, customerId: ret.customerId ?? null });
    const saved = ret.customerId ? await saveCart(s.ctx, fresh.id, { customerId: ret.customerId }) : fresh;
    return { ok: true as const, message: `Troca da devolução nº ${ret.number} iniciada.`, data: plainCart(saved) };
  });
}

export async function createPixAction(cartId: string, amount: number, payerEmail?: string | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const i = await createPixIntent(s.ctx, { cartId, amount, description: `Venda PDV — atendimento ${cartId.slice(0, 8)}`, payerEmail: payerEmail ?? undefined });
    return { id: i.id, status: i.status, amount: i.amount, reference: i.reference, qrCode: i.qrCode ?? null, qrCodeImage: i.qrCodeImage ?? null, expiresAt: i.expiresAt ?? null, isSimulated: Boolean(i.isSimulated), provider: i.provider };
  });
}

export async function simulatePixAction(intentId: string, status: "confirmed" | "failed") {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const i = await simulateIntent(s.ctx, intentId, status);
    return { id: i.id, status: i.status };
  });
}

export async function cancelPixAction(intentId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const i = await cancelIntent(s.ctx, intentId);
    return { id: i.id, status: i.status };
  });
}

/** Conclui a venda do atendimento. Idempotente pela chave do atendimento: repetir nunca cria outra venda ou cobrança. */
export async function finalizeCartAction(cartId: string, payments: SalePaymentInput[]) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv", "/vendas", "/caixa"] }, async (s) => {
    const cart = await s.ctx.store.getOrThrow("carts", cartId);
    if (cart.companyId !== s.ctx.companyId) throw new BusinessError("Atendimento de outra empresa.");
    if (cart.status === "converted" && cart.saleId) return { ok: true as const, message: "Venda já concluída.", redirect: `/vendas/${cart.saleId}/conclusao` };
    if (cart.status !== "open") throw new BusinessError(cart.status === "parked" ? "Atendimento em espera: retome a pré-venda no PDV." : "Atendimento cancelado.");
    const clean: SalePaymentInput[] = payments.map((p) => ({
      methodId: p.methodId, amount: Math.round(p.amount), received: p.received != null ? Math.round(p.received) : undefined, installments: p.installments ?? undefined,
      paymentTermId: p.paymentTermId ?? null, intentId: p.intentId ?? null, nsu: p.nsu?.trim() || null, authCode: p.authCode?.trim() || null, cardBrand: p.cardBrand?.trim() || null,
      voucherCode: p.voucherCode?.trim() || null, reference: p.reference?.trim() || null,
    }));
    const sale = await finalizeSale(s.ctx, cartToSaleInput(cart, clean));
    return { ok: true as const, message: `Venda nº ${sale.number} concluída.`, data: { saleId: sale.id }, redirect: `/vendas/${sale.id}/conclusao` };
  });
}
