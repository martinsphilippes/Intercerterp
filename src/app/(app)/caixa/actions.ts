"use server";

import { runAction, fstr, fopt, fint, fjson } from "@/lib/server/action";
import { addCashMovement, closeSession, openSession, previewClose, reopenSession, retryCloseTransfer } from "@/domain/cash";
import { formatMoney } from "@/lib/money";

export async function openSessionAction(fd: FormData) {
  return runAction({ module: "cash", op: "create", requireBranch: true, revalidate: ["/caixa", "/pdv"] }, async (s) => {
    const terminalId = fstr(fd, "terminalId");
    const session = await openSession(s.ctx, { terminalId, openingFund: fint(fd, "openingFund"), notes: fopt(fd, "notes") ?? undefined, peripheralsCheck: fjson(fd, "peripherals", {}) });
    return { ok: true as const, message: `Caixa nº ${session.number} aberto — fundo ${formatMoney(session.openingFund)}.`, redirect: `/pdv?terminal=${terminalId}` };
  });
}

export async function addMovementAction(sessionId: string, fd: FormData) {
  return runAction({ module: "cash", requireBranch: true, revalidate: ["/caixa/movimentos", `/caixa/${sessionId}`] }, async (s) => {
    const type = fstr(fd, "type") === "supply" ? "supply" : "withdrawal";
    const reason = fstr(fd, "reason") === "Outro" ? fstr(fd, "reasonOther") : fstr(fd, "reason");
    const login = fopt(fd, "approvalLogin");
    const m = await addCashMovement(s.ctx, {
      sessionId, type, amount: fint(fd, "amount"), reason, accountId: fopt(fd, "accountId"), responsibleId: fopt(fd, "responsibleId"), recipient: fopt(fd, "recipient"), notes: fopt(fd, "notes"),
      idemKey: `mov:${sessionId}:${fstr(fd, "_idem")}`, approval: login ? { login, password: fstr(fd, "approvalPassword") } : null,
    });
    return { ok: true as const, message: `${type === "supply" ? "Suprimento" : "Sangria"} nº ${m.number} registrado(a): ${formatMoney(Math.abs(m.amount))}.`, data: { id: m.id } };
  });
}

export async function previewCloseAction(sessionId: string, counted: Record<string, number>) {
  return runAction({ module: "cash", op: "edit", requireBranch: true }, async (s) => previewClose(s.ctx, sessionId, counted));
}

export async function closeSessionAction(sessionId: string, fd: FormData) {
  return runAction({ module: "cash", op: "edit", requireBranch: true, revalidate: ["/caixa", `/caixa/${sessionId}`, "/pdv"] }, async (s) => {
    const counted = fjson<Record<string, number>>(fd, "counted", {});
    // conferência cega: decidida pelo parâmetro no servidor (a contagem registrada na apuração prevalece)
    const session = await closeSession(s.ctx, {
      sessionId, counted, justification: fopt(fd, "justification"), checklist: fjson(fd, "checklist", {}), enforceChecklist: true,
      transferToAccountId: fopt(fd, "transferToAccountId"), transferAmount: fint(fd, "transferAmount"), idemKey: `close:${sessionId}:${fstr(fd, "_idem")}`,
    });
    const diff = Object.values(session.differences ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
    return { ok: true as const, message: `Caixa nº ${session.number} fechado${Object.keys(session.differences ?? {}).length ? ` com divergência de ${formatMoney(diff)} (preservada)` : " sem diferenças"}.`, redirect: `/caixa/${sessionId}?tab=resumo` };
  });
}

export async function reopenSessionAction(sessionId: string, fd: FormData) {
  return runAction({ module: "cash", requireBranch: true, revalidate: ["/caixa", `/caixa/${sessionId}`] }, async (s) => {
    const r = await reopenSession(s.ctx, sessionId, fstr(fd, "reason"));
    return { ok: true as const, message: `Caixa nº ${(r as any).number} reaberto (versão ${r.version}). O fechamento anterior foi preservado.` };
  });
}

/** Conclui o recolhimento de um fechamento interrompido (transferência Caixa → conta de destino). */
export async function retryCloseTransferAction(sessionId: string) {
  return runAction({ module: "cash", op: "edit", requireBranch: true, revalidate: [`/caixa/${sessionId}`, "/caixa"] }, async (s) => {
    const tr = await retryCloseTransfer(s.ctx, sessionId);
    return { ok: true as const, message: `Recolhimento de ${formatMoney(tr.amount)} transferido.` };
  });
}
