import type { Store } from "@/lib/db/types";
import { seedBase } from "./base";
import { seedHistory, seedToday } from "./history";
import "../jobs-registry";

export async function seedDemo(store: Store, opts: { historyDays?: number; withHistory?: boolean } = {}) {
  const refs = await seedBase(store);
  const extras: Record<string, unknown> = {};
  if (opts.withHistory !== false) {
    extras.history = await seedHistory(refs, opts.historyDays ?? 45);
    extras.today = await seedToday(refs);
  }
  const modules = await import("./modules");
  extras.modules = await modules.seedModules(refs);
  return { companyId: refs.company.id, ...extras };
}
