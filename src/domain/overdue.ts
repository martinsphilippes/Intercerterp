import { diffDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/**
 * Inadimplência na venda (VEN-07) — parte pura (sem banco), usada no servidor e nas telas do PDV.
 *
 * Cliente inadimplente = parcelas a receber em aberto/parciais com vencimento há MAIS de `graceDays` dias e soma dos
 * saldos dessas parcelas ≥ `minAmount` (0 = qualquer valor). Juros e multa NÃO entram na conta (o saldo é o principal
 * em aberto); encargos continuam sendo sugeridos só na baixa (`lateChargeParams`/`suggestLateCharges`).
 *
 * Política (parâmetro `sales.overduePolicy`, empresa/filial):
 *  - none: não verifica;
 *  - warn: avisa no PDV e registra no histórico a venda a prazo concluída para cliente inadimplente;
 *  - block_deferred: bloqueia venda a prazo (crediário/boleto); à vista continua livre;
 *  - block_all: bloqueia qualquer venda para o cliente identificado.
 * Bloqueio só é superado com liberação (motivo + ação especial `sale.overdue_override`), registrada na auditoria.
 */

export type OverduePolicy = "none" | "warn" | "block_deferred" | "block_all";

export const OVERDUE_POLICIES: Array<{ value: OverduePolicy; label: string }> = [
  { value: "none", label: "Não verificar" },
  { value: "warn", label: "Avisar (não bloqueia)" },
  { value: "block_deferred", label: "Bloquear venda a prazo (crediário/boleto)" },
  { value: "block_all", label: "Bloquear qualquer venda ao cliente" },
];

export const OVERDUE_KEYS = { policy: "sales.overduePolicy", graceDays: "sales.overdueGraceDays", minAmount: "sales.overdueMinAmount" } as const;

/** Padrões: avisar (não muda o resultado de nenhuma venda), tolerância de 5 dias, qualquer valor. */
export const OVERDUE_DEFAULTS = { policy: "warn" as OverduePolicy, graceDays: 5, minAmount: 0 };

export interface OverdueParams {
  /** `feature.inadimplencia` ligado */
  enabled: boolean;
  /** política efetiva ("none" quando o recurso está desligado) */
  policy: OverduePolicy;
  graceDays: number;
  /** valor mínimo vencido (centavos) para considerar inadimplente; 0 = qualquer valor */
  minAmount: number;
}

export interface OverdueStatus {
  policy: OverduePolicy;
  graceDays: number;
  minAmount: number;
  /** vencido além da tolerância (o que conta para a política) */
  total: number;
  count: number;
  oldestDueDate: string | null;
  maxDaysLate: number;
  /** todo o vencido, inclusive dentro da tolerância (informativo) */
  overdueTotal: number;
  overdueCount: number;
  /** atinge os critérios e a política não é "none" */
  delinquent: boolean;
}

export function normalizePolicy(v: unknown): OverduePolicy {
  return OVERDUE_POLICIES.some((p) => p.value === v) ? (v as OverduePolicy) : OVERDUE_DEFAULTS.policy;
}

/** Situação do cliente a partir das parcelas a receber dele (as que não estão em aberto são ignoradas). */
export function summarizeOverdue(
  installments: ReadonlyArray<Record<string, any>>,
  params: OverdueParams,
  ref: string,
): OverdueStatus {
  let total = 0;
  let count = 0;
  let overdueTotal = 0;
  let overdueCount = 0;
  let oldest: string | null = null;
  for (const i of installments) {
    if (i.kind && i.kind !== "receivable") continue;
    if (!["open", "partial"].includes(i.status) || !(i.balance > 0)) continue;
    const late = diffDays(i.dueDate, ref);
    if (late <= 0) continue;
    overdueTotal += i.balance;
    overdueCount += 1;
    if (late <= params.graceDays) continue;
    total += i.balance;
    count += 1;
    if (!oldest || i.dueDate < oldest) oldest = i.dueDate;
  }
  const delinquent = params.policy !== "none" && count > 0 && total >= Math.max(1, params.minAmount);
  return {
    policy: params.policy, graceDays: params.graceDays, minAmount: params.minAmount,
    total, count, oldestDueDate: oldest, maxDaysLate: oldest ? diffDays(oldest, ref) : 0, overdueTotal, overdueCount, delinquent,
  };
}

/** A política impede esta venda? `deferred` = há pagamento a prazo (crediário/boleto). */
export function overdueBlocks(st: Pick<OverdueStatus, "delinquent" | "policy"> | null | undefined, deferred: boolean): boolean {
  if (!st?.delinquent) return false;
  return st.policy === "block_all" || (st.policy === "block_deferred" && deferred);
}

/** "R$ 120,00 vencido há 12 dia(s) em 2 parcela(s)". */
export function overdueText(st: Pick<OverdueStatus, "total" | "count" | "maxDaysLate">): string {
  return `${formatMoney(st.total)} vencido há ${st.maxDaysLate} dia(s) em ${st.count} parcela(s)`;
}

export function overdueBlockMessage(st: OverdueStatus): string {
  const what = st.policy === "block_all" ? "Venda bloqueada" : "Venda a prazo bloqueada";
  return `${what}: cliente inadimplente — ${overdueText(st)}. Receba as parcelas vencidas ou peça a liberação a um usuário com a permissão “Liberar venda para cliente inadimplente” (com motivo).`;
}

/** Atalho para receber as parcelas vencidas do cliente em Contas a receber. */
export function overdueReceiveHref(customerId: string): string {
  return `/financeiro/receber?party=${encodeURIComponent(customerId)}&state=overdue`;
}
