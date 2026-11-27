import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/bootstrap", () => ({ ensureBootstrap: async () => undefined }));
import crypto from "node:crypto";
import { freshStore } from "./helpers";
import type { MemoryStore } from "@/lib/db/memory-store";
import type { Doc } from "@/lib/db/types";
import { detId, listAll } from "@/lib/db";
import { systemCtx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import { setSetting } from "@/lib/core/settings";
import { decide, loadCompanyModules, accessMap, legacyModulesFor } from "@/lib/modules/access";
import { takeBaseline, computeBaseline, provisionModules, baselineAllCompanies, validateSelection } from "@/domain/modules/baseline";
import { applyChanges, simulateChanges, finalizePendingDeactivations, companyModulesStatus, moduleHistory, VersionConflictError, ChangeRejectedError } from "@/domain/modules/changes";
import { submitApply, IdempotencyMismatchError, runModulesMaintenance } from "@/domain/modules/operations";
import { assertActionModule, ModuleUnavailableError } from "@/lib/server/modules";
import { runScheduled } from "@/domain/scheduler";
import "@/domain/routines";
import { authenticateInteros } from "@/lib/integrations/interos-auth";

/**
 * Habilitação de módulos por empresa contratante (docs/modulos): linha de base sem perda de acesso, regra de acesso,
 * dependências, desligamento com conclusão/agendamento, reativação, versão, idempotência, isolamento entre empresas
 * (duas empresas fictícias) e a API do Interos.
 */

let store: MemoryStore;
let A: Doc;
let B: Doc;
const who = { actor: "teste@interos", actorType: "interos" as const, reason: "Teste automatizado" };

async function twoCompanies() {
  A = (await createCompanyWithDefaults(store, { name: "Alfa Comércio Ficticio Ltda", cnpj: "11111111000191", key: "alfa" })).company;
  B = (await createCompanyWithDefaults(store, { name: "Beta Varejo Ficticio Ltda", cnpj: "22222222000191", key: "beta" })).company;
  await store.create("products", { companyId: A.id, type: "product", name: "Produto A", status: "active", lotControl: false });
  await store.create("products", { companyId: B.id, type: "product", name: "Produto B", status: "active", lotControl: false });
}

beforeEach(async () => {
  store = freshStore();
  await twoCompanies();
});

describe("linha de base (migração aditiva)", () => {
  it("sem estado = modo legacy: tudo como antes", async () => {
    expect(await loadCompanyModules(store, A.id)).toBeNull();
    const d = decide(null, "compras.cotacoes", "retail");
    expect(d).toMatchObject({ level: "full", mode: "legacy" });
  });

  it("habilita tudo o que o tipo já tinha, grava em legacy, é idempotente e não toca outra empresa", async () => {
    const r = await takeBaseline(store, A.id);
    expect(r.created).toBe(true);
    const doc = (await loadCompanyModules(store, A.id))!;
    expect(doc.mode).toBe("legacy");
    expect(doc.version).toBe(1);
    expect(Object.keys(doc.modules).sort()).toEqual(expect.arrayContaining(legacyModulesFor("retail")));
    expect((await takeBaseline(store, A.id)).created).toBe(false);
    expect(await loadCompanyModules(store, B.id)).toBeNull();
    // em modo legacy, nenhuma superfície muda
    for (const d of Object.values(accessMap(doc, "retail"))) expect(d.level).toBe("full");
  });

  it("registra uso, recursos e permissões; uso fora do tipo vira divergência e continua habilitado", async () => {
    const firm = (await createCompanyWithDefaults(store, { name: "Escritório Fictício", key: "firm", kind: "accounting" })).company;
    await store.create("sales", { companyId: firm.id, number: 1, status: "completed" });
    const rep = await computeBaseline(store, firm.id);
    expect(rep.usage["vendas.pdv"]).toBe(1);
    expect(rep.modules).toContain("vendas.pdv");
    expect(rep.divergences.some((d) => d.module === "vendas.pdv" && d.code === "usage_outside_kind")).toBe(true);
    // dependências do módulo mantido também entram (conjunto consistente)
    expect(rep.modules).toEqual(expect.arrayContaining(["caixa.operacao", "cadastros.produtos"]));
    expect(rep.permissions["vendas.pdv"]).toBeDefined();
    await takeBaseline(store, firm.id);
    const base = await store.get("module_baselines", detId("modbase", firm.id));
    expect(base!.status).toBe("pending_review");
  });

  it("migração em lote cobre todas as empresas e é repetível", async () => {
    const r1 = await baselineAllCompanies(store);
    expect(r1.filter((x) => x.created).length).toBe(2);
    const r2 = await baselineAllCompanies(store);
    expect(r2.every((x) => !x.created)).toBe(true);
  });
});

describe("regra de acesso e alterações", () => {
  beforeEach(async () => {
    await takeBaseline(store, A.id);
    await takeBaseline(store, B.id);
  });

  it("alterar módulos de A não afeta B (duas empresas fictícias): estado, versão, dados e permissões de B intactos", async () => {
    const bRolesBefore = await listAll(store, "roles", { filters: [["eq", "companyId", B.id]] });
    const bDocBefore = await loadCompanyModules(store, B.id);
    const r = await applyChanges(store, { companyId: A.id, changes: [{ module: "compras.cotacoes", action: "disable" }], mode: "enforced" }, { ...who, expectedVersion: 1 });
    expect(r.version).toBe(2);
    const a = (await loadCompanyModules(store, A.id))!;
    expect(decide(a, "compras.cotacoes").level).toBe("read");
    expect(decide(a, "compras.pedidos").level).toBe("full");
    const b = (await loadCompanyModules(store, B.id))!;
    expect(b).toEqual(bDocBefore);
    expect(decide(b, "compras.cotacoes").level).toBe("full");
    expect(await listAll(store, "roles", { filters: [["eq", "companyId", B.id]] })).toEqual(bRolesBefore);
    expect((await listAll(store, "products", { filters: [["eq", "companyId", B.id]] })).length).toBe(1);
    // e a recíproca: mudar B não mexe em A
    await applyChanges(store, { companyId: B.id, changes: [{ module: "fiscal.sped", action: "disable" }], mode: "enforced" }, who);
    expect((await loadCompanyModules(store, A.id))!.version).toBe(2);
    expect(decide(await loadCompanyModules(store, A.id), "fiscal.sped").level).toBe("full");
  });

  it("modo shadow avalia sem bloquear; enforced bloqueia", async () => {
    await applyChanges(store, { companyId: A.id, changes: [{ module: "financeiro.conciliacao", action: "disable", history: "none" }], mode: "shadow" }, who);
    const doc = await loadCompanyModules(store, A.id);
    expect(decide(doc, "financeiro.conciliacao")).toMatchObject({ level: "full", enforcedLevel: "none", mode: "shadow" });
    await applyChanges(store, { companyId: A.id, changes: [], mode: "enforced" }, who);
    expect(decide(await loadCompanyModules(store, A.id), "financeiro.conciliacao").level).toBe("none");
  });

  it("server action: módulo desligado recusa; a ação de histórico (desfazer conciliação) continua; outra empresa não é afetada", async () => {
    await applyChanges(store, { companyId: A.id, changes: [{ module: "financeiro.conciliacao", action: "disable" }], mode: "enforced" }, who);
    const ctxA = systemCtx(store, A.id);
    await expect(assertActionModule(ctxA, A, "financeiro.conciliacao", "reconcileAction")).rejects.toBeInstanceOf(ModuleUnavailableError);
    await expect(assertActionModule(ctxA, A, "financeiro.conciliacao", "undoReconciliationAction")).resolves.toBeUndefined();
    // basta um dos donos habilitado (receber OU pagar)
    await expect(assertActionModule(ctxA, A, ["financeiro.contas_receber", "financeiro.contas_pagar"], "settleAction")).resolves.toBeUndefined();
    await expect(assertActionModule(systemCtx(store, B.id), B, "financeiro.conciliacao", "reconcileAction")).resolves.toBeUndefined();
    const denied = await listAll(store, "audit_logs", { filters: [["eq", "companyId", A.id], ["eq", "action", "module.denied"]] });
    expect(denied.length).toBe(1);
  });

  it("função opcional nunca vale mais que o pai", async () => {
    await applyChanges(store, { companyId: A.id, changes: [{ module: "cadastros.produtos", action: "disable" }], mode: "enforced", cascade: true }, who);
    const doc = await loadCompanyModules(store, A.id);
    expect(decide(doc, "produtos.alteracao_massa").level).toBe("none"); // pai desligado; a própria entrada ficou oculta (afterOff hidden)
    expect(decide(doc, "produtos.promocoes").level).toBe("read");
  });

  it("dependências: desligar com dependente ligado é recusado; a cascata desliga junto; habilitar exige as obrigatórias", async () => {
    const sim = await simulateChanges(store, { companyId: A.id, changes: [{ module: "compras.pedidos", action: "disable" }] });
    expect(sim.valid).toBe(false);
    expect(sim.errors.map((e) => e.code)).toContain("dependents_enabled");
    const cas = await simulateChanges(store, { companyId: A.id, changes: [{ module: "compras.pedidos", action: "disable" }], cascade: true });
    expect(cas.valid).toBe(true);
    expect(cas.impacts.map((i) => i.module)).toEqual(expect.arrayContaining(["compras.pedidos", "compras.cotacoes", "compras.aprovacoes"]));
    expect(cas.impacts.find((i) => i.module === "compras.reposicao")).toBeUndefined();
    expect(cas.impacts.find((i) => i.module === "compras.pedidos")!.integrationsAffected.map((x) => x.module)).toEqual(expect.arrayContaining(["compras.reposicao", "compras.recebimento"]));
    await applyChanges(store, { companyId: A.id, changes: [{ module: "compras.pedidos", action: "disable" }], cascade: true }, who);
    const en = await simulateChanges(store, { companyId: A.id, changes: [{ module: "compras.cotacoes", action: "enable" }] });
    expect(en.errors.map((e) => e.code)).toContain("dependency_missing");
    const both = await simulateChanges(store, { companyId: A.id, changes: [{ module: "compras.cotacoes", action: "enable" }, { module: "compras.pedidos", action: "enable" }] });
    expect(both.valid).toBe(true);
  });

  it("recusa plataforma, componente técnico, lacuna, tipo errado e módulo inexistente", async () => {
    const sim = await simulateChanges(store, { companyId: A.id, changes: [{ module: "plataforma.acesso", action: "disable" }, { module: "tec.fiscal", action: "disable" }, { module: "fiscal.mdfe", action: "enable" }, { module: "contabil.carteira", action: "enable" }, { module: "nao.existe", action: "enable" }] });
    expect(sim.errors.map((e) => e.code).sort()).toEqual(["kind_not_supported", "module_planned", "not_contractable", "not_contractable", "unknown_module"]);
  });

  it("caixa aberto: desligamento entra em conclusão (fecha o caixa, não abre outro) e termina sozinho", async () => {
    const session = await store.create("cash_sessions", { companyId: A.id, branchId: null, status: "open", terminalId: "t1", operatorId: "u1" });
    const r = await applyChanges(store, { companyId: A.id, changes: [{ module: "caixa.operacao", action: "disable" }], cascade: true, mode: "enforced" }, who);
    const imp = r.simulation.impacts.find((i) => i.module === "caixa.operacao")!;
    expect(imp.to).toBe("draining");
    expect(imp.blockers[0]).toMatchObject({ key: "cash.open_sessions", count: 1 });
    expect(r.simulation.impacts.map((i) => i.module)).toEqual(expect.arrayContaining(["vendas.pdv", "vendas.devolucoes"]));
    const ctxA = systemCtx(store, A.id);
    await expect(assertActionModule(ctxA, A, "caixa.operacao", "openSessionAction")).rejects.toBeInstanceOf(ModuleUnavailableError);
    await expect(assertActionModule(ctxA, A, "caixa.operacao", "closeSessionAction")).resolves.toBeUndefined();
    expect((await finalizePendingDeactivations(store, A.id)).finalized).toEqual([]);
    await store.update("cash_sessions", session.id, { status: "closed" });
    expect((await finalizePendingDeactivations(store, A.id)).finalized).toContain("caixa.operacao");
    const doc = await loadCompanyModules(store, A.id);
    expect(doc!.modules["caixa.operacao"].state).toBe("disabled");
    expect(decide(doc, "caixa.operacao").level).toBe("read");
  });

  it("devoluções de vendas anteriores continuam durante a conclusão do PDV", async () => {
    await store.create("carts", { companyId: A.id, status: "parked" });
    await applyChanges(store, { companyId: A.id, changes: [{ module: "vendas.pdv", action: "disable" }], cascade: true, mode: "enforced" }, who);
    const doc = await loadCompanyModules(store, A.id);
    expect(doc!.modules["vendas.pdv"].state).toBe("draining");
    const ctxA = systemCtx(store, A.id);
    await expect(assertActionModule(ctxA, A, "vendas.pdv", "finalizeCartAction")).rejects.toBeInstanceOf(ModuleUnavailableError);
    await expect(assertActionModule(ctxA, A, "vendas.pdv", "cancelCartAction")).resolves.toBeUndefined();
  });

  it("correção 5: desligar o PDV com vendas no prazo do CDC deixa as devoluções em conclusão por 90 dias (pendência declarada)", async () => {
    const recent = await store.create("sales", { companyId: A.id, branchId: null, status: "completed", total: 9990, completedAt: new Date(Date.now() - 10 * 86400000).toISOString() });
    await store.create("sales", { companyId: A.id, branchId: null, status: "completed", total: 1500, completedAt: new Date(Date.now() - 120 * 86400000).toISOString() });
    const r = await applyChanges(store, { companyId: A.id, changes: [{ module: "vendas.pdv", action: "disable" }], cascade: true, mode: "enforced" }, who);
    const ret = r.simulation.impacts.find((i) => i.module === "vendas.devolucoes")!;
    // a cascata com o PDV respeita a política das devoluções: pendência e obrigação declaradas na simulação/aplicação
    expect(ret).toMatchObject({ cascadedFrom: "vendas.pdv", to: "draining", policy: "drain" });
    expect(ret.blockers).toEqual([expect.objectContaining({ key: "sales.cdc_return_window", count: 1 })]); // só a venda no prazo
    expect(ret.obligations.join(" ")).toMatch(/90 dias/);
    const doc = (await loadCompanyModules(store, A.id))!;
    expect(doc.modules["vendas.devolucoes"].state).toBe("draining");
    expect(Date.parse(doc.modules["vendas.devolucoes"].drainUntil!)).toBeGreaterThan(Date.now() + 89 * 86400000);
    // a devolução de uma venda anterior continua aceita; venda nova no PDV, não
    const ctxA = systemCtx(store, A.id);
    await expect(assertActionModule(ctxA, A, "vendas.devolucoes", "processReturnAction")).resolves.toBeUndefined();
    await expect(assertActionModule(ctxA, A, "vendas.pdv", "finalizeCartAction")).rejects.toBeInstanceOf(ModuleUnavailableError);
    // enquanto houver venda no prazo, não desliga; quando a última sai do prazo, termina sozinho
    expect((await finalizePendingDeactivations(store, A.id)).finalized).not.toContain("vendas.devolucoes");
    await store.update("sales", recent.id, { completedAt: new Date(Date.now() - 91 * 86400000).toISOString() });
    expect((await finalizePendingDeactivations(store, A.id)).finalized).toContain("vendas.devolucoes");
    expect((await loadCompanyModules(store, A.id))!.modules["vendas.devolucoes"].state).toBe("disabled");
  });

  it("lotes: com produto controlado por lote o desligamento fica agendado e o módulo segue operando", async () => {
    await store.create("products", { companyId: A.id, type: "product", name: "Remédio", lotControl: true });
    const r = await applyChanges(store, { companyId: A.id, changes: [{ module: "estoque.lotes", action: "disable" }], mode: "enforced" }, who);
    expect(r.simulation.impacts[0].to).toBe("scheduled_off");
    expect(decide(await loadCompanyModules(store, A.id), "estoque.lotes").level).toBe("full");
  });

  it("reativar reaproveita a configuração preservada", async () => {
    await applyChanges(store, { companyId: A.id, changes: [{ module: "ecommerce.promocoes", action: "enable", config: { limite: 10 } }] }, who);
    await applyChanges(store, { companyId: A.id, changes: [{ module: "ecommerce.promocoes", action: "disable" }] }, who);
    expect((await loadCompanyModules(store, A.id))!.modules["ecommerce.promocoes"]).toMatchObject({ state: "disabled", config: { limite: 10 } });
    await applyChanges(store, { companyId: A.id, changes: [{ module: "ecommerce.promocoes", action: "enable" }] }, who);
    expect((await loadCompanyModules(store, A.id))!.modules["ecommerce.promocoes"]).toMatchObject({ state: "enabled", config: { limite: 10 } });
  });

  it("controle de versão: versão esperada errada é recusada; o histórico registra ator, motivo e versão", async () => {
    await expect(applyChanges(store, { companyId: A.id, changes: [{ module: "fiscal.sped", action: "disable" }] }, { ...who, expectedVersion: 7 })).rejects.toBeInstanceOf(VersionConflictError);
    await applyChanges(store, { companyId: A.id, changes: [{ module: "fiscal.sped", action: "disable" }] }, { ...who, expectedVersion: 1 });
    await expect(applyChanges(store, { companyId: A.id, changes: [{ module: "fiscal.sintegra", action: "disable" }] }, { ...who, expectedVersion: 1 })).rejects.toBeInstanceOf(VersionConflictError);
    const h = await moduleHistory(store, A.id);
    expect(h[0]).toMatchObject({ version: 2, actor: "teste@interos", actorType: "interos", reason: "Teste automatizado" });
    expect(h[1].version).toBe(1);
    expect(await moduleHistory(store, B.id)).toHaveLength(1);
  });

  it("edição concorrente na mesma versão: uma vence, a outra recebe conflito", async () => {
    const results = await Promise.allSettled([
      applyChanges(store, { companyId: A.id, changes: [{ module: "fiscal.sped", action: "disable" }] }, { ...who, expectedVersion: 1 }),
      applyChanges(store, { companyId: A.id, changes: [{ module: "fiscal.sintegra", action: "disable" }] }, { ...who, expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);
    expect((await loadCompanyModules(store, A.id))!.version).toBe(2);
  });

  it("lote inválido não grava nada", async () => {
    await expect(applyChanges(store, { companyId: A.id, changes: [{ module: "fiscal.sped", action: "disable" }, { module: "compras.pedidos", action: "disable" }] }, who)).rejects.toBeInstanceOf(ChangeRejectedError);
    expect((await loadCompanyModules(store, A.id))!.version).toBe(1);
  });

  it("aplicar o controle exige revisar as divergências da linha de base", async () => {
    await store.update("module_baselines", detId("modbase", A.id), { divergences: [{ module: "x", code: "dependency_gap", message: "m" }], status: "pending_review" });
    const sim = await simulateChanges(store, { companyId: A.id, changes: [], mode: "enforced" });
    expect(sim.errors.map((e) => e.code)).toContain("divergences_open");
    await applyChanges(store, { companyId: A.id, changes: [], mode: "enforced", reviewDivergences: true }, who);
    expect((await store.get("module_baselines", detId("modbase", A.id)))!.status).toBe("reviewed");
  });

  it("rotinas de módulo desligado não rodam; as que encerram obrigações rodam", async () => {
    await applyChanges(store, { companyId: A.id, changes: [{ module: "estoque.transferencias", action: "disable" }, { module: "vendas.documentos", action: "disable" }], mode: "enforced" }, who);
    const out = await runScheduled(store);
    expect(out[`${A.id}:stock.transfers_overdue`]).toEqual({ skipped: "module_disabled" });
    expect(out[`${A.id}:sales.documents_expire`]).not.toEqual({ skipped: "module_disabled" });
    expect(out[`${B.id}:stock.transfers_overdue`]).not.toEqual({ skipped: "module_disabled" });
  });

  it("situação da empresa: modo, versão, acesso e configuração pendente", async () => {
    const st = await companyModulesStatus(store, A.id);
    expect(st).toMatchObject({ companyId: A.id, mode: "legacy", version: 1 });
    const pdv = st.modules.find((m) => m.module === "vendas.pdv")!;
    expect(pdv.state).toBe("enabled");
    expect(pdv.configuration.ready).toBe(false); // sem terminal cadastrado
  });
});

describe("provisionamento de empresa nova", () => {
  it("só os módulos selecionados, controle aplicado; dependência ausente é recusada antes de criar", async () => {
    const C = (await createCompanyWithDefaults(store, { name: "Gama Loja Virtual Ficticia", key: "gama" })).company;
    await provisionModules(store, C.id, ["ecommerce.loja", "cadastros.produtos", "fiscal.nfe"], "teste");
    const doc = await loadCompanyModules(store, C.id);
    expect(doc!.mode).toBe("enforced");
    expect(decide(doc, "ecommerce.loja").level).toBe("full");
    expect(decide(doc, "vendas.pdv").level).toBe("none");
    expect(decide(doc, "tec.fiscal").level).toBe("full"); // componente ativo pela loja
    expect(decide(doc, "tec.pagamentos").level).toBe("none");
    expect(() => validateSelection("retail", ["ecommerce.loja", "cadastros.produtos"])).toThrow(/NF-e/);
  });
});

describe("operações do Interos: idempotência e agendamento", () => {
  beforeEach(async () => {
    await takeBaseline(store, A.id);
  });
  const req = { changes: [{ module: "fiscal.sped", action: "disable" as const }], reason: "Contrato sem SPED", expectedVersion: 1 };

  it("mesma chave e mesmo corpo devolve a mesma operação; corpo diferente é recusado", async () => {
    const r1 = await submitApply(store, { clientId: "interos", idempotencyKey: "op-0001-abcdef", companyId: A.id, actor: "ana@interos", request: req });
    expect(r1.op.status).toBe("applied");
    expect(r1.replayed).toBe(false);
    const r2 = await submitApply(store, { clientId: "interos", idempotencyKey: "op-0001-abcdef", companyId: A.id, actor: "ana@interos", request: req });
    expect(r2.replayed).toBe(true);
    expect(r2.op.id).toBe(r1.op.id);
    expect((await loadCompanyModules(store, A.id))!.version).toBe(2);
    await expect(submitApply(store, { clientId: "interos", idempotencyKey: "op-0001-abcdef", companyId: A.id, actor: "ana@interos", request: { ...req, reason: "outro" } })).rejects.toBeInstanceOf(IdempotencyMismatchError);
  });

  it("lote recusado fica registrado como rejected com o erro", async () => {
    const r = await submitApply(store, { clientId: "interos", idempotencyKey: "op-0002-abcdef", companyId: A.id, actor: "ana", request: { changes: [{ module: "compras.pedidos", action: "disable" }], reason: "x" } });
    expect(r.op.status).toBe("rejected");
    expect(r.op.error.code).toBe("changes_rejected");
  });

  it("agendada executa na manutenção depois da data", async () => {
    const r = await submitApply(store, { clientId: "interos", idempotencyKey: "op-0003-abcdef", companyId: A.id, actor: "ana", request: { ...req, expectedVersion: null, effectiveAt: new Date(Date.now() + 3600_000).toISOString() } });
    expect(r.op.status).toBe("scheduled");
    await runModulesMaintenance(store, A.id);
    expect((await store.get("module_operations", r.op.id))!.status).toBe("scheduled");
    await store.update("module_operations", r.op.id, { scheduledFor: new Date(Date.now() - 1000).toISOString() });
    await runModulesMaintenance(store, A.id);
    expect((await store.get("module_operations", r.op.id))!.status).toBe("applied");
  });
});

describe("API /api/interos/v1 (servidor a servidor)", () => {
  // registro único de credenciais (INTEROS_CREDENCIAIS): token `<id>.<segredo>`, o ERP guarda só o hash do segredo
  const secret = crypto.randomBytes(32).toString("base64url");
  const readSecret = crypto.randomBytes(32).toString("base64url");
  const pilotSecret = crypto.randomBytes(32).toString("base64url");
  const token = `interos-test.${secret}`;
  const readToken = `interos-ro.${readSecret}`;
  const pilotToken = `interos-piloto.${pilotSecret}`;
  const h = (t: string) => `sha256:${crypto.createHash("sha256").update(t).digest("hex")}`;
  beforeEach(async () => {
    process.env.INTEROS_CREDENCIAIS = JSON.stringify([
      { id: "interos-test", escopos: ["erp.modules.read", "erp.modules.write"], hash: h(secret) },
      { id: "interos-ro", escopos: ["erp.modules.read"], hash: h(readSecret) },
      // credencial do piloto: só a empresa B
      { id: "interos-piloto", escopos: ["erp.modules.read", "erp.modules.write"], hash: h(pilotSecret), empresas: [B.id] },
    ]);
    // a credencial sem lista só alcança empresas ligadas ao Interos (criadas pelo provisionamento ou vinculadas com o código)
    await store.update("companies", A.id, { interosAccountId: "acc-mod-alfa" });
    await store.update("companies", B.id, { interosAccountId: "acc-mod-beta" });
    await takeBaseline(store, A.id);
  });
  afterEach(() => {
    delete process.env.INTEROS_CREDENCIAIS;
  });
  const call = (url: string, init: RequestInit & { token?: string } = {}) => new Request(`http://erp.local${url}`, { ...init, headers: { authorization: `Bearer ${init.token ?? token}`, "content-type": "application/json", ...(init.headers ?? {}) } });

  it("autenticação e escopos", () => {
    expect(authenticateInteros(null, "erp.modules.read")).toMatchObject({ ok: false, status: 401 });
    expect(authenticateInteros(`Bearer ${"x".repeat(40)}`, "erp.modules.read")).toMatchObject({ ok: false, status: 401 });
    expect(authenticateInteros(`Bearer ${readToken}`, "erp.modules.write")).toMatchObject({ ok: false, status: 403, code: "insufficient_scope" });
    expect(authenticateInteros(`Bearer ${token}`, "erp.modules.write")).toMatchObject({ ok: true });
  });

  it("catálogo, módulos da empresa, simulação, aplicação idempotente, operação e histórico", async () => {
    const cat = await (await import("@/app/api/interos/v1/catalog/route")).GET(call("/api/interos/v1/catalog"));
    expect(cat.status).toBe(200);
    expect((await cat.json()).data.catalog).toBe("catalogo-modulos-erp-v1");

    const mods = await import("@/app/api/interos/v1/companies/[companyId]/modules/route");
    const params = { params: Promise.resolve({ companyId: A.id }) };
    const st = await mods.GET(call(`/api/interos/v1/companies/${A.id}/modules`), params);
    expect(st.headers.get("etag")).toBe('"1"');

    const sim = await (await import("@/app/api/interos/v1/companies/[companyId]/modules/simulate/route")).POST(call(`/x`, { method: "POST", body: JSON.stringify({ changes: [{ module: "compras.pedidos", action: "disable" }] }) }), params);
    const simBody = await sim.json();
    expect(simBody.data.valid).toBe(false);
    expect(simBody.data.entries).toBeUndefined();

    const apply = (await import("@/app/api/interos/v1/companies/[companyId]/modules/apply/route")).POST;
    const body = JSON.stringify({ changes: [{ module: "fiscal.sped", action: "disable" }], reason: "Plano sem SPED" });
    const headers = { "idempotency-key": "k-2026-11-26-0001", "x-interos-actor": "ana@interos", "if-match": '"1"' };
    const noKey = await apply(call("/x", { method: "POST", body, headers: { "x-interos-actor": "ana" } }), params);
    expect(noKey.status).toBe(400);
    const ro = await apply(call("/x", { method: "POST", body, headers, token: readToken }), params);
    expect(ro.status).toBe(403);
    const r1 = await apply(call("/x", { method: "POST", body, headers }), params);
    expect(r1.status).toBe(201);
    const op = (await r1.json()).data;
    expect(op).toMatchObject({ status: "applied", versionBefore: 1, versionAfter: 2 });
    const r2 = await apply(call("/x", { method: "POST", body, headers }), params);
    expect(r2.status).toBe(200);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect((await r2.json()).data.operationId).toBe(op.operationId);
    const stale = await apply(call("/x", { method: "POST", body, headers: { ...headers, "idempotency-key": "k-2026-11-26-0002" } }), params);
    // correção 13: conflito de versão responde 409 no envelope de erro do contrato (a operação recusada vai nos detalhes)
    expect(stale.status).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.error.code).toBe("version_conflict");
    expect(staleBody.error.details.operation.status).toBe("rejected");
    // empresa inexistente: 404 company_not_found (não 422 baseline_required), sem registrar operação
    const ghost = await apply(call("/x", { method: "POST", body, headers: { ...headers, "idempotency-key": "k-2026-11-26-0003" } }), { params: Promise.resolve({ companyId: "naoexiste" }) });
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("company_not_found");

    const opr = await (await import("@/app/api/interos/v1/operations/[operationId]/route")).GET(call(`/x`), { params: Promise.resolve({ operationId: op.operationId }) });
    expect((await opr.json()).data.status).toBe("applied");
    const other = await (await import("@/app/api/interos/v1/operations/[operationId]/route")).GET(call(`/x`, { token: readToken }), { params: Promise.resolve({ operationId: op.operationId }) });
    expect(other.status).toBe(404); // operação de outro cliente não é exposta

    const hist = await (await import("@/app/api/interos/v1/companies/[companyId]/modules/history/route")).GET(call(`/x?limit=5`), params);
    expect((await hist.json()).data[0]).toMatchObject({ version: 2, actor: "ana@interos", reason: "Plano sem SPED" });

    const missing = await mods.GET(call(`/x`), { params: Promise.resolve({ companyId: "naoexiste" }) });
    expect(missing.status).toBe(404);
  });

  it("credencial restrita às empresas do piloto: outra empresa responde 403 company_not_allowed em leitura, simulação e aplicação", async () => {
    await takeBaseline(store, B.id);
    const forA = { params: Promise.resolve({ companyId: A.id }) };
    const forB = { params: Promise.resolve({ companyId: B.id }) };
    const mods = await import("@/app/api/interos/v1/companies/[companyId]/modules/route");
    const sim = (await import("@/app/api/interos/v1/companies/[companyId]/modules/simulate/route")).POST;
    const apply = (await import("@/app/api/interos/v1/companies/[companyId]/modules/apply/route")).POST;
    const hist = (await import("@/app/api/interos/v1/companies/[companyId]/modules/history/route")).GET;
    const base = await import("@/app/api/interos/v1/companies/[companyId]/modules/baseline/route");
    const change = JSON.stringify({ changes: [{ module: "fiscal.sped", action: "disable" }], reason: "Piloto" });
    const writeHeaders = { "idempotency-key": "k-piloto-0001", "x-interos-actor": "ana@interos" };
    const denied = [
      await mods.GET(call("/x", { token: pilotToken }), forA),
      await sim(call("/x", { method: "POST", body: change, token: pilotToken }), forA),
      await apply(call("/x", { method: "POST", body: change, headers: writeHeaders, token: pilotToken }), forA),
      await hist(call("/x", { token: pilotToken }), forA),
      await base.GET(call("/x", { token: pilotToken }), forA),
    ];
    for (const r of denied) {
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("company_not_allowed");
    }
    // nada mudou na empresa A
    expect((await loadCompanyModules(store, A.id))!.version).toBe(1);
    // a empresa do piloto funciona normalmente
    expect((await mods.GET(call("/x", { token: pilotToken }), forB)).status).toBe(200);
    expect((await sim(call("/x", { method: "POST", body: change, token: pilotToken }), forB)).status).toBe(200);
    const applied = await apply(call("/x", { method: "POST", body: change, headers: writeHeaders, token: pilotToken }), forB);
    expect(applied.status).toBe(201);
    // a lista de empresas só mostra as do piloto
    const list = await (await import("@/app/api/interos/v1/companies/route")).GET(call("/x", { token: pilotToken }));
    expect((await list.json()).data.map((c: any) => c.companyId)).toEqual([B.id]);
  });

  it("credencial com escopos de duas famílias é recusada (escopos separados)", async () => {
    const mixedSecret = crypto.randomBytes(32).toString("base64url");
    process.env.INTEROS_CREDENCIAIS = JSON.stringify([
      { id: "interos-test", escopos: ["erp.modules.read"], hash: h(secret) },
      { id: "interos-mista", escopos: ["erp.modules.read", "provisionamento:escrita"], hash: h(mixedSecret) },
    ]);
    expect(authenticateInteros(`Bearer interos-mista.${mixedSecret}`, "erp.modules.read")).toMatchObject({ ok: false, status: 401 });
    expect(authenticateInteros(`Bearer ${token}`, "erp.modules.read")).toMatchObject({ ok: true });
  });

  it("sem credenciais configuradas a integração responde 503", async () => {
    delete process.env.INTEROS_CREDENCIAIS;
    const r = await (await import("@/app/api/interos/v1/catalog/route")).GET(call("/x"));
    expect(r.status).toBe(503);
  });
});

describe("configuração e recursos (feature) continuam independentes", () => {
  it("o recurso desligado em Parâmetros continua desligado mesmo com o módulo habilitado", async () => {
    await takeBaseline(store, A.id);
    await setSetting(store, A.id, null, "feature.alteracaoMassa", false);
    const rep = await computeBaseline(store, A.id);
    expect(rep.features.alteracaoMassa).toEqual({ on: false, explicit: true });
    expect(decide(await loadCompanyModules(store, A.id), "produtos.alteracao_massa").level).toBe("full");
  });
});
