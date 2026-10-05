/**
 * Cálculos puros usados nos formulários (cliente). Mesmas fórmulas do domínio:
 *  - encargos por atraso: src/domain/finance.ts → suggestLateCharges
 *  - vencimentos: src/domain/finance.ts → buildSchedule
 *  - baixa a partir de extrato/retorno: src/domain/reconciliation.ts → suggestedSettlement
 * Valores em centavos inteiros.
 */

export interface LateParams {
  fineBps: number;
  interestMonthlyBps: number;
  graceDays: number;
}

function roundDiv(num: number, den: number) {
  const sign = Math.sign(num) * Math.sign(den);
  const n = Math.abs(num);
  const d = Math.abs(den);
  const q = Math.floor(n / d);
  return sign * ((n - q * d) * 2 >= d ? q + 1 : q);
}

export function diffDays(a: string, b: string) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonths(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

export function lateCharges(dueDate: string, payDate: string, principal: number, p: LateParams) {
  const daysLate = Math.max(0, diffDays(dueDate, payDate));
  if (daysLate <= p.graceDays || principal <= 0) return { daysLate, fine: 0, interest: 0 };
  return { daysLate, fine: roundDiv(principal * p.fineBps, 10000), interest: roundDiv(principal * p.interestMonthlyBps * daysLate, 10000 * 30) };
}

/** Parcelas iguais (diferença de centavos na 1ª); intervalo de 30 dias com 1º vencimento múltiplo de 30 usa meses-calendário. */
export function schedule(total: number, n: number, firstDue: string, intervalDays: number) {
  const count = Math.max(1, Math.min(60, n));
  const base = Math.trunc(total / count);
  return Array.from({ length: count }, (_, i) => ({
    amount: base + (i === 0 ? total - base * count : 0),
    dueDate: intervalDays === 30 ? addMonths(firstDue, i) : addDays(firstDue, intervalDays * i),
  }));
}

export function settlementFromTx(tx: { kind: string; amount: number; paidAmount?: number | null; feeAmount?: number | null; interestAmount?: number | null; discountAmount?: number | null }, balance: number) {
  if (tx.kind === "collection") {
    const paid = tx.paidAmount ?? tx.amount + (tx.feeAmount ?? 0);
    let interest = tx.interestAmount ?? 0;
    const discount = tx.discountAmount ?? 0;
    let principal = paid - interest + discount;
    if (principal > balance) {
      interest += principal - balance;
      principal = balance;
    }
    return { principal: Math.max(0, principal), interest, fine: 0, discount, fee: tx.feeAmount ?? 0 };
  }
  const abs = Math.abs(tx.amount);
  return { principal: Math.min(abs, balance), interest: Math.max(0, abs - balance), fine: 0, discount: 0, fee: 0 };
}

export const brl = (cents: number | null | undefined) => (cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
export const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
