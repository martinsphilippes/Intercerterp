"use server";

import { runAction } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { applyPriceChanges, describeRule, previewPriceRule, type PriceEnding, type PriceRule, type RoundingMode } from "@/domain/price-adjust";
import { applyFieldChange, previewFieldChange, type BulkField } from "@/domain/product-bulk";

const PATHS = ["/produtos", "/produtos/alteracao-em-massa"];

export async function previewBulkPriceAction(input: { skuIds: string[]; priceTableId: string; rule: PriceRule; ending: PriceEnding; rounding: RoundingMode }) {
  return runAction({ module: "products" }, async (s) => {
    await requireFeature(s, "alteracaoMassa");
    return previewPriceRule(s.ctx, { via: "products.bulk_edit", ...input });
  });
}

export async function applyBulkPriceAction(input: { priceTableId: string; rule: PriceRule; ending: PriceEnding; lines: Array<{ skuId: string; newPrice: number; expectedPrice: number | null }>; idemKey: string; note?: string | null }) {
  return runAction({ module: "products", op: "edit", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "alteracaoMassa");
    const reason = `Alteração em massa — ${describeRule(input.rule, input.ending)}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`.slice(0, 300);
    const r = await applyPriceChanges(s.ctx, { via: "products.bulk_edit", priceTableId: input.priceTableId, lines: input.lines, reason, idemKey: input.idemKey });
    const msg = r.replayed ? "Esta alteração já tinha sido aplicada (nada foi gravado de novo)." : `${r.applied} preço(s) atualizado(s)${r.skipped ? `, ${r.skipped} ignorado(s)` : ""}${r.errors ? `, ${r.errors} com erro` : ""}.`;
    return { ok: true as const, data: r, message: msg };
  });
}

export async function previewBulkFieldAction(input: { productIds: string[]; field: BulkField; value: string | boolean | null }) {
  return runAction({ module: "products" }, async (s) => {
    await requireFeature(s, "alteracaoMassa");
    return previewFieldChange(s.ctx, input);
  });
}

export async function applyBulkFieldAction(input: { productIds: string[]; field: BulkField; value: string | boolean | null; idemKey: string; note?: string | null }) {
  return runAction({ module: "products", op: "edit", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "alteracaoMassa");
    const r = await applyFieldChange(s.ctx, input);
    const msg = r.replayed ? "Esta alteração já tinha sido aplicada (nada foi gravado de novo)." : `${r.applied} produto(s) alterado(s)${r.skipped ? `, ${r.skipped} ignorado(s)` : ""}${r.errors ? `, ${r.errors} com erro` : ""}.`;
    return { ok: true as const, data: r, message: msg };
  });
}
