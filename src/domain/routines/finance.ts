import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { registerRoutine } from "../scheduler";

/**
 * Rotinas diárias do Financeiro (idempotentes; cada ocorrência gera no máximo uma notificação por destinatário):
 *  - recebíveis vencidos → ocorrência `overdue:<parcela>` (resolvida ao quitar/cancelar/reprogramar a parcela);
 *  - contas a pagar que vencem hoje → ocorrência `payable_due:<parcela>`.
 * Ocorrências de parcelas já quitadas/canceladas são resolvidas na mesma passada.
 */
export async function notifyFinanceDue(store: Store, companyId: string, ref = today()) {
  const open = await listAll(store, "installments", { filters: [["eq", "companyId", companyId], ["eq", "status", ["open", "partial"]], ["lte", "dueDate", ref]] });
  let overdue = 0;
  let payable = 0;
  for (const i of open) {
    if (i.kind === "receivable" && i.dueDate < ref) {
      const days = Math.round((Date.parse(ref) - Date.parse(i.dueDate)) / 86400000);
      overdue += await notify(store, {
        companyId, branchId: i.branchId ?? null, type: "receivable_overdue", priority: days > 30 ? "high" : "normal",
        title: `Recebível vencido: ${i.partyName ?? i.description}`,
        body: `${i.description} — parcela ${i.number} venceu em ${formatDate(i.dueDate)} (${days} dia(s)). Saldo ${formatMoney(i.balance)}.`,
        link: `/financeiro/receber/${i.titleId}`, originType: "installment", originId: i.id, occurrenceKey: `overdue:${i.id}`, audience: { module: "finance" },
      });
    } else if (i.kind === "payable" && i.dueDate === ref) {
      payable += await notify(store, {
        companyId, branchId: i.branchId ?? null, type: "payable_due", priority: "high",
        title: `Conta a pagar vence hoje: ${i.partyName ?? i.description}`,
        body: `${i.description} — parcela ${i.number}, saldo ${formatMoney(i.balance)}.`,
        link: `/financeiro/pagar/${i.titleId}`, originType: "installment", originId: i.id, occurrenceKey: `payable_due:${i.id}`, audience: { module: "finance" },
      });
    }
  }
  // limpeza: ocorrências abertas cuja parcela não está mais pendente
  const openNotifs = await listAll(store, "notifications", { filters: [["eq", "companyId", companyId], ["eq", "type", ["receivable_overdue", "payable_due"]], ["eq", "occurrenceStatus", "open"]] });
  const keys = [...new Set(openNotifs.map((n) => n.occurrenceKey).filter(Boolean) as string[])];
  let resolved = 0;
  for (const k of keys) {
    const instId = k.split(":")[1];
    const inst = instId ? await store.get("installments", instId) : null;
    // vencido: pendente enquanto em aberto e vencido; a pagar: pendente até ser pago/cancelado
    const stillDue = inst && ["open", "partial"].includes(inst.status) && (k.startsWith("overdue:") ? inst.dueDate < ref : true);
    if (!stillDue) resolved += await resolveOccurrence(store, k);
  }
  return { overdueNotifications: overdue, payableNotifications: payable, resolved };
}

registerRoutine("finance.due", (store, companyId) => notifyFinanceDue(store, companyId));
