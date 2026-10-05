import { detId, listAll } from "@/lib/db";
import type { Doc, Filter, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { NOTIFICATION_PREFS_KEY } from "@/lib/core/notify";
import { dayRange, nowIso } from "@/lib/dates";

/**
 * Central de notificações (Tela 42). Caixa de entrada por usuário.
 * Ler uma notificação NÃO resolve a ocorrência de origem: a situação (aberta/resolvida/informativa)
 * vem da origem e só muda quando o problema é tratado lá (resolveOccurrence).
 * Arquivar é permitido apenas para informativas ou já resolvidas; pendências continuam na caixa até resolver.
 */

export const NOTIFICATION_TYPES: Array<{ key: string; label: string; description: string }> = [
  { key: "stock_min", label: "Estoque mínimo", description: "Produto atingiu o estoque mínimo da filial." },
  { key: "receivable_overdue", label: "Títulos vencidos", description: "Contas a receber vencidas sem baixa." },
  { key: "payable_due", label: "Contas a pagar", description: "Contas a pagar com vencimento próximo ou no dia." },
  { key: "purchase_review", label: "Compras para revisar", description: "Pedidos e solicitações aguardando análise ou aprovação." },
  { key: "fiscal_rejected", label: "Rejeição fiscal", description: "Documento fiscal rejeitado ou com erro de comunicação." },
  { key: "integration_failure", label: "Falha de integração", description: "Tarefas e integrações que falharam definitivamente." },
  { key: "deadline", label: "Prazos e obrigações", description: "Obrigações fiscais e prazos operacionais." },
  { key: "cash", label: "Caixa", description: "Diferenças de fechamento, reaberturas e caixas pendentes." },
  { key: "ticket", label: "Chamados", description: "Novos chamados e respostas do suporte." },
  { key: "backup", label: "Backup", description: "Falhas de cópia de segurança e de verificação." },
  { key: "info", label: "Informativos", description: "Avisos gerais do sistema." },
];

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, t.label]));

/** Próxima ação sugerida por tipo (texto e rótulo do botão que leva à origem). */
export const NEXT_ACTION: Record<string, { text: string; cta: string }> = {
  stock_min: { text: "Confira o saldo do item e gere a reposição no planejamento de compras ou uma transferência entre filiais.", cta: "Abrir reposição" },
  receivable_overdue: { text: "Contate o cliente, registre o recebimento ou renegocie o título vencido.", cta: "Consultar título" },
  payable_due: { text: "Confira a conta a pagar, autorize se necessário e registre a baixa no vencimento.", cta: "Consultar conta" },
  purchase_review: { text: "Analise o pedido/solicitação e registre a decisão na etapa de aprovação.", cta: "Abrir aprovação" },
  fiscal_rejected: { text: "Consulte o retorno da SEFAZ/prefeitura, corrija o dado indicado e retransmita o documento.", cta: "Consultar documento fiscal" },
  integration_failure: { text: "Veja o erro da tarefa ou integração, corrija a configuração e reprocesse.", cta: "Abrir integrações" },
  deadline: { text: "Prepare e entregue a obrigação antes do prazo; anexe o comprovante.", cta: "Abrir obrigação" },
  cash: { text: "Confira o fechamento, as diferenças e a justificativa da sessão de caixa.", cta: "Abrir caixa" },
  ticket: { text: "Leia a mensagem e responda pelo próprio chamado.", cta: "Abrir chamado" },
  backup: { text: "Abra a cópia, verifique a falha e gere uma nova cópia verificada.", cta: "Abrir backup" },
  info: { text: "Aviso informativo — nenhuma ação obrigatória.", cta: "Abrir" },
};

/** Nível exibido: Alta (alta/crítica), Atenção (pendência), Informativa. */
export function noticeLevel(n: { priority?: string | null; occurrenceStatus?: string | null }): { label: string; tone: "bad" | "accent" | "neutral" } {
  if (n.priority === "critical" || n.priority === "high") return { label: n.priority === "critical" ? "Crítica" : "Alta", tone: "bad" };
  if (n.occurrenceStatus === "informative") return { label: "Informativa", tone: "neutral" };
  return { label: "Atenção", tone: "accent" };
}

/** Módulo dono da rota (para respeitar o acesso do usuário ao conteúdo relacionado). */
export function moduleOfLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const map: Array<[string, string]> = [["/estoque", "stock"], ["/financeiro", "finance"], ["/compras", "purchases"], ["/fiscal", "fiscal"], ["/vendas", "sales"], ["/caixa", "cash"], ["/pdv", "pdv"], ["/produtos", "products"], ["/clientes", "customers"], ["/fornecedores", "suppliers"], ["/administracao", "admin"], ["/ajuda", "support"], ["/relatorios", "reports"], ["/dashboard", "dashboard"]];
  return map.find(([p]) => link === p || link.startsWith(`${p}/`) || link.startsWith(`${p}?`))?.[1] ?? null;
}

export function noticeCode(id: string) {
  return `ALR-${id.slice(0, 6).toUpperCase()}`;
}

export const PRIORITY_LABEL: Record<string, string> = { critical: "Crítica", high: "Alta", normal: "Normal", low: "Baixa" };
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export interface NotificationFilter {
  type?: string;
  read?: "read" | "unread" | "";
  occ?: "open" | "resolved" | "informative" | "";
  priority?: string;
  from?: string;
  to?: string;
  /** "1" = somente arquivadas; padrão: caixa de entrada (não arquivadas) */
  archived?: string;
  /** visão: inbox | unread | pending | high | archived */
  view?: string;
  branch?: string;
  q?: string;
}

export async function queryNotifications(ctx: Ctx, f: NotificationFilter) {
  const filters: Filter[] = [["eq", "userId", ctx.user.id], ["eq", "companyId", ctx.companyId]];
  const archived = f.archived === "1" || f.view === "archived";
  filters.push(archived ? ["notNull", "archivedAt"] : ["isNull", "archivedAt"]);
  if (f.view === "unread") filters.push(["isNull", "readAt"]);
  if (f.view === "pending") filters.push(["eq", "occurrenceStatus", "open"]);
  if (f.view === "high") filters.push(["eq", "priority", ["high", "critical"]]);
  if (f.branch) filters.push(["eq", "branchId", f.branch]);
  if (f.type) filters.push(["eq", "type", f.type]);
  if (f.read === "unread") filters.push(["isNull", "readAt"]);
  if (f.read === "read") filters.push(["notNull", "readAt"]);
  if (f.occ) filters.push(["eq", "occurrenceStatus", f.occ]);
  if (f.priority) filters.push(["eq", "priority", f.priority]);
  if (f.from || f.to) {
    const r = dayRange(f.from || "2000-01-01", f.to || "2999-12-31");
    filters.push(["gte", "createdAt", r.start], ["lt", "createdAt", r.end]);
  }
  let rows = await listAll(ctx.store, "notifications", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] }, 5000);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((n) => `${n.title} ${n.body ?? ""} ${n.responsibleName ?? ""}`.toLowerCase().includes(q));
  }
  return rows.map((n) => ({ ...n, typeLabel: TYPE_LABEL[n.type] ?? n.type, priorityRank: PRIORITY_ORDER[n.priority] ?? 2, read: Boolean(n.readAt) }));
}

async function own(ctx: Ctx, ids: string[]) {
  assert(ids.length > 0, "Nenhuma notificação selecionada.");
  assert(ids.length <= 500, "Selecione no máximo 500 notificações por vez.");
  const out: Doc[] = [];
  for (const id of ids) {
    const n = await ctx.store.get("notifications", id);
    if (!n || n.userId !== ctx.user.id) throw new BusinessError("Notificação não encontrada.", "not_found");
    out.push(n);
  }
  return out;
}

/** Marca como lida/não lida. Não altera a situação da ocorrência na origem. */
export async function markNotifications(ctx: Ctx, ids: string[], read: boolean) {
  const items = await own(ctx, ids);
  let changed = 0;
  for (const n of items) {
    if (Boolean(n.readAt) === read) continue;
    await ctx.store.update("notifications", n.id, { readAt: read ? nowIso() : null });
    changed++;
  }
  return { changed, stillOpen: items.filter((n) => n.occurrenceStatus === "open").length };
}

/** Arquiva apenas informativas ou já resolvidas; pendências abertas permanecem até serem resolvidas na origem. */
export async function archiveNotifications(ctx: Ctx, ids: string[]) {
  const items = await own(ctx, ids);
  let archived = 0;
  let blocked = 0;
  for (const n of items) {
    if (n.archivedAt) continue;
    if (n.occurrenceStatus === "open") {
      blocked++;
      continue;
    }
    await ctx.store.update("notifications", n.id, { archivedAt: nowIso(), readAt: n.readAt ?? nowIso() });
    archived++;
  }
  return { archived, blocked };
}

export async function unarchiveNotifications(ctx: Ctx, ids: string[]) {
  const items = await own(ctx, ids);
  for (const n of items) if (n.archivedAt) await ctx.store.update("notifications", n.id, { archivedAt: null });
  return { restored: items.length };
}

export async function notificationCounts(store: Store, userId: string, companyId: string) {
  const rows = await listAll(store, "notifications", { filters: [["eq", "userId", userId], ["eq", "companyId", companyId], ["isNull", "archivedAt"]] }, 5000);
  return {
    inbox: rows.length,
    unread: rows.filter((n) => !n.readAt).length,
    open: rows.filter((n) => n.occurrenceStatus === "open").length,
    readButOpen: rows.filter((n) => n.readAt && n.occurrenceStatus === "open").length,
    critical: rows.filter((n) => (n.priority === "critical" || n.priority === "high") && n.occurrenceStatus === "open").length,
  };
}

// ───────────────────────────── preferências por tipo (user_prefs)

export interface NotificationPrefs {
  muted: string[];
}

export async function getNotificationPrefs(store: Store, userId: string): Promise<NotificationPrefs> {
  const p = await store.get("user_prefs", detId("pref", userId, NOTIFICATION_PREFS_KEY));
  const muted = Array.isArray(p?.value?.muted) ? p!.value.muted.map(String) : [];
  return { muted };
}

export async function setNotificationPrefs(ctx: Ctx, muted: string[]) {
  const known = new Set(NOTIFICATION_TYPES.map((t) => t.key));
  const clean = [...new Set(muted.filter((m) => known.has(m)))];
  const id = detId("pref", ctx.user.id, NOTIFICATION_PREFS_KEY);
  const existing = await ctx.store.get("user_prefs", id);
  const value = { muted: clean, updatedAt: nowIso() };
  if (existing) await ctx.store.update("user_prefs", id, { value });
  else await ctx.store.create("user_prefs", { userId: ctx.user.id, key: NOTIFICATION_PREFS_KEY, value }, id);
  return { muted: clean };
}
