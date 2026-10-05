import { detId, isConflict, listAll } from "../db";
import type { Store } from "../db/types";
import { can, canDo, type ModuleKey, type SpecialAction } from "../permissions";

export interface NotifyInput {
  companyId: string;
  branchId?: string | null;
  type: "stock_min" | "receivable_overdue" | "purchase_review" | "fiscal_rejected" | "integration_failure" | "deadline" | "ticket" | "cash" | "info" | "payable_due" | "backup";
  priority?: "low" | "normal" | "high" | "critical";
  title: string;
  body?: string;
  link?: string;
  originType?: string;
  originId?: string;
  /** chave da ocorrência na origem: resolver a origem resolve todas as notificações dela */
  occurrenceKey?: string;
  informative?: boolean;
  responsibleName?: string;
  audience: { userIds?: string[]; module?: ModuleKey; action?: SpecialAction; all?: boolean };
}

async function resolveAudience(store: Store, input: NotifyInput): Promise<string[]> {
  if (input.audience.userIds) return input.audience.userIds;
  const users = await listAll(store, "users", { filters: [["eq", "status", "active"]] });
  const roles = new Map((await listAll(store, "roles")).map((r) => [r.id, r]));
  return users
    .filter((u) => (u.companyIds ?? []).includes(input.companyId) || u.isAdmin)
    .filter((u) => !input.branchId || u.isAdmin || (u.branchIds ?? []).length === 0 || u.branchIds.includes(input.branchId))
    .filter((u) => {
      if (input.audience.all) return true;
      const role = u.roleId ? roles.get(u.roleId) : null;
      const subject = { isAdmin: Boolean(u.isAdmin), permissions: role?.permissions ?? {}, actions: role?.actions ?? [] };
      if (input.audience.action) return canDo(subject, input.audience.action);
      if (input.audience.module) return can(subject, input.audience.module, "view");
      return false;
    })
    .map((u) => u.id);
}

/** Preferências por tipo (Central de notificações): user_prefs "notifications" = { muted: [tipos] }. */
export const NOTIFICATION_PREFS_KEY = "notifications";

/** Remove destinatários que silenciaram o tipo (prioridade crítica sempre é entregue). */
async function withoutMuted(store: Store, input: NotifyInput, userIds: string[]): Promise<string[]> {
  if (input.priority === "critical") return userIds;
  const out: string[] = [];
  for (const uid of userIds) {
    const p = await store.get("user_prefs", detId("pref", uid, NOTIFICATION_PREFS_KEY)).catch(() => null);
    if (!(Array.isArray(p?.value?.muted) && p!.value.muted.includes(input.type))) out.push(uid);
  }
  return out;
}

/** Cria notificações por destinatário, deduplicadas pela ocorrência. */
export async function notify(store: Store, input: NotifyInput) {
  const userIds = await withoutMuted(store, input, await resolveAudience(store, input));
  const occ = input.occurrenceKey ?? `${input.type}:${input.originType ?? ""}:${input.originId ?? ""}:${Date.now()}`;
  let created = 0;
  for (const userId of userIds) {
    const dedupeKey = `${occ}|${userId}`;
    try {
      await store.create(
        "notifications",
        {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          userId,
          type: input.type,
          priority: input.priority ?? "normal",
          title: input.title,
          body: input.body ?? "",
          link: input.link ?? null,
          originType: input.originType ?? null,
          originId: input.originId ?? null,
          occurrenceKey: occ,
          occurrenceStatus: input.informative ? "informative" : "open",
          responsibleName: input.responsibleName ?? null,
          dedupeKey,
        },
        detId("notif", dedupeKey),
      );
      created++;
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  return created;
}

/** Marca a ocorrência como resolvida na origem (as notificações deixam de ser pendência). */
export async function resolveOccurrence(store: Store, occurrenceKey: string) {
  const items = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", occurrenceKey], ["eq", "occurrenceStatus", "open"]] });
  for (const n of items) await store.update("notifications", n.id, { occurrenceStatus: "resolved" });
  return items.length;
}

export async function reopenOccurrence(store: Store, occurrenceKey: string) {
  const items = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", occurrenceKey], ["eq", "occurrenceStatus", "resolved"]] });
  for (const n of items) await store.update("notifications", n.id, { occurrenceStatus: "open", readAt: null, archivedAt: null });
}
