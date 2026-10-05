import { detId, isConflict } from "../db";
import type { Store } from "../db/types";

/** Próximo número sequencial atômico para a chave (ex.: "sale:<empresa>"). Pode haver lacunas em caso de falha. */
export async function nextNumber(store: Store, key: string): Promise<number> {
  const id = detId("counter", key);
  const existing = await store.get("counters", id);
  if (!existing) {
    try {
      await store.create("counters", { key, value: 0 }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  const doc = await store.increment("counters", id, "value", 1);
  return doc.value as number;
}

export async function peekNumber(store: Store, key: string): Promise<number> {
  const doc = await store.get("counters", detId("counter", key));
  return (doc?.value as number) ?? 0;
}
