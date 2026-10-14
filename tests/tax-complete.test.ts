import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { seedModules } from "@/domain/seed/modules";
import "@/domain/jobs-registry";
import type { Store } from "@/lib/db/types";
import { seedCompleteGroups, seedNormalGroups, snapshotAll, COMPLETE_SCENARIOS, type SnapEntry } from "./tax-reform-harness";

/**
 * Tributação completa (Fase 7 — FIS-12, FIS-16, FIS-11/07, FIS-13).
 * TESTE DE IGUALDADE: tests/fixtures/tributacao-baseline.json foi gravado com o código ANTERIOR à Fase 7 de tributação
 * (commit "retrato de igualdade da tributação completa"), reutilizando o harness da reforma com cenários extras
 * (interestadual 7%, consumidor final não contribuinte e natureza de operação) e grupos com os campos novos preenchidos.
 * Regravar (somente com mudança fiscal deliberada e aprovada): TRIBUTACAO_BASELINE_WRITE=1 npx vitest run tests/tax-complete.test.ts
 */

const BASELINE = path.join(__dirname, "fixtures", "tributacao-baseline.json");

let store: Store;
let refs: DemoRefs;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  await seedModules(refs);
  await seedNormalGroups(refs);
  await seedCompleteGroups(refs);
}, 240000);

const companyId = () => refs.company.id;

async function snapshotBothRegimes() {
  const opts = { scenarios: COMPLETE_SCENARIOS };
  const a = await snapshotAll(store, refs, "simples", opts);
  await store.update("companies", companyId(), { regime: "normal", crt: "3" });
  try {
    return { ...a, ...(await snapshotAll(store, refs, "normal", opts)) };
  } finally {
    await store.update("companies", companyId(), { regime: "simples", crt: "1" });
  }
}

const baseline = () => JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, SnapEntry>;

describe("tributação completa — teste de igualdade (retrato anterior à Fase 7)", () => {
  it("sem os recursos (padrão): payload, XML e totais de todas as combinações idênticos ao retrato", async () => {
    const now = await snapshotBothRegimes();
    if (process.env.TRIBUTACAO_BASELINE_WRITE === "1") writeFileSync(BASELINE, JSON.stringify(now));
    const base = baseline();
    expect(Object.keys(base).length).toBeGreaterThan(200);
    expect(Object.keys(now).sort()).toEqual(Object.keys(base).sort());
    for (const k of Object.keys(base)) expect(now[k], k).toEqual(base[k]);
  }, 180000);
});
