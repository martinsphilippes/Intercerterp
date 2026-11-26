import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import { createCompanyWithDefaults } from "@/domain/setup";
import { HELP_ARTICLES, ensureHelpArticles } from "@/domain/help-content";

/**
 * Artigos de ajuda são conteúdo global (sem empresa). A tela de Ajuda sincroniza os artigos ao abrir, com o Store da
 * sessão (restrito à empresa): a sincronização precisa gravar pelo Store base — senão, quando um artigo muda de texto,
 * a atualização é recusada pelo isolamento e a tela quebra (erro visto na produção em 26/11/2026).
 */
let store: Store;
let companyId: string;

beforeAll(async () => {
  store = freshStore();
  companyId = (await createCompanyWithDefaults(store, { name: "Ajuda Ltda", key: "help-ajuda" })).company.id;
});

describe("sincronização dos artigos de ajuda a partir de uma tela (Store restrito à empresa)", () => {
  it("cria os artigos globais sem empresa", async () => {
    const r = await ensureHelpArticles(scopeStore(store, companyId));
    expect(r.created).toBe(HELP_ARTICLES.length);
    const rows = await listAll(store, "help_articles");
    expect(rows.every((a) => a.companyId == null)).toBe(true);
  });

  it("atualiza artigo global cujo texto mudou, sem erro e sem tomar posse dele", async () => {
    const first = (await listAll(store, "help_articles"))[0];
    await store.update("help_articles", first.id, { body: "texto antigo" });
    const r = await ensureHelpArticles(scopeStore(store, companyId));
    expect(r.updated).toBe(1);
    const after = (await store.get("help_articles", first.id))!;
    expect(after.body).not.toBe("texto antigo");
    expect(after.companyId ?? null).toBeNull();
  });

  it("artigo próprio de uma empresa não é tocado pela sincronização global", async () => {
    const own = await store.create("help_articles", { companyId, slug: HELP_ARTICLES[0].slug + "-empresa", title: "Artigo da empresa", body: "Conteúdo interno", area: HELP_ARTICLES[0].area, published: true });
    await ensureHelpArticles(scopeStore(store, companyId));
    expect((await store.get("help_articles", own.id))!.body).toBe("Conteúdo interno");
  });
});
