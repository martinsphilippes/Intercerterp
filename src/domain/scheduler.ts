import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { getSetting, setSetting } from "@/lib/core/settings";
import { today } from "@/lib/dates";
import { decide, loadCompanyModules } from "@/lib/modules/access";
import { ALWAYS_RUN_ROUTINES } from "@/lib/modules/catalog";
import { bestLevel, modulesForRoutine } from "@/lib/modules/surfaces";

/**
 * Rotinas periódicas idempotentes (executadas pelo cron em /api/jobs):
 *  - notificações de títulos vencidos e contas a pagar do dia;
 *  - backup agendado (conforme parâmetros);
 *  - prazos de obrigações fiscais.
 * Cada rotina registra a última execução diária por empresa para não repetir.
 */
type Routine = (store: Store, companyId: string) => Promise<unknown>;
const routines = new Map<string, Routine>();
/** Rotinas da plataforma: rodam também com a empresa suspensa (não operam o negócio do cliente). */
export const PLATFORM_ROUTINES = new Set(["licenses.maintenance", "interos.reconcile", "modules.maintenance"]);

export function registerRoutine(key: string, fn: Routine) {
  routines.set(key, fn);
}

export async function runScheduled(store: Store) {
  const companies = await listAll(store, "companies");
  const out: Record<string, unknown> = {};
  const day = today();
  for (const c of companies) {
    // empresa suspensa pelo contrato (bloqueio da conta): rotinas de negócio retidas até a reativação (o histórico fica
    // como está); as da plataforma — licença, módulos e conciliação com o Interos — continuam, para que teste, agenda e
    // vigência não fiquem paradas
    const suspended = c.status === "suspended";
    // habilitação (docs/modulos): rotina de módulo não habilitado não roda — exceto as que encerram obrigações
    const modules = await loadCompanyModules(store, c.id);
    for (const [key, fn] of routines) {
      if (suspended && !PLATFORM_ROUTINES.has(key)) {
        out[`${c.id}:${key}`] = { skipped: "empresa suspensa" };
        continue;
      }
      const owners = modulesForRoutine(key);
      if (owners.length && !ALWAYS_RUN_ROUTINES.has(key)) {
        const level = bestLevel(owners.map((m) => decide(modules, m, c.kind ?? "retail").level));
        if (level !== "full" && level !== "drain") {
          out[`${c.id}:${key}`] = { skipped: "module_disabled" };
          continue;
        }
      }
      const marker = `routine.${key}.lastRun`;
      const last = await getSetting<string | null>(store, c.id, null, marker, null);
      if (last === day) continue;
      try {
        out[`${c.id}:${key}`] = await fn(store, c.id);
        await setSetting(store, c.id, null, marker, day);
      } catch (e: any) {
        out[`${c.id}:${key}`] = { error: e.message };
      }
    }
  }
  return out;
}
