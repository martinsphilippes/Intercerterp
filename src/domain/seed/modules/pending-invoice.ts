import { QTY } from "@/lib/money";
import { addDays, today } from "@/lib/dates";
import type { DemoRefs } from "../base";

/**
 * Demonstração da entrada com nota a confirmar (§40), idempotente (chaves de formulário fixas):
 *  - entrada REALIZADA aguardando a nota do fornecedor, com o prazo da nota vencendo em 3 dias (cadernos e canetas no
 *    depósito principal da Matriz, conta a pagar provisória) — aparece em Compras › Compras aguardando nota;
 *  - entrada PREVISTA para amanhã às 9h (agendas): "a chegar" nos saldos e no produto, conta a pagar prevista no fluxo
 *    de caixa; a rotina diária (ou a abertura do recebimento) a realiza na data.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const { createPendingInvoiceEntry, pendingInvoiceSettings } = await import("../../pending-invoice");
  const { localDateTimeToIso } = await import("../../stock");
  const admin = await refs.ctxFor("admin", "matriz");
  const supplier = refs.suppliers.papel;
  const caderno = refs.skus["caderno-u"];
  const caneta = refs.skus["caneta-u"];
  if (!supplier || !caderno || !caneta) return { skipped: true };
  const { dueDays } = await pendingInvoiceSettings(admin.store, admin.companyId, admin.branchId);
  // prazo da nota = data da entrada + prazo (padrão 15 dias) → vence em 3 dias
  const entryDate = addDays(today(), 3 - dueDays);
  const realized = await createPendingInvoiceEntry(admin, {
    supplierId: supplier.id, warehouseId: refs.warehouses["matriz-main"]?.id ?? null,
    items: [{ skuId: caderno.id, qty: 20 * QTY, unitCost: 990 }, { skuId: caneta.id, qty: 5 * QTY, unitCost: 2100 }],
    freight: 1500, paymentTermId: refs.terms["30-60"]?.id ?? null, entryAt: localDateTimeToIso(`${entryDate}T10:00`) ?? `${entryDate}T13:00:00.000Z`,
    nfeNumber: null, notes: "Demonstração: mercadoria entregue antes da nota fiscal (o fornecedor enviará a NF-e depois).", idemKey: "demo-pending-invoice-realized",
  });
  const agenda = refs.skus["agenda-u"] ?? caderno;
  const tomorrow = addDays(today(), 1);
  const scheduled = await createPendingInvoiceEntry(admin, {
    supplierId: supplier.id, warehouseId: refs.warehouses["matriz-main"]?.id ?? null,
    items: [{ skuId: agenda.id, qty: 12 * QTY, unitCost: agenda.costTotal || 990 }],
    paymentTermId: refs.terms["30-60"]?.id ?? null, entryAt: localDateTimeToIso(`${tomorrow}T09:00`) ?? `${tomorrow}T12:00:00.000Z`,
    notes: "Demonstração: entrega combinada para amanhã cedo (nota virá depois).", idemKey: "demo-pending-invoice-scheduled",
  });
  return { realized: realized.id, scheduled: scheduled.id };
}
