import { detId, listAll, newId } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting } from "@/lib/core/settings";
import { formatMoney } from "@/lib/money";
import { cartTotals, type CartItem } from "./cart-calc";
import { cancelIntentAtProvider, maybePayable } from "./payments/intents";
import type { FinalizeSaleInput, SalePaymentInput } from "./sales";

export { cartTotals, effectiveUnitPrice, type CartItem } from "./cart-calc";

/**
 * Atendimento do PDV (carrinho) e pré-venda.
 *  - O atendimento em edição fica gravado no servidor (`carts`, status "open") e é retomado após atualização acidental.
 *  - Pré-venda = atendimento salvo ("parked") para retomar depois (no mesmo ou em outro terminal da filial).
 *  - A chave de idempotência da venda é derivada do atendimento (`cart:<id>`): repetir a conclusão nunca cria outra venda.
 *  - Estados: open → parked ⇄ open → converted | cancelled.
 */

export interface CartPaymentDraft extends SalePaymentInput {
  key: string;
  kind?: string;
  label?: string;
}

export interface CartPatch {
  customerId?: string | null;
  cpfOnInvoice?: string | null;
  priceTableId?: string | null;
  sellerId?: string | null;
  items?: CartItem[];
  globalDiscount?: number;
  globalDiscountBps?: number;
  surcharge?: number;
  notes?: string | null;
  payments?: CartPaymentDraft[];
  exchangeReturnId?: string | null;
  emitFiscal?: boolean;
}

export const cartIdemKey = (cartId: string) => `cart:${cartId}`;

const OPEN = ["open"];

function assertCartAccess(ctx: Ctx, cart: Doc) {
  assert(cart.companyId === ctx.companyId, "Atendimento de outra empresa.");
  if (ctx.branchId) assert(cart.branchId === ctx.branchId, "Atendimento de outra filial.");
}

function clampItems(items: CartItem[]): CartItem[] {
  return items
    .filter((i) => i && typeof i.skuId === "string" && Number.isFinite(i.qty) && i.qty > 0)
    .slice(0, 200)
    .map((i) => ({
      skuId: i.skuId,
      qty: Math.round(i.qty),
      unitPrice: i.unitPrice == null ? null : Math.max(0, Math.round(i.unitPrice)),
      itemDiscount: Math.max(0, Math.round(i.itemDiscount ?? 0)),
      itemSurcharge: Math.max(0, Math.round(i.itemSurcharge ?? 0)),
      sku: i.sku,
      name: i.name,
      unitCode: i.unitCode,
      listPrice: i.listPrice,
      wholesalePrice: i.wholesalePrice ?? null,
      wholesaleMinQty: i.wholesaleMinQty ?? null,
      available: i.available ?? null,
      service: Boolean(i.service),
      maxDiscountBps: i.maxDiscountBps ?? null,
      attributes: i.attributes && typeof i.attributes === "object" ? i.attributes : undefined,
    }));
}

/** Atendimento aberto do operador no terminal (cria um vazio quando não houver). */
export async function ensureOpenCart(ctx: Ctx, terminalId: string, opts: { create?: boolean } = {}): Promise<Doc | null> {
  requirePerm(ctx, "pdv", "view");
  const branchId = requireBranch(ctx);
  const terminal = await ctx.store.getOrThrow("terminals", terminalId);
  assert(terminal.branchId === branchId && terminal.companyId === ctx.companyId, "Terminal de outra filial.");
  const open = await listAll(ctx.store, "carts", { filters: [["eq", "terminalId", terminalId], ["eq", "status", OPEN], ["eq", "operatorId", ctx.user.id]], orderBy: [{ field: "updatedAt", dir: "desc" }] }, 5);
  for (const cart of open) {
    // atendimento já vendido (registro anterior à conversão atômica): não reabre o atendimento vendido
    const sold = await ctx.store.get("sales", detId("sale", cartIdemKey(cart.id)));
    if (!sold) return cart;
    await ctx.store.update("carts", cart.id, { status: "converted", saleId: sold.id, payments: [] });
  }
  if (opts.create === false) return null;
  return createCart(ctx, terminalId);
}

export async function createCart(ctx: Ctx, terminalId: string, patch: CartPatch = {}) {
  requirePerm(ctx, "pdv", "create");
  const branchId = requireBranch(ctx);
  const branch = await ctx.store.getOrThrow("branches", branchId);
  return ctx.store.create(
    "carts",
    {
      companyId: ctx.companyId,
      branchId,
      createdBy: ctx.user.id,
      terminalId,
      operatorId: ctx.user.id,
      status: "open",
      name: null,
      customerId: patch.customerId ?? null,
      priceTableId: patch.priceTableId ?? branch.defaultPriceTableId ?? null,
      items: [],
      globalDiscount: 0,
      globalDiscountBps: 0,
      surcharge: 0,
      payments: [],
      exchangeReturnId: patch.exchangeReturnId ?? null,
      total: 0,
      itemsCount: 0,
      revision: 0,
    },
    newId(),
  );
}

/** Grava o estado do atendimento (autosalvamento do PDV). */
export async function saveCart(ctx: Ctx, cartId: string, patch: CartPatch) {
  requirePerm(ctx, "pdv", "create");
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  if (cart.status === "converted") throw new BusinessError("Este atendimento já virou venda. Inicie um novo atendimento.", "cart_converted", { saleId: cart.saleId });
  assert(cart.status === "open", cart.status === "cancelled" ? "Atendimento cancelado." : "Atendimento salvo como pré-venda: retome-o antes de editar.", "cart_not_open");
  const data: Record<string, any> = { revision: (cart.revision ?? 0) + 1 };
  if (patch.items !== undefined) data.items = clampItems(patch.items);
  if (patch.customerId !== undefined) {
    if (patch.customerId) {
      const c = await ctx.store.getOrThrow("customers", patch.customerId);
      assert(c.companyId === ctx.companyId, "Cliente de outra empresa.");
      assert(c.status !== "inactive", "Cliente inativo.");
      data.customerName = c.name;
    } else data.customerName = null;
    data.customerId = patch.customerId;
  }
  if (patch.cpfOnInvoice !== undefined) data.cpfOnInvoice = patch.cpfOnInvoice ? patch.cpfOnInvoice.replace(/\D/g, "").slice(0, 14) : null;
  if (patch.priceTableId !== undefined) data.priceTableId = patch.priceTableId;
  if (patch.sellerId !== undefined) data.sellerId = patch.sellerId;
  if (patch.globalDiscount !== undefined) data.globalDiscount = Math.max(0, Math.round(patch.globalDiscount));
  if (patch.globalDiscountBps !== undefined) data.globalDiscountBps = Math.min(10000, Math.max(0, Math.round(patch.globalDiscountBps)));
  if (patch.surcharge !== undefined) data.surcharge = Math.max(0, Math.round(patch.surcharge));
  if (patch.notes !== undefined) data.notes = patch.notes ? patch.notes.slice(0, 500) : null;
  if (patch.payments !== undefined) data.payments = (patch.payments ?? []).slice(0, 20);
  if (patch.exchangeReturnId !== undefined) data.exchangeReturnId = patch.exchangeReturnId;
  if (patch.emitFiscal !== undefined) data.emitFiscal = Boolean(patch.emitFiscal);
  if (patch.sellerId) {
    const u = await ctx.store.get("users", patch.sellerId);
    assert(u && (u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId)), "Vendedor inválido.");
  }
  const merged = { ...cart, ...data };
  const totals = cartTotals(merged);
  data.total = totals.total;
  data.itemsCount = (merged.items ?? []).length;
  return ctx.store.update("carts", cartId, data);
}

async function parkInternal(ctx: Ctx, cart: Doc, name?: string | null) {
  assert(cart.status === "open", "Somente atendimentos em edição podem ser salvos como pré-venda.");
  assert((cart.items ?? []).length > 0, "Adicione itens antes de salvar a pré-venda.");
  const confirmedPix = await unusedConfirmedPix(ctx, cart.id);
  assert(!confirmedPix, `Há Pix confirmado neste atendimento (${formatMoney(confirmedPix?.amount)}). Conclua a venda antes de colocá-lo em espera.`, "pix_confirmed");
  const hours = await getSetting(ctx.store, ctx.companyId, cart.branchId, "sales.presaleExpiryHours", 72);
  const label = name?.trim() || cart.customerName || `Pré-venda ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;
  const parked = await ctx.store.update("carts", cart.id, { status: "parked", name: label.slice(0, 120), parkedAt: nowIso(), expiresAt: new Date(Date.now() + Number(hours) * 3600000).toISOString(), payments: [] });
  await audit(ctx, { module: "pdv", action: "cart.park", entityType: "cart", entityId: cart.id, summary: `Pré-venda "${label}" salva — ${formatMoney(cart.total)} (${(cart.items ?? []).length} itens)`, related: cart.customerId ? [`customer:${cart.customerId}`] : [] });
  return parked;
}

/** Salva como pré-venda (atendimento em espera) e devolve um atendimento novo para o terminal. */
export async function parkCart(ctx: Ctx, cartId: string, name?: string | null) {
  requirePerm(ctx, "pdv", "create");
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  const parked = await parkInternal(ctx, cart, name);
  const fresh = await createCart(ctx, cart.terminalId);
  return { parked, fresh };
}

/** Retoma uma pré-venda neste terminal. O atendimento atual com itens vai para espera; vazio é descartado. */
export async function resumeCart(ctx: Ctx, cartId: string, terminalId: string) {
  requirePerm(ctx, "pdv", "create");
  const branchId = requireBranch(ctx);
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  if (cart.status === "open" && cart.terminalId === terminalId && cart.operatorId === ctx.user.id) return cart;
  assert(cart.status === "parked", cart.status === "converted" ? "Esta pré-venda já foi concluída." : cart.status === "cancelled" ? "Esta pré-venda foi cancelada." : "Atendimento em uso em outro terminal.");
  const terminal = await ctx.store.getOrThrow("terminals", terminalId);
  assert(terminal.branchId === branchId, "Terminal de outra filial.");
  const current = await ensureOpenCart(ctx, terminalId, { create: false });
  if (current && current.id !== cartId) {
    if ((current.items ?? []).length) await parkInternal(ctx, current, current.name ?? null);
    else await ctx.store.update("carts", current.id, { status: "cancelled", cancelReason: "Atendimento vazio substituído por pré-venda retomada" });
  }
  const resumed = await ctx.store.update("carts", cartId, { status: "open", terminalId, operatorId: ctx.user.id, revision: (cart.revision ?? 0) + 1 });
  await audit(ctx, { module: "pdv", action: "cart.resume", entityType: "cart", entityId: cartId, summary: `Pré-venda "${cart.name ?? ""}" retomada no terminal ${terminal.name}` });
  return resumed;
}

/** Pix confirmado e ainda não usado em venda (impede descartar/pôr em espera sem tratar o dinheiro recebido). */
export async function unusedConfirmedPix(ctx: Ctx, cartId: string) {
  const intents = await listAll(ctx.store, "payment_intents", { filters: [["eq", "cartId", cartId], ["eq", "kind", "pix"]] });
  return intents.find((i) => i.status === "confirmed" && !i.saleId) ?? null;
}

/**
 * Cancela o atendimento (não apaga: fica registrado com motivo). Cobranças Pix em aberto são canceladas NO PROVEDOR
 * antes (consulta → cancelamento confirmado); se o provedor não confirmar, o atendimento não é cancelado.
 */
export async function cancelCart(ctx: Ctx, cartId: string, reason?: string | null) {
  requirePerm(ctx, "pdv", "create");
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  if (cart.status === "cancelled") return cart;
  assert(cart.status !== "converted", "Atendimento já concluído como venda.");
  const pixConfirmedMsg = (amount: number) => `Há Pix confirmado neste atendimento (${formatMoney(amount)}). Conclua a venda ou providencie a devolução do Pix antes de cancelar.`;
  const confirmed = await unusedConfirmedPix(ctx, cartId);
  assert(!confirmed, pixConfirmedMsg(confirmed?.amount), "pix_confirmed");
  const intents = await listAll(ctx.store, "payment_intents", { filters: [["eq", "cartId", cartId], ["eq", "kind", "pix"]] });
  for (const i of intents.filter((x) => !x.saleId && (["pending", "unknown"].includes(x.status) || maybePayable(x)))) await cancelIntentAtProvider(ctx, i);
  // a consulta ao provedor pode revelar pagamento feito enquanto o atendimento era cancelado
  const paidMeanwhile = await unusedConfirmedPix(ctx, cartId);
  assert(!paidMeanwhile, pixConfirmedMsg(paidMeanwhile?.amount), "pix_confirmed");
  const updated = await ctx.store.update("carts", cartId, { status: "cancelled", cancelReason: reason?.trim() || "Cancelado pelo operador", payments: [] });
  if ((cart.items ?? []).length) {
    await audit(ctx, { module: "pdv", action: "cart.cancel", entityType: "cart", entityId: cartId, summary: `Atendimento cancelado — ${formatMoney(cart.total)} (${(cart.items ?? []).length} itens)`, reason: reason ?? null });
  }
  return updated;
}

/** Pré-vendas em espera da filial. */
export async function listParkedCarts(ctx: Ctx) {
  const branchId = requireBranch(ctx);
  const rows = await listAll(ctx.store, "carts", { filters: [["eq", "branchId", branchId], ["eq", "status", "parked"]], orderBy: [{ field: "parkedAt", dir: "desc" }] }, 200);
  const now = nowIso();
  return rows.map((r) => ({ ...r, expired: Boolean(r.expiresAt && r.expiresAt < now) }));
}

/** Converte o atendimento em entrada de venda (preços e regras revalidados pelo servidor em `finalizeSale`). */
export function cartToSaleInput(cart: Doc, payments: SalePaymentInput[]): FinalizeSaleInput {
  return {
    idemKey: cartIdemKey(cart.id),
    cartId: cart.id,
    terminalId: cart.terminalId,
    customerId: cart.customerId ?? null,
    cpfOnInvoice: cart.cpfOnInvoice ?? null,
    priceTableId: cart.priceTableId ?? null,
    sellerId: cart.sellerId ?? null,
    items: (cart.items ?? []).map((i: CartItem) => ({ skuId: i.skuId, qty: i.qty, itemDiscount: i.itemDiscount ?? 0, itemSurcharge: i.itemSurcharge ?? 0, unitPrice: i.unitPrice ?? undefined })),
    globalDiscount: cart.globalDiscountBps ? undefined : (cart.globalDiscount ?? 0),
    globalDiscountBps: cart.globalDiscountBps || undefined,
    surcharge: cart.surcharge ?? 0,
    payments,
    notes: cart.notes ?? null,
    exchangeReturnId: cart.exchangeReturnId ?? null,
    emitFiscal: cart.emitFiscal !== false,
  };
}
