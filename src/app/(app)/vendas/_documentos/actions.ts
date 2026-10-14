"use server";

import { headers } from "next/headers";
import { runAction, fjson, fopt, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { listAll } from "@/lib/db";
import { searchable } from "@/lib/core/text";
import { resolvePrices } from "@/domain/pricing";
import { availableMap } from "@/domain/stock";
import { kitAvailability } from "@/domain/product-components";
import {
  approveQuote, cancelOrder, convertQuoteToOrder, createSalesDocument, docLabel, docPath, duplicateSalesDocument, markQuoteSent, rejectQuote, renewReservation, sendDocumentEmail,
  updateSalesDocument, whatsappText, type SalesDocInput, type SalesDocType,
} from "@/domain/sales-documents";

const R = ["/vendas/orcamentos", "/vendas/pedidos"];

/** Endereço público da aplicação (link do documento enviado ao cliente). */
async function requestOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

function parseInput(fd: FormData): SalesDocInput {
  const p = fjson<Record<string, any>>(fd, "payload", {});
  return {
    customerId: p.customerId || null,
    contactName: p.contactName || null,
    contactPhone: p.contactPhone || null,
    sellerId: p.sellerId || null,
    priceTableId: p.priceTableId || null,
    items: Array.isArray(p.items) ? p.items.map((i: any) => ({ skuId: String(i.skuId), qty: Number(i.qty) || 0, unitPrice: i.unitPrice == null || i.unitPrice === "" ? null : Number(i.unitPrice), itemDiscount: Number(i.itemDiscount) || 0, itemSurcharge: Number(i.itemSurcharge) || 0, description: i.description ?? null })) : [],
    globalDiscount: Number(p.globalDiscount) || 0,
    globalDiscountBps: Number(p.globalDiscountBps) || 0,
    surcharge: Number(p.surcharge) || 0,
    validUntil: p.validUntil || null,
    deliveryDate: p.deliveryDate || null,
    paymentTermId: p.paymentTermId || null,
    paymentNotes: p.paymentNotes || null,
    notes: p.notes || null,
    internalNotes: p.internalNotes || null,
    discountApproval: p.approvalLogin ? { login: String(p.approvalLogin), password: String(p.approvalPassword ?? "") } : null,
  };
}

export async function saveDocumentAction(fd: FormData) {
  const id = fopt(fd, "id");
  const type = (fstr(fd, "type") === "order" ? "order" : "quote") as SalesDocType;
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    await requireFeature(s, "documentoComercial");
    const input = parseInput(fd);
    const doc = id ? await updateSalesDocument(s.ctx, id, input, fopt(fd, "reason")) : await createSalesDocument(s.ctx, type, input, { idemKey: `ui:${fstr(fd, "_idem")}` });
    return { ok: true as const, message: `${docLabel(doc)} ${id ? "alterado" : "criado"}.`, redirect: docPath(doc), data: { id: doc.id } };
  });
}

export async function approveQuoteAction(id: string) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const d = await approveQuote(s.ctx, id);
    return { ok: true as const, message: `${docLabel(d)} aprovado.` };
  });
}

export async function rejectQuoteAction(id: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const d = await rejectQuote(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: `${docLabel(d)} marcado como recusado.` };
  });
}

export async function convertToOrderAction(id: string) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const o = await convertQuoteToOrder(s.ctx, id);
    const short = (o.reservationShortage ?? []).length;
    return { ok: true as const, message: `Pedido nº ${o.number} gerado a partir do orçamento${short ? ` — ${short} produto(s) sem saldo para reservar` : ""}.`, redirect: docPath(o) };
  });
}

export async function duplicateDocumentAction(id: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const d = await duplicateSalesDocument(s.ctx, id, fstr(fd, "_idem") || `${id}:${Date.now()}`);
    return { ok: true as const, message: `${docLabel(d)} criado como cópia (rascunho).`, redirect: docPath(d) };
  });
}

export async function cancelOrderAction(id: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const d = await cancelOrder(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: `${docLabel(d)} cancelado; reserva de estoque liberada.` };
  });
}

export async function renewReservationAction(id: string) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const d = await renewReservation(s.ctx, id);
    const short = (d.reservationShortage ?? []).length;
    return { ok: true as const, message: short ? `Reserva renovada parcialmente: ${short} produto(s) sem saldo disponível.` : "Reserva de estoque renovada." };
  });
}

/** Monta o texto/link do WhatsApp e registra o envio (o operador conclui o envio no próprio WhatsApp). */
export async function whatsappSendAction(id: string, phone: string | null) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const doc = await s.ctx.store.getOrThrow("sales_documents", id);
    const company = await s.ctx.store.get("companies", s.ctx.companyId);
    const link = doc.shareToken ? `${await requestOrigin()}/documento/${doc.shareToken}` : null;
    const text = whatsappText(doc, company, link);
    await markQuoteSent(s.ctx, id, "whatsapp");
    const { whatsappUrl } = await import("@/lib/whatsapp");
    const url = whatsappUrl(phone ?? doc.customerSnapshot?.phone ?? null, text) ?? `https://wa.me/?text=${encodeURIComponent(text)}`;
    return { ok: true as const, message: "Envio registrado. Conclua a mensagem no WhatsApp.", data: { url } };
  });
}

export async function emailSendAction(id: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    const doc = await s.ctx.store.getOrThrow("sales_documents", id);
    const link = doc.shareToken ? `${await requestOrigin()}/documento/${doc.shareToken}` : null;
    await sendDocumentEmail(s.ctx, id, fstr(fd, "to"), link);
    return { ok: true as const, message: `${docLabel(doc)} enviado por e-mail.` };
  });
}

export async function markPrintedAction(id: string) {
  return runAction({ module: "sales", requireBranch: true, revalidate: R }, async (s) => {
    await markQuoteSent(s.ctx, id, "print");
    return { ok: true as const, message: "Entrega impressa registrada." };
  });
}

export interface DocSkuHit {
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  price: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  maxDiscountBps: number | null;
  available: number | null;
  service: boolean;
}

/** Pesquisa de produtos com o preço vigente da tabela (mesma resolução do PDV) e o disponível na filial. */
export async function searchDocSkusAction(q: string, priceTableId: string | null) {
  return runAction({ module: "sales" }, async (s) => {
    const term = (q ?? "").trim();
    if (term.length < 2) return [] as DocSkuHit[];
    const store = s.ctx.store;
    const res = await store.list("skus", { filters: [["eq", "companyId", s.ctx.companyId], ["or", [["contains", "searchText", searchable(term)], ["eq", "barcode", term], ["eq", "sku", term.toUpperCase()]]]], limit: 20 });
    const skus = res.items.filter((k) => k.active !== false);
    if (!skus.length) return [] as DocSkuHit[];
    const products = new Map((await listAll(store, "products", { filters: [["eq", "id", [...new Set(skus.map((k) => k.productId))]]] })).map((p) => [p.id, p]));
    const usable = skus.filter((k) => {
      const p = products.get(k.productId);
      return p && p.active !== false && p.status !== "inactive" && p.status !== "draft" && (p.availablePdv !== false || p.type === "service");
    });
    const branch = s.ctx.branchId ? await store.get("branches", s.ctx.branchId) : null;
    const prices = await resolvePrices(store, { companyId: s.ctx.companyId, branchId: s.ctx.branchId, priceTableId: priceTableId || branch?.defaultPriceTableId || null, items: usable.map((k) => ({ skuId: k.id, qty: 1000 })) });
    const priceRows = await listAll(store, "prices", { filters: [["eq", "id", prices.map((p) => p.priceId).filter(Boolean) as string[]]] });
    const avail = s.ctx.branchId ? await availableMap(store, s.ctx.branchId, usable.map((k) => k.id)) : new Map();
    // kit (CAD-12): disponível pelos componentes
    const kitAvail = s.ctx.branchId ? await kitAvailability(store, s.ctx.branchId, usable.map((k) => ({ id: k.id, productId: k.productId })), products) : new Map<string, number>();
    return usable.map((k, i): DocSkuHit => {
      const pr = priceRows.find((x) => x.id === prices[i].priceId);
      const p = products.get(k.productId)!;
      return { skuId: k.id, sku: k.sku, name: k.name ?? p.name, unitCode: k.unitCode ?? p.unitCode ?? "UN", price: prices[i].price, wholesalePrice: pr?.wholesalePrice ?? null, wholesaleMinQty: pr?.wholesaleMinQty ?? null, maxDiscountBps: prices[i].maxDiscountBps, available: p.type === "service" ? null : (kitAvail.get(k.id) ?? avail.get(k.id)?.available ?? (s.ctx.branchId ? 0 : null)), service: p.type === "service" };
    });
  });
}
