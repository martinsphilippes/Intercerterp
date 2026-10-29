import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import type { MemoryStore } from "@/lib/db/memory-store";
import { listAll } from "@/lib/db";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import { addDays, monthEnd, monthStart, today } from "@/lib/dates";
import { computeDre } from "@/domain/finance-reports";
import {
  createNode, saveLevelPriceRule, saveCertCustomer, createNetworkSale, savePlatformFinance, saveBillingAgreement, effectiveAgreement, requestRecharge, confirmRecharge, cancelRecharge, adjustWallet,
  walletIdOf, planSale, planCheck, maskPlan, closingCutoff, nextClosingDay, lastClosingDay, normalizeTerms, DEFAULT_TERMS, saleFinance, closeRelation, closeDueRelations, relationPreview, flowKey,
  reverseNetworkSale, networkResult, relationFinance, readClosing, notifyLowBalances, createCoupon, createVoucherPackage, purchaseVoucherPackage, type AgreementTerms, type PlanSnapshot,
} from "@/domain/network";
import { cancelCertificateRequest, confirmCertificatePayment, approveCertificateValidation, createClient, createCertificateRequest } from "@/domain/accounting";

let store: MemoryStore;
let platform: Ctx;
let platCompanyId: string;
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
let docSeq = 300000000;
const nextCpf = () => cpf(String(docSeq++));

async function ctxForUser(email: string, companyId: string): Promise<Ctx> {
  const u = (await store.list("users", { filters: [["eq", "email", email]] })).items[0];
  const branch = (await store.list("branches", { filters: [["eq", "companyId", companyId]] })).items[0];
  return { store: scopeStore(store, companyId), companyId, branchId: branch?.id ?? null, user: await toCtxUser(store, u, companyId) };
}

let cnpjSeq = 0;
const cnpj = (b: string) => digits(b, [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]);
const CNPJS = ["313004000001", "313005110001", "313006220001", "313007330001", "313008440001", "313009550001", "313010660001"].map(cnpj);
async function partner(key: string, parent: string | null, level: any) {
  const r = await createNode(platform, { parentNodeId: parent ? nodes[parent].id : null, level, uf: "CE", cityName: key, company: { name: `${key} Certificação Ltda`, tradeName: key, cnpj: CNPJS[cnpjSeq++] }, admin: { name: `Admin ${key}`, email: `${key.toLowerCase()}@billing.test` } });
  nodes[key] = r.node;
  companies[key] = r.company;
  ctxs[key] = await ctxForUser(`${key.toLowerCase()}@billing.test`, r.company.id);
}

async function addUser(companyId: string, roleKey: string, email: string): Promise<Ctx> {
  const role = (await store.list("roles", { filters: [["eq", "companyId", companyId], ["eq", "key", roleKey]] })).items[0];
  await store.create("users", { name: email.split("@")[0], email, login: email.split("@")[0], status: "active", isAdmin: false, roleId: role.id, roleByCompany: { [companyId]: role.id }, companyIds: [companyId], branchIds: [], firstAccessAt: new Date().toISOString() });
  return ctxForUser(email, companyId);
}

const P = "ecpf_a1_12m";
let idem = 0;
const key = () => `b${idem++}`;
async function customer(ctx: Ctx) {
  return saveCertCustomer(ctx, null, { personType: "PF", doc: nextCpf(), name: `Titular ${docSeq}`, phone: "88988776655" });
}
async function sell(ctx: Ctx, extra: Record<string, any> = {}) {
  const c = await customer(ctx);
  return createNetworkSale(ctx, { customerId: c.id, productKey: P, idemKey: key(), dueDate: addDays(today(), 5), ...extra });
}
async function sellAndPay(ctx: Ctx, extra: Record<string, any> = {}) {
  const r = await sell(ctx, extra);
  return confirmCertificatePayment(platform, r.id, { ref: `PIX-${r.protocol}-${r.companyId.slice(0, 4)}` });
}
const titlesOf = async (companyId: string, originType?: string) => (await listAll(store, "titles", { filters: [["eq", "companyId", companyId]] })).filter((t) => !originType || t.originType === originType);
const entriesOf = async (requestId: string) => listAll(store, "cert_fin_entries", { filters: [["eq", "requestId", requestId]] });
const wallet = async (k: string) => store.get("cert_wallets", walletIdOf(nodes[k].id, nodes[k].parentNodeId));
const party = (k: string) => ({ type: "node" as const, nodeId: nodes[k].id, name: "" });
const PLAT = { type: "platform" as const, nodeId: null, name: "" };

beforeAll(async () => {
  store = freshStore();
  const plat = await createCompanyWithDefaults(store, { name: "Intercert Plataforma Billing", kind: "certification", key: "plat-billing" });
  platCompanyId = plat.company.id;
  const u = await store.create("users", { name: "Equipe da rede", email: "rede@billing.test", login: "rede.billing", status: "active", isAdmin: true, companyIds: [], branchIds: [] });
  platform = { store: scopeStore(store, plat.company.id), companyId: plat.company.id, branchId: plat.branch.id, user: await toCtxUser(store, u, plat.company.id) };
  await savePlatformFinance(platform, { platformCompanyId: plat.company.id, acClosingDay: 1, acDueDays: 15 });
  await partner("Master", null, "master");
  await partner("Ceara", "Master", "regional");
  await partner("Bahia", "Master", "regional");
  await partner("Juazeiro", "Ceara", "revenda");
  await partner("Fortaleza", "Ceara", "revenda");
  await partner("Salvador", "Bahia", "revenda");
  await partner("Recife", "Bahia", "revenda");
  // AC 60 → Master 80 → Regional 95 → Revenda 110 → Contador 120; mínimo 120, padrão 150
  const terms: Array<[string | null, any, number]> = [[null, "master", 8000], ["Master", "regional", 9500], ["Ceara", "revenda", 11000], ["Bahia", "revenda", 11000], ["Fortaleza", "contador", 12000]];
  for (const [owner, level, cost] of terms) await saveLevelPriceRule(platform, owner ? nodes[owner].id : null, level, { productKey: P, cost, minPrice: 12000, defaultPrice: 15000, canEdit: true });
  ctxs.sellerJua = await addUser(companies.Juazeiro.id, "partner_seller", "vend.jua@billing.test");
  ctxs.sellerFtz = await addUser(companies.Fortaleza.id, "partner_seller", "vend.ftz@billing.test");
  ctxs.sellerSsa = await addUser(companies.Salvador.id, "partner_seller", "vend.ssa@billing.test");
  ctxs.sellerRec = await addUser(companies.Recife.id, "partner_seller", "vend.rec@billing.test");
  ctxs.finCeara = await addUser(companies.Ceara.id, "partner_finance", "fin.ce@billing.test");
  ctxs.sellerCeara = await addUser(companies.Ceara.id, "partner_seller", "vend.ce@billing.test");
  ctxs.managerFtz = await addUser(companies.Fortaleza.id, "partner_manager", "ger.ftz@billing.test");
  // escritório contador abaixo de Fortaleza (indicador e Tela 67)
  const firm = await createCompanyWithDefaults(store, { name: "Contábil Indicadora Ltda", cnpj: "60746948000112", kind: "accounting", key: "firm-billing" });
  companies.Contador = firm.company;
  const owner = await store.create("users", { name: "Sócio", email: "socio@billing.test", login: "socio.billing", status: "active", isAdmin: false, roleId: firm.roles.firm_admin.id, roleByCompany: { [firm.company.id]: firm.roles.firm_admin.id }, companyIds: [firm.company.id], branchIds: [] });
  ctxs.Contador = { store: scopeStore(store, firm.company.id), companyId: firm.company.id, branchId: firm.branch.id, user: await toCtxUser(store, owner, firm.company.id) };
  nodes.Contador = (await createNode(platform, { parentNodeId: nodes.Fortaleza.id, level: "contador", linkCnpj: "60746948000112" })).node;
  // modalidades
  await saveBillingAgreement(platform, nodes.Master.id, { mode: "postpaid", period: "monthly", monthDay: 1, dueDays: 10 });
  for (const k of ["Ceara", "Bahia"]) await saveBillingAgreement(ctxs.Master, nodes[k].id, { mode: "postpaid", period: "monthly", monthDay: 1, dueDays: 10 });
  await saveBillingAgreement(ctxs.Ceara, nodes.Juazeiro.id, { mode: "prepaid", overdraftLimit: 0, lowBalanceAlert: 15000 });
  await saveBillingAgreement(ctxs.Ceara, nodes.Fortaleza.id, { mode: "postpaid", period: "biweekly", dueDays: 7, referralKind: "percent", referralBps: 1000 });
  await saveBillingAgreement(ctxs.Bahia, nodes.Salvador.id, { mode: "commission", commissionSettlement: "split" });
  await saveBillingAgreement(ctxs.Bahia, nodes.Recife.id, { mode: "commission", commissionSettlement: "period", period: "monthly", monthDay: 1, dueDays: 5 });
});

// ------------------------------------------------------------------------------------------------------- funções puras

describe("plano de liquidação (função pura)", () => {
  const levels = [{ nodeId: "M", name: "Master", level: "master", cost: 8000 }, { nodeId: "R", name: "Regional", level: "regional", cost: 9500 }, { nodeId: "V", name: "Revenda", level: "revenda", cost: 11000 }];
  const snap = (extra: Partial<PlanSnapshot> = {}): PlanSnapshot => ({ acCost: 6000, levels, sellerNodeId: "V", finalPrice: 15000, coupon: null, voucher: null, costCovered: false, free: false, ...extra });
  const T = (over: Record<string, Partial<AgreementTerms>> = {}) => (id: string) => ({ ...DEFAULT_TERMS, ...(over[id] ?? {}) });

  it("pós-pago: cada camada paga o próprio custo ao de cima; preço do cliente = Σ margens + custo AC", () => {
    const p = planSale(snap(), { termsOf: T() });
    expect(p.collectorNodeId).toBe("V");
    expect(p.flows.map((f) => [f.kind, f.payer.nodeId ?? f.payer.type, f.payee.nodeId ?? f.payee.type, f.amount, f.settlement])).toEqual([
      ["client", "client", "V", 15000, "charge"], ["cost", "V", "R", 11000, "accrual"], ["cost", "R", "M", 9500, "accrual"], ["cost", "M", "platform", 8000, "accrual"], ["ac_cost", "platform", "supplier", 6000, "accrual"],
    ]);
    expect(p.earnings).toEqual({ V: 4000, R: 1500, M: 1500, platform: 2000 });
    expect(planCheck(p).difference).toBe(0);
  });

  it("pré-pago vira débito da carteira com o limite negativo da modalidade", () => {
    const p = planSale(snap(), { termsOf: T({ V: { mode: "prepaid", overdraftLimit: 5000 } }) });
    expect(p.flows.find((f) => f.payer.nodeId === "V")).toMatchObject({ settlement: "wallet", overdraftLimit: 5000, amount: 11000 });
  });

  it("comissionado: quem cobra sobe até o primeiro nível não comissionado; comissão = preço final − custo (ou %), nunca menor que a de baixo", () => {
    const p = planSale(snap(), { termsOf: T({ V: { mode: "commission", commissionSettlement: "split" } }) });
    expect(p.collectorNodeId).toBe("R");
    expect(p.flows.find((f) => f.kind === "commission")).toMatchObject({ payer: { nodeId: "R" }, payee: { nodeId: "V" }, amount: 4000, settlement: "split" });
    expect(p.earnings).toEqual({ V: 4000, R: 1500, M: 1500, platform: 2000 });
    expect(planCheck(p).difference).toBe(0);
    // dois níveis comissionados até a plataforma, com percentual
    const q = planSale(snap(), { termsOf: T({ V: { mode: "commission", commissionRule: "percent", commissionBps: 2000 }, R: { mode: "commission" }, M: { mode: "commission" } }) });
    expect(q.collectorNodeId).toBeNull();
    const c = Object.fromEntries(q.flows.filter((f) => f.kind === "commission").map((f) => [f.payee.nodeId, f.amount]));
    expect(c).toEqual({ V: 3000, R: 5500, M: 7000 });
    expect(q.earnings).toEqual({ V: 3000, R: 2500, M: 1500, platform: 2000 });
    expect(planCheck(q).difference).toBe(0);
    // comissionado ACIMA de quem cobra: liquidado como custo
    const r = planSale(snap(), { termsOf: T({ R: { mode: "commission" } }) });
    expect(r.collectorNodeId).toBe("V");
    expect(r.flows.find((f) => f.payer.nodeId === "R")).toMatchObject({ kind: "cost", settlement: "accrual", amount: 9500 });
  });

  it("cupom de nível acima abaixo do mínimo: o emissor absorve; voucher: custo do vendedor não é cobrado de novo", () => {
    const p = planSale(snap({ finalPrice: 11500, coupon: { issuerNodeId: "R", absorbedByNodeId: "R", belowMin: 500 } }), { termsOf: T() });
    expect(p.flows.find((f) => f.payer.nodeId === "V")!.amount).toBe(10500);
    expect(p.earnings).toEqual({ V: 1000, R: 1000, M: 1500, platform: 2000 });
    expect(planCheck(p).difference).toBe(0);
    const v = planSale(snap({ voucher: { unitPrice: 10500, soldByNodeId: "R" }, costCovered: true }), { termsOf: T({ V: { mode: "prepaid" } }) });
    expect(v.flows.find((f) => f.payer.nodeId === "V")).toMatchObject({ settlement: "covered", amount: 10500, payee: { nodeId: "R" } });
    expect(v.flows.filter((f) => f.settlement === "wallet")).toHaveLength(0);
    expect(planCheck(v).difference).toBe(0);
  });

  it("indicação: % do preço final paga pelo vendedor, limitada ao resultado dele", () => {
    const p = planSale(snap(), { termsOf: T({ V: { referralKind: "percent", referralBps: 1000 } }), referrer: { nodeId: "C", name: "Contador" } });
    expect(p.flows.find((f) => f.kind === "referral")).toMatchObject({ payer: { nodeId: "V" }, payee: { nodeId: "C" }, amount: 1500 });
    expect(p.earnings.V).toBe(2500);
    const capped = planSale(snap(), { termsOf: T({ V: { referralKind: "fixed", referralCents: 9000 } }), referrer: { nodeId: "C", name: "Contador" } });
    expect(capped.flows.find((f) => f.kind === "referral")!.amount).toBe(4000);
    expect(planCheck(capped).difference).toBe(0);
  });

  it("visibilidade do plano: o nó não vê o custo AC, a plataforma nem os fluxos acima do pai", () => {
    const p = planSale(snap(), { termsOf: T() });
    const m = maskPlan(p, { levels }, { platform: false, myNodeId: "R" });
    expect(m.acCost).toBeNull();
    expect(m.flows.some((f) => f.kind === "ac_cost" || f.payer.type === "platform")).toBe(false);
    expect(m.flows.some((f) => f.payer.nodeId === "M")).toBe(false);
    expect(Object.keys(m.earnings).sort()).toEqual(["R", "V"]);
  });

  it("períodos: semanal, quinzenal (1 e 16) e mensal; corte = véspera do fechamento", () => {
    expect(lastClosingDay({ period: "biweekly", weekday: 1, monthDay: 1 }, "2026-10-29")).toBe("2026-10-16");
    expect(closingCutoff({ period: "biweekly", weekday: 1, monthDay: 1 }, "2026-10-29")).toBe("2026-10-15");
    expect(nextClosingDay({ period: "biweekly", weekday: 1, monthDay: 1 }, "2026-10-29")).toBe("2026-11-01");
    expect(closingCutoff({ period: "monthly", weekday: 1, monthDay: 5 }, "2026-10-03")).toBe("2026-09-04");
    expect(closingCutoff({ period: "monthly", weekday: 1, monthDay: 1 }, "2026-03-10")).toBe("2026-02-28");
    // 2026-10-29 é quinta-feira; fechamento às segundas
    expect(lastClosingDay({ period: "weekly", weekday: 1, monthDay: 1 }, "2026-10-29")).toBe("2026-10-26");
    expect(nextClosingDay({ period: "weekly", weekday: 1, monthDay: 1 }, "2026-10-26")).toBe("2026-11-02");
    expect(normalizeTerms({ mode: "commission", commissionRule: "percent", commissionBps: 0 }).errors.length).toBeGreaterThan(0);
    expect(normalizeTerms({ monthDay: 31 }).errors.join()).toMatch(/1 a 28/);
  });
});

// ----------------------------------------------------------------------------------------------------------- modalidade

describe("modalidade comercial por relação", () => {
  it("quem define: o pai com a operação ou a plataforma; vigência e histórico", async () => {
    await expect(saveBillingAgreement(ctxs.Juazeiro, nodes.Juazeiro.id, { mode: "postpaid" })).rejects.toThrow();
    await expect(saveBillingAgreement(ctxs.sellerCeara, nodes.Juazeiro.id, { mode: "postpaid" })).rejects.toThrow();
    await expect(saveBillingAgreement(ctxs.Master, nodes.Juazeiro.id, { mode: "postpaid" })).rejects.toThrow();
    await expect(saveBillingAgreement(ctxs.Ceara, nodes.Juazeiro.id, { mode: "prepaid", validFrom: addDays(today(), -1) })).rejects.toThrow(/vigência/);
    // agendada para o futuro: a vigente continua até a véspera
    await saveBillingAgreement(ctxs.Ceara, nodes.Juazeiro.id, { mode: "postpaid", validFrom: addDays(today(), 30), reason: "Migração combinada" });
    expect((await effectiveAgreement(store, nodes.Juazeiro.id)).terms.mode).toBe("prepaid");
    expect((await effectiveAgreement(store, nodes.Juazeiro.id, addDays(today(), 30))).terms.mode).toBe("postpaid");
    // no mesmo dia substitui (desfaz o agendamento ao regravar o pré-pago com a mesma vigência futura)
    await saveBillingAgreement(ctxs.Ceara, nodes.Juazeiro.id, { mode: "prepaid", overdraftLimit: 0, lowBalanceAlert: 15000, validFrom: addDays(today(), 30) });
    expect((await effectiveAgreement(store, nodes.Juazeiro.id, addDays(today(), 31))).terms.mode).toBe("prepaid");
    // o financeiro do pai (partner_finance) também define
    await saveBillingAgreement(ctxs.finCeara, nodes.Fortaleza.id, { mode: "postpaid", period: "biweekly", dueDays: 7, referralKind: "percent", referralBps: 1000 });
    expect((await effectiveAgreement(store, nodes.Fortaleza.id)).terms).toMatchObject({ mode: "postpaid", period: "biweekly", referralBps: 1000 });
    // sem registro: pós-pago mensal padrão
    expect((await effectiveAgreement(store, nodes.Contador.id)).source).toBe("default");
  });
});

// ------------------------------------------------------------------------------------------------------------ pré-pago

describe("pré-pago (Juazeiro com a Regional Ceará)", () => {
  it("sem saldo a venda é bloqueada; recarga lança a receber/a pagar e credita só na confirmação", async () => {
    await expect(sell(ctxs.sellerJua)).rejects.toThrow(/Saldo de créditos pré-pagos insuficiente/);
    const r = await requestRecharge(ctxs.Ceara, nodes.Juazeiro.id, { amount: 30000, idemKey: "rc-1" });
    expect(await requestRecharge(ctxs.Ceara, nodes.Juazeiro.id, { amount: 30000, idemKey: "rc-1" })).toMatchObject({ id: r.id });
    const rec = await store.get("titles", r.receivableTitleId);
    const pay = await store.get("titles", r.payableTitleId);
    expect(rec).toMatchObject({ companyId: companies.Ceara.id, kind: "receivable", total: 30000 });
    expect(pay).toMatchObject({ companyId: companies.Juazeiro.id, kind: "payable", total: 30000 });
    // categoria de adiantamento (fora do resultado do DRE)
    expect((await store.get("fin_categories", rec!.categoryId))!.dreGroup).toBe("Adiantamentos");
    expect((await wallet("Juazeiro"))!.balance).toBe(0);
    await expect(confirmRecharge(ctxs.Juazeiro, r.id, { ref: "PIX-1" })).rejects.toThrow();
    await confirmRecharge(ctxs.Ceara, r.id, { ref: "PIX-RC-1" });
    await confirmRecharge(ctxs.Ceara, r.id, { ref: "PIX-RC-1" });
    expect(await wallet("Juazeiro")).toMatchObject({ balance: 30000, available: 30000, held: 0 });
    expect((await store.get("titles", r.receivableTitleId))!.status).toBe("paid");
    // recarga pendente cancelada não credita
    const r2 = await requestRecharge(ctxs.Juazeiro, nodes.Juazeiro.id, { amount: 5000, idemKey: "rc-2" });
    await cancelRecharge(ctxs.Ceara, r2.id, "pedido em duplicidade");
    expect((await store.get("titles", r2.receivableTitleId))!.status).toBe("cancelled");
    expect((await wallet("Juazeiro"))!.balance).toBe(30000);
  });

  it("venda reserva o custo; pagamento debita; cancelamento libera; concorrência não passa do saldo", async () => {
    const a = await sell(ctxs.sellerJua);
    expect(await wallet("Juazeiro")).toMatchObject({ balance: 30000, held: 11000, available: 19000 });
    // título do cliente na empresa do vendedor
    const fin = (await saleFinance(store, a.id))!;
    expect(fin.collectorCompanyId).toBe(companies.Juazeiro.id);
    expect(await store.get("titles", fin.clientTitleId)).toMatchObject({ companyId: companies.Juazeiro.id, kind: "receivable", total: 15000, status: "open" });
    await confirmCertificatePayment(platform, a.id, { ref: "PIX-A" });
    expect(await wallet("Juazeiro")).toMatchObject({ balance: 19000, held: 0, available: 19000 });
    expect((await store.get("titles", fin.clientTitleId))!.status).toBe("paid");
    const e = await entriesOf(a.id);
    expect(e.find((x) => x.payerNodeId === nodes.Juazeiro.id)).toMatchObject({ settlement: "wallet", amount: 11000, status: "wallet" });
    expect(e.find((x) => x.payerNodeId === nodes.Ceara.id)).toMatchObject({ settlement: "accrual", amount: 9500, status: "accrued" });
    // repetir o pagamento não duplica nada
    const { onSalePaid } = await import("@/domain/network");
    await onSalePaid(platform, (await store.get("certificate_requests", a.id))!);
    expect((await entriesOf(a.id)).length).toBe(e.length);
    expect((await wallet("Juazeiro"))!.balance).toBe(19000);
    // cancelamento antes do pagamento libera a reserva e cancela o título do cliente
    const b = await sell(ctxs.sellerJua);
    expect((await wallet("Juazeiro"))!.available).toBe(8000);
    await cancelCertificateRequest(ctxs.sellerJua, b.id, { reason: "cliente desistiu" });
    expect(await wallet("Juazeiro")).toMatchObject({ balance: 19000, held: 0, available: 19000 });
    expect((await store.get("titles", (await saleFinance(store, b.id))!.clientTitleId))!.status).toBe("cancelled");
    // saldo para uma só venda: duas simultâneas → só uma passa
    await adjustWallet(ctxs.Ceara, nodes.Juazeiro.id, { amount: -8000, reason: "Ajuste de teste para saldo de uma venda", idemKey: "aj-1" });
    expect((await wallet("Juazeiro"))!.available).toBe(11000);
    const res = await Promise.allSettled([sell(ctxs.sellerJua), sell(ctxs.sellerJua)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await wallet("Juazeiro"))!.available).toBe(0);
    await expect(adjustWallet(ctxs.Ceara, nodes.Juazeiro.id, { amount: -1, reason: "Débito que estouraria o saldo", idemKey: "aj-2" })).rejects.toThrow(/limite/);
    await expect(adjustWallet(ctxs.Juazeiro, nodes.Juazeiro.id, { amount: 1000, reason: "o filho não ajusta a própria carteira", idemKey: "aj-3" })).rejects.toThrow();
    const ok = res.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<any>;
    await cancelCertificateRequest(ctxs.sellerJua, ok.value.id, { reason: "liberar o saldo" });
    expect((await wallet("Juazeiro"))!.available).toBe(11000);
  });

  it("DRE do pré-pago: débito é custo de quem vende e receita de quem está acima; recarga fica fora do resultado", async () => {
    const from = monthStart(today());
    const to = monthEnd(today());
    const jua = await computeDre(ctxs.Juazeiro, { from, to });
    const cost = jua.sections.find((s) => s.key === "Custo dos serviços")!;
    expect(cost.lines.find((l) => l.key === "__network_prepaid_cost")!.total).toBe(-11000);
    expect(jua.sections.find((s) => s.key === "Receita bruta")!.total).toBe(15000);
    expect(jua.outside.find((s) => s.key === "__advances")!.total).toBe(-30000);
    expect(jua.check.difference).toBe(0);
    const ce = await computeDre(ctxs.Ceara, { from, to });
    expect(ce.sections.find((s) => s.key === "Receita bruta")!.lines.find((l) => l.key === "__network_prepaid_revenue")!.total).toBe(11000);
    expect(ce.check.difference).toBe(0);
  });

  it("aviso de saldo baixo: idempotente por recarga", async () => {
    const before = (await listAll(store, "notifications", { filters: [["eq", "companyId", companies.Juazeiro.id]] })).filter((n) => String(n.title).includes("Saldo de créditos baixo")).length;
    await notifyLowBalances(store, companies.Juazeiro.id);
    await notifyLowBalances(store, companies.Juazeiro.id);
    const after = (await listAll(store, "notifications", { filters: [["eq", "companyId", companies.Juazeiro.id]] })).filter((n) => String(n.title).includes("Saldo de créditos baixo")).length;
    expect(after).toBeGreaterThan(before);
    const third = await notifyLowBalances(store, companies.Juazeiro.id);
    expect(third.alerts).toBe(0);
    expect((await listAll(store, "notifications", { filters: [["eq", "companyId", companies.Ceara.id]] })).some((n) => String(n.title).includes("Saldo de créditos baixo"))).toBe(true);
  });

  it("estorno da venda paga recredita a carteira e reverte todas as camadas", async () => {
    const r = await sellAndPay(ctxs.sellerJua);
    expect((await wallet("Juazeiro"))!.balance).toBe(0);
    await expect(reverseNetworkSale(ctxs.Juazeiro, r.id, { reason: "cliente pediu reembolso" })).rejects.toThrow();
    await expect(reverseNetworkSale(platform, r.id, { reason: "curto" })).rejects.toThrow(/motivo/);
    await reverseNetworkSale(platform, r.id, { reason: "Cliente pediu reembolso antes da validação" });
    await reverseNetworkSale(platform, r.id, { reason: "Cliente pediu reembolso antes da validação" });
    expect((await wallet("Juazeiro"))!.balance).toBe(11000);
    const req = (await store.get("certificate_requests", r.id))!;
    expect(req).toMatchObject({ status: "cancelled" });
    expect(req.reversedAt).toBeTruthy();
    const e = await entriesOf(r.id);
    for (const p of e.filter((x) => x.event === "paid")) expect(e.find((x) => x.event === "reversal" && x.flowKey === p.flowKey)!.amount).toBe(-p.amount);
    const clientTitle = await store.get("titles", (await saleFinance(store, r.id))!.clientTitleId);
    expect(clientTitle!.status).toBe("cancelled");
    expect((await saleFinance(store, r.id))!.status).toBe("reversed");
  });
});

// ------------------------------------------------------------------------------------------------------------ pós-pago

describe("pós-pago quinzenal (Fortaleza) e fechamento", () => {
  let first: any;
  it("venda paga acumula o custo; fechamento gera UM título nas duas pontas, idempotente", async () => {
    first = await sellAndPay(ctxs.sellerFtz);
    const rel = flowKey("cost", party("Fortaleza"), party("Ceara"));
    const pv = await relationPreview(store, rel);
    expect(pv.total).toBe(11000);
    const c1 = await closeRelation(ctxs.Ceara, rel, today(), { manual: true });
    const c2 = await closeRelation(ctxs.Ceara, rel, today(), { manual: true });
    // repetir: nada mais a fechar (os lançamentos já estão no fechamento) — nenhum título novo
    expect(c2.closing).toBeNull();
    expect(await listAll(store, "cert_closings", { filters: [["eq", "relationKey", rel]] })).toHaveLength(1);
    expect(c1.closing).toMatchObject({ total: 11000, count: 1, status: "closed", payerNodeId: nodes.Fortaleza.id, payeeNodeId: nodes.Ceara.id });
    const pay = await store.get("titles", c1.closing!.payableTitleId);
    const rec = await store.get("titles", c1.closing!.receivableTitleId);
    expect(pay).toMatchObject({ companyId: companies.Fortaleza.id, kind: "payable", total: 11000 });
    expect(rec).toMatchObject({ companyId: companies.Ceara.id, kind: "receivable", total: 11000 });
    expect((await titlesOf(companies.Fortaleza.id, "cert_closing")).length).toBe(1);
    expect((await store.get("fin_categories", pay!.categoryId))!.dreGroup).toBe("Custo dos serviços");
    // nada mais a fechar
    expect((await relationPreview(store, rel)).entries).toHaveLength(0);
    // o filho vê o próprio fechamento; o vendedor sem consulta financeira não
    expect((await readClosing(ctxs.Fortaleza, c1.closing!.id)).entries).toHaveLength(1);
    await expect(readClosing(ctxs.sellerFtz, c1.closing!.id)).rejects.toThrow();
    await expect(readClosing(ctxs.Salvador, c1.closing!.id)).rejects.toThrow();
  });

  it("venda estornada depois do fechamento entra como crédito no próximo", async () => {
    await reverseNetworkSale(platform, first.id, { reason: "Titular desistiu antes da validação" });
    const rel = flowKey("cost", party("Fortaleza"), party("Ceara"));
    expect((await relationPreview(store, rel)).total).toBe(-11000);
    // só crédito: nada a faturar, o crédito é transportado
    expect((await closeRelation(ctxs.Ceara, rel, today())).carried).toBe(-11000);
    await sellAndPay(ctxs.sellerFtz);
    await sellAndPay(ctxs.sellerFtz);
    // rotina: o corte quinzenal de daqui a 16 dias cobre hoje; repetir não duplica
    const ref = addDays(today(), 16);
    await closeDueRelations(store, companies.Fortaleza.id, ref);
    await closeDueRelations(store, companies.Fortaleza.id, ref);
    const closings = (await listAll(store, "cert_closings", { filters: [["eq", "relationKey", rel]] })).sort((a, b) => String(a.periodTo).localeCompare(String(b.periodTo)));
    expect(closings).toHaveLength(2);
    expect(closings[1]).toMatchObject({ total: 11000, count: 3 });
    expect((await titlesOf(companies.Fortaleza.id, "cert_closing")).filter((t) => t.status !== "cancelled")).toHaveLength(2);
  });

  it("indicação do contador: comissão acumulada do vendedor ao indicador, fechada no período", async () => {
    await expect(sell(ctxs.sellerFtz, { referrerNodeId: nodes.Juazeiro.id })).rejects.toThrow(/Indicação/);
    const r = await sellAndPay(ctxs.sellerFtz, { referrerNodeId: nodes.Contador.id });
    expect(r.referrerNodeId).toBe(nodes.Contador.id);
    const ref = (await entriesOf(r.id)).find((e) => e.kind === "referral")!;
    expect(ref).toMatchObject({ payerNodeId: nodes.Fortaleza.id, payeeNodeId: nodes.Contador.id, amount: 1500, status: "accrued", payeeCompanyId: companies.Contador.id });
    const c = await closeRelation(ctxs.Fortaleza, ref.relationKey, today(), { manual: true });
    expect(await store.get("titles", c.closing!.receivableTitleId)).toMatchObject({ companyId: companies.Contador.id, kind: "receivable", total: 1500 });
    expect(await store.get("titles", c.closing!.payableTitleId)).toMatchObject({ companyId: companies.Fortaleza.id, kind: "payable", total: 1500 });
  });

  it("Tela 67 do contador (pós-pago padrão com Fortaleza): título do cliente no escritório e custo acumulado", async () => {
    const client = await createClient(ctxs.Contador, { personType: "PF", doc: nextCpf(), name: "Cliente do contador", status: "active", onboardedAt: today() });
    const r = await createCertificateRequest(ctxs.Contador, { clientId: client.id, kind: "new", product: P, dueDate: addDays(today(), 3) });
    const fin = (await saleFinance(store, r.id))!;
    expect(fin.collectorCompanyId).toBe(companies.Contador.id);
    expect((await store.get("titles", fin.clientTitleId))!.companyId).toBe(companies.Contador.id);
    await expect(confirmCertificatePayment(platform, r.id, { ref: "PIX-T67", amount: 14000 })).rejects.toThrow(/valor cobrado/);
    await confirmCertificatePayment(platform, r.id, { ref: "PIX-T67" });
    const e = await entriesOf(r.id);
    expect(e.find((x) => x.payerNodeId === nodes.Contador.id)).toMatchObject({ kind: "cost", amount: 12000, payeeNodeId: nodes.Fortaleza.id, status: "accrued" });
  });
});

// --------------------------------------------------------------------------------------------------------- comissionado

describe("comissionado (Bahia): split e período", () => {
  it("split: o cliente paga a Bahia; a comissão de Salvador já cai baixada nas duas pontas (a conciliar)", async () => {
    const r = await sellAndPay(ctxs.sellerSsa);
    const fin = (await saleFinance(store, r.id))!;
    expect(fin.collectorCompanyId).toBe(companies.Bahia.id);
    expect(await store.get("titles", fin.clientTitleId)).toMatchObject({ companyId: companies.Bahia.id, total: 15000, status: "paid" });
    const com = (await entriesOf(r.id)).find((e) => e.kind === "commission")!;
    expect(com).toMatchObject({ settlement: "split", status: "split", reconcile: "pending", amount: 4000, payerNodeId: nodes.Bahia.id, payeeNodeId: nodes.Salvador.id });
    const [payId, recId] = com.titleIds;
    expect(await store.get("titles", payId)).toMatchObject({ companyId: companies.Bahia.id, kind: "payable", total: 4000, status: "paid" });
    expect(await store.get("titles", recId)).toMatchObject({ companyId: companies.Salvador.id, kind: "receivable", total: 4000, status: "paid" });
    // Salvador não cobra o cliente: nenhum título de cliente na empresa dele
    expect((await titlesOf(companies.Salvador.id, "certificate_request")).length).toBe(0);
    // estorno em cascata desfaz o split e devolve ao cliente
    await reverseNetworkSale(platform, r.id, { reason: "Pagamento contestado pelo titular" });
    expect((await store.get("titles", payId))!.status).toBe("cancelled");
    expect((await store.get("titles", recId))!.status).toBe("cancelled");
    expect((await store.get("titles", fin.clientTitleId))!.status).toBe("cancelled");
  });

  it("período: comissão acumulada e fechada como a pagar da Bahia / a receber de Recife", async () => {
    const r = await sellAndPay(ctxs.sellerRec);
    const com = (await entriesOf(r.id)).find((e) => e.kind === "commission")!;
    expect(com).toMatchObject({ settlement: "accrual", status: "accrued", amount: 4000 });
    const c = await closeRelation(ctxs.Bahia, com.relationKey, today(), { manual: true });
    expect(await store.get("titles", c.closing!.payableTitleId)).toMatchObject({ companyId: companies.Bahia.id, total: 4000 });
    expect(await store.get("titles", c.closing!.receivableTitleId)).toMatchObject({ companyId: companies.Recife.id, total: 4000 });
  });
});

// --------------------------------------------------------------------------------------------------- plataforma e AC

describe("plataforma: receita Intercert, custo AC e invariante", () => {
  it("custo AC acumulado e fechado mensalmente como a pagar ao fornecedor na empresa da Intercert", async () => {
    const acc = (await listAll(store, "cert_fin_entries", { filters: [["eq", "kind", "ac_cost"], ["eq", "status", "accrued"]] }));
    const net = acc.reduce((a, e) => a + e.amount, 0);
    expect(net).toBeGreaterThan(0);
    const ref = addDays(monthEnd(today()), 1);
    await closeDueRelations(store, platCompanyId, ref);
    const closing = (await listAll(store, "cert_closings", { filters: [["eq", "kind", "ac_cost"]] }))[0];
    expect(closing).toMatchObject({ total: net, payerType: "platform", payeeType: "supplier" });
    const t = (await store.get("titles", closing.payableTitleId))!;
    expect(t).toMatchObject({ companyId: platCompanyId, kind: "payable", total: net, partyType: "supplier" });
    expect(closing.receivableTitleId ?? null).toBeNull();
    // receita da plataforma: o custo do Master também é fechado (a receber na Intercert)
    const masterRel = flowKey("cost", party("Master"), PLAT);
    await closeDueRelations(store, companies.Master.id, ref);
    const mc = (await listAll(store, "cert_closings", { filters: [["eq", "relationKey", masterRel]] }))[0];
    expect(await store.get("titles", mc.receivableTitleId)).toMatchObject({ companyId: platCompanyId, kind: "receivable" });
  });

  it("resultado da rede: preço pago pelos clientes = Σ margens das camadas + custo AC; nó não vê acima do pai", async () => {
    const from = monthStart(today());
    const to = monthEnd(today());
    const all = await networkResult(platform, { from, to });
    expect(all.totals.difference).toBe(0);
    expect(all.totals.clientPaid).toBe(all.totals.sumMargins + (all.totals.acCost ?? 0));
    expect(all.rows.some((r) => r.key === "platform")).toBe(true);
    const ce = await networkResult(ctxs.Ceara, { from, to });
    expect(ce.totals.acCost).toBeNull();
    expect(ce.rows.map((r) => r.key).sort()).toEqual([nodes.Ceara.id, nodes.Contador.id, nodes.Fortaleza.id, nodes.Juazeiro.id].sort());
    const ceRow = ce.rows.find((r) => r.key === nodes.Ceara.id)!;
    expect(ceRow.costUp).toBeGreaterThan(0); // o próprio custo pago ao Master é visível
    const ftz = await networkResult(ctxs.Fortaleza, { from, to });
    expect(ftz.rows.map((r) => r.key).sort()).toEqual([nodes.Contador.id, nodes.Fortaleza.id].sort());
    await expect(networkResult(ctxs.sellerFtz, { from, to })).rejects.toThrow();
    // o gestor (consulta) vê
    expect((await networkResult(ctxs.managerFtz, { from, to })).rows.length).toBe(2);
  });

  it("financeiro da relação: pai e filho veem; vendedor e irmão não", async () => {
    const asParent = await relationFinance(ctxs.Ceara, nodes.Juazeiro.id);
    expect(asParent).toMatchObject({ canBill: true, asChild: false });
    expect(asParent.agreement.terms.mode).toBe("prepaid");
    expect(asParent.moves.length).toBeGreaterThan(0);
    const asChild = await relationFinance(ctxs.Juazeiro, nodes.Juazeiro.id);
    expect(asChild).toMatchObject({ canBill: false, asChild: true, canRecharge: true });
    await expect(relationFinance(ctxs.Fortaleza, nodes.Juazeiro.id)).rejects.toThrow();
    await expect(relationFinance(ctxs.sellerJua, nodes.Juazeiro.id)).rejects.toThrow();
  });
});

describe("voucher e cupom no financeiro", () => {
  it("voucher: custo coberto pelo pacote não é debitado da carteira; cupom de cima absorvido pelo emissor", async () => {
    const pkg = await createVoucherPackage(ctxs.Ceara, { name: "Pacote teste", validTo: addDays(today(), 30), items: [{ productKey: P, qty: 2, unitPrice: 10500 }], recipientNodeId: nodes.Juazeiro.id });
    await purchaseVoucherPackage(ctxs.Juazeiro, pkg.id, { idemKey: "pkg-billing" });
    const before = (await wallet("Juazeiro"))!;
    const r = await sellAndPay(ctxs.sellerJua, { voucher: "balance" });
    expect((await wallet("Juazeiro"))!.balance).toBe(before.balance);
    const e = await entriesOf(r.id);
    expect(e.find((x) => x.payerNodeId === nodes.Juazeiro.id)).toMatchObject({ settlement: "covered", amount: 10500 });
    expect(e.find((x) => x.payerNodeId === nodes.Ceara.id)).toMatchObject({ settlement: "accrual", amount: 9500 });
    // cupom da Regional para Fortaleza abaixo do mínimo: a Regional absorve
    await createCoupon(ctxs.Ceara, { code: "BILL30", kind: "fixed", valueCents: 3500, nodeId: nodes.Fortaleza.id, validTo: addDays(today(), 10), maxUses: 5 });
    const s = await sellAndPay(ctxs.sellerFtz, { couponCode: "BILL30" });
    expect(s.amount).toBe(11500);
    const ftzCost = (await entriesOf(s.id)).find((x) => x.payerNodeId === nodes.Fortaleza.id && x.kind === "cost")!;
    expect(ftzCost.amount).toBe(10500);
    const plan = (await saleFinance(store, s.id))!.plan;
    expect(planCheck(plan).difference).toBe(0);
  });

  it("aprovação da validação não mexe no financeiro; estorno só antes da emissão", async () => {
    const r = await sellAndPay(ctxs.sellerFtz);
    const n = (await entriesOf(r.id)).length;
    await approveCertificateValidation(platform, r.id);
    expect((await entriesOf(r.id)).length).toBe(n);
    await reverseNetworkSale(platform, r.id, { reason: "Estorno antes de pedir a emissão" });
    expect((await store.get("certificate_requests", r.id))!.status).toBe("cancelled");
  });
});
