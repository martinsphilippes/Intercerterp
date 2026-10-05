import { detId, isConflict } from "../db";
import type { Store } from "../db/types";

const scopeKey = (companyId: string, branchId: string | null | undefined, key: string) => `${companyId}|${branchId ?? "*"}|${key}`;

/** Lê parâmetro na filial e, se ausente, na empresa; senão retorna o padrão. */
export async function getSetting<T>(store: Store, companyId: string, branchId: string | null | undefined, key: string, fallback: T): Promise<T> {
  if (branchId) {
    const b = await store.get("settings", detId("setting", scopeKey(companyId, branchId, key)));
    if (b) return b.value as T;
  }
  const c = await store.get("settings", detId("setting", scopeKey(companyId, null, key)));
  return c ? (c.value as T) : fallback;
}

export async function setSetting(store: Store, companyId: string, branchId: string | null, key: string, value: unknown, userId?: string) {
  const sk = scopeKey(companyId, branchId, key);
  const id = detId("setting", sk);
  const existing = await store.get("settings", id);
  if (existing) return store.update("settings", id, { value, updatedBy: userId ?? null });
  try {
    return await store.create("settings", { companyId, branchId, scopeKey: sk, key, value, updatedBy: userId ?? null }, id);
  } catch (e) {
    if (isConflict(e)) return store.update("settings", id, { value, updatedBy: userId ?? null });
    throw e;
  }
}

/** Parâmetros comerciais/operacionais padrão (editáveis em Administração). */
export const DEFAULT_SETTINGS = {
  "sales.allowNegativeStock": false,
  "sales.consumerFinalAllowed": true,
  "sales.presaleExpiryHours": 72,
  "cash.requireJustificationAbove": 0,
  "abc.limitA": 8000,
  "abc.limitB": 9500,
  "replenishment.coverageDays": 14,
  "replenishment.historyDays": 90,
  "purchase.revisionRequiresReview": "relevant",
  "backup.schedule": { enabled: true, frequency: "daily", time: "02:00", retentionDays: 30, includeFiles: true },
  "notifications.stockMin": true,
  "timezone": "America/Sao_Paulo",
} as const;
