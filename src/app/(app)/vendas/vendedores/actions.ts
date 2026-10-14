"use server";

import { runAction, fopt, fstr } from "@/lib/server/action";
import { createSeller, setSellerActive, updateSeller, type SellerInput } from "@/domain/sellers";

/** Percentual digitado (ex.: "2,5" ou "2.5") → bps; vazio = sem percentual. */
function pctToBps(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function parse(fd: FormData): SellerInput {
  const byCat: Record<string, number> = {};
  const cats = fd.getAll("catId").map(String);
  const pcts = fd.getAll("catPct").map(String);
  cats.forEach((c, i) => {
    const bps = pctToBps(pcts[i] ?? "");
    if (c && bps != null) byCat[c] = bps;
  });
  return { name: fstr(fd, "name"), email: fopt(fd, "email"), phone: fopt(fd, "phone"), commissionBps: pctToBps(fopt(fd, "commissionPct")), commissionByCategory: byCat };
}

export async function saveSellerAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "sales", op: id ? "edit" : "create", revalidate: ["/vendas/vendedores", "/pdv"] }, async (s) => {
    const input = parse(fd);
    const doc = id ? await updateSeller(s.ctx, id, input) : await createSeller(s.ctx, { ...input, idemKey: fstr(fd, "_idem") || undefined });
    return { ok: true as const, data: { id: doc.id }, message: id ? "Vendedor atualizado." : "Vendedor cadastrado (sem acesso ao sistema).", redirect: "/vendas/vendedores" };
  });
}

export async function setSellerActiveAction(id: string, active: boolean, _fd: FormData) {
  return runAction({ module: "sales", op: "edit", revalidate: ["/vendas/vendedores", "/pdv"] }, async (s) => {
    await setSellerActive(s.ctx, id, active);
    return { ok: true as const, message: active ? "Vendedor reativado." : "Vendedor inativado." };
  });
}
