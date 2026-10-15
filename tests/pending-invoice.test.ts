import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { addDays, toLocalDate, today } from "@/lib/dates";
import { searchable } from "@/lib/core/text";
import { setSetting } from "@/lib/core/settings";
import { QTY, roundDiv } from "@/lib/money";
import { openSession } from "@/domain/cash";
import { balanceId } from "@/domain/stock";
import { finalizeSale, prepareSale, type SaleItemInput } from "@/domain/sales";
import { priceScopeKey } from "@/domain/pricing";
import { approvePayable, settleInstallment } from "@/domain/finance";
import { setClosedUntil } from "@/domain/period-close";
import { buildSampleNfeXml } from "@/domain/nfe-xml";
import { entriesBook } from "@/domain/fiscal/entries";
import { canDo } from "@/lib/permissions";
import { ACTIONS_ADDED_TO_TEMPLATES } from "@/lib/auth/role-sync";
import { DEFAULT_ROLES } from "@/lib/permissions";
import {
  analyzeInvoice, cancelScheduledEntry, confirmPendingInvoice, createPendingInvoiceEntry, incomingMap, occurrenceKeyFor, pendingState, realizeEntry, runPendingInvoiceRoutine,
} from "@/domain/pending-invoice";
import { seed as seedPendingInvoice } from "@/domain/seed/modules/pending-invoice";

/**
 * §40 — entrada de mercadoria com nota a confirmar: entrada realizada (estoque, custo médio, título provisório),
 * entrada prevista (a chegar, título previsto) realizada pela rotina, venda antes da nota com documento fiscal,
 * confirmação com a nota (igual, custo diferente, quantidade diferente), título corrigido (autorização mantida), nota
 * confirmada antes da data da entrada prevista, aviso configurável, permissões e período fechado.
 */

const MATRIZ_CNPJ = "11222333000181";
const PAPEL_CNPJ = "33000167000101";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let cashier: Ctx;
let stockist: Ctx;
let terminalId: string;
let princ: Doc;

const bal = async (warehouseId: string, skuId: string) => (await store.get("stock_balances", balanceId(warehouseId, skuId))) ?? ({ physical: 0, reserved: 0, avgCost: 0 } as any);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Produto com saldo zero e preço (custo médio previsível). */
async function product(key: string, name: string, price: number, barcode?: string) {
  const base = { companyId: refs.company.id, createdBy: refs.users.admin.id };
  const ref = refs.products["caderno"];
  const p = await refs.seeder.put("products", key, {
    ...base, type: "product", code: key.toUpperCase(), name, unitCode: "UN", categoryId: ref.categoryId, active: true, availablePdv: true, hasVariants: false, variantAxes: [],
    ncm: "48202000", origin: "0", taxGroupId: ref.taxGroupId, searchText: searchable(name, key), status: "active",
  });
  const k = await refs.seeder.put("skus", `${key}-u`, { ...base, productId: p.id, sku: key.toUpperCase(), attributes: {}, name, unitCode: "UN", active: true, costAcquisition: 0, costAdditional: 0, costTotal: 0, searchText: searchable(name, key), ...(barcode ? { barcode } : {}) });
  await refs.seeder.put("prices", `varejo-${key}`, { ...base, priceTableId: refs.priceTables.varejo.id, skuId: k.id, productId: p.id, scopeKey: priceScopeKey(refs.priceTables.varejo.id, k.id, null, null), price, maxDiscountBps: 1000 });
  return k;
}

async function sell(idemKey: string, items: SaleItemInput[]) {
  const prep = await prepareSale(cashier, { idemKey, terminalId, items, payments: [] });
  const total = prep.calc.total;
  return finalizeSale(cashier, { idemKey, terminalId, items, payments: [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }] });
}

function xml(number: number, items: Array<{ cProd: string; cEAN?: string; qty: number; unit: number }>, extra: { freight?: number; duplicatas?: Array<{ dVenc: string; vDup?: number }> } = {}) {
  return buildSampleNfeXml({
    number, issueDate: today(), environment: "producao", emitter: { cnpj: PAPEL_CNPJ, name: "Distribuidora Papel & Cia Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" },
    items: items.map((i) => ({ cProd: i.cProd, cEAN: i.cEAN ?? null, xProd: i.cProd, qCom: i.qty, vUnCom: i.unit })), freight: extra.freight, duplicatas: extra.duplicatas,
  });
}

const titleOf = async (r: Doc) => store.getOrThrow("titles", r.payableTitleId);
const instsOf = async (titleId: string) => (await listAll(store, "installments", { filters: [["eq", "titleId", titleId]] })).sort((a, b) => a.number - b.number);
const movesOf = (receiptId: string) => listAll(store, "stock_movements", { filters: [["eq", "originId", receiptId]] });

beforeEach(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  terminalId = refs.terminals.cx1.id;
  princ = refs.warehouses["matriz-main"];
});

describe("§40 — entrada realizada (data atual/passada)", () => {
  it("estoque no depósito escolhido, custo médio, título PROVISÓRIO e aguardando nota; reenvio não duplica", async () => {
    const k = await product("pi-agenda", "Agenda PI", 3000);
    const entryAt = ago(2 * HOUR);
    const input = { supplierId: refs.suppliers.papel.id, warehouseId: princ.id, items: [{ skuId: k.id, qty: 10 * QTY, unitCost: 1000 }], freight: 500, paymentTermId: null, entryAt, idemKey: "pi-1" };
    const r = await createPendingInvoiceEntry(stockist, input);
    expect(r.status).toBe("confirmed");
    expect(r.documentStatus).toBe("pending_invoice");
    expect(r.entryAt).toBe(entryAt);
    expect(r.invoiceDueAt).toBe(addDays(toLocalDate(entryAt), 15));
    expect(r.dueTotal).toBe(10500);
    expect(r.xmlFileId).toBeNull();
    // estoque e custo médio pelo custo previsto (com o frete rateado): 10 un a R$ 10,50
    const b = await bal(princ.id, k.id);
    expect(b.physical).toBe(10 * QTY);
    expect(b.avgCost).toBe(1050);
    const movs = await movesOf(r.id);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ type: "purchase", qty: 10 * QTY, occurredAt: entryAt, originType: "purchase_receipt" });
    // título a pagar provisório, efetivo (não previsto)
    const t = await titleOf(r);
    expect(t.provisional).toBe(true);
    expect(t.forecast).toBeFalsy();
    expect(t.total).toBe(10500);
    expect(t.issueDate).toBe(toLocalDate(entryAt));
    expect(pendingState(r).key).toBe("pending");
    // reenvio do mesmo formulário: mesmo recebimento, nenhum movimento a mais
    const again = await createPendingInvoiceEntry(stockist, input);
    expect(again.id).toBe(r.id);
    expect(await movesOf(r.id)).toHaveLength(1);
    // fora do livro de entradas até a nota
    const book = await entriesBook(admin, { from: addDays(today(), -2), to: today(), branchId: refs.branches.matriz.id });
    expect(book.rows.some((x) => x.sourceId === r.id)).toBe(false);
    expect(book.awaitingInvoice.map((x) => x.id)).toContain(r.id);
    // auditoria
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityId", r.id]] });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["receipt.pending_invoice_create", "receipt.confirm"]));
  });

  it("venda antes da nota: vende normalmente e emite o documento fiscal (NFC-e) como sempre", async () => {
    const k = await product("pi-caneta", "Caneta PI", 500);
    await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 5 * QTY, unitCost: 200 }], entryAt: ago(HOUR), idemKey: "pi-sale" });
    await openSession(cashier, { terminalId, openingFund: 10000 });
    const sale = await sell("pi-sale-1", [{ skuId: k.id, qty: 2 * QTY }]);
    expect(sale.status).toBe("completed");
    const doc = await store.getOrThrow("fiscal_documents", (await store.getOrThrow("sales", sale.id)).fiscalDocumentId);
    expect(doc.model).toBe("nfce");
    expect(["queued", "processing", "authorized"]).toContain(doc.status);
    expect((await bal(princ.id, k.id)).physical).toBe(3 * QTY);
  });
});

describe("§40 — entrada prevista (data futura)", () => {
  it("sem saldo nem custo, “a chegar” e título PREVISTO (não baixa); a rotina realiza na data, idempotente", async () => {
    const k = await product("pi-mochila", "Mochila PI", 9000);
    const entryAt = ahead(DAY);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, warehouseId: princ.id, items: [{ skuId: k.id, qty: 4 * QTY, unitCost: 5000 }], entryAt, idemKey: "pi-fut" });
    expect(r.status).toBe("scheduled");
    expect(r.documentStatus).toBe("pending_invoice");
    expect(pendingState(r).key).toBe("scheduled");
    const b0 = await bal(princ.id, k.id);
    expect(b0.physical).toBe(0);
    expect(b0.avgCost).toBe(0);
    expect(await movesOf(r.id)).toHaveLength(0);
    const inc = await incomingMap(store, refs.company.id, refs.branches.matriz.id);
    expect(inc.get(`${princ.id}|${k.id}`)?.qty).toBe(4 * QTY);
    const t = await titleOf(r);
    expect(t).toMatchObject({ forecast: true, provisional: true, total: 20000, status: "open" });
    const [inst] = await instsOf(t.id);
    await expect(settleInstallment(admin, { installmentId: inst.id, date: today(), principal: 20000, accountId: refs.accounts.banco.id, idemKey: "pi-fut-pay", skipApprovalCheck: true })).rejects.toThrow(/PREVISTO/);
    // abrir antes da hora não realiza
    expect((await realizeEntry(store, refs.company.id, r.id))!.status).toBe("scheduled");
    // a rotina, na data, realiza: estoque e custo médio pelo custo previsto; título efetivo (provisório)
    const out = await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 2 * DAY });
    expect(out.realized).toBe(1);
    const done = await store.getOrThrow("receipts", r.id);
    expect(done.status).toBe("confirmed");
    expect(done.confirmedAt).toBe(entryAt);
    const b1 = await bal(princ.id, k.id);
    expect(b1.physical).toBe(4 * QTY);
    expect(b1.avgCost).toBe(5000);
    const t1 = await titleOf(done);
    expect(t1.forecast).toBe(false);
    expect(t1.provisional).toBe(true);
    expect(t1.id).toBe(t.id);
    expect(await listAll(store, "titles", { filters: [["eq", "originId", r.id]] })).toHaveLength(1);
    expect((await incomingMap(store, refs.company.id)).get(`${princ.id}|${k.id}`)).toBeUndefined();
    // idempotente: rodar de novo / abrir o recebimento não lança nada
    await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 3 * DAY });
    await realizeEntry(store, refs.company.id, r.id, Date.now() + 3 * DAY);
    expect(await movesOf(r.id)).toHaveLength(1);
    expect((await bal(princ.id, k.id)).physical).toBe(4 * QTY);
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityId", r.id], ["eq", "action", "receipt.pending_invoice_realize"]] });
    expect(logs).toHaveLength(1);
  });

  it("entrada prevista pode ser cancelada (título previsto cancelado)", async () => {
    const k = await product("pi-estojo", "Estojo PI", 1500);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 2 * QTY, unitCost: 700 }], entryAt: ahead(2 * DAY), idemKey: "pi-cancel" });
    await cancelScheduledEntry(stockist, r.id, "Fornecedor não vai mais entregar");
    expect((await store.getOrThrow("receipts", r.id)).status).toBe("cancelled");
    expect((await titleOf(r)).status).toBe("cancelled");
  });
});

describe("§40 — nota confirmada ANTES da data da entrada (entrada prevista)", () => {
  it("XML: substitui quantidade/custo previstos, corrige o título previsto (continua PREVISTO); a realização usa a nota sem ajuste de custo; idempotente", async () => {
    const k = await product("pi-pre", "Resma PI", 2500, "7890000000024");
    const entryAt = ahead(DAY);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, warehouseId: princ.id, items: [{ skuId: k.id, qty: 10 * QTY, unitCost: 500 }], entryAt, idemKey: "pi-pre", paymentTermId: refs.terms["30-60"].id });
    expect(r.status).toBe("scheduled");
    const t0 = await titleOf(r);
    expect(t0).toMatchObject({ forecast: true, provisional: true, total: 5000, installmentsCount: 2 });
    // nota: 8 un a R$ 6,00 + frete R$ 4,00 = R$ 52,00, em 3 duplicatas
    const dups = [{ dVenc: addDays(today(), 15) }, { dVenc: addDays(today(), 45) }, { dVenc: addDays(today(), 75) }];
    const x = xml(70101, [{ cProd: "PC-RESMA", cEAN: "7890000000024", qty: 8 * QTY, unit: 600 }], { freight: 400, duplicatas: dups });
    // estoquista não confirma (nem antes da data)
    await expect(confirmPendingInvoice(stockist, r.id, { xml: x })).rejects.toThrow(/permissão/);
    const a = await analyzeInvoice(manager, r.id, { xml: x });
    expect(a.scheduled).toBe(true);
    expect(a.problems).toEqual([]);
    expect(a.lines[0]).toMatchObject({ qtyDiff: -2 * QTY, noteQty: 8 * QTY, noteLandedUnitCost: 650 });
    // divergência de quantidade numa entrada prevista: sem decisão (só atualiza o previsto)
    const c = await confirmPendingInvoice(manager, r.id, { xml: x });
    expect(c.status).toBe("scheduled");
    expect(c.documentStatus).toBe("confirmed");
    expect(c.invoiceConfirmedBy).toBe(manager.user.id);
    expect(c.nfeNumber).toBe("70101");
    expect(c.nfeKey).toHaveLength(44);
    expect(c.xmlFileId).toBeTruthy();
    expect(c.items[0]).toMatchObject({ receivedQty: 8 * QTY, unitCost: 600, landedValue: 5200, landedUnitCost: 650, plannedQty: 10 * QTY, plannedUnitCost: 500, cProd: "PC-RESMA" });
    expect(c.dueTotal).toBe(5200);
    expect(pendingState(c).key).toBe("confirmed");
    // nada entrou no estoque: sem movimentos, sem saldo/custo; "a chegar" passa a ser a quantidade da nota
    expect(await movesOf(r.id)).toHaveLength(0);
    expect((await bal(princ.id, k.id)).physical).toBe(0);
    expect((await incomingMap(store, refs.company.id)).get(`${princ.id}|${k.id}`)?.qty).toBe(8 * QTY);
    // título previsto corrigido para o valor/parcelas da nota: continua PREVISTO, deixa de ser provisório
    const t = await titleOf(c);
    expect(t.id).toBe(t0.id);
    expect(t).toMatchObject({ forecast: true, provisional: false, total: 5200, installmentsCount: 3 });
    const insts = (await instsOf(t.id)).filter((i) => i.status !== "cancelled");
    expect(insts.map((i) => i.dueDate)).toEqual(dups.map((d) => d.dVenc));
    expect(insts.reduce((acc, i) => acc + i.amount, 0)).toBe(5200);
    await expect(settleInstallment(admin, { installmentId: insts[0].id, date: today(), principal: insts[0].amount, accountId: refs.accounts.banco.id, idemKey: "pi-pre-pay", skipApprovalCheck: true })).rejects.toThrow(/PREVISTO/);
    // fora do livro de entradas até a realização
    const book0 = await entriesBook(admin, { from: today(), to: addDays(today(), 3), branchId: refs.branches.matriz.id });
    expect(book0.rows.some((row) => row.sourceId === r.id)).toBe(false);
    // idempotente: confirmar de novo não muda nada
    const again = await confirmPendingInvoice(manager, r.id, { xml: x });
    expect(again.invoiceConfirmedAt).toBe(c.invoiceConfirmedAt);
    const auditOf = async (action: string, entityId = r.id) => listAll(store, "audit_logs", { filters: [["eq", "entityId", entityId], ["eq", "action", action]] });
    expect(await auditOf("receipt.invoice_confirm")).toHaveLength(1);
    expect(await auditOf("title.invoice_revise", t.id)).toHaveLength(1);
    // na data, a rotina realiza pelos valores da nota: estoque 8 un a R$ 6,50 (frete rateado), sem cost_adjust
    expect((await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 2 * DAY })).realized).toBe(1);
    const done = await store.getOrThrow("receipts", r.id);
    expect(done.status).toBe("confirmed");
    expect(done.documentStatus).toBe("confirmed");
    expect(done.confirmedAt).toBe(entryAt);
    const movs = await movesOf(r.id);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ type: "purchase", qty: 8 * QTY, totalCost: 5200, occurredAt: entryAt });
    expect(movs.filter((m) => m.type === "cost_adjust")).toHaveLength(0);
    const b = await bal(princ.id, k.id);
    expect(b.physical).toBe(8 * QTY);
    expect(b.avgCost).toBe(650);
    expect((await store.getOrThrow("skus", k.id)).costAcquisition).toBe(650);
    const t1 = await titleOf(done);
    expect(t1).toMatchObject({ id: t0.id, forecast: false, provisional: false, total: 5200 });
    expect(await listAll(store, "titles", { filters: [["eq", "originId", r.id]] })).toHaveLength(1);
    // livro de entradas pela data da entrada, com o XML
    const book = await entriesBook(admin, { from: today(), to: addDays(today(), 3), branchId: refs.branches.matriz.id });
    expect(book.rows.some((row) => row.sourceId === r.id)).toBe(true);
    expect(book.xmlFiles.some((f) => f.fileId === c.xmlFileId)).toBe(true);
    // idempotente: rodar de novo / abrir / confirmar de novo não lança nada
    await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 3 * DAY });
    await realizeEntry(store, refs.company.id, r.id, Date.now() + 3 * DAY);
    await confirmPendingInvoice(manager, r.id, { xml: x });
    expect(await movesOf(r.id)).toHaveLength(1);
    expect((await bal(princ.id, k.id)).physical).toBe(8 * QTY);
    expect(await auditOf("receipt.pending_invoice_realize")).toHaveLength(1);
    expect(await auditOf("receipt.invoice_confirm")).toHaveLength(1);
  });

  it("dados informados: item fora da nota sai do previsto; cancelar a prevista já confirmada mantém a nota no histórico", async () => {
    const k1 = await product("pi-pre-a", "Grampeador PI", 4000);
    const k2 = await product("pi-pre-b", "Perfurador PI", 5000);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, warehouseId: princ.id, items: [{ skuId: k1.id, qty: 3 * QTY, unitCost: 2000 }, { skuId: k2.id, qty: 2 * QTY, unitCost: 2500 }], entryAt: ahead(2 * DAY), idemKey: "pi-pre-man" });
    expect((await titleOf(r)).total).toBe(11000);
    const c = await confirmPendingInvoice(manager, r.id, { manual: { nfeNumber: "4401", nfeSeries: "2", issueDate: today(), items: [{ idx: 1, qty: 3 * QTY, unitCost: 2100 }, { idx: 2, qty: 0, unitCost: 0 }] } });
    expect(c).toMatchObject({ status: "scheduled", documentStatus: "confirmed", nfeNumber: "4401", nfeSeries: "2", dueTotal: 6300 });
    const inc = await incomingMap(store, refs.company.id);
    expect(inc.get(`${princ.id}|${k1.id}`)?.qty).toBe(3 * QTY);
    expect(inc.get(`${princ.id}|${k2.id}`)).toBeUndefined();
    expect(await titleOf(c)).toMatchObject({ forecast: true, provisional: false, total: 6300 });
    // cancelar continua possível: nada entrou no estoque; a nota fica registrada no recebimento cancelado
    await cancelScheduledEntry(stockist, r.id, "Pedido cancelado pelo fornecedor");
    const x = await store.getOrThrow("receipts", r.id);
    expect(x).toMatchObject({ status: "cancelled", documentStatus: "confirmed", nfeNumber: "4401" });
    expect(x.invoiceConfirmation.state).toBe("done");
    expect((await titleOf(x)).status).toBe("cancelled");
    expect(await movesOf(r.id)).toHaveLength(0);
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityId", r.id], ["eq", "action", "receipt.pending_invoice_cancel"]] });
    expect(logs[0].summary).toMatch(/histórico/);
    // cancelada não é realizada na data
    expect((await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 3 * DAY })).realized).toBe(0);
  });
});

describe("§40 — confirmação com a nota", () => {
  it("XML igual: só vincula (sem ajuste), grava chave/XML, título efetivo pelo valor da nota e entra no livro", async () => {
    const k = await product("pi-pasta", "Pasta PI", 2500, "7890000000017");
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 6 * QTY, unitCost: 1200 }], freight: 300, entryAt: ago(DAY), idemKey: "pi-eq" });
    const avgBefore = (await bal(princ.id, k.id)).avgCost;
    const x = xml(70001, [{ cProd: "PC-PASTA", cEAN: "7890000000017", qty: 6 * QTY, unit: 1200 }], { freight: 300 });
    // estoquista não confirma
    await expect(confirmPendingInvoice(stockist, r.id, { xml: x })).rejects.toThrow(/permissão/);
    const a = await analyzeInvoice(manager, r.id, { xml: x });
    expect(a.problems).toEqual([]);
    expect(a.lines[0]).toMatchObject({ qtyDiff: 0, costDelta: 0 });
    const c = await confirmPendingInvoice(manager, r.id, { xml: x });
    expect(c.documentStatus).toBe("confirmed");
    expect(c.invoiceConfirmedBy).toBe(manager.user.id);
    expect(c.xmlFileId).toBeTruthy();
    expect(c.nfeKey).toHaveLength(44);
    expect(c.nfeNumber).toBe("70001");
    expect((await movesOf(r.id)).filter((m) => m.type === "cost_adjust")).toHaveLength(0);
    expect((await bal(princ.id, k.id)).avgCost).toBe(avgBefore);
    const t = await titleOf(c);
    expect(t.provisional).toBe(false);
    expect(t.total).toBe(7500);
    // repetir não muda nada
    const again = await confirmPendingInvoice(manager, r.id, { xml: x });
    expect(again.invoiceConfirmedAt).toBe(c.invoiceConfirmedAt);
    // livro de entradas: agora é um recebimento comum (pela data da entrada)
    const book = await entriesBook(admin, { from: addDays(today(), -3), to: today(), branchId: refs.branches.matriz.id });
    expect(book.rows.some((x) => x.sourceId === r.id)).toBe(true);
    expect(book.xmlFiles.some((f) => f.fileId === c.xmlFileId)).toBe(true);
    // a mesma NF-e não pode ser importada em outro recebimento
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityId", r.id], ["eq", "action", "receipt.invoice_confirm"]] });
    expect(logs).toHaveLength(1);
  });

  it("custo diferente: ajuste de custo médio (cost_adjust, quantidade zero); parte já vendida fica como não absorvida", async () => {
    const k = await product("pi-cola", "Cola PI", 900);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 10 * QTY, unitCost: 300 }], entryAt: ago(DAY), idemKey: "pi-cost" });
    await openSession(cashier, { terminalId, openingFund: 10000 });
    await sell("pi-cost-sale", [{ skuId: k.id, qty: 4 * QTY }]);
    expect((await bal(princ.id, k.id)).physical).toBe(6 * QTY);
    // nota: R$ 3,50 por unidade (prevista R$ 3,00) → diferença R$ 5,00; 6 de 10 em estoque → R$ 3,00 absorvido
    const x = xml(70002, [{ cProd: "PC-COLA", qty: 10 * QTY, unit: 350 }]);
    const a = await analyzeInvoice(manager, r.id, { xml: x, matches: { "1": 1 } });
    expect(a.lines[0].costDelta).toBe(500);
    const c = await confirmPendingInvoice(manager, r.id, { xml: x, matches: { "1": 1 } });
    const adj = (await movesOf(r.id)).filter((m) => m.type === "cost_adjust");
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ qty: 0, totalCost: 300, originType: "receipt_invoice" });
    const res = c.invoiceConfirmation.results[0];
    expect(res).toMatchObject({ absorbed: 300, notAbsorbed: 200 });
    // custo médio: 6 un × R$ 3,00 + R$ 3,00 = R$ 21,00 ÷ 6 = R$ 3,50
    expect((await bal(princ.id, k.id)).avgCost).toBe(350);
    expect((await store.getOrThrow("skus", k.id)).costAcquisition).toBe(350);
    expect((await titleOf(c)).total).toBe(3500);
    // o código do fornecedor foi aprendido
    expect((await listAll(store, "supplier_products", { filters: [["eq", "skuId", k.id]] }))[0].supplierCode).toBe("PC-COLA");
  });

  it("custo menor pelos dados informados (sem XML): redução do custo médio", async () => {
    const k = await product("pi-fita", "Fita PI", 800);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 5 * QTY, unitCost: 400 }], entryAt: ago(HOUR), idemKey: "pi-down" });
    const c = await confirmPendingInvoice(manager, r.id, { manual: { nfeNumber: "5512", nfeSeries: "1", issueDate: today(), items: [{ idx: 1, qty: 5 * QTY, unitCost: 360 }] } });
    expect(c.documentStatus).toBe("confirmed");
    expect(c.nfeNumber).toBe("5512");
    const adj = (await movesOf(r.id)).filter((m) => m.type === "cost_adjust");
    expect(adj[0].totalCost).toBe(-200);
    expect((await bal(princ.id, k.id)).avgCost).toBe(360);
    expect((await titleOf(c)).total).toBe(1800);
  });

  it("quantidade diferente: exige decisão; ajuste de estoque pela diferença; título pelo valor da nota (duplicatas)", async () => {
    const k = await product("pi-lapis", "Lápis PI", 300);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 10 * QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-qty", paymentTermId: refs.terms["30-60"].id });
    expect(await instsOf(r.payableTitleId)).toHaveLength(2);
    const dups = [{ dVenc: addDays(today(), 10) }, { dVenc: addDays(today(), 20) }, { dVenc: addDays(today(), 30) }];
    const x = xml(70003, [{ cProd: "PC-LAPIS", qty: 8 * QTY, unit: 100 }], { duplicatas: dups });
    await expect(confirmPendingInvoice(manager, r.id, { xml: x, matches: { "1": 1 } })).rejects.toThrow(/escolha ajustar/);
    await expect(confirmPendingInvoice(manager, r.id, { xml: x, matches: { "1": 1 }, qtyActions: { "1": "keep" } })).rejects.toThrow(/justificativa/);
    const c = await confirmPendingInvoice(manager, r.id, { xml: x, matches: { "1": 1 }, qtyActions: { "1": "adjust" } });
    const adj = (await movesOf(r.id)).filter((m) => m.type === "adjust_out");
    expect(adj).toHaveLength(1);
    expect(adj[0].qty).toBe(-2 * QTY);
    expect((await bal(princ.id, k.id)).physical).toBe(8 * QTY);
    const t = await titleOf(c);
    expect(t.total).toBe(800);
    expect(t.installmentsCount).toBe(3);
    const insts = (await instsOf(t.id)).filter((i) => i.status !== "cancelled");
    expect(insts.map((i) => i.dueDate)).toEqual(dups.map((d) => d.dVenc));
    expect(insts.reduce((a, i) => a + i.amount, 0)).toBe(800);
    expect(c.divergences.some((d: any) => d.kind === "qty")).toBe(true);
  });

  it("título com parcela já paga: diferença vai para as parcelas em aberto", async () => {
    const k = await product("pi-clips", "Clips PI", 200);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 10 * QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-paid", paymentTermId: refs.terms["30-60"].id });
    const [first] = await instsOf(r.payableTitleId);
    await settleInstallment(admin, { installmentId: first.id, date: today(), principal: first.amount, accountId: refs.accounts.banco.id, idemKey: "pi-paid-1", skipApprovalCheck: true });
    const c = await confirmPendingInvoice(manager, r.id, { manual: { nfeNumber: "900", issueDate: today(), items: [{ idx: 1, qty: 10 * QTY, unitCost: 120 }] } });
    const t = await titleOf(c);
    expect(t.total).toBe(1200);
    const insts = await instsOf(t.id);
    expect(insts[0]).toMatchObject({ paid: 500, balance: 0 });
    expect(insts[1]).toMatchObject({ amount: 700, balance: 700 });
    expect(t.balance).toBe(700);
  });

  it("conta a pagar já AUTORIZADA continua autorizada com o valor novo; auditoria registra anterior, novo e quem confirmou", async () => {
    const k = await product("pi-aut", "Borracha PI", 300);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: 10 * QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-aut" });
    await approvePayable(admin, r.payableTitleId);
    expect((await titleOf(r)).approvalStatus).toBe("approved");
    const c = await confirmPendingInvoice(manager, r.id, { manual: { nfeNumber: "8080", issueDate: today(), items: [{ idx: 1, qty: 10 * QTY, unitCost: 130 }] } });
    const t = await titleOf(c);
    expect(t).toMatchObject({ total: 1300, approvalStatus: "approved", approvedBy: admin.user.id, provisional: false });
    const [log] = await listAll(store, "audit_logs", { filters: [["eq", "entityId", t.id], ["eq", "action", "title.invoice_revise"]] });
    expect(log.userId).toBe(manager.user.id);
    expect(log.before).toMatchObject({ total: 1000, approvalStatus: "approved" });
    expect(log.after).toMatchObject({ total: 1300, approvalStatus: "approved", confirmedBy: manager.user.id });
    expect(log.summary).toMatch(/continua autorizada/);
  });
});

describe("§40 — prazo e aviso configuráveis, permissões e período fechado", () => {
  it("prazo configurável; aviso ligado gera uma ocorrência para quem confirma, resolvida na confirmação; desligado não avisa", async () => {
    await setSetting(store, refs.company.id, null, "purchase.pendingInvoice.dueDays", 5);
    const k = await product("pi-cad", "Caderno PI", 2000);
    const entryAt = ago(HOUR);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: QTY, unitCost: 1000 }], entryAt, idemKey: "pi-alert" });
    expect(r.invoiceDueAt).toBe(addDays(toLocalDate(entryAt), 5));
    // hoje: faltam 5 dias (> antecedência 3): nada
    expect((await runPendingInvoiceRoutine(store, refs.company.id)).alerts).toBe(0);
    // aviso desligado: nada, mesmo vencido
    await setSetting(store, refs.company.id, null, "purchase.pendingInvoice.alert", false);
    expect((await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 6 * DAY })).alerts).toBe(0);
    // ligado: 2 dias antes do prazo → avisa gerente/administrador (confirmam), não o estoquista
    await setSetting(store, refs.company.id, null, "purchase.pendingInvoice.alert", true);
    await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 3 * DAY });
    const notes = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", occurrenceKeyFor(r.id)]] });
    const userIds = notes.map((n) => n.userId);
    expect(userIds).toContain(refs.users.manager.id);
    expect(userIds).not.toContain(refs.users.stockist.id);
    expect(userIds).not.toContain(refs.users.cashier.id);
    // uma ocorrência por recebimento: rodar de novo (mesmo vencida) não duplica
    await runPendingInvoiceRoutine(store, refs.company.id, { now: Date.now() + 8 * DAY });
    expect(await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", occurrenceKeyFor(r.id)]] })).toHaveLength(notes.length);
    await confirmPendingInvoice(manager, r.id, { manual: { nfeNumber: "77", issueDate: today(), items: [{ idx: 1, qty: QTY, unitCost: 1000 }] } });
    const after = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", occurrenceKeyFor(r.id)]] });
    expect(after.every((n) => n.occurrenceStatus === "resolved")).toBe(true);
  });

  it("permissões: estoquista lança e não confirma; gerente confirma; caixa não lança; modelos e sincronização", async () => {
    const k = await product("pi-perm", "Produto PI", 1000);
    await expect(createPendingInvoiceEntry(cashier, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-perm-c" })).rejects.toThrow(/permissão/);
    const r = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-perm" });
    const doc = { manual: { nfeNumber: "1", issueDate: today(), items: [{ idx: 1, qty: QTY, unitCost: 100 }] } };
    await expect(confirmPendingInvoice(stockist, r.id, doc)).rejects.toThrow(/permissão/);
    expect((await confirmPendingInvoice(manager, r.id, doc)).documentStatus).toBe("confirmed");
    expect(canDo(stockist.user, "purchase.receive_pending_invoice")).toBe(true);
    expect(canDo(stockist.user, "purchase.confirm_invoice")).toBe(false);
    expect(canDo(manager.user, "purchase.confirm_invoice")).toBe(true);
    expect(canDo(admin.user, "purchase.confirm_invoice")).toBe(true);
    const tpl = (key: string) => DEFAULT_ROLES.find((x) => x.key === key)!.actions as string[];
    expect(tpl("admin")).toEqual(expect.arrayContaining(["purchase.receive_pending_invoice", "purchase.confirm_invoice"]));
    expect(tpl("manager")).toEqual(expect.arrayContaining(["purchase.receive_pending_invoice", "purchase.confirm_invoice"]));
    expect(tpl("stockist")).toContain("purchase.receive_pending_invoice");
    expect(tpl("stockist")).not.toContain("purchase.confirm_invoice");
    expect(ACTIONS_ADDED_TO_TEMPLATES).toEqual(expect.arrayContaining(["purchase.receive_pending_invoice", "purchase.confirm_invoice"]));
  });

  it("período financeiro fechado recusa data retroativa; recurso desligado recusa o lançamento", async () => {
    const k = await product("pi-closed", "Produto fechado", 1000);
    await setSetting(store, refs.company.id, null, "feature.fechamentoPeriodo", true);
    const fin = await refs.ctxFor("finance", "matriz");
    await setClosedUntil(fin, { date: addDays(today(), -3) });
    await expect(createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: QTY, unitCost: 100 }], entryAt: ago(5 * DAY), idemKey: "pi-closed" })).rejects.toThrow(/Período financeiro fechado/);
    expect(await listAll(store, "receipts", { filters: [["eq", "documentStatus", "pending_invoice"]] })).toHaveLength(0);
    // data no período aberto passa
    const ok = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-open" });
    expect(ok.status).toBe("confirmed");
    await setSetting(store, refs.company.id, null, "feature.notaAConfirmar", false);
    await expect(createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: k.id, qty: QTY, unitCost: 100 }], entryAt: ago(HOUR), idemKey: "pi-off" })).rejects.toThrow(/desligad/);
  });

  it("demonstração idempotente: 1 entrada aguardando nota (vencendo em 3 dias) e 1 prevista para amanhã", async () => {
    const out1 = (await seedPendingInvoice(refs)) as any;
    const out2 = (await seedPendingInvoice(refs)) as any;
    expect(out2).toEqual(out1);
    const list = await listAll(store, "receipts", { filters: [["eq", "documentStatus", "pending_invoice"]] });
    expect(list).toHaveLength(2);
    const realized = list.find((r) => r.status === "confirmed")!;
    const scheduled = list.find((r) => r.status === "scheduled")!;
    expect(realized.invoiceDueAt).toBe(addDays(today(), 3));
    expect(toLocalDate(scheduled.entryAt)).toBe(addDays(today(), 1));
    expect(roundDiv(1, 1)).toBe(1);
  });
});
