"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { BusinessError } from "@/lib/core/errors";
import { isConflict } from "@/lib/db";
import type { ActionResult } from "@/lib/server/action";
import { scheduleBackgroundJobs } from "@/lib/server/background-jobs";
import { cartCookieName } from "@/domain/ecommerce/storefront";
import { addToCart, applyCoupon, cartView, removeCoupon, selectDelivery, setCartQty, setDeliveryZip } from "@/domain/ecommerce/cart";
import { placeOrder, simulatePaymentEvent, type CheckoutInput } from "@/domain/ecommerce/checkout";
import { cancelByCustomer, orderByToken, requestReturn, retryCharge } from "@/domain/ecommerce/orders";
import { clientIp, loadStore, userAgent } from "./_lib";

/**
 * Ações da vitrine pública (sem sessão do ERP). Toda ação resolve a loja pelo endereço e confere o acesso; o carrinho vem
 * só do cookie httpOnly (nunca do navegador como parâmetro) e preço/estoque/frete são sempre recalculados no servidor.
 */

type R<T = unknown> = ActionResult<T>;

async function run<T>(fn: () => Promise<R<T> | T>): Promise<R<T>> {
  try {
    const out = await fn();
    scheduleBackgroundJobs();
    if (out && typeof out === "object" && "ok" in (out as any)) return out as R<T>;
    return { ok: true, data: out as T };
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    if (e instanceof BusinessError) return { ok: false, error: e.message, code: e.code };
    if (isConflict(e)) return { ok: false, error: "A operação foi alterada ao mesmo tempo por outra. Tente novamente.", code: "conflict" };
    console.error("[loja] erro inesperado", e);
    return { ok: false, error: "Não foi possível concluir agora. Tente novamente em instantes.", code: "unexpected" };
  }
}

async function open(ref: string, opts: { checkout?: boolean } = {}) {
  const s = await loadStore(ref);
  if (!s || s.access === "closed") throw new BusinessError("Loja não encontrada.", "not_found");
  if (s.access === "paused") throw new BusinessError("A loja está em pausa no momento.", "store_paused");
  if (opts.checkout && s.access !== "open") throw new BusinessError("Prévia da loja: o checkout fica disponível depois da publicação.", "preview");
  return s;
}

/** Carrinho do cookie (cria um novo token quando não há). */
async function cartToken(storeId: string, create: boolean): Promise<string | null> {
  const jar = await cookies();
  const name = cartCookieName(storeId);
  const cur = jar.get(name)?.value;
  if (cur && /^[0-9a-f]{32}$/.test(cur)) return cur;
  if (!create) return null;
  const t = crypto.randomBytes(16).toString("hex");
  jar.set(name, t, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
  return t;
}

export async function addToCartAction(ref: string, fd: FormData) {
  return run(async () => {
    const s = await open(ref);
    const token = (await cartToken(s.st.id, true))!;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(fd.get("qty") ?? 1)) || 1));
    const r = await addToCart(s.store, s.st, token, { productSlug: String(fd.get("slug") ?? ""), skuId: String(fd.get("skuId") ?? "") || null, qty });
    const buyNow = fd.get("buyNow") === "1";
    return {
      ok: true as const,
      message: r.limited ? `Adicionado ao carrinho (limitado ao disponível: ${r.available} un.).` : "Produto adicionado ao carrinho.",
      redirect: buyNow ? `${s.basePath}/checkout` : undefined,
    };
  });
}

export async function setQtyAction(ref: string, skuId: string, units: number, _fd: FormData) {
  return run(async () => {
    const s = await open(ref);
    const token = await cartToken(s.st.id, false);
    if (token) await setCartQty(s.store, s.st, token, skuId, units);
    return { ok: true as const };
  });
}

export async function applyCouponAction(ref: string, fd: FormData) {
  return run(async () => {
    const s = await open(ref);
    const token = await cartToken(s.st.id, false);
    if (!token) throw new BusinessError("Seu carrinho está vazio.");
    await applyCoupon(s.store, s.st, token, String(fd.get("code") ?? ""));
    return { ok: true as const, message: "Cupom aplicado." };
  });
}

export async function removeCouponAction(ref: string, _fd: FormData) {
  return run(async () => {
    const s = await open(ref);
    const token = await cartToken(s.st.id, false);
    if (token) await removeCoupon(s.store, s.st, token);
    return { ok: true as const, message: "Cupom removido." };
  });
}

export async function setZipAction(ref: string, fd: FormData) {
  return run(async () => {
    const s = await open(ref);
    const token = await cartToken(s.st.id, false);
    if (!token) throw new BusinessError("Seu carrinho está vazio.");
    await setDeliveryZip(s.store, s.st, token, String(fd.get("zip") ?? ""));
    return { ok: true as const };
  });
}

export async function selectDeliveryAction(ref: string, optionId: string, _fd: FormData) {
  return run(async () => {
    const s = await open(ref);
    const token = await cartToken(s.st.id, false);
    if (token) await selectDelivery(s.store, s.st, token, optionId);
    return { ok: true as const };
  });
}

export interface QuoteView {
  options: Array<{ id: string; label: string; detail: string; price: number; free: boolean; mode: string; simulated: boolean }>;
  problems: string[];
  subtotal: number;
  discount: number;
}

/** Checkout: CEP digitado → opções de entrega recalculadas (e o CEP fica no carrinho). */
export async function quoteAction(ref: string, zip: string): Promise<R<QuoteView>> {
  return run(async () => {
    const s = await open(ref);
    const token = await cartToken(s.st.id, false);
    if (!token) throw new BusinessError("Seu carrinho está vazio.");
    await setDeliveryZip(s.store, s.st, token, zip);
    const v = await cartView(s.store, s.st, token, { requote: true });
    if (!v) throw new BusinessError("Seu carrinho está vazio.");
    return { options: v.delivery.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail, price: o.price, free: o.free, mode: o.mode, simulated: o.simulated })), problems: v.delivery.problems, subtotal: v.subtotal, discount: v.discount };
  });
}

export async function placeOrderAction(ref: string, payload: Omit<CheckoutInput, "meta">): Promise<R<{ token: string }>> {
  return run(async () => {
    const s = await open(ref, { checkout: true });
    const token = await cartToken(s.st.id, false);
    if (!token) throw new BusinessError("Seu carrinho expirou: adicione os produtos novamente.");
    const order = await placeOrder(s.store, s.st, token, { ...payload, meta: { ip: await clientIp(), userAgent: await userAgent() } });
    // o carrinho virou pedido: o próximo acesso começa um carrinho novo
    (await cookies()).delete(cartCookieName(s.st.id));
    return { ok: true as const, data: { token: order.token }, redirect: `${s.basePath}/pedido/${order.token}` };
  });
}

async function orderFor(ref: string, token: string) {
  const s = await loadStore(ref);
  if (!s || s.access === "closed") throw new BusinessError("Loja não encontrada.", "not_found");
  const o = await orderByToken(s.store, s.st, token);
  if (!o) throw new BusinessError("Pedido não encontrado.", "not_found");
  return { s, o };
}

/** Página do pedido, somente com o gateway em simulação: "Simular pagamento" (aprovar, recusar). */
export async function simulatePayAction(ref: string, token: string, type: "approved" | "failed", _fd: FormData) {
  return run(async () => {
    const { s, o } = await orderFor(ref, token);
    if (o.payment?.simulated === false) throw new BusinessError("Pagamento real: aguarde a confirmação do banco.");
    const r = await simulatePaymentEvent(s.store, o, type);
    return { ok: true as const, message: r.outcome === "applied" ? (type === "approved" ? "Pagamento confirmado na simulação." : "Pagamento recusado na simulação.") : r.message };
  });
}

export async function cancelByCustomerAction(ref: string, token: string, _fd: FormData) {
  return run(async () => {
    const { s, o } = await orderFor(ref, token);
    await cancelByCustomer(s.store, o);
    return { ok: true as const, message: "Pedido cancelado. Nenhuma cobrança foi realizada." };
  });
}

export async function retryChargeCustomerAction(ref: string, token: string, _fd: FormData) {
  return run(async () => {
    const { s, o } = await orderFor(ref, token);
    const after = await retryCharge(s.store, o);
    return { ok: true as const, message: after.payment?.status === "error" ? "Ainda não foi possível gerar a cobrança. Tente em instantes." : "Cobrança gerada." };
  });
}

export async function requestReturnAction(ref: string, token: string, fd: FormData) {
  return run(async () => {
    const { s, o } = await orderFor(ref, token);
    const reason = String(fd.get("reason") ?? "withdrawal") as "withdrawal" | "defect" | "other";
    await requestReturn(s.store, o, { reason: ["withdrawal", "defect", "other"].includes(reason) ? reason : "other", details: String(fd.get("details") ?? "") });
    return { ok: true as const, message: "Solicitação de devolução registrada. A loja vai entrar em contato." };
  });
}
