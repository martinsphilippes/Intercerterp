import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryProducts } from "@/app/(app)/produtos/queries";

defineExport("products", {
  module: "products",
  title: "Produtos e serviços",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "typeLabel", label: "Tipo" },
    { key: "skuCodes", label: "SKUs" },
    { key: "barcodes", label: "GTIN/EAN" },
    { key: "unitCode", label: "Unidade" },
    { key: "categoryName", label: "Categoria" },
    { key: "brandName", label: "Marca" },
    { key: "price", label: "Preço (tabela padrão)", type: "money" },
    { key: "priceMax", label: "Preço máximo entre variações", type: "money" },
    { key: "cost", label: "Custo total", type: "money" },
    { key: "marginBps", label: "Margem (%)", type: "bps" },
    { key: "stockText", label: "Disponível por filial" },
    { key: "available", label: "Disponível total", type: "qty" },
    { key: "inTransit", label: "Em trânsito", type: "qty" },
    { key: "stockValue", label: "Valor em estoque (custo médio)", type: "money" },
    { key: "ncm", label: "NCM" },
    { key: "cest", label: "CEST" },
    { key: "origin", label: "Origem" },
    { key: "fiscalIssuesText", label: "Pendências fiscais" },
    { key: "statusLabel", label: "Situação" },
    { key: "pdvLabel", label: "Disponível no PDV" },
    { key: "ecommerceLabel", label: "Loja virtual" },
  ],
  rows: async (s, params) => {
    const { rows } = await queryProducts(s.ctx, parseList(params));
    return rows.map((r) => ({
      ...r,
      typeLabel: r.type === "service" ? "Serviço" : "Produto",
      statusLabel: r.status === "inactive" ? "Inativo" : "Ativo",
      pdvLabel: r.availablePdv ? "Sim" : "Não",
      ecommerceLabel: r.availableEcommerce ? "Sim" : "Não",
      fiscalIssuesText: r.fiscalIssues.join("; "),
    }));
  },
});
