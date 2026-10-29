"use server";

import { runAction, fstr, fopt, fint } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { BusinessError } from "@/lib/core/errors";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  saveBillingAgreement, requestRecharge, confirmRecharge, cancelRecharge, adjustWallet, closeRelationNow, reverseNetworkSale, reprocessSaleFinance, savePlatformFinance, isPlatform, type AgreementInput,
} from "@/domain/network";
import type { SessionInfo } from "@/lib/server/session";

const PATHS = ["/rede", "/rede/minha", "/rede/minha/financeiro", "/rede/financeiro", "/rede/vendas", "/rede/parametros", "/financeiro/receber", "/financeiro/pagar"];

async function guard(s: SessionInfo) {
  await requireFeature(s, "redeCertificacao");
}

/** Percentual digitado ("10" ou "7,5") em pontos-base. */
function bps(fd: FormData, key: string): number {
  const raw = fstr(fd, key).replace(",", ".").trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new BusinessError("Percentual inválido.", "percent");
  return Math.round(n * 100);
}

export async function saveAgreementAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const kind = fstr(fd, "referralKind");
    const input: AgreementInput = {
      mode: fstr(fd, "mode") as AgreementInput["mode"], period: fstr(fd, "period") as AgreementInput["period"], weekday: fint(fd, "weekday", 1), monthDay: fint(fd, "monthDay", 1), dueDays: fint(fd, "dueDays", 10),
      commissionSettlement: fstr(fd, "commissionSettlement") === "split" ? "split" : "period", commissionRule: fstr(fd, "commissionRule") === "percent" ? "percent" : "margin", commissionBps: bps(fd, "commissionPercent"),
      overdraftLimit: fint(fd, "overdraftLimit"), lowBalanceAlert: fint(fd, "lowBalanceAlert"),
      referralKind: kind === "percent" || kind === "fixed" ? kind : "none", referralBps: bps(fd, "referralPercent"), referralCents: fint(fd, "referralCents"),
      referralSettlement: fstr(fd, "referralSettlement") === "split" ? "split" : "period", validFrom: fopt(fd, "validFrom"), reason: fopt(fd, "reason"),
    };
    await saveBillingAgreement(s.ctx, fstr(fd, "childNodeId"), input);
    return { ok: true as const, message: "Modalidade salva (a anterior termina na véspera da vigência e continua no histórico)." };
  });
}

export async function requestRechargeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await requestRecharge(s.ctx, fstr(fd, "childNodeId"), { amount: fint(fd, "amount"), dueDate: fopt(fd, "dueDate"), idemKey: fstr(fd, "_idem") });
    return { ok: true as const, message: `Recarga ${r.code} de ${formatMoney(r.amount)} lançada: a receber do parceiro acima e a pagar do parceiro. O crédito entra na confirmação do recebimento.${r.financeNote ? ` Atenção: ${r.financeNote}` : ""}` };
  });
}

export async function confirmRechargeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await confirmRecharge(s.ctx, fstr(fd, "id"), { ref: fstr(fd, "ref") });
    return { ok: true as const, message: `Recarga ${r.code} confirmada: ${formatMoney(r.amount)} creditados na carteira.` };
  });
}

export async function cancelRechargeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await cancelRecharge(s.ctx, fstr(fd, "id"), fstr(fd, "reason"));
    return { ok: true as const, message: `Recarga ${r.code} cancelada (títulos cancelados).` };
  });
}

export async function adjustWalletAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const amount = fint(fd, "amount") * (fstr(fd, "direction") === "debit" ? -1 : 1);
    const w = await adjustWallet(s.ctx, fstr(fd, "childNodeId"), { amount, reason: fstr(fd, "reason"), idemKey: fstr(fd, "_idem") });
    return { ok: true as const, message: `Ajuste registrado. Saldo ${formatMoney(w.balance)}, disponível ${formatMoney(w.available)}.` };
  });
}

export async function closeNowAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await closeRelationNow(s.ctx, fstr(fd, "childNodeId"), fstr(fd, "relationKey"));
    if (r.carried != null) return { ok: true as const, message: `Sem valor a faturar: crédito de ${formatMoney(-r.carried)} transportado para o próximo fechamento.` };
    if (!r.closing) return { ok: true as const, message: "Nada a fechar: não há lançamentos acumulados até hoje." };
    return { ok: true as const, message: `Fechamento ${r.closing.code} gerado: ${formatMoney(r.closing.total)} (${r.closing.count} lançamento(s)), vencimento ${formatDate(r.closing.dueDate)}.${r.closing.notes ? ` ${r.closing.notes}` : ""}`, redirect: `/rede/fechamentos/${r.closing.id}` };
  });
}

export async function reverseSaleAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await reverseNetworkSale(s.ctx, fstr(fd, "id"), { reason: fstr(fd, "reason") });
    return { ok: true as const, message: `Venda ${r.protocol} estornada: os lançamentos de todas as camadas foram revertidos.` };
  });
}

export async function reprocessSaleAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    if (!isPlatform(s.ctx)) throw new BusinessError("Reprocessar lançamentos é da plataforma.", "platform");
    const r = await reprocessSaleFinance(s.ctx, fstr(fd, "id"));
    return { ok: true as const, message: r.issues.length ? `Ainda pendente: ${r.issues.join(" ")}` : "Lançamentos conferidos: nenhuma pendência." };
  });
}

export async function savePlatformFinanceAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    await savePlatformFinance(s.ctx, { platformCompanyId: fopt(fd, "platformCompanyId"), acClosingDay: fint(fd, "acClosingDay", 1), acDueDays: fint(fd, "acDueDays", 15) });
    return { ok: true as const, message: "Financeiro da plataforma salvo." };
  });
}
