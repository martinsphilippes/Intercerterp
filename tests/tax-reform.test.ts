import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { seedModules } from "@/domain/seed/modules";
import type { Store } from "@/lib/db/types";
import { seedNormalGroups, snapshotAll, type SnapEntry } from "./tax-reform-harness";

const BASELINE = path.join(__dirname, "fixtures", "reforma-baseline.json");

let store: Store;
let refs: DemoRefs;
beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  await seedModules(refs);
  await seedNormalGroups(refs);
}, 240000);

async function snapshotBothRegimes() {
  const a = await snapshotAll(store, refs, "simples");
  await store.update("companies", refs.company.id, { regime: "normal", crt: "3" });
  try {
    return { ...a, ...(await snapshotAll(store, refs, "normal")) };
  } finally {
    await store.update("companies", refs.company.id, { regime: "simples", crt: "1" });
  }
}

describe("reforma tributária — teste de igualdade (retrato anterior à reforma)", () => {
  it("payload, XML de simulação e totais de todos os produtos do seed são idênticos ao retrato", async () => {
    const now = await snapshotBothRegimes();
    if (process.env.REFORMA_BASELINE_WRITE === "1") writeFileSync(BASELINE, JSON.stringify(now));
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, SnapEntry>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(base).sort());
    for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
  }, 120000);
});
