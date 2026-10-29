import { detId, listAll, newId } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { DEFAULT_TZ, nowIso } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx, type CtxUser } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { formatMoney, formatQty, roundDiv, QTY } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import type { Store } from "@/lib/db/types";
import { defaultWarehouse, ensureBalance, releaseReservations, reserve } from "./stock";
import { cartTotals, type CartItem } from "./cart-calc";
import { cancelIntentAtProvider, maybePayable } from "./payments/intents";
import { livePromotionRules } from "./promotions";
import type { FinalizeSaleInput, SalePaymentInput } from "./sales";
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";

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
  /** orçamento/pedido importado (PDV-12) — gravado só pela importação (`importDocumentToCart`) */
  salesDocumentId?: string | null;
  salesDocumentLabel?: string | null;
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
      ...(i.scale && typeof i.scale === "object" && typeof i.scale.barcode === "string"
        ? { scale: { barcode: i.scale.barcode.slice(0, 20), content: i.scale.content === "value" ? ("value" as const) : ("weight" as const), labelValue: Number.isFinite(i.scale.labelValue) ? Math.round(i.scale.labelValue!) : null } }
        : {}),
      // produto/categoria (casam as promoções por produto/categoria no PDV) — só quando informados
      ...(typeof i.productId === "string" ? { productId: i.productId } : {}),
      ...(typeof i.categoryId === "string" ? { categoryId: i.categoryId } : {}),
      // lote escolhido (EST-02): só para produto com controle de lote; a venda confere o lote no servidor
      ...(i.lotControl ? { lotControl: true, lot: typeof i.lot === "string" && i.lot.trim() ? i.lot.trim().slice(0, 60) : null } : {}),
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

/** Quantidade por SKU (soma das linhas) — base da regra de remoção de item já registrado (§44). */
function qtyBySku(items: CartItem[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items ?? []) if (i?.skuId) m.set(i.skuId, (m.get(i.skuId) ?? 0) + (i.qty ?? 0));
  return m;
}

/**
 * Grava o estado do atendimento (autosalvamento do PDV).
 * Diminuir a quantidade de um SKU já registrado no servidor (remover item) não passa pelo autosalvamento: usa
 * `removeCartItem`, que confere a permissão/autorização e registra a remoção (§44). `opts.replaceItems` é só para
 * a reimportação do mesmo orçamento/pedido (o documento define os itens).
 */
export async function saveCart(ctx: Ctx, cartId: string, patch: CartPatch, opts: { replaceItems?: boolean } = {}) {
  requirePerm(ctx, "pdv", "create");
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  if (cart.status === "converted") throw new BusinessError("Este atendimento já virou venda. Inicie um novo atendimento.", "cart_converted", { saleId: cart.saleId });
  assert(cart.status === "open", cart.status === "cancelled" ? "Atendimento cancelado." : "Atendimento salvo como pré-venda: retome-o antes de editar.", "cart_not_open");
  const data: Record<string, any> = { revision: (cart.revision ?? 0) + 1 };
  if (patch.items !== undefined) {
    data.items = clampItems(patch.items);
    const before = qtyBySku(cart.items);
    const after = qtyBySku(data.items);
    if (!opts.replaceItems) {
      for (const [skuId, q] of before) {
        if ((after.get(skuId) ?? 0) < q) {
          throw new BusinessError("Para remover ou diminuir um item já registrado, use a remoção de item do PDV (fica registrada no histórico e pode exigir autorização do supervisor).", "remove_item_required", { skuId });
        }
      }
    }
    // última inclusão por SKU (exceção de N segundos para remover item recém-lançado sem autorização)
    const added = Object.fromEntries([...after].filter(([skuId, q]) => q > (before.get(skuId) ?? 0)).map(([skuId]) => [skuId, nowIso()]));
    if (Object.keys(added).length) data.lastAddedAt = { ...Object.fromEntries(Object.entries((cart.lastAddedAt ?? {}) as Record<string, string>).filter(([k]) => after.has(k))), ...added };
  }
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
  if (patch.salesDocumentId !== undefined) {
    data.salesDocumentId = patch.salesDocumentId;
    data.salesDocumentLabel = patch.salesDocumentId ? (patch.salesDocumentLabel ?? null) : null;
  }
  if (patch.sellerId) {
    const u = await ctx.store.get("users", patch.sellerId);
    assert(u && (u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId)), "Vendedor inválido.");
  }
  const merged = { ...cart, ...data };
  // total gravado com as promoções vigentes (o servidor reaplica tudo na conclusão); documento importado não tem promoção
  const rules = merged.salesDocumentId ? [] : await livePromotionRules(ctx.store, ctx.companyId, cart.branchId);
  const totals = cartTotals(merged, rules.length ? { rules, tz: DEFAULT_TZ, branchId: cart.branchId } : null);
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
  // reserva de estoque da pré-venda (VEN-03, parâmetro feature.reservaPreVenda): refeita a cada vez que é salva
  const reservation = await syncCartReservations(ctx, parked);
  const reservedText = reservation.enabled ? ` — reserva de estoque${reservation.shortage.length ? ` parcial (falta: ${reservation.shortage.map((x) => `${x.sku} ${x.missing / QTY}`).join(", ")})` : " feita"}` : "";
  await audit(ctx, { module: "pdv", action: "cart.park", entityType: "cart", entityId: cart.id, summary: `Pré-venda "${label}" salva — ${formatMoney(cart.total)} (${(cart.items ?? []).length} itens)${reservedText}`, related: cart.customerId ? [`customer:${cart.customerId}`] : [] });
  return Object.assign(parked, { reservation });
}

/**
 * Reserva da pré-venda (VEN-03): libera a reserva anterior do atendimento e, com o recurso ligado, reserva os itens físicos
 * no depósito do terminal (padrão da filial) até o disponível — o que faltar fica registrado como falta (não bloqueia).
 * Mesmo mecanismo das transferências e dos pedidos de venda (`reserve`/`releaseReservations`, chave nova a cada vez).
 * A venda concluída consome a reserva (`completeSalePostCommit`); cancelamento e expiração liberam.
 */
export async function syncCartReservations(ctx: Ctx, cart: Doc) {
  const sctx: Ctx = { ...ctx, branchId: cart.branchId };
  await releaseReservations(sctx, "cart", cart.id, "released");
  const shortage: Array<{ skuId: string; sku: string; missing: number }> = [];
  if (!(await isFeatureOn(ctx.store, ctx.companyId, cart.branchId, "reservaPreVenda", false))) return { enabled: false, shortage };
  const terminal = cart.terminalId ? await ctx.store.get("terminals", cart.terminalId) : null;
  const warehouseId = terminal?.defaultWarehouseId ?? (await defaultWarehouse(ctx.store, cart.branchId)).id;
  const want = new Map<string, number>();
  for (const i of (cart.items ?? []) as CartItem[]) if (i.qty > 0) want.set(i.skuId, (want.get(i.skuId) ?? 0) + i.qty);
  for (const [skuId, qty] of want) {
    const sku = await ctx.store.get("skus", skuId);
    const product = sku ? await ctx.store.get("products", sku.productId) : null;
    if (!sku || !product || product.type === "service") continue;
    const bal = await ensureBalance(ctx.store, ctx, warehouseId, skuId);
    const q = Math.min(qty, Math.max(0, bal.physical - bal.reserved));
    if (q > 0) {
      const gen = (await listAll(ctx.store, "stock_reservations", { filters: [["eq", "originType", "cart"], ["eq", "originId", cart.id], ["eq", "skuId", skuId]] })).length;
      try {
        await reserve(sctx, { warehouseId, skuId, qty: q, originType: "cart", originId: cart.id, idemKey: `cart:${cart.id}:${skuId}:${gen}` });
      } catch (e) {
        if (!(e instanceof BusinessError) || e.code !== "insufficient_stock") throw e;
        shortage.push({ skuId, sku: sku.sku, missing: qty });
        continue;
      }
    }
    if (q < qty) shortage.push({ skuId, sku: sku.sku, missing: qty - q });
  }
  return { enabled: true, shortage };
}

/**
 * Rotina diária `sales.presale_reservations`: libera reservas de pré-vendas vencidas (`expiresAt`, parâmetro
 * `sales.presaleExpiryHours`) e de atendimentos já encerrados (convertidos/cancelados). A pré-venda continua na gaveta
 * (marcada como expirada) e pode ser retomada; sem reserva, a venda confere o disponível normalmente.
 */
export async function releaseExpiredPresales(store: Store, companyId: string, now = nowIso()) {
  const { systemCtx } = await import("@/lib/core/ctx");
  const active = await listAll(store, "stock_reservations", { filters: [["eq", "companyId", companyId], ["eq", "originType", "cart"], ["eq", "status", "active"]] });
  let released = 0;
  for (const cartId of new Set(active.map((r) => r.originId as string))) {
    const cart = await store.get("carts", cartId);
    const expired = !cart || ["converted", "cancelled"].includes(cart.status) || Boolean(cart.expiresAt && cart.expiresAt < now);
    if (!expired) continue;
    const ctx = systemCtx(store, companyId, cart?.branchId ?? null);
    released += await releaseReservations(ctx, "cart", cartId, cart?.status === "converted" ? "consumed" : "released");
    if (cart && cart.status !== "converted") await audit(ctx, { module: "pdv", action: "cart.reservation_expire", entityType: "cart", entityId: cartId, summary: `Reserva de estoque da pré-venda "${cart.name ?? ""}" liberada (${cart.status === "cancelled" ? "atendimento cancelado" : "pré-venda expirada"})` });
  }
  return { released };
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
export async function cancelCart(ctx: Ctx, cartId: string, reason?: string | null, opts: { approval?: SupervisorCredentials | null } = {}) {
  requirePerm(ctx, "pdv", "create");
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  if (cart.status === "cancelled") return cart;
  assert(cart.status !== "converted", "Atendimento já concluído como venda.");
  // §44: atendimento com itens exige a permissão ou a autorização do supervisor (parâmetro pdv.cancelCartRequiresAuth)
  let approver: CtxUser | null = null;
  if ((cart.items ?? []).length && (await pdvAuthPolicy(ctx, cart.branchId)).cancelRequiresAuth && !canDo(ctx.user, "pdv.cancel_cart")) {
    if (!opts.approval?.login) throw new BusinessError("Cancelar o atendimento exige autorização do supervisor: informe login e senha de quem tem a permissão “Cancelar atendimento do PDV com itens”.", "approval_required");
    approver = await verifySupervisor(ctx, opts.approval, "pdv.cancel_cart", `cancelamento do atendimento de ${formatMoney(cart.total)}`);
  }
  const pixConfirmedMsg = (amount: number) => `Há Pix confirmado neste atendimento (${formatMoney(amount)}). Conclua a venda ou providencie a devolução do Pix antes de cancelar.`;
  const confirmed = await unusedConfirmedPix(ctx, cartId);
  assert(!confirmed, pixConfirmedMsg(confirmed?.amount), "pix_confirmed");
  const intents = await listAll(ctx.store, "payment_intents", { filters: [["eq", "cartId", cartId], ["eq", "kind", "pix"]] });
  for (const i of intents.filter((x) => !x.saleId && (["pending", "unknown"].includes(x.status) || maybePayable(x)))) await cancelIntentAtProvider(ctx, i);
  // a consulta ao provedor pode revelar pagamento feito enquanto o atendimento era cancelado
  const paidMeanwhile = await unusedConfirmedPix(ctx, cartId);
  assert(!paidMeanwhile, pixConfirmedMsg(paidMeanwhile?.amount), "pix_confirmed");
  const updated = await ctx.store.update("carts", cartId, {
    status: "cancelled", cancelReason: reason?.trim() || "Cancelado pelo operador", payments: [], cancelledBy: ctx.user.id,
    cancelApprovedBy: approver?.id ?? null, cancelApprovedByName: approver?.name ?? null,
  });
  // reserva da pré-venda (VEN-03): cancelar o atendimento libera o estoque reservado
  await releaseReservations({ ...ctx, branchId: cart.branchId }, "cart", cartId, "released");
  if ((cart.items ?? []).length) {
    const session = await terminalSession(ctx, cart.terminalId);
    await audit(ctx, {
      module: "pdv", action: "cart.cancel", entityType: "cart", entityId: cartId,
      summary: `Atendimento cancelado — ${formatMoney(cart.total)} (${(cart.items ?? []).length} itens)${cart.status === "parked" ? " (pré-venda descartada)" : ""}${approver ? ` · autorizado por ${approver.name}` : ""}`,
      reason: reason ?? null, branchId: cart.branchId,
      after: { total: cart.total ?? 0, itemsCount: (cart.items ?? []).length, operatorId: ctx.user.id, operatorName: ctx.user.name, approvedById: approver?.id ?? null, approvedByName: approver?.name ?? null },
      related: [cart.terminalId ? `terminal:${cart.terminalId}` : "", session ? `cash_session:${session.id}` : "", approver ? `user:${approver.id}` : ""].filter(Boolean),
    });
  }
  return updated;
}

// ───────────────────────────── §44 — remoção de item e cancelamento com permissão/autorização

/** Política do PDV para remover item já registrado e cancelar atendimento (parâmetros por empresa/filial). */
export async function pdvAuthPolicy(ctx: Pick<Ctx, "store" | "companyId">, branchId: string | null) {
  const [remove, cancel, grace] = await Promise.all([
    getSetting(ctx.store, ctx.companyId, branchId, "pdv.removeItemRequiresAuth", true),
    getSetting(ctx.store, ctx.companyId, branchId, "pdv.cancelCartRequiresAuth", true),
    getSetting(ctx.store, ctx.companyId, branchId, "pdv.removeItemGraceSeconds", 0),
  ]);
  return { removeRequiresAuth: remove !== false, cancelRequiresAuth: cancel !== false, graceSeconds: Math.max(0, Math.round(Number(grace) || 0)) };
}

/** Sessão de caixa aberta do terminal (liga remoções/cancelamentos ao relatório do caixa). */
async function terminalSession(ctx: Ctx, terminalId: string | null | undefined) {
  if (!terminalId) return null;
  const { currentSession } = await import("./cash");
  return currentSession(ctx, terminalId).catch(() => null);
}

export interface RemoveCartItemInput {
  /** posição da linha no atendimento (conferida com o SKU) */
  index: number;
  skuId: string;
  /** nova quantidade da linha (milésimos); ausente ou 0 = remove a linha */
  qty?: number | null;
  reason?: string | null;
  approval?: SupervisorCredentials | null;
}

export interface RemovedItemRecord {
  at: string;
  skuId: string;
  sku: string | null;
  name: string | null;
  qty: number;
  remainingQty: number;
  value: number;
  byId: string;
  byName: string;
  approvedById: string | null;
  approvedByName: string | null;
  reason: string | null;
  graceException: boolean;
}

/**
 * Remove (ou diminui a quantidade de) um item já registrado no atendimento. Com o parâmetro
 * `pdv.removeItemRequiresAuth` ligado (padrão), exige a operação `pdv.remove_item` ou login/senha de um supervisor que a
 * tenha (mesmo mecanismo do desconto acima do limite); item cuja última inclusão foi há até `pdv.removeItemGraceSeconds`
 * segundos é liberado. Toda remoção é registrada no atendimento e na auditoria (produto, quantidade, valor, quem,
 * quem autorizou, motivo), ligada à sessão de caixa do terminal.
 */
export async function removeCartItem(ctx: Ctx, cartId: string, input: RemoveCartItemInput) {
  requirePerm(ctx, "pdv", "create");
  const cart = await ctx.store.getOrThrow("carts", cartId);
  assertCartAccess(ctx, cart);
  if (cart.status === "converted") throw new BusinessError("Este atendimento já virou venda. Inicie um novo atendimento.", "cart_converted", { saleId: cart.saleId });
  assert(cart.status === "open", cart.status === "cancelled" ? "Atendimento cancelado." : "Atendimento salvo como pré-venda: retome-o antes de editar.", "cart_not_open");
  const items = (cart.items ?? []) as CartItem[];
  let idx = Number.isInteger(input.index) ? input.index : -1;
  if (items[idx]?.skuId !== input.skuId) idx = items.findIndex((i) => i.skuId === input.skuId);
  assert(idx >= 0, "Item não encontrado no atendimento (ele pode ter sido alterado em outra aba). Atualize a tela.", "item_not_found");
  const line = items[idx];
  const newQty = Math.max(0, Math.round(input.qty ?? 0));
  assert(newQty < line.qty, "Informe uma quantidade menor que a atual para remover.");
  const removedQty = line.qty - newQty;
  const policy = await pdvAuthPolicy(ctx, cart.branchId);
  const lastAdded = ((cart.lastAddedAt ?? {}) as Record<string, string>)[line.skuId];
  const graceException = policy.graceSeconds > 0 && Boolean(lastAdded) && Date.now() - Date.parse(lastAdded) <= policy.graceSeconds * 1000;
  let approver: CtxUser | null = null;
  if (policy.removeRequiresAuth && !canDo(ctx.user, "pdv.remove_item") && !graceException) {
    if (!input.approval?.login) throw new BusinessError("Remover item já registrado exige autorização do supervisor: informe login e senha de quem tem a permissão “Remover item já registrado”.", "approval_required");
    approver = await verifySupervisor(ctx, input.approval, "pdv.remove_item", `remoção de ${line.name ?? line.sku ?? "item"} do atendimento`);
  }
  // valor removido: proporcional ao total da linha (preço efetivo, descontos e acréscimos do item; sem promoções)
  const lineTotal = cartTotals({ ...cart, items }, null).items[idx]?.total ?? 0;
  const value = roundDiv(lineTotal * removedQty, line.qty);
  const reason = input.reason?.trim().slice(0, 300) || null;
  const record: RemovedItemRecord = {
    at: nowIso(), skuId: line.skuId, sku: line.sku ?? null, name: line.name ?? null, qty: removedQty, remainingQty: newQty, value,
    byId: ctx.user.id, byName: ctx.user.name, approvedById: approver?.id ?? null, approvedByName: approver?.name ?? null, reason, graceException,
  };
  const nextItems = newQty ? items.map((l, i) => (i === idx ? { ...l, qty: newQty, scale: null } : l)) : items.filter((_, i) => i !== idx);
  const merged = { ...cart, items: nextItems };
  const rules = merged.salesDocumentId ? [] : await livePromotionRules(ctx.store, ctx.companyId, cart.branchId);
  const totals = cartTotals(merged, rules.length ? { rules, tz: DEFAULT_TZ, branchId: cart.branchId } : null);
  const updated = await ctx.store.update("carts", cartId, {
    items: nextItems, revision: (cart.revision ?? 0) + 1, total: totals.total, itemsCount: nextItems.length,
    removedItems: [...((cart.removedItems ?? []) as RemovedItemRecord[]), record].slice(-200),
  });
  const session = await terminalSession(ctx, cart.terminalId);
  await audit(ctx, {
    module: "pdv", action: "cart.item_remove", entityType: "cart", entityId: cartId, branchId: cart.branchId,
    summary: `Item removido do atendimento: ${line.name ?? line.sku ?? line.skuId}${line.sku ? ` (${line.sku})` : ""} — ${formatQty(removedQty, line.unitCode)} · ${formatMoney(value)}${newQty ? ` (restam ${formatQty(newQty, line.unitCode)})` : ""}${approver ? ` · autorizado por ${approver.name}` : graceException ? " · recém-lançado (sem autorização)" : ""}`,
    reason, after: record,
    related: [cart.terminalId ? `terminal:${cart.terminalId}` : "", session ? `cash_session:${session.id}` : "", approver ? `user:${approver.id}` : ""].filter(Boolean),
  });
  return { cart: updated, record };
}

export interface PdvControlsByOperator {
  operatorName: string;
  removed: number;
  removedValue: number;
  cancelled: number;
  cancelledValue: number;
  authorized: number;
}

/**
 * Remoções de item e cancelamentos de atendimento ligados à sessão de caixa (relatório do caixa), com a contagem por
 * operador. Fonte: auditoria (`cart.item_remove`, `cart.cancel`) com a referência da sessão.
 */
export async function sessionPdvControls(ctx: Ctx, sessionId: string) {
  const rows = await listAll(ctx.store, "audit_logs", { filters: [["contains", "related", `cash_session:${sessionId}`], ["eq", "action", ["cart.item_remove", "cart.cancel"]]], orderBy: [{ field: "occurredAt", dir: "asc" }] }, 2000);
  const byOperator = new Map<string, PdvControlsByOperator>();
  const out = { removed: 0, removedValue: 0, cancelled: 0, cancelledValue: 0, authorized: 0, byOperator: [] as PdvControlsByOperator[], events: [] as Array<{ id: string; at: string; action: string; summary: string; userName: string; reason: string | null }> };
  for (const r of rows) {
    const key = r.userId ?? r.userName ?? "?";
    const op = byOperator.get(key) ?? { operatorName: r.userName ?? "—", removed: 0, removedValue: 0, cancelled: 0, cancelledValue: 0, authorized: 0 };
    if (r.action === "cart.item_remove") {
      op.removed += 1;
      op.removedValue += Number(r.after?.value ?? 0);
      out.removed += 1;
      out.removedValue += Number(r.after?.value ?? 0);
    } else {
      op.cancelled += 1;
      op.cancelledValue += Number(r.after?.total ?? 0);
      out.cancelled += 1;
      out.cancelledValue += Number(r.after?.total ?? 0);
    }
    if (r.after?.approvedById) {
      op.authorized += 1;
      out.authorized += 1;
    }
    byOperator.set(key, op);
    out.events.push({ id: r.id, at: r.occurredAt, action: r.action, summary: r.summary, userName: r.userName ?? "—", reason: r.reason ?? null });
  }
  out.byOperator = [...byOperator.values()].sort((a, b) => a.operatorName.localeCompare(b.operatorName, "pt-BR"));
  return out;
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
    items: (cart.items ?? []).map((i: CartItem) => ({ skuId: i.skuId, qty: i.qty, itemDiscount: i.itemDiscount ?? 0, itemSurcharge: i.itemSurcharge ?? 0, unitPrice: i.unitPrice ?? undefined, ...(i.lot ? { lot: i.lot } : {}) })),
    globalDiscount: cart.globalDiscountBps ? undefined : (cart.globalDiscount ?? 0),
    globalDiscountBps: cart.globalDiscountBps || undefined,
    surcharge: cart.surcharge ?? 0,
    payments,
    notes: cart.notes ?? null,
    exchangeReturnId: cart.exchangeReturnId ?? null,
    emitFiscal: cart.emitFiscal !== false,
    ...(cart.salesDocumentId ? { salesDocumentId: cart.salesDocumentId } : {}),
  };
}
