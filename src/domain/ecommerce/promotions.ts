import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { formatMoney, formatBps } from "@/lib/money";
import { requireStore } from "./common";
import { couponDiscount, normalizeCouponCode } from "./cart";

/**
 * Promoções e recuperação de carrinhos (Tela 55).
 *  - Cupom: código de 3 a 20 letras e números, percentual sobre os PRODUTOS (o frete não entra), teto por pedido, compra
 *    mínima, vigência, limite de usos (total e por cliente) e frete grátis opcional. O uso é contado ao fechar o pedido
 *    (limite atômico) e devolvido se o pedido for cancelado antes do pagamento.
 *  - Recuperação: lista carrinhos parados com contato e CONSENTIMENTO para mensagens (LGPD); a mensagem fica em rascunho
 *    — nenhum envio automático nesta versão (depende de canal, configuração e autorização).
 */

export interface CouponInput {
  code: string;
  description?: string | null;
  percentBps: number;
  capAmount: number;
  minOrder: number;
  freeShipping: boolean;
  active: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
}

export const COUPON_CODE_FORMAT = /^[A-Z0-9]{3,20}$/;

export async function listCoupons(ctx: Ctx) {
  const st = await requireStore(ctx);
  return (await listAll(unscoped(ctx.store), "store_coupons", { filters: [["eq", "storeId", st.id]] })).sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || String(a.code).localeCompare(String(b.code)));
}

export async function saveCoupon(ctx: Ctx, input: CouponInput): Promise<Doc> {
  requireAction(ctx, "ecommerce.marketing");
  const st = await requireStore(ctx);
  const code = normalizeCouponCode(input.code);
  assert(COUPON_CODE_FORMAT.test(code), "Código do cupom: de 3 a 20 letras e números, sem espaços.");
  assert(input.percentBps > 0 || input.freeShipping, "Informe o percentual de desconto ou marque frete grátis.");
  assert(input.percentBps >= 0 && input.percentBps <= 9000, "Desconto entre 0% e 90%.");
  assert(input.capAmount >= 0 && input.minOrder >= 0, "Valores não podem ser negativos.");
  if (input.validFrom && input.validTo) assert(input.validFrom <= input.validTo, "A vigência termina antes de começar.");
  const id = detId("scoupon", st.id, code);
  const base = unscoped(ctx.store);
  const before = await base.get("store_coupons", id);
  const data = {
    companyId: ctx.companyId,
    branchId: null,
    storeId: st.id,
    code,
    description: input.description?.trim().slice(0, 200) || null,
    percentBps: Math.round(input.percentBps),
    capAmount: Math.round(input.capAmount),
    minOrder: Math.round(input.minOrder),
    freeShipping: Boolean(input.freeShipping),
    active: Boolean(input.active),
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
    usageLimit: input.usageLimit && input.usageLimit > 0 ? Math.round(input.usageLimit) : null,
    perCustomerLimit: input.perCustomerLimit && input.perCustomerLimit > 0 ? Math.round(input.perCustomerLimit) : null,
  };
  let doc: Doc;
  if (before) doc = await base.update("store_coupons", id, data);
  else {
    try {
      doc = await base.create("store_coupons", { ...data, createdBy: ctx.user.id, usedCount: 0 }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await base.update("store_coupons", id, data);
    }
  }
  await audit(ctx, { module: "sales", action: "ecommerce.coupon_save", entityType: "store_coupon", entityId: id, summary: `Cupom ${code}: ${couponSummary(doc)}${doc.active ? "" : " (pausado)"}`, before: before ? { percentBps: before.percentBps, capAmount: before.capAmount, minOrder: before.minOrder, active: before.active } : null, after: { percentBps: data.percentBps, capAmount: data.capAmount, minOrder: data.minOrder, active: data.active }, related: [`store:${st.id}`] });
  return doc;
}

export async function setCouponActive(ctx: Ctx, couponId: string, active: boolean) {
  requireAction(ctx, "ecommerce.marketing");
  const st = await requireStore(ctx);
  const base = unscoped(ctx.store);
  const c = await base.getOrThrow("store_coupons", couponId);
  assert(c.storeId === st.id, "Cupom de outra loja.");
  await base.update("store_coupons", c.id, { active });
  await audit(ctx, { module: "sales", action: "ecommerce.coupon_active", entityType: "store_coupon", entityId: c.id, summary: `Cupom ${c.code} ${active ? "ativado" : "pausado"}`, related: [`store:${st.id}`] });
}

/** Texto da oferta exibido na prévia (Tela 55: "10% OFF — com o cupom X, em compras a partir de ..."). */
export function couponSummary(c: Doc) {
  const parts: string[] = [];
  if (c.percentBps) parts.push(`${formatBps(c.percentBps, 0)} de desconto nos produtos`);
  if (c.freeShipping) parts.push("frete grátis");
  if (c.minOrder) parts.push(`em compras a partir de ${formatMoney(c.minOrder)}`);
  if (c.capAmount) parts.push(`desconto máximo de ${formatMoney(c.capAmount)} por pedido`);
  return parts.join(", ") || "sem benefício";
}

/** "Testar no carrinho": desconto que o cupom daria para um valor de produtos. */
export function testCoupon(c: Doc, goods: number) {
  const { discount, problem } = couponDiscount(c, goods);
  return { discount, problem, totalGoods: goods - discount };
}

// ───────────────────────────── Recuperação de carrinhos

export interface AbandonedCart {
  cart: Doc;
  customerName: string;
  contact: string;
  consent: boolean;
  units: number;
  subtotal: number;
  idleMinutes: number;
}

/** Carrinhos parados há mais de 1 hora com itens. Contato só aparece completo para quem consentiu com mensagens. */
export async function abandonedCarts(ctx: Ctx, opts: { minIdleMinutes?: number } = {}): Promise<AbandonedCart[]> {
  requireAction(ctx, "ecommerce.marketing");
  const st = await requireStore(ctx);
  const idle = opts.minIdleMinutes ?? 60;
  const limit = Date.now() - idle * 60000;
  const carts = await listAll(unscoped(ctx.store), "store_carts", { filters: [["eq", "storeId", st.id], ["eq", "status", "open"]] }, 2000);
  return carts
    .filter((c) => (c.itemsCount ?? 0) > 0 && Date.parse(c.lastActivityAt ?? c.updatedAt ?? 0) < limit)
    .map((c) => {
      const consent = Boolean(c.marketingConsent);
      const email = String(c.customer?.email ?? "");
      const phone = String(c.customer?.phone ?? "");
      const masked = email ? email.replace(/^(.)[^@]*(@.*)$/, "$1***$2") : phone ? phone.replace(/^(\d{2})\d+(\d{2})$/, "($1) *****-**$2") : "";
      return {
        cart: c,
        customerName: c.customer?.name ? String(c.customer.name).split(" ")[0] : "Visitante sem identificação",
        contact: consent ? email || phone : masked,
        consent,
        units: c.itemsCount ?? 0,
        subtotal: c.subtotal ?? 0,
        idleMinutes: Math.round((Date.now() - Date.parse(c.lastActivityAt ?? c.updatedAt)) / 60000),
      };
    })
    .sort((a, b) => Number(b.consent) - Number(a.consent) || a.idleMinutes - b.idleMinutes);
}

export function defaultRecoveryMessage(storeName: string, firstName: string, couponCode?: string | null) {
  return `Olá, ${firstName}! Seus produtos continuam reservados no carrinho da ${storeName} por pouco tempo. ${couponCode ? `Use o cupom ${couponCode} para ganhar um desconto e ` : ""}finalize sua compra quando quiser. Se não quiser mais receber estas mensagens, responda SAIR.`;
}

/** Salva a mensagem de retomada em rascunho (nunca envia). Exige consentimento registrado no carrinho. */
export async function saveRecoveryDraft(ctx: Ctx, cartId: string, message: string) {
  requireAction(ctx, "ecommerce.marketing");
  const st = await requireStore(ctx);
  const base = unscoped(ctx.store);
  const c = await base.getOrThrow("store_carts", cartId);
  assert(c.storeId === st.id, "Carrinho de outra loja.");
  if (!c.marketingConsent) throw new BusinessError("Este cliente não autorizou mensagens: a recuperação não pode ser preparada (LGPD).", "no_consent");
  const text = message.trim();
  assert(text.length >= 20, "Escreva a mensagem (mínimo de 20 caracteres).");
  await base.update("store_carts", c.id, { recoveryDraft: text.slice(0, 1000), recoveryAt: nowIso() });
  await audit(ctx, { module: "sales", action: "ecommerce.cart_recovery_draft", entityType: "store_cart", entityId: c.id, summary: "Mensagem de recuperação de carrinho salva em rascunho (não enviada)", related: [`store:${st.id}`] });
}
