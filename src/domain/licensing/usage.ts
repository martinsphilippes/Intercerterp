import { listAll } from "@/lib/db";
import type { Filter, Store } from "@/lib/db/types";
import { MODULE_MAP } from "@/lib/modules/catalog";
import { USAGE_EVIDENCE } from "../modules/baseline";
import { licenseLimits, limitUsage } from "./limits";
import { unitByV1Key } from "./effective";

/**
 * Telemetria agregada para o Interos (contrato v2 §6). Só contagens e datas — nunca nomes, documentos de terceiros,
 * XML, itens, credenciais ou valores individuais. Sempre filtrado pela empresa da rota.
 */
export async function companyUsage(store: Store, companyId: string, from: string, to: string) {
  const range: Filter = ["between", "createdAt", from, to];
  const count = async (collection: string, filters: Filter[] = []) =>
    (await store.list(collection, { filters: [["eq", "companyId", companyId], range, ...filters], limit: 1, total: true })).total;
  const last = async (collection: string, filters: Filter[] = []) =>
    (await store.list(collection, { filters: [["eq", "companyId", companyId], ...filters], orderBy: [{ field: "createdAt", dir: "desc" }], limit: 1 })).items[0]?.createdAt ?? null;
  const modules: Record<string, { unit: string | null; name: string; operations: number; lastUseAt: string | null }> = {};
  for (const [key, ev] of Object.entries(USAGE_EVIDENCE)) {
    modules[key] = { unit: unitByV1Key(key)?.code ?? null, name: MODULE_MAP.get(key)?.name ?? key, operations: await count(ev.collection, ev.filters ?? []), lastUseAt: await last(ev.collection, ev.filters ?? []) };
  }
  const fiscal: Record<string, number> = {};
  for (const model of ["nfe", "nfce", "nfse"]) fiscal[model] = await count("fiscal_documents", [["eq", "model", model], ["eq", "status", "authorized"]]);
  const users = await listAll(store, "users");
  const activeUsers = users.filter((u) => (u.companyIds ?? []).includes(companyId) && u.lastAccessAt && u.lastAccessAt >= from && u.lastAccessAt <= to).length;
  const [openCash, integrations, failedJobs, deniedOps, limits, used] = await Promise.all([
    store.list("cash_sessions", { filters: [["eq", "companyId", companyId], ["eq", "status", ["open", "reopened"]]], limit: 1, total: true }).then((r) => r.total),
    store.list("integrations", { filters: [["eq", "companyId", companyId], ["eq", "enabled", true]], limit: 1, total: true }).then((r) => r.total),
    store.list("jobs", { filters: [["eq", "companyId", companyId], ["eq", "status", "dead"], range], limit: 1, total: true }).then((r) => r.total),
    store.list("audit_logs", { filters: [["eq", "companyId", companyId], ["eq", "action", "module.denied"], ["between", "occurredAt", from, to]], limit: 1, total: true }).then((r) => r.total),
    licenseLimits(store, companyId),
    limitUsage(store, companyId),
  ]);
  return {
    companyId, from, to,
    totals: {
      activeUsers, sales: await count("sales"), onlineOrders: await count("online_orders"), fiscalDocumentsAuthorized: fiscal, openCashSessions: openCash,
      branches: used.branches, devices: used.devices, activeIntegrations: integrations, operationalErrors: failedJobs, deniedByLicense: deniedOps,
    },
    limits: { contracted: limits, used },
    modules,
  };
}
