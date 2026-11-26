import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import type { Store } from "@/lib/db/types";
import { createCompanyWithDefaults } from "@/domain/setup";
import { isFeatureOn, setSetting } from "@/lib/core/settings";
import { scopeStore } from "@/lib/db/scoped-store";

/**
 * Módulos contratados governam os recursos de contrato num ponto central (`isFeatureOn`): o que o Interos não contratou
 * fica desligado mesmo que alguém ligue o parâmetro; empresa sem contrato registrado segue só o parâmetro.
 */
let store: Store;
let semLoja: string;
let comLoja: string;
let legado: string;

beforeAll(async () => {
  store = freshStore();
  semLoja = (await createCompanyWithDefaults(store, { name: "Sem Loja Ltda", key: "ctr-sem-loja" })).company.id;
  comLoja = (await createCompanyWithDefaults(store, { name: "Com Loja Ltda", key: "ctr-com-loja" })).company.id;
  legado = (await createCompanyWithDefaults(store, { name: "Legado Ltda", key: "ctr-legado" })).company.id;
  await store.update("companies", semLoja, { contract: { modules: ["pdv", "vendas"] } });
  await store.update("companies", comLoja, { contract: { modules: ["pdv", "vendas", "comercio_digital"] } });
  for (const c of [semLoja, comLoja, legado]) await setSetting(store, c, null, "feature.comercioDigital", true, "teste");
});

describe("recursos de contrato (isFeatureOn)", () => {
  it("sem o módulo contratado, o recurso fica desligado mesmo com o parâmetro ligado", async () => {
    expect(await isFeatureOn(scopeStore(store, semLoja), semLoja, null, "comercioDigital")).toBe(false);
    expect(await isFeatureOn(store, semLoja, null, "comercioDigital")).toBe(false);
  });
  it("com o módulo contratado, vale o parâmetro", async () => {
    expect(await isFeatureOn(scopeStore(store, comLoja), comLoja, null, "comercioDigital")).toBe(true);
    await setSetting(store, comLoja, null, "feature.comercioDigital", false, "teste");
    expect(await isFeatureOn(scopeStore(store, comLoja), comLoja, null, "comercioDigital")).toBe(false);
  });
  it("empresa sem contrato registrado (anterior ao multiempresa) segue só o parâmetro; recursos fora do catálogo de contrato não mudam", async () => {
    expect(await isFeatureOn(scopeStore(store, legado), legado, null, "comercioDigital")).toBe(true);
    await setSetting(store, semLoja, null, "feature.lotes", true, "teste");
    expect(await isFeatureOn(scopeStore(store, semLoja), semLoja, null, "lotes")).toBe(true);
  });
});
