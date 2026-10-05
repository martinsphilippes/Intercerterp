import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryCustomers } from "@/app/(app)/clientes/queries";

defineExport("customers", {
  module: "customers",
  title: "Clientes",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome / razão social" },
    { key: "personType", label: "Tipo" },
    { key: "doc", label: "CPF/CNPJ" },
    { key: "email", label: "E-mail" },
    { key: "mobile", label: "Celular" },
    { key: "city", label: "Cidade" },
    { key: "uf", label: "UF" },
    { key: "purchases", label: "Compras", type: "number" },
    { key: "totalPurchased", label: "Total comprado (líquido)", type: "money" },
    { key: "lastPurchase", label: "Última compra", type: "datetime" },
    { key: "openBalance", label: "Saldo em aberto", type: "money" },
    { key: "creditLimit", label: "Limite de crédito", type: "money" },
    { key: "status", label: "Situação" },
  ],
  rows: (s, params) => queryCustomers(s.ctx, parseList(params)),
});
