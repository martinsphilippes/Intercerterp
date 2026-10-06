import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { savePolicy, submitForApproval, decideRequest, revokeDecision, requestDecisions } from "@/domain/approvals";
import { createOrder, cancelOrder, orderItems, updateOrder } from "@/domain/purchases";
import { confirmReceipt, updateReceipt, createManualReceipt, cancelReceipt, importNfeXml, receiptMovements } from "@/domain/receipts";
import { buildSampleNfeXml } from "@/domain/nfe-xml";
import { today } from "@/lib/dates";

/**
 * Rodada 3 de Compras: frete do pedido cobrado uma vez mesmo após entregas parciais confirmadas sem ele e com
 * pedido desvinculado do recebimento que registrou a cobrança; revogação da aprovação e cancelamento do pedido
 * × recebimento em conferência/confirmação (interrompida ou concorrente).
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
const MATRIZ_CNPJ = "11222333000181";

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

const marker = (orderId: string) => store.get("operations", detId("po-charges", orderId));

async function lastDecision(requestId: string) {
  return (await requestDecisions(store, requestId)).filter((d) => !d.revokedAt).pop()!;
}

/** Contexto cuja PRÓXIMA transação é precedida por `before` (outra operação gravando entre a leitura e a gravação). */
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

/** Contexto cuja próxima transação falha (falha técnica). */
function failNextTx(ctx: Ctx): Ctx {
  let done = false;
  const base = ctx.store;
  const wrapped = Object.create(base) as Store;
  (wrapped as any).transaction = async (fn: any) => {
    if (!done) {
      done = true;
      throw new Error("Falha técnica simulada");
    }
    return base.transaction(fn);
  };
  return { ...ctx, store: wrapped };
}

/** Contexto em que a primeira gravação depois de o recebimento ficar "confirmando" falha (conclusão interrompida). */
function failAfterConfirming(ctx: Ctx, receiptId: string): Ctx {
  let armed = true;
  const base = ctx.store;
  const check = async () => {
    if (armed && (await base.get("receipts", receiptId))?.status === "confirming") {
      armed = false;
      throw new Error("Falha técnica simulada");
    }
  };
  const wrapped = Object.create(base) as Store;
  for (const m of ["create", "update", "increment", "delete", "transaction"] as const) {
    (wrapped as any)[m] = async (...args: any[]) => {
      await check();
      return (base as any)[m](...args);
    };
  }
  return { ...ctx, store: wrapped };
}

/** Recebimento sem XML do saldo do pedido, com todos os itens conferidos. */
async function checkedReceipt(orderId: string, idemKey: string) {
  const r = await createManualReceipt(stockist, { supplierId: papel, orderIds: [orderId], idemKey });
  await updateReceipt(stockist, r.id, { checkAll: true });
  return r;
}

/** Recebimento parado em "confirmando" (falha técnica depois da passagem, antes dos efeitos). */
async function interruptedReceipt(orderId: string, idemKey: string) {
  const r = await checkedReceipt(orderId, idemKey);
  await expect(confirmReceipt(failAfterConfirming(stockist, r.id), r.id)).rejects.toThrow(/Falha técnica simulada/);
  expect((await store.getOrThrow("receipts", r.id)).status).toBe("confirming");
  expect((await orderItems(store, orderId)).every((i) => (i.receivedQty ?? 0) === 0)).toBe(true);
  return r;
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
    name: "Teste rodada 3",
    rules: { tiers: [{ above: 0, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager.id] }] }], distinctApprovers: false },
    autoApproveBelow: 0,
    allowSelfApproval: false,
    expiredProposalAction: "warn",
    reviewOnRevision: "relevant",
  });
}, 120000);

describe("frete do pedido: cobrado por quem confirma, mesmo após entregas parciais", () => {
  it("cenário da revisão: entrega parcial confirmada antes de cancelar o recebimento que assumiu o frete — frete cobrado uma vez", async () => {
    // 10 × R$ 10,00 + frete R$ 50,00 = R$ 150,00
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    expect(o.total).toBe(15000);
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-partial-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-partial-2" });
    expect([r1.freight, r2.freight]).toEqual([5000, 0]);
    // R2 recebe 4 un. e confirma primeiro: o frete ainda não foi cobrado por nenhum recebimento confirmado → R2 o assume
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 4000, checked: true }] });
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/ainda não tinham sido cobrados/);
    await confirmReceipt(stockist, r2.id);
    expect((await payables(r2.id))[0].total).toBe(4000 + 5000);
    expect((await marker(o.id))?.result?.receiptId).toBe(r2.id);
    await cancelReceipt(stockist, r1.id, "Aberto em duplicidade");
    // o cancelamento de R1 (que nunca registrou a cobrança) não libera o marcador de R2
    expect((await marker(o.id))?.result?.receiptId).toBe(r2.id);
    const r3 = await checkedReceipt(o.id, "r3-partial-3");
    expect((await store.getOrThrow("receipts", r3.id)).freight).toBe(0);
    await confirmReceipt(stockist, r3.id);
    expect((await payables(r2.id))[0].total + (await payables(r3.id))[0].total).toBe(o.total);
  });

  it("entrega parcial confirmada SEM o frete (NF-e do pedido em conferência, depois cancelada): o recebimento seguinte o assume", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    await approve(o.id);
    const xml = buildSampleNfeXml({ number: 9301, issueDate: today(), emitter: { cnpj: refs.suppliers.papel.doc, name: "Distribuidora Papel & Cia Ltda" }, recipient: { cnpj: MATRIZ_CNPJ, name: "Intercert" }, items: [{ cProd: "CAN-50", cEAN: "7891000600020", xProd: "CANETA AZUL CX 50", qCom: 4000, vUnCom: 1000 }] });
    const x = await importNfeXml(stockist, { xml, orderIds: [o.id], allowHomologation: true });
    // com a NF-e do pedido em conferência (ela traz o próprio frete), o recebimento sem XML não cobra o frete do pedido
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-xml-2" });
    expect(r2.freight).toBe(0);
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 4000, checked: true }] });
    expect((await confirmReceipt(stockist, r2.id)).freight).toBe(0);
    expect((await store.getOrThrow("purchase_orders", o.id)).receivedValue).toBe(4000);
    // a NF-e era de outra entrega: cancelada. O frete continua sem cobrança e o próximo recebimento o assume,
    // apesar da entrega parcial já confirmada
    await cancelReceipt(stockist, x.id, "NF-e de outra entrega");
    const r3 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-xml-3" });
    expect(r3.freight).toBe(5000);
    await updateReceipt(stockist, r3.id, { checkAll: true });
    await confirmReceipt(stockist, r3.id);
    expect((await payables(r2.id))[0].total + (await payables(r3.id))[0].total).toBe(o.total);
    expect((await marker(o.id))?.result?.receiptId).toBe(r3.id);
  });

  it("conclusão interrompida antes de 'confirmando' não reserva o frete: vale quem confirmar primeiro", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-int-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-int-2" });
    await updateReceipt(stockist, r1.id, { items: [{ idx: 1, receivedQty: 6000, checked: true }] });
    await expect(confirmReceipt(failNextTx(stockist), r1.id)).rejects.toThrow(/Falha técnica simulada/);
    expect((await store.getOrThrow("receipts", r1.id)).status).toBe("draft");
    expect(await marker(o.id)).toBeNull();
    await updateReceipt(stockist, r2.id, { items: [{ idx: 1, receivedQty: 4000, checked: true }] });
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/ainda não tinham sido cobrados/);
    expect((await confirmReceipt(stockist, r2.id)).freight).toBe(5000);
    await expect(confirmReceipt(stockist, r1.id)).rejects.toThrow(/já foram cobrados no recebimento/);
    expect((await confirmReceipt(stockist, r1.id)).freight).toBe(0);
    expect((await payables(r1.id))[0].total + (await payables(r2.id))[0].total).toBe(o.total);
  });

  it("entrega integral confirmada antes do recebimento que assumiu o frete: o frete não se perde", async () => {
    const o = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 10000, unitCost: 1000 }], freight: 5000, paymentTermId: avista });
    await approve(o.id);
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [o.id], idemKey: "r3-full-1" });
    const r2 = await checkedReceipt(o.id, "r3-full-2");
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/ainda não tinham sido cobrados/);
    await confirmReceipt(stockist, r2.id);
    await cancelReceipt(stockist, r1.id, "Entrega feita em outro recebimento");
    expect((await payables(r2.id))[0].total).toBe(o.total);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("received");
  });
});

describe("frete do pedido: pedido desvinculado do recebimento que registrou a cobrança", () => {
  async function twoOrders(tag: string) {
    // A: R$ 10,00 + frete R$ 30,00; B: R$ 10,00 + frete R$ 20,00
    const a = await createOrder(admin, { supplierId: papel, items: [{ skuId: caneta, qty: 1000, unitCost: 1000 }], freight: 3000, paymentTermId: avista, idemKey: `${tag}-a` });
    const b = await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 1000, unitCost: 1000 }], freight: 2000, paymentTermId: avista, idemKey: `${tag}-b` });
    await approve(a.id);
    await approve(b.id);
    return { a, b };
  }

  it("desmarcar o pedido após a conclusão interrompida (charges_added) libera o frete para o próximo recebimento", async () => {
    const { a, b } = await twoOrders("r3-unlink");
    const r1 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [b.id], idemKey: "r3-unlink-1" });
    const r2 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [a.id, b.id], idemKey: "r3-unlink-2" });
    expect(r2.orderCharges.claimed).toEqual([a.id]);
    await cancelReceipt(stockist, r1.id, "Aberto por engano");
    await updateReceipt(stockist, r2.id, { checkAll: true });
    await expect(confirmReceipt(stockist, r2.id)).rejects.toThrow(/ainda não tinham sido cobrados/);
    expect((await store.getOrThrow("receipts", r2.id)).orderCharges.claimed).toEqual([a.id, b.id]);
    // o rascunho não reserva a cobrança: o marcador só é gravado na passagem para "confirmando"
    expect(await marker(b.id)).toBeNull();
    // estado deixado pela versão anterior (marcador gravado na conclusão interrompida): liberado ao desmarcar o pedido
    await store.create("operations", { companyId: admin.companyId, type: "purchase.order_charges", status: "done", entityType: "purchase_order", entityId: b.id, result: { receiptId: r2.id, receiptNumber: r2.number }, createdBy: admin.user.id }, detId("po-charges", b.id));
    // B não veio nesta entrega: desmarcado e item ignorado
    const bIdx = (await store.getOrThrow("receipts", r2.id)).items.find((it: any) => it.skuId === caderno).idx;
    const u = await updateReceipt(stockist, r2.id, { orderIds: [a.id], items: [{ idx: bIdx, ignore: true }] });
    expect(u.orderCharges.claimed).toEqual([a.id]);
    expect(await marker(b.id)).toBeNull();
    const c2 = await confirmReceipt(stockist, r2.id);
    expect([c2.freight, c2.dueTotal]).toEqual([3000, 4000]);
    // B chega depois: o recebimento assume o frete de B
    const r3 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [b.id], idemKey: "r3-unlink-3" });
    expect(r3.freight).toBe(2000);
    await updateReceipt(stockist, r3.id, { checkAll: true });
    await confirmReceipt(stockist, r3.id);
    expect((await payables(r3.id))[0].total).toBe(b.total);
    expect((await payables(r2.id))[0].total).toBe(a.total);
  });

  it("marcador de recebimento que não vincula mais o pedido (estado anterior) não bloqueia o frete", async () => {
    const { a, b } = await twoOrders("r3-orphan");
    const r2 = await checkedReceipt(a.id, "r3-orphan-2");
    await confirmReceipt(stockist, r2.id);
    // estado deixado pela versão anterior: marcador de B em nome de R2, que não vincula B
    await store.create("operations", { companyId: admin.companyId, type: "purchase.order_charges", status: "done", entityType: "purchase_order", entityId: b.id, result: { receiptId: r2.id, receiptNumber: r2.number }, createdBy: admin.user.id }, detId("po-charges", b.id));
    const r3 = await createManualReceipt(stockist, { supplierId: papel, orderIds: [b.id], idemKey: "r3-orphan-3" });
    expect(r3.freight).toBe(2000);
    await updateReceipt(stockist, r3.id, { checkAll: true });
    await confirmReceipt(stockist, r3.id);
    expect((await payables(r3.id))[0].total).toBe(b.total);
    expect((await marker(b.id))?.result?.receiptId).toBe(r3.id);
  });
});

describe("revogação da aprovação × recebimento", () => {
  const newOrder = async (tag: string) => approve((await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 10000, unitCost: 1000 }], paymentTermId: avista, idemKey: tag })).id);

  it("recebimento em conferência ou com a confirmação interrompida impede a revogação; retomada conclui o pedido recebido", async () => {
    const o = await newOrder("r3-rev-int");
    const dec = await lastDecision(o.requestId);
    const draft = await checkedReceipt(o.id, "r3-rev-int-draft");
    await expect(revokeDecision(manager, dec.id, "Rever preço")).rejects.toThrow(/em conferência/);
    await cancelReceipt(stockist, draft.id, "Refazer");
    const r = await interruptedReceipt(o.id, "r3-rev-int-1");
    await expect(revokeDecision(manager, dec.id, "Rever preço")).rejects.toThrow(/em confirmação/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("approved");
    // retomada
    await confirmReceipt(stockist, r.id);
    const after = await store.getOrThrow("purchase_orders", o.id);
    expect(after.status).toBe("received");
    expect((await store.getOrThrow("purchase_requests", o.requestId)).status).toBe("approved");
    expect((await payables(r.id))[0].total).toBe(o.total);
  });

  it("recebimento concluído entre a leitura e a gravação da revogação: a revogação falha (vaga da decisão ocupada)", async () => {
    const o = await newOrder("r3-rev-race-1");
    const dec = await lastDecision(o.requestId);
    let rid = "";
    const mgr = interceptTx(manager, async () => {
      const r = await checkedReceipt(o.id, "r3-rev-race-1");
      rid = r.id;
      await confirmReceipt(stockist, r.id);
    });
    await expect(revokeDecision(mgr, dec.id, "Rever preço")).rejects.toThrow(/enquanto você decidia/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("received");
    expect((await store.getOrThrow("purchase_requests", o.requestId)).status).toBe("approved");
    expect((await store.getOrThrow("approval_decisions", dec.id)).revokedAt ?? null).toBeNull();
    expect((await payables(rid))[0].total).toBe(o.total);
    // nova tentativa (página atualizada) é recusada pelo recebimento confirmado
    await expect(revokeDecision(manager, dec.id, "Rever preço")).rejects.toThrow(/não pode mais ser revogada/);
  });

  it("revogação gravada antes da passagem para 'confirmando': a conclusão relê o pedido e recusa sem lançar estoque/título", async () => {
    const o = await newOrder("r3-rev-race-2");
    const dec = await lastDecision(o.requestId);
    let reached!: () => void;
    const reachedP = new Promise<void>((res) => (reached = res));
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let rid = "";
    let confirmP: Promise<unknown> = Promise.resolve();
    // a revogação leu os recebimentos (nenhum) e, antes de gravar, o recebimento é aberto, conferido e concluído até a passagem
    const mgr = interceptTx(manager, async () => {
      const r = await checkedReceipt(o.id, "r3-rev-race-2");
      rid = r.id;
      const stk = interceptTx(stockist, async () => {
        reached();
        await gate;
      });
      confirmP = confirmReceipt(stk, r.id).then(
        () => null,
        (e) => e,
      );
      await reachedP;
    });
    await revokeDecision(mgr, dec.id, "Rever preço");
    release();
    const err = await confirmP;
    expect(String(err)).toMatch(/aguarde a nova aprovação/);
    expect((await store.getOrThrow("receipts", rid)).status).toBe("draft");
    expect(await receiptMovements(store, rid)).toHaveLength(0);
    expect(await payables(rid)).toHaveLength(0);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("in_review");
    // o pedido em análise não pode ser rejeitado com mercadoria recebida porque nada foi recebido
    expect((await orderItems(store, o.id)).every((i) => (i.receivedQty ?? 0) === 0)).toBe(true);
  });
});

describe("cancelamento do pedido × recebimento em confirmação", () => {
  const newOrder = async (tag: string) => approve((await createOrder(admin, { supplierId: papel, items: [{ skuId: caderno, qty: 10000, unitCost: 1000 }], paymentTermId: avista, idemKey: tag })).id);

  it("confirmação interrompida impede cancelar (e revisar) o pedido; a retomada conclui o recebimento", async () => {
    const o = await newOrder("r3-cancel-int");
    const r = await interruptedReceipt(o.id, "r3-cancel-int-1");
    await expect(cancelOrder(admin, o.id, "Fornecedor desistiu")).rejects.toThrow(/em confirmação/);
    const items = await orderItems(store, o.id);
    await expect(
      updateOrder(admin, o.id, { supplierId: papel, items: items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitCost: i.unitCost + 100 })), paymentTermId: avista, revisionReason: "Reajuste" }),
    ).rejects.toThrow(/em confirmação/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("approved");
    expect((await store.getOrThrow("purchase_requests", o.requestId)).status).toBe("approved");
    await confirmReceipt(stockist, r.id);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("received");
    expect(await receiptMovements(store, r.id)).toHaveLength(1);
  });

  it("recebimento concluído entre a leitura e a gravação do cancelamento: o cancelamento revalida e é recusado", async () => {
    const o = await newOrder("r3-cancel-race");
    let rid = "";
    const adm = interceptTx(admin, async () => {
      const r = await checkedReceipt(o.id, "r3-cancel-race-1");
      rid = r.id;
      await confirmReceipt(stockist, r.id);
    });
    await expect(cancelOrder(adm, o.id, "Fornecedor desistiu")).rejects.toThrow(/recebimento/);
    expect((await store.getOrThrow("purchase_orders", o.id)).status).toBe("received");
    expect((await store.getOrThrow("purchase_requests", o.requestId)).status).toBe("approved");
    expect((await payables(rid))[0].total).toBe(o.total);
  });
});
