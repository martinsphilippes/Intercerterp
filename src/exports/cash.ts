import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { querySessions, queryCashMovements } from "@/app/(app)/caixa/queries";
import { STATUS } from "@/components/ui/badge";

defineExport("cash_sessions", {
  module: "cash",
  title: "Sessões de caixa",
  columns: [
    { key: "number", label: "Caixa nº", type: "number" },
    { key: "branchName", label: "Filial" },
    { key: "terminalName", label: "Terminal" },
    { key: "operatorName", label: "Operador" },
    { key: "openedAt", label: "Abertura", type: "datetime" },
    { key: "closedAt", label: "Fechamento", type: "datetime" },
    { key: "status", label: "Situação" },
    { key: "version", label: "Versão", type: "number" },
    { key: "openingFund", label: "Fundo", type: "money" },
    { key: "salesCount", label: "Vendas", type: "number" },
    { key: "salesTotal", label: "Total vendido", type: "money" },
    { key: "cancelledCount", label: "Canceladas", type: "number" },
    { key: "expectedCash", label: "Dinheiro esperado", type: "money" },
    { key: "countedCash", label: "Dinheiro contado", type: "money" },
    { key: "totalDiff", label: "Diferença total", type: "money" },
    { key: "justification", label: "Justificativa" },
  ],
  rows: async (s, params) => (await querySessions(s.ctx, parseList(params))).map((r) => ({ ...r, status: STATUS.cash[r.status]?.[0] ?? r.status })),
});

defineExport("cash_movements", {
  module: "cash",
  title: "Movimentos de caixa",
  columns: [
    { key: "occurredAt", label: "Data/hora", type: "datetime" },
    { key: "sessionLabel", label: "Sessão" },
    { key: "number", label: "Nº", type: "number" },
    { key: "typeLabel", label: "Tipo" },
    { key: "reason", label: "Motivo" },
    { key: "accountName", label: "Conta origem/destino" },
    { key: "recipient", label: "Responsável" },
    { key: "createdByName", label: "Lançado por" },
    { key: "approvedByName", label: "Autorizado por" },
    { key: "amount", label: "Valor", type: "money" },
    { key: "notes", label: "Observações" },
  ],
  rows: (s, params) => queryCashMovements(s.ctx, parseList(params)),
});
