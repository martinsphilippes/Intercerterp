"use server";

import { runAction } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { searchLabelSkus } from "@/domain/labels";

/** Busca de produtos para a fila de etiquetas (texto e/ou categoria). */
export async function searchLabelSkusAction(input: { q: string; categoryId: string | null }) {
  return runAction({ module: "products" }, async (s) => {
    await requireFeature(s, "etiquetas");
    return searchLabelSkus(s.ctx, { q: input.q, categoryId: input.categoryId || null });
  });
}
