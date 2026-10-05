import "server-only";
import { listAll } from "@/lib/db";
import type { Filter } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { addDays, dayRange, today } from "@/lib/dates";
import { MODULES } from "@/lib/permissions";
import { ENTITY_LABEL } from "./origin";

export const MODULE_LABEL: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

/** Ações sensíveis: acesso/permissões, cancelamentos, estornos, ajustes, aprovações, exportações, backup e parâmetros. */
const SENSITIVE = [/^role\./, /^user\./, /^auth\.login_failed/, /\.denied$/, /cancel/, /revers/, /reopen/, /adjust/, /approve/, /discount/, /^data\.export/, /^backup\./, /^restore\./, /^setting\./, /^integration\./, /^company\./, /^branch\./, /config/, /numbers\.disable/, /password/];

export function isSensitive(action: string | null | undefined) {
  const a = String(action ?? "");
  return SENSITIVE.some((r) => r.test(a));
}

/** Identificador legível do evento. */
export function auditCode(id: string) {
  return `AUD-${id.slice(0, 8).toUpperCase()}`;
}

/** Data/hora com segundos (horário de Brasília). */
export function formatStamp(v: string | null | undefined) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(v));
}

/** Período padrão: últimos 30 dias (inclui hoje). */
export function auditPeriod(f: Record<string, string>) {
  const to = f.to || today();
  const from = f.from || addDays(to, -29);
  return { from, to };
}

/** Consulta única do histórico (tela e exportação). */
export async function queryAudit(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const { from, to } = auditPeriod(p.f);
  const r = dayRange(from, to);
  const filters: Filter[] = [["eq", "companyId", ctx.companyId], ["gte", "occurredAt", r.start], ["lt", "occurredAt", r.end]];
  if (p.f.user) filters.push(["eq", "userId", p.f.user]);
  if (p.f.module) filters.push(["eq", "module", p.f.module]);
  if (p.f.branch) filters.push(["eq", "branchId", p.f.branch]);
  if (p.f.entity) filters.push(["eq", "entityType", p.f.entity]);
  if (p.f.entityId) filters.push(["eq", "entityId", p.f.entityId]);
  let rows = await listAll(ctx.store, "audit_logs", { filters, orderBy: [{ field: "occurredAt", dir: "desc" }] }, 50000);
  const actions = [...new Set(rows.map((x) => x.action as string))].sort();
  if (p.f.sensitive === "1") rows = rows.filter((x) => isSensitive(x.action));
  if (p.f.action) rows = rows.filter((x) => x.action === p.f.action || String(x.action).startsWith(`${p.f.action}.`));
  if (p.q) {
    const q = normalizeSearch(p.q);
    rows = rows.filter((x) => normalizeSearch(`${x.summary} ${x.userName ?? ""} ${x.action} ${x.reason ?? ""} ${x.entityId ?? ""}`).includes(q));
  }
  const counts = { all: rows.length, success: rows.filter((x) => x.result !== "failure").length, failure: rows.filter((x) => x.result === "failure").length };
  if (p.f.result === "failure") rows = rows.filter((x) => x.result === "failure");
  if (p.f.result === "success") rows = rows.filter((x) => x.result !== "failure");
  const out = rows.map((x) => ({
    ...x,
    moduleLabel: MODULE_LABEL[x.module] ?? x.module,
    entityLabel: ENTITY_LABEL[x.entityType] ?? x.entityType,
    hasChanges: Boolean(x.before && typeof x.before === "object" && Object.keys(x.before).length),
    sensitive: isSensitive(x.action),
    code: auditCode(x.id),
  }));
  return Object.assign(out, { period: { from, to }, actions, counts });
}
