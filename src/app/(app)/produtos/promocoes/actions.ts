"use server";

import { runAction, fbool, fopt, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { QTY } from "@/lib/money";
import { savePromotion, setPromotionActive, type PromotionInput } from "@/domain/promotions";
import type { PromoKind, PromoScope } from "@/domain/promotions-calc";

/** Número digitado ("3" ou "2,5") → milésimos; vazio = null. */
function qtyOf(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * QTY) : NaN;
}

function parse(fd: FormData): PromotionInput {
  const kind = fstr(fd, "kind") as PromoKind;
  const discountMode = fstr(fd, "discountMode");
  const price = fopt(fd, "promoPrice");
  const pct = fopt(fd, "percent");
  return {
    name: fstr(fd, "name"),
    kind,
    scope: fstr(fd, "scope") as PromoScope,
    targetIds: fd.getAll("targetIds").map(String).filter(Boolean),
    buyQty: kind === "buy_x_pay_y" ? qtyOf(fopt(fd, "buyQty")) : null,
    payQty: kind === "buy_x_pay_y" ? qtyOf(fopt(fd, "payQty")) : null,
    minQty: kind === "min_qty" ? qtyOf(fopt(fd, "minQty")) : null,
    promoPrice: kind === "min_qty" && discountMode === "price" && price ? Math.round(Number(price)) : null,
    percentBps: kind === "min_qty" && discountMode === "percent" && pct ? Math.round(Number(pct.replace(",", ".")) * 100) : null,
    validFrom: fopt(fd, "validFrom"),
    validTo: fopt(fd, "validTo"),
    weekdays: fd.getAll("weekdays").map((d) => Number(d)).filter((d) => Number.isInteger(d)),
    startTime: fopt(fd, "startTime"),
    endTime: fopt(fd, "endTime"),
    branchId: fopt(fd, "branchId"),
    active: fbool(fd, "active"),
    notes: fopt(fd, "notes"),
  };
}

export async function savePromotionAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "products", op: id ? "edit" : "create", revalidate: ["/produtos/promocoes", "/pdv"] }, async (s) => {
    await requireFeature(s, "promocoes");
    const doc = await savePromotion(s.ctx, { ...parse(fd), id, idemKey: fstr(fd, "_idem") || null });
    return { ok: true as const, data: { id: doc.id }, message: id ? "Promoção atualizada." : "Promoção cadastrada.", redirect: "/produtos/promocoes" };
  });
}

export async function setPromotionActiveAction(id: string, active: boolean, _fd: FormData) {
  return runAction({ module: "products", op: "edit", revalidate: ["/produtos/promocoes", "/pdv"] }, async (s) => {
    await requireFeature(s, "promocoes");
    await setPromotionActive(s.ctx, id, active);
    return { ok: true as const, message: active ? "Promoção ativada." : "Promoção inativada." };
  });
}
