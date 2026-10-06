import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { createCustomer, customerSummary, deleteCustomer, setCustomerStatus, updateCustomer } from "@/domain/customers";
import { listAll } from "@/lib/db";
import { scopeStore } from "@/lib/db/scoped-store";
import { PermissionError } from "@/lib/core/errors";
import type { Store } from "@/lib/db/types";
import type { Ctx, CtxUser } from "@/lib/core/ctx";

const CO = "co-a";
const OTHER = "co-b";
const BR = "br-a";
// CPFs válidos (dígitos verificadores)
const CPF_X = "52998224725";
const CPF_Y = "11144477735";
const CPF_Z = "39053344705";

const crud = { view: true, create: true, edit: true, delete: true };

function user(over: Partial<CtxUser> = {}): CtxUser {
  return { id: "u-1", name: "Gerente", email: "g@t", isAdmin: false, permissions: { customers: crud }, actions: ["customer.credit_limit"], discountLimitBps: 0, branchIds: [], companyIds: [CO], ...over };
}

function ctxOf(store: Store, companyId = CO, u: CtxUser = user()): Ctx {
  return { store, companyId, branchId: BR, user: u };
}

/** Perfil "Caixa": cadastra e edita clientes, sem a ação de crédito. */
const cashier = () => user({ id: "u-cx", name: "Caixa", permissions: { customers: { view: true, create: true, edit: true } }, actions: ["cash.withdrawal", "sale.return", "fiscal.issue"] });

describe("clientes", () => {
  let store: Store;
  beforeEach(async () => {
    store = freshStore();
    await store.create("companies", { name: "Empresa A", status: "active" }, CO);
    await store.create("companies", { name: "Empresa B", status: "active" }, OTHER);
  });

  it("não inativa nem exclui cliente de outra empresa (checagem explícita e Store restrito)", async () => {
    const foreign = await createCustomer(ctxOf(store, OTHER, user({ companyIds: [OTHER] })), { personType: "PF", doc: CPF_X, name: "Cliente da B" });
    const attacker = ctxOf(store); // Store sem restrição: a regra do domínio precisa barrar
    await expect(setCustomerStatus(attacker, foreign.id, "inactive")).rejects.toThrow(/Cliente não encontrado/);
    await expect(deleteCustomer(attacker, foreign.id)).rejects.toThrow(/Cliente não encontrado/);
    await expect(updateCustomer(attacker, foreign.id, { personType: "PF", doc: CPF_X, name: "Alterado" })).rejects.toThrow(/Cliente não encontrado/);
    const scoped = ctxOf(scopeStore(store, CO)); // contexto real da requisição
    await expect(setCustomerStatus(scoped, foreign.id, "inactive")).rejects.toBeInstanceOf(Error);
    await expect(deleteCustomer(scoped, foreign.id)).rejects.toBeInstanceOf(Error);
    const after = await store.get("customers", foreign.id);
    expect(after).toMatchObject({ status: "active", name: "Cliente da B", companyId: OTHER });
    // nenhuma auditoria de alteração gravada na empresa do atacante
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "companyId", CO]] });
    expect(logs.filter((l) => l.entityId === foreign.id)).toHaveLength(0);

    // na própria empresa continua funcionando
    const mine = await createCustomer(ctxOf(store), { personType: "PF", doc: CPF_Y, name: "Cliente da A" });
    await setCustomerStatus(ctxOf(store), mine.id, "inactive");
    expect((await store.get("customers", mine.id))!.status).toBe("inactive");
    await deleteCustomer(ctxOf(store), mine.id);
    expect(await store.get("customers", mine.id)).toBeNull();
  });

  it("documentos fiscais do cliente: só da empresa ativa (mesmo CPF em outra empresa não aparece)", async () => {
    const a = await createCustomer(ctxOf(store), { personType: "PF", doc: CPF_X, name: "Maria (A)" });
    await createCustomer(ctxOf(store, OTHER, user({ companyIds: [OTHER] })), { personType: "PF", doc: CPF_X, name: "Maria (B)" });
    await store.create("fiscal_documents", { companyId: CO, branchId: BR, model: "nfce", status: "authorized", ref: "a-1", recipientDoc: CPF_X, total: 1000, issuedAt: "2026-09-01T12:00:00.000Z" }, "fd-a1");
    await store.create("fiscal_documents", { companyId: OTHER, branchId: "br-b", model: "nfe", status: "authorized", ref: "b-1", recipientDoc: CPF_X, total: 999900, issuedAt: "2026-09-02T12:00:00.000Z" }, "fd-b1");
    // vinculado ao cliente pela venda (partyId) mesmo sem o documento no destinatário
    await store.create("fiscal_documents", { companyId: CO, branchId: BR, model: "nfce", status: "authorized", ref: "a-2", recipientDoc: null, partyType: "customer", partyId: a.id, total: 500, issuedAt: "2026-09-03T12:00:00.000Z" }, "fd-a2");
    // outros dados da empresa B com o mesmo id de cliente não entram (defesa em profundidade)
    await store.create("sales", { companyId: OTHER, branchId: "br-b", number: 1, status: "completed", customerId: a.id, total: 777700, completedAt: "2026-09-02T12:00:00.000Z" }, "s-b1");

    const sum = await customerSummary({ store, companyId: CO }, a.id);
    expect(sum.documents.map((d) => d.id).sort()).toEqual(["fd-a1", "fd-a2"]);
    expect(sum.sales).toHaveLength(0);
    expect(sum.netTotal).toBe(0);
    // cliente de outra empresa: resumo vazio
    const foreign = await customerSummary({ store, companyId: OTHER }, a.id);
    expect(foreign.documents).toHaveLength(0);
  });

  it("corrigir ou remover o CPF libera o documento antigo para outro cadastro", async () => {
    const ctx = ctxOf(store);
    const c = await createCustomer(ctx, { personType: "PF", doc: CPF_X, name: "Cadastro com CPF errado" });
    await updateCustomer(ctx, c.id, { personType: "PF", doc: CPF_Y, name: "Cadastro com CPF errado" });
    // o verdadeiro titular do CPF_X agora pode ser cadastrado
    const owner = await createCustomer(ctx, { personType: "PF", doc: CPF_X, name: "Titular do CPF X" });
    expect(owner.id).not.toBe(c.id);
    expect(owner.doc).toBe(CPF_X);
    // remover o documento também libera
    await updateCustomer(ctx, c.id, { personType: "PF", doc: null, name: "Sem documento" });
    const y = await createCustomer(ctx, { personType: "PF", doc: CPF_Y, name: "Titular do CPF Y" });
    expect(y.doc).toBe(CPF_Y);
    // a unicidade continua valendo para o documento atual, com o nome de quem o usa
    await expect(createCustomer(ctx, { personType: "PF", doc: CPF_X, name: "Duplicado" })).rejects.toThrow(/Já existe cliente com este CPF: Titular do CPF X/);
    await expect(updateCustomer(ctx, c.id, { personType: "PF", doc: CPF_Y, name: "Sem documento" })).rejects.toThrow(/Titular do CPF Y/);
    // índice único (companyId, doc) barra gravação concorrente que passou pela verificação prévia
    await expect(store.create("customers", { companyId: CO, personType: "PF", name: "Corrida", doc: CPF_X })).rejects.toThrow();
    // o mesmo CPF pode existir em outra empresa
    const other = await createCustomer(ctxOf(store, OTHER, user({ companyIds: [OTHER] })), { personType: "PF", doc: CPF_X, name: "Titular na B" });
    expect(other.companyId).toBe(OTHER);
  });

  it("cadastro sem CPF/CNPJ é idempotente pela chave do formulário", async () => {
    const ctx = ctxOf(store);
    const first = await createCustomer(ctx, { personType: "PF", name: "Maria" }, { idemKey: "ui:abc" });
    const again = await createCustomer(ctx, { personType: "PF", name: "Maria" }, { idemKey: "ui:abc" });
    expect(again.id).toBe(first.id);
    const [p1, p2] = await Promise.all([
      createCustomer(ctx, { personType: "PF", name: "João" }, { idemKey: "ui:def", quick: true }),
      createCustomer(ctx, { personType: "PF", name: "João" }, { idemKey: "ui:def", quick: true }),
    ]);
    expect(p1.id).toBe(p2.id);
    const all = await listAll(store, "customers", { filters: [["eq", "companyId", CO]] });
    expect(all.map((c) => c.name).sort()).toEqual(["João", "Maria"]);
    // chave nova = novo cadastro (mesmo nome é permitido)
    const other = await createCustomer(ctx, { personType: "PF", name: "Maria" }, { idemKey: "ui:ghi" });
    expect(other.id).not.toBe(first.id);
    // com documento, a repetição devolve o mesmo cliente em vez de erro de duplicidade
    const withDoc = await createCustomer(ctx, { personType: "PF", doc: CPF_Z, name: "Ana" }, { idemKey: "ui:jkl" });
    expect((await createCustomer(ctx, { personType: "PF", doc: CPF_Z, name: "Ana" }, { idemKey: "ui:jkl" })).id).toBe(withDoc.id);
  });

  it("limite de crédito do crediário exige a permissão específica", async () => {
    const cx = ctxOf(store, CO, cashier());
    await expect(createCustomer(cx, { personType: "PF", doc: CPF_X, name: "Cliente", creditLimit: 500000 })).rejects.toBeInstanceOf(PermissionError);
    const c = await createCustomer(cx, { personType: "PF", doc: CPF_X, name: "Cliente" });
    expect(c.creditLimit).toBe(0);
    // caixa não concede nem altera
    await expect(updateCustomer(cx, c.id, { personType: "PF", doc: CPF_X, name: "Cliente", creditLimit: 500000 })).rejects.toBeInstanceOf(PermissionError);
    expect((await store.get("customers", c.id))!.creditLimit).toBe(0);
    // gerente concede
    const mgr = ctxOf(store);
    await updateCustomer(mgr, c.id, { personType: "PF", doc: CPF_X, name: "Cliente", creditLimit: 150000 });
    expect((await store.get("customers", c.id))!.creditLimit).toBe(150000);
    // caixa edita outros campos: com o mesmo limite reenviado ou sem o campo (somente leitura), o limite é mantido
    await updateCustomer(cx, c.id, { personType: "PF", doc: CPF_X, name: "Cliente Silva", creditLimit: 150000 });
    await updateCustomer(cx, c.id, { personType: "PF", doc: CPF_X, name: "Cliente Silva Jr.", creditLimit: undefined });
    const after = await store.get("customers", c.id);
    expect(after).toMatchObject({ name: "Cliente Silva Jr.", creditLimit: 150000 });
    // reduzir também é alteração de crédito
    await expect(updateCustomer(cx, c.id, { personType: "PF", doc: CPF_X, name: "Cliente Silva Jr.", creditLimit: 0 })).rejects.toThrow(/limite de crédito/);
    // administrador sempre pode
    await updateCustomer(ctxOf(store, CO, user({ isAdmin: true, actions: [] })), c.id, { personType: "PF", doc: CPF_X, name: "Cliente Silva Jr.", creditLimit: 0 });
    expect((await store.get("customers", c.id))!.creditLimit).toBe(0);
  });
});
