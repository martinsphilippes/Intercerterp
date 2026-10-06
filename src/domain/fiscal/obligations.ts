import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { addMonths, diffDays, formatDate, monthEnd, monthStart, nowIso, today } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { getSetting, setSetting } from "@/lib/core/settings";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import type { FiscalReportFilter } from "./reports";

/**
 * Obrigações fiscais (Tela 35): o sistema ACOMPANHA a obrigação (calendário, situação, responsável e comprovação).
 * Não gera PGDAS-D/DEFIS/SPED. Datas de vencimento são PARÂMETROS da empresa (modelos editáveis),
 * não prazos legais universais — confirme com a contabilidade.
 */

export const OBLIGATION_KIND_LABEL: Record<string, string> = {
  pgdas_d: "PGDAS-D (apuração do Simples Nacional)",
  das: "Pagamento do DAS",
  defis: "DEFIS (declaração anual do Simples Nacional)",
  livro_fiscal: "Livro fiscal (registro de saídas/entradas)",
  xml_contabilidade: "Entrega de XML à contabilidade",
  other: "Outra obrigação",
};

/** O que o sistema produz para cada obrigação (natureza explícita). */
export const OBLIGATION_SUPPORT: Record<string, string> = {
  pgdas_d: "Acompanhamento. A apuração/transmissão é feita no portal do Simples Nacional; anexe o recibo/extrato.",
  das: "Acompanhamento. Anexe o comprovante de pagamento.",
  defis: "Acompanhamento. A declaração é transmitida no portal do Simples Nacional; anexe o recibo.",
  livro_fiscal: "Apoio: o sistema gera o relatório de registro de saídas em CSV (não é a escrituração oficial/SPED).",
  xml_contabilidade: "Gerado pelo sistema: pacote ZIP com XMLs armazenados + relatórios CSV, enviado pelo canal da contabilidade (conclusão automática quando o envio é confirmado).",
  other: "Acompanhamento manual.",
};

export const OBLIGATION_STATUS_LABEL: Record<string, string> = { pending: "A fazer", in_progress: "Em andamento", done: "Concluída", waived: "Dispensada", late: "Atrasada", due_soon: "Vence em breve" };

export interface ObligationTemplate {
  key: string;
  kind: string;
  name: string;
  recurrence: "monthly" | "annual";
  /** dia do vencimento (mês seguinte à competência, ou no mês `dueMonth` do ano seguinte) */
  dueDay: number;
  dueMonth?: number;
  requiresProof: boolean;
  active: boolean;
  responsibleId?: string | null;
}

export const TEMPLATES_KEY = "fiscal.obligations.templates";

/** Modelos iniciais — valores PARAMETRIZÁVEIS (ajuste conforme orientação da contabilidade). */
export const DEFAULT_TEMPLATES: ObligationTemplate[] = [
  { key: "pgdas_d", kind: "pgdas_d", name: "PGDAS-D — apuração mensal", recurrence: "monthly", dueDay: 20, requiresProof: true, active: true },
  { key: "das", kind: "das", name: "Pagamento do DAS", recurrence: "monthly", dueDay: 20, requiresProof: true, active: true },
  { key: "xml_contabilidade", kind: "xml_contabilidade", name: "Entrega de XML e relatórios à contabilidade", recurrence: "monthly", dueDay: 5, requiresProof: false, active: true },
  { key: "livro_fiscal", kind: "livro_fiscal", name: "Livro de registro de saídas (conferência)", recurrence: "monthly", dueDay: 15, requiresProof: false, active: true },
  { key: "defis", kind: "defis", name: "DEFIS — declaração anual", recurrence: "annual", dueDay: 31, dueMonth: 3, requiresProof: true, active: true },
];

export async function getTemplates(ctx: Ctx): Promise<ObligationTemplate[]> {
  return getSetting<ObligationTemplate[]>(ctx.store, ctx.companyId, null, TEMPLATES_KEY, DEFAULT_TEMPLATES);
}

export async function saveTemplates(ctx: Ctx, templates: ObligationTemplate[]) {
  requireAction(ctx, "fiscal.configure");
  const keys = new Set<string>();
  for (const t of templates) {
    assert(t.key && /^[a-z0-9_]{2,40}$/.test(t.key), "Chave do modelo inválida.");
    assert(!keys.has(t.key), `Modelo duplicado: ${t.key}.`);
    keys.add(t.key);
    assert(t.name?.trim(), "Informe o nome do modelo.");
    assert(OBLIGATION_KIND_LABEL[t.kind], "Tipo de obrigação inválido.");
    assert(Number.isInteger(t.dueDay) && t.dueDay >= 1 && t.dueDay <= 31, "Dia de vencimento inválido.");
    if (t.recurrence === "annual") assert(Number.isInteger(t.dueMonth) && t.dueMonth! >= 1 && t.dueMonth! <= 12, "Mês de vencimento inválido.");
  }
  const before = await getTemplates(ctx);
  await setSetting(ctx.store, ctx.companyId, null, TEMPLATES_KEY, templates, ctx.user.id);
  await audit(ctx, { module: "fiscal", action: "obligation.templates", entityType: "setting", entityId: TEMPLATES_KEY, summary: `Calendário de obrigações atualizado (${templates.length} modelo(s))`, before, after: templates });
  return templates;
}

function clampDay(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Competência e vencimento de um modelo relativos a uma data de referência. */
export function occurrenceFor(t: ObligationTemplate, ref: string) {
  if (t.recurrence === "annual") {
    const year = Number(ref.slice(0, 4)) - 1;
    return { period: String(year), dueDate: clampDay(year + 1, t.dueMonth ?? 3, t.dueDay) };
  }
  const comp = addMonths(monthStart(ref), -1);
  const next = monthStart(ref);
  return { period: comp.slice(0, 7), dueDate: clampDay(Number(next.slice(0, 4)), Number(next.slice(5, 7)), t.dueDay) };
}

export const obligationId = (companyId: string, key: string, period: string) => detId("obligation", companyId, key, period);

/** Gera (idempotente) as obrigações da competência anterior à data de referência. */
export async function generateObligations(ctx: Ctx, ref = today()) {
  const templates = (await getTemplates(ctx)).filter((t) => t.active);
  let created = 0;
  for (const t of templates) {
    const { period, dueDate } = occurrenceFor(t, ref);
    // não retroage: ocorrências vencidas há mais de 60 dias não são criadas automaticamente (cadastre manualmente se necessário)
    if (diffDays(dueDate, ref) > 60) continue;
    const id = obligationId(ctx.companyId, t.key, period);
    if (await ctx.store.get("fiscal_obligations", id)) continue;
    try {
      await ctx.store.create(
        "fiscal_obligations",
        { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, kind: t.kind, name: t.name, period, dueDate, status: "pending", recurrence: t.recurrence, templateKey: t.key, scopeKey: `${t.key}|${period}`, responsibleId: t.responsibleId ?? null },
        id,
      );
      created++;
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  return { created };
}

export function displayStatus(o: Doc, ref = today()) {
  if (o.status === "done" || o.status === "waived") return o.status;
  if (o.dueDate < ref) return "late";
  if (diffDays(ref, o.dueDate) <= 5) return "due_soon";
  return o.status ?? "pending";
}

export async function listObligations(ctx: Ctx, f: { from?: string; to?: string; status?: string; kind?: string } = {}) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (f.from) filters.push(["gte", "dueDate", f.from]);
  if (f.to) filters.push(["lte", "dueDate", f.to]);
  if (f.kind) filters.push(["eq", "kind", f.kind]);
  const rows = await listAll(ctx.store, "fiscal_obligations", { filters, orderBy: [{ field: "dueDate", dir: "asc" }] });
  const t = today();
  const out = rows.map((o) => ({ ...o, display: displayStatus(o, t) }));
  return f.status ? out.filter((o) => o.display === f.status || o.status === f.status) : out;
}

export interface ObligationInput {
  kind: string;
  name: string;
  period: string;
  dueDate: string;
  responsibleId?: string | null;
  notes?: string | null;
}

export async function saveObligation(ctx: Ctx, id: string | null, input: ObligationInput) {
  requireAction(ctx, "fiscal.issue");
  assert(OBLIGATION_KIND_LABEL[input.kind], "Tipo de obrigação inválido.");
  assert(input.name?.trim(), "Informe o nome da obrigação.");
  assert(/^\d{4}(-\d{2})?$/.test(input.period ?? ""), "Competência inválida (AAAA-MM ou AAAA).");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate ?? ""), "Informe o vencimento.");
  const data = { kind: input.kind, name: input.name.trim(), period: input.period, dueDate: input.dueDate, responsibleId: input.responsibleId || null, notes: input.notes?.trim() || null };
  if (id) {
    const before = await ctx.store.getOrThrow("fiscal_obligations", id);
    assert(before.companyId === ctx.companyId, "Obrigação de outra empresa.");
    const after = await ctx.store.update("fiscal_obligations", id, data);
    await audit(ctx, { module: "fiscal", action: "obligation.update", entityType: "fiscal_obligation", entityId: id, summary: `Obrigação "${data.name}" (${data.period}) alterada`, before, after: data });
    return after;
  }
  const doc = await ctx.store.create("fiscal_obligations", { ...data, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, status: "pending", recurrence: "none" });
  await audit(ctx, { module: "fiscal", action: "obligation.create", entityType: "fiscal_obligation", entityId: doc.id, summary: `Obrigação "${data.name}" (${data.period}) cadastrada — vence ${formatDate(data.dueDate)}`, after: data });
  return doc;
}

export async function setObligationStatus(ctx: Ctx, id: string, status: "pending" | "in_progress" | "waived", reason?: string | null) {
  requireAction(ctx, "fiscal.issue");
  const o = await ctx.store.getOrThrow("fiscal_obligations", id);
  assert(o.companyId === ctx.companyId, "Obrigação de outra empresa.");
  if (status === "waived") assert(reason?.trim(), "Informe o motivo da dispensa.");
  const after = await ctx.store.update("fiscal_obligations", id, { status, ...(status === "pending" ? { deliveredAt: null, completedBy: null } : {}), notes: reason ? [o.notes, `${status === "waived" ? "Dispensada" : "Situação alterada"}: ${reason}`].filter(Boolean).join("\n").slice(0, 500) : o.notes });
  if (status === "waived") await resolveOccurrence(ctx.store, `obligation:${id}`);
  await audit(ctx, { module: "fiscal", action: "obligation.status", entityType: "fiscal_obligation", entityId: id, summary: `Obrigação "${o.name}" (${o.period}): ${OBLIGATION_STATUS_LABEL[status]}`, reason: reason ?? null });
  return after;
}

export async function completeObligation(ctx: Ctx, id: string, input: { deliveredAt: string; receiptNumber?: string | null; amount?: number | null; notes?: string | null; proof?: { name: string; mime: string; data: Buffer } | null }) {
  requireAction(ctx, "fiscal.issue");
  const o = await ctx.store.getOrThrow("fiscal_obligations", id);
  assert(o.companyId === ctx.companyId, "Obrigação de outra empresa.");
  assert(o.status !== "done", "Obrigação já concluída.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.deliveredAt ?? ""), "Informe a data de entrega/pagamento.");
  assert(input.deliveredAt <= today(), "A data de entrega não pode ser futura.");
  const tpl = (await getTemplates(ctx)).find((t) => t.key === o.templateKey);
  let proofFileId = o.proofFileId ?? null;
  if (input.proof) {
    assert(input.proof.data.length > 0 && input.proof.data.length < 10_000_000, "Comprovante com tamanho inválido (até 10 MB).");
    const f = await saveFile(ctx, { bucket: "attachments", name: input.proof.name, mime: input.proof.mime || "application/octet-stream", data: input.proof.data, entityType: "fiscal_obligation", entityId: id, kind: "proof" });
    proofFileId = f.id;
  }
  if (tpl?.requiresProof && !proofFileId && !o.exportFileId) throw new BusinessError("Esta obrigação exige comprovante anexado (recibo, extrato ou comprovante de pagamento).", "proof_required");
  const after = await ctx.store.update("fiscal_obligations", id, {
    status: "done",
    deliveredAt: new Date(`${input.deliveredAt}T12:00:00Z`).toISOString(),
    receiptNumber: input.receiptNumber?.trim() || null,
    amount: input.amount ?? null,
    proofFileId,
    completedBy: ctx.user.id,
    notes: input.notes?.trim() ? [o.notes, input.notes.trim()].filter(Boolean).join("\n").slice(0, 500) : o.notes,
  });
  await resolveOccurrence(ctx.store, `obligation:${id}`);
  await resolveOccurrence(ctx.store, `obligation-late:${id}`);
  await audit(ctx, { module: "fiscal", action: "obligation.complete", entityType: "fiscal_obligation", entityId: id, summary: `Obrigação "${o.name}" (${o.period}) concluída em ${formatDate(input.deliveredAt)}${proofFileId ? " com comprovante" : ""}`, after: { receiptNumber: input.receiptNumber, amount: input.amount } });
  return after;
}

export async function deleteObligation(ctx: Ctx, id: string) {
  requireAction(ctx, "fiscal.configure");
  const o = await ctx.store.getOrThrow("fiscal_obligations", id);
  assert(o.companyId === ctx.companyId, "Obrigação de outra empresa.");
  assert(o.status !== "done", "Obrigação concluída não pode ser excluída (histórico de comprovação).");
  await ctx.store.delete("fiscal_obligations", id);
  await resolveOccurrence(ctx.store, `obligation:${id}`);
  await audit(ctx, { module: "fiscal", action: "obligation.delete", entityType: "fiscal_obligation", entityId: id, summary: `Obrigação "${o.name}" (${o.period}) excluída` });
}

/** Envio confirmado do pacote mensal conclui a obrigação "Entrega de XML" da competência (comprovação = registro do envio). */
export async function markXmlDelivery(ctx: Ctx, f: FiscalReportFilter, fileId: string, to: string) {
  const period = f.from.slice(0, 7);
  // somente o pacote do MÊS INTEIRO comprova a entrega da competência (período parcial não conclui a obrigação)
  if (f.from !== monthStart(f.from) || f.to !== monthEnd(f.from)) return null;
  const rows = await listAll(ctx.store, "fiscal_obligations", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "xml_contabilidade"], ["eq", "period", period]] });
  const o = rows.find((x) => x.status !== "done");
  if (!o) return null;
  const after = await ctx.store.update("fiscal_obligations", o.id, { status: "done", deliveredAt: nowIso(), exportFileId: fileId, receiptNumber: `E-mail para ${to}`.slice(0, 120), completedBy: ctx.user.id });
  await resolveOccurrence(ctx.store, `obligation:${o.id}`);
  await resolveOccurrence(ctx.store, `obligation-late:${o.id}`);
  await audit(ctx, { module: "fiscal", action: "obligation.complete", entityType: "fiscal_obligation", entityId: o.id, summary: `Entrega de XML (${period}) concluída pelo envio do pacote para ${to}`, related: [`file:${fileId}`] });
  return after;
}

/** Avisos de vencimento (≤5 dias) e atraso — uma notificação por ocorrência. */
export async function notifyDeadlines(ctx: Ctx, ref = today()) {
  const open = await listAll(ctx.store, "fiscal_obligations", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["pending", "in_progress"]]] });
  let sent = 0;
  for (const o of open) {
    const days = diffDays(ref, o.dueDate);
    if (days > 5) continue;
    const late = days < 0;
    sent += await notify(ctx.store, {
      companyId: ctx.companyId,
      type: "deadline",
      priority: late ? "high" : "normal",
      title: late ? `Obrigação atrasada: ${o.name} (${o.period})` : `Obrigação vence ${days === 0 ? "hoje" : `em ${days} dia(s)`}: ${o.name} (${o.period})`,
      body: `Vencimento parametrizado: ${formatDate(o.dueDate)}. ${OBLIGATION_SUPPORT[o.kind] ?? ""}`,
      link: `/fiscal/relatorios?tab=obrigacoes`,
      originType: "fiscal_obligation",
      originId: o.id,
      occurrenceKey: late ? `obligation-late:${o.id}` : `obligation:${o.id}`,
      audience: o.responsibleId ? { userIds: [o.responsibleId] } : { action: "fiscal.issue" },
    }).catch(() => 0);
  }
  return { sent };
}
