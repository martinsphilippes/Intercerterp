/** Módulos, operações e perfis padrão (Tela 36 — Usuários e permissões). */

export const MODULES = [
  { key: "dashboard", label: "Painel" },
  { key: "pdv", label: "PDV / Frente de caixa" },
  { key: "sales", label: "Vendas" },
  { key: "cash", label: "Caixa" },
  { key: "products", label: "Produtos" },
  { key: "stock", label: "Estoque" },
  { key: "customers", label: "Clientes" },
  { key: "suppliers", label: "Fornecedores" },
  { key: "finance", label: "Financeiro" },
  { key: "purchases", label: "Compras" },
  { key: "fiscal", label: "Fiscal" },
  { key: "reports", label: "Relatórios" },
  { key: "admin", label: "Administração" },
  { key: "support", label: "Ajuda e suporte" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export type Crud = "view" | "create" | "edit" | "delete";
export type PermissionMatrix = Partial<Record<ModuleKey, Partial<Record<Crud, boolean>>>>;

export const SPECIAL_ACTIONS = [
  { key: "sale.cancel", label: "Cancelar venda" },
  { key: "sale.return", label: "Registrar devolução/troca" },
  { key: "sale.discount_over_limit", label: "Aprovar desconto acima do limite" },
  { key: "cash.reopen", label: "Reabrir caixa" },
  { key: "cash.withdrawal", label: "Registrar sangria/suprimento" },
  { key: "stock.adjust", label: "Ajustar estoque" },
  { key: "stock.inventory_close", label: "Concluir inventário" },
  { key: "finance.settle", label: "Baixar títulos" },
  { key: "finance.reverse", label: "Estornar baixas" },
  { key: "finance.reconcile", label: "Conciliar extratos" },
  { key: "finance.approve_payable", label: "Autorizar contas a pagar" },
  { key: "purchase.approve", label: "Aprovar compras" },
  { key: "purchase.receive", label: "Receber mercadorias" },
  { key: "fiscal.issue", label: "Emitir documentos fiscais" },
  { key: "fiscal.cancel", label: "Cancelar documento fiscal" },
  { key: "fiscal.configure", label: "Configurar fiscal e certificados" },
  { key: "data.export", label: "Exportar dados" },
  { key: "admin.users", label: "Gerenciar usuários e perfis" },
  { key: "admin.integrations", label: "Configurar integrações" },
  { key: "admin.backup", label: "Backup e restauração" },
  { key: "support.manage", label: "Atender chamados" },
] as const;

export type SpecialAction = (typeof SPECIAL_ACTIONS)[number]["key"];

const all = (): Record<Crud, boolean> => ({ view: true, create: true, edit: true, delete: true });
const ro = (): Record<Crud, boolean> => ({ view: true, create: false, edit: false, delete: false });
const rw = (): Record<Crud, boolean> => ({ view: true, create: true, edit: true, delete: false });

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: PermissionMatrix;
  actions: SpecialAction[];
  discountLimitBps: number;
}

export const DEFAULT_ROLES: RoleTemplate[] = [
  {
    key: "admin",
    name: "Administrador",
    description: "Acesso integral a todos os módulos e configurações.",
    permissions: Object.fromEntries(MODULES.map((m) => [m.key, all()])),
    actions: SPECIAL_ACTIONS.map((a) => a.key),
    discountLimitBps: 10000,
  },
  {
    key: "manager",
    name: "Gerente",
    description: "Gestão da loja: vendas, caixa, estoque, compras e relatórios.",
    permissions: {
      dashboard: all(), pdv: all(), sales: all(), cash: all(), products: all(), stock: all(), customers: all(),
      suppliers: all(), finance: rw(), purchases: all(), fiscal: rw(), reports: all(), admin: ro(), support: rw(),
    },
    actions: ["sale.cancel", "sale.return", "sale.discount_over_limit", "cash.reopen", "cash.withdrawal", "stock.adjust", "stock.inventory_close", "finance.settle", "purchase.approve", "purchase.receive", "fiscal.issue", "data.export"],
    discountLimitBps: 2000,
  },
  {
    key: "cashier",
    name: "Caixa",
    description: "Operação do PDV, abertura e fechamento de caixa.",
    permissions: { dashboard: ro(), pdv: all(), sales: { view: true, create: true }, cash: rw(), customers: rw(), products: ro(), support: rw() },
    actions: ["cash.withdrawal", "sale.return", "fiscal.issue"],
    discountLimitBps: 500,
  },
  {
    key: "stockist",
    name: "Estoquista",
    description: "Movimentações, transferências, inventários e recebimentos.",
    permissions: { dashboard: ro(), products: rw(), stock: all(), purchases: { view: true }, suppliers: ro(), support: rw() },
    actions: ["stock.adjust", "purchase.receive"],
    discountLimitBps: 0,
  },
  {
    key: "finance",
    name: "Financeiro",
    description: "Contas a receber e pagar, fluxo de caixa e conciliação.",
    permissions: { dashboard: ro(), finance: all(), customers: ro(), suppliers: ro(), sales: ro(), purchases: ro(), reports: ro(), support: rw() },
    actions: ["finance.settle", "finance.reverse", "finance.reconcile", "finance.approve_payable", "data.export"],
    discountLimitBps: 0,
  },
  {
    key: "fiscal",
    name: "Fiscal",
    description: "Documentos fiscais, configurações e relatórios fiscais.",
    permissions: { dashboard: ro(), fiscal: all(), sales: ro(), products: rw(), customers: ro(), suppliers: ro(), reports: ro(), support: rw() },
    actions: ["fiscal.issue", "fiscal.cancel", "fiscal.configure", "data.export"],
    discountLimitBps: 0,
  },
];

export interface PermissionSubject {
  isAdmin: boolean;
  permissions: PermissionMatrix;
  actions: string[];
}

export function can(subject: PermissionSubject, module: ModuleKey, op: Crud = "view"): boolean {
  if (subject.isAdmin) return true;
  return Boolean(subject.permissions?.[module]?.[op]);
}

export function canDo(subject: PermissionSubject, action: SpecialAction): boolean {
  if (subject.isAdmin) return true;
  return subject.actions?.includes(action) ?? false;
}
