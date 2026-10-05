"use server";

import { runAction, fstr, fopt, fint, fjson } from "@/lib/server/action";
import { createOrder, updateOrder, cancelOrder, closeOrderBalance, registerOrderSent, type OrderInput } from "@/domain/purchases";
import { submitForApproval } from "@/domain/approvals";
import { computeBranchReplenishment } from "@/domain/replenishment";
import { createQuotation } from "@/domain/quotations";
import { listAll } from "@/lib/db";
import { addDays, today } from "@/lib/dates";

function parse(fd: FormData): OrderInput & { revisionReason?: string | null } {
  return {
    supplierId: fstr(fd, "supplierId"),
    warehouseId: fopt(fd, "warehouseId"),
    expectedDate: fopt(fd, "expectedDate"),
    items: fjson(fd, "items", []),
    headerDiscount: fint(fd, "headerDiscount"),
    freight: fint(fd, "freight"),
    insurance: fint(fd, "insurance"),
    otherExpenses: fint(fd, "otherExpenses"),
    paymentTermId: fopt(fd, "paymentTermId"),
    paymentMethodId: fopt(fd, "paymentMethodId"),
    costCenterId: fopt(fd, "costCenterId"),
    purpose: fopt(fd, "purpose"),
    buyerId: fopt(fd, "buyerId"),
    customDays: fopt(fd, "customDays"),
    notes: fopt(fd, "notes"),
    revisionReason: fopt(fd, "revisionReason"),
  };
}

export async function saveOrderAction(fd: FormData) {
  const id = fopt(fd, "id");
  const intent = fstr(fd, "intent") || "draft";
  return runAction({ module: "purchases", op: id ? "edit" : "create", revalidate: ["/compras/pedidos"], requireBranch: true }, async (s) => {
    const input = parse(fd);
    if (!input.supplierId) return { ok: false as const, error: "Selecione o fornecedor." };
    if (id) {
      const r = await updateOrder(s.ctx, id, input);
      const req = intent === "submit" && ["draft", "adjust"].includes(r.order.status) ? await submitForApproval(s.ctx, [id]) : null;
      const msg = r.revised ? (r.needsReview ? `Revisão ${r.order.revision} registrada — o pedido voltou para análise conforme a política.` : `Revisão ${r.order.revision} registrada — dispensada de nova análise pela política.`) : req ? (req.status === "approved" ? "Pedido salvo e autoaprovado pela política (abaixo do limite)." : `Pedido salvo e enviado para análise (solicitação nº ${req.number}).`) : "Pedido salvo.";
      return { ok: true as const, message: msg, redirect: `/compras/pedidos/${id}` };
    }
    const o = await createOrder(s.ctx, { ...input, origin: "manual", idemKey: `ui:${fstr(fd, "_idem")}` });
    const req = intent === "submit" && o.status === "draft" ? await submitForApproval(s.ctx, [o.id]) : null;
    const msg = req ? (req.status === "approved" ? `Pedido nº ${o.number} criado e autoaprovado pela política (abaixo do limite). Registre o envio ao fornecedor.` : `Pedido nº ${o.number} criado e enviado para análise (solicitação nº ${req.number}).`) : `Pedido nº ${o.number} salvo em rascunho.`;
    return { ok: true as const, data: { id: o.id }, message: msg, redirect: `/compras/pedidos/${o.id}` };
  });
}

export async function submitOrderAction(id: string) {
  return runAction({ module: "purchases", op: "edit", revalidate: [`/compras/pedidos/${id}`, "/compras/aprovacoes"], requireBranch: true }, async (s) => {
    const req = await submitForApproval(s.ctx, [id]);
    return { ok: true as const, message: req.status === "approved" ? `Autoaprovado pela política (solicitação nº ${req.number}).` : `Enviado para análise — solicitação nº ${req.number}.` };
  });
}

export async function cancelOrderAction(id: string, fd: FormData) {
  return runAction({ module: "purchases", op: "edit", revalidate: [`/compras/pedidos/${id}`, "/compras/pedidos"] }, async (s) => {
    await cancelOrder(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Pedido cancelado." };
  });
}

export async function closeBalanceAction(id: string, fd: FormData) {
  return runAction({ module: "purchases", op: "edit", revalidate: [`/compras/pedidos/${id}`] }, async (s) => {
    await closeOrderBalance(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Saldo pendente encerrado." };
  });
}

export async function registerSentAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "purchases", op: "edit", revalidate: [`/compras/pedidos/${id}`, "/compras/pedidos"] }, async (s) => {
    const method = (fstr(fd, "method") as "manual" | "email") || "manual";
    const o = await registerOrderSent(s.ctx, id, { method, channel: fopt(fd, "channel"), contact: fopt(fd, "contact"), to: fopt(fd, "to"), sentDate: fopt(fd, "sentDate"), notes: fopt(fd, "notes") });
    return { ok: true as const, message: method === "email" ? `Pedido enviado por e-mail para ${o.sentInfo?.to} (${o.sentInfo?.channel}).` : "Envio registrado." };
  });
}

/** Itens com sugestão de reposição cujo fornecedor preferencial é o informado (adicionar ao pedido sem redigitar). */
export async function suggestionsForSupplierAction(supplierId: string) {
  return runAction({ module: "purchases", requireBranch: true }, async (s) => {
    const rows = await computeBranchReplenishment(s.ctx.store, s.ctx.companyId, { branchId: s.ctx.branchId!, supplierId });
    return rows
      .filter((r) => r.suggested > 0 && r.supplierId === supplierId)
      .map((r) => ({ skuId: r.skuId, sku: r.sku, name: r.name, unitCode: r.unitCode, supplierCode: r.supplierCode, qty: r.suggested, unitCost: r.unitCost, available: r.available, stockMin: r.minQty || null }));
  });
}

/** Gera cotação com os itens do formulário: fornecedor escolhido + demais fornecedores vinculados aos produtos. */
export async function quotationFromFormAction(fd: FormData) {
  return runAction({ module: "purchases", op: "create", requireBranch: true, revalidate: ["/compras/cotacoes"] }, async (s) => {
    const items: Array<{ skuId: string; qty: number }> = fjson(fd, "items", []);
    if (!items.length) return { ok: false as const, error: "Inclua produtos antes de gerar a cotação." };
    const supplierId = fopt(fd, "supplierId");
    const sps = await listAll(s.ctx.store, "supplier_products", { filters: [["eq", "skuId", items.map((i) => i.skuId)]] });
    const suppliers = await listAll(s.ctx.store, "suppliers", { filters: [["eq", "id", [...new Set([...(supplierId ? [supplierId] : []), ...sps.map((x) => x.supplierId)])]]] });
    const ids = suppliers.filter((x) => x.status === "active").map((x) => x.id);
    if (!ids.length) return { ok: false as const, error: "Nenhum fornecedor ativo vinculado a estes produtos. Selecione o fornecedor." };
    const expected = fopt(fd, "expectedDate");
    const q = await createQuotation(s.ctx, { title: fopt(fd, "purpose") ?? "Cotação a partir do pedido", items: items.map((i) => ({ skuId: i.skuId, qty: i.qty, neededBy: expected ?? addDays(today(), 15) })), supplierIds: ids, origin: "need", idemKey: `order-form:${fstr(fd, "_idem")}` });
    return { ok: true as const, message: `Cotação nº ${q.number} criada com ${ids.length} fornecedor(es). Registre as propostas.`, redirect: `/compras/cotacoes/${q.id}?tab=propostas` };
  });
}
