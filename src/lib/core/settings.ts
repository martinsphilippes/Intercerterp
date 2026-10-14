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
  "cash.withdrawalApprovalAbove": 0,
  "cash.blindClose": false,
  /** venda em caixa aberto por outro operador: "warn" (padrão), "block" ou "allow" */
  "cash.operatorMismatch": "warn",
  "abc.limitA": 8000,
  "abc.limitB": 9500,
  "replenishment.coverageDays": 14,
  "replenishment.historyDays": 90,
  "purchase.revisionRequiresReview": "relevant",
  "purchase.monthlyBudget": 0,
  "purchase.receiptValueTolerance": 0,
  "backup.schedule": { enabled: true, frequency: "daily", time: "02:00", retentionDays: 30, includeFiles: true },
  "notifications.stockMin": true,
  "timezone": "America/Sao_Paulo",
} as const;

/**
 * Padrão de recursos que mudam a operação (nascem DESLIGADOS por empresa: fidelidade muda o cupom e o pagamento, lotes e
 * reserva na pré-venda mudam o estoque). Os demais recursos novos (telas aditivas) nascem ligados.
 */
export const FEATURE_DEFAULTS: Record<string, boolean> = {
  fidelidade: false,
  lotes: false,
  reservaPreVenda: false,
  bipagemContagem: true,
  // Fase 7: fechamento de período financeiro recusa lançamentos retroativos (muda a operação); taxas por bandeira e DRE são aditivos
  fechamentoPeriodo: false,
  taxasCartao: true,
  dre: true,
};

/** Recursos novos desligados por padrão (derivado de FEATURE_DEFAULTS). */
export const FEATURES_OFF_BY_DEFAULT = Object.entries(FEATURE_DEFAULTS).filter(([, on]) => !on).map(([k]) => k);

/** Padrão do recurso: o do catálogo acima ou, sem registro, o informado (padrão: ligado). */
export const featureDefault = (key: string, fallback = true) => FEATURE_DEFAULTS[key] ?? fallback;

/**
 * Chave de liga/desliga de recursos novos (evolução por fases). Lê o parâmetro `feature.<key>` (filial → empresa);
 * sem valor gravado, vale o padrão informado, o que permite reverter uma fase sem reimplantar.
 */
export async function isFeatureOn(store: Store, companyId: string, branchId: string | null | undefined, key: string, fallback = false): Promise<boolean> {
  return Boolean(await getSetting(store, companyId, branchId, `feature.${key}`, fallback));
}

