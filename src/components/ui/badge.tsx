import { cn } from "./cn";

export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "brand" | "accent" | "sim";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  accent: "bg-accent-50 text-accent-700 ring-accent-100",
  sim: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

/** Dicionário central de estados → rótulo e tom (consistência entre telas). */
export const STATUS: Record<string, Record<string, [string, Tone]>> = {
  sale: { completed: ["Concluída", "good"], cancelled: ["Cancelada", "bad"], draft: ["Rascunho", "neutral"], presale: ["Pré-venda", "info"] },
  payment: { paid: ["Pago", "good"], pending: ["A receber", "warn"], partial: ["Parcial", "warn"], refunded: ["Estornado", "bad"], confirmed: ["Confirmado", "good"], failed: ["Falhou", "bad"], cancelled: ["Cancelado", "bad"], unknown: ["Indeterminado", "warn"], expired: ["Expirado", "neutral"] },
  fiscal: {
    not_required: ["Sem documento", "neutral"], pending: ["Pendente", "warn"], queued: ["Na fila", "info"], processing: ["Processando", "info"], authorized: ["Autorizado", "good"], rejected: ["Rejeitado", "bad"],
    denied: ["Denegado", "bad"], cancelled: ["Cancelado", "neutral"], error: ["Erro de comunicação", "bad"], draft: ["Rascunho", "neutral"], unused: ["Inutilizado", "neutral"], discarded: ["Descartado", "neutral"], contingency: ["Contingência", "warn"],
  },
  title: { open: ["Em aberto", "warn"], partial: ["Parcial", "info"], paid: ["Liquidado", "good"], cancelled: ["Cancelado", "neutral"], overdue: ["Vencido", "bad"], due_today: ["Vence hoje", "accent"], upcoming: ["A vencer", "info"], renegotiated: ["Renegociado", "neutral"] },
  cash: { open: ["Aberto", "good"], closed: ["Fechado", "neutral"], reopened: ["Reaberto", "warn"] },
  purchase: {
    draft: ["Rascunho", "neutral"], in_review: ["Em análise", "info"], adjust: ["Em ajuste", "warn"], approved: ["Aprovado", "good"], sent: ["Enviado", "brand"], partial: ["Parcialmente recebido", "warn"],
    received: ["Recebido", "good"], rejected: ["Rejeitado", "bad"], cancelled: ["Cancelado", "neutral"], pending: ["Aguardando", "info"],
  },
  supplier: { active: ["Ativo", "good"], draft: ["Docs. pendentes", "warn"], blocked: ["Bloqueado", "bad"], inactive: ["Inativo", "neutral"] },
  receipt_item: { ok: ["Confere", "good"], divergence: ["Divergência", "bad"], pending: ["Pendente", "neutral"], ignored: ["Não estocado", "neutral"] },
  replenishment: { reorder: ["A repor", "info"], risk: ["Risco antes da entrega", "bad"], incomplete: ["Completar dados", "accent"], ok: ["Coberto", "good"] },
  receipt: { draft: ["Em conferência", "warn"], confirming: ["Confirmando", "info"], confirmed: ["Confirmado", "good"], cancelled: ["Cancelado", "neutral"] },
  quotation: { open: ["Aberta", "info"], closed: ["Pedidos gerados", "good"], cancelled: ["Cancelada", "neutral"], received: ["Recebida", "good"], waiting: ["Aguardando proposta", "warn"], expired: ["Vencida", "bad"] },
  approval: {
    in_review: ["Em análise", "info"], approved: ["Aprovada", "good"], adjust: ["Devolvida para ajuste", "warn"], rejected: ["Rejeitada", "bad"], cancelled: ["Cancelada", "neutral"], pending: ["Aguardando decisão", "accent"],
    waiting: ["Na fila", "neutral"], approve: ["Aprovou", "good"], reject: ["Rejeitou", "bad"], auto: ["Autoaprovada", "good"],
  },
  transfer: { draft: ["Rascunho", "neutral"], separated: ["Separado", "info"], in_transit: ["Em trânsito", "accent"], partial: ["Recebido parcial", "warn"], received: ["Recebido", "good"], cancelled: ["Cancelado", "neutral"] },
  inventory: { open: ["Aberto", "info"], counting: ["Em contagem", "accent"], review: ["Em revisão", "warn"], completed: ["Concluído", "good"], cancelled: ["Cancelado", "neutral"] },
  integration: { not_configured: ["Não configurada", "neutral"], configured_untested: ["Configurada sem teste", "warn"], operational: ["Operacional", "good"], unavailable: ["Indisponível", "bad"], error: ["Erro", "bad"], simulated: ["Simulação", "sim"] },
  user: { active: ["Ativo", "good"], invited: ["Convite pendente", "info"], inactive: ["Inativo", "neutral"], suspended: ["Suspenso", "bad"], invite_expired: ["Convite expirado", "warn"] },
  ticket: { open: ["Aberto", "info"], in_progress: ["Em atendimento", "accent"], waiting: ["Aguardando usuário", "warn"], resolved: ["Resolvido", "good"], closed: ["Encerrado", "neutral"] },
  backup: { running: ["Em execução", "info"], completed: ["Concluído", "good"], failed: ["Falhou", "bad"], verified: ["Verificado (restaurável)", "good"], expired: ["Expirado (artefato removido)", "neutral"] },
  restore: { pending: ["Aguardando", "info"], running: ["Em execução", "info"], completed: ["Concluída", "good"], failed: ["Falhou", "bad"] },
  occurrence: { open: ["Ocorrência aberta", "warn"], resolved: ["Resolvida na origem", "good"], informative: ["Informativa", "info"] },
  priority: { critical: ["Crítica", "bad"], high: ["Alta", "accent"], normal: ["Normal", "neutral"], low: ["Baixa", "neutral"] },
  audit: { success: ["Sucesso", "good"], failure: ["Falha", "bad"] },
  generic: { active: ["Ativo", "good"], inactive: ["Inativo", "neutral"], draft: ["Rascunho", "neutral"], completed: ["Concluído", "good"], cancelled: ["Cancelado", "neutral"], pending: ["Pendente", "warn"], processing: ["Processando", "info"], reconciled: ["Conciliado", "good"], ignored: ["Ignorado", "neutral"] },
};

export function StatusBadge({ kind, status, className }: { kind: keyof typeof STATUS | string; status: string | null | undefined; className?: string }) {
  if (!status) return <Badge className={className}>—</Badge>;
  const [label, tone] = STATUS[kind]?.[status] ?? STATUS.generic[status] ?? [status, "neutral" as Tone];
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}

export function SimBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="sim" title="Gerado por provedor de simulação — sem validade fiscal/financeira">
      SIMULAÇÃO
    </Badge>
  );
}
