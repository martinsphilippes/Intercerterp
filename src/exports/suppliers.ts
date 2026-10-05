import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { querySuppliers } from "@/app/(app)/fornecedores/queries";

defineExport("suppliers", {
  module: "suppliers",
  title: "Fornecedores",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Razão social / nome" },
    { key: "tradeName", label: "Nome fantasia" },
    { key: "personType", label: "Tipo" },
    { key: "doc", label: "CNPJ/CPF" },
    { key: "email", label: "E-mail" },
    { key: "phone", label: "Telefone" },
    { key: "city", label: "Cidade" },
    { key: "uf", label: "UF" },
    { key: "paymentTermsText", label: "Condição de pagamento" },
    { key: "leadTimeDays", label: "Prazo de entrega (dias)", type: "number" },
    { key: "minOrderValue", label: "Pedido mínimo", type: "money" },
    { key: "products", label: "Produtos vinculados", type: "number" },
    { key: "openOrdersValue", label: "A receber de pedidos", type: "money" },
    { key: "purchased", label: "Comprado (recebido)", type: "money" },
    { key: "lastPurchase", label: "Último recebimento", type: "datetime" },
    { key: "payable", label: "A pagar em aberto", type: "money" },
    { key: "status", label: "Situação" },
  ],
  rows: (s, params) => querySuppliers(s.ctx, parseList(params)),
});
