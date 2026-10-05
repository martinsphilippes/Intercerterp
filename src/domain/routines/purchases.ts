import { listAll } from "@/lib/db";
import { notify } from "@/lib/core/notify";
import { today, diffDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { registerRoutine } from "../scheduler";

/**
 * Rotina diária de acompanhamento de compras (idempotente: uma ocorrência por pedido, deduplicada):
 *  - pedido aprovado há mais de 1 dia sem registro de envio ao fornecedor → avisa quem compra;
 *  - pedido enviado/parcial com previsão de entrega vencida e saldo a receber → avisa compras e recebimento.
 * As ocorrências são resolvidas na origem (envio registrado / pedido recebido ou cancelado).
 */
registerRoutine("purchases.followup", async (store, companyId) => {
  const t = today();
  const orders = await listAll(store, "purchase_orders", { filters: [["eq", "companyId", companyId], ["eq", "status", ["approved", "sent", "partial"]]] });
  let unsent = 0;
  let late = 0;
  for (const o of orders) {
    const supplier = o.supplierSnapshot?.tradeName || o.supplierSnapshot?.name || "fornecedor";
    if (o.status === "approved" && o.approvedAt && diffDays(o.approvedAt.slice(0, 10), t) >= 1) {
      unsent += await notify(store, {
        companyId, branchId: o.branchId, type: "deadline", priority: "normal",
        title: `Pedido nº ${o.number} aprovado e ainda não enviado`,
        body: `${supplier} · ${formatMoney(o.total)}. A aprovação não envia o pedido: registre o envio ao fornecedor.`,
        link: `/compras/pedidos/${o.id}`, originType: "purchase_order", originId: o.id, occurrenceKey: `po_unsent:${o.id}`,
        audience: { module: "purchases" },
      });
    }
    if (["sent", "partial"].includes(o.status) && o.expectedDate && o.expectedDate < t) {
      late += await notify(store, {
        companyId, branchId: o.branchId, type: "deadline", priority: "high",
        title: `Entrega atrasada: pedido nº ${o.number}`,
        body: `${supplier} · previsão ${o.expectedDate.split("-").reverse().join("/")} · saldo ${formatMoney(Math.max(0, o.total - (o.receivedValue ?? 0)))}.`,
        link: `/compras/pedidos/${o.id}`, originType: "purchase_order", originId: o.id, occurrenceKey: `po_late:${o.id}`,
        audience: { action: "purchase.receive" },
      });
    }
  }
  return { unsent, late };
});
