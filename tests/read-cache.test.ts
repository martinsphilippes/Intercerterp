import { describe, it, expect, vi } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { ReadCachedStore } from "@/lib/db/read-cache";

function counted() {
  const inner = new MemoryStore();
  const spy = { get: vi.spyOn(inner, "get"), list: vi.spyOn(inner, "list") };
  return { inner, store: new ReadCachedStore(inner), spy };
}

describe("camada de leitura em memória", () => {
  it("cadastros quase fixos: segunda leitura não vai ao banco; gravação invalida na hora", async () => {
    const { store, spy } = counted();
    const c = await store.create("companies", { name: "A", status: "active" });
    await store.list("companies");
    await store.list("companies");
    expect(spy.list).toHaveBeenCalledTimes(1);
    await store.update("companies", c.id, { name: "B" });
    const after = await store.list("companies");
    expect(spy.list).toHaveBeenCalledTimes(2);
    expect(after.items[0].name).toBe("B");
  });

  it("tabelas operacionais não ficam em memória fora da renderização", async () => {
    const { store, spy } = counted();
    await store.create("customers", { companyId: "c1", name: "Ana", personType: "PF" });
    await store.list("customers");
    await store.list("customers");
    expect(spy.list).toHaveBeenCalledTimes(2);
  });

  it("entrega cópias: alterar o resultado não afeta a próxima leitura", async () => {
    const { store } = counted();
    const c = await store.create("companies", { name: "Original", status: "active" });
    const first = await store.get("companies", c.id);
    first!.name = "alterado pelo chamador";
    const again = await store.get("companies", c.id);
    expect(again!.name).toBe("Original");
  });

  it("exclusão e transação limpam a memória", async () => {
    const { store } = counted();
    const c = await store.create("companies", { name: "X", status: "active" });
    expect(await store.get("companies", c.id)).not.toBeNull();
    await store.delete("companies", c.id);
    expect(await store.get("companies", c.id)).toBeNull();
    const d = await store.create("branches", { companyId: "c1", name: "F1", status: "active" });
    await store.list("branches");
    await store.transaction(async (tx) => tx.update("branches", d.id, { name: "F2" }));
    expect((await store.list("branches")).items[0].name).toBe("F2");
  });

  it("getOrThrow mantém o erro de registro inexistente", async () => {
    const { store } = counted();
    await expect(store.getOrThrow("companies", "nao-existe")).rejects.toThrow();
  });
});
