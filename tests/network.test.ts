import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import type { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import { addDays, today } from "@/lib/dates";
import { DEFAULT_ROLES, FIRM_ROLES, PARTNER_ROLES, ROLE_TEMPLATES, canDo, roleTemplatesFor } from "@/lib/permissions";
import { ACTIONS_ADDED_TO_TEMPLATES, templateSyncPlan } from "@/lib/auth/role-sync";
import { featureDefaultFor } from "@/lib/core/settings";
import { certificationSettings, saveCertificationSettings } from "@/domain/accounting";
import {
  childLevelError, computeVisible, createNode, moveNode, setNodeStatus, getNode, visibleNodeIds, networkViewer, blockedAncestor, saveLevelLabels, networkSettings,
  saveLevelPriceRule, saveNodePriceRule, clearNodePriceRule, effectivePrice, resolveRule, ruleErrors, nodeRuleHistory, levelPriceTable, nodeHistory, priceAlerts,
} from "@/domain/network";

let store: MemoryStore;
let platform: Ctx;
const nodes: Record<string, any> = {};
const companies: Record<string, any> = {};

async function ctxForUser(email: string, companyId: string): Promise<Ctx> {
  const u = (await store.list("users", { filters: [["eq", "email", email]] })).items[0];
  const branch = (await store.list("branches", { filters: [["eq", "companyId", companyId]] })).items[0];
  return { store: scopeStore(store, companyId), companyId, branchId: branch?.id ?? null, user: await toCtxUser(store, u, companyId) };
}

let cnpjSeq = 0;
// CNPJs válidos de teste
const CNPJS = ["20300400000120", "20300511000136", "20300622000142", "20300733000159", "20300844000165", "20300955000171", "20301066000129", "20301177000135", "20301288000141", "20301399000158"];
const nextCnpj = () => CNPJS[cnpjSeq++];

async function partner(key: string, parent: string | null, level: any, uf = "CE") {
  const r = await createNode(platform, {
    parentNodeId: parent ? nodes[parent].id : null, level, uf, cityName: key,
    company: { name: `${key} Certificação Ltda`, tradeName: key, cnpj: nextCnpj() }, admin: { name: `Admin ${key}`, email: `${key.toLowerCase()}@rede.test` },
  });
  nodes[key] = r.node;
  companies[key] = r.company;
  return r;
}

beforeAll(async () => {
  store = freshStore();
  const plat = await createCompanyWithDefaults(store, { name: "Intercert Plataforma", kind: "certification", key: "plat" });
  const u = await store.create("users", { name: "Equipe da rede", email: "rede@intercert.test", login: "rede", status: "active", isAdmin: true, companyIds: [], branchIds: [] });
  platform = { store: scopeStore(store, plat.company.id), companyId: plat.company.id, branchId: plat.branch.id, user: await toCtxUser(store, u, plat.company.id) };
  await partner("Nordeste", null, "master");
  await partner("Ceara", "Nordeste", "regional");
  await partner("Bahia", "Nordeste", "regional", "BA");
  await partner("Juazeiro", "Ceara", "revenda");
});

describe("rede de certificação — tipo de empresa e perfis", () => {
  it("parceiro nasce enxuto, com perfis próprios e categorias de certificação", async () => {
    const c = companies.Nordeste;
    expect(c.kind).toBe("certification");
    const roles = (await store.list("roles", { filters: [["eq", "companyId", c.id]] })).items.map((r) => r.key).sort();
    expect(roles).toEqual(["partner_admin", "partner_finance", "partner_manager", "partner_seller"]);
    expect((await store.list("warehouses", { filters: [["eq", "companyId", c.id]] })).items).toHaveLength(0);
    const cats = (await store.list("fin_categories", { filters: [["eq", "companyId", c.id]] })).items.map((x) => x.name);
    expect(cats).toContain("Receita de certificados digitais");
    expect(cats).toContain("Custo de certificados (compra do nível acima)");
    expect(roleTemplatesFor("certification")).toBe(PARTNER_ROLES);
  });

  it("administrador do parceiro recebe convite com o perfil de administrador do parceiro", async () => {
    const u = (await store.list("users", { filters: [["eq", "email", "nordeste@rede.test"]] })).items[0];
    expect(u.status).toBe("invited");
    expect(u.companyIds).toEqual([companies.Nordeste.id]);
    const role = await store.get("roles", u.roleByCompany[companies.Nordeste.id]);
    expect(role!.key).toBe("partner_admin");
  });

  it("permissões: rede fora dos perfis de varejo e do escritório; filhos e preços no administrador e no gestor; ninguém recebe network.manage", () => {
    for (const r of [...DEFAULT_ROLES, ...FIRM_ROLES]) expect((r.actions as string[]).some((a) => a.startsWith("network."))).toBe(false);
    for (const r of PARTNER_ROLES) expect(r.actions as string[]).not.toContain("network.manage");
    for (const k of ["partner_admin", "partner_manager"]) expect(PARTNER_ROLES.find((r) => r.key === k)!.actions).toEqual(expect.arrayContaining(["network.children", "network.prices"]));
    // §45: o vendedor vende e acompanha as próprias renovações (não cadastra filhos nem define preços)
    expect(PARTNER_ROLES.find((r) => r.key === "partner_seller")!.actions).toEqual(["network.sell", "network.renewals"]);
    for (const a of ["network.children", "network.prices", "network.manage"]) expect(ACTIONS_ADDED_TO_TEMPLATES).toContain(a);
    // perfil de parceiro anterior às operações novas recebe-as na sincronização
    const tpl = ROLE_TEMPLATES.find((t) => t.key === "partner_manager")!;
    const plan = templateSyncPlan({ system: true, key: "partner_manager", actions: ["data.export"], templateActions: null })!;
    expect(plan.missing.sort()).toEqual(["network.children", "network.coupons", "network.finance_view", "network.prices", "network.renewals", "network.sales_all", "network.sell", "network.vouchers"]);
    expect(plan.templateActions).toEqual([...tpl.actions]);
  });

  it("recurso liga/desliga: padrão ligado na rede e nos escritórios, desligado no varejo", () => {
    expect(featureDefaultFor("redeCertificacao", "certification")).toBe(true);
    expect(featureDefaultFor("redeCertificacao", "accounting")).toBe(true);
    expect(featureDefaultFor("redeCertificacao", "retail")).toBe(false);
    expect(featureDefaultFor("redeCertificacao", null)).toBe(false);
    expect(featureDefaultFor("dre", "retail")).toBe(true);
  });
});

describe("rede de certificação — hierarquia", () => {
  it("regra de níveis: filho estritamente abaixo, pode pular níveis, contador é folha", () => {
    expect(childLevelError(null, "regional")).toBeNull();
    expect(childLevelError("master", "revenda")).toBeNull();
    expect(childLevelError("master", "contador")).toBeNull();
    expect(childLevelError("regional", "master")).toMatch(/inferior/);
    expect(childLevelError("regional", "regional")).toMatch(/inferior/);
    expect(childLevelError("contador", "contador")).toMatch(/último nível/);
  });

  it("caminho materializado, código sequencial e recusa de nível inválido", async () => {
    expect(nodes.Juazeiro.path).toEqual([nodes.Nordeste.id, nodes.Ceara.id]);
    expect(nodes.Juazeiro.depth).toBe(2);
    expect(nodes.Nordeste.code).toBe("RC-0001");
    await expect(createNode(platform, { parentNodeId: nodes.Ceara.id, level: "master", company: { name: "X Ltda" }, admin: { name: "X", email: "x@rede.test" } })).rejects.toThrow(/inferior/);
  });

  it("contador: vincula um escritório existente pelo CNPJ (uma empresa só ocupa um lugar)", async () => {
    const firm = await createCompanyWithDefaults(store, { name: "Contábil Delta Ltda", cnpj: "60746948000112", kind: "accounting", key: "firm-delta" });
    const r = await createNode(platform, { parentNodeId: nodes.Juazeiro.id, level: "contador", linkCnpj: "60.746.948/0001-12" });
    expect(r.linked).toBe(true);
    expect(r.node.nodeCompanyId).toBe(firm.company.id);
    nodes.Delta = r.node;
    await expect(createNode(platform, { parentNodeId: nodes.Ceara.id, level: "contador", linkCnpj: "60746948000112" })).rejects.toThrow(/já faz parte da rede/);
    // contador não tem filhos
    await expect(createNode(platform, { parentNodeId: nodes.Delta.id, level: "contador", linkCnpj: "60746948000112" })).rejects.toThrow(/último nível/);
    // empresa que não é escritório não entra como contador
    await expect(createNode(platform, { parentNodeId: nodes.Juazeiro.id, level: "contador", linkCnpj: companies.Bahia.cnpj })).rejects.toThrow(/não é um escritório/);
  });

  it("administrador do nó cadastra filhos só abaixo do próprio nó; vendedor não cadastra", async () => {
    const regionalAdmin = await ctxForUser("ceara@rede.test", companies.Ceara.id);
    expect(canDo(regionalAdmin.user, "network.children")).toBe(true);
    const r = await createNode(regionalAdmin, { parentNodeId: nodes.Ceara.id, level: "revenda", uf: "CE", company: { name: "Fortaleza Certificação Ltda", tradeName: "Fortaleza", cnpj: nextCnpj() }, admin: { name: "Admin Fortaleza", email: "fortaleza@rede.test" } });
    nodes.Fortaleza = r.node;
    companies.Fortaleza = r.company;
    expect(r.invite?.link).toMatch(/\/convite\//);
    // quem cadastrou não ganha acesso à empresa nova
    const me = await store.get("users", regionalAdmin.user.id);
    expect(me!.companyIds).not.toContain(r.company.id);
    await expect(createNode(regionalAdmin, { parentNodeId: nodes.Bahia.id, level: "revenda", company: { name: "Outra Ltda" }, admin: { name: "O", email: "o@rede.test" } })).rejects.toThrow(/próprio nó/);
    await expect(createNode(regionalAdmin, { parentNodeId: null, level: "revenda", company: { name: "Outra Ltda" }, admin: { name: "O", email: "o@rede.test" } })).rejects.toThrow(/plataforma/);
    // vendedor de cidade: usuário da revenda com o perfil Vendedor
    const roles = (await store.list("roles", { filters: [["eq", "companyId", companies.Juazeiro.id], ["eq", "key", "partner_seller"]] })).items;
    await store.create("users", { name: "Vendedor Juazeiro", email: "vend.jua@rede.test", status: "active", isAdmin: false, roleByCompany: { [companies.Juazeiro.id]: roles[0].id }, companyIds: [companies.Juazeiro.id], branchIds: [] });
    const seller = await ctxForUser("vend.jua@rede.test", companies.Juazeiro.id);
    await expect(createNode(seller, { parentNodeId: nodes.Juazeiro.id, level: "contador", linkCnpj: "60746948000112" })).rejects.toThrow(/Cadastrar parceiros/);
  });

  it("e-mail do administrador já usado é recusado antes de criar a empresa", async () => {
    const before = (await store.list("companies")).items.length;
    await expect(createNode(platform, { parentNodeId: nodes.Bahia.id, level: "revenda", company: { name: "Salvador Ltda", cnpj: nextCnpj() }, admin: { name: "S", email: "ceara@rede.test" } })).rejects.toThrow(/já é usado/);
    expect((await store.list("companies")).items.length).toBe(before);
  });

  it("visibilidade: o nó vê a si e aos descendentes; nunca irmãos nem ancestrais; a plataforma vê tudo", async () => {
    const regional = await ctxForUser("ceara@rede.test", companies.Ceara.id);
    const vis = await visibleNodeIds(regional);
    expect(vis.has(nodes.Ceara.id)).toBe(true);
    expect(vis.has(nodes.Juazeiro.id)).toBe(true);
    expect(vis.has(nodes.Delta.id)).toBe(true);
    expect(vis.has(nodes.Bahia.id)).toBe(false); // irmão
    expect(vis.has(nodes.Nordeste.id)).toBe(false); // ancestral
    await expect(getNode(regional, nodes.Bahia.id)).rejects.toThrow(/não encontrado/i);
    await expect(getNode(regional, nodes.Nordeste.id)).rejects.toThrow(/não encontrado/i);
    const revenda = await ctxForUser("vend.jua@rede.test", companies.Juazeiro.id);
    expect([...(await visibleNodeIds(revenda))].sort()).toEqual([nodes.Juazeiro.id, nodes.Delta.id].sort());
    expect((await visibleNodeIds(platform)).size).toBe((await networkViewer(platform)).nodes.length);
    // empresa fora da rede não vê nada
    expect(computeVisible([{ id: "a", path: [] }], null, false).size).toBe(0);
  });

  it("mover: só a plataforma, com motivo; recusa ciclo; recalcula o caminho dos descendentes", async () => {
    const regional = await ctxForUser("ceara@rede.test", companies.Ceara.id);
    await expect(moveNode(regional, nodes.Juazeiro.id, { parentNodeId: nodes.Bahia.id, reason: "Reorganização" })).rejects.toThrow(/plataforma/);
    await expect(moveNode(platform, nodes.Juazeiro.id, { parentNodeId: nodes.Bahia.id, reason: "" })).rejects.toThrow(/motivo/);
    await expect(moveNode(platform, nodes.Nordeste.id, { parentNodeId: nodes.Ceara.id, reason: "Teste de ciclo" })).rejects.toThrow(/ciclo/);
    const moved = await moveNode(platform, nodes.Juazeiro.id, { parentNodeId: nodes.Bahia.id, reason: "Revenda passa a responder à Bahia" });
    expect(moved.path).toEqual([nodes.Nordeste.id, nodes.Bahia.id]);
    const delta = await store.get("cert_network_nodes", nodes.Delta.id);
    expect(delta!.path).toEqual([nodes.Nordeste.id, nodes.Bahia.id, nodes.Juazeiro.id]);
    const hist = await nodeHistory(platform, nodes.Juazeiro.id);
    expect(hist.some((h) => h.action === "network.node_move" && h.reason === "Revenda passa a responder à Bahia")).toBe(true);
    // agora o regional do Ceará não vê mais a revenda movida
    expect((await visibleNodeIds(regional)).has(nodes.Juazeiro.id)).toBe(false);
    // volta para o Ceará (o resto dos testes usa a posição original)
    await moveNode(platform, nodes.Juazeiro.id, { parentNodeId: nodes.Ceara.id, reason: "Volta ao Ceará" });
    expect((await store.get("cert_network_nodes", nodes.Delta.id))!.path).toEqual([nodes.Nordeste.id, nodes.Ceara.id, nodes.Juazeiro.id]);
  });

  it("suspender o pai não mexe nos filhos (sinaliza); encerrar exige não ter filhos ativos", async () => {
    await setNodeStatus(platform, nodes.Ceara.id, "suspended", "Pendência contratual");
    const v = await networkViewer(platform);
    const jua = v.nodes.find((n) => n.id === nodes.Juazeiro.id)!;
    expect(jua.status).toBe("active");
    expect(blockedAncestor(v.nodes, jua)?.id).toBe(nodes.Ceara.id);
    // nó suspenso não recebe filhos
    await expect(createNode(platform, { parentNodeId: nodes.Ceara.id, level: "revenda", company: { name: "Nova Ltda" }, admin: { name: "N", email: "n@rede.test" } })).rejects.toThrow(/suspenso/);
    await setNodeStatus(platform, nodes.Ceara.id, "active");
    await expect(setNodeStatus(platform, nodes.Juazeiro.id, "closed", "Encerramento de contrato")).rejects.toThrow(/parceiro\(s\) abaixo/);
    await expect(setNodeStatus(platform, nodes.Delta.id, "suspended", "")).rejects.toThrow(/motivo/);
  });

  it("rótulos dos níveis configuráveis pela plataforma (chaves fixas)", async () => {
    const regional = await ctxForUser("ceara@rede.test", companies.Ceara.id);
    await expect(saveLevelLabels(regional, { master: "A", regional: "B", revenda: "C", contador: "D" })).rejects.toThrow();
    await saveLevelLabels(platform, { master: "Master", regional: "Regional", revenda: "Revenda", contador: "Contabilidade parceira" });
    expect((await networkSettings(store)).levelLabels.contador).toBe("Contabilidade parceira");
    await expect(saveLevelLabels(platform, { master: "Igual", regional: "Igual", revenda: "Revenda", contador: "Contador" })).rejects.toThrow(/diferentes/);
    await saveLevelLabels(platform, { master: "Master", regional: "Regional", revenda: "Revenda", contador: "Contador" });
  });
});

describe("rede de certificação — preço em cascata", () => {
  const P = "ecpf_a1_12m"; // custo AC padrão R$ 60,00
  const T = (cost: number, minPrice = 12000, defaultPrice = 15000, canEdit = true) => ({ productKey: P, cost, minPrice, defaultPrice, canEdit });

  it("catálogo padrão parecido com o InterSuite, com custo AC; BirdID não editável", async () => {
    const s = await certificationSettings(store);
    expect(s.catalog.map((p) => p.key)).toEqual(expect.arrayContaining(["ecnpj_a1_12m", "ecnpj_a3_36m", "ecpf_a1_12m", "ecpf_a3_36m", "birdid_12m"]));
    expect(s.catalog.find((p) => p.key === P)!.acCost).toBe(6000);
    expect(s.catalog.find((p) => p.key === "birdid_12m")!.editable).toBe(false);
  });

  it("salvar o catálogo sem os campos da rede (formulário antigo) preserva o custo AC", async () => {
    const s0 = await certificationSettings(store);
    const s1 = await saveCertificationSettings(platform, { catalog: s0.catalog.map(({ key, label, months, price, active }) => ({ key, label, months, price, active })) });
    expect(s1.catalog.find((p) => p.key === P)!.acCost).toBe(6000);
    expect(s1.catalog.find((p) => p.key === "birdid_12m")!.editable).toBe(false);
  });

  it("plataforma define a tabela padrão do Master: abaixo do custo AC é recusado", async () => {
    await expect(saveLevelPriceRule(platform, null, "master", T(5000))).rejects.toThrow(/margem da camada ficaria negativa/);
    await saveLevelPriceRule(platform, null, "master", T(8000));
    const e = (await effectivePrice(store, nodes.Nordeste.id, P))!;
    expect(e).toMatchObject({ cost: 8000, minPrice: 12000, defaultPrice: 15000, source: "level", parentCost: 6000, parentMargin: 2000 });
  });

  it("pai define a tabela dos filhos: custo do filho abaixo do custo do pai, mínimo abaixo do custo e padrão abaixo do mínimo são recusados", async () => {
    const master = await ctxForUser("nordeste@rede.test", companies.Nordeste.id);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "regional", T(7000))).rejects.toThrow(/abaixo do custo de Nordeste/);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "regional", T(9500, 9000, 15000))).rejects.toThrow(/mínimo .* não pode ficar abaixo do custo/);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "regional", T(9500, 12000, 11000))).rejects.toThrow(/padrão .* não pode ficar abaixo do mínimo/);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "regional", T(9500, 11000, 15000))).rejects.toThrow(/mínimo de Nordeste/);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "master", T(9500))).rejects.toThrow(/inferior/);
    await saveLevelPriceRule(master, nodes.Nordeste.id, "regional", T(9500));
    // os dois regionais herdam a tabela padrão do Master
    for (const k of ["Ceara", "Bahia"]) expect(await effectivePrice(store, nodes[k].id, P)).toMatchObject({ cost: 9500, source: "level", parentMargin: 1500 });
  });

  it("só o pai (ou a plataforma) define o preço do filho", async () => {
    const regional = await ctxForUser("ceara@rede.test", companies.Ceara.id);
    await expect(saveNodePriceRule(regional, nodes.Ceara.id, T(9600))).rejects.toThrow(/parceiro de cima/);
    await expect(saveNodePriceRule(regional, nodes.Bahia.id, T(9600))).rejects.toThrow(/parceiro de cima/);
    const seller = await ctxForUser("vend.jua@rede.test", companies.Juazeiro.id);
    await expect(saveLevelPriceRule(seller, nodes.Juazeiro.id, "contador", T(12000))).rejects.toThrow(/parceiro de cima/);
  });

  it("exceção por filho sobrepõe a tabela padrão; retirar a exceção volta à tabela", async () => {
    const master = await ctxForUser("nordeste@rede.test", companies.Nordeste.id);
    await saveNodePriceRule(master, nodes.Bahia.id, T(10000, 12500, 16000));
    expect(await effectivePrice(store, nodes.Bahia.id, P)).toMatchObject({ cost: 10000, minPrice: 12500, source: "node", parentMargin: 2000 });
    expect(await effectivePrice(store, nodes.Ceara.id, P)).toMatchObject({ cost: 9500, source: "level" });
    await clearNodePriceRule(master, nodes.Bahia.id, P, "Volta à tabela");
    expect(await effectivePrice(store, nodes.Bahia.id, P)).toMatchObject({ cost: 9500, source: "level" });
  });

  it("cascata completa até o contador e herança da tabela padrão do pai", async () => {
    const regional = await ctxForUser("ceara@rede.test", companies.Ceara.id);
    await saveLevelPriceRule(regional, nodes.Ceara.id, "revenda", T(11000));
    const revenda = await ctxForUser("juazeiro@rede.test", companies.Juazeiro.id);
    await expect(saveLevelPriceRule(revenda, nodes.Juazeiro.id, "contador", T(10500))).rejects.toThrow(/negativa/);
    await saveLevelPriceRule(revenda, nodes.Juazeiro.id, "contador", T(12000));
    expect(await effectivePrice(store, nodes.Delta.id, P)).toMatchObject({ cost: 12000, minPrice: 12000, defaultPrice: 15000, parentCost: 11000, parentMargin: 1000 });
    // sem regra nenhuma: sem preço
    expect(await effectivePrice(store, nodes.Delta.id, "ecnpj_a3_36m")).toBeNull();
  });

  it("subir o custo do pai acima do custo dos filhos é recusado (a margem de baixo não pode ficar negativa)", async () => {
    await expect(saveLevelPriceRule(platform, null, "master", T(10000))).rejects.toThrow(/Tabela padrão de Nordeste/);
    const master = await ctxForUser("nordeste@rede.test", companies.Nordeste.id);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "regional", T(11500))).rejects.toThrow(/Tabela padrão de Ceara/);
  });

  it("produto não editável no pai não fica editável no filho", async () => {
    const B = "birdid_12m";
    await expect(saveLevelPriceRule(platform, null, "master", { productKey: B, cost: 5500, minPrice: 9900, defaultPrice: 9900, canEdit: true })).rejects.toThrow(/não é editável/);
    await saveLevelPriceRule(platform, null, "master", { productKey: B, cost: 5500, minPrice: 9900, defaultPrice: 9900, canEdit: false });
    const master = await ctxForUser("nordeste@rede.test", companies.Nordeste.id);
    await expect(saveLevelPriceRule(master, nodes.Nordeste.id, "regional", { productKey: B, cost: 6500, minPrice: 9900, defaultPrice: 9900, canEdit: true })).rejects.toThrow(/não é editável/);
    await saveLevelPriceRule(master, nodes.Nordeste.id, "regional", { productKey: B, cost: 6500, minPrice: 9900, defaultPrice: 9900, canEdit: false });
    expect(await effectivePrice(store, nodes.Ceara.id, B)).toMatchObject({ canEdit: false, cost: 6500 });
  });

  it("vigência: regra futura encerra a anterior na véspera; histórico preservado; retroativo recusado; mesmo dia substitui", async () => {
    const master = await ctxForUser("nordeste@rede.test", companies.Nordeste.id);
    const future = addDays(today(), 10);
    await expect(saveNodePriceRule(master, nodes.Bahia.id, { ...T(9800), validFrom: addDays(today(), -1) })).rejects.toThrow(/histórico/);
    await saveNodePriceRule(master, nodes.Bahia.id, T(9700));
    await saveNodePriceRule(master, nodes.Bahia.id, { ...T(9900), validFrom: future });
    expect((await effectivePrice(store, nodes.Bahia.id, P))!.cost).toBe(9700);
    expect((await effectivePrice(store, nodes.Bahia.id, P, future))!.cost).toBe(9900);
    const hist = await nodeRuleHistory(store, nodes.Bahia.id);
    const current = hist.find((r) => r.cost === 9700)!;
    expect(current.validTo).toBe(addDays(future, -1));
    // regra anterior à futura não pode ser criada depois dela
    await expect(saveNodePriceRule(master, nodes.Bahia.id, { ...T(9750), validFrom: addDays(today(), 5) })).rejects.toThrow(/vigência futura/);
    // no mesmo dia, substitui (a substituída fica no histórico, inativa)
    await saveNodePriceRule(master, nodes.Bahia.id, { ...T(9950), validFrom: future });
    expect((await effectivePrice(store, nodes.Bahia.id, P, future))!.cost).toBe(9950);
    const all = await nodeRuleHistory(store, nodes.Bahia.id);
    expect(all.find((r) => r.cost === 9900)!.active).toBe(false);
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("resolução pura: exceção do nó primeiro, depois a tabela do pai para o nível; erros de regra", () => {
    const d = today();
    const rules: any[] = [
      { id: "l", scope: "level", ownerNodeId: "p", level: "revenda", productKey: "x", cost: 1, minPrice: 2, defaultPrice: 3, canEdit: true, validFrom: d, validTo: null, active: true, createdAt: "1" },
      { id: "n", scope: "node", nodeId: "c", productKey: "x", cost: 2, minPrice: 2, defaultPrice: 3, canEdit: true, validFrom: d, validTo: null, active: true, createdAt: "2" },
    ];
    expect(resolveRule(rules, { id: "c", parentNodeId: "p", level: "revenda" }, "x", d)!.id).toBe("n");
    expect(resolveRule(rules, { id: "c2", parentNodeId: "p", level: "revenda" }, "x", d)!.id).toBe("l");
    expect(resolveRule(rules, { id: "c3", parentNodeId: "p", level: "contador" }, "x", d)).toBeNull();
    expect(ruleErrors({ cost: 100, minPrice: 100, defaultPrice: 100, canEdit: false }, { cost: 100, minPrice: 0, defaultPrice: 0, canEdit: false })).toEqual([]);
  });

  it("tabela padrão por nível com histórico e auditoria; sem alertas de preço na camada", async () => {
    const t = await levelPriceTable(store, nodes.Nordeste.id, ["regional", "revenda", "contador"]);
    expect(t.rows.find((r) => r.level === "regional" && r.product.key === P)!.current!.cost).toBe(9500);
    expect(t.history.length).toBeGreaterThan(0);
    expect(await priceAlerts(store, nodes.Nordeste.id)).toEqual([]);
    const hist = await nodeHistory(platform, nodes.Bahia.id);
    expect(hist.some((h) => h.action === "network.price_rule")).toBe(true);
    // a empresa do nó também recebe o evento no histórico dela
    const own = (await store.list("audit_logs", { filters: [["eq", "companyId", companies.Bahia.id], ["eq", "action", "network.price_rule"]] })).items;
    expect(own.length).toBeGreaterThan(0);
  });

  it("mover o nó encerra as exceções do pai anterior (passa a herdar a tabela do novo pai)", async () => {
    // Bahia tem exceção vigente; ao subir para direto abaixo da Intercert, passa a valer a tabela da plataforma para regionais (sem regra = sem preço)
    await moveNode(platform, nodes.Bahia.id, { parentNodeId: null, reason: "Regional passa a responder direto à Intercert" });
    expect(await effectivePrice(store, nodes.Bahia.id, P)).toBeNull();
    await saveLevelPriceRule(platform, null, "regional", T(9000));
    expect(await effectivePrice(store, nodes.Bahia.id, P)).toMatchObject({ cost: 9000, parentCost: 6000, source: "level" });
  });
});
