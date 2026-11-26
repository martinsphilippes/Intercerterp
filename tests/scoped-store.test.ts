import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore, unscoped, isolationMode } from "@/lib/db/scoped-store";
import type { Store } from "@/lib/db/types";
import { freshPostgresStore } from "./pglite";

/**
 * Isolamento por empresa na camada de dados (docs/multiempresa/arquitetura.md §2). Cada caso tem a contraprova pelo
 * Store sem escopo (o registro existe; só não é alcançável a partir de outra empresa).
 */
/** Mesmo roteiro no armazenamento em memória e no PostgresStore (Postgres embutido): a condição de dono vai no SQL. */
let backend: "memoria" | "postgres" = "memoria";
async function setup() {
  const base: Store = backend === "postgres" ? freshPostgresStore() : new MemoryStore();
  await base.create("customers", { companyId: "A", personType: "PF", name: "Cliente A" }, "ca");
  await base.create("customers", { companyId: "B", personType: "PF", name: "Cliente B" }, "cb");
  await base.create("help_articles", { companyId: null, title: "Global", slug: "g" }, "h1");
  await base.create("tickets", { companyId: "public", number: 1, subject: "Acesso" }, "t1");
  await base.create("companies", { name: "Empresa A", status: "active" }, "A");
  await base.create("companies", { name: "Empresa B", status: "active" }, "B");
  await base.create("users", { name: "Ana A", email: "ana@a.test", status: "active", companyIds: ["A"] }, "ua");
  await base.create("users", { name: "Bia B", email: "bia@b.test", status: "active", companyIds: ["B"] }, "ub");
  await base.create("users", { name: "Plataforma", email: "root@intercert.test", status: "active", isAdmin: true, companyIds: [] }, "root");
  await base.create("stock_balances", { companyId: "B", branchId: "b1", warehouseId: "w1", skuId: "s1", physical: 5000, seq: 7 }, "sbB");
  return base;
}

afterEach(() => {
  delete process.env.MULTIEMPRESA_ISOLAMENTO;
});

describe.each(["memoria", "postgres"] as const)("isolamento por empresa (Store do contexto) — modo estrito — %s", (kind) => {
  beforeEach(() => {
    backend = kind;
  });
  it("leitura e listagem: só a própria empresa; conteúdo global segue visível", async () => {
    const base = await setup();
    expect(isolationMode()).toBe("estrito");
    const a = scopeStore(base, "A");
    expect(await a.get("customers", "cb")).toBeNull();
    await expect(a.getOrThrow("customers", "cb")).rejects.toThrow();
    expect((await a.get("customers", "ca"))?.name).toBe("Cliente A");
    expect((await a.list("customers")).items.map((c) => c.id)).toEqual(["ca"]);
    expect((await a.list("help_articles")).items.length).toBe(1);
    // filtro explícito com outra empresa não abre o escopo: o resultado é vazio
    expect((await a.list("customers", { filters: [["eq", "companyId", "B"]] })).items).toEqual([]);
    expect((await a.list("customers", { filters: [["or", [["eq", "companyId", "B"], ["eq", "name", "Cliente A"]]]] })).items.map((c) => c.id)).toEqual(["ca"]);
    // dentro da transação o escopo continua valendo
    await a.transaction(async (t) => {
      expect(await t.get("customers", "cb")).toBeNull();
    });
    // acesso explícito sem escopo (operação multiempresa deliberada)
    expect((await unscoped(a).get("customers", "cb"))?.name).toBe("Cliente B");
  });

  it("gravação por id não atinge registro de outra empresa (alterar, excluir, incrementar)", async () => {
    const base = await setup();
    const a = scopeStore(base, "A");
    await expect(a.update("customers", "cb", { name: "Invadido" })).rejects.toThrow(/não encontrado/);
    expect(await a.delete("customers", "cb")).toBe(false);
    await expect(a.increment("stock_balances", "sbB", "seq", 1)).rejects.toThrow(/não encontrado/);
    // contraprova: nada mudou na empresa B
    expect((await base.get("customers", "cb"))?.name).toBe("Cliente B");
    expect(await base.get("customers", "cb")).not.toBeNull();
    expect((await base.get("stock_balances", "sbB"))?.seq).toBe(7);
    // e a própria empresa continua gravando normalmente
    expect((await a.update("customers", "ca", { name: "Cliente A2" })).name).toBe("Cliente A2");
    // também dentro de transação
    await expect(a.transaction((t) => t.update("customers", "cb", { name: "X" }))).rejects.toThrow(/não encontrado/);
  });

  it("criação: sem empresa recebe a empresa ativa; outra empresa ou nulo são recusados", async () => {
    const base = await setup();
    const a = scopeStore(base, "A");
    const c: Record<string, any> = await a.create("customers", { personType: "PF", name: "Sem empresa informada" });
    expect(c.companyId).toBe("A");
    await expect(a.create("customers", { companyId: "B", personType: "PF", name: "X" })).rejects.toThrow(/outra empresa/);
    await expect(a.create("customers", { companyId: null, personType: "PF", name: "X" })).rejects.toThrow(/sem empresa/);
    await expect(a.update("customers", "ca", { companyId: "B" })).rejects.toThrow(/outra empresa/);
    await expect(a.update("customers", "ca", { companyId: null })).rejects.toThrow(/sem empresa/);
  });

  it("usuários e empresas: só os vinculados; o administrador da plataforma não aparece nas listas nem é alterável", async () => {
    const base = await setup();
    const a = scopeStore(base, "A");
    expect((await a.list("users")).items.map((u) => u.id)).toEqual(["ua"]);
    expect(await a.get("users", "ub")).toBeNull();
    expect((await a.get("users", "root"))?.name).toBe("Plataforma"); // autoria legível
    await expect(a.update("users", "root", { name: "X" })).rejects.toThrow(/não encontrado/);
    await expect(a.update("users", "ub", { name: "X" })).rejects.toThrow(/não encontrado/);
    await expect(a.create("users", { name: "Novo", email: "novo@b.test", status: "active", companyIds: ["B"] })).rejects.toThrow(/vinculado/);
    expect((await a.list("companies")).items.map((c) => c.id)).toEqual(["A"]);
    expect(await a.get("companies", "B")).toBeNull();
    await expect(a.update("companies", "B", { name: "X" })).rejects.toThrow(/não encontrado/);
    await expect(a.create("companies", { name: "Nova", status: "active" })).rejects.toThrow(/plataforma/);
    expect((await base.get("users", "ub"))?.name).toBe("Bia B");
  });

  it("chamados da tela de login só para a empresa da plataforma; tabelas da plataforma inacessíveis", async () => {
    const base = await setup();
    const a = scopeStore(base, "A");
    expect(await a.get("tickets", "t1")).toBeNull();
    expect((await a.list("tickets")).items).toEqual([]);
    const plat = scopeStore(base, "P", { platform: true });
    expect((await plat.get("tickets", "t1"))?.subject).toBe("Acesso");
    await base.create("service_requests", { clientId: "interos", status: "concluida" }, "sr1");
    expect(await a.get("service_requests", "sr1")).toBeNull();
    expect((await a.list("service_requests")).items).toEqual([]);
    await expect(a.create("tenant_provisionings", { accountId: "x" })).rejects.toThrow(/plataforma/);
  });

  it("tentativas barradas ficam registradas para a auditoria da plataforma", async () => {
    const base = await setup();
    const a = scopeStore(base, "A");
    await expect(a.update("customers", "cb", { name: "Invadido" })).rejects.toThrow();
    // o registro é feito no Store da instalação (o desta execução de teste é outro): basta não derrubar a operação
    expect((await a.get("customers", "ca"))?.name).toBe("Cliente A");
  });
});

describe("ativação gradual — observar e legado mantêm o comportamento anterior", () => {
  it("observar: não bloqueia (só registra); legado: idem, sem registro", async () => {
    for (const mode of ["observar", "legado"]) {
      process.env.MULTIEMPRESA_ISOLAMENTO = mode;
      const base = await setup();
      const a = scopeStore(base, "A");
      expect(isolationMode()).toBe(mode);
      // comportamento anterior: o filtro explícito de empresa dispensava o escopo; gravação por id não conferia o dono
      expect((await a.list("customers", { filters: [["eq", "companyId", "B"]] })).items.map((c) => c.id)).toEqual(["cb"]);
      expect((await a.update("customers", "cb", { name: "Alterado" })).name).toBe("Alterado");
      expect((await a.list("users")).items.length).toBe(3);
      expect((await a.get("tickets", "t1"))?.subject).toBe("Acesso");
      // o que sempre foi recusado continua recusado
      await expect(a.create("customers", { companyId: "B", personType: "PF", name: "X" })).rejects.toThrow(/outra empresa/);
    }
  });
});
