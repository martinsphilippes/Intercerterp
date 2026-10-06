import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import { createSupplier, setSupplierStatus, updateSupplier, upsertSupplierProduct } from "@/domain/suppliers";
import { detId } from "@/lib/db";
import { savePolicy, submitForApproval, decideRequest } from "@/domain/approvals";
import { createQuotation, updateQuotation, saveProposal, saveSelection, quotationView, generateOrders } from "@/domain/quotations";
import { createOrder, updateOrder, cancelOrder, registerOrderSent, orderItems } from "@/domain/purchases";
import { importNfeXml, confirmReceipt, updateReceipt, createManualReceipt, cancelReceipt, confirmBlockers } from "@/domain/receipts";
import { buildSampleNfeXml, buildNfeKey, parseNfeXml } from "@/domain/nfe-xml";
import { computeBranchReplenishment, createDraftsFromReplenishment } from "@/domain/replenishment";

/**
 * Regressões dos achados da revisão de Compras (recebimento sem XML, cancelamento e reimportação,
 * concorrência na aprovação, reposição com fornecedor bloqueado, geração de pedidos da cotação,
 * limite de gravações, filial, pedidos no XML, NF-e de homologação/sem protocolo e SKU repetido).
 */

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let director: Ctx;
let stockist: Ctx;
const MATRIZ_CNPJ = "11222333000181";
const TEXTIL_CNPJ = "45997418000153";

async function approve(orderId: string) {
  const o = await store.getOrThrow("purchase_orders", orderId);
  if (o.status === "draft") await submitForApproval(admin, [orderId]);
  const req = (await store.getOrThrow("purchase_orders", orderId)).requestId;
  await decideRequest(manager, req, "approve", "ok");
  return store.getOrThrow("purchase_orders", orderId);
}

async function payables(receiptId: string) {
  return listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", receiptId]] });
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  director = await refs.ctxFor("director", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  const roleManager = (await listAll(store, "roles")).find((r) => r.key === "manager")!;
  await savePolicy(admin, {
    name: "Teste",
    rules: {
      tiers: [
        { above: 0, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }] },
        { above: 500000, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }, { name: "Diretoria", kind: "users", userIds: [refs.users.director.id] }] },
      ],
      distinctApprovers: true,
    },
    autoApproveBelow: 0,
    allowSelfApproval: false,
    expiredProposalAction: "warn",
    reviewOnRevision: "relevant",
  });
}, 120000);

describe("recebimento sem XML: encargos do pedido e total faturado", () => {
  it("considera desconto geral, IPI, seguro e frete do pedido; título igual ao total aprovado", async () => {
    // 10 × R$ 100,00, IPI R$ 50,00, desconto geral R$ 100,00, frete R$ 50,00, seguro R$ 20,00 → R$ 1.020,00
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 10000, unitCost: 10000, ipi: 5000 }], headerDiscount: 10000, freight: 5000, insurance: 2000, paymentTermId: refs.terms.avista.id });
    expect(o.total).toBe(102000);
    await approve(o.id);
    const r = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeNumber: "9001", invoicedTotal: 102000, idemKey: "fix-manual-1" });
    expect(r.dueTotal).toBe(102000);
    expect(r.discount).toBe(10000);
    expect(r.freight).toBe(5000);
    expect(r.otherExpenses).toBe(5000 + 2000);
    expect((r.divergences ?? []).some((d: any) => d.kind === "value")).toBe(false);
    await updateReceipt(stockist, r.id, { checkAll: true });
    const c = await confirmReceipt(stockist, r.id);
    const t = await payables(r.id);
    expect(t).toHaveLength(1);
    expect(t[0].total).toBe(o.total);
    // custo de entrada = total do pedido ÷ quantidade
    expect(c.items[0].landedUnitCost).toBe(10200);
  });

  it("recebimento parcial: IPI e desconto geral proporcionais ao recebido", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 10000, unitCost: 10000, ipi: 5000 }], headerDiscount: 10000, paymentTermId: refs.terms.avista.id });
    await approve(o.id);
    const r = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], idemKey: "fix-manual-partial" });
    const u = await updateReceipt(stockist, r.id, { items: [{ idx: 1, receivedQty: 4000, checked: true }] });
    // 4 × 100 = 400; IPI 50 × 4/10 = 20; desconto geral 100 × 4/10 = 40 → 380
    expect(u.discount).toBe(4000);
    expect(u.otherExpenses).toBe(2000);
    expect(u.dueTotal).toBe(38000);
  });

  it("total faturado informado diferente do devido gera divergência e exige justificativa", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caneta-u"].id, qty: 5000, unitCost: 2000 }], freight: 1000, paymentTermId: refs.terms.avista.id });
    await approve(o.id);
    const r = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], invoicedTotal: 12000, idemKey: "fix-manual-value" });
    expect(r.dueTotal).toBe(11000);
    expect(r.divergences.some((d: any) => d.kind === "value")).toBe(true);
    const u = await updateReceipt(stockist, r.id, { checkAll: true });
    expect(confirmBlockers(u).join(" ")).toMatch(/Total faturado/);
    await expect(confirmReceipt(stockist, r.id)).rejects.toThrow(/Total faturado/);
    expect(await payables(r.id)).toHaveLength(0);
    await updateReceipt(stockist, r.id, { notes: "Fornecedor cobrou R$ 10,00 de taxa de entrega extra — acordado." });
    const c = await confirmReceipt(stockist, r.id);
    expect(c.status).toBe("confirmed");
    expect((await payables(r.id))[0].total).toBe(11000);
  });

  it("dois recebimentos sem XML do mesmo pedido cobram o frete uma única vez", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caneta-u"].id, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: refs.terms.avista.id });
    expect(o.total).toBe(15000);
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], idemKey: "fix-freight-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], idemKey: "fix-freight-2" });
    expect(r1.freight).toBe(5000);
    expect(r2.freight).toBe(0);
    await updateReceipt(stockist, r1.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    await confirmReceipt(stockist, r1.id);
    await confirmReceipt(stockist, r2.id);
    const sum = (await payables(r1.id))[0].total + (await payables(r2.id))[0].total;
    expect(sum).toBe(o.total);
  });

  it("corrida: os dois recebimentos assumiram o frete → a segunda confirmação recalcula sem ele", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caneta-u"].id, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: refs.terms.avista.id });
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], idemKey: "fix-race-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], idemKey: "fix-race-2" });
    // simula os dois abertos ao mesmo tempo (ambos herdaram o frete)
    await store.update("receipts", r2.id, { orderCharges: { auto: true, claimed: [o.id] } });
    await updateReceipt(stockist, r1.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    const u2 = await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    expect(u2.freight).toBe(5000);
    await confirmReceipt(stockist, r1.id);
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/já foram cobrados/);
    expect(await payables(r2.id)).toHaveLength(0);
    const again = await store.getOrThrow("receipts", r2.id);
    expect(again.freight).toBe(0);
    await confirmReceipt(stockist, r2.id);
    const sum = (await payables(r1.id))[0].total + (await payables(r2.id))[0].total;
    expect(sum).toBe(o.total);
  });
});

describe("cancelamento libera a chave da NF-e", () => {
  it("XML: importar → cancelar → importar de novo cria outro recebimento; duplicata ativa continua bloqueada", async () => {
    const xml = buildSampleNfeXml({ number: 7101, issueDate: today(), emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE", qCom: 1000, vUnCom: 1500 }] });
    const r1 = await importNfeXml(stockist, { xml, orderIds: [] });
    await expect(importNfeXml(stockist, { xml, orderIds: [] })).rejects.toThrow(/já foi importada/);
    await cancelReceipt(stockist, r1.id, "XML errado");
    const r2 = await importNfeXml(stockist, { xml, orderIds: [] });
    expect(r2.id).not.toBe(r1.id);
    expect(r2.status).toBe("draft");
    await expect(importNfeXml(stockist, { xml, orderIds: [] })).rejects.toThrow(/já foi importada/);
  });

  it("sem XML com chave: cancelar libera a chave para novo recebimento", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 2000, unitCost: 990 }], paymentTermId: refs.terms.avista.id });
    await approve(o.id);
    const key = buildNfeKey({ uf: "35", yymm: "2610", cnpj: refs.suppliers.papel.doc, series: 1, number: 4455, code: 12345678 });
    const r1 = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeKey: key, idemKey: "fix-key-1" });
    await expect(createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeKey: key, idemKey: "fix-key-2" })).rejects.toThrow(/Chave já registrada/);
    await cancelReceipt(stockist, r1.id, "Chave digitada no pedido errado");
    const r2 = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], nfeKey: key, idemKey: "fix-key-3" });
    expect(r2.id).not.toBe(r1.id);
    expect(r2.status).toBe("draft");
  });
});

describe("aprovação: concorrência e etapa vista na tela", () => {
  it("aprovar e rejeitar ao mesmo tempo: só uma decisão vale e solicitação/pedidos ficam coerentes", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000, unitCost: 990 }], paymentTermId: refs.terms.avista.id });
    const req = await submitForApproval(admin, [o.id]);
    expect(req.steps).toHaveLength(1);
    const res = await Promise.allSettled([decideRequest(manager, req.id, "approve", "ok", { step: 0, revision: 1 }), decideRequest(director, req.id, "reject", "Preço alto", { step: 0, revision: 1 })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const after = await store.getOrThrow("purchase_requests", req.id);
    const order = await store.getOrThrow("purchase_orders", o.id);
    const decisions = (await listAll(store, "approval_decisions", { filters: [["eq", "requestId", req.id]] })).filter((d) => !d.revokedAt);
    expect(decisions).toHaveLength(1);
    expect(after.status).toBe(decisions[0].decision === "approve" ? "approved" : "rejected");
    expect(order.status).toBe(after.status);
  });

  it("página desatualizada: decisão da etapa 1 já tomada não vale para a etapa 2", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.eletro.id, items: [{ skuId: refs.skus["fone-u"].id, qty: 100000, unitCost: 5900 }], paymentTermId: refs.terms.avista.id });
    const req = await submitForApproval(admin, [o.id]);
    expect(req.steps).toHaveLength(2);
    await decideRequest(manager, req.id, "approve", "ok", { step: 0, revision: 1 });
    // a diretora abriu a página quando a etapa atual ainda era a 1ª
    await expect(decideRequest(director, req.id, "approve", "ok", { step: 0, revision: 1 })).rejects.toThrow(/mudou desde que você abriu/);
    expect((await store.getOrThrow("purchase_requests", req.id)).status).toBe("in_review");
    const fin = await decideRequest(director, req.id, "approve", "ok", { step: 1, revision: 1 });
    expect(fin.request.status).toBe("approved");
  });

  it("decisão exige a filial da solicitação", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 990 }], paymentTermId: refs.terms.avista.id });
    const req = await submitForApproval(admin, [o.id]);
    await expect(decideRequest(await refs.ctxFor("manager", null), req.id, "approve", "ok")).rejects.toThrow(/filial/);
    await expect(decideRequest(await refs.ctxFor("manager", "shopping"), req.id, "approve", "ok")).rejects.toThrow(/outra filial/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("in_review");
  });
});

describe("reposição com fornecedor bloqueado", () => {
  let blockedId: string;
  beforeAll(async () => {
    const s = await createSupplier(admin, { personType: "PJ", doc: "12345678000195", name: "Zeta Distribuidora Ltda", tradeName: "Zeta", status: "active" });
    blockedId = s.id;
    await upsertSupplierProduct(admin, { supplierId: blockedId, skuId: refs.skus["caneta-u"].id, supplierCode: "Z-CAN", lastCost: 1500, preferred: true });
    await setSupplierStatus(admin, blockedId, "blocked", "Documentação vencida");
  });

  it("fornecedor bloqueado não é sugerido nem entra nas opções; aparece como indisponível", async () => {
    const rows = await computeBranchReplenishment(store, refs.company.id, { branchId: refs.branches.matriz.id, skuIds: [refs.skus["caneta-u"].id] });
    expect(rows[0].supplierId).toBe(refs.suppliers.papel.id);
    expect(rows[0].supplierOptions.map((x) => x.supplierId)).not.toContain(blockedId);
    expect(rows[0].unavailableSuppliers.map((x) => x.supplierId)).toContain(blockedId);
    expect(rows[0].unavailableSuppliers[0].statusLabel).toBe("bloqueado");
  });

  it("rascunhos com fornecedor bloqueado: nada é criado e a mensagem diz o motivo", async () => {
    const before = (await listAll(store, "purchase_orders", { filters: [["eq", "origin", "replenishment"]] })).length;
    await expect(
      createDraftsFromReplenishment(admin, [{ skuId: refs.skus["caderno-u"].id, qty: 10000, supplierId: refs.suppliers.papel.id, unitCost: 990 }, { skuId: refs.skus["caneta-u"].id, qty: 5000, supplierId: blockedId, unitCost: 1500 }], { idemKey: "fix-rep-blocked" }),
    ).rejects.toThrow(/Nenhum rascunho foi criado.*bloqueado/);
    expect((await listAll(store, "purchase_orders", { filters: [["eq", "origin", "replenishment"]] })).length).toBe(before);
  });

  it("mesma chave com seleção diferente após falha não devolve o rascunho antigo", async () => {
    const a = await createDraftsFromReplenishment(admin, [{ skuId: refs.skus["caderno-u"].id, qty: 10000, supplierId: refs.suppliers.papel.id, unitCost: 990 }], { idemKey: "fix-rep-key" });
    const again = await createDraftsFromReplenishment(admin, [{ skuId: refs.skus["caderno-u"].id, qty: 10000, supplierId: refs.suppliers.papel.id, unitCost: 990 }], { idemKey: "fix-rep-key" });
    expect(again[0].id).toBe(a[0].id);
    const b = await createDraftsFromReplenishment(admin, [{ skuId: refs.skus["caderno-u"].id, qty: 20000, supplierId: refs.suppliers.papel.id, unitCost: 990 }], { idemKey: "fix-rep-key" });
    expect(b[0].id).not.toBe(a[0].id);
    expect((await orderItems(store, b[0].id))[0].qty).toBe(20000);
  });
});

describe("cotação: fornecedor de outra empresa e geração de pedidos após falha parcial", () => {
  it("fornecedor de outra empresa é recusado e nunca aparece na cotação", async () => {
    const foreign = await store.create("suppliers", { companyId: "outra-empresa", personType: "PJ", doc: "11444777000161", name: "Segredo Comercial Outra Empresa", status: "active", paymentTermsText: "Condição secreta" });
    const q = await createQuotation(admin, { title: "Teste", items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000 }], supplierIds: [refs.suppliers.papel.id] });
    await expect(updateQuotation(admin, q.id, { title: "Teste", items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000 }], supplierIds: [refs.suppliers.papel.id, foreign.id] })).rejects.toThrow(/não encontrado nesta empresa/);
    // registro legado com o id estrangeiro: proposta recusada e nada exposto na visão
    await store.update("quotations", q.id, { supplierIds: [refs.suppliers.papel.id, foreign.id] });
    await expect(saveProposal(admin, q.id, { supplierId: foreign.id, items: [{ skuId: refs.skus["caderno-u"].id, unitPrice: 900 }] })).rejects.toThrow(/não encontrado nesta empresa/);
    const v = await quotationView(admin, q.id);
    expect([...v.names.values()].join(" ")).not.toMatch(/Segredo/);
  });

  it("falha parcial + mudança de seleção: rascunho reaproveitado é ressincronizado e o órfão é cancelado", async () => {
    const caderno = refs.skus["caderno-u"].id;
    const caneta = refs.skus["caneta-u"].id;
    const q = await createQuotation(admin, { title: "Papelaria", items: [{ skuId: caderno, qty: 10000 }, { skuId: caneta, qty: 5000 }], supplierIds: [refs.suppliers.papel.id, refs.suppliers.textil.id] });
    const valid = addDays(today(), 10);
    await saveProposal(admin, q.id, { supplierId: refs.suppliers.papel.id, validUntil: valid, items: [{ skuId: caderno, unitPrice: 990 }, { skuId: caneta, unitPrice: 2100 }] });
    await saveProposal(admin, q.id, { supplierId: refs.suppliers.textil.id, validUntil: valid, items: [{ skuId: caderno, unitPrice: 1000 }, { skuId: caneta, unitPrice: 2000 }] });
    await saveSelection(admin, q.id, { [caderno]: refs.suppliers.papel.id, [caneta]: refs.suppliers.textil.id }, "manual");
    // tentativa anterior interrompida deixou os dois rascunhos da seleção antiga
    const partialPapel = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: caderno, qty: 10000, unitCost: 990 }], origin: "quotation", originId: q.id, quotationId: q.id, idemKey: `quotation:${q.id}:${refs.suppliers.papel.id}` });
    const partialTextil = await createOrder(admin, { supplierId: refs.suppliers.textil.id, items: [{ skuId: caneta, qty: 5000, unitCost: 2000 }], origin: "quotation", originId: q.id, quotationId: q.id, idemKey: `quotation:${q.id}:${refs.suppliers.textil.id}` });
    // o usuário move tudo para a Papel & Cia e gera de novo
    const ev = await saveSelection(admin, q.id, { [caderno]: refs.suppliers.papel.id, [caneta]: refs.suppliers.papel.id }, "manual");
    const r = await generateOrders(admin, q.id);
    expect(r.created).toBe(true);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].id).toBe(partialPapel.id);
    expect(r.orders[0].total).toBe(ev.grandTotal);
    expect((await orderItems(store, partialPapel.id)).map((i) => i.skuId).sort()).toEqual([caderno, caneta].sort());
    expect((await store.getOrThrow("purchase_orders", partialTextil.id)).status).toBe("cancelled");
  });

  it("fornecedor bloqueado não pode ser escolhido na seleção", async () => {
    const s = await createSupplier(admin, { personType: "PJ", doc: "04252011000110", name: "Bloqueada Ltda", status: "active" });
    const q = await createQuotation(admin, { title: "Bloq", items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000 }], supplierIds: [s.id] });
    await saveProposal(admin, q.id, { supplierId: s.id, validUntil: addDays(today(), 5), items: [{ skuId: refs.skus["caderno-u"].id, unitPrice: 900 }] });
    await setSupplierStatus(admin, s.id, "blocked", "Teste");
    await expect(saveSelection(admin, q.id, { [refs.skus["caderno-u"].id]: s.id }, "manual")).rejects.toThrow(/bloqueado/);
  });
});

describe("pedido: SKU repetido e limite de gravações", () => {
  it("SKU repetido soma IPI; custos diferentes são recusados", async () => {
    const sku = refs.skus["caderno-u"].id;
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: sku, qty: 1000, unitCost: 1000, ipi: 100 }, { skuId: sku, qty: 1000, unitCost: 1000, ipi: 100 }] });
    expect(o.total).toBe(2200);
    expect(o.ipiTotal).toBe(200);
    await expect(createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: sku, qty: 1000, unitCost: 1000 }, { skuId: sku, qty: 1000, unitCost: 1200 }] })).rejects.toThrow(/custos diferentes/);
  });

  it("edição com mais de 100 gravações é recusada com orientação (antes de abrir a transação)", async () => {
    const productId = refs.skus["caderno-u"].productId;
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const k = await store.create("skus", { companyId: refs.company.id, productId, sku: `LOTE-${i}`, name: `Item de teste ${i}`, unitCode: "UN", active: true });
      ids.push(k.id);
    }
    const first = ids.slice(0, 60).map((skuId) => ({ skuId, qty: 1000, unitCost: 100 }));
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: first });
    // trocar os 60 produtos por outros 60: 1 + 60 remoções + 60 inclusões
    await expect(updateOrder(admin, o.id, { supplierId: refs.suppliers.papel.id, items: ids.slice(60).map((skuId) => ({ skuId, qty: 1000, unitCost: 100 })) })).rejects.toThrow(/grande demais/);
    expect(await orderItems(store, o.id)).toHaveLength(60);
    // salvar sem mudanças nos itens não regrava os 60 itens; trocar 20 itens cabe
    await updateOrder(admin, o.id, { supplierId: refs.suppliers.papel.id, items: first, notes: "sem mudança nos itens" });
    const swapped = [...first.slice(0, 40), ...ids.slice(60, 80).map((skuId) => ({ skuId, qty: 1000, unitCost: 100 }))];
    const r = await updateOrder(admin, o.id, { supplierId: refs.suppliers.papel.id, items: swapped });
    expect(r.order.total).toBe(60 * 100);
    expect((await orderItems(store, o.id)).map((i) => i.skuId).sort()).toEqual(swapped.map((i) => i.skuId).sort());
  });
});

describe("filial nas escritas de compras", () => {
  it("recebimento: consolidado ou outra filial não confere, confirma nem cancela", async () => {
    const xml = buildSampleNfeXml({ number: 7201, issueDate: today(), emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE", qCom: 1000, vUnCom: 1500 }] });
    const r = await importNfeXml(stockist, { xml, orderIds: [] });
    await updateReceipt(stockist, r.id, { checkAll: true });
    const consolidated = await refs.ctxFor("stockist", null);
    const other = await refs.ctxFor("stockist", "shopping");
    for (const ctx of [consolidated, other]) {
      await expect(confirmReceipt(ctx, r.id)).rejects.toThrow(/filial/);
      await expect(updateReceipt(ctx, r.id, { notes: "x" })).rejects.toThrow(/filial/);
      await expect(cancelReceipt(ctx, r.id, "x")).rejects.toThrow(/filial/);
    }
    expect(await payables(r.id)).toHaveLength(0);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", r.id]] })).toHaveLength(0);
    expect((await store.getOrThrow("receipts", r.id)).status).toBe("draft");
  });

  it("pedido: cancelar/enviar exige a filial do pedido", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 990 }] });
    await expect(cancelOrder(await refs.ctxFor("admin", null), o.id, "x")).rejects.toThrow(/filial/);
    await expect(cancelOrder(await refs.ctxFor("admin", "shopping"), o.id, "x")).rejects.toThrow(/outra filial/);
    await approve(o.id);
    await expect(registerOrderSent(await refs.ctxFor("admin", "shopping"), o.id, { method: "manual", channel: "Telefone", contact: "X" })).rejects.toThrow(/outra filial/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("approved");
  });
});

describe("importação de XML: pedidos informados e situação da NF-e", () => {
  it("recusa pedido de outro fornecedor; pedido que voltou para análise bloqueia a confirmação", async () => {
    const papelOrder = await approve((await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000, unitCost: 990 }] })).id);
    const xml = buildSampleNfeXml({ number: 7301, issueDate: today(), emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE", qCom: 2000, vUnCom: 1500 }] });
    await expect(importNfeXml(stockist, { xml, orderIds: [papelOrder.id] })).rejects.toThrow(/outro fornecedor/);
    // pedido em rascunho não pode ser vinculado
    const draft = await createOrder(admin, { supplierId: refs.suppliers.textil.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 2000, unitCost: 1500 }] });
    await expect(importNfeXml(stockist, { xml, orderIds: [draft.id] })).rejects.toThrow(/não está aprovado/);
    const textil = await approve(draft.id);
    const r = await importNfeXml(stockist, { xml, orderIds: [textil.id] });
    expect(r.orderIds).toEqual([textil.id]);
    await updateReceipt(stockist, r.id, { checkAll: true });
    // revisão comercial com aumento → volta para análise
    const its = await orderItems(store, textil.id);
    const rev = await updateOrder(admin, textil.id, { supplierId: textil.supplierId, items: its.map((i) => ({ skuId: i.skuId, qty: i.qty + 1000, unitCost: i.unitCost })), revisionReason: "Aumento" });
    expect(rev.order.status).toBe("in_review");
    await expect(confirmReceipt(stockist, r.id)).rejects.toThrow(/Em análise/);
    expect(await payables(r.id)).toHaveLength(0);
  });

  it("NF-e de homologação é recusada em empresa real; denegada é sempre recusada", async () => {
    const base = { issueDate: today(), emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE", qCom: 1000, vUnCom: 1500 }] };
    expect(parseNfeXml(buildSampleNfeXml({ ...base, number: 7400 })).environment).toBe("homologacao");
    await store.update("companies", refs.company.id, { isDemo: false });
    try {
      await expect(importNfeXml(stockist, { xml: buildSampleNfeXml({ ...base, number: 7401 }), orderIds: [] })).rejects.toThrow(/HOMOLOGAÇÃO/);
      const prod = await importNfeXml(stockist, { xml: buildSampleNfeXml({ ...base, number: 7402, environment: "producao" }), orderIds: [] });
      expect(prod.emitter.environment).toBe("producao");
      expect(prod.emitter.authorized).toBe(true);
    } finally {
      await store.update("companies", refs.company.id, { isDemo: true });
    }
    await expect(importNfeXml(stockist, { xml: buildSampleNfeXml({ ...base, number: 7403, protocol: { cStat: "110", xMotivo: "Uso Denegado" } }), orderIds: [] })).rejects.toThrow(/DENEGADO/);
    // na demonstração, aceita e identifica como homologação
    const demo = await importNfeXml(stockist, { xml: buildSampleNfeXml({ ...base, number: 7404 }), orderIds: [] });
    expect(demo.emitter.environment).toBe("homologacao");
    expect(demo.emitter.homologationAccepted).toBe(true);
  });

  it("XML sem protocolo de autorização só entra com justificativa", async () => {
    const xml = buildSampleNfeXml({ number: 7501, issueDate: today(), emitter: { cnpj: TEXTIL_CNPJ, name: "Têxtil Paulista" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "F-BONE", xProd: "BONE", qCom: 1000, vUnCom: 1500 }], protocol: false });
    const r = await importNfeXml(stockist, { xml, orderIds: [] });
    expect(r.emitter.authorized).toBe(false);
    await updateReceipt(stockist, r.id, { checkAll: true });
    await expect(confirmReceipt(stockist, r.id)).rejects.toThrow(/sem protocolo de autorização/);
    expect(await payables(r.id)).toHaveLength(0);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", r.id]] })).toHaveLength(0);
    await updateReceipt(stockist, r.id, { notes: "Autorização conferida no portal da SEFAZ em " + today() });
    const c = await confirmReceipt(stockist, r.id);
    expect(c.status).toBe("confirmed");
  });
});

describe("fornecedor: identidade não deriva do CNPJ", () => {
  it("corrigir o CNPJ libera o anterior; id não é previsível pelo documento; conflito diz quem usa; envio repetido não duplica", async () => {
    const A = "07526557000100";
    const B = "19131243000197";
    const a = await createSupplier(admin, { personType: "PJ", doc: A, name: "Fornecedor Digitado Errado Ltda", status: "active" }, { idemKey: "fix-sup-1" });
    expect(a.id).not.toBe(detId("supplier", refs.company.id, A));
    // repetição do mesmo envio (duplo clique) devolve o mesmo cadastro
    expect((await createSupplier(admin, { personType: "PJ", doc: A, name: "Fornecedor Digitado Errado Ltda", status: "active" }, { idemKey: "fix-sup-1" })).id).toBe(a.id);
    await expect(createSupplier(admin, { personType: "PJ", doc: A, name: "Outro", status: "active" })).rejects.toThrow(/Já existe fornecedor com este CNPJ: Fornecedor Digitado Errado/);
    // correção do documento: o CNPJ antigo fica livre para o fornecedor certo
    await updateSupplier(admin, a.id, { personType: "PJ", doc: B, name: "Fornecedor Digitado Errado Ltda", status: "active" });
    const certo = await createSupplier(admin, { personType: "PJ", doc: A, name: "Dono Real do CNPJ Ltda", status: "active" });
    expect(certo.doc).toBe(A);
    expect(certo.id).not.toBe(a.id);
    // conflito na alteração identifica quem já usa o documento
    await expect(updateSupplier(admin, certo.id, { personType: "PJ", doc: B, name: "Dono Real do CNPJ Ltda", status: "active" })).rejects.toThrow(/CNPJ já usado pelo fornecedor Fornecedor Digitado Errado/);
  });
});
