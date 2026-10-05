import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Filter, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { saveFile } from "@/lib/core/files";
import { sendEmail } from "@/lib/core/email";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { canDo } from "@/lib/permissions";
import { nowIso } from "@/lib/dates";

/**
 * Chamados de suporte (Tela 43). Persistência interna sempre; envio externo (e-mail ao solicitante)
 * somente pelo canal configurado, com resultado real registrado no chamado.
 * Chamados públicos (tela de login) usam companyId "public" e são atendidos por quem tem support.manage.
 */

export const TICKET_CATEGORIES = [
  { value: "duvida", label: "Dúvida de uso" },
  { value: "erro", label: "Erro / comportamento inesperado" },
  { value: "acesso", label: "Acesso e senha" },
  { value: "fiscal", label: "Fiscal (NF-e, NFC-e, NFS-e)" },
  { value: "financeiro", label: "Financeiro" },
  { value: "estoque", label: "Estoque e produtos" },
  { value: "pdv", label: "PDV, caixa e periféricos" },
  { value: "integracao", label: "Integrações" },
  { value: "sugestao", label: "Sugestão de melhoria" },
];

export const TICKET_PRIORITIES = [
  { value: "low", label: "Baixa — sem impacto na operação" },
  { value: "normal", label: "Normal — contorno disponível" },
  { value: "high", label: "Alta — operação prejudicada" },
  { value: "critical", label: "Crítica — operação parada" },
];

export const TICKET_STATUS = [
  { value: "open", label: "Aberto" },
  { value: "in_progress", label: "Em atendimento" },
  { value: "waiting", label: "Aguardando usuário" },
  { value: "resolved", label: "Resolvido" },
  { value: "closed", label: "Encerrado" },
];

const MAX_FILE = 8 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/(plain|csv|xml)|application\/xml|application\/zip|application\/x-zip-compressed)$/;

export interface Attachment {
  name: string;
  mime: string;
  data: Buffer;
}

export interface TicketContext {
  route?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  userAgent?: string | null;
  screen?: string | null;
}

export function isSupportAgent(ctx: Ctx) {
  return canDo(ctx.user, "support.manage");
}

/** Chamado visível para o usuário: próprio, ou qualquer da empresa (e públicos) para quem atende. */
export async function getTicketFor(ctx: Ctx, id: string) {
  const t = await ctx.store.get("tickets", id);
  if (!t) return null;
  const agent = isSupportAgent(ctx);
  if (t.companyId === "public") return agent ? t : null;
  if (t.companyId !== ctx.companyId) return null;
  if (!agent && t.userId !== ctx.user.id) return null;
  return t;
}

async function storeAttachments(ctx: Ctx, ticketId: string, files: Attachment[]) {
  const out: Array<{ fileId: string; name: string; mime: string; sizeBytes: number }> = [];
  for (const f of files) {
    if (!f.data?.length) continue;
    assert(f.data.length <= MAX_FILE, `Anexo "${f.name}" excede 8 MB.`);
    assert(ALLOWED_MIME.test(f.mime || ""), `Tipo de arquivo não aceito: ${f.name} (${f.mime || "desconhecido"}). Use imagem, PDF, texto, XML ou ZIP.`);
    const saved = await saveFile(ctx, { bucket: "attachments", name: f.name.slice(0, 200), mime: f.mime, data: f.data, entityType: "ticket", entityId: ticketId, kind: "ticket_attachment" });
    out.push({ fileId: saved.id, name: saved.name, mime: saved.mime, sizeBytes: saved.sizeBytes });
  }
  return out;
}

export async function createTicket(
  ctx: Ctx,
  input: { category: string; priority: string; subject: string; message: string; context: TicketContext; attachments?: Attachment[]; idemKey?: string },
) {
  requirePerm(ctx, "support", "create");
  assert(TICKET_CATEGORIES.some((c) => c.value === input.category), "Selecione a categoria.");
  assert(TICKET_PRIORITIES.some((c) => c.value === input.priority), "Selecione a prioridade.");
  assert(input.subject?.trim().length >= 5, "Informe um assunto (mín. 5 caracteres).");
  assert(input.message?.trim().length >= 10, "Descreva o problema (mín. 10 caracteres).");
  const id = input.idemKey ? detId("ticket", ctx.companyId, input.idemKey) : undefined;
  if (id) {
    const ex = await ctx.store.get("tickets", id);
    if (ex) return ex;
  }
  const number = await nextNumber(ctx.store, `ticket:${ctx.companyId}`);
  const now = nowIso();
  let t: Doc;
  try {
    t = await ctx.store.create(
      "tickets",
      {
        companyId: ctx.companyId, branchId: input.context.branchId ?? ctx.branchId, createdBy: ctx.user.id, number, userId: ctx.user.id, category: input.category, priority: input.priority,
        subject: input.subject.trim().slice(0, 200), status: "open", lastMessageAt: now,
        context: { ...input.context, userName: ctx.user.name, userEmail: ctx.user.email, roleName: ctx.user.roleName ?? null, openedAt: now },
      },
      id,
    );
  } catch (e) {
    if (isConflict(e) && id) return (await ctx.store.get("tickets", id))!;
    throw e;
  }
  const attachments = await storeAttachments(ctx, t.id, input.attachments ?? []);
  await ctx.store.create("ticket_messages", { companyId: ctx.companyId, branchId: t.branchId, createdBy: ctx.user.id, ticketId: t.id, userId: ctx.user.id, userName: ctx.user.name, body: input.message.trim(), attachments, internal: false });
  await audit(ctx, { module: "support", action: "ticket.create", entityType: "ticket", entityId: t.id, summary: `Chamado nº ${number} aberto: ${t.subject}`, after: { category: t.category, priority: t.priority, route: input.context.route ?? null, attachments: attachments.length } });
  await notify(ctx.store, {
    companyId: ctx.companyId, branchId: t.branchId, type: "ticket", priority: input.priority === "critical" ? "critical" : input.priority === "high" ? "high" : "normal",
    title: `Novo chamado nº ${number}: ${t.subject}`, body: `${ctx.user.name} — ${TICKET_CATEGORIES.find((c) => c.value === t.category)?.label}`, link: `/ajuda/chamados/${t.id}`,
    originType: "ticket", originId: t.id, occurrenceKey: `ticket:${t.id}:triage`, responsibleName: "Equipe de suporte", audience: { action: "support.manage" },
  }).catch(() => 0);
  return t;
}

/** Resposta (usuário ou suporte) ou nota interna (somente suporte). */
export async function replyTicket(
  ctx: Ctx,
  id: string,
  input: { body: string; internal?: boolean; status?: string | null; attachments?: Attachment[]; idemKey?: string },
) {
  requirePerm(ctx, "support", "view");
  const t = await getTicketFor(ctx, id);
  if (!t) throw new BusinessError("Chamado não encontrado.", "not_found");
  assert(t.status !== "closed", "Chamado encerrado: abra um novo chamado se o problema voltar.");
  assert(input.body?.trim().length >= 2, "Escreva a mensagem.");
  const agent = isSupportAgent(ctx);
  const isRequester = t.userId === ctx.user.id;
  if (input.internal) assert(agent, "Somente o suporte registra notas internas.");
  if (input.idemKey) {
    const ex = await ctx.store.get("ticket_messages", detId("ticketmsg", id, input.idemKey));
    if (ex) return { ticket: t, message: ex, delivery: null };
  }
  const attachments = await storeAttachments({ ...ctx, companyId: t.companyId === "public" ? ctx.companyId : t.companyId }, id, input.attachments ?? []);
  const msg = await ctx.store.create(
    "ticket_messages",
    { companyId: t.companyId, branchId: t.branchId, createdBy: ctx.user.id, ticketId: id, userId: ctx.user.id, userName: ctx.user.name, body: input.body.trim(), attachments, internal: Boolean(input.internal) },
    input.idemKey ? detId("ticketmsg", id, input.idemKey) : undefined,
  );
  // situação: resposta do suporte → "aguardando usuário" (ou a escolhida); resposta do solicitante reabre
  let status = t.status;
  if (agent && !isRequester && !input.internal) status = input.status && TICKET_STATUS.some((s) => s.value === input.status) ? input.status : "waiting";
  else if (agent && input.status && TICKET_STATUS.some((s) => s.value === input.status)) status = input.status;
  else if (isRequester && ["waiting", "resolved"].includes(t.status)) status = "open";
  const patch: Record<string, any> = { lastMessageAt: nowIso(), status };
  if (agent && !t.assigneeId && !isRequester) patch.assigneeId = ctx.user.id;
  if (status === "resolved" && t.status !== "resolved") patch.resolvedAt = nowIso();
  if (status !== "resolved" && status !== "closed") patch.resolvedAt = null;
  let delivery: { delivered: boolean; channel: string; message?: string } | null = null;
  if (agent && !isRequester && !input.internal) {
    await resolveOccurrence(ctx.store, `ticket:${id}:triage`).catch(() => 0);
    await resolveOccurrence(ctx.store, `ticket:${id}:awaiting-support`).catch(() => 0);
    const to: string | null = t.context?.userEmail ?? t.context?.email ?? null;
    if (to) {
      delivery = await sendEmail(t.companyId === "public" ? ctx.companyId : t.companyId, {
        to,
        subject: `Chamado nº ${t.number} — ${t.subject}`,
        html: `<p>Há uma nova resposta para o seu chamado nº ${t.number}.</p><blockquote>${escapeHtml(input.body.trim()).replace(/\n/g, "<br>")}</blockquote><p>Situação: ${TICKET_STATUS.find((s) => s.value === status)?.label}.</p>`,
      });
      patch.externalStatus = delivery.delivered ? `e-mail entregue (${delivery.channel})`.slice(0, 40) : delivery.channel === "not_configured" ? "e-mail: canal não configurado" : "e-mail: falha no envio";
    }
    if (t.userId) {
      await notify(ctx.store, {
        companyId: t.companyId === "public" ? ctx.companyId : t.companyId, branchId: t.branchId ?? null, type: "ticket", title: `Resposta no chamado nº ${t.number}`, body: input.body.trim().slice(0, 300), link: `/ajuda/chamados/${id}`,
        originType: "ticket", originId: id, occurrenceKey: `ticket:${id}:reply:${msg.id}`, informative: true, responsibleName: ctx.user.name, audience: { userIds: [t.userId] },
      }).catch(() => 0);
    }
  }
  if (isRequester && !agent) {
    await notify(ctx.store, {
      companyId: ctx.companyId, branchId: t.branchId ?? null, type: "ticket", title: `Nova mensagem no chamado nº ${t.number}`, body: input.body.trim().slice(0, 300), link: `/ajuda/chamados/${id}`,
      originType: "ticket", originId: id, occurrenceKey: `ticket:${id}:awaiting-support`, responsibleName: "Equipe de suporte", audience: t.assigneeId ? { userIds: [t.assigneeId] } : { action: "support.manage" },
    }).catch(() => 0);
  }
  const after = await ctx.store.update("tickets", id, patch);
  await audit({ ...ctx, companyId: t.companyId === "public" ? ctx.companyId : t.companyId }, {
    module: "support", action: input.internal ? "ticket.note" : agent && !isRequester ? "ticket.reply" : "ticket.message", entityType: "ticket", entityId: id,
    summary: input.internal
      ? `Nota interna no chamado nº ${t.number}`
      : `${agent && !isRequester ? "Resposta do suporte" : "Mensagem do solicitante"} no chamado nº ${t.number}${status !== t.status ? ` (situação: ${label(t.status)} → ${label(status)})` : ""}${delivery ? ` — ${delivery.delivered ? `e-mail entregue (${delivery.channel})` : `e-mail não enviado (${delivery.message ?? delivery.channel})`}` : ""}`,
    before: status !== t.status ? { status: t.status } : undefined, after: status !== t.status ? { status } : undefined,
  });
  return { ticket: after, message: msg, delivery };
}

function label(s: string) {
  return TICKET_STATUS.find((x) => x.value === s)?.label ?? s;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Mudança de situação/responsável pelo suporte (ou encerramento pelo próprio solicitante). */
export async function updateTicket(ctx: Ctx, id: string, input: { status?: string; assigneeId?: string | null; priority?: string; reason?: string | null }) {
  const t = await getTicketFor(ctx, id);
  if (!t) throw new BusinessError("Chamado não encontrado.", "not_found");
  const agent = isSupportAgent(ctx);
  const isRequester = t.userId === ctx.user.id;
  if (!agent) {
    assert(isRequester, "Sem permissão para alterar este chamado.");
    assert(input.status === "closed" || input.status === "resolved" || input.status === "open", "Você pode marcar como resolvido, encerrar ou reabrir o seu chamado.");
    assert(input.assigneeId === undefined && input.priority === undefined, "Somente o suporte altera responsável e prioridade.");
  }
  const patch: Record<string, any> = {};
  if (input.status && input.status !== t.status) {
    assert(TICKET_STATUS.some((s) => s.value === input.status), "Situação inválida.");
    if (t.status === "closed") assert(agent, "Chamado encerrado só pode ser reaberto pelo suporte.");
    patch.status = input.status;
    if (input.status === "resolved") patch.resolvedAt = nowIso();
    if (input.status === "open" || input.status === "in_progress" || input.status === "waiting") patch.resolvedAt = null;
  }
  if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) patch.assigneeId = input.assigneeId || null;
  if (input.priority && input.priority !== t.priority) {
    assert(TICKET_PRIORITIES.some((p) => p.value === input.priority), "Prioridade inválida.");
    patch.priority = input.priority;
  }
  if (!Object.keys(patch).length) return t;
  const after = await ctx.store.update("tickets", id, patch);
  if (patch.status === "resolved" || patch.status === "closed") {
    await resolveOccurrence(ctx.store, `ticket:${id}:triage`).catch(() => 0);
    await resolveOccurrence(ctx.store, `ticket:${id}:awaiting-support`).catch(() => 0);
  }
  if (patch.assigneeId) await resolveOccurrence(ctx.store, `ticket:${id}:triage`).catch(() => 0);
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, t[k] ?? null]));
  await audit({ ...ctx, companyId: t.companyId === "public" ? ctx.companyId : t.companyId }, {
    module: "support", action: "ticket.update", entityType: "ticket", entityId: id,
    summary: `Chamado nº ${t.number} atualizado${patch.status ? `: ${label(t.status)} → ${label(patch.status)}` : ""}${patch.assigneeId !== undefined ? " (responsável alterado)" : ""}${patch.priority ? ` (prioridade ${patch.priority})` : ""}`,
    before, after: patch, reason: input.reason ?? null,
  });
  return after;
}

export interface TicketFilter {
  scope?: "mine" | "company" | "public" | "all";
  status?: string;
  category?: string;
  priority?: string;
  q?: string;
  assignee?: string;
}

export async function queryTickets(ctx: Ctx, f: TicketFilter) {
  const agent = isSupportAgent(ctx);
  const scope = agent ? f.scope || "all" : "mine";
  const companies = scope === "public" ? ["public"] : scope === "all" ? [ctx.companyId, "public"] : [ctx.companyId];
  const filters: Filter[] = [["eq", "companyId", companies]];
  if (scope === "mine") filters.push(["eq", "userId", ctx.user.id]);
  if (f.status === "active") filters.push(["eq", "status", ["open", "in_progress", "waiting"]]);
  else if (f.status) filters.push(["eq", "status", f.status]);
  if (f.category) filters.push(["eq", "category", f.category]);
  if (f.priority) filters.push(["eq", "priority", f.priority]);
  if (f.assignee === "me") filters.push(["eq", "assigneeId", ctx.user.id]);
  if (f.assignee === "none") filters.push(["isNull", "assigneeId"]);
  let rows = await listAll(ctx.store, "tickets", { filters, orderBy: [{ field: "lastMessageAt", dir: "desc" }] }, 5000);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((t) => `${t.number} ${t.subject} ${t.context?.userName ?? ""} ${t.context?.name ?? ""} ${t.context?.email ?? ""}`.toLowerCase().includes(q));
  }
  return rows.map((t) => ({
    ...t,
    requester: t.context?.userName ?? (t.context?.name ? `${t.context.name} (login)` : "—"),
    isPublic: t.companyId === "public",
    ageHours: Math.round((Date.now() - Date.parse(t.createdAt)) / 3600000),
  }));
}

export async function ticketMessages(store: Store, ticketId: string, includeInternal: boolean) {
  const rows = await listAll(store, "ticket_messages", { filters: [["eq", "ticketId", ticketId]], orderBy: [{ field: "createdAt", dir: "asc" }] });
  return includeInternal ? rows : rows.filter((m) => !m.internal);
}

/** Lê anexos enviados por formulário (File do FormData) com limite de tamanho. */
export async function attachmentsFromForm(fd: FormData, key = "attachments"): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const v of fd.getAll(key)) {
    if (typeof v === "string" || !v || !(v as File).size) continue;
    const f = v as File;
    out.push({ name: f.name || "anexo", mime: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()) });
  }
  assert(out.length <= 5, "Envie no máximo 5 anexos por mensagem.");
  return out;
}
