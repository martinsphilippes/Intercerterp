"use server";

import { runAction, fstr, fopt, fint, fjson } from "@/lib/server/action";
import { createOrder, updateOrder, cancelOrder, closeOrderBalance, registerOrderSent, type OrderInput } from "@/domain/purchases";
import { submitForApproval } from "@/domain/approvals";

function parse(fd: FormData): OrderInput & { revisionReason?: string | null } {
  return {
    supplierId: fstr(fd, "supplierId"),
    warehouseId: fopt(fd, "warehouseId"),
    expectedDate: fopt(fd, "expectedDate"),
    items: fjson(fd, "items", []),
    headerDiscount: fint(fd, "headerDiscount"),
    freight: fint(fd, "freight"),
    otherExpenses: fint(fd, "otherExpenses"),
    paymentTermId: fopt(fd, "paymentTermId"),
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
      if (intent === "submit" && ["draft", "adjust"].includes(r.order.status)) await submitForApproval(s.ctx, [id]);
      const msg = r.revised ? (r.needsReview ? `Revisão ${r.order.revision} registrada — o pedido voltou para análise conforme a política.` : `Revisão ${r.order.revision} registrada — dispensada de nova análise pela política.`) : intent === "submit" ? "Pedido salvo e enviado para análise." : "Pedido salvo.";
      return { ok: true as const, message: msg, redirect: `/compras/pedidos/${id}` };
    }
    const o = await createOrder(s.ctx, { ...input, origin: "manual", idemKey: `ui:${fstr(fd, "_idem")}` });
    if (intent === "submit") await submitForApproval(s.ctx, [o.id]);
    return { ok: true as const, data: { id: o.id }, message: intent === "submit" ? `Pedido nº ${o.number} criado e enviado para análise.` : `Pedido nº ${o.number} salvo em rascunho.`, redirect: `/compras/pedidos/${o.id}` };
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
