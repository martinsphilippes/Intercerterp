import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll, findOne } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import {
  createClient, updateClient, getClient, setClientStatus, changeClientRegime, regimeAt, clientRegimeHistory,
  addPerson, addEstablishment, saveGroup, saveDepartment, setDepartmentMember, assignResponsible, visibleClientIds,
  issueLinkCode, acceptAccountingLink, revokeAccountingLink, linkedSnapshot, companyAccountingLink, deliverPackageToFirm, listDeliveries, reviewDelivery, deliveryForFile,
} from "@/domain/accounting";
import { buildAccountingPackage, sendAccountingPackage } from "@/domain/fiscal/export";
import { saveIntegration } from "@/domain/integrations";
import { monthStart, monthEnd, today, addMonths } from "@/lib/dates";

let store: MemoryStore;
let refs: DemoRefs;
let firm: { company: any; branch: any; roles: Record<string, any> };
let firm2: { company: any; branch: any; roles: Record<string, any> };
let owner: Ctx; // sócio do escritório 1
let analyst: Ctx; // analista (carteira restrita) do escritório 1
let owner2: Ctx; // sócio do escritório 2
let retailAdmin: Ctx; // administrador da empresa (DEMO) que usa o ERP

async function ctxFor(userId: string, company: any, branch: any): Promise<Ctx> {
  const u = (await store.get("users", userId))!;
  return { store: scopeStore(store, company.id), companyId: company.id, branchId: branch.id, user: await toCtxUser(store, u, company.id) };
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  retailAdmin = await refs.ctxFor("admin", "matriz");
  firm = await createCompanyWithDefaults(store, { name: "Contábil Alfa Ltda", cnpj: "11444777000161", kind: "accounting", key: "firm-alfa" });
  firm2 = await createCompanyWithDefaults(store, { name: "Contábil Beta Ltda", cnpj: "19131243000197", kind: "accounting", key: "firm-beta" });
  // usuários dos escritórios (registro direto, como a instalação faria pelo administrador geral)
  const mk = async (name: string, email: string, login: string, company: any, roleId: string) =>
    store.create("users", { name, email, login, status: "active", isAdmin: false, roleId, roleByCompany: { [company.id]: roleId }, companyIds: [company.id], branchIds: [], firstAccessAt: new Date().toISOString() });
  const u1 = await mk("Sócio Alfa", "socio@alfa.test", "socio.alfa", firm.company, firm.roles.firm_admin.id);
  const u2 = await mk("Analista Alfa", "analista@alfa.test", "analista.alfa", firm.company, firm.roles.firm_analyst.id);
  const u3 = await mk("Sócio Beta", "socio@beta.test", "socio.beta", firm2.company, firm2.roles.firm_admin.id);
  owner = await ctxFor(u1.id, firm.company, firm.branch);
  analyst = await ctxFor(u2.id, firm.company, firm.branch);
  owner2 = await ctxFor(u3.id, firm2.company, firm2.branch);
});

describe("escritório contábil — parametrização e perfis", () => {
  it("escritório nasce enxuto: sem depósitos nem meios de PDV, com departamentos e perfis próprios", async () => {
    expect(firm.company.kind).toBe("accounting");
    expect(await listAll(store, "warehouses", { filters: [["eq", "companyId", firm.company.id]] })).toHaveLength(0);
    expect(await listAll(store, "price_tables", { filters: [["eq", "companyId", firm.company.id]] })).toHaveLength(0);
    const methods = await listAll(store, "payment_methods", { filters: [["eq", "companyId", firm.company.id]] });
    expect(methods.every((m) => m.availablePdv === false)).toBe(true);
    expect((await listAll(store, "departments", { filters: [["eq", "companyId", firm.company.id]] })).map((d) => d.key).sort()).toEqual(["contabil", "financeiro", "fiscal", "pessoal", "societario"]);
    expect(Object.keys(firm.roles).sort()).toEqual(["firm_admin", "firm_analyst", "firm_finance", "firm_manager"]);
    expect(owner.user.actions).toContain("accounting.all_clients");
    expect(analyst.user.actions).not.toContain("accounting.all_clients");
  });

  it("empresa operacional continua com a parametrização de loja e sem o módulo contábil nos perfis", async () => {
    expect(await listAll(store, "warehouses", { filters: [["eq", "companyId", refs.company.id]] })).not.toHaveLength(0);
    expect(retailAdmin.user.permissions.accounting).toBeUndefined();
    expect(retailAdmin.user.actions).not.toContain("accounting.link");
  });
});

describe("clientes contábeis", () => {
  let clientId: string;

  it("cadastra PJ com código sequencial, histórico de regime e CPF/CNPJ único por escritório", async () => {
    const c = await createClient(owner, { personType: "PJ", doc: "12.345.678/0001-95", name: "Padaria Pão Quente Ltda", regime: "simples", services: ["accounting", "fiscal"], status: "active", serviceStartAt: "2025-01-01", cnaes: ["4721102", "4721102"], address: { uf: "SP", cityName: "São Paulo" } });
    clientId = c.id;
    expect(c.code).toBe("C0001");
    expect(c.doc).toBe("12345678000195");
    expect(c.crt).toBe("1");
    expect(c.cnaes).toEqual(["4721102"]);
    expect(c.linkStatus).toBe("none");
    const hist = await clientRegimeHistory(owner, c.id);
    expect(hist).toHaveLength(1);
    expect(hist[0].validTo).toBeNull();
    expect(hist[0].validFrom).toBe("2025-01-01");
    await expect(createClient(owner, { personType: "PJ", doc: "12345678000195", name: "Outra" })).rejects.toThrow(/Já existe cliente/);
    await expect(createClient(owner, { personType: "PJ", doc: "12345678000100", name: "CNPJ errado" })).rejects.toThrow(/CNPJ inválido/);
    // outro escritório pode ter o mesmo CNPJ na própria carteira
    const other = await createClient(owner2, { personType: "PJ", doc: "12345678000195", name: "Padaria (Beta)" });
    expect(other.code).toBe("C0001");
    expect(other.companyId).toBe(firm2.company.id);
  });

  it("isolamento entre escritórios: o cliente de um não aparece nem abre no outro", async () => {
    await expect(getClient(owner2, clientId)).rejects.toThrow();
    const mine = await listAll(owner2.store, "accounting_clients", {});
    expect(mine.every((c) => c.companyId === firm2.company.id)).toBe(true);
  });

  it("mudança de regime fecha a vigência anterior na véspera e preserva o histórico", async () => {
    await changeClientRegime(owner, clientId, { regime: "presumido", validFrom: "2026-01-01", reason: "Exclusão do Simples" });
    const hist = await clientRegimeHistory(owner, clientId);
    expect(hist).toHaveLength(2);
    expect(hist[0].regime).toBe("presumido");
    expect(hist[1].validTo).toBe("2025-12-31");
    expect((await regimeAt(owner, clientId, "2025-06-10")).regime).toBe("simples");
    expect((await regimeAt(owner, clientId, "2026-03-01")).regime).toBe("presumido");
    expect((await getClient(owner, clientId)).regime).toBe("presumido");
    await expect(changeClientRegime(owner, clientId, { regime: "presumido", validFrom: "2026-02-01" })).rejects.toThrow(/já está neste regime/);
    await expect(changeClientRegime(owner, clientId, { regime: "real", validFrom: "2025-12-01" })).rejects.toThrow(/precisa começar depois/);
    // vigência futura não altera o regime atual do cadastro
    const future = addMonths(today(), 2);
    await changeClientRegime(owner, clientId, { regime: "real", validFrom: future });
    expect((await getClient(owner, clientId)).regime).toBe("presumido");
    // edição do cadastro não sobrescreve o regime (só o histórico muda regime)
    const up = await updateClient(owner, clientId, { personType: "PJ", doc: "12345678000195", name: "Padaria Pão Quente Ltda", regime: "mei" });
    expect(up.regime).toBe("presumido");
  });

  it("situação: transições válidas, encerramento exige motivo", async () => {
    await expect(setClientStatus(owner, clientId, "closed", {})).rejects.toThrow(/motivo/);
    await setClientStatus(owner, clientId, "offboarding", {});
    const c = await setClientStatus(owner, clientId, "closed", { reason: "Encerrou as atividades" });
    expect(c.status).toBe("closed");
    expect(c.endedAt).toBe(today());
    await expect(setClientStatus(owner, clientId, "offboarding", {})).rejects.toThrow(/Não é possível/);
    await setClientStatus(owner, clientId, "active", {});
  });

  it("sócios somam no máximo 100% e estabelecimentos exigem a raiz do CNPJ", async () => {
    await addPerson(owner, clientId, { kind: "partner", name: "João", doc: "52998224725", shareBps: 6000, isPrimary: true });
    await expect(addPerson(owner, clientId, { kind: "partner", name: "Maria", shareBps: 5000 })).rejects.toThrow(/ultrapassa 100%/);
    await addPerson(owner, clientId, { kind: "partner", name: "Maria", shareBps: 4000 });
    await addEstablishment(owner, clientId, { kind: "filial", cnpj: "12345678000276", address: { uf: "SP", cityName: "Campinas" } });
    await expect(addEstablishment(owner, clientId, { kind: "filial", cnpj: "19131243000197" })).rejects.toThrow(/mesma raiz/);
    await expect(addEstablishment(owner, clientId, { kind: "filial", cnpj: "12345678000276" })).rejects.toThrow(/já cadastrado/);
  });

  it("carteira restrita: o analista só vê clientes em que é responsável, titular/substituto ou gestor do departamento", async () => {
    const other = await createClient(owner, { personType: "PF", doc: "529.982.247-25", name: "Carlos Autônomo", status: "active" });
    expect(await visibleClientIds(owner)).toBeNull();
    expect((await visibleClientIds(analyst))!.size).toBe(0);
    await expect(getClient(analyst, clientId)).rejects.toThrow(/não está na sua carteira/);
    await assignResponsible(owner, clientId, { userId: analyst.user.id, role: "titular" });
    expect([...(await visibleClientIds(analyst))!]).toEqual([clientId]);
    expect((await getClient(analyst, clientId)).id).toBe(clientId);
    await expect(getClient(analyst, other.id)).rejects.toThrow();
    // gestor de departamento vê os clientes atribuídos ao departamento
    const dep = (await listAll(owner.store, "departments", { filters: [["eq", "key", "fiscal"]] }))[0];
    await saveDepartment(owner, dep.id, { name: dep.name, kind: dep.kind, managerUserId: analyst.user.id });
    await assignResponsible(owner, other.id, { departmentId: dep.id, userId: owner.user.id, role: "titular" });
    expect((await visibleClientIds(analyst))!.has(other.id)).toBe(true);
    // analista não gerencia equipe
    await expect(setDepartmentMember(analyst, dep.id, analyst.user.id, "member")).rejects.toThrow();
    const g = await saveGroup(owner, null, { name: "Grupo Pão", kind: "economic" });
    await expect(saveGroup(owner, null, { name: "grupo pão" })).rejects.toThrow(/Já existe grupo/);
    expect(g.active).toBe(true);
  });
});

describe("vínculo com a empresa do ERP e entregas automáticas", () => {
  let linkedId: string;

  it("código de vínculo: aceite pela empresa exige CNPJ coincidente, código válido e não expirado", async () => {
    const c = await createClient(owner, { personType: "PJ", doc: refs.company.cnpj, name: "Loja Demonstração (cliente)", status: "active", regime: "simples" });
    linkedId = c.id;
    // cliente com CNPJ diferente da empresa: código não serve
    const wrong = await createClient(owner, { personType: "PJ", doc: "19131243000197", name: "Outra Empresa", status: "active" });
    const wrongCode = await issueLinkCode(owner, wrong.id);
    await expect(acceptAccountingLink(retailAdmin, wrongCode.code)).rejects.toThrow(/CNPJ diferente/);
    await expect(acceptAccountingLink(retailAdmin, "AAAAA-BBBBB")).rejects.toThrow(/inválido/);
    // analista não emite código (sem accounting.link)
    await expect(issueLinkCode(analyst, linkedId)).rejects.toThrow();
    const { code, expiresAt } = await issueLinkCode(owner, linkedId);
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(expiresAt > new Date().toISOString()).toBe(true);
    expect((await getClient(owner, linkedId)).linkStatus).toBe("pending");
    // o hash do código fica gravado, nunca o código
    const row = (await store.get("accounting_clients", linkedId))!;
    expect(row.linkCodeHash).not.toContain(code.replace("-", ""));
    // o escritório não vê a empresa antes do aceite
    await expect(linkedSnapshot(owner, linkedId)).rejects.toThrow(/sem vínculo/);
    const r = await acceptAccountingLink(retailAdmin, code.toLowerCase());
    expect(r.firm.id).toBe(firm.company.id);
    const after = await getClient(owner, linkedId);
    expect(after.linkStatus).toBe("active");
    expect(after.linkedCompanyId).toBe(refs.company.id);
    expect(after.linkCodeHash).toBeNull();
    // código já usado não aceita de novo; empresa já vinculada não aceita outro escritório
    await expect(acceptAccountingLink(retailAdmin, code)).rejects.toThrow(/inválido ou já utilizado/);
    const beta = await createClient(owner2, { personType: "PJ", doc: refs.company.cnpj, name: "Loja (Beta)", status: "active" });
    const betaCode = await issueLinkCode(owner2, beta.id);
    await expect(acceptAccountingLink(retailAdmin, betaCode.code)).rejects.toThrow(/já está vinculada/);
    const link = await companyAccountingLink(store, refs.company.id);
    expect(link?.firm.id).toBe(firm.company.id);
    // integração "accounting" da empresa registra o escritório
    const integ = await findOne(store, "integrations", [["eq", "companyId", refs.company.id], ["eq", "kind", "accounting"]]);
    expect(integ?.config?.linkedFirmCompanyId).toBe(firm.company.id);
  });

  it("escritório lê a situação fiscal da empresa vinculada somente em leitura; outro escritório não", async () => {
    const snap = await linkedSnapshot(owner, linkedId);
    expect(snap.company.id).toBe(refs.company.id);
    expect(snap.months).toHaveLength(3);
    expect(Array.isArray(snap.obligations)).toBe(true);
    // o leitor é somente leitura
    const { linkedCompanyReader } = await import("@/domain/accounting/link");
    const reader = await linkedCompanyReader(owner, await getClient(owner, linkedId));
    await expect(reader.create("customers", { companyId: refs.company.id, personType: "PF", name: "x" })).rejects.toThrow(/somente leitura/);
    await expect(reader.update("companies", refs.company.id, { name: "hack" })).rejects.toThrow(/somente leitura/);
    // escritório Beta não acessa o cliente de Alfa
    await expect(linkedSnapshot(owner2, linkedId)).rejects.toThrow();
  });

  it("pacote mensal gerado pela empresa entra na caixa de entrada do escritório (idempotente) e conta como entrega da obrigação", async () => {
    await saveIntegration(retailAdmin, { kind: "accounting", branchId: null, provider: "export_package", environment: "producao", config: {}, secretRefs: {}, enabled: true });
    const prev = addMonths(monthStart(today()), -1);
    const f = { from: prev, to: monthEnd(prev), branchId: null, includeSimulated: true };
    const sent = await sendAccountingPackage({ ...retailAdmin, branchId: null }, f, { reason: "manual" });
    expect(sent.delivered).toBe(true);
    expect(sent.message).toMatch(/caixa de entrada do escritório/);
    const inbox = await listDeliveries(owner, {});
    expect(inbox).toHaveLength(1);
    expect(inbox[0].clientId).toBe(linkedId);
    expect(inbox[0].sourceCompanyId).toBe(refs.company.id);
    expect(inbox[0].status).toBe("received");
    expect(inbox[0].period).toBe(prev.slice(0, 7));
    // o mesmo arquivo não gera entrega duplicada; outro escritório não enxerga
    const again = await deliverPackageToFirm({ ...retailAdmin, branchId: null }, { ...sent.package!, missingXml: sent.package!.missingXml.length });
    expect(again?.id).toBe(inbox[0].id);
    expect(await listDeliveries(owner, {})).toHaveLength(1);
    expect(await listDeliveries(owner2, {})).toHaveLength(0);
    // o escritório pode baixar o arquivo pela entrega; o analista sem o cliente na carteira não vê a entrega
    expect((await deliveryForFile(store, firm.company.id, inbox[0].fileId))?.id).toBe(inbox[0].id);
    expect(await deliveryForFile(store, firm2.company.id, inbox[0].fileId)).toBeNull();
    expect(await listDeliveries(analyst, {})).toHaveLength(0);
    // obrigação "Entrega de XML" do período concluída pela entrega ao escritório
    const obl = await listAll(store, "fiscal_obligations", { filters: [["eq", "companyId", refs.company.id], ["eq", "kind", "xml_contabilidade"], ["eq", "period", prev.slice(0, 7)]] });
    if (obl.length) expect(obl[0].status).toBe("done");
    const reviewed = await reviewDelivery(owner, inbox[0].id, { notes: "Conferido" });
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.reviewedBy).toBe(owner.user.id);
  });

  it("desfazer o vínculo (pela empresa) preserva as entregas e interrompe novas entregas", async () => {
    await revokeAccountingLink(retailAdmin, "company");
    expect((await getClient(owner, linkedId)).linkStatus).toBe("revoked");
    expect(await companyAccountingLink(store, refs.company.id)).toBeNull();
    expect(await listDeliveries(owner, {})).toHaveLength(1);
    const prev = addMonths(monthStart(today()), -2);
    const pkg = await buildAccountingPackage({ ...retailAdmin, branchId: null }, { from: prev, to: monthEnd(prev), branchId: null, includeSimulated: true });
    expect(pkg.deliveredToFirm).toBeFalsy();
    expect(await listDeliveries(owner, {})).toHaveLength(1);
    await expect(linkedSnapshot(owner, linkedId)).rejects.toThrow(/sem vínculo/);
    // cliente pode ser vinculado de novo com um código novo
    const { code } = await issueLinkCode(owner, linkedId);
    await acceptAccountingLink(retailAdmin, code);
    expect((await getClient(owner, linkedId)).linkStatus).toBe("active");
    await revokeAccountingLink(owner, "firm", linkedId);
    expect((await getClient(owner, linkedId)).linkStatus).toBe("revoked");
  });
});
