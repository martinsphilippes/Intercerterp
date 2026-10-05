import type { Store } from "@/lib/db/types";

/** Rótulo e rota de origem por tipo de entidade auditada (link "abrir origem"). */
export const ENTITY_LABEL: Record<string, string> = {
  user: "Usuário",
  role: "Perfil",
  company: "Empresa",
  branch: "Filial",
  terminal: "Terminal",
  backup: "Backup",
  restore_job: "Restauração",
  ticket: "Chamado",
  setting: "Parâmetro",
  integration: "Integração",
  job: "Tarefa",
  export: "Exportação",
  customer: "Cliente",
  supplier: "Fornecedor",
  product: "Produto",
  price: "Preço",
  price_table: "Tabela de preço",
  category: "Categoria",
  brand: "Marca",
  unit: "Unidade",
  product_import: "Importação de produtos",
  sale: "Venda",
  cart: "Atendimento/pré-venda",
  return: "Devolução/troca",
  cash_session: "Sessão de caixa",
  stock_movement: "Movimento de estoque",
  transfer: "Transferência",
  inventory: "Inventário",
  title: "Título",
  account_entry: "Lançamento em conta",
  fin_transfer: "Transferência entre contas",
  financial_account: "Conta financeira",
  bank_import: "Importação bancária",
  bank_transaction: "Transação bancária",
  reconciliation: "Conciliação",
  purchase_order: "Pedido de compra",
  purchase_request: "Solicitação de compra",
  quotation: "Cotação",
  receipt: "Recebimento de mercadoria",
  replenishment: "Reposição",
  approval_policy: "Política de aprovação",
  fiscal_document: "Documento fiscal",
  fiscal_config: "Configuração fiscal",
  fiscal_obligation: "Obrigação fiscal",
  fiscal_export: "Exportação fiscal",
  tax_group: "Grupo tributário",
  goal: "Meta",
  file: "Arquivo",
};

const SIMPLE: Record<string, (id: string) => string> = {
  user: (id) => `/administracao/usuarios/${id}`,
  role: (id) => `/administracao/usuarios/perfis/${id}`,
  company: (id) => `/administracao/empresas/${id}`,
  branch: (id) => `/administracao/empresas/filiais/${id}`,
  terminal: (id) => `/administracao/terminais/${id}`,
  backup: (id) => `/administracao/backups/${id}`,
  ticket: (id) => `/ajuda/chamados/${id}`,
  setting: () => `/administracao/parametros`,
  integration: () => `/administracao/integracoes`,
  job: (id) => `/administracao/integracoes?tarefa=${id}`,
  customer: (id) => `/clientes/${id}`,
  supplier: (id) => `/fornecedores/${id}`,
  product: (id) => `/produtos/${id}`,
  price_table: () => `/produtos/cadastros`,
  category: () => `/produtos/cadastros`,
  brand: () => `/produtos/cadastros`,
  unit: () => `/produtos/cadastros`,
  sale: (id) => `/vendas/${id}`,
  return: (id) => `/vendas/devolucoes/${id}`,
  cash_session: (id) => `/caixa/${id}`,
  transfer: (id) => `/estoque/transferencias/${id}`,
  inventory: (id) => `/estoque/inventarios/${id}`,
  stock_movement: () => `/estoque/movimentos`,
  financial_account: () => `/financeiro/cadastros`,
  bank_import: () => `/financeiro/conciliacao`,
  bank_transaction: () => `/financeiro/conciliacao`,
  reconciliation: () => `/financeiro/conciliacao`,
  fin_transfer: () => `/financeiro/fluxo-caixa`,
  account_entry: () => `/financeiro/fluxo-caixa`,
  purchase_order: (id) => `/compras/pedidos/${id}`,
  purchase_request: (id) => `/compras/aprovacoes/${id}`,
  quotation: (id) => `/compras/cotacoes/${id}`,
  receipt: (id) => `/compras/recebimentos/${id}`,
  replenishment: () => `/compras/reposicao`,
  approval_policy: () => `/compras/aprovacoes`,
  fiscal_config: () => `/fiscal/configuracoes`,
  fiscal_obligation: () => `/fiscal/relatorios?tab=obrigacoes`,
  fiscal_export: () => `/fiscal/relatorios`,
  tax_group: () => `/fiscal/configuracoes`,
  goal: () => `/dashboard`,
};

/** Rota da origem; alguns tipos dependem do registro (ex.: modelo do documento fiscal, título a pagar/receber). */
export async function originHref(store: Store, entityType: string | null, entityId: string | null, related: string[] = []): Promise<string | null> {
  if (!entityType) return null;
  if (entityType === "fiscal_document" && entityId) {
    const d = await store.get("fiscal_documents", entityId).catch(() => null);
    return d ? `/fiscal/${d.model}/${d.id}` : null;
  }
  if (entityType === "title" && entityId) {
    const t = await store.get("titles", entityId).catch(() => null);
    return t ? `/financeiro/${t.kind === "payable" ? "pagar" : "receber"}/${t.id}` : null;
  }
  if (entityType === "restore_job") {
    const b = related.find((r) => r.startsWith("backup:"));
    return b ? `/administracao/backups/${b.slice(7)}?tab=restauracao` : null;
  }
  if (entityType === "export" || entityType === "file") return null;
  const f = SIMPLE[entityType];
  return f && (entityId || f.length === 0) ? f(entityId ?? "") : null;
}

/** Rótulo e rota para referências "tipo:id" relacionadas. */
export function refLabel(ref: string) {
  const [type, id] = ref.split(":");
  return { type, id, label: ENTITY_LABEL[type] ?? type };
}
