import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { addDays, monthStart, today } from "@/lib/dates";
import { querySales, queryReturns } from "@/app/(app)/vendas/queries";

/** Mesmo atalho de período da tela (periodo=hoje|ontem|7d|30d|mes|mesant). */
function withPeriod(params: Record<string, any>) {
  const p = parseList(params);
  const t = today();
  const map: Record<string, [string, string]> = {
    hoje: [t, t], ontem: [addDays(t, -1), addDays(t, -1)], "7d": [addDays(t, -6), t], "30d": [addDays(t, -29), t], mes: [monthStart(t), t],
    mesant: [monthStart(addDays(monthStart(t), -1)), addDays(monthStart(t), -1)],
  };
  const r = map[p.f.periodo];
  if (r && !p.f.de && !p.f.ate) Object.assign(p.f, { de: r[0], ate: r[1] });
  return p;
}

defineExport("sales", {
  module: "sales",
  title: "Histórico de vendas",
  columns: [
    { key: "number", label: "Venda", type: "number" },
    { key: "completedAt", label: "Data e hora", type: "datetime" },
    { key: "branchName", label: "Filial" },
    { key: "terminalName", label: "Terminal" },
    { key: "operatorName", label: "Operador" },
    { key: "sellerName", label: "Vendedor" },
    { key: "customerName", label: "Cliente" },
    { key: "customerDoc", label: "CPF/CNPJ" },
    { key: "origin", label: "Origem" },
    { key: "itemsCount", label: "Itens", type: "number" },
    { key: "subtotal", label: "Bruto", type: "money" },
    { key: "discountTotal", label: "Descontos", type: "money" },
    { key: "surchargeTotal", label: "Acréscimos", type: "money" },
    { key: "total", label: "Total", type: "money" },
    { key: "returnedTotal", label: "Devolvido", type: "money" },
    { key: "net", label: "Líquido após devoluções", type: "money" },
    { key: "costTotal", label: "Custo registrado (líquido)", type: "money" },
    { key: "paymentMethods", label: "Pagamentos" },
    { key: "status", label: "Situação" },
    { key: "paymentStatus", label: "Pagamento" },
    { key: "fiscalStatus", label: "Situação fiscal" },
    { key: "fiscalNumber", label: "Nº documento fiscal", type: "number" },
    { key: "cancelReason", label: "Motivo do cancelamento" },
  ],
  rows: (s, params) => querySales(s.ctx, withPeriod(params)),
});

defineExport("returns", {
  module: "sales",
  title: "Trocas e devoluções",
  columns: [
    { key: "number", label: "Devolução", type: "number" },
    { key: "createdAt", label: "Data", type: "datetime" },
    { key: "branchName", label: "Filial" },
    { key: "saleNumber", label: "Venda", type: "number" },
    { key: "customerName", label: "Cliente" },
    { key: "kind", label: "Tipo" },
    { key: "compensation", label: "Compensação" },
    { key: "refundMethod", label: "Forma do estorno" },
    { key: "status", label: "Situação" },
    { key: "reason", label: "Motivo" },
    { key: "itemsTotal", label: "Valor devolvido", type: "money" },
    { key: "costTotal", label: "Custo retornado", type: "money" },
    { key: "voucherCode", label: "Vale-crédito" },
    { key: "voucherBalance", label: "Saldo do vale", type: "money" },
    { key: "difference", label: "Diferença da troca", type: "money" },
    { key: "userName", label: "Registrado por" },
  ],
  rows: (s, params) => queryReturns(s.ctx, withPeriod(params)),
});
