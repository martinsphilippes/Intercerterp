"use server";

import { cookies } from "next/headers";
import { runAction, fstr, fopt, fjson } from "@/lib/server/action";
import { cancelSale, confirmCardReversal, processReturn, refreshSaleFiscal, sendSaleReceiptEmail, type ReturnInput } from "@/domain/sales";
import { formatMoney } from "@/lib/money";
import { TERMINAL_COOKIE } from "../pdv/terminal";

async function browserTerminal(branchId: string | null) {
  const v = (await cookies()).get(TERMINAL_COOKIE)?.value ?? "";
  const [b, t] = v.split(":");
  return b && b === branchId ? t : null;
}

export async function cancelSaleAction(saleId: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: [`/vendas/${saleId}`, "/vendas"] }, async (s) => {
    const sale = await cancelSale(s.ctx, saleId, fstr(fd, "reason"), { terminalId: await browserTerminal(s.ctx.branchId) });
    const pays = await s.ctx.store.list("sale_payments", { filters: [["eq", "saleId", saleId]], limit: 50 });
    const pending = pays.items.filter((p) => p.status === "refund_pending");
    const manual = pays.items.filter((p) => p.status === "refund_manual");
    const parts = [
      sale.cancelEffectsStatus === "done" ? "Efeitos de estoque, caixa, títulos e fiscal estornados." : "Efeitos do cancelamento em processamento (a tarefa durável conclui o que faltar).",
      pending.length ? `Estorno Pix de ${formatMoney(pending.reduce((a, p) => a + p.amount, 0))} pendente no provedor.` : "",
      manual.length ? `Pix manual: devolva ${formatMoney(manual.reduce((a, p) => a + p.amount, 0))} ao cliente.` : "",
    ].filter(Boolean);
    return { ok: true as const, message: `Venda nº ${sale.number} cancelada. ${parts.join(" ")}` };
  });
}

export async function refreshFiscalAction(saleId: string) {
  return runAction({ module: "sales" }, async (s) => {
    const r = await refreshSaleFiscal(s.ctx, saleId);
    const d = r.document;
    return {
      status: d?.status ?? r.sale.fiscalStatus, message: d?.statusMessage ?? null, documentId: d?.id ?? null, number: d?.number ?? null, simulated: Boolean(d?.isSimulated),
      series: d?.series ?? null, protocol: d?.protocol ?? null, authorizedAt: d?.authorizedAt ?? null, accessKey: d?.accessKey ?? null, xmlFileId: d?.xmlFileId ?? null,
    };
  });
}

export async function sendReceiptAction(saleId: string, fd: FormData) {
  return runAction({ module: "sales" }, async (s) => {
    const r = await sendSaleReceiptEmail(s.ctx, saleId, fstr(fd, "email"));
    if (!r.delivered) return { ok: false as const, error: r.channel === "not_configured" ? "Canal de e-mail não configurado (Administração → Integrações → E-mail). Nada foi enviado." : `E-mail não enviado: ${r.message ?? r.channel}` };
    return { ok: true as const, message: `Comprovante entregue ao provedor de e-mail (${r.channel}) para ${fstr(fd, "email")}.` };
  });
}

export async function processReturnAction(saleId: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: [`/vendas/${saleId}`, "/vendas/devolucoes"] }, async (s) => {
    const items = fjson<ReturnInput["items"]>(fd, "items", []).filter((i) => i.qty > 0);
    const compensation = (fstr(fd, "compensation") || "store_credit") as ReturnInput["compensation"];
    const ret = await processReturn(s.ctx, {
      saleId,
      idemKey: `ret:${saleId}:${fstr(fd, "_idem")}`,
      reason: fstr(fd, "reason"),
      items,
      compensation,
      refundMethod: compensation === "refund" ? ((fopt(fd, "refundMethod") ?? undefined) as any) : undefined,
      refundAccountId: fopt(fd, "refundAccountId"),
      notes: fopt(fd, "notes") ?? undefined,
      terminalId: await browserTerminal(s.ctx.branchId),
    });
    const abated = ret.abatedAmount ?? 0;
    return {
      ok: true as const,
      message: `Devolução nº ${ret.number} registrada — ${formatMoney(ret.itemsTotal)}${abated > 0 ? ` (${formatMoney(abated)} abatidos do título a prazo; ${formatMoney(ret.compensatedAmount ?? 0)} compensados ao cliente)` : ""}.`,
      redirect: `/vendas/devolucoes/${ret.id}`,
      data: { id: ret.id },
    };
  });
}

/** Confirma o estorno no cartão (retorno da adquirente): a devolução deixa de ficar "em processamento". */
export async function confirmCardReversalAction(returnId: string, fd: FormData) {
  return runAction({ module: "sales", requireBranch: true, revalidate: [`/vendas/devolucoes/${returnId}`, "/vendas/devolucoes"] }, async (s) => {
    const r = await confirmCardReversal(s.ctx, returnId, { reference: fstr(fd, "reason") });
    return { ok: true as const, message: `Estorno da devolução nº ${r.number} confirmado (ref. ${r.confirmationRef}).` };
  });
}
