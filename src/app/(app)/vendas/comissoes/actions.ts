"use server";

import { runAction, fopt, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { formatMoney } from "@/lib/money";
import { closeCommission, reopenCommission, type CommissionBase } from "@/domain/commissions";

const REVALIDATE = ["/vendas/comissoes", "/financeiro/pagar"];

export async function closeCommissionAction(fd: FormData) {
  return runAction({ module: "sales", revalidate: REVALIDATE }, async (s) => {
    await requireFeature(s, "comissoes");
    const base = fstr(fd, "base");
    const title = await closeCommission(s.ctx, {
      from: fstr(fd, "from"), to: fstr(fd, "to"), branchId: fopt(fd, "branchId"), sellerId: fstr(fd, "sellerId"), dueDate: fstr(fd, "dueDate"),
      base: base === "invoiced" || base === "received" ? (base as CommissionBase) : null, notes: fopt(fd, "notes"),
    });
    return { ok: true as const, data: { id: title.id }, message: `Comissão fechada: título a pagar nº ${title.number} de ${formatMoney(title.total)}.` };
  });
}

export async function reopenCommissionAction(titleId: string, fd: FormData) {
  return runAction({ module: "sales", revalidate: REVALIDATE }, async (s) => {
    await requireFeature(s, "comissoes");
    const t = await reopenCommission(s.ctx, titleId, fstr(fd, "reason"));
    return { ok: true as const, message: `Fechamento reaberto: título nº ${t.number} cancelado.` };
  });
}
