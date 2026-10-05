"use server";

import { cookies } from "next/headers";
import { runAction, fstr, fopt, fjson } from "@/lib/server/action";
import { cancelSale, processReturn, refreshSaleFiscal, sendSaleReceiptEmail, type ReturnInput } from "@/domain/sales";
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
    return { ok: true as const, message: `Venda nº ${sale.number} cancelada. Efeitos de estoque, caixa, financeiro e fiscal estornados.` };
  });
}

export async function refreshFiscalAction(saleId: string) {
  return runAction({ module: "sales" }, async (s) => {
    const r = await refreshSaleFiscal(s.ctx, saleId);
    const d = r.document;
    return { status: d?.status ?? r.sale.fiscalStatus, message: d?.statusMessage ?? null, documentId: d?.id ?? null, number: d?.number ?? null, simulated: Boolean(d?.isSimulated) };
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
    return { ok: true as const, message: `Devolução nº ${ret.number} registrada — ${formatMoney(ret.itemsTotal)}.`, redirect: `/vendas/devolucoes/${ret.id}`, data: { id: ret.id } };
  });
}
