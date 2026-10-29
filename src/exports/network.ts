import "server-only";
import { defineExport } from "@/lib/exporters";
import { sp } from "@/lib/list";
import { FIN_KIND_LABEL, readClosing } from "@/domain/network";

/** §46 — extrato de um fechamento da rede (vendas incluídas), a mesma consulta da tela /rede/fechamentos/[id]. */
defineExport("network-closing", {
  module: "dashboard",
  title: "Fechamento da rede",
  columns: [
    { key: "closing", label: "Fechamento" },
    { key: "date", label: "Data do pagamento", type: "date" },
    { key: "protocol", label: "Venda" },
    { key: "productLabel", label: "Produto" },
    { key: "kind", label: "Tipo" },
    { key: "event", label: "Evento" },
    { key: "payer", label: "Quem paga" },
    { key: "payee", label: "Quem recebe" },
    { key: "amount", label: "Valor", type: "money" },
  ],
  rows: async (s, params) => {
    const { closing, entries } = await readClosing(s.ctx, sp(params, "id"));
    return entries.map((e) => ({
      closing: closing.code, date: e.date, protocol: e.protocol, productLabel: e.productLabel, kind: FIN_KIND_LABEL[e.kind] ?? e.kind, event: e.event === "reversal" ? "Estorno (crédito)" : "Venda paga",
      payer: e.payerName, payee: e.payeeName, amount: Number(e.amount),
    }));
  },
});
