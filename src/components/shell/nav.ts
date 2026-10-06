import type { ModuleKey } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  module: ModuleKey;
  icon: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Navegação por grupos funcionais (9 grupos da referência). */
export const NAV: NavGroup[] = [
  { label: "Gestão", items: [{ href: "/dashboard", label: "Painel do gestor", module: "dashboard", icon: "LayoutDashboard" }] },
  {
    label: "Vendas e caixa",
    items: [
      { href: "/pdv", label: "Frente de caixa (PDV)", module: "pdv", icon: "ScanBarcode" },
      { href: "/vendas", label: "Histórico de vendas", module: "sales", icon: "Receipt" },
      { href: "/vendas/devolucoes", label: "Trocas e devoluções", module: "sales", icon: "Undo2" },
      { href: "/caixa", label: "Caixa (abertura, movimentos, fechamento)", module: "cash", icon: "Wallet" },
    ],
  },
  {
    label: "Produtos e estoque",
    items: [
      { href: "/produtos", label: "Produtos e serviços", module: "products", icon: "Package" },
      { href: "/estoque", label: "Saldos de estoque", module: "stock", icon: "Boxes" },
      { href: "/estoque/movimentos", label: "Movimentação de estoque", module: "stock", icon: "ArrowLeftRight" },
      { href: "/estoque/transferencias", label: "Transferências", module: "stock", icon: "Truck" },
      { href: "/estoque/inventarios", label: "Inventário e contagem", module: "stock", icon: "ClipboardList" },
      { href: "/produtos/cadastros", label: "Cadastros auxiliares", module: "products", icon: "Tags" },
    ],
  },
  { label: "Clientes", items: [{ href: "/clientes", label: "Gestão de clientes", module: "customers", icon: "Users" }] },
  {
    label: "Financeiro",
    items: [
      { href: "/financeiro/receber", label: "Contas a receber", module: "finance", icon: "ArrowDownCircle" },
      { href: "/financeiro/pagar", label: "Contas a pagar", module: "finance", icon: "ArrowUpCircle" },
      { href: "/financeiro/fluxo-caixa", label: "Fluxo de caixa", module: "finance", icon: "LineChart" },
      { href: "/financeiro/conciliacao", label: "Conciliação bancária", module: "finance", icon: "Landmark" },
      { href: "/financeiro/cartoes", label: "Recebíveis de cartão", module: "finance", icon: "CreditCard" },
      { href: "/financeiro/cadastros", label: "Cadastros financeiros", module: "finance", icon: "Settings2" },
    ],
  },
  {
    label: "Compras",
    items: [
      { href: "/fornecedores", label: "Fornecedores", module: "suppliers", icon: "Factory" },
      { href: "/compras/reposicao", label: "Planejamento de reposição", module: "purchases", icon: "TrendingDown" },
      { href: "/compras/cotacoes", label: "Cotações", module: "purchases", icon: "Scale" },
      { href: "/compras/pedidos", label: "Pedidos de compra", module: "purchases", icon: "ShoppingCart" },
      { href: "/compras/aprovacoes", label: "Aprovação de compras", module: "purchases", icon: "BadgeCheck" },
      { href: "/compras/recebimentos", label: "Recebimento de mercadorias", module: "purchases", icon: "PackageCheck" },
    ],
  },
  {
    label: "Fiscal",
    items: [
      { href: "/fiscal/nfe", label: "NF-e", module: "fiscal", icon: "FileText" },
      { href: "/fiscal/nfce", label: "NFC-e", module: "fiscal", icon: "FileCheck2" },
      { href: "/fiscal/nfse", label: "NFS-e", module: "fiscal", icon: "FileSignature" },
      { href: "/fiscal/relatorios", label: "Relatórios fiscais", module: "fiscal", icon: "FileBarChart" },
      { href: "/fiscal/configuracoes", label: "Configurações fiscais", module: "fiscal", icon: "Cog" },
    ],
  },
  {
    label: "Análise",
    items: [
      { href: "/relatorios/gerenciais", label: "Relatórios gerenciais", module: "reports", icon: "BarChart3" },
      { href: "/relatorios/curva-abc", label: "Produtos e curva ABC", module: "reports", icon: "PieChart" },
    ],
  },
  {
    label: "Administração",
    items: [
      { href: "/administracao/usuarios", label: "Usuários e permissões", module: "admin", icon: "ShieldCheck" },
      { href: "/administracao/empresas", label: "Empresas e filiais", module: "admin", icon: "Building2" },
      { href: "/administracao/terminais", label: "Terminais do PDV", module: "admin", icon: "Monitor" },
      { href: "/administracao/integracoes", label: "Central de integrações", module: "admin", icon: "Plug" },
      { href: "/administracao/backups", label: "Backup e restauração", module: "admin", icon: "DatabaseBackup" },
      { href: "/administracao/historico", label: "Histórico e auditoria", module: "admin", icon: "History" },
      { href: "/administracao/parametros", label: "Parâmetros", module: "admin", icon: "SlidersHorizontal" },
    ],
  },
  {
    label: "Suporte",
    items: [
      { href: "/notificacoes", label: "Notificações", module: "dashboard", icon: "Bell" },
      { href: "/ajuda", label: "Ajuda e suporte", module: "support", icon: "LifeBuoy" },
    ],
  },
];

/** Navegação do ESCRITÓRIO CONTÁBIL: carteira, caixa de entrada, equipe, financeiro próprio, fiscal de serviços e administração. */
export const NAV_ACCOUNTING: NavGroup[] = [
  { label: "Gestão", items: [{ href: "/contabil", label: "Painel da carteira", module: "accounting", icon: "LayoutDashboard" }] },
  {
    label: "Carteira",
    items: [
      { href: "/contabil/clientes", label: "Clientes contábeis", module: "accounting", icon: "Users" },
      { href: "/contabil/grupos", label: "Grupos de clientes", module: "accounting", icon: "Building2" },
      { href: "/contabil/entregas", label: "Caixa de entrada (entregas)", module: "accounting", icon: "PackageCheck" },
      { href: "/contabil/equipe", label: "Departamentos e equipe", module: "accounting", icon: "ShieldCheck" },
    ],
  },
  {
    label: "Financeiro do escritório",
    items: [
      { href: "/financeiro/receber", label: "Contas a receber", module: "finance", icon: "ArrowDownCircle" },
      { href: "/financeiro/pagar", label: "Contas a pagar", module: "finance", icon: "ArrowUpCircle" },
      { href: "/financeiro/fluxo-caixa", label: "Fluxo de caixa", module: "finance", icon: "LineChart" },
      { href: "/financeiro/conciliacao", label: "Conciliação bancária", module: "finance", icon: "Landmark" },
      { href: "/financeiro/cadastros", label: "Cadastros financeiros", module: "finance", icon: "Settings2" },
    ],
  },
  {
    label: "Fiscal (serviços do escritório)",
    items: [
      { href: "/fiscal/nfse", label: "NFS-e", module: "fiscal", icon: "FileSignature" },
      { href: "/fiscal/relatorios", label: "Relatórios fiscais", module: "fiscal", icon: "FileBarChart" },
      { href: "/fiscal/configuracoes", label: "Configurações fiscais", module: "fiscal", icon: "Cog" },
    ],
  },
  {
    label: "Administração",
    items: [
      { href: "/administracao/usuarios", label: "Usuários e permissões", module: "admin", icon: "ShieldCheck" },
      { href: "/administracao/empresas", label: "Empresas e unidades", module: "admin", icon: "Building2" },
      { href: "/administracao/integracoes", label: "Central de integrações", module: "admin", icon: "Plug" },
      { href: "/administracao/backups", label: "Backup e restauração", module: "admin", icon: "DatabaseBackup" },
      { href: "/administracao/historico", label: "Histórico e auditoria", module: "admin", icon: "History" },
      { href: "/administracao/parametros", label: "Parâmetros", module: "admin", icon: "SlidersHorizontal" },
    ],
  },
  {
    label: "Suporte",
    items: [
      { href: "/notificacoes", label: "Notificações", module: "dashboard", icon: "Bell" },
      { href: "/ajuda", label: "Ajuda e suporte", module: "support", icon: "LifeBuoy" },
    ],
  },
];

/** Menu conforme o tipo da empresa ativa. */
export function navFor(kind: string | null | undefined): NavGroup[] {
  return kind === "accounting" ? NAV_ACCOUNTING : NAV;
}

