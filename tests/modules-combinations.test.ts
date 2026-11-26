import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { createOrder } from "@/domain/purchases";
import { submitForApproval } from "@/domain/approvals";
import { takeBaseline } from "@/domain/modules/baseline";
import { applyChanges, simulateChanges } from "@/domain/modules/changes";
import { decide, loadCompanyModules } from "@/lib/modules/access";

/**
 * Combinações reais conferidas contra as regras do ERP (docs/modulos/README.md §Combinações), sobre a demonstração.
 */
let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
const who = { actor: "teste", actorType: "interos" as const, reason: "combinações" };

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  await takeBaseline(store, admin.companyId);
}, 120000);

describe("combinações de módulos", () => {
  it("compras sem cotações e sem aprovação: pedido direto segue aprovado automaticamente", async () => {
    // com aprovação habilitada: vai para análise
    const o1 = await createOrder(admin, { supplierId: refs.suppliers.textil.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 990 }], paymentTermId: refs.terms.avista.id });
    expect((await submitForApproval(admin, [o1.id])).status).toBe("in_review");
    await applyChanges(store, { companyId: admin.companyId, changes: [{ module: "compras.cotacoes", action: "disable" }, { module: "compras.aprovacoes", action: "disable" }], mode: "enforced", reviewDivergences: true }, who);
    const doc = await loadCompanyModules(store, admin.companyId);
    expect(doc!.modules["compras.aprovacoes"].state).toBe("draining"); // solicitação em análise precisa ser decidida
    const o2 = await createOrder(admin, { supplierId: refs.suppliers.textil.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 990 }], paymentTermId: refs.terms.avista.id });
    const req = await submitForApproval(admin, [o2.id]);
    expect(req.status).toBe("approved");
    expect(req.policySnapshot.name).toMatch(/Sem etapa de aprovação/);
    expect(decide(doc, "compras.pedidos").level).toBe("full");
    expect(decide(doc, "compras.recebimento").level).toBe("full");
  });

  it("loja virtual sem PDV é aceita; desligar NF-e com a loja ligada é recusado (expedição exige nota autorizada)", async () => {
    const sim = await simulateChanges(store, { companyId: admin.companyId, changes: [{ module: "vendas.pdv", action: "disable" }], cascade: true });
    expect(sim.impacts.map((i) => i.module)).not.toContain("ecommerce.loja");
    const nfe = await simulateChanges(store, { companyId: admin.companyId, changes: [{ module: "fiscal.nfe", action: "disable" }] });
    expect(nfe.errors.find((e) => e.code === "dependents_enabled")?.module).toBe("ecommerce.loja");
  });

  it("fiscal sem SPED mantém Sintegra, NF-e, NFC-e e o pacote contábil", async () => {
    const sim = await simulateChanges(store, { companyId: admin.companyId, changes: [{ module: "fiscal.sped", action: "disable" }] });
    expect(sim.valid).toBe(true);
    expect(sim.impacts).toHaveLength(1);
  });

  it("financeiro sem conciliação: receber, pagar e fluxo seguem; integrações afetadas são apontadas", async () => {
    const sim = await simulateChanges(store, { companyId: admin.companyId, changes: [{ module: "financeiro.conciliacao", action: "disable" }] });
    expect(sim.valid).toBe(true);
    expect(sim.impacts[0].to).toBe("disabled");
  });

  it("estoque sem lotes (demonstração sem produto com lote): desliga na hora", async () => {
    const sim = await simulateChanges(store, { companyId: admin.companyId, changes: [{ module: "estoque.lotes", action: "disable" }] });
    expect(sim.impacts[0].to).toBe("disabled");
  });

  it("produtos sem edição em massa: precificação após a entrada continua", async () => {
    const sim = await simulateChanges(store, { companyId: admin.companyId, changes: [{ module: "produtos.alteracao_massa", action: "disable" }] });
    expect(sim.valid).toBe(true);
    expect(sim.impacts.map((i) => i.module)).toEqual(["produtos.alteracao_massa"]);
  });
});
