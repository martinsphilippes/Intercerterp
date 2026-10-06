"use server";

import { runAction, fstr, fint, fjson } from "@/lib/server/action";
import { createDraftsFromReplenishment, computeBranchReplenishment, type DraftLine } from "@/domain/replenishment";
import { createQuotation } from "@/domain/quotations";
import { addDays, today } from "@/lib/dates";
import { listAll } from "@/lib/db";
import { supplierLabel } from "@/domain/suppliers";
import type { SessionInfo } from "@/lib/server/session";
import { BusinessError } from "@/lib/core/errors";

/** Contexto da filial escolhida no planejamento (precisa ser uma filial acessível ao usuário). */
function branchCtx(s: SessionInfo, branchId: string) {
  if (!branchId) throw new BusinessError("Selecione a filial de destino.");
  if (!s.branches.some((b) => b.id === branchId)) throw new BusinessError("Filial não acessível ao seu usuário.");
  return { ...s.ctx, branchId };
}

export async function createDraftsAction(fd: FormData) {
  return runAction({ module: "purchases", op: "create", revalidate: ["/compras/reposicao", "/compras/pedidos"] }, async (s) => {
    const ctx = branchCtx(s, fstr(fd, "branchId"));
    const lines: DraftLine[] = fjson(fd, "lines", []);
    const orders = await createDraftsFromReplenishment(ctx, lines, { idemKey: fstr(fd, "_idem"), coverageDays: fint(fd, "coverageDays") || undefined });
    return { ok: true as const, message: `${orders.length} pedido(s) em rascunho criado(s): ${orders.map((o) => `nº ${o.number}`).join(", ")}. Revise e envie para análise.`, data: { orderIds: orders.map((o) => o.id) }, redirect: orders.length === 1 ? `/compras/pedidos/${orders[0].id}` : `/compras/pedidos?origin=replenishment&status=drafting` };
  });
}

/** Cria cotação com os itens selecionados e todos os fornecedores vinculados a eles. */
export async function quotationFromReplenishmentAction(fd: FormData) {
  return runAction({ module: "purchases", op: "create", revalidate: ["/compras/cotacoes"] }, async (s) => {
    const ctx = branchCtx(s, fstr(fd, "branchId"));
    const lines: DraftLine[] = fjson(fd, "lines", []);
    const valid = lines.filter((l) => l.qty > 0);
    if (!valid.length) return { ok: false as const, error: "Selecione itens com quantidade." };
    const rows = await computeBranchReplenishment(ctx.store, ctx.companyId, { branchId: ctx.branchId, skuIds: valid.map((l) => l.skuId) });
    // somente fornecedores ativos da empresa; os demais (bloqueados/inativos/pendentes) são ignorados com aviso
    const linkedIds = [...new Set(rows.flatMap((r) => [...r.supplierOptions.map((o) => o.supplierId), ...r.unavailableSuppliers.map((u) => u.supplierId)]))];
    const linked = linkedIds.length ? await listAll(ctx.store, "suppliers", { filters: [["eq", "id", linkedIds]] }) : [];
    const supplierIds = linked.filter((x) => x.companyId === ctx.companyId && x.status === "active").map((x) => x.id);
    const skipped = linked.filter((x) => x.companyId === ctx.companyId && x.status !== "active");
    if (!supplierIds.length) return { ok: false as const, error: skipped.length ? `Nenhum fornecedor ativo vinculado aos itens selecionados (${skipped.map((x) => supplierLabel(x)).join(", ")} não podem receber cotação).` : "Nenhum fornecedor vinculado aos itens selecionados." };
    const t = today();
    const q = await createQuotation(ctx, {
      title: `Reposição ${t.split("-").reverse().join("/")} — ${valid.length} item(ns)`,
      origin: "replenishment",
      items: valid.map((l) => {
        const r = rows.find((x) => x.skuId === l.skuId);
        const needed = r?.stockoutDate && r.stockoutDate > t ? r.stockoutDate : addDays(t, Math.max(1, r?.leadTimeDays ?? 7));
        return { skuId: l.skuId, qty: l.qty, neededBy: needed };
      }),
      supplierIds,
      responseDue: addDays(t, 3),
      idemKey: `replenishment-q:${fstr(fd, "_idem")}`,
    });
    const warn = skipped.length ? ` Ignorado(s) por não estar(em) ativo(s): ${skipped.map((x) => `${supplierLabel(x)} (${x.status === "blocked" ? "bloqueado" : x.status === "inactive" ? "inativo" : "cadastro pendente"})`).join(", ")}.` : "";
    return { ok: true as const, message: `Cotação nº ${q.number} criada com ${supplierIds.length} fornecedor(es).${warn}`, redirect: `/compras/cotacoes/${q.id}?tab=propostas` };
  });
}
