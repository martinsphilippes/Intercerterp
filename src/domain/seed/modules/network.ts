import type { DemoRefs } from "../base";
import { DEMO_PASSWORD, Seeder } from "../base";
import { findOne } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import { getAuth } from "@/lib/auth/provider";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { getSetting, setSetting } from "@/lib/core/settings";
import { PARTNER_ROLES } from "@/lib/permissions";
import { createCompanyWithDefaults } from "../../setup";
import { NETWORK_SCOPE, createNode, nodeOfCompany, saveLevelPriceRule, type NetworkLevel } from "../../network";

/**
 * Demonstração da REDE DE CERTIFICAÇÃO (§43) — depende dos módulos "accounting" e "certificates":
 *  - empresa da plataforma "Intercert Certificação Digital (DEMO)" com o usuário "rede" (gestão de toda a rede);
 *  - Master "Rede Nordeste" → Regionais Ceará e Bahia → Revendas Juazeiro do Norte e Fortaleza (Ceará) e Salvador (Bahia),
 *    cada uma com um vendedor de cidade; o escritório de demonstração (Contábil Horizonte) como Contador abaixo de Juazeiro;
 *  - tabela de preços coerente em cascata (ex.: e-CPF A1: custo AC R$ 60, Master R$ 80, Regional R$ 95, Revenda R$ 110,
 *    Contador R$ 120, mínimo ao cliente final R$ 120, padrão R$ 150), cada camada definida pelo parceiro de cima.
 * Idempotente (marcador "demo.network.done" e verificação de cada parceiro pelo CNPJ).
 */

const PLATFORM_CNPJ = "20301510000106";

/** custos por camada (centavos): [Master, Regional, Revenda, Contador], mínimo e padrão ao cliente final */
const PRICES: Record<string, { costs: [number, number, number, number]; min: number; def: number; canEdit: boolean }> = {
  ecnpj_a1_12m: { costs: [12000, 14000, 16000, 17500], min: 17500, def: 19900, canEdit: true },
  ecnpj_a3_36m: { costs: [19000, 21500, 24000, 26000], min: 26000, def: 33000, canEdit: true },
  ecpf_a1_12m: { costs: [8000, 9500, 11000, 12000], min: 12000, def: 15000, canEdit: true },
  ecpf_a3_36m: { costs: [14000, 16000, 18000, 19500], min: 19500, def: 25000, canEdit: true },
  birdid_12m: { costs: [5500, 6500, 7500, 8500], min: 9900, def: 9900, canEdit: false },
};

interface PartnerDef {
  key: string;
  parent: string | null;
  level: NetworkLevel;
  name: string;
  tradeName: string;
  cnpj: string;
  city: string;
  uf: string;
  region: string;
  admin: { name: string; login: string };
  seller?: { name: string; login: string };
}

const PARTNERS: PartnerDef[] = [
  { key: "master", parent: null, level: "master", name: "Rede Nordeste Certificação Digital Ltda (DEMO)", tradeName: "Rede Nordeste (DEMO)", cnpj: "20301621000112", city: "Recife", uf: "PE", region: "Nordeste", admin: { name: "Marcos Master", login: "master" } },
  { key: "ceara", parent: "master", level: "regional", name: "Regional Ceará Certificação Ltda (DEMO)", tradeName: "Regional Ceará (DEMO)", cnpj: "20301732000129", city: "Fortaleza", uf: "CE", region: "Ceará", admin: { name: "Clara Regional", login: "regional.ce" } },
  { key: "bahia", parent: "master", level: "regional", name: "Regional Bahia Certificação Ltda (DEMO)", tradeName: "Regional Bahia (DEMO)", cnpj: "20301843000135", city: "Salvador", uf: "BA", region: "Bahia", admin: { name: "Bruno Regional", login: "regional.ba" } },
  { key: "juazeiro", parent: "ceara", level: "revenda", name: "Revenda Juazeiro do Norte Ltda (DEMO)", tradeName: "Revenda Juazeiro do Norte (DEMO)", cnpj: "20301954000141", city: "Juazeiro do Norte", uf: "CE", region: "Cariri", admin: { name: "Joana Revenda", login: "revenda.juazeiro" }, seller: { name: "Vítor Vendedor (Juazeiro)", login: "vendedor.juazeiro" } },
  { key: "fortaleza", parent: "ceara", level: "revenda", name: "Revenda Fortaleza Ltda (DEMO)", tradeName: "Revenda Fortaleza (DEMO)", cnpj: "20302065000107", city: "Fortaleza", uf: "CE", region: "Metropolitana", admin: { name: "Fábio Revenda", login: "revenda.fortaleza" }, seller: { name: "Vera Vendedora (Fortaleza)", login: "vendedor.fortaleza" } },
  { key: "salvador", parent: "bahia", level: "revenda", name: "Revenda Salvador Ltda (DEMO)", tradeName: "Revenda Salvador (DEMO)", cnpj: "20302176000105", city: "Salvador", uf: "BA", region: "Metropolitana", admin: { name: "Sara Revenda", login: "revenda.salvador" }, seller: { name: "Valter Vendedor (Salvador)", login: "vendedor.salvador" } },
];

async function activateDemoUser(store: Store, u: Doc, login: string): Promise<Doc> {
  let doc = u;
  if (!doc.authId) doc = await store.update("users", doc.id, { authId: await getAuth().createUser(doc.email, DEMO_PASSWORD, doc.name) });
  if (doc.status !== "active" || !doc.isDemo) doc = await store.update("users", doc.id, { status: "active", login, isDemo: true, inviteTokenHash: null, inviteExpiresAt: null, firstAccessAt: doc.firstAccessAt ?? new Date().toISOString() });
  return doc;
}

export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const sd = new Seeder(store);
  if (await getSetting(store, NETWORK_SCOPE, null, "demo.network.done", false)) return { skipped: true };

  // empresa da plataforma e usuário com "Gerir toda a rede"
  const plat = await createCompanyWithDefaults(store, { name: "Intercert Certificação Digital Ltda (DEMO)", tradeName: "Intercert Certificação (DEMO)", cnpj: PLATFORM_CNPJ, uf: "CE", cityName: "Juazeiro do Norte", cityCode: "2307304", kind: "certification", key: "demo-intercert-platform" });
  if (!plat.company.isDemo) await store.update("companies", plat.company.id, { isDemo: true });
  const tpl = PARTNER_ROLES.find((r) => r.key === "partner_admin")!;
  const platformRole = await sd.put("roles", "rede-plataforma", {
    companyId: plat.company.id, isDemo: true, key: null, name: "Gestão da rede Intercert (DEMO)", description: "Plataforma: cria, move, suspende e encerra parceiros e define os preços de toda a rede.",
    permissions: tpl.permissions, actions: [...tpl.actions, "network.manage", "certification.operate"], discountLimitBps: 0, system: false, active: true,
  });
  let platUser = await store.get("users", sd.id("users", "rede"));
  if (!platUser) platUser = await sd.put("users", "rede", { name: "Renata Rede", email: "rede@demo.intercert.local", login: "rede", status: "active", roleId: platformRole.id, roleByCompany: { [plat.company.id]: platformRole.id }, isAdmin: false, companyIds: [plat.company.id], branchIds: [], isDemo: true, firstAccessAt: new Date().toISOString() });
  platUser = await activateDemoUser(store, platUser, "rede");
  const ctxOf = async (u: Doc, companyId: string): Promise<Ctx> => {
    const branch = await findOne(store, "branches", [["eq", "companyId", companyId]]);
    return { store: scopeStore(store, companyId), companyId, branchId: branch?.id ?? null, user: await toCtxUser(store, u, companyId) };
  };
  const platform = await ctxOf(platUser, plat.company.id);

  const nodes: Record<string, Doc> = {};
  const admins: Record<string, Doc> = {};
  for (const p of PARTNERS) {
    const email = `${p.admin.login}@demo.intercert.local`;
    let company = await findOne(store, "companies", [["eq", "cnpj", p.cnpj]]);
    let node = company ? await nodeOfCompany(store, company.id) : null;
    if (!node) {
      const r = await createNode(platform, {
        parentNodeId: p.parent ? nodes[p.parent].id : null, level: p.level, cityName: p.city, uf: p.uf, region: p.region, commercialResponsible: "Renata Rede",
        company: { name: p.name, tradeName: p.tradeName, cnpj: p.cnpj, email, address: { cityName: p.city, uf: p.uf } }, admin: { name: p.admin.name, email, login: p.admin.login },
      });
      node = r.node;
      company = r.company;
    }
    await store.update("companies", company!.id, { isDemo: true });
    nodes[p.key] = node;
    const admin = (await findOne(store, "users", [["eq", "email", email]]))!;
    admins[p.key] = await activateDemoUser(store, admin, p.admin.login);
    if (p.seller) {
      const sellerRole = await findOne(store, "roles", [["eq", "companyId", company!.id], ["eq", "key", "partner_seller"]]);
      let seller = await store.get("users", sd.id("users", p.seller.login));
      if (!seller) seller = await sd.put("users", p.seller.login, { name: p.seller.name, email: `${p.seller.login}@demo.intercert.local`, login: p.seller.login, status: "active", roleId: sellerRole!.id, roleByCompany: { [company!.id]: sellerRole!.id }, isAdmin: false, companyIds: [company!.id], branchIds: [], isDemo: true, firstAccessAt: new Date().toISOString() });
      await activateDemoUser(store, seller, p.seller.login);
    }
  }

  // escritório de demonstração como Contador abaixo da Revenda Juazeiro do Norte
  const firm = await findOne(store, "companies", [["eq", "cnpj", "33444555000170"]]);
  if (firm && !(await nodeOfCompany(store, firm.id))) await createNode(platform, { parentNodeId: nodes.juazeiro.id, level: "contador", linkCnpj: firm.cnpj, cityName: "São Paulo", uf: "SP", region: "Sudeste" });

  // preços em cascata: cada camada definida pelo parceiro de cima
  const owners: Array<{ ctx: Ctx; owner: string | null; level: NetworkLevel; idx: 0 | 1 | 2 | 3 }> = [
    { ctx: platform, owner: null, level: "master", idx: 0 },
    { ctx: await ctxOf(admins.master, nodes.master.nodeCompanyId), owner: "master", level: "regional", idx: 1 },
    { ctx: await ctxOf(admins.ceara, nodes.ceara.nodeCompanyId), owner: "ceara", level: "revenda", idx: 2 },
    { ctx: await ctxOf(admins.bahia, nodes.bahia.nodeCompanyId), owner: "bahia", level: "revenda", idx: 2 },
    { ctx: await ctxOf(admins.juazeiro, nodes.juazeiro.nodeCompanyId), owner: "juazeiro", level: "contador", idx: 3 },
    { ctx: await ctxOf(admins.fortaleza, nodes.fortaleza.nodeCompanyId), owner: "fortaleza", level: "contador", idx: 3 },
    { ctx: await ctxOf(admins.salvador, nodes.salvador.nodeCompanyId), owner: "salvador", level: "contador", idx: 3 },
  ];
  let rules = 0;
  for (const o of owners) {
    for (const [productKey, p] of Object.entries(PRICES)) {
      await saveLevelPriceRule(o.ctx, o.owner ? nodes[o.owner].id : null, o.level, { productKey, cost: p.costs[o.idx], minPrice: p.min, defaultPrice: p.def, canEdit: p.canEdit, reason: "Tabela de demonstração" });
      rules++;
    }
  }

  await setSetting(store, NETWORK_SCOPE, null, "demo.network.done", true);
  return { platformCompanyId: plat.company.id, partners: PARTNERS.length, contador: Boolean(firm), rules };
}
