/** Catálogo de parâmetros editáveis (empresa e filial). Valores padrão vêm de DEFAULT_SETTINGS quando existem. */

export type ParamType = "bool" | "int" | "bps" | "money" | "select" | "timezone";

export interface ParamDef {
  key: string;
  group: string;
  label: string;
  help: string;
  type: ParamType;
  /** escopos em que pode ser definido */
  scopes: Array<"company" | "branch">;
  default: unknown;
  min?: number;
  max?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  /** onde o parâmetro é usado (transparência para o administrador) */
  usedBy: string;
  /** definido para toda a instalação (somente leitura na tela; não é gravado por empresa/filial) */
  installation?: boolean;
}

export const PARAM_GROUPS = ["Vendas e PDV", "Caixa", "Estoque e reposição", "Curva ABC", "Compras", "Notificações", "Usuários", "Regional"];

export const PARAMS: ParamDef[] = [
  { key: "sales.allowNegativeStock", group: "Vendas e PDV", label: "Permitir venda sem saldo", help: "Quando desligado, o PDV bloqueia itens sem estoque disponível. O terminal também pode liberar individualmente.", type: "bool", scopes: ["company", "branch"], default: false, usedBy: "PDV (conclusão da venda)" },
  { key: "sales.consumerFinalAllowed", group: "Vendas e PDV", label: "Permitir venda a consumidor final (sem identificar cliente)", help: "Desligado, o PDV deve exigir cliente identificado em toda venda.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "PDV (identificação do cliente)" },
  { key: "sales.presaleExpiryHours", group: "Vendas e PDV", label: "Validade da pré-venda", help: "Atendimentos/pré-vendas não concluídos expiram após este prazo e liberam as reservas.", type: "int", scopes: ["company", "branch"], default: 72, min: 1, max: 720, unit: "horas", usedBy: "PDV (pré-vendas e reservas)" },
  { key: "cash.withdrawalApprovalAbove", group: "Caixa", label: "Sangria acima deste valor exige aprovação", help: "0 = sem exigência.", type: "money", scopes: ["company", "branch"], default: 0, min: 0, usedBy: "Caixa (sangria)" },
  { key: "replenishment.coverageDays", group: "Estoque e reposição", label: "Cobertura desejada", help: "Dias de venda que a sugestão de compra deve cobrir.", type: "int", scopes: ["company", "branch"], default: 14, min: 1, max: 365, unit: "dias", usedBy: "Planejamento de reposição" },
  { key: "replenishment.historyDays", group: "Estoque e reposição", label: "Histórico considerado na média de vendas", help: "Janela de dias usada para calcular a média diária de vendas.", type: "int", scopes: ["company", "branch"], default: 90, min: 7, max: 730, unit: "dias", usedBy: "Planejamento de reposição" },
  { key: "notifications.stockMin", group: "Notificações", label: "Notificar estoque abaixo do mínimo", help: "Gera aviso na central de notificações quando o saldo atinge o mínimo.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Estoque / vendas (alerta de mínimo)" },
  { key: "abc.limitA", group: "Curva ABC", label: "Limite da classe A (acumulado)", help: "Itens até este percentual acumulado são classe A.", type: "bps", scopes: ["company"], default: 8000, min: 100, max: 9900, unit: "%", usedBy: "Relatórios — curva ABC" },
  { key: "abc.limitB", group: "Curva ABC", label: "Limite da classe B (acumulado)", help: "De A até este percentual: classe B; acima: classe C. Deve ser maior que o limite A.", type: "bps", scopes: ["company"], default: 9500, min: 200, max: 10000, unit: "%", usedBy: "Relatórios — curva ABC" },
  {
    key: "purchase.revisionRequiresReview", group: "Compras", label: "Revisão de pedido aprovado volta para análise", help: "Define quando alterar um pedido já aprovado exige nova aprovação.", type: "select", scopes: ["company"], default: "relevant",
    options: [{ value: "relevant", label: "Somente alterações relevantes (valor, itens, fornecedor)" }, { value: "always", label: "Sempre" }, { value: "never", label: "Nunca" }], usedBy: "Compras (revisão de pedidos)",
  },
  { key: "purchase.monthlyBudget", group: "Compras", label: "Orçamento mensal de compras", help: "0 = sem orçamento. Usado nas aprovações para indicar consumo do orçamento.", type: "money", scopes: ["company", "branch"], default: 0, min: 0, usedBy: "Aprovação de compras" },
  { key: "users.inviteExpiryDays", group: "Usuários", label: "Validade do convite de primeiro acesso", help: "Depois deste prazo o link de convite deixa de funcionar e precisa ser reenviado.", type: "int", scopes: ["company"], default: 7, min: 1, max: 30, unit: "dias", usedBy: "Usuários e permissões (convites)" },
  {
    key: "timezone", group: "Regional", label: "Fuso horário", type: "timezone", scopes: ["company"], default: "America/Sao_Paulo", installation: true,
    help: "Único para toda a instalação (todas as empresas e filiais): define o dia de cada movimento nos recortes de período, o horário das rotinas e a agenda de backup. Para alterar, o responsável técnico define a variável de ambiente APP_TIMEZONE no servidor (ex.: America/Manaus) e reinicia a aplicação.",
    usedBy: "Relatórios, rotinas e backup (toda a instalação)",
  },
];

export const PARAM_MAP: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

export const BACKUP_FREQUENCIES = [
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanalmente" },
  { value: "monthly", label: "Mensalmente (dia 1)" },
];

export const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function describeSchedule(s: { enabled?: boolean; frequency?: string; time?: string; weekday?: number }) {
  if (!s.enabled) return "Cópia automática desligada";
  const f = s.frequency === "weekly" ? `Semanalmente (${WEEKDAYS[s.weekday ?? 0].toLowerCase()})` : s.frequency === "monthly" ? "Mensalmente (dia 1)" : "Diariamente";
  return `${f} às ${s.time ?? "02:00"}`;
}
