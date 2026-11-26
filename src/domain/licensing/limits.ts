import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { BusinessError } from "@/lib/core/errors";
import { licenseId } from "./license";
import { emitInterosEvent } from "./events";

/**
 * Limites contratados (contrato v2 §5). Só barram NOVOS cadastros/ativações — nada existente é inativado.
 * Documentos fiscais: decisão do titular — a emissão legal NUNCA é bloqueada; só avisa e gera o evento de excedente.
 */
export type LimitKind = "users" | "devices" | "branches";

export async function licenseLimits(store: Store, companyId: string): Promise<{ users?: number | null; devices?: number | null; branches?: number | null; fiscalDocumentsPerMonth?: number | null } | null> {
  const lic = await store.get("company_licenses", licenseId(companyId));
  return (lic?.limits as any) ?? null;
}

export async function limitUsage(store: Store, companyId: string) {
  const [users, terminals, branches] = await Promise.all([
    listAll(store, "users"),
    listAll(store, "terminals", { filters: [["eq", "companyId", companyId], ["eq", "status", "active"]] }),
    listAll(store, "branches", { filters: [["eq", "companyId", companyId]] }),
  ]);
  return {
    users: users.filter((u) => !u.isAdmin && (u.companyIds ?? []).includes(companyId) && ["active", "invited"].includes(u.status ?? "active")).length,
    devices: terminals.length,
    branches: branches.filter((b) => b.status !== "inactive").length,
  };
}

const LABEL: Record<LimitKind, string> = { users: "usuários", devices: "dispositivos (terminais)", branches: "filiais" };

/** Recusa o novo cadastro quando o limite contratado já foi atingido. Sem licença ou sem limite: livre. */
export async function assertWithinLimit(store: Store, companyId: string, kind: LimitKind, adding = 1) {
  const limits = await licenseLimits(store, companyId);
  const max = limits?.[kind];
  if (max == null) return;
  const used = (await limitUsage(store, companyId))[kind];
  if (used + adding > max) {
    await emitInterosEvent(store, companyId, "limit.reached", { kind, used, limit: max }, `limit:${companyId}:${kind}:${new Date().toISOString().slice(0, 10)}`);
    throw new BusinessError(`Limite contratado de ${LABEL[kind]} atingido (${used} de ${max}). Fale com o responsável pelo contrato para ampliar.`, "license_limit", { kind, used, limit: max });
  }
}

/** Emissão fiscal: só aviso (uma vez por mês e empresa) quando passa do limite contratado. */
export async function noteFiscalDocumentUsage(store: Store, companyId: string) {
  const limits = await licenseLimits(store, companyId);
  const max = limits?.fiscalDocumentsPerMonth;
  if (max == null) return;
  const month = new Date().toISOString().slice(0, 7);
  const res = await store.list("fiscal_documents", { filters: [["eq", "companyId", companyId], ["gte", "createdAt", `${month}-01T00:00:00.000Z`]], limit: 1, total: true });
  if (res.total > max) await emitInterosEvent(store, companyId, "limit.reached", { kind: "fiscalDocumentsPerMonth", used: res.total, limit: max, month, blocking: false }, `limit:${companyId}:fiscal:${month}`);
}
