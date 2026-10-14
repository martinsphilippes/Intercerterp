import "server-only";
import { defineExport } from "@/lib/exporters";
import { canDo } from "@/lib/permissions";
import { COMMISSION_BASE_LABEL, COMMISSION_LINE_LABEL, commissionReport } from "@/domain/commissions";
import { commissionParams } from "@/app/(app)/vendas/comissoes/params";

/** Apuração de comissões (VEN-05): uma linha por evento, com a mesma consulta e os mesmos filtros da tela. */
defineExport("sales-commissions", {
  module: "sales",
  title: "Comissões de vendedores",
  columns: [
    { key: "sellerName", label: "Vendedor" },
    { key: "kind", label: "Evento" },
    { key: "date", label: "Data", type: "date" },
    { key: "saleNumber", label: "Venda nº", type: "number" },
    { key: "docNumber", label: "Devolução nº", type: "number" },
    { key: "customerName", label: "Cliente" },
    { key: "base", label: "Base", type: "money" },
    { key: "rateBps", label: "Percentual (%)", type: "bps" },
    { key: "amount", label: "Comissão", type: "money" },
    { key: "situation", label: "Situação" },
    { key: "criterion", label: "Critério" },
    { key: "from", label: "Período de", type: "date" },
    { key: "to", label: "Período até", type: "date" },
  ],
  rows: async (s, params) => {
    if (!canDo(s.user, "sales.commissions")) return [];
    const q = commissionParams(params);
    const r = await commissionReport(s.ctx, q);
    return r.sellers.flatMap((sc) =>
      sc.lines.map((l) => ({
        sellerName: sc.sellerName, kind: COMMISSION_LINE_LABEL[l.kind], date: l.date, saleNumber: l.saleNumber, docNumber: l.docNumber, customerName: l.customerName ?? "",
        base: l.base, rateBps: l.rateBps, amount: l.amount,
        situation: l.closedIn ? (l.closedIn.otherBase ? `Fechada no outro critério (título nº ${l.closedIn.number})` : `Fechada (título nº ${l.closedIn.number})`) : "A fechar",
        criterion: COMMISSION_BASE_LABEL[r.base], from: r.from, to: r.to,
      })),
    );
  },
});
