import { describe, it, expect } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";

describe("isolamento por empresa (Store do contexto)", () => {
  it("get/list/create/update não atravessam empresas; registros globais e chamados públicos permanecem visíveis", async () => {
    const base = new MemoryStore();
    await base.create("customers", { companyId: "A", personType: "PF", name: "Cliente A" }, "ca");
    await base.create("customers", { companyId: "B", personType: "PF", name: "Cliente B" }, "cb");
    await base.create("help_articles", { companyId: null, title: "Global", slug: "g" }, "h1");
    await base.create("tickets", { companyId: "public", number: 1, subject: "Acesso" }, "t1");
    const a = scopeStore(base, "A");
    expect(await a.get("customers", "cb")).toBeNull();
    await expect(a.getOrThrow("customers", "cb")).rejects.toThrow();
    expect((await a.get("customers", "ca"))?.name).toBe("Cliente A");
    expect((await a.list("customers")).items.map((c) => c.id)).toEqual(["ca"]);
    expect((await a.list("help_articles")).items.length).toBe(1);
    expect((await a.get("tickets", "t1"))?.subject).toBe("Acesso");
    await expect(a.create("customers", { companyId: "B", personType: "PF", name: "X" })).rejects.toThrow(/outra empresa/);
    await expect(a.update("customers", "ca", { companyId: "B" })).rejects.toThrow(/outra empresa/);
    // dentro da transação o escopo continua valendo
    await a.transaction(async (t) => {
      expect(await t.get("customers", "cb")).toBeNull();
    });
    // acesso explícito sem escopo (operação multiempresa deliberada)
    expect((await unscoped(a).get("customers", "cb"))?.name).toBe("Cliente B");
  });
});
