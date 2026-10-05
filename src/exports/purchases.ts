import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryOrders } from "@/app/(app)/compras/pedidos/queries";
import { queryReceipts } from "@/app/(app)/compras/recebimentos/queries";
import { queryQuotations } from "@/app/(app)/compras/cotacoes/queries";
import { queryRequests } from "@/app/(app)/compras/aprovacoes/queries";
import { queryReplenishment } from "@/app/(app)/compras/reposicao/queries";

defineExport("purchase_orders", {
  module: "purchases",
  title: "Pedidos de compra",
  columns: [
    { key: "number", label: "Pedido", type: "number" },
    { key: "revision", label: "Revisão", type: "number" },
    { key: "status", label: "Situação" },
    { key: "origin", label: "Origem" },
    { key: "purpose", label: "Finalidade" },
    { key: "supplierName", label: "Fornecedor" },
    { key: "supplierDoc", label: "CNPJ/CPF" },
    { key: "branchName", label: "Filial" },
    { key: "createdAt", label: "Solicitado em", type: "datetime" },
    { key: "expectedDate", label: "Previsão", type: "date" },
    { key: "itemsCount", label: "Produtos", type: "number" },
    { key: "unitsQty", label: "Unidades", type: "qty" },
    { key: "subtotal", label: "Subtotal", type: "money" },
    { key: "discountTotal", label: "Descontos", type: "money" },
    { key: "ipiTotal", label: "IPI", type: "money" },
    { key: "freight", label: "Frete", type: "money" },
    { key: "insurance", label: "Seguro", type: "money" },
    { key: "otherExpenses", label: "Outras despesas", type: "money" },
    { key: "total", label: "Total", type: "money" },
    { key: "receivedValue", label: "Recebido", type: "money" },
    { key: "remainingValue", label: "Saldo a receber", type: "money" },
    { key: "paymentTermsText", label: "Condição de pagamento" },
    { key: "buyerName", label: "Comprador" },
    { key: "sentAt", label: "Enviado em", type: "datetime" },
  ],
  rows: (s, params) => queryOrders(s.ctx, parseList(params)),
});

defineExport("receipts", {
  module: "purchases",
  title: "Recebimentos de mercadorias",
  columns: [
    { key: "number", label: "Recebimento", type: "number" },
    { key: "status", label: "Situação" },
    { key: "nfeNumber", label: "NF-e" },
    { key: "nfeSeries", label: "Série" },
    { key: "nfeKey", label: "Chave de acesso" },
    { key: "nfeIssueDate", label: "Emissão", type: "datetime" },
    { key: "supplierName", label: "Fornecedor" },
    { key: "itemsCount", label: "Itens", type: "number" },
    { key: "receivedUnits", label: "Unidades recebidas", type: "qty" },
    { key: "productsTotal", label: "Produtos", type: "money" },
    { key: "freight", label: "Frete", type: "money" },
    { key: "otherExpenses", label: "Outras despesas", type: "money" },
    { key: "invoicedTotal", label: "Faturado (NF-e)", type: "money" },
    { key: "dueTotal", label: "Devido (recebido)", type: "money" },
    { key: "divergenceCount", label: "Divergências", type: "number" },
    { key: "confirmedAt", label: "Confirmado em", type: "datetime" },
  ],
  rows: (s, params) => queryReceipts(s.ctx, parseList(params)),
});

defineExport("quotations", {
  module: "purchases",
  title: "Cotações",
  columns: [
    { key: "number", label: "Cotação", type: "number" },
    { key: "title", label: "Título" },
    { key: "status", label: "Situação" },
    { key: "origin", label: "Origem" },
    { key: "createdAt", label: "Criada em", type: "datetime" },
    { key: "itemsCount", label: "Produtos", type: "number" },
    { key: "suppliersCount", label: "Fornecedores", type: "number" },
    { key: "proposalsCount", label: "Propostas", type: "number" },
    { key: "expiredCount", label: "Propostas vencidas", type: "number" },
    { key: "selectedTotal", label: "Seleção com frete", type: "money" },
    { key: "supplierNames", label: "Fornecedores convidados" },
  ],
  rows: (s, params) => queryQuotations(s.ctx, parseList(params)),
});

defineExport("purchase_requests", {
  module: "purchases",
  title: "Solicitações de compra (aprovação)",
  columns: [
    { key: "number", label: "Solicitação", type: "number" },
    { key: "revision", label: "Revisão", type: "number" },
    { key: "description", label: "Descrição" },
    { key: "status", label: "Situação" },
    { key: "stepLabel", label: "Etapa atual" },
    { key: "branchName", label: "Filial" },
    { key: "requesterName", label: "Solicitante" },
    { key: "ordersCount", label: "Pedidos", type: "number" },
    { key: "suppliers", label: "Fornecedores" },
    { key: "freight", label: "Frete", type: "money" },
    { key: "total", label: "Total com frete", type: "money" },
    { key: "createdAt", label: "Criada em", type: "datetime" },
    { key: "decidedAt", label: "Decidida em", type: "datetime" },
  ],
  rows: (s, params) => queryRequests(s.ctx, parseList(params)),
});

defineExport("replenishment", {
  module: "purchases",
  title: "Planejamento de reposição",
  columns: [
    { key: "sku", label: "SKU" },
    { key: "name", label: "Produto" },
    { key: "abc", label: "ABC" },
    { key: "supplierName", label: "Fornecedor" },
    { key: "physical", label: "Físico", type: "qty" },
    { key: "reserved", label: "Reservado", type: "qty" },
    { key: "available", label: "Disponível", type: "qty" },
    { key: "minQty", label: "Mínimo", type: "qty" },
    { key: "netConsumption", label: "Consumo líquido no período", type: "qty" },
    { key: "historyDays", label: "Dias de histórico", type: "number" },
    { key: "leadTimeDays", label: "Prazo (dias)", type: "number" },
    { key: "horizonDays", label: "Horizonte (dias)", type: "number" },
    { key: "target", label: "Alvo", type: "qty" },
    { key: "confirmedInHorizon", label: "Confirmado no horizonte", type: "qty" },
    { key: "confirmedOutside", label: "Fora do horizonte", type: "qty" },
    { key: "draftQty", label: "Em rascunho/análise", type: "qty" },
    { key: "grossNeed", label: "Necessidade", type: "qty" },
    { key: "suggested", label: "Sugestão", type: "qty" },
    { key: "unitCost", label: "Custo unitário", type: "money" },
    { key: "suggestedCost", label: "Estimativa", type: "money" },
    { key: "situation", label: "Situação" },
    { key: "stockoutDate", label: "Ruptura estimada", type: "date" },
    { key: "limitation", label: "Limitação" },
  ],
  rows: async (s, params) => (await queryReplenishment(s.ctx, params, s.branches.map((b) => b.id))).rows,
});
