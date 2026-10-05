import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryBalances, queryMovements, queryTransfers, queryInventories, queryInventoryItems } from "@/app/(app)/estoque/queries";
import { TRANSFER_STATUS_LABEL, transferCode } from "@/domain/transfers";

defineExport("stock-balances", {
  module: "stock",
  title: "Saldos de estoque",
  columns: [
    { key: "productName", label: "Produto" },
    { key: "skuCode", label: "SKU" },
    { key: "skuName", label: "Variação" },
    { key: "unitCode", label: "Unidade" },
    { key: "branchName", label: "Filial" },
    { key: "warehouseName", label: "Depósito" },
    { key: "location", label: "Localização" },
    { key: "physical", label: "Físico", type: "qty" },
    { key: "reserved", label: "Reservado", type: "qty" },
    { key: "available", label: "Disponível", type: "qty" },
    { key: "inTransit", label: "Em trânsito", type: "qty" },
    { key: "minQty", label: "Mínimo", type: "qty" },
    { key: "maxQty", label: "Máximo/alvo", type: "qty" },
    { key: "safetyQty", label: "Segurança", type: "qty" },
    { key: "reorderMultiple", label: "Múltiplo de compra", type: "qty" },
    { key: "avgCost", label: "Custo médio", type: "money" },
    { key: "value", label: "Valor (custo médio)", type: "money" },
    { key: "lastMovementAt", label: "Último movimento", type: "datetime" },
  ],
  rows: (s, params) => queryBalances(s.ctx, parseList(params)),
});

defineExport("stock-movements", {
  module: "stock",
  title: "Movimentos de estoque",
  columns: [
    { key: "occurredAt", label: "Data", type: "datetime" },
    { key: "productName", label: "Produto" },
    { key: "skuCode", label: "SKU" },
    { key: "unitCode", label: "Unidade" },
    { key: "typeLabel", label: "Tipo" },
    { key: "qty", label: "Quantidade", type: "qty" },
    { key: "branchName", label: "Filial" },
    { key: "warehouseName", label: "Depósito" },
    { key: "balanceBefore", label: "Saldo anterior", type: "qty" },
    { key: "balanceAfter", label: "Saldo posterior", type: "qty" },
    { key: "unitCost", label: "Custo unitário", type: "money" },
    { key: "totalCost", label: "Custo total", type: "money" },
    { key: "avgCostAfter", label: "Custo médio após", type: "money" },
    { key: "originLabel", label: "Origem / referência" },
    { key: "reason", label: "Motivo" },
    { key: "documentRef", label: "Documento" },
    { key: "lot", label: "Lote" },
    { key: "lotExpiry", label: "Validade", type: "date" },
    { key: "notes", label: "Observações" },
    { key: "userName", label: "Usuário" },
  ],
  rows: async (s, params) => (await queryMovements(s.ctx, parseList(params))).rows,
});

defineExport("transfers", {
  module: "stock",
  title: "Transferências entre filiais",
  columns: [
    { key: "code", label: "Código" },
    { key: "createdAt", label: "Criada em", type: "datetime" },
    { key: "fromName", label: "Origem" },
    { key: "toName", label: "Destino" },
    { key: "itemsCount", label: "Produtos", type: "number" },
    { key: "qtyTotal", label: "Unidades", type: "qty" },
    { key: "pendingTotal", label: "Pendente em trânsito", type: "qty" },
    { key: "costTotal", label: "Valor de custo", type: "money" },
    { key: "statusLabel", label: "Situação" },
    { key: "responsibleName", label: "Responsável" },
    { key: "expectedAt", label: "Previsão de chegada", type: "date" },
    { key: "shippedAt", label: "Expedida em", type: "datetime" },
    { key: "receivedAt", label: "Recebida em", type: "datetime" },
    { key: "divergenceCount", label: "Divergências", type: "number" },
    { key: "documentRef", label: "Documento" },
  ],
  rows: async (s, params) => (await queryTransfers(s.ctx, parseList(params))).map((t) => ({ ...t, code: transferCode(t.number), statusLabel: TRANSFER_STATUS_LABEL[t.status] ?? t.status })),
});

defineExport("inventories", {
  module: "stock",
  title: "Inventários",
  columns: [
    { key: "code", label: "Código" },
    { key: "baseAt", label: "Base (abertura)", type: "datetime" },
    { key: "branchName", label: "Filial" },
    { key: "warehouseName", label: "Depósito" },
    { key: "scopeLabel", label: "Escopo" },
    { key: "status", label: "Situação" },
    { key: "itemsTotal", label: "Itens", type: "number" },
    { key: "counted", label: "Contados", type: "number" },
    { key: "withDiff", label: "Com diferença", type: "number" },
    { key: "diffQty", label: "Diferença (qtd)", type: "qty" },
    { key: "diffValue", label: "Diferença (valor)", type: "money" },
    { key: "completedAt", label: "Concluído em", type: "datetime" },
    { key: "completedByName", label: "Concluído por" },
  ],
  rows: (s, params) => queryInventories(s.ctx, parseList(params)),
});

defineExport("inventory-items", {
  module: "stock",
  title: "Inventário — relatório de diferenças",
  columns: [
    { key: "skuCode", label: "SKU" },
    { key: "productName", label: "Produto" },
    { key: "unitCode", label: "Unidade" },
    { key: "location", label: "Localização" },
    { key: "baseQty", label: "Saldo base", type: "qty" },
    { key: "movementsDuringCount", label: "Movimentos durante a contagem", type: "qty" },
    { key: "expectedQty", label: "Esperado", type: "qty" },
    { key: "countedQty", label: "Contado", type: "qty" },
    { key: "recountQty", label: "Recontagem", type: "qty" },
    { key: "finalQty", label: "Quantidade final", type: "qty" },
    { key: "difference", label: "Diferença", type: "qty" },
    { key: "unitCost", label: "Custo médio", type: "money" },
    { key: "differenceValue", label: "Diferença (valor)", type: "money" },
    { key: "note", label: "Observação" },
    { key: "countedByName", label: "Contado por" },
    { key: "countedAt", label: "Contado em", type: "datetime" },
  ],
  rows: async (s, params) => {
    const p = parseList(params);
    return queryInventoryItems(s.ctx, String(params.id ?? ""), p);
  },
});
