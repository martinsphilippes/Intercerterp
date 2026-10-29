import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { listAll } from "@/lib/db";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import { allNodes, effectivePrice, visibleNodeIds, networkViewer } from "@/domain/network";

describe("demonstração da rede de certificação", () => {
  it("monta Master → Regionais → Revendas → Contador com preços em cascata, vendedores e acesso rápido; repetível", async () => {
    const store = freshStore();
    await seedDemo(store, { historyDays: 1 });
    const nodes = await allNodes(store);
    const byName = (n: string) => nodes.find((x) => x.name.includes(n))!;
    expect(nodes.filter((n) => n.level === "master")).toHaveLength(1);
    expect(nodes.filter((n) => n.level === "regional")).toHaveLength(2);
    expect(nodes.filter((n) => n.level === "revenda")).toHaveLength(3);
    const contador = nodes.find((n) => n.level === "contador")!;
    expect(contador.parentNodeId).toBe(byName("Juazeiro").id);
    // e-CPF A1: AC 60 → Master 80 → Regional 95 → Revenda 110 → Contador 120 (mínimo 120, padrão 150)
    expect(await effectivePrice(store, byName("Nordeste").id, "ecpf_a1_12m")).toMatchObject({ cost: 8000, parentCost: 6000 });
    expect(await effectivePrice(store, byName("Ceará").id, "ecpf_a1_12m")).toMatchObject({ cost: 9500 });
    expect(await effectivePrice(store, byName("Juazeiro").id, "ecpf_a1_12m")).toMatchObject({ cost: 11000 });
    expect(await effectivePrice(store, contador.id, "ecpf_a1_12m")).toMatchObject({ cost: 12000, minPrice: 12000, defaultPrice: 15000, parentMargin: 1000 });
    expect(await effectivePrice(store, contador.id, "birdid_12m")).toMatchObject({ canEdit: false });
    // usuários de demonstração ativos por nível, inclusive vendedores
    const users = (await listAll(store, "users")).filter((u) => u.isDemo && u.status === "active" && u.authId);
    for (const login of ["rede", "master", "regional.ce", "regional.ba", "revenda.juazeiro", "revenda.fortaleza", "revenda.salvador", "vendedor.juazeiro", "vendedor.fortaleza", "vendedor.salvador"]) {
      expect(users.map((u) => u.login)).toContain(login);
    }
    // a regional do Ceará vê as revendas dela e o contador, não a Bahia
    const ce = users.find((u) => u.login === "regional.ce")!;
    const cid = ce.companyIds[0];
    const ctx = { store: scopeStore(store, cid), companyId: cid, branchId: null, user: await toCtxUser(store, ce, cid) };
    const vis = await visibleNodeIds(ctx);
    expect(vis.has(contador.id)).toBe(true);
    expect(vis.has(byName("Bahia").id)).toBe(false);
    expect(vis.has(byName("Salvador").id)).toBe(false);
    const rede = users.find((u) => u.login === "rede")!;
    const pctx = { store: scopeStore(store, rede.companyIds[0]), companyId: rede.companyIds[0], branchId: null, user: await toCtxUser(store, rede, rede.companyIds[0]) };
    expect((await networkViewer(pctx)).platform).toBe(true);
    // repetível
    await seedDemo(store, { historyDays: 1 });
    expect((await allNodes(store)).length).toBe(nodes.length);
  }, 120000);
});
