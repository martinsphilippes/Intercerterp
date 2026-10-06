import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import { savePolicy, submitForApproval, decideRequest, revokeDecision, requestDecisions } from "@/domain/approvals";
import { createQuotation, saveProposal, saveSelection, generateOrders } from "@/domain/quotations";
import { createOrder, cancelOrder, registerOrderSent } from "@/domain/purchases";
import { confirmReceipt, updateReceipt, createManualReceipt, cancelReceipt, confirmBlockers } from "@/domain/receipts";

/**
 * Rodada 2 de Compras: formulário de conferência desatualizado após erro na conclusão, frete do pedido quando
 * o recebimento que o assumiu é cancelado, decisão × cancelamento/envio concorrentes, valor exato da linha do
 * pedido (desconto na linha) e rascunho reaproveitado da cotação com condição/entrega novas.
 */

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let stockist: Ctx;
let papel: string;
let caneta: string;
let caderno: string;
let avista: string;

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

/** Contexto cuja PRÓXIMA transação é precedida por `before` (simula outra operação gravando entre a leitura e a gravação). */
function interceptTx(ctx: Ctx, before: () => Promise<unknown>): Ctx {
  let done = false;
  const base = ctx.store;
  const wrapped = Object.create(base) as Store;
  (wrapped as any).transaction = async (fn: any) => {
    if (!done) {
      done = true;
      await before();
    }
    return base.transaction(fn);
  };
  return { ...ctx, store: wrapped };
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  papel = refs.suppliers.papel.id;
  caneta = refs.skus["caneta-u"].id;
  caderno = refs.skus["caderno-u"].id;
  avista = refs.terms.avista.id;
  const roleManager = (await listAll(store, "roles")).find((r) => r.key === "manager")!;
  await savePolicy(admin, {
    name: "Teste rodada 2",
    rules: { tiers: [{ above: 0, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }] }], distinctApprovers: false },
    autoApproveBelow: 0,
    allowSelfApproval: false,
    expiredProposalAction: "warn",
    reviewOnRevision: "relevant",
  });
}, 120000);

describe("recebimento sem XML: formulário desatualizado após erro na conclusão", () => {
  it("reenviar os encargos exibidos não desliga o cálculo pelo pedido (título e soma dos recebimentos corretos)", async () => {
    // 10 × R$ 100,00, IPI R$ 50,00, desconto geral R$ 100,00, frete R$ 30,00 → R$ 980,00
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 10000, unitCost: 10000, ipi: 5000 }], headerDiscount: 10000, freight: 3000, paymentTermId: avista });
    expect(o.total).toBe(98000);
    await approve(o.id);
    const r = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-stale-1" });
    // o formulário foi carregado com os encargos do pedido inteiro
    const shown = { freight: r.freight, otherExpenses: r.otherExpenses, discount: r.discount };
    expect(shown).toEqual({ freight: 3000, otherExpenses: 5000, discount: 10000 });
    // "Concluir" com 4 un. recebidas sem marcar a conferência: a conferência é gravada (encargos proporcionais) e a conclusão é bloqueada
    await updateReceipt(stockist, r.id, { items: [{ idx: 1, receivedQty: 4000 }], ...shown, chargesShown: shown });
    await expect(confirmReceipt(stockist, r.id)).rejects.toThrow(/conferência física/);
    const saved = await store.getOrThrow("receipts", r.id);
    expect([saved.otherExpenses, saved.discount, saved.freight]).toEqual([2000, 4000, 3000]);
    // o mesmo formulário (não remontado) reenvia os valores antigos exibidos, agora com o item conferido
    const u = await updateReceipt(stockist, r.id, { items: [{ idx: 1, receivedQty: 4000, checked: true }], ...shown, chargesShown: shown });
    expect(u.orderCharges.auto).toBe(true);
    expect([u.otherExpenses, u.discount, u.freight]).toEqual([2000, 4000, 3000]);
    // 400 + IPI 20 − desconto 40 + frete 30 = 410
    expect(u.dueTotal).toBe(41000);
    await confirmReceipt(stockist, r.id);
    expect((await payables(r.id))[0].total).toBe(41000);
    // o saldo (6 un.) em outro recebimento fecha exatamente o total do pedido
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-stale-2" });
    await updateReceipt(stockist, r2.id, { checkAll: true });
    await confirmReceipt(stockist, r2.id);
    expect((await payables(r.id))[0].total + (await payables(r2.id))[0].total).toBe(o.total);
  });

  it("alterar um encargo em relação ao exibido passa a usar o valor informado", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 5000, unitCost: 1000 }], freight: 2000, paymentTermId: avista });
    await approve(o.id);
    const r = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-edit-1" });
    const shown = { freight: r.freight, otherExpenses: r.otherExpenses, discount: r.discount };
    const u = await updateReceipt(stockist, r.id, { ...shown, freight: 1500, chargesShown: shown });
    expect(u.orderCharges.auto).toBe(false);
    expect(u.freight).toBe(1500);
  });

  it("após charges_taken, o formulário antigo (com o frete exibido) não volta a cobrar o frete", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-taken-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-taken-2" });
    // os dois abertos ao mesmo tempo assumiram o frete
    await store.update("receipts", r2.id, { orderCharges: { auto: true, claimed: [o.id] } });
    await updateReceipt(stockist, r1.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    await confirmReceipt(stockist, r1.id);
    const shown = { freight: 5000, otherExpenses: 0, discount: 0 };
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }], ...shown, chargesShown: shown });
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/já foram cobrados/);
    expect((await store.getOrThrow("receipts", r2.id)).freight).toBe(0);
    // reenvio do formulário não remontado: frete R$ 50,00 ainda exibido
    const u = await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }], ...shown, chargesShown: shown });
    expect(u.freight).toBe(0);
    await confirmReceipt(stockist, r2.id);
    expect((await payables(r1.id))[0].total + (await payables(r2.id))[0].total).toBe(o.total);
  });

  it("encargos informados de pedido já cobrado: bloqueia até justificar (marcar + observação) ou recalcular pelo pedido", async () => {
    for (const path of ["ack", "recalc"] as const) {
      const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
      await approve(o.id);
      const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: `r2-lost-${path}-1` });
      const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: `r2-lost-${path}-2` });
      await store.update("receipts", r2.id, { orderCharges: { auto: true, claimed: [o.id] } });
      await updateReceipt(stockist, r1.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
      // r2: o usuário informa o frete (modo informado)
      const m = await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }], freight: 4000, otherExpenses: 0, discount: 0, chargesShown: { freight: 0, otherExpenses: 0, discount: 0 } });
      expect(m.orderCharges.auto).toBe(false);
      await confirmReceipt(stockist, r1.id);
      await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/já foram cobrados/);
      // reenvio sem mudança: continua bloqueado (não cobra o frete em dobro)
      const same = await updateReceipt(stockist, r2.id, { freight: 4000, otherExpenses: 0, discount: 0, chargesShown: { freight: 4000, otherExpenses: 0, discount: 0 } });
      expect(confirmBlockers(same).join(" ")).toMatch(/já foram cobrados no recebimento/);
      await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/já foram cobrados no recebimento/);
      expect(await payables(r2.id)).toHaveLength(0);
      if (path === "ack") {
        // marcar sem justificar ainda bloqueia
        await updateReceipt(stockist, r2.id, { chargesLostAck: true });
        await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/já foram cobrados no recebimento/);
        await updateReceipt(stockist, r2.id, { chargesLostAck: true, notes: "Fornecedor cobrou novo frete nesta segunda entrega (NF própria)." });
        await confirmReceipt(stockist, r2.id);
        expect((await payables(r2.id))[0].total).toBe(5000 + 4000);
      } else {
        const back = await updateReceipt(stockist, r2.id, { chargesAuto: true, freight: 4000, otherExpenses: 0, discount: 0 });
        expect(back.orderCharges.auto).toBe(true);
        expect(back.freight).toBe(0);
        await confirmReceipt(stockist, r2.id);
        expect((await payables(r1.id))[0].total + (await payables(r2.id))[0].total).toBe(o.total);
      }
    }
  });
});

describe("recebimento sem XML: o recebimento que assumiu o frete é cancelado", () => {
  it("o rascunho restante assume o frete na confirmação (revisão antes de concluir) e o frete é cobrado uma vez", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-cancel-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-cancel-2" });
    const r3 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-cancel-3" });
    expect([r1.freight, r2.freight, r3.freight]).toEqual([5000, 0, 0]);
    await cancelReceipt(stockist, r1.id, "Aberto em duplicidade");
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/ainda não tinham sido cobrados/);
    const again = await store.getOrThrow("receipts", r2.id);
    expect(again.status).toBe("draft");
    expect(again.freight).toBe(5000);
    expect(again.dueTotal).toBe(10000);
    expect(await payables(r2.id)).toHaveLength(0);
    await confirmReceipt(stockist, r2.id);
    await updateReceipt(stockist, r3.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    const c3 = await confirmReceipt(stockist, r3.id);
    expect(c3.freight).toBe(0);
    expect((await payables(r2.id))[0].total + (await payables(r3.id))[0].total).toBe(o.total);
  });

  // rodada 3: o frete fica com o recebimento que CONFIRMA a cobrança (vale quem confirmar primeiro) — a prévia da
  // abertura não reserva; assim uma entrega integral confirmada antes não deixa o frete sem cobrança
  it("vale quem confirmar primeiro: o rascunho que assumiu o frete na abertura é recalculado sem ele", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-active-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r2-active-2" });
    expect([r1.freight, r2.freight]).toEqual([5000, 0]);
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/ainda não tinham sido cobrados/);
    const c2 = await confirmReceipt(stockist, r2.id);
    expect(c2.freight).toBe(5000);
    await updateReceipt(stockist, r1.id, { items: [{ idx: 1, receivedQty: 5000, checked: true }] });
    await expect(confirmReceipt(stockist, r1.id)).rejects.toThrow(/já foram cobrados no recebimento/);
    const c1 = await confirmReceipt(stockist, r1.id);
    expect(c1.freight).toBe(0);
    expect((await payables(r1.id))[0].total + (await payables(r2.id))[0].total).toBe(o.total);
  });
});

describe("aprovação × cancelamento/envio concorrentes (vaga da decisão)", () => {
  it("pedido cancelado entre a leitura e a gravação da decisão não volta como aprovado", async () => {
    const o1 = await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 1000, unitCost: 990 }], paymentTermId: avista });
    const o2 = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 1000, unitCost: 500 }], paymentTermId: avista });
    const req = await submitForApproval(admin, [o1.id, o2.id]);
    const mgr = interceptTx(manager, () => cancelOrder(admin, o1.id, "Fornecedor desistiu"));
    await expect(decideRequest(mgr, req.id, "approve", "ok", { step: 0, revision: 1 })).rejects.toThrow(/enquanto você decidia/);
    expect((await store.getOrThrow("purchase_orders", o1.id)).status).toBe("cancelled");
    expect((await store.getOrThrow("purchase_orders", o2.id)).status).toBe("in_review");
    expect((await requestDecisions(store, req.id)).length).toBe(0);
    expect((await store.getOrThrow("purchase_requests", req.id)).total).toBe(o2.total);
    // nova decisão (página atualizada) aprova só o pedido ativo
    const d = await decideRequest(manager, req.id, "approve", "ok", { step: 0, revision: 1 });
    expect(d.request.status).toBe("approved");
    expect((await store.getOrThrow("purchase_orders", o1.id)).status).toBe("cancelled");
    expect((await store.getOrThrow("purchase_orders", o2.id)).status).toBe("approved");
  });

  it("cancelamento do último pedido concorrente com a decisão: solicitação cancelada, nada aprovado", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 1000, unitCost: 990 }], paymentTermId: avista });
    const req = await submitForApproval(admin, [o.id]);
    const mgr = interceptTx(manager, () => cancelOrder(admin, o.id, "Compra desnecessária"));
    await expect(decideRequest(mgr, req.id, "approve", "ok", { step: 0, revision: 1 })).rejects.toThrow(/enquanto você decidia/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("cancelled");
    expect((await store.getOrThrow("purchase_requests", req.id)).status).toBe("cancelled");
  });

  it("envio registrado entre a leitura e a gravação da revogação: pedido enviado não volta para análise", async () => {
    const o = await approve((await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 1000, unitCost: 990 }], paymentTermId: avista })).id);
    const dec = (await requestDecisions(store, o.requestId)).filter((d) => !d.revokedAt).pop()!;
    const mgr = interceptTx(manager, () => registerOrderSent(admin, o.id, { method: "manual", channel: "Telefone", contact: "Rogério" }));
    await expect(revokeDecision(mgr, dec.id, "Revisar preço")).rejects.toThrow(/enquanto você decidia/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("sent");
    expect((await store.getOrThrow("purchase_requests", o.requestId)).status).toBe("approved");
  });

  it("revogação gravada entre a leitura e a gravação do envio: o envio relê o pedido e é recusado", async () => {
    const o = await approve((await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 1000, unitCost: 990 }], paymentTermId: avista })).id);
    const dec = (await requestDecisions(store, o.requestId)).filter((d) => !d.revokedAt).pop()!;
    const adm = interceptTx(admin, () => revokeDecision(manager, dec.id, "Revisar preço"));
    await expect(registerOrderSent(adm, o.id, { method: "manual", channel: "Telefone", contact: "Rogério" })).rejects.toThrow(/não está mais aprovado/);
    const after = await store.getOrThrow("purchase_orders", o.id);
    expect(after.status).toBe("in_review");
    expect(after.sentInfo ?? null).toBeNull();
  });
});

describe("valor exato da linha do pedido (desconto na linha)", () => {
  it("3 × R$ 10,00 − R$ 1,00: recebimento integral devido R$ 29,00 sem divergência; parciais somam R$ 29,00", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 3000, unitCost: 1000, discount: 100 }], paymentTermId: avista });
    expect(o.total).toBe(2900);
    await approve(o.id);
    const r = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], invoicedTotal: 2900, idemKey: "r2-exact-1" });
    expect(r.dueTotal).toBe(2900);
    expect((r.divergences ?? []).map((d: any) => d.kind)).toEqual([]);
    await updateReceipt(stockist, r.id, { checkAll: true });
    await confirmReceipt(stockist, r.id);
    expect((await payables(r.id))[0].total).toBe(2900);

    const o2 = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 3000, unitCost: 1000, discount: 100 }], paymentTermId: avista });
    await approve(o2.id);
    const a = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o2.id], idemKey: "r2-exact-2" });
    const ua = await updateReceipt(stockist, a.id, { items: [{ idx: 1, receivedQty: 2000, checked: true }] });
    expect(ua.dueTotal).toBe(1933);
    expect(ua.divergences.some((d: any) => d.kind === "price")).toBe(false);
    await confirmReceipt(stockist, a.id);
    const b = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o2.id], idemKey: "r2-exact-3" });
    expect(b.dueTotal).toBe(967);
    await updateReceipt(stockist, b.id, { checkAll: true });
    await confirmReceipt(stockist, b.id);
    expect((await payables(a.id))[0].total + (await payables(b.id))[0].total).toBe(o2.total);
  });
});

describe("cotação: rascunho reaproveitado com condição/entrega novas", () => {
  it("mesmo total, outra condição de pagamento e entrega: o rascunho é ressincronizado", async () => {
    const q = await createQuotation(admin, { title: "Canetas", items: [{ skuId: caneta, qty: 10000 }], supplierIds: [papel] });
    const delivery = addDays(today(), 12);
    await saveProposal(admin, q.id, { supplierId: papel, validUntil: addDays(today(), 10), paymentTermsText: "30/60/90 dias", items: [{ skuId: caneta, unitPrice: 990, deliveryDate: delivery }] });
    await saveSelection(admin, q.id, { [caneta]: papel }, "manual");
    // tentativa anterior interrompida: rascunho com os mesmos itens/total, mas condição e entrega antigas
    const partial = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 990 }], expectedDate: addDays(today(), 40), paymentTermsText: "À vista", origin: "quotation", originId: q.id, quotationId: q.id, idemKey: `quotation:${q.id}:${papel}` });
    const r = await generateOrders(admin, q.id);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].id).toBe(partial.id);
    const o = await store.getOrThrow("purchase_orders", partial.id);
    expect(o.paymentTermsText).toBe("30/60/90 dias");
    expect(o.expectedDate).toBe(delivery);
    expect(o.total).toBe(partial.total);
  });
});
