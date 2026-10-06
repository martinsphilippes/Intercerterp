import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryAccountEntries, queryBankTransactions, queryCardReceivables, queryCashflowMovements, queryInstallments } from "@/app/(app)/financeiro/queries";

/** Exportações do Financeiro: mesmas consultas (e filtros de URL) das telas. */

const installmentColumns = (rec: boolean) => [
  { key: "titleNumber", label: "Título", type: "number" as const },
  { key: "installment", label: "Parcela", type: "number" as const },
  { key: "installments", label: "Total de parcelas", type: "number" as const },
  { key: "partyName", label: rec ? "Cliente / pagador" : "Fornecedor / favorecido" },
  { key: "description", label: "Descrição" },
  { key: "documentNumber", label: "Documento" },
  { key: "origin", label: "Origem" },
  { key: "issueDate", label: "Emissão", type: "date" as const },
  { key: "competenceDate", label: "Competência", type: "date" as const },
  { key: "dueDate", label: "Vencimento", type: "date" as const },
  { key: "amount", label: "Valor", type: "money" as const },
  { key: "paid", label: rec ? "Recebido (principal)" : "Pago (principal)", type: "money" as const },
  // abatimento por devolução de mercadoria (sem dinheiro): coluna própria, fora do recebido e dos descontos
  ...(rec ? [{ key: "abated", label: "Abatido (devolução)", type: "money" as const }] : []),
  { key: "extras", label: "Encargos − descontos", type: "money" as const },
  { key: "balance", label: "Saldo", type: "money" as const },
  { key: "state", label: "Situação" },
  { key: "daysLate", label: "Dias em atraso", type: "number" as const },
  { key: "category", label: "Categoria" },
  { key: "costCenter", label: "Centro de custo" },
  { key: "branch", label: "Filial" },
  ...(rec ? [{ key: "ourNumber", label: "Nosso número" }] : [{ key: "approvalStatus", label: "Autorização" }]),
];

defineExport("fin-receivables", {
  module: "finance",
  title: "Contas a receber",
  columns: installmentColumns(true),
  rows: (s, params) => queryInstallments(s.ctx, "receivable", parseList(params)),
});

defineExport("fin-payables", {
  module: "finance",
  title: "Contas a pagar",
  columns: installmentColumns(false),
  rows: (s, params) => queryInstallments(s.ctx, "payable", parseList(params)),
});

defineExport("fin-cashflow", {
  module: "finance",
  title: "Fluxo de caixa — movimentações",
  columns: [
    { key: "date", label: "Data", type: "date" },
    { key: "statusLabel", label: "Status" },
    { key: "description", label: "Movimentação" },
    { key: "party", label: "Cliente/fornecedor" },
    { key: "category", label: "Categoria" },
    { key: "account", label: "Conta" },
    { key: "document", label: "Documento" },
    { key: "amount", label: "Valor", type: "money" },
    { key: "balance", label: "Saldo acumulado", type: "money" },
  ],
  rows: async (s, params) => (await queryCashflowMovements(s.ctx, parseList(params))).rows.map((r) => ({ ...r, statusLabel: r.status === "realized" ? "Realizado" : "Previsto" })),
});

defineExport("fin-account-entries", {
  module: "finance",
  title: "Extrato interno da conta",
  columns: [
    { key: "seq", label: "Nº", type: "number" },
    { key: "date", label: "Data", type: "date" },
    { key: "description", label: "Descrição" },
    { key: "kindLabel", label: "Tipo" },
    { key: "category", label: "Categoria" },
    { key: "amount", label: "Valor", type: "money" },
    { key: "balanceAfter", label: "Saldo após", type: "money" },
    { key: "reconciledLabel", label: "Conciliado" },
  ],
  rows: async (s, params) => {
    const p = parseList(params);
    const accountId = p.f.account;
    if (!accountId) return [];
    const acc = await s.ctx.store.get("financial_accounts", accountId);
    if (!acc || acc.companyId !== s.ctx.companyId) return [];
    return (await queryAccountEntries(s.ctx, accountId, p)).map((r) => ({ ...r, reconciledLabel: r.reconciled ? "Sim" : "Não" }));
  },
});

defineExport("fin-bank-transactions", {
  module: "finance",
  title: "Linhas de extrato/retorno importadas",
  columns: [
    { key: "account", label: "Conta" },
    { key: "date", label: "Data", type: "date" },
    { key: "kind", label: "Tipo" },
    { key: "description", label: "Descrição" },
    { key: "docNumber", label: "Documento" },
    { key: "externalId", label: "FITID" },
    { key: "ourNumber", label: "Nosso número" },
    { key: "yourNumber", label: "Seu número" },
    { key: "amount", label: "Valor", type: "money" },
    { key: "status", label: "Situação" },
    { key: "lineNo", label: "Linha do arquivo", type: "number" },
  ],
  rows: (s, params) => queryBankTransactions(s.ctx, parseList(params)),
});

defineExport("fin-cards", {
  module: "finance",
  title: "Recebíveis de cartão",
  columns: [
    { key: "expectedDate", label: "Previsão", type: "date" },
    { key: "saleNumber", label: "Venda", type: "number" },
    { key: "saleDate", label: "Data da venda", type: "date" },
    { key: "method", label: "Meio" },
    { key: "nsu", label: "NSU" },
    { key: "installment", label: "Parcela" },
    { key: "gross", label: "Venda bruta", type: "money" },
    { key: "expectedFee", label: "Taxa prevista", type: "money" },
    { key: "expectedNet", label: "Líquido previsto", type: "money" },
    { key: "settledGross", label: "Liquidado bruto", type: "money" },
    { key: "settledFee", label: "Taxa efetiva", type: "money" },
    { key: "settledNet", label: "Liquidado líquido", type: "money" },
    { key: "settledAt", label: "Data da liquidação", type: "date" },
    { key: "status", label: "Situação" },
  ],
  rows: (s, params) => {
    const p = parseList(params);
    if (!p.f.status) p.f.status = "open";
    return queryCardReceivables(s.ctx, p);
  },
});
