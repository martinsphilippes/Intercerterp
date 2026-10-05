import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import { roundDiv } from "@/lib/money";
import { createSupplier } from "@/domain/suppliers";
import { buildSchedule } from "@/domain/finance";
import { savePolicy, decideRequest, revokeDecision, canDecide } from "@/domain/approvals";
import { createQuotation, saveProposal, applySuggestion, saveSelection, quotationView, generateOrders, importProposalsCsv } from "@/domain/quotations";
import { createOrder, updateOrder, registerOrderSent, cancelOrder, orderBalance, orderItems } from "@/domain/purchases";
import { submitForApproval } from "@/domain/approvals";
import { importNfeXml, confirmReceipt, updateReceipt, createManualReceipt, confirmBlockers } from "@/domain/receipts";
import { buildSampleNfeXml, parseNfeXml, nfeKeyIsValid } from "@/domain/nfe-xml";
import { assertTransition, evaluateSelection, suggestSelection, computeOrderTotals, type QuoteItem, type QuoteProposal } from "@/domain/purchase-calc";
import fs from "node:fs";
import path from "node:path";

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let director: Ctx;
let stockist: Ctx;
let thirdSupplierId: string;

const MATRIZ_CNPJ = "11222333000181";

async function policy(ctx: Ctx, opts: Partial<{ auto: number; review: "always" | "relevant" | "never"; expired: "block" | "warn" | "allow" }> = {}) {
  const roleManager = (await listAll(store, "roles")).find((r) => r.key === "manager")!;
  return savePolicy(ctx, {
    name: "Teste — duas etapas acima de R$ 5.000",
    rules: {
      tiers: [
        { above: 0, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }] },
        { above: 500000, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }, { name: "Diretoria", kind: "users", userIds: [refs.users.director.id] }] },
      ],
      distinctApprovers: true,
    },
    autoApproveBelow: opts.auto ?? 0,
    allowSelfApproval: false,
    expiredProposalAction: opts.expired ?? "warn",
    reviewOnRevision: opts.review ?? "relevant",
  });
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  director = await refs.ctxFor("director", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  const s = await createSupplier(admin, { personType: "PJ", doc: "12345678000195", name: "Atacadão dos Acessórios Ltda", tradeName: "Atacadão Acessórios", leadTimeDays: 5, minOrderValue: 30000, status: "active" });
  thirdSupplierId = s.id;
  await policy(admin);
}, 120000);

describe("cálculos puros", () => {
  it("total do pedido: subtotal − descontos + frete + outras despesas", () => {
    const t = computeOrderTotals({ items: [{ skuId: "a", qty: 3000, unitCost: 1999, discount: 97 }, { skuId: "b", qty: 1500, unitCost: 1000 }], headerDiscount: 100, freight: 2500, otherExpenses: 300 });
    expect(t.subtotal).toBe(5997 + 1500);
    expect(t.discountTotal).toBe(197);
    expect(t.total).toBe(7497 - 197 + 2500 + 300);
  });

  it("máquina de estados rejeita transições incoerentes", () => {
    expect(() => assertTransition("received", "draft")).toThrow(/Transição inválida/);
    expect(() => assertTransition("draft", "sent")).toThrow();
    expect(() => assertTransition("in_review", "sent")).toThrow();
    expect(() => assertTransition("approved", "sent")).not.toThrow();
  });

  it("menor unitário não garante menor pedido: heurística consolida para economizar frete", () => {
    const items: QuoteItem[] = [
      { skuId: "bone", description: "Boné", qty: 40000 },
      { skuId: "cinto", description: "Cinto", qty: 20000 },
      { skuId: "meia", description: "Meia", qty: 60000 },
    ];
    const ref = "2026-10-05";
    const proposals: QuoteProposal[] = [
      { id: "pT", supplierId: "T", supplierName: "Têxtil", freight: 4500, minOrderValue: 50000, validUntil: "2026-10-20", items: [{ skuId: "bone", unitPrice: 1450 }, { skuId: "cinto", unitPrice: 2500 }, { skuId: "meia", unitPrice: 1050 }] },
      { id: "pF", supplierId: "F", supplierName: "Franca", freight: 8000, minOrderValue: 100000, validUntil: "2026-10-20", items: [{ skuId: "cinto", unitPrice: 2290 }, { skuId: "meia", unitPrice: 1020 }] },
      { id: "pA", supplierId: "A", supplierName: "Atacadão", freight: 3000, minOrderValue: 30000, validUntil: "2026-10-04", items: [{ skuId: "bone", unitPrice: 1300 }, { skuId: "cinto", unitPrice: 2000 }, { skuId: "meia", unitPrice: 900 }] },
    ];
    const s = suggestSelection(items, proposals, ref);
    // gulosa (menor linha por item, sem a vencida): boné T 580, cinto F 458, meia F 612 + fretes 45 + 80 = 1775
    expect(s.greedyTotal).toBe(177500);
    // consolidar tudo na Têxtil: 580 + 500 + 630 + frete 45 = 1755 (economiza o frete da Franca)
    expect(s.evaluation.grandTotal).toBe(175500);
    expect(s.evaluation.groups.map((g) => g.supplierId)).toEqual(["T"]);
    expect(Object.values(s.assign)).not.toContain("A"); // proposta vencida nunca é sugerida
    expect(s.method).toMatch(/Heurística/);
    // seleção manual com fornecedor abaixo do mínimo é sinalizada
    const manual = evaluateSelection(items, proposals, { bone: "T", cinto: "T", meia: "F" }, ref);
    expect(manual.groups.find((g) => g.supplierId === "F")!.belowMinimum).toBe(true);
    expect(manual.grandTotal).toBe(58000 + 50000 + 4500 + 61200 + 8000);
  });

  it("chave de acesso: dígito verificador", () => {
    const xml = buildSampleNfeXml({ number: 777, issueDate: "2026-10-01", emitter: { cnpj: "45997418000153", name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "X", xProd: "Item", qCom: 1000, vUnCom: 1000 }] });
    const n = parseNfeXml(xml);
    expect(nfeKeyIsValid(n.key)).toBe(true);
    expect(nfeKeyIsValid(n.key.slice(0, 43) + ((Number(n.key[43]) + 1) % 10))).toBe(false);
  });
});

describe("cotação → pedidos agrupados → aprovação em duas etapas → revisão", () => {
  let quotationId: string;
  let orderIds: string[] = [];

  it("compara propostas com frete, mínimo e validade e gera pedidos uma única vez", async () => {
    const q = await createQuotation(admin, {
      title: "Acessórios — reposição de outubro",
      items: [{ skuId: refs.skus["bone-u"].id, qty: 120000 }, { skuId: refs.skus["cinto-u"].id, qty: 80000 }, { skuId: refs.skus["meia-u"].id, qty: 150000 }],
      supplierIds: [refs.suppliers.textil.id, refs.suppliers.calcados.id, thirdSupplierId],
    });
    quotationId = q.id;
    const valid = addDays(today(), 10);
    await saveProposal(admin, q.id, { supplierId: refs.suppliers.textil.id, freight: 4500, minOrderValue: 50000, validUntil: valid, leadTimeDays: 7, paymentTermId: refs.terms["30-60"].id, items: [{ skuId: refs.skus["bone-u"].id, unitPrice: 1450 }, { skuId: refs.skus["cinto-u"].id, unitPrice: 2500 }, { skuId: refs.skus["meia-u"].id, unitPrice: 1050 }] });
    await saveProposal(admin, q.id, { supplierId: refs.suppliers.calcados.id, freight: 8000, minOrderValue: 300000, validUntil: valid, leadTimeDays: 10, paymentTermId: refs.terms["28"].id, items: [{ skuId: refs.skus["cinto-u"].id, unitPrice: 2290 }, { skuId: refs.skus["meia-u"].id, unitPrice: 1020 }] });
    // a mais barata, porém vencida (importada por CSV)
    const csv = `fornecedor;sku;preco;desconto;disponivel;prazo;frete;pedido_minimo;validade;condicao\n12345678000195;BONE;13,00;0;sim;5;30,00;300,00;${addDays(today(), -1).split("-").reverse().join("/")};À vista\n12345678000195;CINTO;20,00;0;sim;5;;;;\n12345678000195;MEIA;9,00;0;sim;5;;;;`;
    const imp = await importProposalsCsv(admin, q.id, csv);
    expect(imp.saved).toBe(1);
    expect(imp.errors).toEqual([]);

    const sug = await applySuggestion(admin, q.id);
    const v = await quotationView(admin, q.id);
    expect(v.proposals.find((p) => p.supplierId === thirdSupplierId)!.validUntil! < today()).toBe(true);
    expect(Object.values(v.q.selection.items).map((x: any) => x.supplierId)).not.toContain(thirdSupplierId);
    // gulosa: boné Têxtil 1740; cinto 1832 + meia 1530 na Franca (3362 ≥ mínimo 3000) → 1740+45 + 3362+80
    expect(v.evaluation.grandTotal).toBe(174000 + 4500 + 336200 + 8000);
    expect(v.evaluation.groups).toHaveLength(2);
    expect(v.evaluation.groups.every((g) => !g.belowMinimum)).toBe(true);
    expect(sug.evaluation.grandTotal).toBe(v.evaluation.grandTotal);

    // alteração manual recalcula imediatamente e conserva versões
    const manual = await saveSelection(admin, q.id, { [refs.skus["bone-u"].id]: refs.suppliers.textil.id, [refs.skus["cinto-u"].id]: refs.suppliers.textil.id, [refs.skus["meia-u"].id]: refs.suppliers.calcados.id }, "manual");
    expect(manual.groups.find((g) => g.supplierId === refs.suppliers.calcados.id)!.belowMinimum).toBe(true);
    await applySuggestion(admin, q.id);

    const r1 = await generateOrders(admin, q.id, { submit: true });
    expect(r1.created).toBe(true);
    expect(r1.orders).toHaveLength(2);
    const r2 = await generateOrders(admin, q.id, { submit: true });
    expect(r2.created).toBe(false);
    const all = await listAll(store, "purchase_orders", { filters: [["eq", "quotationId", q.id]] });
    expect(all).toHaveLength(2);
    orderIds = all.map((o) => o.id);
    // números conciliados entre comparação/revisão e pedidos
    expect(all.reduce((a, o) => a + o.total, 0)).toBe(v.evaluation.grandTotal);
    for (const o of all) {
      expect(o.status).toBe("in_review");
      expect(o.proposalRef.version).toBeGreaterThanOrEqual(1);
      expect(o.origin).toBe("quotation");
    }
  });

  it("aprova em duas etapas (gestor → diretoria), revoga e reaprova sem enviar nem receber", async () => {
    const order = await store.getOrThrow("purchase_orders", orderIds[0]);
    const req = await store.getOrThrow("purchase_requests", order.requestId);
    expect(req.total).toBe(522700);
    expect(req.steps.map((s: any) => s.name)).toEqual(["Parecer do gestor", "Diretoria"]);
    expect(req.orderIds.sort()).toEqual([...orderIds].sort());
    // notificação para o gestor
    const n0 = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `purchase_review:${req.id}:1:0`]] });
    expect(n0.some((n) => n.userId === refs.users.manager.id)).toBe(true);
    // solicitante (admin) não pode decidir a própria solicitação
    expect((await canDecide(admin, req)).ok).toBe(false);
    // diretora ainda não é responsável pela etapa 1? (é Gerente por perfil → pode). Gestor aprova a etapa 1.
    await decideRequest(manager, req.id, "approve", "Preços compatíveis com a última compra.");
    const afterStep1 = await store.getOrThrow("purchase_requests", req.id);
    expect(afterStep1.currentStep).toBe(1);
    expect((await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `purchase_review:${req.id}:1:0`], ["eq", "occurrenceStatus", "open"]] })).length).toBe(0);
    // gestor não decide a etapa da diretoria
    await expect(decideRequest(manager, req.id, "approve")).rejects.toThrow(/não é responsável|aprovadores diferentes/);
    const fin = await decideRequest(director, req.id, "approve", "De acordo.");
    expect(fin.request.status).toBe("approved");
    for (const id of orderIds) {
      const o = await store.getOrThrow("purchase_orders", id);
      expect(o.status).toBe("approved");
      expect(o.sentAt).toBeNull(); // aprovação não envia
    }
    expect(await listAll(store, "receipts")).toHaveLength(0);
    expect((await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"]] })).length).toBe(0);

    // revisão (revogação) da decisão final → volta para a etapa da diretoria
    const decisions = await listAll(store, "approval_decisions", { filters: [["eq", "requestId", req.id]] });
    const last = decisions.find((d) => d.stepName === "Diretoria")!;
    await revokeDecision(director, last.id, "Conferir prazo de entrega com o fornecedor.");
    const back = await store.getOrThrow("purchase_requests", req.id);
    expect(back.status).toBe("in_review");
    expect(back.currentStep).toBe(1);
    expect((await store.getOrThrow("purchase_orders", orderIds[0])).status).toBe("in_review");
    await decideRequest(director, req.id, "approve", "Prazo confirmado.");
    expect((await store.getOrThrow("purchase_requests", req.id)).status).toBe("approved");
  });

  it("alteração após aprovação gera revisão e volta para análise conforme a política", async () => {
    const orders = await Promise.all(orderIds.map((id) => store.getOrThrow("purchase_orders", id)));
    const franca = orders.find((o) => o.supplierId === refs.suppliers.calcados.id)!;
    const textil = orders.find((o) => o.supplierId === refs.suppliers.textil.id)!;
    // redução de quantidade: não relevante → continua aprovado, revisão registrada
    const fItems = await orderItems(store, franca.id);
    const r1 = await updateOrder(admin, franca.id, { supplierId: franca.supplierId, items: fItems.map((i) => ({ skuId: i.skuId, qty: i.qty - 10000, unitCost: i.unitCost, discount: i.discount })), freight: franca.freight, paymentTermId: franca.paymentTermId, revisionReason: "Fornecedor sem estoque total" });
    expect(r1.revised).toBe(true);
    expect(r1.needsReview).toBe(false);
    expect(r1.order.status).toBe("approved");
    expect(r1.order.revision).toBe(2);
    expect(r1.order.approvedRevision).toBe(2);
    // aumento: relevante → nova análise com nova solicitação
    const tItems = await orderItems(store, textil.id);
    const r2 = await updateOrder(admin, textil.id, { supplierId: textil.supplierId, items: tItems.map((i) => ({ skuId: i.skuId, qty: i.qty + 20000, unitCost: i.unitCost })), freight: textil.freight, paymentTermId: textil.paymentTermId, revisionReason: "Aumento de quantidade" });
    expect(r2.needsReview).toBe(true);
    expect(r2.order.status).toBe("in_review");
    expect(r2.order.revision).toBe(2);
    const revs = await listAll(store, "purchase_order_revisions", { filters: [["eq", "orderId", textil.id]] });
    expect(revs).toHaveLength(1);
    expect(revs[0].snapshot.total).toBe(textil.total);
    expect(revs[0].requiresReview).toBe(true);
    expect(r2.order.requestId).not.toBe(textil.requestId);
    const newReq = await store.getOrThrow("purchase_requests", r2.order.requestId);
    expect(newReq.origin).toBe("revision");
    expect(newReq.status).toBe("in_review");
    await decideRequest(manager, newReq.id, "approve");
    expect((await store.getOrThrow("purchase_orders", textil.id)).status).toBe("approved");
    // política "always": qualquer alteração volta para análise
    await policy(admin, { review: "always" });
    const f2 = await store.getOrThrow("purchase_orders", franca.id);
    const f2Items = await orderItems(store, franca.id);
    const r3 = await updateOrder(admin, franca.id, { supplierId: f2.supplierId, items: f2Items.map((i) => ({ skuId: i.skuId, qty: i.qty - 1000, unitCost: i.unitCost, discount: i.discount })), freight: f2.freight, paymentTermId: f2.paymentTermId, revisionReason: "Ajuste fino" });
    expect(r3.needsReview).toBe(true);
    await policy(admin);
  });

  it("registrar envio é ação separada: e-mail sem canal configurado não marca como enviado", async () => {
    const o = (await Promise.all(orderIds.map((id) => store.getOrThrow("purchase_orders", id)))).find((x) => x.status === "approved")!;
    await expect(registerOrderSent(admin, o.id, { method: "email", to: "vendas@fornecedor.example.com" })).rejects.toThrow(/E-mail não enviado/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("approved");
    await expect(registerOrderSent(admin, o.id, { method: "manual", channel: "WhatsApp" })).rejects.toThrow(/contato/);
    const sent = await registerOrderSent(admin, o.id, { method: "manual", channel: "WhatsApp", contact: "Marcos (comercial)" });
    expect(sent.status).toBe("sent");
    expect(sent.sentInfo.contact).toBe("Marcos (comercial)");
  });
});

describe("recebimento: parcial, nova entrada, saldo, obrigação, XML repetido e custo médio", () => {
  let orderId: string;
  const termo = () => refs.terms["30-60"].id;

  it("pedido parcialmente recebido → nova entrada → saldo e títulos corretos", async () => {
    const mSku = refs.skus["camiseta-m-preta"];
    const gSku = refs.skus["camiseta-g-preta"];
    const o = await createOrder(admin, { supplierId: refs.suppliers.textil.id, items: [{ skuId: mSku.id, qty: 24000, unitCost: 1890 }, { skuId: gSku.id, qty: 16000, unitCost: 1890 }], freight: 6000, paymentTermId: termo(), expectedDate: addDays(today(), 7) });
    orderId = o.id;
    expect(o.total).toBe(24 * 1890 + 16 * 1890 + 6000);
    await submitForApproval(admin, [o.id]);
    const req = await store.getOrThrow("purchase_requests", (await store.getOrThrow("purchase_orders", o.id)).requestId);
    expect(req.steps).toHaveLength(1);
    await decideRequest(manager, req.id, "approve");
    await registerOrderSent(admin, o.id, { method: "manual", channel: "Portal do fornecedor", contact: "Comercial" });

    const balBefore = (await listAll(store, "stock_balances", { filters: [["eq", "skuId", mSku.id], ["eq", "warehouseId", refs.warehouses["matriz-main"].id]] }))[0];
    const xml1 = buildSampleNfeXml({
      number: 5001, issueDate: today(), emitter: { cnpj: "45997418000153", name: "Têxtil Paulista Indústria Ltda", tradeName: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" },
      items: [{ cProd: "F-CAMISETA-M-PRETA", xProd: "CAMISETA M PRETA", qCom: 24000, vUnCom: 1890 }, { cProd: "F-CAMISETA-G-PRETA", xProd: "CAMISETA G PRETA", qCom: 8000, vUnCom: 1890 }],
      freight: 6000, duplicatas: [{ dVenc: addDays(today(), 30) }, { dVenc: addDays(today(), 60) }],
    });
    const r1 = await importNfeXml(stockist, { xml: xml1, fileName: "nfe-5001.xml" });
    expect(r1.items.every((i: any) => i.mapping === "supplier_code")).toBe(true);
    expect(r1.orderIds).toEqual([o.id]);
    expect(r1.invoicedTotal).toBe(24 * 1890 + 8 * 1890 + 6000);
    // XML repetido não duplica
    await expect(importNfeXml(stockist, { xml: xml1 })).rejects.toThrow(/já foi importada/);
    expect(await listAll(store, "receipts")).toHaveLength(1);

    const c1 = await confirmReceipt(stockist, r1.id);
    expect(c1.status).toBe("confirmed");
    expect(c1.dueTotal).toBe(c1.invoicedTotal);
    // rateio do frete por valor: M 453,60 + 45,00; G 151,20 + 15,00 → custo de entrada 20,775 → 20,78
    const m = c1.items.find((i: any) => i.skuId === mSku.id);
    expect(m.freightShare).toBe(4500);
    expect(m.landedUnitCost).toBe(2078);
    // custo médio ponderado
    const balAfter = (await listAll(store, "stock_balances", { filters: [["eq", "skuId", mSku.id], ["eq", "warehouseId", refs.warehouses["matriz-main"].id]] }))[0];
    expect(balAfter.physical).toBe(balBefore.physical + 24000);
    expect(balAfter.avgCost).toBe(roundDiv(balBefore.physical * balBefore.avgCost + 24000 * 2078, balBefore.physical + 24000));
    // custo do produto atualizado com histórico
    expect((await store.getOrThrow("skus", mSku.id)).costAcquisition).toBe(2078);
    expect((await listAll(store, "price_history", { filters: [["eq", "skuId", mSku.id], ["eq", "field", "costAcquisition"]] })).length).toBe(1);
    const sp = (await listAll(store, "supplier_products", { filters: [["eq", "supplierId", refs.suppliers.textil.id], ["eq", "skuId", mSku.id]] }))[0];
    expect(sp.lastCost).toBe(1890);
    // título único com as duplicatas do XML
    const titles1 = await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", r1.id]] });
    expect(titles1).toHaveLength(1);
    expect(titles1[0].total).toBe(c1.dueTotal);
    expect(titles1[0].partyId).toBe(refs.suppliers.textil.id);
    const inst1 = await listAll(store, "installments", { filters: [["eq", "titleId", titles1[0].id]] });
    expect(inst1).toHaveLength(2);
    expect(inst1.reduce((a, i) => a + i.amount, 0)).toBe(c1.dueTotal);
    // pedido parcial com saldo de 8 G
    const ord1 = await store.getOrThrow("purchase_orders", o.id);
    expect(ord1.status).toBe("partial");
    const bal1 = await orderBalance(store, o.id);
    expect(bal1.find((b) => b.skuId === gSku.id)!.remaining).toBe(8000);
    expect(bal1.find((b) => b.skuId === mSku.id)!.remaining).toBe(0);
    // pedido com recebimento não pode ser cancelado
    await expect(cancelOrder(admin, o.id, "teste")).rejects.toThrow(/recebimento/);

    // segunda entrada: o restante (sem frete)
    const xml2 = buildSampleNfeXml({ number: 5002, issueDate: today(), emitter: { cnpj: "45997418000153", name: "Têxtil Paulista Indústria Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-CAMISETA-G-PRETA", xProd: "CAMISETA G PRETA", qCom: 8000, vUnCom: 1890 }] });
    const r2 = await importNfeXml(stockist, { xml: xml2 });
    expect(r2.items[0].expectedQty).toBe(8000);
    const c2 = await confirmReceipt(stockist, r2.id);
    const ord2 = await store.getOrThrow("purchase_orders", o.id);
    expect(ord2.status).toBe("received");
    expect((await orderBalance(store, o.id)).every((b) => b.remaining === 0)).toBe(true);
    expect(ord2.receivedValue).toBe(40 * 1890);
    // obrigação total = soma do devido dos dois recebimentos; parcelas pela condição (sem duplicatas no XML)
    const allTitles = await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "partyId", refs.suppliers.textil.id]] });
    expect(allTitles).toHaveLength(2);
    expect(allTitles.reduce((a, t) => a + t.total, 0)).toBe(c1.dueTotal + c2.dueTotal);
    const inst2 = await listAll(store, "installments", { filters: [["eq", "titleId", c2.payableTitleId]] });
    expect(inst2.map((i) => i.dueDate).sort()).toEqual(buildSchedule(c2.dueTotal, { installments: 2, firstDueDays: 30, intervalDays: 30 }, today()).map((x) => x.dueDate));
    expect(inst2.reduce((a, i) => a + i.amount, 0)).toBe(c2.dueTotal);
  });

  it("confirmação concorrente/repetida não duplica estoque nem título", async () => {
    const sku = refs.skus["bone-u"];
    const xml = buildSampleNfeXml({ number: 5003, issueDate: today(), emitter: { cnpj: "45997418000153", name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE ABA CURVA", qCom: 10000, vUnCom: 1500 }] });
    const r = await importNfeXml(stockist, { xml });
    const before = (await listAll(store, "stock_balances", { filters: [["eq", "skuId", sku.id], ["eq", "warehouseId", refs.warehouses["matriz-main"].id]] }))[0].physical;
    await Promise.all([confirmReceipt(stockist, r.id), confirmReceipt(stockist, r.id)]);
    await confirmReceipt(stockist, r.id);
    const after = (await listAll(store, "stock_balances", { filters: [["eq", "skuId", sku.id], ["eq", "warehouseId", refs.warehouses["matriz-main"].id]] }))[0].physical;
    expect(after - before).toBe(10000);
    expect(await listAll(store, "titles", { filters: [["eq", "originId", r.id]] })).toHaveLength(1);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", r.id]] })).toHaveLength(1);
  });

  it("soma dos títulos nunca excede o valor devido sem divergência registrada", async () => {
    const sku = refs.skus["caneca-u"];
    // fornecedor novo cadastrado a partir do XML (mesma identidade no financeiro)
    const mk = (n: number) =>
      buildSampleNfeXml({ number: n, issueDate: today(), emitter: { cnpj: "27654321000166", name: "Casa Bela Utilidades Ltda", tradeName: "Casa Bela" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "CB-350", cEAN: "7891000800017", xProd: "CANECA 350ML", qCom: 10000, vUnCom: 1200 }], freight: 2000, duplicatas: [{ dVenc: addDays(today(), 15) }, { dVenc: addDays(today(), 45) }] });
    // estoquista não cadastra fornecedor: orientação clara; administrador importa e o cadastro nasce do XML
    await expect(importNfeXml(stockist, { xml: mk(9001) })).rejects.toThrow(/não está cadastrado/);
    const r = await importNfeXml(admin, { xml: mk(9001) });
    expect(r.items[0].mapping).toBe("barcode");
    const sup = await store.getOrThrow("suppliers", r.supplierId);
    expect(sup.doc).toBe("27654321000166");
    // recebidas 8 de 10 faturadas → devido 96,00 + frete 20,00 = 116,00 (faturado 140,00)
    const u = await updateReceipt(stockist, r.id, { items: [{ idx: 1, receivedQty: 8000, divergence: "2 caixas avariadas devolvidas ao transportador" }] });
    expect(u.dueTotal).toBe(9600 + 2000);
    expect(u.invoicedTotal).toBe(14000);
    expect(u.divergences.map((d: any) => d.kind)).toEqual(expect.arrayContaining(["qty", "value", "installments", "note"]));
    expect(u.installments.reduce((a: number, x: any) => a + x.amount, 0)).toBe(11600);
    const c = await confirmReceipt(stockist, r.id);
    const t = await store.getOrThrow("titles", c.payableTitleId);
    expect(t.total).toBe(11600);
    expect(t.total).toBeLessThanOrEqual(c.dueTotal);

    // pagar o valor faturado exige divergência registrada (justificativa)
    const r2 = await importNfeXml(stockist, { xml: mk(9002) });
    const u2 = await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 8000 }], differenceAction: "pay_invoiced" });
    expect(confirmBlockers(u2).join(" ")).toMatch(/justificativa/);
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/justificativa/);
    expect(await listAll(store, "titles", { filters: [["eq", "originId", r2.id]] })).toHaveLength(0);
    await updateReceipt(stockist, r2.id, { notes: "Fornecedor enviará reposição das 2 unidades sem custo; pagamento integral acordado com Marcos." });
    const c2 = await confirmReceipt(stockist, r2.id);
    const t2 = await store.getOrThrow("titles", c2.payableTitleId);
    expect(t2.total).toBe(14000);
    expect(c2.differenceAction).toBe("pay_invoiced");
  });

  it("recebimento sem XML: chave informada não recupera XML sem integração; itens do saldo do pedido", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 50000, unitCost: 990 }], paymentTermId: refs.terms.avista.id });
    await submitForApproval(admin, [o.id]);
    await decideRequest(manager, (await store.getOrThrow("purchase_orders", o.id)).requestId, "approve");
    const r = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeNumber: "333", idemKey: "t-manual-1" });
    expect(r.items[0].receivedQty).toBe(50000);
    await updateReceipt(stockist, r.id, { items: [{ idx: 1, receivedQty: 30000 }] });
    const c = await confirmReceipt(stockist, r.id);
    expect(c.dueTotal).toBe(30 * 990);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("partial");
    const again = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeNumber: "333", idemKey: "t-manual-1" });
    expect(again.id).toBe(r.id);
  });

  it("fixture de NF-e de exemplo é lida corretamente", () => {
    const xml = fs.readFileSync(path.join(__dirname, "fixtures", "nfe-exemplo-textil.xml"), "utf8");
    const n = parseNfeXml(xml);
    expect(n.emitter.cnpj).toBe("45997418000153");
    expect(n.recipient.cnpj).toBe(MATRIZ_CNPJ);
    expect(n.items.length).toBeGreaterThan(1);
    expect(n.items[0].cProd).toMatch(/^F-/);
    expect(n.duplicatas.reduce((a, d) => a + d.vDup, 0)).toBe(n.totals.vNF);
    expect(n.totals.vNF).toBe(n.totals.vProd - n.totals.vDesc + n.totals.vFrete + n.totals.vOutro);
    void orderId;
  });
});
