import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { ListParams } from "@/lib/list";
import { backupCode } from "@/domain/backup";

/** Situação de integridade (independente da situação da cópia). */
export function integrityOf(b: Record<string, any>): "verified" | "failed" | "pending" | "none" {
  if (b.status === "verified") return "verified";
  if (b.status !== "completed") return "none";
  if (b.verifyResult && b.verifyResult.ok === false) return "failed";
  return "pending";
}

export const INTEGRITY_LABEL = { verified: "Verificada (restaurável)", failed: "Falhou na verificação", pending: "Pendente", none: "—" } as const;

/** Histórico de cópias da empresa (tela e exportação). */
export async function queryBackups(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const [rows, users] = await Promise.all([
    listAll(ctx.store, "backups", { filters: [["eq", "companyId", ctx.companyId]], orderBy: [{ field: "startedAt", dir: "desc" }] }),
    listAll(ctx.store, "users"),
  ]);
  let out = rows.map((b) => ({
    ...b,
    code: backupCode(b),
    originLabel: b.kind === "auto" ? "Automática" : "Manual",
    requestedBy: b.kind === "auto" ? "Rotina automática" : (users.find((u) => u.id === b.createdBy)?.name ?? "—"),
    integrity: integrityOf(b),
    rows: b.scope?.rows ?? null,
    files: b.scope?.files?.included ?? 0,
    includeFiles: Boolean(b.scope?.includeFiles),
  }));
  if (p.f.status) out = out.filter((b) => b.status === p.f.status || (p.f.status === "completed" && b.status === "verified"));
  if (p.f.kind) out = out.filter((b) => b.kind === p.f.kind);
  if (p.f.integrity) out = out.filter((b) => b.integrity === p.f.integrity);
  return out;
}

export function formatBytes(n: number | null | undefined) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB`;
  return `${(n / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
}

