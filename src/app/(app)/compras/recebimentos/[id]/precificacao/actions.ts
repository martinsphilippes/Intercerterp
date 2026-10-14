"use server";

import { runAction } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { applyReceiptPricing, previewReceiptPricing, receiptPricing, type PricingMode } from "@/domain/receipt-pricing";
import type { PriceEnding } from "@/domain/price-adjust";

/** Recalcula as sugestões com outra regra (nada é gravado). */
export async function suggestReceiptPricingAction(receiptId: string, opts: { mode: PricingMode; targetMarginBps: number; ending: PriceEnding; priceTableId: string }) {
  return runAction({ module: "purchases" }, async (s) => {
    await requireFeature(s, "precificacaoEntrada");
    const d = await receiptPricing(s.ctx, receiptId, opts);
    return { lines: d.lines, totals: d.totals, settings: d.settings, table: d.table };
  });
}

/** Prévia dos preços escolhidos (validações iguais às da gravação). */
export async function previewReceiptPricingAction(receiptId: string, input: { priceTableId: string; lines: Array<{ skuId: string; newPrice: number | null }> }) {
  return runAction({ module: "purchases" }, async (s) => {
    await requireFeature(s, "precificacaoEntrada");
    return previewReceiptPricing(s.ctx, receiptId, input);
  });
}

export async function applyReceiptPricingAction(receiptId: string, input: { priceTableId: string; lines: Array<{ skuId: string; newPrice: number; expectedPrice: number | null }>; idemKey: string; note?: string | null }) {
  return runAction({ module: "purchases", revalidate: [`/compras/recebimentos/${receiptId}`, `/compras/recebimentos/${receiptId}/precificacao`, "/compras/precificacao", "/produtos"] }, async (s) => {
    await requireFeature(s, "precificacaoEntrada");
    const r = await applyReceiptPricing(s.ctx, receiptId, input);
    const msg = r.replayed ? "Esta precificação já tinha sido aplicada (nada foi gravado de novo)." : `${r.applied} preço(s) atualizado(s)${r.skipped ? `, ${r.skipped} ignorado(s)` : ""}${r.errors ? `, ${r.errors} com erro` : ""}.`;
    return { ok: true as const, data: r, message: msg };
  });
}
