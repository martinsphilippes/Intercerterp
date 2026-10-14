import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { setSetting } from "@/lib/core/settings";
import { addDays, formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { openSession } from "@/domain/cash";
import { finalizeSale, type FinalizeSaleInput } from "@/domain/sales";
import { createTitle, lateChargeParams, suggestLateCharges } from "@/domain/finance";
import { customerOverdueStatus, overdueParams } from "@/domain/delinquency";
import { overdueBlocks, summarizeOverdue, OVERDUE_DEFAULTS } from "@/domain/overdue";
import { collectionDraftFor, recordWhatsappCollection, saveCollectionTemplates, loadCollectionTemplates } from "@/domain/collection";
import { DEFAULT_COLLECTION_TEMPLATES, renderCollectionTemplate } from "@/domain/collection-templates";
import { whatsappUrl } from "@/lib/whatsapp";
import { notifyDelinquentCustomers } from "@/domain/routines/finance";
import { DEFAULT_ROLES } from "@/lib/permissions";

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let finance: Ctx;
let terminalId: string;
const t0 = today();

/** Parcela a receber do cliente vencida há `daysLate` dias (título de venda antiga). */
async function overdueInstallment(customerKey: string, daysLate: number, amount: number, key: string) {
  const c = refs.customers[customerKey];
  const t = await createTitle(manager, {
    kind: "receivable", partyType: "customer", partyId: c.id, partyName: c.name, description: `Venda nº 9${key.length}${daysLate}`, originType: "sale", installments: [{ amount, dueDate: addDays(t0, -daysLate) }], idemKey: `od-${key}`, branchId: refs.branches.matriz.id,
  });
  return (await listAll(store, "installments", { filters: [["eq", "titleId", t.id]] }))[0];
}

const policy = (v: string) => setSetting(store, refs.company.id, null, "sales.overduePolicy", v);

function sell(ctx: Ctx, idemKey: string, kind: "cash" | "crediario", extra: Partial<FinalizeSaleInput> = {}) {
  const payments = kind === "cash" ? [{ methodId: refs.methods.dinheiro.id, amount: 4990, received: 5000 }] : [{ methodId: refs.methods.crediario.id, amount: 4990, paymentTermId: refs.terms["crediario-3x"].id }];
  return finalizeSale(ctx, { terminalId, idemKey, customerId: refs.customers.maria.id, items: [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 1000 }], payments, ...extra });
}

const audits = async (action: string) => listAll(store, "audit_logs", { filters: [["eq", "action", action]] });

describe("inadimplência na venda (VEN-07)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    finance = await refs.ctxFor("finance", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("padrão: recurso ligado, política “avisar”, tolerância de 5 dias e qualquer valor", async () => {
    expect(await overdueParams(store, refs.company.id, refs.branches.matriz.id)).toEqual({ enabled: true, policy: "warn", graceDays: 5, minAmount: 0 });
    expect(OVERDUE_DEFAULTS.policy).toBe("warn");
  });

  it("tolerância de dias e valor mínimo vencido definem a inadimplência", async () => {
    await overdueInstallment("maria", 3, 10000, "a"); // dentro da tolerância de 5 dias
    let st = await customerOverdueStatus(store, refs.company.id, refs.branches.matriz.id, refs.customers.maria.id);
    expect(st).toMatchObject({ delinquent: false, total: 0, overdueTotal: 10000, overdueCount: 1 });
    await overdueInstallment("maria", 12, 2500, "b");
    st = await customerOverdueStatus(store, refs.company.id, refs.branches.matriz.id, refs.customers.maria.id);
    expect(st).toMatchObject({ delinquent: true, total: 2500, count: 1, maxDaysLate: 12, overdueTotal: 12500, oldestDueDate: addDays(t0, -12) });
    // valor mínimo acima do vencido além da tolerância: deixa de ser inadimplente
    await setSetting(store, refs.company.id, null, "sales.overdueMinAmount", 3000);
    expect((await customerOverdueStatus(store, refs.company.id, refs.branches.matriz.id, refs.customers.maria.id)).delinquent).toBe(false);
    // tolerância por filial (sobrepõe a empresa): 2 dias → as duas parcelas contam
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "sales.overdueGraceDays", 2);
    expect(await customerOverdueStatus(store, refs.company.id, refs.branches.matriz.id, refs.customers.maria.id)).toMatchObject({ delinquent: true, total: 12500, count: 2 });
    // parcela quitada/cancelada não conta; política "nenhuma" nunca marca inadimplente
    const pure = summarizeOverdue([{ dueDate: addDays(t0, -30), balance: 900, status: "paid" }, { dueDate: addDays(t0, -30), balance: 900, status: "open" }], { enabled: true, policy: "none", graceDays: 0, minAmount: 0 }, t0);
    expect(pure).toMatchObject({ total: 900, count: 1, delinquent: false });
    expect(overdueBlocks({ delinquent: true, policy: "block_deferred" }, false)).toBe(false);
    expect(overdueBlocks({ delinquent: true, policy: "block_deferred" }, true)).toBe(true);
    expect(overdueBlocks({ delinquent: true, policy: "block_all" }, false)).toBe(true);
    expect(overdueBlocks({ delinquent: true, policy: "warn" }, true)).toBe(false);
  });

  it("política “nenhuma”: vende a prazo sem consulta nem registro", async () => {
    await overdueInstallment("maria", 20, 5000, "n");
    await policy("none");
    const s = await sell(cashier, "n-1", "crediario");
    expect(s.status).toBe("completed");
    expect(await audits("sale.overdue_warning")).toHaveLength(0);
  });

  it("política “avisar”: a venda a prazo conclui e fica registrada; à vista não gera aviso", async () => {
    await overdueInstallment("maria", 20, 5000, "w");
    await sell(cashier, "w-cash", "cash");
    expect(await audits("sale.overdue_warning")).toHaveLength(0);
    const s = await sell(cashier, "w-1", "crediario");
    expect(s.status).toBe("completed");
    const w = await audits("sale.overdue_warning");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ entityId: s.id, after: expect.objectContaining({ overdueTotal: 5000, maxDaysLate: 20, policy: "warn", deferred: true }) });
    expect(w[0].related).toContain(`customer:${refs.customers.maria.id}`);
  });

  it("bloquear a prazo: crediário bloqueado no servidor, venda à vista liberada; recurso desligado não bloqueia", async () => {
    await overdueInstallment("maria", 10, 5000, "bd");
    await policy("block_deferred");
    await expect(sell(cashier, "bd-1", "crediario")).rejects.toMatchObject({ code: "overdue_block" });
    await expect(sell(cashier, "bd-1", "crediario")).rejects.toThrow(/Venda a prazo bloqueada.*R\$\s?50,00 vencido há 10 dia/);
    expect(await store.list("sales", { filters: [["eq", "idemKey", "bd-1"]] }).then((r) => r.total)).toBe(0);
    const cash = await sell(cashier, "bd-cash", "cash");
    expect(cash.status).toBe("completed");
    // cliente dentro da tolerância não é bloqueado
    await setSetting(store, refs.company.id, null, "sales.overdueGraceDays", 15);
    expect((await sell(cashier, "bd-2", "crediario")).status).toBe("completed");
    await setSetting(store, refs.company.id, null, "sales.overdueGraceDays", 5);
    await setSetting(store, refs.company.id, null, "feature.inadimplencia", false);
    expect((await sell(cashier, "bd-3", "crediario")).status).toBe("completed");
  });

  it("bloquear qualquer venda: à vista também é bloqueada; consumidor final não é avaliado", async () => {
    await overdueInstallment("maria", 40, 7000, "ba");
    await policy("block_all");
    await expect(sell(cashier, "ba-1", "cash")).rejects.toMatchObject({ code: "overdue_block" });
    await expect(sell(cashier, "ba-1", "cash")).rejects.toThrow(/^Venda bloqueada/);
    const anon = await finalizeSale(cashier, { terminalId, idemKey: "ba-anon", items: [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4990, received: 5000 }] });
    expect(anon.status).toBe("completed");
  });

  it("liberação: exige motivo e a permissão “Liberar venda para cliente inadimplente”, com auditoria", async () => {
    await overdueInstallment("maria", 10, 5000, "r");
    await policy("block_deferred");
    expect(DEFAULT_ROLES.find((r) => r.key === "manager")!.actions).toContain("sale.overdue_override");
    expect(DEFAULT_ROLES.find((r) => r.key === "cashier")!.actions).not.toContain("sale.overdue_override");
    // caixa sem a permissão, sem autorizador
    await expect(sell(cashier, "r-1", "crediario", { overdueRelease: { reason: "Cliente vai quitar sexta" } })).rejects.toMatchObject({ code: "overdue_override_denied" });
    // motivo obrigatório
    await expect(sell(manager, "r-1", "crediario", { overdueRelease: { reason: " " } })).rejects.toMatchObject({ code: "overdue_reason" });
    // autorizador com senha errada / sem permissão: recusado e registrado
    await expect(sell(cashier, "r-1", "crediario", { overdueRelease: { reason: "Cliente vai quitar sexta", approval: { login: "gerente", password: "errada" } } })).rejects.toThrow(/inválidos/);
    await expect(sell(cashier, "r-1", "crediario", { overdueRelease: { reason: "Cliente vai quitar sexta", approval: { login: "estoque", password: "Intercert@2026" } } })).rejects.toThrow(/permissão/);
    expect((await audits("supervisor.denied")).length).toBe(2);
    expect(await audits("sale.overdue_release")).toHaveLength(0);
    // gerente autoriza no terminal do caixa
    const s = await sell(cashier, "r-1", "crediario", { overdueRelease: { reason: "Cliente vai quitar sexta", approval: { login: "gerente", password: "Intercert@2026" } } });
    expect(s.status).toBe("completed");
    const rel = await audits("sale.overdue_release");
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ entityId: s.id, userId: cashier.user.id, reason: "Cliente vai quitar sexta", after: expect.objectContaining({ releasedBy: refs.users.manager.id, overdueTotal: 5000, policy: "block_deferred" }) });
    expect(rel[0].summary).toMatch(/liberada para cliente inadimplente.*Gustavo Gerente a pedido de Carla Caixa/);
    // o próprio gerente (com a permissão) libera informando só o motivo
    const s2 = await sell(manager, "r-2", "crediario", { overdueRelease: { reason: "Acordo de pagamento" } });
    expect(s2.status).toBe("completed");
    expect(await audits("sale.overdue_release")).toHaveLength(2);
    // repetir a conclusão devolve a mesma venda sem nova liberação
    await sell(manager, "r-2", "crediario", { overdueRelease: { reason: "Acordo de pagamento" } });
    expect(await audits("sale.overdue_release")).toHaveLength(2);
  });

  it("rotina diária avisa clientes que entraram em inadimplência e resolve quando regularizam", async () => {
    await overdueInstallment("joao", 2, 3000, "rt0"); // dentro da tolerância: não avisa
    const inst = await overdueInstallment("maria", 9, 4000, "rt1");
    const r1 = await notifyDelinquentCustomers(store, refs.company.id);
    expect(r1.delinquentCustomers).toBe(1);
    const open = (await listAll(store, "notifications", {})).filter((n) => n.occurrenceKey === `delinquent:${refs.customers.maria.id}` && n.occurrenceStatus === "open");
    expect(open.length).toBeGreaterThan(0);
    expect(open[0].title).toMatch(/Cliente inadimplente: Maria/);
    // repetir não duplica
    expect((await notifyDelinquentCustomers(store, refs.company.id)).notified).toBe(0);
    await store.update("installments", inst.id, { status: "paid", balance: 0 });
    const r2 = await notifyDelinquentCustomers(store, refs.company.id);
    expect(r2.resolved).toBeGreaterThan(0);
    expect((await listAll(store, "notifications", {})).filter((n) => n.occurrenceKey === `delinquent:${refs.customers.maria.id}` && n.occurrenceStatus === "open")).toHaveLength(0);
  });
});

describe("cobrança pelo WhatsApp com modelos (PLA-27)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    manager = await refs.ctxFor("manager", "matriz");
    finance = await refs.ctxFor("finance", "matriz");
    cashier = await refs.ctxFor("cashier", "matriz");
  });

  it("variáveis substituídas, linha sem valor omitida e link wa.me codificado", () => {
    const text = renderCollectionTemplate("Olá, {cliente}! Valor {valor}, vence {vencimento}.\nPix: {link_pix}\n{desconhecida} {empresa}", { cliente: "Ana & Cia", valor: "R$ 10,00", vencimento: "01/02/2026", empresa: "Loja", link_pix: null });
    expect(text).toBe("Olá, Ana & Cia! Valor R$ 10,00, vence 01/02/2026.\n{desconhecida} Loja");
    const url = whatsappUrl("(11) 98765-4321", text)!;
    expect(url.startsWith("https://wa.me/5511987654321?text=")).toBe(true);
    expect(url).toContain("Ana%20%26%20Cia");
    expect(url).toContain("%0A");
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(text);
    expect(whatsappUrl("123", "x")).toBeNull();
    expect(whatsappUrl("+55 11 98765-4321", "x")).toBe("https://wa.me/5511987654321?text=x");
  });

  it("mensagem da parcela vencida usa o valor atualizado (multa e juros sugeridos) e os modelos editados", async () => {
    const c = refs.customers.maria;
    const due = addDays(t0, -12);
    const t = await createTitle(manager, { kind: "receivable", partyType: "customer", partyId: c.id, partyName: c.name, description: "Venda nº 321", originType: "sale", installments: [{ amount: 10000, dueDate: due }, { amount: 10000, dueDate: addDays(t0, 18) }], idemKey: "wa-1", branchId: refs.branches.matriz.id });
    const insts = (await listAll(store, "installments", { filters: [["eq", "titleId", t.id]] })).sort((a, b) => a.number - b.number);
    const ch = suggestLateCharges(due, t0, 10000, await lateChargeParams(store, refs.company.id, refs.branches.matriz.id));
    const d1 = await collectionDraftFor(finance, insts[0].id);
    expect(d1.suggested).toBe("overdue");
    expect(d1.amount).toBe(10000 + ch.fine + ch.interest);
    expect(d1.daysLate).toBe(12);
    expect(d1.phone).toBe(c.mobile);
    expect(d1.messages.overdue).toContain(`Olá, ${c.name}`);
    expect(d1.messages.overdue).toContain(formatMoney(10000 + ch.fine + ch.interest));
    expect(d1.messages.overdue).toContain(formatDate(due));
    expect(d1.messages.overdue).toContain("12 dia(s) de atraso");
    expect(d1.messages.overdue).toContain("parcela 1/2 (Venda nº 321)");
    expect(d1.messages.overdue).not.toContain("{");
    expect(d1.messages.overdue).not.toContain("Pix"); // sem chave Pix configurada: linha omitida
    const d2 = await collectionDraftFor(finance, insts[1].id);
    expect(d2.suggested).toBe("reminder");
    expect(d2.amount).toBe(10000);
    // modelos editados (empresa) e link Pix
    expect(await saveCollectionTemplates(finance, { overdue: "Oi {cliente}, {valor} em atraso há {dias_atraso} dias. Pix: {link_pix}", pixLink: "pix@loja.com.br" }, "teste")).toBe(true);
    expect(await saveCollectionTemplates(finance, { overdue: "Oi {cliente}, {valor} em atraso há {dias_atraso} dias. Pix: {link_pix}", pixLink: "pix@loja.com.br" })).toBe(false);
    const saved = await loadCollectionTemplates(store, refs.company.id, null);
    expect(saved.reminder).toBe(DEFAULT_COLLECTION_TEMPLATES.reminder);
    const d3 = await collectionDraftFor(finance, insts[0].id);
    expect(d3.messages.overdue).toBe(`Oi ${c.name}, ${formatMoney(10000 + ch.fine + ch.interest)} em atraso há 12 dias. Pix: pix@loja.com.br`);
    expect((await audits("setting.update")).some((a) => a.summary.includes("Modelos de mensagem de cobrança"))).toBe(true);
    await expect(saveCollectionTemplates(finance, { overdue: " " })).rejects.toThrow(/escreva a mensagem/);
    await expect(saveCollectionTemplates(cashier, { overdue: "x" })).rejects.toThrow(/permiss/i);
  });

  it("registra o contato no histórico do título (mesmo registro do aviso de cobrança) e devolve o link", async () => {
    const c = refs.customers.joao;
    const t = await createTitle(manager, { kind: "receivable", partyType: "customer", partyId: c.id, partyName: c.name, description: "Venda nº 77", originType: "sale", installments: [{ amount: 5000, dueDate: addDays(t0, -3) }], idemKey: "wa-2", branchId: refs.branches.matriz.id });
    const inst = (await listAll(store, "installments", { filters: [["eq", "titleId", t.id]] }))[0];
    const draft = await collectionDraftFor(finance, inst.id);
    const r = await recordWhatsappCollection(finance, inst.id, { template: "overdue", phone: draft.phone!, message: draft.messages.overdue });
    expect(r.url).toBe(whatsappUrl(draft.phone, draft.messages.overdue));
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "action", "title.collection_notice"], ["eq", "entityId", t.id]] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: "title", result: "success", after: expect.objectContaining({ channel: "whatsapp", template: "overdue", message: draft.messages.overdue }) });
    expect(logs[0].summary).toMatch(/parcela 1\/1 aberta no WhatsApp/);
    expect(logs[0].related).toEqual(expect.arrayContaining([`installment:${inst.id}`, `customer:${c.id}`]));
    // validações: telefone inválido, sem permissão, recurso desligado, parcela quitada
    await expect(recordWhatsappCollection(finance, inst.id, { template: "overdue", phone: "123", message: "x" })).rejects.toMatchObject({ code: "invalid_phone" });
    await expect(recordWhatsappCollection(finance, inst.id, { template: "xpto", phone: draft.phone!, message: "x" })).rejects.toThrow(/Modelo/);
    await expect(recordWhatsappCollection(cashier, inst.id, { template: "overdue", phone: draft.phone!, message: "x" })).rejects.toThrow(/permiss/i);
    await setSetting(store, refs.company.id, null, "feature.cobrancaWhatsapp", false);
    await expect(recordWhatsappCollection(finance, inst.id, { template: "overdue", phone: draft.phone!, message: "x" })).rejects.toMatchObject({ code: "feature_off" });
    await setSetting(store, refs.company.id, null, "feature.cobrancaWhatsapp", true);
    await store.update("installments", inst.id, { status: "paid", balance: 0 });
    await expect(recordWhatsappCollection(finance, inst.id, { template: "overdue", phone: draft.phone!, message: "x" })).rejects.toThrow(/não está em aberto/);
  });
});
