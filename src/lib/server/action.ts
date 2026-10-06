import "server-only";
import { revalidatePath } from "next/cache";
import { BusinessError } from "../core/errors";
import { isConflict, isNotFound } from "../db";
import { requireSession, type SessionInfo } from "./session";
import type { Crud, ModuleKey } from "../permissions";
import { can } from "../permissions";
import { scheduleBackgroundJobs } from "./background-jobs";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string; redirect?: string } | { ok: false; error: string; code?: string; fields?: Record<string, string> };

/**
 * Envolve uma server action: resolve sessão/permissão, converte erros de regra em mensagens,
 * registra falhas inesperadas no log do servidor e revalida caminhos informados.
 */
export async function runAction<T>(
  opts: { module?: ModuleKey; op?: Crud; revalidate?: string[]; requireBranch?: boolean },
  fn: (s: SessionInfo) => Promise<T | ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const s = await requireSession();
    if (opts.module && !can(s.user, opts.module, opts.op ?? "view")) {
      const { audit } = await import("../core/audit");
      await audit(s.ctx, { module: opts.module, action: `${opts.module}.denied`, entityType: "permission", entityId: `${opts.module}:${opts.op ?? "view"}`, summary: `Ação negada: sem permissão "${opts.op ?? "view"}" em ${opts.module}`, result: "failure" });
      return { ok: false, error: "Você não tem permissão para esta ação.", code: "forbidden" };
    }
    if (opts.requireBranch && !s.branch) return { ok: false, error: "Selecione uma filial específica (o contexto consolidado é somente consulta).", code: "branch_required" };
    const out = await fn(s);
    for (const p of opts.revalidate ?? []) revalidatePath(p);
    // tarefas vencidas (retentativas, envio fiscal, e-mails) rodam depois da resposta, sem atrasar a tela
    scheduleBackgroundJobs();
    if (out && typeof out === "object" && "ok" in (out as any)) return out as ActionResult<T>;
    return { ok: true, data: out as T };
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    if (e instanceof BusinessError) {
      if (e.code === "forbidden") {
        try {
          const s2 = await requireSession();
          const { audit } = await import("../core/audit");
          await audit(s2.ctx, { module: opts.module ?? "admin", action: `${opts.module ?? "action"}.denied`, entityType: "permission", entityId: opts.module ?? null, summary: `Ação negada: ${e.message}`, result: "failure" });
        } catch {
          /* sem sessão */
        }
      }
      return { ok: false, error: e.message, code: e.code };
    }
    if (isConflict(e)) return { ok: false, error: "O registro foi alterado por outra operação ao mesmo tempo ou já existe. Atualize e tente novamente.", code: "conflict" };
    if (isNotFound(e)) return { ok: false, error: "Registro não encontrado.", code: "not_found" };
    console.error("[action] erro inesperado", e);
    return { ok: false, error: `Erro inesperado: ${e?.message ?? e}`, code: "unexpected" };
  }
}

/** Utilitários de leitura de FormData */
export function fstr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function fopt(fd: FormData, key: string): string | null {
  const v = fstr(fd, key);
  return v === "" ? null : v;
}
export function fbool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
export function fint(fd: FormData, key: string, fallback = 0): number {
  const v = fstr(fd, key);
  if (v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
export function fjson<T = any>(fd: FormData, key: string, fallback: T): T {
  const v = fstr(fd, key);
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
