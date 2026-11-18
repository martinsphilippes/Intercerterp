import crypto from "node:crypto";
import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError } from "@/lib/core/errors";
import { systemCtx, type Ctx } from "@/lib/core/ctx";
import { nowIso } from "@/lib/dates";
import { nextNumber } from "@/lib/core/numbering";

/**
 * Comércio digital (Telas 49–64, docs/regras-assumidas.md §49) — tipos, rótulos e registros comuns.
 *
 * Princípios do desenho (guia de 64 telas, p. 123–124):
 *  - produto, SKU e estoque são os do ERP (nada é duplicado na loja);
 *  - o pedido conserva a MESMA referência no pagamento, na nota, na entrega e no financeiro;
 *  - pagamento aprovado, crédito no banco e entrega concluída são estados distintos;
 *  - evento repetido (do gateway, da logística, do fiscal) nunca duplica reserva, baixa, cobrança ou etiqueta;
 *  - a loja de cada empresa enxerga só os dados da própria empresa (Store restrito à empresa em toda leitura pública).
 */

export type StoreStatus = "draft" | "published" | "paused";
export type DeliveryMode = "pickup" | "own" | "third_party" | "carrier";
export type PayMethod = "pix" | "card" | "boleto";
export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "invoiced"
  | "ready_for_pickup"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "return_requested"
  | "returned";
export type PaymentStatus = "pending" | "authorized" | "paid" | "failed" | "expired" | "cancelled" | "refund_pending" | "refunded";

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = { draft: "Rascunho", published: "Publicada", paused: "Pausada" };
export const DELIVERY_LABEL: Record<DeliveryMode, string> = { pickup: "Retirada na loja", own: "Entrega própria", third_party: "Entrega por terceiros", carrier: "Transportadora" };
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { pix: "Pix", card: "Cartão de crédito", boleto: "Boleto" };
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pago — a faturar",
  invoiced: "Nota emitida — a preparar",
  ready_for_pickup: "Pronto para retirada",
  shipped: "Despachado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  return_requested: "Devolução solicitada",
  returned: "Devolvido",
};
export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "info" | "good" | "warn" | "bad" | "brand"> = {
  pending_payment: "warn",
  paid: "info",
  invoiced: "brand",
  ready_for_pickup: "brand",
  shipped: "info",
  delivered: "good",
  cancelled: "neutral",
  return_requested: "warn",
  returned: "neutral",
};
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Aguardando",
  authorized: "Autorizado",
  paid: "Pago",
  failed: "Recusado",
  expired: "Expirado",
  cancelled: "Cancelado",
  refund_pending: "Estorno pendente",
  refunded: "Estornado",
};

/** Pedido encerrado: nada mais acontece com ele (além de consulta). */
export const ORDER_CLOSED: OrderStatus[] = ["cancelled", "returned"];
/** Pedido que ainda reserva estoque (não saiu da loja). */
export const ORDER_RESERVING: OrderStatus[] = ["pending_payment", "paid", "invoiced", "ready_for_pickup"];

/** Prazo legal de arrependimento da compra fora do estabelecimento (CDC art. 49). */
export const WITHDRAWAL_DAYS = 7;

/** Token aleatório de 128 bits em hexadecimal (carrinho, acompanhamento do pedido, prévia). */
export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");

/** Texto → endereço amigável ("Camiseta Básica P" → "camiseta-basica-p"). */
export function slugify(v: string): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Loja da empresa (uma por empresa) — ou null se ainda não criada. */
export async function storeOfCompany(store: Store, companyId: string): Promise<Doc | null> {
  const rows = await listAll(unscoped(store), "stores", { filters: [["eq", "companyId", companyId]] });
  return rows[0] ?? null;
}

export async function requireStore(ctx: Ctx): Promise<Doc> {
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  if (!st) throw new BusinessError("A loja virtual desta empresa ainda não foi criada. Abra Comércio digital › Central e crie a loja.", "store_missing");
  return st;
}

/** Contexto técnico da loja (pedidos públicos, eventos do gateway): Store restrito à empresa da loja. */
export function storeCtx(store: Store, st: Doc, branchId?: string | null): Ctx {
  const ctx = systemCtx(store, st.companyId, branchId ?? st.fulfillmentBranchId ?? null);
  return { ...ctx, user: { ...ctx.user, name: "Loja virtual" } };
}

/** Registro na linha do tempo do pedido. */
export async function orderEvent(ctx: Ctx, order: Doc, kind: string, summary: string, data?: Record<string, unknown> | null, actor?: string) {
  await ctx.store.create("online_order_events", {
    companyId: order.companyId,
    branchId: order.branchId ?? null,
    createdBy: ctx.user.id,
    orderId: order.id,
    kind,
    summary: summary.slice(0, 500),
    actor: (actor ?? ctx.user.name ?? "Sistema").slice(0, 120),
    data: data ?? null,
    at: nowIso(),
  });
}

export type CommerceArea = "catalog" | "payment" | "fiscal" | "stock" | "shipping" | "bank" | "domain" | "channel" | "checkout";
export type CommerceEventStatus = "ok" | "failed" | "ignored" | "pending";

export const AREA_LABEL: Record<CommerceArea, string> = {
  catalog: "Catálogo",
  payment: "Pagamento",
  fiscal: "Fiscal",
  stock: "Estoque",
  shipping: "Entrega",
  bank: "Banco",
  domain: "Domínio",
  channel: "Canais",
  checkout: "Checkout",
};

/**
 * Monitor das integrações (Tela 60): um registro por evento. Com `externalKey`, o mesmo evento externo é um único
 * registro — a repetição incrementa as tentativas e devolve `duplicate: true` (quem chamou não repete o efeito).
 */
export async function commerceEvent(
  store: Store,
  input: {
    companyId: string;
    storeId?: string | null;
    area: CommerceArea;
    action: string;
    status: CommerceEventStatus;
    reference?: string | null;
    orderId?: string | null;
    externalKey?: string | null;
    diagnostic?: string | null;
    payload?: unknown;
    /** cadastro de origem a corrigir antes de reprocessar (ex.: "product:<id>", "order:<id>") */
    subject?: string | null;
  },
): Promise<{ event: Doc; duplicate: boolean }> {
  const base = unscoped(store);
  const id = input.externalKey ? detId("cevent", input.externalKey) : undefined;
  if (id) {
    // repetição do mesmo evento externo: não consome número nem reaplica efeito
    const cur = await base.get("commerce_events", id);
    if (cur) {
      const next = await base.update("commerce_events", id, { attempts: (cur.attempts ?? 1) + 1, lastAttemptAt: nowIso() });
      return { event: next, duplicate: true };
    }
  }
  const data = {
    number: await nextNumber(base, `commerce_event:${input.companyId}`),
    subject: input.subject ?? null,
    companyId: input.companyId,
    branchId: null,
    storeId: input.storeId ?? null,
    area: input.area,
    action: input.action,
    status: input.status,
    reference: input.reference?.slice(0, 120) ?? null,
    orderId: input.orderId ?? null,
    externalKey: input.externalKey ?? null,
    attempts: 1,
    diagnostic: input.diagnostic ?? null,
    payload: sanitizePayload(input.payload),
    lastAttemptAt: nowIso(),
    resolvedAt: input.status === "ok" ? nowIso() : null,
  };
  try {
    return { event: await base.create("commerce_events", data, id), duplicate: false };
  } catch (e) {
    if (!id || !isConflict(e)) throw e;
    const cur = await base.get("commerce_events", id);
    if (!cur) throw e;
    const next = await base.update("commerce_events", id, { attempts: (cur.attempts ?? 1) + 1, lastAttemptAt: nowIso() });
    return { event: next, duplicate: true };
  }
}

/** Atualiza a situação de um evento do monitor (reprocessamento, correção). */
export async function settleCommerceEvent(store: Store, id: string, status: CommerceEventStatus, diagnostic?: string | null) {
  const base = unscoped(store);
  const cur = await base.get("commerce_events", id);
  if (!cur) return null;
  return base.update("commerce_events", id, {
    status,
    diagnostic: diagnostic === undefined ? cur.diagnostic : diagnostic,
    attempts: (cur.attempts ?? 1) + 1,
    lastAttemptAt: nowIso(),
    resolvedAt: status === "ok" || status === "ignored" ? nowIso() : null,
  });
}

/** Nada de dado sensível no monitor: corta textos longos e remove chaves de credencial/cartão. */
export function sanitizePayload(v: unknown, depth = 0): unknown {
  if (v == null || depth > 4) return v ?? null;
  if (typeof v === "string") return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanitizePayload(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/token|secret|password|senha|card(number)?|cvv|cvc|pan|authorization/i.test(k)) {
        out[k] = "[omitido]";
        continue;
      }
      out[k] = sanitizePayload(x, depth + 1);
    }
    return out;
  }
  return v;
}

/** Código do evento no monitor ("EV-006"). */
export const eventCode = (n: number | null | undefined) => `EV-${String(n ?? 0).padStart(3, "0")}`;

/** Código do pedido exibido ao cliente e na gestão ("PED-1048"). */
export const orderCode = (prefix: string | null | undefined, number: number) => `${(prefix || "PED").toUpperCase()}-${number}`;

/** Contexto do Store restrito à empresa da loja — atalho para leituras públicas. */
export function publicCtx(store: Store, st: Doc): Ctx {
  return storeCtx(store, st);
}
