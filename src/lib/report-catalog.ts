import { can, canDo, type ModuleKey, type SpecialAction } from "./permissions";

/**
 * Central de relatórios (PLA-09): catálogo de TODOS os relatórios e consultas exportáveis do sistema, por área.
 * Não há relatório novo aqui — cada item aponta para a tela que já existe (mesma consulta da tela, do CSV e do XLSX);
 * `exports` lista as chaves de `/api/export/[key]` com atalho de CSV/XLSX no recorte padrão da tela.
 * Visibilidade: módulo (ver), operação especial e recurso (`feature.<chave>`) — as mesmas regras do menu.
 */

export interface ReportEntry {
  key: string;
  area: string;
  title: string;
  description: string;
  href: string;
  module: ModuleKey;
  action?: SpecialAction;
  /** recurso em Parâmetros › Recursos (`feature.<chave>`) */
  feature?: string;
  /** exportações (`/api/export/<chave>`) com atalho na central */
  exports?: string[];
  /** palavras para a busca da central */
  tags?: string;
}

export const REPORT_AREAS = ["Gestão", "Vendas e caixa", "Produtos e estoque", "Compras", "Clientes e fornecedores", "Financeiro", "Fiscal", "Administração"] as const;

export const REPORT_CATALOG: ReportEntry[] = [
  // Gestão
  { key: "painel", area: "Gestão", title: "Painel do gestor", description: "Indicadores do período: faturamento, ticket médio, margem, comparativos e alertas.", href: "/dashboard", module: "dashboard", tags: "kpi indicadores" },
  { key: "gerenciais", area: "Gestão", title: "Relatórios gerenciais", description: "Resultado por unidade e quebras por dia, categoria, operador e meio de pagamento.", href: "/relatorios/gerenciais", module: "reports", exports: ["reports-units", "reports-breakdown"], tags: "resultado filial unidade" },
  { key: "curva-abc", area: "Gestão", title: "Produtos e curva ABC", description: "Classificação ABC por receita, margem ou quantidade, com composição por produto.", href: "/relatorios/curva-abc", module: "reports", exports: ["reports-abc"], tags: "abc pareto" },
  { key: "metas", area: "Gestão", title: "Metas comerciais", description: "Metas do mês por filial e vendedor com o realizado.", href: "/dashboard/metas", module: "dashboard", exports: ["reports-goals"], tags: "meta vendedor" },
  // Vendas e caixa
  { key: "vendas", area: "Vendas e caixa", title: "Histórico de vendas", description: "Vendas concluídas e canceladas com filtros por período, filial, operador, cliente e pagamento.", href: "/vendas", module: "sales", exports: ["sales"], tags: "cupom pdv" },
  { key: "devolucoes", area: "Vendas e caixa", title: "Trocas e devoluções", description: "Devoluções por período, motivo e forma de reembolso.", href: "/vendas/devolucoes", module: "sales", exports: ["returns"], tags: "troca" },
  { key: "comissoes", area: "Vendas e caixa", title: "Comissões de vendedores", description: "Apuração por período, filial e vendedor; fechamento em conta a pagar; relatório imprimível.", href: "/vendas/comissoes", module: "sales", action: "sales.commissions", feature: "comissoes", exports: ["sales-commissions"], tags: "vendedor" },
  { key: "caixa", area: "Vendas e caixa", title: "Sessões de caixa", description: "Aberturas, fechamentos, divergências e relatório de cada sessão do PDV.", href: "/caixa", module: "cash", exports: ["cash_sessions"], tags: "fechamento sangria suprimento" },
  // Produtos e estoque
  { key: "produtos", area: "Produtos e estoque", title: "Produtos e serviços", description: "Cadastro com preços, custos, NCM e situação.", href: "/produtos", module: "products", exports: ["products"], tags: "cadastro preço" },
  { key: "saldos", area: "Produtos e estoque", title: "Saldos de estoque", description: "Físico, reservado, disponível, em trânsito e valor pelo custo médio, por depósito.", href: "/estoque", module: "stock", exports: ["stock-balances"], tags: "posição estoque valorizado" },
  { key: "movimentos", area: "Produtos e estoque", title: "Movimentação de estoque", description: "Kardex: entradas e saídas com saldo anterior/posterior e custo médio.", href: "/estoque/movimentos", module: "stock", exports: ["stock-movements"], tags: "kardex" },
  { key: "inventario-fiscal", area: "Produtos e estoque", title: "Inventário em data-base", description: "Estoque existente numa data (ex.: 31/12) valorizado pelo custo médio da data, com totais por NCM e categoria — Livro de Registro de Inventário.", href: "/estoque/inventario-fiscal", module: "stock", feature: "inventarioFiscal", exports: ["stock-fiscal-inventory"], tags: "livro inventário fiscal bloco h contador" },
  { key: "inventarios", area: "Produtos e estoque", title: "Inventários (contagens)", description: "Contagens de estoque, diferenças e ajustes.", href: "/estoque/inventarios", module: "stock", exports: ["inventories"], tags: "contagem balanço" },
  { key: "transferencias", area: "Produtos e estoque", title: "Transferências entre filiais", description: "Transferências por situação, com divergências e trânsito.", href: "/estoque/transferencias", module: "stock", exports: ["transfers"] },
  { key: "validades", area: "Produtos e estoque", title: "Validades e lotes", description: "Lotes com saldo, vencidos e a vencer.", href: "/estoque/validades", module: "stock", feature: "lotes", tags: "lote vencimento" },
  // Compras
  { key: "reposicao", area: "Compras", title: "Planejamento de reposição", description: "Sugestão de compra por cobertura, consumo e mínimo.", href: "/compras/reposicao", module: "purchases", exports: ["replenishment"], tags: "sugestão compra" },
  { key: "pedidos-compra", area: "Compras", title: "Pedidos de compra", description: "Pedidos por fornecedor, situação e período.", href: "/compras/pedidos", module: "purchases", exports: ["purchase_orders"] },
  { key: "recebimentos", area: "Compras", title: "Recebimento de mercadorias", description: "Entradas de notas, conferência e custos.", href: "/compras/recebimentos", module: "purchases", exports: ["receipts"], tags: "nota de compra entrada" },
  { key: "cotacoes", area: "Compras", title: "Cotações", description: "Cotações e propostas de fornecedores.", href: "/compras/cotacoes", module: "purchases", exports: ["quotations"] },
  // Clientes e fornecedores
  { key: "clientes", area: "Clientes e fornecedores", title: "Clientes", description: "Cadastro de clientes com limite de crédito e situação.", href: "/clientes", module: "customers", exports: ["customers"] },
  { key: "fidelidade", area: "Clientes e fornecedores", title: "Programa de fidelidade", description: "Ranking de pontos e movimentos.", href: "/clientes/fidelidade", module: "customers", feature: "fidelidade", tags: "pontos" },
  { key: "fornecedores", area: "Clientes e fornecedores", title: "Fornecedores", description: "Cadastro de fornecedores e transportadoras.", href: "/fornecedores", module: "suppliers", exports: ["suppliers"] },
  // Financeiro
  { key: "receber", area: "Financeiro", title: "Contas a receber", description: "Parcelas a receber por vencimento, situação e cliente (aging pelo filtro de vencidos).", href: "/financeiro/receber", module: "finance", exports: ["fin-receivables"], tags: "títulos inadimplência" },
  { key: "pagar", area: "Financeiro", title: "Contas a pagar", description: "Obrigações por vencimento, situação, autorização e fornecedor.", href: "/financeiro/pagar", module: "finance", exports: ["fin-payables"], tags: "títulos" },
  { key: "fluxo", area: "Financeiro", title: "Fluxo de caixa", description: "Realizado e previsto por período, conta e categoria.", href: "/financeiro/fluxo-caixa", module: "finance", exports: ["fin-cashflow"] },
  { key: "cartoes", area: "Financeiro", title: "Recebíveis de cartão", description: "Previsão e liquidação de vendas no cartão.", href: "/financeiro/cartoes", module: "finance", exports: ["fin-cards"] },
  { key: "conciliacao", area: "Financeiro", title: "Conciliação bancária", description: "Extratos importados e lançamentos conciliados.", href: "/financeiro/conciliacao", module: "finance" },
  // Fiscal
  { key: "fiscal-resumo", area: "Fiscal", title: "Resumo fiscal do período", description: "Documentos emitidos, faturamento e tributos do período.", href: "/fiscal/relatorios", module: "fiscal" },
  { key: "fiscal-documentos", area: "Fiscal", title: "Documentos fiscais do período", description: "NF-e, NFC-e e NFS-e do período com tributos aproximados.", href: "/fiscal/relatorios?tab=documentos", module: "fiscal", exports: ["fiscal-documentos"] },
  { key: "fiscal-livro", area: "Fiscal", title: "Livro de registro de saídas", description: "Saídas por documento, CFOP e alíquota (apoio à escrituração).", href: "/fiscal/relatorios?tab=livro", module: "fiscal", exports: ["fiscal-livro-saidas"], tags: "livro saídas" },
  { key: "fiscal-ncm", area: "Fiscal", title: "Tributos por NCM", description: "Base e tributos agrupados por NCM.", href: "/fiscal/relatorios?tab=ncm", module: "fiscal", exports: ["fiscal-ncm"] },
  { key: "fiscal-cfop", area: "Fiscal", title: "Resumo contábil por CFOP", description: "Totais por CFOP para a contabilidade.", href: "/fiscal/relatorios?tab=contabil", module: "fiscal", exports: ["fiscal-cfop"] },
  { key: "fiscal-cancelamentos", area: "Fiscal", title: "Cancelamentos e rejeições", description: "Documentos cancelados e rejeitados no período.", href: "/fiscal/relatorios?tab=cancelamentos", module: "fiscal", exports: ["fiscal-cancelamentos", "fiscal-rejeicoes"] },
  { key: "fiscal-pacote", area: "Fiscal", title: "Exportação à contabilidade", description: "Pacote com XML e relatórios do período para o contador.", href: "/fiscal/relatorios?tab=exportacao", module: "fiscal", tags: "xml contador pacote" },
  { key: "fiscal-obrigacoes", area: "Fiscal", title: "Obrigações fiscais", description: "Calendário e situação das obrigações acessórias.", href: "/fiscal/relatorios?tab=obrigacoes", module: "fiscal", exports: ["fiscal-obrigacoes"] },
  // Administração
  { key: "auditoria", area: "Administração", title: "Histórico e auditoria", description: "Quem fez o quê, quando e de onde, com antes/depois.", href: "/administracao/historico", module: "admin", exports: ["admin.audit"], tags: "log" },
  { key: "usuarios", area: "Administração", title: "Usuários e perfis", description: "Usuários, perfis e permissões.", href: "/administracao/usuarios", module: "admin", exports: ["admin.users", "admin.roles"] },
  { key: "importacoes", area: "Administração", title: "Importações de cadastros e saldos", description: "Resultado por linha de cada importação de clientes, fornecedores, saldos e títulos.", href: "/administracao/importacao", module: "admin", feature: "importacaoCadastros", tags: "migração implantação csv" },
];

type User = Parameters<typeof can>[0];

/** Relatórios que o usuário pode abrir (módulo, operação especial e recurso ligado). */
export function visibleReports(user: User, featureEnabled: (key: string) => boolean): ReportEntry[] {
  return REPORT_CATALOG.filter((r) => can(user, r.module, "view") && (!r.action || canDo(user, r.action)) && (!r.feature || featureEnabled(r.feature)));
}
