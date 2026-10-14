"use server";

import { runAction, fopt, fstr } from "@/lib/server/action";
import { requireAction } from "@/lib/core/ctx";
import { formatDate } from "@/lib/dates";
import { requireFeature } from "@/lib/server/features";
import { setClosedUntil } from "@/domain/period-close";

const RV = ["/financeiro/fechamento", "/financeiro/receber", "/financeiro/pagar", "/financeiro/fluxo-caixa"];

/** Fecha o período financeiro até a data (inclusive). Exige "Fechar e reabrir período financeiro". */
export async function closePeriodAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    await requireFeature(s, "fechamentoPeriodo");
    requireAction(s.ctx, "finance.close_period");
    const date = fstr(fd, "date");
    const r = await setClosedUntil(s.ctx, { date, reason: fopt(fd, "reason") });
    if (!r.changed) return { ok: true as const, message: "O período já estava fechado nesta data." };
    return { ok: true as const, message: r.action === "close" ? `Período financeiro fechado até ${formatDate(date)}.` : `Fechamento recuado para ${formatDate(date)} (reabertura registrada).` };
  });
}

/** Reabre o período: recua a data de fechamento (ou remove) — motivo obrigatório, auditado. */
export async function reopenPeriodAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    await requireFeature(s, "fechamentoPeriodo");
    requireAction(s.ctx, "finance.close_period");
    const date = fopt(fd, "date");
    const r = await setClosedUntil(s.ctx, { date, reason: fstr(fd, "reason") });
    if (!r.changed) return { ok: true as const, message: "Nada mudou: a data informada é a do fechamento atual." };
    return { ok: true as const, message: date ? `Período reaberto: agora fechado só até ${formatDate(date)}.` : "Período financeiro totalmente reaberto." };
  });
}
