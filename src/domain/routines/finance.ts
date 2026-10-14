import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { notify, reopenOccurrence, resolveOccurrence } from "@/lib/core/notify";
import { registerRoutine } from "../scheduler";
import { overdueParams } from "../delinquency";
import { OVERDUE_POLICIES, overdueReceiveHref, overdueText, summarizeOverdue } from "../overdue";

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
  // (somente as ocorrências por parcela; as de cliente inadimplente são da rotina abaixo)
  const keys = [...new Set(openNotifs.map((n) => n.occurrenceKey).filter((k): k is string => Boolean(k) && (k.startsWith("overdue:") || k.startsWith("payable_due:"))))];
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

/**
 * Clientes que ENTRARAM em inadimplência (VEN-07): uma ocorrência `delinquent:<cliente>` por cliente enquanto ele
 * atender aos critérios da política da empresa (tolerância e valor mínimo); resolvida quando deixa de atender.
 * Recurso desligado ou política "não verificar": nada é avisado e as ocorrências abertas são resolvidas.
 */
export async function notifyDelinquentCustomers(store: Store, companyId: string, ref = today()) {
  const params = await overdueParams(store, companyId, null);
  const open = params.policy === "none" ? [] : await listAll(store, "installments", { filters: [["eq", "companyId", companyId], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]], ["lt", "dueDate", ref]] });
  const byCustomer = new Map<string, typeof open>();
  for (const i of open) {
    if (!i.partyId) continue;
    const list = byCustomer.get(i.partyId) ?? [];
    list.push(i);
    byCustomer.set(i.partyId, list);
  }
  const delinquent = new Set<string>();
  let notified = 0;
  for (const [customerId, insts] of byCustomer) {
    const st = summarizeOverdue(insts, params, ref);
    if (!st.delinquent) continue;
    const customer = await store.get("customers", customerId);
    if (!customer || customer.companyId !== companyId) continue; // títulos de outras partes (ex.: fornecedor) não entram
    delinquent.add(customerId);
    // voltou a ficar inadimplente depois de regularizar: a ocorrência resolvida volta a ser pendência (não lida)
    await reopenOccurrence(store, `delinquent:${customerId}`);
    notified += await notify(store, {
      companyId, type: "receivable_overdue", priority: st.maxDaysLate > 30 ? "high" : "normal",
      title: `Cliente inadimplente: ${customer.name}`,
      body: `${overdueText(st)} (tolerância de ${st.graceDays} dia(s)). Política na venda: ${OVERDUE_POLICIES.find((p) => p.value === st.policy)?.label ?? st.policy}.`,
      link: overdueReceiveHref(customerId), originType: "customer", originId: customerId, occurrenceKey: `delinquent:${customerId}`, audience: { module: "finance" },
    });
  }
  const openNotifs = await listAll(store, "notifications", { filters: [["eq", "companyId", companyId], ["eq", "type", "receivable_overdue"], ["eq", "occurrenceStatus", "open"]] });
  let resolved = 0;
  for (const k of new Set(openNotifs.map((n) => n.occurrenceKey).filter((x): x is string => Boolean(x) && x.startsWith("delinquent:")))) {
    if (!delinquent.has(k.slice("delinquent:".length))) resolved += await resolveOccurrence(store, k);
  }
  return { delinquentCustomers: delinquent.size, notified, resolved };
}

registerRoutine("finance.delinquency", (store, companyId) => notifyDelinquentCustomers(store, companyId));
