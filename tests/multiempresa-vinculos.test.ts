import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { findOne, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import { getRelation, materializeRelations, relationsOf, upsertRelation } from "@/domain/tenancy/relations";
import { linkedCompanyReader } from "@/domain/accounting/link";
import { setNodeStatus } from "@/domain/network/nodes";
import type { Ctx } from "@/lib/core/ctx";

/**
 * Vínculos explícitos entre empresas (docs/multiempresa/arquitetura.md §5): o escritório só lê a empresa cliente com
 * vínculo ativo no registro; a rede registra o vínculo nó acima → parceiro e acompanha suspensão e encerramento.
 */
let store: Store;
let firm: Doc;
let loja: Doc;

async function ctxFor(login: string, company: Doc): Promise<Ctx> {
  const u = (await findOne(store, "users", [["eq", "login", login]]))!;
  return { store: scopeStore(store, company.id, { platform: Boolean(company.isPlatform) }), companyId: company.id, branchId: null, user: await toCtxUser(store, u, company.id) };
}

beforeAll(async () => {
  store = freshStore();
  await seedDemo(store, { historyDays: 1 });
  firm = (await findOne(store, "companies", [["eq", "cnpj", "33444555000170"]]))!;
  loja = (await findOne(store, "companies", [["eq", "cnpj", "11222333000181"]]))!;
}, 600_000);

describe("registro de vínculos entre empresas", () => {
  it("a demonstração registra o vínculo contábil (aceite da empresa) e a árvore da rede", async () => {
    const rel = await getRelation(store, firm.id, loja.id, "contabilidade");
    expect(rel).toMatchObject({ status: "ativa", type: "contabilidade" });
    expect(rel!.consent).toMatchObject({ side: "empresa" });
    const plat = (await findOne(store, "companies", [["eq", "isPlatform", true]]))!;
    const { outgoing } = await relationsOf(store, plat.id);
    expect(outgoing.some((r) => r.type === "rede" && r.status === "ativa")).toBe(true);
    // migração é idempotente: nada novo a criar numa base já sincronizada
    const report = await materializeRelations(store, { apply: true, actor: { id: "system", name: "Teste" } });
    expect(report.contabilidade.ativos).toBeGreaterThanOrEqual(1);
    expect(report.rede.ativos).toBeGreaterThanOrEqual(6);
    expect(report.criados).toBe(0);
  });

  it("o escritório só lê a empresa cliente enquanto o vínculo estiver ativo no registro", async () => {
    const client = (await findOne(store, "accounting_clients", [["eq", "companyId", firm.id], ["eq", "linkedCompanyId", loja.id]]))!;
    const contador = await ctxFor("contador", firm);
    const reader = await linkedCompanyReader(contador, client);
    expect((await reader.list("products", { limit: 1 })).items.length).toBe(1);
    await expect(reader.create("customers", { personType: "PF", name: "X" })).rejects.toThrow(/somente leitura/);
    await upsertRelation(store, { from: firm.id, to: loja.id, type: "contabilidade", status: "suspensa", source: "teste", actor: { id: "teste", name: "Teste" }, reason: "contrato do escritório suspenso" });
    await expect(linkedCompanyReader(contador, client)).rejects.toThrow(/vínculo ativo/);
    await upsertRelation(store, { from: firm.id, to: loja.id, type: "contabilidade", status: "ativa", source: "teste", actor: { id: "teste", name: "Teste" } });
    expect(await linkedCompanyReader(contador, client)).toBeTruthy();
  });

  it("suspender e encerrar um parceiro da rede acompanha no vínculo", async () => {
    const plat = (await findOne(store, "companies", [["eq", "isPlatform", true]]))!;
    const node = (await listAll(store, "cert_network_nodes")).find((n) => n.level === "revenda")!;
    const parent = (await store.get("cert_network_nodes", node.parentNodeId))!;
    const rede = await ctxFor("rede", plat);
    await setNodeStatus(rede, node.id, "suspended", "Teste de suspensão");
    expect((await getRelation(store, parent.nodeCompanyId, node.nodeCompanyId, "rede"))!.status).toBe("suspensa");
    await setNodeStatus(rede, node.id, "active", "Teste de reativação");
    const rel = (await getRelation(store, parent.nodeCompanyId, node.nodeCompanyId, "rede"))!;
    expect(rel.status).toBe("ativa");
    expect((rel.history as any[]).map((h) => h.status)).toEqual(expect.arrayContaining(["suspensa", "ativa"]));
  });
});
