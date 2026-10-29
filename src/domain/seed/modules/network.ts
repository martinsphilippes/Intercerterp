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
import { addDays, today } from "@/lib/dates";
import {
  NETWORK_SCOPE, createNode, nodeOfCompany, saveLevelPriceRule, saveCertCustomer, createNetworkSale, createCoupon, createVoucherPackage, purchaseVoucherPackage, registerRenewalContact, type NetworkLevel,
  savePlatformFinance, saveBillingAgreement, requestRecharge, confirmRecharge, closeRelation, flowKey,
} from "../../network";
import { approveCertificateValidation, confirmCertificatePayment, recordCertificateAuthorization, registerCertificateEmission, requestCertificateEmission, sendCertificateCharge } from "../../accounting/certificates";

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
  const billing = await seedBilling(store, platform, plat.company.id, nodes, admins, ctxOf);
  const sales = await seedSales(store, platform, nodes, admins, ctxOf);
  return { platformCompanyId: plat.company.id, partners: PARTNERS.length, contador: Boolean(firm), rules, billing, sales };
}

// ------------------------------------------------------------------------------------------------ etapa 3 (§46)

/**
 * Financeiro em camadas da demonstração (§46; marcador "demo.network.billing.done", roda antes das vendas para que
 * elas já nasçam com a modalidade): empresa da Intercert definida; Intercert → Master e Master → Regionais pós-pago
 * mensal; Regional Ceará → Revenda Juazeiro PRÉ-PAGO (recarga de R$ 1.000 confirmada; aviso abaixo de R$ 200; indicação
 * de 10% ao contador); Regional Ceará → Revenda Fortaleza PÓS-PAGO QUINZENAL (vencimento em 7 dias); Regional Bahia →
 * Revenda Salvador COMISSIONADO POR SPLIT. As vendas da demonstração geram os débitos, os acúmulos, o split e o custo AC.
 */
async function seedBilling(store: Store, platform: Ctx, platformCompanyId: string, nodes: Record<string, Doc>, admins: Record<string, Doc>, ctxOf: (u: Doc, companyId: string) => Promise<Ctx>): Promise<unknown> {
  if (await getSetting(store, NETWORK_SCOPE, null, "demo.network.billing.done", false)) return { skipped: true };
  const adminCtx = async (k: string) => ctxOf(admins[k], nodes[k].nodeCompanyId);
  await savePlatformFinance(platform, { platformCompanyId, acClosingDay: 1, acDueDays: 15 });
  const reason = "Condição comercial de demonstração";
  await saveBillingAgreement(platform, nodes.master.id, { mode: "postpaid", period: "monthly", monthDay: 1, dueDays: 10, reason });
  const master = await adminCtx("master");
  for (const k of ["ceara", "bahia"]) await saveBillingAgreement(master, nodes[k].id, { mode: "postpaid", period: "monthly", monthDay: 1, dueDays: 10, reason });
  const ceara = await adminCtx("ceara");
  await saveBillingAgreement(ceara, nodes.juazeiro.id, { mode: "prepaid", overdraftLimit: 0, lowBalanceAlert: 20000, referralKind: "percent", referralBps: 1000, reason });
  await saveBillingAgreement(ceara, nodes.fortaleza.id, { mode: "postpaid", period: "biweekly", dueDays: 7, reason });
  await saveBillingAgreement(await adminCtx("bahia"), nodes.salvador.id, { mode: "commission", commissionSettlement: "split", commissionRule: "margin", reason });
  const rc = await requestRecharge(ceara, nodes.juazeiro.id, { amount: 100000, idemKey: "demo-recarga-juazeiro" });
  await confirmRecharge(ceara, rc.id, { ref: "PIX-DEMO-RECARGA-01" });
  await setSetting(store, NETWORK_SCOPE, null, "demo.network.billing.done", true);
  return { agreements: 6, recharge: rc.code };
}

// ------------------------------------------------------------------------------------------------ etapa 2 (§45)

/** CPF/CNPJ válidos a partir da base (dígitos verificadores calculados). */
function withCheckDigits(base: string, weights: number[][]): string {
  let doc = base;
  for (const w of weights) {
    const sum = w.reduce((a, k, i) => a + k * Number(doc[i]), 0);
    const r = sum % 11;
    doc += String(r < 2 ? 0 : 11 - r);
  }
  return doc;
}
const cpf = (base9: string) => withCheckDigits(base9, [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]]);
const cnpj = (base12: string) => withCheckDigits(base12, [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]);

/**
 * Vendas da rede para a demonstração (§45; marcador "demo.network.sales.done"): clientes de certificado em cada
 * revenda; vendas pagas, em validação e emitidas; um pacote de vouchers da Regional Ceará comprado pela Revenda
 * Juazeiro com parte resgatada; dois cupons (um do próprio nó, outro de nível acima); BirdID gratuitos; e
 * certificados vencendo em 7/30/60 dias, vencido e perdido, com e sem contato registrado.
 */
async function seedSales(store: Store, platform: Ctx, nodes: Record<string, Doc>, admins: Record<string, Doc>, ctxOf: (u: Doc, companyId: string) => Promise<Ctx>): Promise<unknown> {
  if (await getSetting(store, NETWORK_SCOPE, null, "demo.network.sales.done", false)) return { skipped: true };
  const t = today();
  const user = async (login: string) => (await findOne(store, "users", [["eq", "login", login]]))!;
  const adminCtx = async (k: string) => ctxOf(admins[k], nodes[k].nodeCompanyId);
  const sellerCtx = async (k: string, login: string) => ctxOf(await user(login), nodes[k].nodeCompanyId);
  const team = platform; // a plataforma de demonstração também opera a certificação

  // cupons: um da própria revenda (10%, 1 por titular) e um da Regional Ceará para Fortaleza (R$ 20 — nível acima absorve)
  const juaAdmin = await adminCtx("juazeiro");
  await createCoupon(juaAdmin, { code: "JUAZEIRO10", kind: "percent", valueBps: 1000, validTo: addDays(t, 90), maxUses: 50, maxPerHolder: 1, notes: "Campanha do Cariri (DEMO)" });
  await createCoupon(await adminCtx("ceara"), { code: "CEARA20", kind: "fixed", valueCents: 2000, nodeId: nodes.fortaleza.id, validTo: addDays(t, 60), maxUses: 20, notes: "Desconto da Regional para Fortaleza (DEMO)" });

  // pacote de vouchers: Regional Ceará → Revenda Juazeiro (10 e-CPF A1 a R$ 105, abaixo do custo normal de R$ 110)
  const pkg = await createVoucherPackage(await adminCtx("ceara"), { name: "Pacote Cariri — 10 e-CPF A1 (DEMO)", validTo: addDays(t, 180), items: [{ productKey: "ecpf_a1_12m", qty: 10, unitPrice: 10500 }], recipientNodeId: nodes.juazeiro.id });
  await purchaseVoucherPackage(juaAdmin, pkg.id, { idemKey: "demo-pacote-cariri" });

  const demoFile = { name: "certificado_DEMO.pfx", data: Buffer.from("DEMO — arquivo de demonstração, sem validade") };
  const customers: Record<string, Doc> = {};
  const mkCustomer = async (ctx: Ctx, key: string, input: Parameters<typeof saveCertCustomer>[2]) => {
    customers[key] = await saveCertCustomer(ctx, null, input);
    return customers[key];
  };
  type Step = "awaiting" | "paid" | "issued";
  const sale = async (ctx: Ctx, key: string, customer: Doc, productKey: string, step: Step, extra: Record<string, any> = {}) => {
    let r = await createNetworkSale(ctx, { customerId: customer.id, productKey, idemKey: `demo-${key}`, dueDate: addDays(t, 5), ...extra });
    if (r.status === "awaiting_payment") {
      await sendCertificateCharge(ctx, r.id, { channel: "whatsapp", to: customer.phone ?? "88999990000" });
      if (step === "awaiting") return r;
      r = await confirmCertificatePayment(team, r.id, { ref: `PIX-DEMO-${key.toUpperCase()}` });
    }
    if (step === "paid") return r;
    await approveCertificateValidation(team, r.id, { notes: "Videoconferência (DEMO)" });
    await requestCertificateEmission(ctx, r.id);
    const months = Number(r.months ?? 12);
    r = await registerCertificateEmission(team, r.id, { file: demoFile, validFrom: t, validTo: addDays(t, Math.round(months * 30.4)), serial: `DEMO-${key.toUpperCase()}` });
    r = await recordCertificateAuthorization(ctx, r.id, { notes: "Titular autorizou a entrega pelo WhatsApp (DEMO)" });
    return r;
  };

  // Juazeiro do Norte
  const jua = await sellerCtx("juazeiro", "vendedor.juazeiro");
  await mkCustomer(jua, "ana", { personType: "PF", doc: cpf("123456781"), name: "Ana Beatriz Lima (DEMO)", email: "ana.lima@demo.local", phone: "88988110001", address: { cityName: "Juazeiro do Norte", uf: "CE" } });
  await mkCustomer(jua, "bruno", { personType: "PF", doc: cpf("234567892"), name: "Bruno Cariri Souza (DEMO)", phone: "88988110002" });
  await mkCustomer(jua, "farmacia", { personType: "PJ", doc: cnpj("123456780001"), name: "Farmácia do Romeiro Ltda (DEMO)", email: "contato@farmaciaromeiro.local", phone: "8835110003" });
  await mkCustomer(jua, "carla", { personType: "PF", doc: cpf("345678903"), name: "Carla Padre Cícero (DEMO)", phone: "88988110004" });
  await sale(jua, "jua-1", customers.ana, "ecpf_a1_12m", "awaiting");
  await sale(jua, "jua-2", customers.bruno, "ecpf_a1_12m", "issued", { voucher: "balance" });
  // §46: o escritório contador abaixo de Juazeiro indicou a farmácia (comissão de indicação de 10%)
  const firmNode = (await findOne(store, "cert_network_nodes", [["eq", "parentNodeId", nodes.juazeiro.id], ["eq", "level", "contador"]])) ?? null;
  await sale(jua, "jua-3", customers.farmacia, "ecnpj_a1_12m", "paid", { couponCode: "JUAZEIRO10", ...(firmNode ? { referrerNodeId: firmNode.id } : {}) });
  await sale(jua, "jua-4", customers.carla, "birdid_free_60m", "issued");
  await sale(jua, "jua-5", customers.carla, "ecpf_a1_12m", "paid", { voucher: "balance" });

  // Fortaleza
  const ftz = await sellerCtx("fortaleza", "vendedor.fortaleza");
  await mkCustomer(ftz, "diego", { personType: "PF", doc: cpf("456789014"), name: "Diego Beira-Mar (DEMO)", phone: "85988220001" });
  await mkCustomer(ftz, "padaria", { personType: "PJ", doc: cnpj("234567890001"), name: "Padaria Aldeota Ltda (DEMO)", phone: "8532220002", email: "fiscal@padariaaldeota.local" });
  await mkCustomer(ftz, "elisa", { personType: "PF", doc: cpf("567890125"), name: "Elisa Iracema (DEMO)", phone: "85988220003", hasBirdId: true, birdIdValidTo: addDays(t, 900) });
  await sale(ftz, "ftz-1", customers.diego, "ecpf_a1_12m", "awaiting", { couponCode: "CEARA20" });
  await sale(ftz, "ftz-2", customers.padaria, "ecnpj_a3_36m", "issued");
  // §46: pós-pago quinzenal — um fechamento feito agora (a venda da padaria) e o período seguinte aberto (a da Elisa)
  const cearaCtx = await adminCtx("ceara");
  await closeRelation(cearaCtx, flowKey("cost", { type: "node", nodeId: nodes.fortaleza.id, name: "" }, { type: "node", nodeId: nodes.ceara.id, name: "" }), t, { manual: true });
  await sale(ftz, "ftz-3", customers.elisa, "ecpf_a3_36m", "paid");

  // Salvador
  const ssa = await sellerCtx("salvador", "vendedor.salvador");
  await mkCustomer(ssa, "fabio", { personType: "PF", doc: cpf("678901236"), name: "Fábio Pelourinho (DEMO)", phone: "71988330001" });
  await mkCustomer(ssa, "acaraje", { personType: "PJ", doc: cnpj("345678900001"), name: "Acarajé da Barra Ltda (DEMO)", phone: "7133330002" });
  await mkCustomer(ssa, "gabi", { personType: "PF", doc: cpf("789012347"), name: "Gabriela Itapuã (DEMO)", phone: "71988330003" });
  await sale(ssa, "ssa-1", customers.fabio, "ecpf_a1_12m", "awaiting");
  await sale(ssa, "ssa-2", customers.acaraje, "ecnpj_a1_12m", "issued");
  await sale(ssa, "ssa-3", customers.gabi, "birdid_free_60m", "paid");

  // certificados de vendas anteriores (renovações): vencendo em 7/30/60 dias, vencido e perdido; com e sem contato
  const old = async (node: Doc, c: Doc, productKey: string, productLabel: string, validTo: string, sellerLogin: string) => {
    const seller = await user(sellerLogin);
    return store.create("accounting_certificates", {
      companyId: node.nodeCompanyId, branchId: null, createdBy: seller.id, clientId: c.id, customerId: c.id, holderName: c.name, holderDoc: c.doc, product: productKey, productLabel,
      serial: null, issuer: "AC Intercert (DEMO)", validFrom: addDays(validTo, -365), validTo, source: "issued", requestId: null, fileId: null, notes: "Venda anterior (DEMO)", active: true,
      channel: "network", sellerNodeId: node.id, sellerUserId: seller.id, productType: productKey.includes("a3") ? "a3" : "a1", holderType: c.personType === "PF" ? "pf" : "pj", isDemo: true,
    });
  };
  await mkCustomer(jua, "hugo", { personType: "PF", doc: cpf("890123458"), name: "Hugo Crato (DEMO)", phone: "88988110005" });
  await mkCustomer(jua, "iris", { personType: "PF", doc: cpf("901234569"), name: "Íris Barbalha (DEMO)", phone: "88988110006" });
  await mkCustomer(ftz, "joao", { personType: "PF", doc: cpf("112233445"), name: "João Mucuripe (DEMO)", phone: "85988220004" });
  await mkCustomer(ftz, "mercado", { personType: "PJ", doc: cnpj("456789010001"), name: "Mercadinho Benfica Ltda (DEMO)", phone: "8532220005" });
  await mkCustomer(ssa, "karla", { personType: "PF", doc: cpf("223344556"), name: "Karla Rio Vermelho (DEMO)", phone: "71988330004" });
  await old(nodes.juazeiro, customers.hugo, "ecpf_a1_12m", "e-CPF A1 · 12 meses", addDays(t, 7), "vendedor.juazeiro");
  const c30 = await old(nodes.juazeiro, customers.iris, "ecpf_a1_12m", "e-CPF A1 · 12 meses", addDays(t, 30), "vendedor.juazeiro");
  await old(nodes.fortaleza, customers.joao, "ecpf_a1_12m", "e-CPF A1 · 12 meses", addDays(t, 60), "vendedor.fortaleza");
  const vencido = await old(nodes.fortaleza, customers.mercado, "ecnpj_a1_12m", "e-CNPJ A1 · 12 meses", addDays(t, -10), "vendedor.fortaleza");
  await old(nodes.salvador, customers.karla, "ecpf_a1_12m", "e-CPF A1 · 12 meses", addDays(t, -45), "vendedor.salvador");
  await old(nodes.salvador, customers.fabio, "ecpf_a1_12m", "e-CPF A1 · 12 meses", addDays(t, 5), "vendedor.salvador");
  // contato registrado no de 30 dias e no vencido; o de 7 dias (Hugo) fica sem ação — alerta "ninguém agiu"
  await registerRenewalContact(jua, c30.id, { channel: "whatsapp", result: "will_renew", nextAction: "Enviar o link da renovação", nextActionDate: addDays(t, 3) });
  await registerRenewalContact(ftz, vencido.id, { channel: "phone", result: "thinking", notes: "Pediu para ligar na próxima semana" });
  await setSetting(store, NETWORK_SCOPE, null, "demo.network.sales.done", true);
  return { customers: Object.keys(customers).length, sales: 11 };
}
