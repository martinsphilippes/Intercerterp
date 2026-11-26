/**
 * Catálogo de módulos contratáveis do ERP (habilitação por empresa contratante).
 *
 * Três camadas independentes decidem se uma pessoa executa uma capacidade (docs/modulos/README.md):
 *  1. HABILITAÇÃO (este catálogo): a empresa contratou o módulo — fonte oficial no ERP, alterada pelo Interos;
 *  2. CONFIGURAÇÃO (`feature.<chave>` em Parâmetros e pré-requisitos como a configuração fiscal): a empresa ligou a função;
 *  3. PERMISSÃO (perfil): o usuário pode a operação; e o ISOLAMENTO (ScopedStore) garante que o registro é da empresa.
 */

/** Classe da entrada do catálogo. */
export type ModuleClass =
  /** módulo comercial: contratável sozinho, com utilidade própria */
  | "commercial"
  /** função opcional de um módulo (exige o módulo-pai) */
  | "optional_function"
  /** componente técnico compartilhado: não é contratável; fica ativo enquanto um módulo ativo precisar dele */
  | "technical"
  /** recurso obrigatório da plataforma: sempre ativo, não pode ser desligado */
  | "platform";

/** Estado de disponibilidade da entrada no catálogo (não da empresa). */
export type Availability =
  /** implementado no ERP e contratável */
  | "available"
  /** implementado, mas a divisão com outro módulo ainda precisa de confirmação de negócio */
  | "needs_confirmation"
  /** lacuna documentada: não existe no ERP; não pode ser ativado */
  | "planned";

export type CompanyKind = "retail" | "accounting" | "certification";

export interface Surfaces {
  /** prefixos de rota interna (/compras/cotacoes cobre /compras/cotacoes/[id]) */
  routes?: string[];
  /** páginas públicas (sem login) */
  publicRoutes?: string[];
  /** rotas de API (route handlers) */
  apis?: string[];
  /** chaves de exportação (/api/export/<chave>) */
  exports?: string[];
  /** tarefas duráveis (registerJob) — nunca bloqueadas: completam operações já confirmadas */
  jobs?: string[];
  /** rotinas diárias (registerRoutine) */
  routines?: string[];
  /** avisos recebidos de terceiros */
  webhooks?: string[];
  /** chaves `feature.<chave>` de Parâmetros governadas (configuração da função) */
  features?: string[];
  /** operações específicas de perfil governadas (src/lib/permissions.ts SPECIAL_ACTIONS) */
  permissions?: string[];
  /** abas/ações dentro de telas de outro módulo (documentação do ponto de controle) */
  embedded?: string[];
}

/**
 * Política de desligamento.
 *  - immediate: bloqueia novas operações na hora; telas ficam em consulta (ou somem);
 *  - drain: bloqueia novas operações na hora e deixa as operações em andamento concluírem (estado "draining") até não
 *    haver pendências ou até `drainDays`; depois desliga sozinho;
 *  - scheduled: só desliga quando as pendências impeditivas acabam (fica "agendado"); até lá segue ligado.
 */
export interface DeactivationPolicy {
  mode: "immediate" | "drain" | "scheduled";
  /** o que a tela mostra depois de desligado */
  afterOff: "read_history" | "hidden";
  /** prazo máximo de conclusão no modo drain (dias) */
  drainDays?: number;
  /** verificações de pendências em andamento (src/domain/modules/blockers.ts) */
  blockers?: string[];
  /** obrigações que continuam mesmo desligado (texto para a interface e o Interos) */
  obligations?: string[];
  /** ações (nome da server action) permitidas durante a conclusão */
  drainActions?: string[];
  /** ações permitidas mesmo depois de desligado (correção de histórico que só existe na tela do módulo) */
  historyActions?: string[];
}

export interface ModuleDef {
  key: string;
  name: string;
  description: string;
  family: string;
  version: string;
  classification: ModuleClass;
  availability: Availability;
  /** tipos de empresa em que o módulo faz sentido */
  kinds: CompanyKind[];
  /** módulo-pai (funções opcionais) */
  parent?: string;
  /** dependências comerciais obrigatórias (regra real de negócio) */
  requires?: string[];
  /** basta UM destes estar habilitado (ex.: baixa em lote serve a receber OU pagar) */
  requiresAny?: string[][];
  /** componentes técnicos compartilhados usados (não contratáveis) */
  components?: string[];
  /** integrações opcionais: funcionam quando o outro módulo também está habilitado */
  optionalIntegrations?: { module: string; effect: string }[];
  /** pré-requisitos de configuração (o módulo fica "habilitado — configuração pendente" sem eles) */
  configPrereqs?: { key: string; description: string }[];
  surfaces: Surfaces;
  deactivation: DeactivationPolicy;
  /** como a capacidade existe hoje no repositório (rastreabilidade do levantamento) */
  existing: "exists" | "shared_screen" | "needs_confirmation" | "gap";
  /** evidência/observação do levantamento (arquivo e motivo) */
  notes?: string;
}

/** Estado de um módulo numa empresa. */
export type CompanyModuleState = "enabled" | "draining" | "scheduled_off" | "disabled";

export interface CompanyModuleEntry {
  state: CompanyModuleState;
  since: string;
  /** origem da habilitação */
  source: "baseline" | "interos" | "provisioning" | "platform_admin";
  /** prazo máximo da conclusão (draining) */
  drainUntil?: string | null;
  /** consulta histórica depois de desligado */
  history?: "read" | "none";
  /** configuração específica do módulo preservada para a reativação */
  config?: Record<string, unknown> | null;
  /** motivo informado na última alteração */
  reason?: string | null;
  /** quando ligado pela última vez (reativação reaproveita config e histórico) */
  enabledAt?: string | null;
  disabledAt?: string | null;
}

/** Modo de controle da empresa (lançamento gradual). */
export type ControlMode =
  /** sem controle: comportamento anterior (tudo que o tipo de empresa já tinha) */
  | "legacy"
  /** avalia e registra o que seria negado, sem bloquear */
  | "shadow"
  /** aplica a habilitação */
  | "enforced";

export interface CompanyModulesDoc {
  companyId: string;
  mode: ControlMode;
  version: number;
  modules: Record<string, CompanyModuleEntry>;
  baselineAt?: string | null;
  updatedBy?: string | null;
}

/** Nível de acesso efetivo de uma capacidade. */
export type AccessLevel =
  /** operação completa */
  | "full"
  /** conclusão das operações em andamento + consulta */
  | "drain"
  /** só consulta histórica */
  | "read"
  /** indisponível */
  | "none";

export interface AccessDecision {
  level: AccessLevel;
  module: string;
  /** em modo shadow: o que aconteceria com o controle ligado */
  enforcedLevel: AccessLevel;
  mode: ControlMode;
  reason: string;
}
