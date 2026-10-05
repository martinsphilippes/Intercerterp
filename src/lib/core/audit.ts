import { nowIso } from "../dates";
import type { Ctx } from "./ctx";

const SECRET_KEYS = /token|secret|password|senha|apikey|api_key|csc|certificado_senha|authorization/i;

/** Remove valores sensíveis antes de registrar em histórico. */
export function sanitize(value: any, depth = 0): any {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? (v ? "••••" : v) : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "…";
  return value;
}

export interface AuditInput {
  module: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: "success" | "failure";
  operationId?: string | null;
  /** referências "tipo:id" relacionadas, para linhas do tempo cruzadas */
  related?: string[];
  branchId?: string | null;
}

export async function audit(ctx: Ctx, input: AuditInput) {
  try {
    await ctx.store.create("audit_logs", {
      companyId: ctx.companyId,
      branchId: input.branchId ?? ctx.branchId,
      userId: ctx.user.id,
      userName: ctx.user.name,
      userRole: ctx.user.isAdmin ? "Administrador" : (ctx.user.roleName ?? null),
      module: input.module,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      before: input.before === undefined ? null : sanitize(input.before),
      after: input.after === undefined ? null : sanitize(input.after),
      reason: input.reason ?? null,
      result: input.result ?? "success",
      ip: ctx.ip ?? null,
      occurredAt: nowIso(),
      operationId: input.operationId ?? null,
      related: [...new Set([`${input.entityType}:${input.entityId ?? ""}`, ...(input.related ?? [])])],
    });
  } catch (e) {
    // auditoria nunca deve derrubar a operação principal; registra no log do servidor
    console.error("[audit] falha ao registrar", e);
  }
}

/** Diferença rasa entre dois objetos (somente campos alterados). */
export function diff(before: Record<string, any> | null, after: Record<string, any>) {
  const b: Record<string, any> = {};
  const a: Record<string, any> = {};
  for (const k of Object.keys(after)) {
    if (["updatedAt", "createdAt", "searchText"].includes(k)) continue;
    const bv = before?.[k];
    const av = after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = bv ?? null;
      a[k] = av;
    }
  }
  return { before: b, after: a };
}
