"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import Link from "@/components/ui/link";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { overdueReceiveHref, overdueText, type OverdueStatus } from "@/domain/overdue";

/**
 * Alerta de cliente inadimplente no PDV (VEN-07): total vencido, dias de atraso e atalho para receber as parcelas.
 * A regra é conferida de novo no servidor na conclusão da venda; aqui é só informação ao operador.
 */
export function OverdueAlert({ customerId, overdue, canReceive = true }: { customerId: string; overdue: OverdueStatus | null | undefined; canReceive?: boolean }) {
  if (!overdue?.delinquent) return null;
  const effect =
    overdue.policy === "block_all" ? "Venda bloqueada para este cliente: só conclui com liberação (motivo + usuário autorizado)." : overdue.policy === "block_deferred" ? "Venda a prazo (crediário/boleto) bloqueada; à vista está liberada." : "Política “avisar”: a venda a prazo fica registrada no histórico.";
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> Cliente inadimplente
      </p>
      <p className="mt-1 text-xs">
        <b className="tabular">{formatMoney(overdue.total)}</b> vencido há <b>{overdue.maxDaysLate} dia(s)</b> em {overdue.count} parcela(s){overdue.oldestDueDate ? ` (mais antiga: ${formatDate(overdue.oldestDueDate)})` : ""}.
        {overdue.overdueTotal > overdue.total && <> Total vencido, incluindo a tolerância de {overdue.graceDays} dia(s): {formatMoney(overdue.overdueTotal)}.</>}
      </p>
      <p className="mt-1 text-xs font-medium">{effect}</p>
      {canReceive && (
        <Link href={overdueReceiveHref(customerId)} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline" title={`Abrir as parcelas vencidas em Contas a receber (${overdueText(overdue)})`}>
          <ExternalLink className="size-3.5" aria-hidden /> Receber parcelas vencidas
        </Link>
      )}
    </div>
  );
}
