import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { freshStore } from "./helpers";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import { createCompanyWithDefaults } from "@/domain/setup";
import { accessibleUnits, toCtxUser } from "@/lib/auth/users";
import { createRole, updateRole } from "@/domain/roles";
import { notify } from "@/lib/core/notify";
import { demoCredentialBlocked, demoLoginEnabled, erpEnvironment, quickAccessPinned } from "@/lib/auth/quick-access";
import type { Ctx } from "@/lib/core/ctx";

/**
 * Multiempresa — operações da plataforma, credenciais de demonstração e limites de quem edita perfis
 * (docs/multiempresa/arquitetura.md §4 e §7).
 */
let store: Store;
let loja: Doc;
let plataforma: Doc;
let demo: Doc;

async function ctxOf(user: Doc, company: Doc): Promise<Ctx> {
  return { store: scopeStore(store, company.id, { platform: Boolean(company.isPlatform) }), companyId: company.id, branchId: null, user: await toCtxUser(store, user, company.id) };
}

async function userWithRole(company: Doc, roleKey: string, id: string, extra: Record<string, any> = {}) {
  const role = (await listAll(store, "roles", { filters: [["eq", "companyId", company.id], ["eq", "key", roleKey]] }))[0];
  return store.create("users", { name: id, email: `${id}@teste.example`, status: "active", companyIds: [company.id], roleId: role.id, roleByCompany: { [company.id]: role.id }, branchIds: [], ...extra }, id);
}

beforeAll(async () => {
  store = freshStore();
  loja = (await createCompanyWithDefaults(store, { name: "Loja Cliente Ltda", cnpj: "45723174000110", key: "loja-cliente" })).company;
  plataforma = (await createCompanyWithDefaults(store, { name: "Intercert Plataforma", cnpj: "20301510000106", key: "plataforma", kind: "certification" })).company;
  plataforma = await store.update("companies", plataforma.id, { isPlatform: true });
  demo = (await createCompanyWithDefaults(store, { name: "Loja Demonstração", cnpj: "11222333000181", key: "demo" })).company;
  demo = await store.update("companies", demo.id, { isDemo: true });
});

afterEach(() => {
  delete process.env.ERP_AMBIENTE;
  delete process.env.SHOW_DEMO_LOGIN;
});

describe("operações da plataforma só na empresa da plataforma", () => {
  it("administrador de cliente não concede rede nem certificação; na plataforma, sim", async () => {
    const admin = await userWithRole(loja, "admin", "admin-loja");
    const ctx = await ctxOf(admin, loja);
    await expect(createRole(ctx, { name: "Escalada", permissions: {}, actions: ["network.manage"], discountLimitBps: 0 })).rejects.toThrow(/plataforma Intercert/);
    await expect(createRole(ctx, { name: "Escalada 2", permissions: {}, actions: ["certification.operate"], discountLimitBps: 0 })).rejects.toThrow(/plataforma Intercert/);
    const padm = await userWithRole(plataforma, "partner_admin", "admin-plataforma");
    // o administrador do parceiro não tem a operação; quem concede precisa tê-la (ou ser da plataforma com ela)
    await expect(createRole(await ctxOf(padm, plataforma), { name: "Equipe", permissions: {}, actions: ["certification.operate"], discountLimitBps: 0 })).rejects.toThrow(/você mesmo tem/);
    const sys: Ctx = { store: scopeStore(store, plataforma.id, { platform: true }), companyId: plataforma.id, branchId: null, user: { id: "system", name: "Sistema", email: "", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [plataforma.id] } };
    const team = await createRole(sys, { name: "Equipe de certificação", permissions: {}, actions: ["certification.operate"], discountLimitBps: 0 });
    expect(team.actions).toEqual(["certification.operate"]);
  });

  it("operação de plataforma gravada antes num perfil de cliente fica sem efeito", async () => {
    const legacy = await store.create("roles", { companyId: loja.id, key: "legado", name: "Perfil legado", permissions: { admin: { view: true } }, actions: ["network.manage", "certification.operate", "sale.cancel"], system: false, active: true });
    const u = await store.create("users", { name: "Legado", email: "legado@teste.example", status: "active", companyIds: [loja.id], roleId: legacy.id, roleByCompany: { [loja.id]: legacy.id }, branchIds: [] }, "legado");
    const cu = await toCtxUser(store, u, loja.id);
    expect(cu.actions).toEqual(["sale.cancel"]);
    // editar o perfil mantendo o que já existia é permitido (sem acrescentar)
    const admin = (await store.get("users", "admin-loja"))!;
    const ctx = await ctxOf(admin, loja);
    const after = await updateRole(ctx, legacy.id, { name: "Perfil legado", permissions: { admin: { view: true } }, actions: ["network.manage", "certification.operate", "sale.cancel"], discountLimitBps: 0 });
    expect(after.actions).toContain("network.manage");
  });

  it("quem edita perfis só concede o que tem", async () => {
    const custom = await store.create("roles", { companyId: loja.id, key: "gestor-usuarios", name: "Gestor de usuários", permissions: { admin: { view: true, create: true, edit: true }, sales: { view: true } }, actions: ["admin.users"], system: false, active: true });
    const u = await store.create("users", { name: "Gestor", email: "gestor@teste.example", status: "active", companyIds: [loja.id], roleId: custom.id, roleByCompany: { [loja.id]: custom.id }, branchIds: [] }, "gestor");
    const ctx = await ctxOf(u, loja);
    await expect(createRole(ctx, { name: "Financeiro total", permissions: { finance: { view: true, edit: true } }, actions: ["finance.approve_payable"], discountLimitBps: 0 })).rejects.toThrow(/Financeiro · Visualizar|Fora do seu perfil/);
    const ok = await createRole(ctx, { name: "Consulta de vendas", permissions: { sales: { view: true } }, actions: [], discountLimitBps: 0 });
    expect(ok.permissions.sales.view).toBe(true);
  });

  it("avisos para a equipe de certificação chegam na empresa da plataforma", async () => {
    const sys: Ctx = { store: scopeStore(store, plataforma.id, { platform: true }), companyId: plataforma.id, branchId: null, user: { id: "system", name: "Sistema", email: "", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [plataforma.id] } };
    const role = (await listAll(store, "roles", { filters: [["eq", "companyId", plataforma.id], ["eq", "name", "Equipe de certificação"]] }))[0] ?? (await createRole(sys, { name: "Equipe de certificação", permissions: {}, actions: ["certification.operate"], discountLimitBps: 0 }));
    await store.create("users", { name: "Cecília", email: "cecilia@teste.example", status: "active", companyIds: [plataforma.id], roleId: role.id, roleByCompany: { [plataforma.id]: role.id }, branchIds: [] }, "cecilia");
    const n = await notify(scopeStore(store, loja.id), { companyId: loja.id, type: "info", title: "Pagamento de certificado a confirmar", audience: { action: "certification.operate" }, occurrenceKey: "cert-team:teste:1" });
    expect(n).toBe(1);
    const got = await listAll(store, "notifications", { filters: [["eq", "userId", "cecilia"]] });
    expect(got).toHaveLength(1);
    expect(got[0].companyId).toBe(plataforma.id);
  });
});

describe("credenciais de demonstração só no ambiente de teste", () => {
  it("acesso rápido: ligado no teste com SHOW_DEMO_LOGIN, desligado em produção mesmo com a variável", () => {
    process.env.SHOW_DEMO_LOGIN = "1";
    expect(erpEnvironment()).toBe("teste");
    expect(quickAccessPinned()).toBe(true);
    expect(demoLoginEnabled()).toBe(true);
    process.env.ERP_AMBIENTE = "producao";
    expect(quickAccessPinned()).toBe(false);
    expect(demoLoginEnabled()).toBe(false);
    expect(demoCredentialBlocked({ isDemo: true })).toBe(true);
    expect(demoCredentialBlocked({ isDemo: false })).toBe(false);
  });

  it("usuário de demonstração só alcança empresas de demonstração", async () => {
    const u = await store.create("users", { name: "Demo", email: "demo@teste.example", status: "active", isDemo: true, companyIds: [demo.id, loja.id], branchIds: [] }, "demo-user");
    const units = await accessibleUnits(store, u);
    expect(units.companies.map((c) => c.id)).toEqual([demo.id]);
    expect(units.branches.every((b) => b.companyId === demo.id)).toBe(true);
  });
});
