import type { Store } from "@/lib/db/types";
import { seedBase } from "./base";
import { seedHistory, seedToday } from "./history";
import "../jobs-registry";

export async function seedDemo(store: Store, opts: { historyDays?: number; withHistory?: boolean; deadline?: number } = {}) {
  const refs = await seedBase(store);
  const extras: Record<string, unknown> = {};
  if (opts.withHistory !== false) {
    const history = await seedHistory(refs, opts.historyDays ?? 45, opts.deadline);
    extras.history = history;
    // prazo esgotado: devolve "incompleto" para a próxima chamada continuar de onde parou
    if ("partial" in history) return { companyId: refs.company.id, done: false, ...extras };
    extras.today = await seedToday(refs);
  }
  const modules = await import("./modules");
  extras.modules = await modules.seedModules(refs);
  return { companyId: refs.company.id, done: true, ...extras };
}
