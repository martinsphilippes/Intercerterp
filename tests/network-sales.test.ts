import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import type { MemoryStore } from "@/lib/db/memory-store";
import { listAll } from "@/lib/db";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import { addDays, today } from "@/lib/dates";
import { PARTNER_ROLES, ROLE_TEMPLATES } from "@/lib/permissions";
import { ACTIONS_ADDED_TO_TEMPLATES, templateSyncPlan } from "@/lib/auth/role-sync";
import {
  createNode, saveLevelPriceRule, maskCascade, quotePrice, couponDiscount, levelEarnings, saveCertCustomer, listCertCustomers, createNetworkSale, listNetworkSales, getNetworkSale, findDuplicates,
  createCoupon, setCouponActive, listCoupons, createVoucherPackage, purchaseVoucherPackage, voucherBalances, issueVoucherCode, cancelVoucherCode, lotBalance,
  saleCascade, sellerView, renewalSituation, renewalWorld, renewalPanel, registerRenewalContact, notifyRenewalAlerts, idleCandidate, type CascadeSnapshot,
} from "@/domain/network";
import {
  cancelCertificateRequest, confirmCertificatePayment, approveCertificateValidation, requestCertificateEmission, registerCertificateEmission, recordCertificateAuthorization, createClient, createCertificateRequest, certificationSettings,
} from "@/domain/accounting";

let store: MemoryStore;
let platform: Ctx;
const nodes: Record<string, any> = {};
const companies: Record<string, any> = {};
const ctxs: Record<string, Ctx> = {};

function digits(base: string, weights: number[][]) {
  let d = base;
  for (const w of weights) {
    const r = w.reduce((a, k, i) => a + k * Number(d[i]), 0) % 11;
    d += String(r < 2 ? 0 : 11 - r);
  }
  return d;
}
const cpf = (b: string) => digits(b, [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]]);
const cnpj = (b: string) => digits(b, [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]);
let docSeq = 100000000;
const nextCpf = () => cpf(String(docSeq++));

async function ctxForUser(email: string, companyId: string): Promise<Ctx> {
  const u = (await store.list("users", { filters: [["eq", "email", email]] })).items[0];
  const branch = (await store.list("branches", { filters: [["eq", "companyId", companyId]] })).items[0];
  return { store: scopeStore(store, companyId), companyId, branchId: branch?.id ?? null, user: await toCtxUser(store, u, companyId) };
}

let cnpjSeq = 0;
const CNPJS = ["20300400000120", "20300511000136", "20300622000142", "20300733000159", "20300844000165", "20300955000171"];
async function partner(key: string, parent: string | null, level: any) {
  const r = await createNode(platform, { parentNodeId: parent ? nodes[parent].id : null, level, uf: "CE", cityName: key, company: { name: `${key} Certificação Ltda`, tradeName: key, cnpj: CNPJS[cnpjSeq++] }, admin: { name: `Admin ${key}`, email: `${key.toLowerCase()}@rede.test` } });
  nodes[key] = r.node;
  companies[key] = r.company;
  ctxs[key] = await ctxForUser(`${key.toLowerCase()}@rede.test`, r.company.id);
}

async function addUser(company: any, roleKey: string, email: string): Promise<Ctx> {
  const role = (await store.list("roles", { filters: [["eq", "companyId", company.id], ["eq", "key", roleKey]] })).items[0];
  await store.create("users", { name: email.split("@")[0], email, login: email.split("@")[0], status: "active", isAdmin: false, roleId: role.id, roleByCompany: { [company.id]: role.id }, companyIds: [company.id], branchIds: [], firstAccessAt: new Date().toISOString() });
  return ctxForUser(email, company.id);
}

const P = "ecpf_a1_12m";
const PJ = "ecnpj_a1_12m";
let idem = 0;
const key = () => `k${idem++}`;
/** retrato completo (registro da plataforma) */
const full = async (requestId: string) => (await saleCascade(store, requestId)) as CascadeSnapshot;

async function customer(ctx: Ctx, extra: Record<string, any> = {}) {
  return saveCertCustomer(ctx, null, { personType: "PF", doc: nextCpf(), name: `Titular ${docSeq}`, phone: "88988776655", ...extra });
}
async function sell(ctx: Ctx, c: any, extra: Record<string, any> = {}) {
  return createNetworkSale(ctx, { customerId: c.id, productKey: P, idemKey: key(), dueDate: addDays(today(), 5), ...extra });
}

beforeAll(async () => {
  store = freshStore();
  const plat = await createCompanyWithDefaults(store, { name: "Intercert Plataforma", kind: "certification", key: "plat" });
  const u = await store.create("users", { name: "Equipe da rede", email: "rede@intercert.test", login: "rede", status: "active", isAdmin: true, companyIds: [], branchIds: [] });
  platform = { store: scopeStore(store, plat.company.id), companyId: plat.company.id, branchId: plat.branch.id, user: await toCtxUser(store, u, plat.company.id) };
  await partner("Master", null, "master");
  await partner("Ceara", "Master", "regional");
  await partner("Bahia", "Master", "regional");
  await partner("Juazeiro", "Ceara", "revenda");
  await partner("Salvador", "Bahia", "revenda");
  // preços: AC 60 → Master 80 → Regional 95 → Revenda 110 → Contador 120; mínimo 120, padrão 150
  const terms: Array<[string | null, any, number]> = [[null, "master", 8000], ["Master", "regional", 9500], ["Ceara", "revenda", 11000], ["Bahia", "revenda", 11000], ["Juazeiro", "contador", 12000]];
  for (const [owner, level, cost] of terms) {
    await saveLevelPriceRule(platform, owner ? nodes[owner].id : null, level, { productKey: P, cost, minPrice: 12000, defaultPrice: 15000, canEdit: true });
    await saveLevelPriceRule(platform, owner ? nodes[owner].id : null, level, { productKey: PJ, cost: cost + 4000, minPrice: 17500, defaultPrice: 21000, canEdit: true });
    await saveLevelPriceRule(platform, owner ? nodes[owner].id : null, level, { productKey: "birdid_12m", cost: 5000 + (cost - 8000) / 2, minPrice: 9900, defaultPrice: 9900, canEdit: false });
  }
  ctxs.seller = await addUser(companies.Juazeiro, "partner_seller", "vendedor1@rede.test");
  ctxs.seller2 = await addUser(companies.Juazeiro, "partner_seller", "vendedor2@rede.test");
  ctxs.finance = await addUser(companies.Juazeiro, "partner_finance", "fin@rede.test");
  ctxs.sellerSsa = await addUser(companies.Salvador, "partner_seller", "vendedor.ssa@rede.test");
});

describe("permissões da etapa 2", () => {
  it("vendedor vende e renova; gestor/administrador tudo do nó; financeiro consulta; sincronização dos modelos", () => {
    const a = (k: string) => PARTNER_ROLES.find((r) => r.key === k)!.actions as string[];
    expect(a("partner_seller")).toEqual(["network.sell", "network.renewals"]);
    for (const k of ["partner_admin", "partner_manager"]) expect(a(k)).toEqual(expect.arrayContaining(["network.sell", "network.sales_all", "network.vouchers", "network.coupons", "network.renewals"]));
    expect(a("partner_finance")).toContain("network.sales_all");
    expect(a("partner_finance")).not.toContain("network.sell");
    for (const x of ["network.sell", "network.sales_all", "network.vouchers", "network.coupons", "network.renewals"]) expect(ACTIONS_ADDED_TO_TEMPLATES).toContain(x);
    const plan = templateSyncPlan({ system: true, key: "partner_seller", actions: [], templateActions: null })!;
    expect(plan.missing.sort()).toEqual(["network.renewals", "network.sell"]);
    expect(plan.templateActions).toEqual([...ROLE_TEMPLATES.find((t) => t.key === "partner_seller")!.actions]);
  });
});

describe("venda com o preço da rede e retrato da cascata", () => {
  it("preço padrão do vendedor, custo e margem; retrato imutável com toda a cascata", async () => {
    const c = await customer(ctxs.seller);
    const r = await sell(ctxs.seller, c);
    expect(r).toMatchObject({ channel: "network", status: "awaiting_payment", amount: 15000, sellerNodeId: nodes.Juazeiro.id, sellerUserId: ctxs.seller.user.id, clientId: c.id, customerId: c.id });
    const s = await full(r.id);
    expect(s.levels.map((l) => [l.name, l.cost])).toEqual([["Master", 8000], ["Ceara", 9500], ["Juazeiro", 11000]].map(([n, v]) => [`${n} Certificação Ltda`, v]).map(([n, v]) => [String(n).replace(" Certificação Ltda", ""), v]).map(([n, v]) => [expect.stringContaining(String(n)), v]));
    expect(s).toMatchObject({ acCost: 6000, sellerCost: 11000, listPrice: 15000, minPrice: 12000, finalPrice: 15000, sellerMargin: 4000, coupon: null, voucher: null, costCovered: false, free: false });
    expect(levelEarnings(s)).toEqual([1500, 1500, 4000]);
    // a solicitação (empresa do parceiro: backup, histórico) guarda só a visão do vendedor — sem custo AC nem custos acima do pai
    expect(r.cascade).toEqual(sellerView(s));
    expect(r.cascade.acCost).toBeNull();
    expect(JSON.stringify(r.cascade)).not.toContain("8000");
    expect(JSON.stringify(r.cascade)).not.toContain("6000");
    const auditAfter = (await listAll(store, "audit_logs", { filters: [["eq", "action", "network.sale"], ["eq", "entityId", r.id]] }))[0].after;
    expect(JSON.stringify(auditAfter)).not.toContain("8000");
    expect((await store.list("cert_sale_cascades", {})).items.every((d) => d.companyId === "platform")).toBe(true);
  });

  it("preço editável dentro do mínimo; abaixo do mínimo e preço fixo recusados", async () => {
    const c = await customer(ctxs.seller);
    expect((await sell(ctxs.seller, c, { price: 13000 })).amount).toBe(13000);
    const c2 = await customer(ctxs.seller);
    await expect(sell(ctxs.seller, c2, { price: 11900 })).rejects.toThrow(/abaixo do mínimo/);
    await expect(sell(ctxs.seller, c2, { productKey: "birdid_12m", price: 12000 })).rejects.toThrow(/Preço fixo/);
    expect((await sell(ctxs.seller, c2, { productKey: "birdid_12m" })).amount).toBe(9900);
  });

  it("quotePrice (puro): canEdit, mínimo, cupom limitado ao custo e abaixo do mínimo só quando emitido acima", () => {
    const t = { cost: 11000, minPrice: 12000, defaultPrice: 15000, canEdit: true };
    expect(quotePrice({ ...t, requested: null }).finalPrice).toBe(15000);
    expect(quotePrice({ ...t, canEdit: false, requested: 14000 }).errors[0]).toMatch(/fixo/);
    const own = quotePrice({ ...t, requested: null, coupon: { kind: "percent", valueBps: 5000, issuedAbove: false } });
    expect(own).toMatchObject({ discount: 3000, finalPrice: 12000, capped: true, belowMin: 0 });
    const above = quotePrice({ ...t, requested: null, coupon: { kind: "percent", valueBps: 5000, issuedAbove: true } });
    expect(above).toMatchObject({ discount: 4000, finalPrice: 11000, capped: true, belowMin: 1000 });
    expect(quotePrice({ ...t, requested: null, coupon: { kind: "fixed", valueCents: 2000, issuedAbove: true } })).toMatchObject({ discount: 2000, finalPrice: 13000, capped: false });
    expect(couponDiscount({ kind: "percent", valueBps: 333 }, 15001)).toBe(499); // arredonda para baixo, centavos inteiros
    expect(quotePrice({ ...t, requested: null, gift: true }).finalPrice).toBe(0);
  });

  it("visibilidade dos custos por nível: nunca acima do pai; próprio custo e margem dos filhos", async () => {
    const r = (await listAll(store, "certificate_requests")).find((x) => x.channel === "network")!;
    const s = await full(r.id);
    expect(s.acCost).toBe(6000);
    const plat = maskCascade(s, { platform: true, myNodeId: null });
    expect(plat.acCost).toBe(6000);
    expect(plat.levels.every((l) => l.cost != null)).toBe(true);
    const reg = maskCascade(s, { platform: false, myNodeId: nodes.Ceara.id });
    expect(reg.acCost).toBeNull();
    expect(reg.levels[0]).toMatchObject({ nodeId: nodes.Master.id, cost: null, earns: null }); // pai: só o nome
    expect(reg.levels[1]).toMatchObject({ nodeId: nodes.Ceara.id, cost: 9500, earns: 1500, mine: true });
    expect(reg.levels[2]).toMatchObject({ nodeId: nodes.Juazeiro.id, cost: 11000, earns: 4000 });
    const rev = maskCascade(s, { platform: false, myNodeId: nodes.Juazeiro.id });
    expect(rev.hiddenAbove).toBe(1);
    expect(rev.levels.map((l) => l.nodeId)).toEqual([nodes.Ceara.id, nodes.Juazeiro.id]);
    expect(rev.levels[0].cost).toBeNull(); // o custo do pai (o que ele paga ao Master) não aparece
    expect(rev.levels[1]).toMatchObject({ cost: 11000, earns: 4000 });
    expect(JSON.stringify(rev)).not.toContain("8000");
    expect(JSON.stringify(rev)).not.toContain("9500");
    // pela leitura do domínio: a regional consulta (sem operar); a Bahia não vê
    const viaReg = await getNetworkSale(ctxs.Ceara, r.id);
    expect(viaReg.canOperate).toBe(false);
    expect(viaReg.masked!.acCost).toBeNull();
    await expect(getNetworkSale(ctxs.Bahia, r.id)).rejects.toThrow(/não encontrada/);
  });

  it("vendedor vê só as próprias vendas e clientes; gestor vê tudo do nó; financeiro consulta", async () => {
    const c = await customer(ctxs.seller2);
    const mine = await sell(ctxs.seller2, c);
    const s1 = await listNetworkSales(ctxs.seller);
    expect(s1.some((x) => x.request.id === mine.id)).toBe(false);
    expect(s1.every((x) => x.request.sellerUserId === ctxs.seller.user.id)).toBe(true);
    expect((await listCertCustomers(ctxs.seller)).some((x) => x.id === c.id)).toBe(false);
    expect((await listNetworkSales(ctxs.Juazeiro)).some((x) => x.request.id === mine.id)).toBe(true);
    const fin = await getNetworkSale(ctxs.finance, mine.id);
    expect(fin.canOperate).toBe(false);
    await expect(getNetworkSale(ctxs.seller, mine.id)).rejects.toThrow(/não encontrada/);
    await expect(cancelCertificateRequest(ctxs.seller, mine.id, { reason: "teste" })).rejects.toThrow();
    // a regional vê as vendas da revenda (consulta)
    expect((await listNetworkSales(ctxs.Ceara)).some((x) => x.request.id === mine.id && !x.own)).toBe(true);
    expect((await listNetworkSales(ctxs.Bahia)).some((x) => x.request.id === mine.id)).toBe(false);
  });

  it("cliente de certificado: documento validado e único no parceiro", async () => {
    await expect(saveCertCustomer(ctxs.seller, null, { personType: "PF", doc: "12345678900", name: "Inválido" })).rejects.toThrow(/CPF inválido/);
    const doc = nextCpf();
    await saveCertCustomer(ctxs.seller, null, { personType: "PF", doc, name: "Único" });
    await expect(saveCertCustomer(ctxs.seller2, null, { personType: "PF", doc, name: "Outro" })).rejects.toThrow(/outro vendedor/);
    await expect(saveCertCustomer(ctxs.seller, null, { personType: "PJ", doc: cnpj("998877660001"), name: "Empresa", email: "x@" })).rejects.toThrow(/E-mail/);
  });

  it("ciclo da Tela 67 reaproveitado: pagamento → validação → emissão → autorização; emitido entra nos certificados do parceiro", async () => {
    const c = await customer(ctxs.seller);
    const r = await sell(ctxs.seller, c);
    await confirmCertificatePayment(platform, r.id, { ref: "PIX-1" });
    await approveCertificateValidation(platform, r.id);
    await requestCertificateEmission(ctxs.seller, r.id);
    const issued = await registerCertificateEmission(platform, r.id, { file: { name: "c.pfx", data: Buffer.from("x") }, validTo: addDays(today(), 365) });
    expect(issued.status).toBe("awaiting_authorization");
    const after = await recordCertificateAuthorization(ctxs.seller, r.id, { notes: "Titular autorizou por e-mail" });
    expect(after.status).toBe("ready_to_download");
    const cert = (await listAll(store, "accounting_certificates")).find((x) => x.requestId === r.id)!;
    expect(cert).toMatchObject({ companyId: companies.Juazeiro.id, channel: "network", customerId: c.id, sellerNodeId: nodes.Juazeiro.id, sellerUserId: ctxs.seller.user.id });
  });
});

describe("vouchers", () => {
  let pkg: any;
  it("pacote: preço unitário não abaixo do custo de quem vende; compra idempotente; financeiro nas duas pontas", async () => {
    await expect(createVoucherPackage(ctxs.Ceara, { name: "Barato", validTo: addDays(today(), 30), items: [{ productKey: P, qty: 5, unitPrice: 9000 }] })).rejects.toThrow(/abaixo do seu custo/);
    await expect(createVoucherPackage(ctxs.seller, { name: "Vendedor", validTo: addDays(today(), 30), items: [{ productKey: P, qty: 5, unitPrice: 12000 }] })).rejects.toThrow();
    pkg = await createVoucherPackage(ctxs.Ceara, { name: "Pacote 3 e-CPF", validTo: addDays(today(), 30), items: [{ productKey: P, qty: 3, unitPrice: 10500 }], recipientNodeId: nodes.Juazeiro.id });
    expect(pkg.total).toBe(31500);
    await expect(purchaseVoucherPackage(ctxs.Salvador, pkg.id, { idemKey: "x" })).rejects.toThrow();
    const a = await purchaseVoucherPackage(ctxs.Juazeiro, pkg.id, { idemKey: "compra-1" });
    const b = await purchaseVoucherPackage(ctxs.Juazeiro, pkg.id, { idemKey: "compra-1" });
    expect(b.purchase.id).toBe(a.purchase.id);
    expect((await listAll(store, "cert_voucher_purchases")).length).toBe(1);
    expect(a.purchase.receivableTitleId).toBeTruthy();
    expect(a.purchase.payableTitleId).toBeTruthy();
    const rec = await store.get("titles", a.purchase.receivableTitleId);
    const pay = await store.get("titles", a.purchase.payableTitleId);
    expect(rec).toMatchObject({ companyId: companies.Ceara.id, kind: "receivable", total: 31500 });
    expect(pay).toMatchObject({ companyId: companies.Juazeiro.id, kind: "payable", total: 31500 });
    const bal = await voucherBalances(store, nodes.Juazeiro.id);
    expect(bal.products[0]).toMatchObject({ productKey: P, bought: 3, redeemed: 0, available: 3, expired: 0 });
  });

  it("resgate cobre o custo (retrato), idempotente pela chave; estorno no cancelamento (uma vez)", async () => {
    const c = await customer(ctxs.seller);
    const k = key();
    const r = await createNetworkSale(ctxs.seller, { customerId: c.id, productKey: P, idemKey: k, voucher: "balance" });
    const again = await createNetworkSale(ctxs.seller, { customerId: c.id, productKey: P, idemKey: k, voucher: "balance" });
    expect(again.id).toBe(r.id);
    const s = await full(r.id);
    expect(s).toMatchObject({ costCovered: true, finalPrice: 15000, sellerCost: 11000, sellerMargin: 4500 }); // margem sobre o preço unitário pré-pago
    expect(s.voucher).toMatchObject({ packageId: pkg.id, unitPrice: 10500, soldByNodeId: nodes.Ceara.id, gift: false });
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0]).toMatchObject({ redeemed: 1, available: 2 });
    await cancelCertificateRequest(ctxs.seller, r.id, { reason: "Cliente desistiu" });
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0]).toMatchObject({ redeemed: 0, available: 3 });
    const { onSaleCancelled } = await import("@/domain/network");
    await onSaleCancelled(ctxs.seller, (await store.get("certificate_requests", r.id))!);
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0]).toMatchObject({ redeemed: 0, available: 3 });
  });

  it("concorrência: resgates simultâneos nunca passam do saldo comprado", async () => {
    const cs = await Promise.all([1, 2, 3, 4].map(() => customer(ctxs.seller)));
    const res = await Promise.allSettled(cs.map((c) => createNetworkSale(ctxs.seller, { customerId: c.id, productKey: P, idemKey: key(), voucher: "balance" })));
    expect(res.filter((x) => x.status === "fulfilled").length).toBe(3);
    expect(res.filter((x) => x.status === "rejected").every((x: any) => /voucher/i.test(x.reason.message))).toBe(true);
    const lot = (await listAll(store, "cert_voucher_lots")).find((l) => l.packageId === pkg.id)!;
    expect(lot).toMatchObject({ qty: 3, committed: 3, redeemed: 3 });
    expect(lotBalance(lot).available).toBe(0);
    // devolve as três unidades para os testes seguintes
    for (const x of res) if (x.status === "fulfilled") await cancelCertificateRequest(ctxs.seller, x.value.id, { reason: "teste" });
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0].available).toBe(3);
  });

  it("voucher presente: código ao cliente final, venda a R$ 0 direto à validação; código não reusa; cancelar código devolve ao saldo", async () => {
    const lot = (await listAll(store, "cert_voucher_lots")).find((l) => l.packageId === pkg.id)!;
    await expect(issueVoucherCode(ctxs.seller, lot.id, { gift: true })).rejects.toThrow();
    const gift = await issueVoucherCode(ctxs.Juazeiro, lot.id, { gift: true });
    expect(gift.code).toMatch(/^P-/);
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0]).toMatchObject({ reserved: 1, available: 2 });
    const c = await customer(ctxs.seller);
    const r = await createNetworkSale(ctxs.seller, { customerId: c.id, productKey: P, idemKey: key(), voucher: "code", voucherCode: gift.code.toLowerCase() });
    expect(r).toMatchObject({ amount: 0, status: "validation", gift: true });
    expect((await full(r.id)).voucher).toMatchObject({ gift: true, code: gift.code });
    const c2 = await customer(ctxs.seller);
    await expect(createNetworkSale(ctxs.seller, { customerId: c2.id, productKey: P, idemKey: key(), voucher: "code", voucherCode: gift.code })).rejects.toThrow(/já foi usado/);
    await expect(createNetworkSale(ctxs.seller, { customerId: c2.id, productKey: P, idemKey: key(), voucher: "code", voucherCode: gift.code, couponCode: "QUALQUER" })).rejects.toThrow();
    // estorno do presente (cancelado antes da emissão): o código volta a ficar disponível
    await cancelCertificateRequest(ctxs.seller, r.id, { reason: "Titular não compareceu" });
    expect((await store.get("cert_voucher_codes", gift.id))!.status).toBe("available");
    await cancelVoucherCode(ctxs.Juazeiro, gift.id, "Presente não entregue");
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0]).toMatchObject({ reserved: 0, available: 3 });
  });

  it("validade: saldo vencido não é resgatado e aparece como vencido", async () => {
    const lot = (await listAll(store, "cert_voucher_lots")).find((l) => l.packageId === pkg.id)!;
    await store.update("cert_voucher_lots", lot.id, { validTo: addDays(today(), -1) });
    expect((await voucherBalances(store, nodes.Juazeiro.id)).products[0]).toMatchObject({ available: 0, expired: 3 });
    const c = await customer(ctxs.seller);
    await expect(createNetworkSale(ctxs.seller, { customerId: c.id, productKey: P, idemKey: key(), voucher: "balance" })).rejects.toThrow(/Sem saldo de voucher/);
    await store.update("cert_voucher_lots", lot.id, { validTo: addDays(today(), 30) });
  });
});

describe("cupons", () => {
  it("quem cria: nó para si e descendentes; plataforma para todos; vendedor não; código 3–20 maiúsculas e único", async () => {
    await expect(createCoupon(ctxs.seller, { code: "VEND10", kind: "percent", valueBps: 1000, validTo: addDays(today(), 10) })).rejects.toThrow();
    await expect(createCoupon(ctxs.Juazeiro, { code: "AB", kind: "percent", valueBps: 1000, validTo: addDays(today(), 10) })).rejects.toThrow(/3 a 20/);
    const c = await createCoupon(ctxs.Juazeiro, { code: "jua10", kind: "percent", valueBps: 1000, validTo: addDays(today(), 10), maxUses: 3, maxPerHolder: 1 });
    expect(c).toMatchObject({ code: "JUA10", issuerNodeId: nodes.Juazeiro.id, nodeId: nodes.Juazeiro.id });
    await expect(createCoupon(ctxs.Ceara, { code: "JUA10", kind: "fixed", valueCents: 100, validTo: addDays(today(), 10) })).rejects.toThrow(/Já existe/);
    await expect(createCoupon(ctxs.Ceara, { code: "BAHIA5", kind: "fixed", valueCents: 500, nodeId: nodes.Salvador.id, validTo: addDays(today(), 10) })).rejects.toThrow(/abaixo dele/);
    await createCoupon(ctxs.Ceara, { code: "REG50", kind: "percent", valueBps: 5000, nodeId: nodes.Juazeiro.id, validTo: addDays(today(), 10) });
    await createCoupon(platform, { code: "REDE20", kind: "fixed", valueCents: 2000, nodeId: null, validTo: addDays(today(), 10) });
    expect((await listCoupons(ctxs.Juazeiro)).map((x) => x.code)).toEqual(expect.arrayContaining(["JUA10", "REG50"]));
    expect((await listCoupons(ctxs.Juazeiro)).find((x) => x.code === "REG50")!.manageable).toBe(false);
    expect((await listCoupons(ctxs.Juazeiro)).map((x) => x.code)).toContain("REDE20"); // cupom da rede toda também aparece
    expect((await listCoupons(ctxs.Bahia)).map((x) => x.code)).not.toContain("JUA10");
  });

  it("regra de custo/mínimo e retrato com emissor; limite por titular; uso reservado, consumido no pagamento e liberado no cancelamento", async () => {
    const c = await customer(ctxs.seller);
    const r = await sell(ctxs.seller, c, { couponCode: "JUA10" });
    expect(r.amount).toBe(13500);
    expect((await full(r.id)).coupon).toMatchObject({ code: "JUA10", issuerNodeId: nodes.Juazeiro.id, discount: 1500, belowMin: 0 });
    await expect(sell(ctxs.seller, c, { couponCode: "JUA10", productKey: PJ })).rejects.toThrow(/titular já usou/);
    // cupom da regional (acima): abaixo do mínimo, nunca abaixo do custo; quem emitiu absorve
    const c2 = await customer(ctxs.seller);
    const r2 = await sell(ctxs.seller, c2, { couponCode: "REG50" });
    expect(r2.amount).toBe(11000);
    expect((await full(r2.id)).coupon).toMatchObject({ issuerNodeId: nodes.Ceara.id, absorbedByNodeId: nodes.Ceara.id, belowMin: 1000, capped: true });
    // cupom de outro nó não vale
    const cs = await customer(ctxs.sellerSsa);
    await expect(sell(ctxs.sellerSsa, cs, { couponCode: "JUA10" })).rejects.toThrow(/não vale/);
    expect((await sell(ctxs.sellerSsa, cs, { couponCode: "REDE20" })).amount).toBe(13000);
    let coupon = (await listAll(store, "cert_coupons")).find((x) => x.code === "JUA10")!;
    expect(coupon.usedCount).toBe(1);
    await confirmCertificatePayment(platform, r.id, { ref: "PIX-C" });
    expect((await listAll(store, "cert_coupon_uses")).find((u) => u.requestId === r.id)!.status).toBe("consumed");
    const c3 = await customer(ctxs.seller);
    const r3 = await sell(ctxs.seller, c3, { couponCode: "JUA10" });
    coupon = (await store.get("cert_coupons", coupon.id))!;
    expect(coupon.usedCount).toBe(2);
    await cancelCertificateRequest(ctxs.seller, r3.id, { reason: "Desistiu" });
    coupon = (await store.get("cert_coupons", coupon.id))!;
    expect(coupon.usedCount).toBe(1);
    expect((await listAll(store, "cert_coupon_uses")).find((u) => u.requestId === r3.id)!.status).toBe("released");
    // o mesmo titular pode usar de novo depois da liberação
    expect((await sell(ctxs.seller, c3, { couponCode: "JUA10" })).amount).toBe(13500);
  });

  it("limite total sob concorrência e cupom inativo", async () => {
    // JUA10: limite 3, já 2 em uso → só um dos simultâneos passa
    const cs = await Promise.all([1, 2, 3].map(() => customer(ctxs.seller)));
    const res = await Promise.allSettled(cs.map((c) => sell(ctxs.seller, c, { couponCode: "JUA10" })));
    expect(res.filter((x) => x.status === "fulfilled").length).toBe(1);
    expect((await listAll(store, "cert_coupons")).find((x) => x.code === "JUA10")!.usedCount).toBe(3);
    const reg = (await listAll(store, "cert_coupons")).find((x) => x.code === "REG50")!;
    await expect(setCouponActive(ctxs.Juazeiro, reg.id, false, "não quero")).rejects.toThrow(/nível acima/);
    await setCouponActive(ctxs.Ceara, reg.id, false, "Campanha encerrada");
    const c = await customer(ctxs.seller);
    await expect(sell(ctxs.seller, c, { couponCode: "REG50" })).rejects.toThrow(/inativo/);
  });
});

describe("proteção contra venda repetida", () => {
  it("avisa com os dados e exige motivo (auditado); não avisa renovação antecipada (≤ 60 dias)", async () => {
    const c = await customer(ctxs.seller);
    // certificado do mesmo tipo/titular conhecido em outro canal, válido por 200 dias
    await store.create("accounting_certificates", { companyId: companies.Salvador.id, clientId: "x", holderName: c.name, holderDoc: c.doc, product: P, productLabel: "e-CPF A1 · 12 meses", validTo: addDays(today(), 200), source: "manual", active: true, productType: "a1", holderType: "pf" });
    await expect(sell(ctxs.seller, c)).rejects.toThrow(/possível venda repetida.*outro canal da rede/);
    await expect(sell(ctxs.seller, c, { duplicateReason: "curto" })).rejects.toThrow(/motivo/);
    const r = await sell(ctxs.seller, c, { duplicateReason: "Titular perdeu o token e precisa de outro certificado" });
    expect(r.duplicateAck).toMatchObject({ reason: expect.stringContaining("perdeu"), by: ctxs.seller.user.id });
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "action", "network.sale_duplicate_ack"]] });
    expect(logs.some((l) => l.entityId === r.id)).toBe(true);
    // outra solicitação em aberto do mesmo produto
    const dups = await findDuplicates(store, { holderDoc: c.doc, product: (await certificationSettings(store)).catalog.find((p) => p.key === P)!, viewerCompanyId: companies.Juazeiro.id });
    expect(dups.some((d) => d.kind === "request" && d.protocol === r.protocol)).toBe(true);
    // A3 é outro tipo: não avisa pelo certificado A1
    const c2 = await customer(ctxs.seller);
    await store.create("accounting_certificates", { companyId: companies.Juazeiro.id, clientId: c2.id, holderName: c2.name, holderDoc: c2.doc, product: P, productLabel: "e-CPF A1", validTo: addDays(today(), 40), source: "issued", active: true, productType: "a1", holderType: "pf" });
    expect((await sell(ctxs.seller, c2)).status).toBe("awaiting_payment"); // vence em 40 dias: renovação antecipada legítima
  });
});

describe("BirdID gratuito", () => {
  it("R$ 0, sem cobrança, direto à validação; um ativo por CPF; liberado no cancelamento; marca o titular", async () => {
    const c = await customer(ctxs.seller);
    const r = await sell(ctxs.seller, c, { productKey: "birdid_free_60m" });
    expect(r).toMatchObject({ amount: 0, status: "validation", free: true, months: 60 });
    await expect(sell(ctxs.seller, c, { productKey: "birdid_free_60m" })).rejects.toThrow(/um BirdID gratuito ativo/);
    await cancelCertificateRequest(ctxs.seller, r.id, { reason: "Cadastro errado" });
    const r2 = await sell(ctxs.seller, c, { productKey: "birdid_free_60m" });
    await approveCertificateValidation(platform, r2.id);
    await requestCertificateEmission(ctxs.seller, r2.id);
    await registerCertificateEmission(platform, r2.id, { file: { name: "b.pfx", data: Buffer.from("x") }, validTo: addDays(today(), 1825) });
    expect(await store.get("cert_customers", c.id)).toMatchObject({ hasBirdId: true, birdIdValidTo: addDays(today(), 1825) });
    await expect(sell(ctxs.seller, c, { productKey: "birdid_free_60m" })).rejects.toThrow(/válido até/);
    const pj = await saveCertCustomer(ctxs.seller, null, { personType: "PJ", doc: cnpj("112233440001"), name: "Empresa BirdID" });
    await expect(sell(ctxs.seller, pj, { productKey: "birdid_free_60m" })).rejects.toThrow(/pessoa física/);
    // concorrência: dois BirdID gratuitos simultâneos para o mesmo CPF → só um
    const c3 = await customer(ctxs.seller);
    const res = await Promise.allSettled([sell(ctxs.seller, c3, { productKey: "birdid_free_60m" }), sell(ctxs.seller, c3, { productKey: "birdid_free_60m" })]);
    expect(res.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    // e em sequência logo depois de outra (reivindicação já gravada): recusa
    await expect(sell(ctxs.seller, c3, { productKey: "birdid_free_60m" })).rejects.toThrow(/BirdID gratuito/);
    expect((res.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/BirdID gratuito/);
  });
});

describe("renovações por camada e alerta “ninguém agiu”", () => {
  const certs: Record<string, any> = {};
  it("situações (puras)", () => {
    expect(renewalSituation(80, false)).toBe("due_90");
    expect(renewalSituation(45, false)).toBe("due_60");
    expect(renewalSituation(20, false)).toBe("due_30");
    expect(renewalSituation(7, false)).toBe("due_7");
    expect(renewalSituation(0, false)).toBe("due_7");
    expect(renewalSituation(-1, false)).toBe("expired");
    expect(renewalSituation(-30, false)).toBe("expired");
    expect(renewalSituation(-31, false)).toBe("lost");
    expect(renewalSituation(-100, true)).toBe("renewed");
    expect(renewalSituation(120, false)).toBe("ok");
  });

  it("painel: certificados por nó, renovado por nova emissão, visão por camada e taxa; visibilidade", async () => {
    const mk = async (company: any, node: any, seller: Ctx | null, days: number, extra: Record<string, any> = {}) => {
      const c = await customer(seller ?? ctxs.seller);
      return store.create("accounting_certificates", { companyId: company.id, clientId: c.id, customerId: c.id, holderName: c.name, holderDoc: c.doc, product: P, productLabel: "e-CPF A1", validFrom: addDays(today(), days - 365), validTo: addDays(today(), days), source: "issued", active: true, channel: "network", sellerNodeId: node.id, sellerUserId: seller?.user.id ?? null, productType: "a1", holderType: "pf", ...extra });
    };
    certs.d7 = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller, 5);
    certs.d30 = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller, 25);
    certs.d60 = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller2, 50);
    certs.d90 = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller, 80);
    certs.exp = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller, -10);
    certs.lost = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller, -40);
    certs.ssa = await mk(companies.Salvador, nodes.Salvador, ctxs.sellerSsa, 3);
    // renovado: titular do "exp2" recebeu nova emissão
    certs.exp2 = await mk(companies.Juazeiro, nodes.Juazeiro, ctxs.seller, -5);
    await store.create("accounting_certificates", { ...Object.fromEntries(Object.entries(certs.exp2).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k))), validFrom: today(), validTo: addDays(today(), 360) });
    const w = await renewalWorld(store);
    const sit = (c: any) => w.rows.find((r) => r.id === c.id)!.situation;
    expect([sit(certs.d7), sit(certs.d30), sit(certs.d60), sit(certs.d90), sit(certs.exp), sit(certs.lost), sit(certs.exp2)]).toEqual(["due_7", "due_30", "due_60", "due_90", "expired", "lost", "renewed"]);
    // o vendedor vê só os próprios; o gestor do nó vê todos; a regional vê Juazeiro e não Salvador
    const pSeller = await renewalPanel(ctxs.seller);
    expect(pSeller.rows.some((r) => r.id === certs.d60.id)).toBe(false);
    expect(pSeller.rows.some((r) => r.id === certs.d7.id)).toBe(true);
    const pReg = await renewalPanel(ctxs.Ceara);
    expect(pReg.rows.some((r) => r.id === certs.d60.id)).toBe(true);
    expect(pReg.rows.some((r) => r.id === certs.ssa.id)).toBe(false);
    const layer = pReg.layers[0];
    expect(layer.nodeId).toBe(nodes.Ceara.id);
    const jua = layer.children.find((c) => c.nodeId === nodes.Juazeiro.id)!;
    expect(jua.all.renewed).toBeGreaterThanOrEqual(1);
    expect(jua.all.total).toBe(layer.all.total);
    expect(jua.all.rate).toBeCloseTo(jua.all.renewed / jua.all.total);
    expect(jua.sellers.length).toBeGreaterThanOrEqual(2);
    const pPlat = await renewalPanel(platform);
    expect(pPlat.layers.map((l) => l.nodeId)).toEqual([nodes.Master.id]);
    expect(pPlat.rows.some((r) => r.id === certs.ssa.id)).toBe(true);
  });

  it("alerta “ninguém agiu”: responsável do nó e nível acima; marcos 90/60/30 ao vendedor; idempotente; contato evita o alerta", async () => {
    await registerRenewalContact(ctxs.seller, certs.exp.id, { channel: "phone", result: "thinking", nextAction: "Ligar de novo" });
    await expect(registerRenewalContact(ctxs.Ceara, certs.d7.id, { channel: "phone", result: "thinking" })).rejects.toThrow(/não encontrado/);
    const first = await notifyRenewalAlerts(store, companies.Juazeiro.id);
    expect(first.alerts).toBeGreaterThan(0);
    const notes = await listAll(store, "notifications");
    const idle = (certId: string) => notes.filter((n) => n.originId === certId && String(n.title).startsWith("Ninguém agiu"));
    // d7: sem contato → gestor/administrador do nó (Juazeiro) e o nível acima (Ceará)
    expect(idle(certs.d7.id).some((n) => n.companyId === companies.Juazeiro.id)).toBe(true);
    expect(idle(certs.d7.id).some((n) => n.companyId === companies.Ceara.id)).toBe(true);
    expect(idle(certs.d7.id).some((n) => n.userId === ctxs.seller.user.id)).toBe(false); // o vendedor não "vê tudo"
    // vencido com contato registrado: sem alerta
    expect(idle(certs.exp.id)).toHaveLength(0);
    // marcos ao vendedor
    expect(notes.some((n) => n.originId === certs.d30.id && n.userId === ctxs.seller.user.id)).toBe(true);
    expect(notes.some((n) => n.originId === certs.d60.id && n.userId === ctxs.seller2.user.id)).toBe(true);
    expect(notes.some((n) => n.originId === certs.d90.id && n.userId === ctxs.seller.user.id)).toBe(true);
    // idempotente
    const second = await notifyRenewalAlerts(store, companies.Juazeiro.id);
    expect(second.alerts).toBe(0);
    // renovação aberta também conta como ação
    const w = await renewalWorld(store);
    const row = w.rows.find((r) => r.id === certs.d7.id)!;
    expect(idleCandidate({ ...row, openRequest: { id: "x", protocol: "CERT-1", status: "awaiting_payment" } }, 7)).toBe(false);
  });
});

describe("Tela 67 do escritório contador com o preço da rede", () => {
  it("escritório nó da rede: preço padrão do nó, mínimo respeitado e retrato da cascata; fora da rede, catálogo", async () => {
    const firm = await createCompanyWithDefaults(store, { name: "Contábil Rede Ltda", cnpj: "60746948000112", kind: "accounting", key: "firm-rede" });
    const owner = await store.create("users", { name: "Sócio", email: "socio@firm.test", login: "socio.firm", status: "active", isAdmin: false, roleId: firm.roles.firm_admin.id, roleByCompany: { [firm.company.id]: firm.roles.firm_admin.id }, companyIds: [firm.company.id], branchIds: [] });
    const octx: Ctx = { store: scopeStore(store, firm.company.id), companyId: firm.company.id, branchId: firm.branch.id, user: await toCtxUser(store, owner, firm.company.id) };
    const client = await createClient(octx, { personType: "PF", doc: nextCpf(), name: "Cliente PF", status: "active", onboardedAt: today() });
    // antes de entrar na rede: catálogo
    const r0 = await createCertificateRequest(octx, { clientId: client.id, kind: "new", product: P, dueDate: addDays(today(), 3) });
    expect(r0.amount).toBe(15000);
    expect(r0.cascade).toBeNull();
    await cancelCertificateRequest(octx, r0.id, { reason: "teste" });
    await createNode(platform, { parentNodeId: nodes.Juazeiro.id, level: "contador", linkCnpj: "60746948000112" });
    await saveLevelPriceRule(platform, nodes.Juazeiro.id, "contador", { productKey: PJ, cost: 16000, minPrice: 17500, defaultPrice: 23000, canEdit: true });
    await expect(createCertificateRequest(octx, { clientId: client.id, kind: "new", product: P, amount: 11000, dueDate: addDays(today(), 3) })).rejects.toThrow(/abaixo do mínimo/);
    const r = await createCertificateRequest(octx, { clientId: client.id, kind: "new", product: PJ, dueDate: addDays(today(), 3) });
    expect(r.amount).toBe(23000);
    expect((await full(r.id)).levels.map((l) => l.cost)).toEqual([12000, 13500, 15000, 16000]);
    expect(r).toMatchObject({ channel: "firm", sellerUserId: owner.id });
    // o produto gratuito não é cobrado pelo escritório
    await expect(createCertificateRequest(octx, { clientId: client.id, kind: "new", product: "birdid_free_60m", dueDate: addDays(today(), 3) })).rejects.toThrow();
    // a revenda acima vê a venda do contador (consulta)
    expect((await listNetworkSales(ctxs.Juazeiro)).some((x) => x.request.id === r.id && !x.own)).toBe(true);
    expect((await listNetworkSales(ctxs.Juazeiro)).find((x) => x.request.id === r.id)!.masked!.levels.at(-1)!.earns).toBe(7000);
  });
});
