import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import { runDueJobs } from "@/lib/core/jobs";
import { setSetting } from "@/lib/core/settings";
import { today } from "@/lib/dates";
import { closeSession, openSession, sessionSummary } from "@/domain/cash";
import { finalizeSale, prepareSale, cancelSale, processReturn, returnableItems, confirmCardReversal, type FinalizeSaleInput } from "@/domain/sales";
import { createPixIntent, simulateIntent, cancelIntent, checkIntent } from "@/domain/payments/intents";
import { simulatedPix } from "@/domain/payments/providers";
import { createCart, saveCart, cancelCart } from "@/domain/carts";
import { settleInstallment } from "@/domain/finance";
import { availableMap } from "@/domain/stock";

/**
 * Regressões da revisão adversarial (vendas e caixa): devolução de venda a prazo, Pix de uso único,
 * efeitos pós-commit repetíveis, limite de 100 operações, limite de crédito concorrente, filial/gaveta.
 */

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;

const avail = async (skuKey: string) => (await availableMap(store, refs.branches.matriz.id, [refs.skus[skuKey].id])).get(refs.skus[skuKey].id)?.available ?? 0;
const balanceOf = async (accountKey: string) => (await store.getOrThrow("financial_accounts", refs.accounts[accountKey].id)).balance;
const sale = (input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }, ctx = cashier) => finalizeSale(ctx, { terminalId, ...input });

/**
 * Simula a queda do processo logo após o commit de uma operação: a partir do momento em que `committed()` passa a
 * ser verdadeiro (checado ao fim de cada transação), toda escrita falha até `restore()`.
 */
function crashAfterCommit(committed: () => Promise<boolean>) {
  const s = store as any;
  const proto = Object.getPrototypeOf(store);
  let armed = true;
  let crashing = false;
  const boom = () => {
    throw new Error("queda simulada do processo");
  };
  s.transaction = async (fn: any) => {
    if (crashing) boom();
    const r = await proto.transaction.call(store, fn);
    if (armed && (await committed())) {
      armed = false;
      crashing = true;
    }
    return r;
  };
  for (const m of ["create", "update", "increment", "delete"]) {
    s[m] = async (...a: any[]) => {
      if (crashing) boom();
      return proto[m].apply(store, a);
    };
  }
  return () => {
    for (const m of ["transaction", "create", "update", "increment", "delete"]) delete s[m];
  };
}

describe("vendas — correções da revisão", () => {
  let restore: (() => void) | null = null;
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });
  afterEach(() => {
    restore?.();
    restore = null;
    vi.restoreAllMocks();
  });

  it("devolução de venda no crediário sem pagamento abate o título (sem dinheiro nem vale)", async () => {
    const s = await sale({ idemKey: "cred-ret-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 2990 }] });
    const [line] = await returnableItems(store, s.id);
    const caixaBefore = await balanceOf("caixa-matriz");
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "cr1", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.itemsTotal).toBe(2990);
    expect(r.abatedAmount).toBe(2990);
    expect(r.compensatedAmount).toBe(0);
    expect(await balanceOf("caixa-matriz")).toBe(caixaBefore);
    expect(await listAll(store, "cash_movements", { filters: [["eq", "returnId", r.id]] })).toHaveLength(0);
    const sum = await sessionSummary(cashier, s.cashSessionId);
    expect(sum.totals.refunds).toBe(0);
    const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", s.id]] }))[0];
    expect(title.balance).toBe(0);
    expect(title.status).toBe("cancelled");
    // vale-crédito também não é emitido sobre valor não pago
    const s2 = await sale({ idemKey: "cred-ret-2", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 2990 }] });
    const [l2] = await returnableItems(store, s2.id);
    const r2 = await processReturn(cashier, { saleId: s2.id, idemKey: "cr2", reason: "defeito", compensation: "store_credit", items: [{ saleItemId: l2.id, qty: 1000, condition: "resellable" }] });
    expect(r2.creditVoucherId).toBeNull();
    expect(await listAll(store, "credit_vouchers", { filters: [["eq", "returnId", r2.id]] })).toHaveLength(0);
  });

  it("venda mista (dinheiro + crediário): devolução abate o título primeiro e só reembolsa o que foi pago", async () => {
    const s = await sale({ idemKey: "mix-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 1000 }, { methodId: refs.methods.crediario.id, amount: 1990 }] });
    const [line] = await returnableItems(store, s.id);
    const caixaBefore = await balanceOf("caixa-matriz");
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "mix-r", reason: "desistiu", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.abatedAmount).toBe(1990);
    expect(r.compensatedAmount).toBe(1000);
    expect(await balanceOf("caixa-matriz")).toBe(caixaBefore - 1000);
    const mov = await listAll(store, "cash_movements", { filters: [["eq", "returnId", r.id]] });
    expect(mov.map((m) => m.amount)).toEqual([-1000]);
    const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", s.id]] }))[0];
    expect(title.balance).toBe(0);
  });

  it("crediário parcialmente pago: abate o saldo em aberto e reembolsa apenas o valor já recebido", async () => {
    const s = await sale({ idemKey: "part-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 4490, paymentTermId: refs.terms["30-60"].id }] });
    const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", s.id]] }))[0];
    const insts = await listAll(store, "installments", { filters: [["eq", "titleId", title.id]], orderBy: [{ field: "number" }] });
    await settleInstallment(manager, { installmentId: insts[0].id, date: today(), principal: insts[0].amount, accountId: refs.accounts.banco.id, idemKey: "pay-part-1" });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "part-r", reason: "defeito", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.abatedAmount).toBe(insts[1].amount);
    expect(r.compensatedAmount).toBe(insts[0].amount);
    const v = await store.getOrThrow("credit_vouchers", r.creditVoucherId);
    expect(v.balance).toBe(insts[0].amount);
    const t2 = await store.getOrThrow("titles", title.id);
    expect(t2.balance).toBe(0);
    expect(t2.status).toBe("paid"); // houve recebimento real: o título fica liquidado (parcela 2 abatida)
    const abate = await listAll(store, "settlements", { filters: [["eq", "titleId", title.id], ["eq", "kind", "abatement"]] });
    expect(abate.map((x) => [x.installmentId, x.principal, x.total])).toEqual([[insts[1].id, insts[1].amount, 0]]);
  });

  it("Pix: a mesma cobrança confirmada paga uma única venda, mesmo com finalizações simultâneas", async () => {
    const i = await createPixIntent(cashier, { cartId: "cart-pix-a", amount: 4490, description: "x" });
    await simulateIntent(cashier, i.id, "confirmed");
    const pixBefore = await balanceOf("pix");
    const items = [{ skuId: refs.skus["bone-u"].id, qty: 1000 }];
    // cobrança de outro atendimento é recusada
    await expect(sale({ idemKey: "pix-other", cartId: "cart-pix-b", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i.id }] })).rejects.toThrow(/outro atendimento/);
    const res = await Promise.allSettled([
      sale({ idemKey: "pix-race-1", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i.id }] }),
      sale({ idemKey: "pix-race-2", items, payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i.id }] }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/outra venda/);
    const uses = await listAll(store, "sale_payments", { filters: [["eq", "intentId", i.id]] });
    expect(uses).toHaveLength(1);
    expect(await balanceOf("pix")).toBe(pixBefore + 4490);
  });

  it("queda após o commit da venda: repetir conclui estoque, NFC-e e conversão do atendimento", async () => {
    const cart = await createCart(cashier, terminalId);
    await saveCart(cashier, cart.id, { items: [{ skuId: refs.skus["bone-u"].id, qty: 1000, listPrice: 4490 }] });
    const before = await avail("bone-u");
    const input: FinalizeSaleInput = { idemKey: `cart:${cart.id}`, cartId: cart.id, terminalId, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490 }] };
    const saleId = detId("sale", input.idemKey);
    restore = crashAfterCommit(async () => Boolean(await store.get("sales", saleId)));
    // a queda pode ou não chegar ao chamador (a auditoria engole a falha): o estado gravado é o que importa
    await finalizeSale(cashier, input).catch(() => null);
    restore();
    restore = null;
    // gravado junto com a venda: atendimento convertido e tarefa durável de efeitos
    expect((await store.getOrThrow("carts", cart.id)).status).toBe("converted");
    expect(await store.get("jobs", detId("job", `sale-effects:${saleId}`))).toBeTruthy();
    expect((await store.getOrThrow("sales", saleId)).effectsStatus).toBe("pending");
    const again = await finalizeSale(cashier, input);
    expect(again.id).toBe(saleId);
    expect(again.effectsStatus).toBe("done");
    expect(await avail("bone-u")).toBe(before - 1000);
    expect(again.fiscalDocumentId).toBeTruthy();
  });

  it("queda após o commit do cancelamento: repetir devolve o estoque e cancela o título", async () => {
    const s = await sale({ idemKey: "cc-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 4490 }] });
    const before = await avail("bone-u");
    restore = crashAfterCommit(async () => (await store.get("sales", s.id))?.status === "cancelled");
    await cancelSale(manager, s.id, "desistiu").catch(() => null);
    restore();
    restore = null;
    expect((await store.getOrThrow("sales", s.id)).cancelEffectsStatus).toBe("pending");
    expect(await avail("bone-u")).toBe(before);
    const again = await cancelSale(manager, s.id, "desistiu");
    expect(again.cancelEffectsStatus).toBe("done");
    expect(await avail("bone-u")).toBe(before + 1000);
    const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", s.id]] }))[0];
    expect(title.status).toBe("cancelled");
  });

  it("queda após o commit da devolução: repetir (ou a tarefa durável) devolve os itens ao estoque", async () => {
    const s = await sale({ idemKey: "rc-1", items: [{ skuId: refs.skus["caneca-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 6980 }] });
    const [line] = await returnableItems(store, s.id);
    const before = await avail("caneca-u");
    const input = { saleId: s.id, idemKey: "rc-r", reason: "sobrou", compensation: "refund" as const, refundMethod: "cash" as const, items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" as const }] };
    restore = crashAfterCommit(async () => Boolean(await store.get("returns", detId("return", "rc-r"))));
    await processReturn(cashier, input).catch(() => null);
    restore();
    restore = null;
    expect(await avail("caneca-u")).toBe(before);
    // nova tentativa já não permite devolver de novo a mesma unidade (saldo devolvível vem do documento gravado)
    expect((await returnableItems(store, s.id))[0].returnable).toBe(1000);
    await runDueJobs(store, { limit: 50 });
    const ret = await store.getOrThrow("returns", detId("return", "rc-r"));
    expect(ret.effectsStatus).toBe("done");
    expect(await avail("caneca-u")).toBe(before + 1000);
    expect(await listAll(store, "return_items", { filters: [["eq", "returnId", ret.id]] })).toHaveLength(1);
    expect((await store.getOrThrow("sale_items", line.id)).returnedQty).toBe(1000);
    const again = await processReturn(cashier, input);
    expect(again.id).toBe(ret.id);
    expect(await avail("caneca-u")).toBe(before + 1000);
  });

  it("venda, devolução e cancelamento com muitos itens cabem no limite de 100 operações por transação", async () => {
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "sales.allowNegativeStock", true);
    const keys = ["meia-u", "bone-u", "caneca-u", "caderno-u"];
    const items = Array.from({ length: 120 }, (_, k) => ({ skuId: refs.skus[keys[k % keys.length]].id, qty: 1000 }));
    const prep = await prepareSale(cashier, { idemKey: "x", terminalId, items, payments: [] });
    const before = await avail("meia-u");
    const s = await sale({ idemKey: "big-1", items, payments: [{ methodId: refs.methods.dinheiro.id, amount: prep.calc.total }] });
    expect(s.effectsStatus).toBe("done");
    expect(await listAll(store, "sale_items", { filters: [["eq", "saleId", s.id]] })).toHaveLength(120);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", s.id], ["eq", "type", "sale"]] })).toHaveLength(120);
    expect(await avail("meia-u")).toBe(before - 30000);
    const lines = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "big-r", reason: "devolução total", compensation: "refund", refundMethod: "cash", items: lines.map((l) => ({ saleItemId: l.id, qty: l.qty, condition: "resellable" as const })) });
    expect(r.itemsTotal).toBe(prep.calc.total);
    expect(r.effectsStatus).toBe("done");
    expect(await listAll(store, "return_items", { filters: [["eq", "returnId", r.id]] })).toHaveLength(120);
    expect((await returnableItems(store, s.id)).every((l) => l.returnable === 0)).toBe(true);
    expect(await avail("meia-u")).toBe(before);
    const s2 = await sale({ idemKey: "big-2", items, payments: [{ methodId: refs.methods.dinheiro.id, amount: prep.calc.total }] });
    const c = await cancelSale(manager, s2.id, "cancelamento total");
    expect(c.cancelEffectsStatus).toBe("done");
    expect(await avail("meia-u")).toBe(before);
  });

  it("limite de crédito respeitado em vendas simultâneas no crediário", async () => {
    await store.update("customers", refs.customers.joao.id, { creditLimit: 5000 });
    const mk = (k: string) => sale({ idemKey: k, customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 2990 }] });
    const res = await Promise.allSettled([mk("lim-1"), mk("lim-2")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/Limite de crédito/);
    const open = await listAll(store, "installments", { filters: [["eq", "partyId", refs.customers.joao.id], ["eq", "status", ["open", "partial"]]] });
    expect(open.reduce((a, i) => a + i.balance, 0)).toBe(2990);
  });

  it("cancelamento só na filial da venda e saída de dinheiro somente na gaveta do próprio operador", async () => {
    const s = await sale({ idemKey: "br-1", items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490 }] });
    const otherBranch = await refs.ctxFor("manager", "shopping");
    await expect(cancelSale(otherBranch, s.id, "x")).rejects.toThrow(/filial da venda/);
    // operador com permissão de cancelar, sem supervisão de caixa e sem caixa próprio: não usa a gaveta alheia
    const op = await refs.ctxFor("manager", "matriz");
    op.user = { ...op.user, id: refs.users.stockist.id, name: "Operador sem caixa", actions: ["sale.cancel"], isAdmin: false };
    await expect(cancelSale(op, s.id, "desistiu", { terminalId })).rejects.toThrow(/abra o caixa/i);
    expect((await store.getOrThrow("sales", s.id)).status).toBe("completed");
    // supervisor (permissão "Reabrir caixa") pode registrar na gaveta do terminal da venda
    const c = await cancelSale(manager, s.id, "desistiu");
    expect(c.status).toBe("cancelled");
    const refund = await listAll(store, "cash_movements", { filters: [["eq", "saleId", s.id], ["eq", "type", "refund"]] });
    expect(refund).toHaveLength(1);
  });

  it("Pix: cancelamento confirmado no provedor; cobrança paga não é cancelada; estorno da venda pelo provedor", async () => {
    const cart = await createCart(cashier, terminalId);
    const i1 = await createPixIntent(cashier, { cartId: cart.id, amount: 4490, description: "x" });
    const c1 = await cancelIntent(cashier, i1.id);
    expect(c1.status).toBe("cancelled");
    expect(c1.cancelConfirmedAt).toBeTruthy();
    expect((await simulatedPix().findByReference(i1.reference))!.status).toBe("cancelled");
    // paga no provedor antes do cancelamento do atendimento: o atendimento não é cancelado
    const i2 = await createPixIntent(cashier, { cartId: cart.id, amount: 4490, description: "x" });
    simulatedPix().setStatus(i2.reference, "confirmed");
    await expect(cancelCart(cashier, cart.id, "desistiu")).rejects.toThrow(/Pix confirmado/);
    expect((await store.getOrThrow("payment_intents", i2.id)).status).toBe("confirmed");
    // cancelamento "local" antigo, ainda válido, volta a ser consultado
    const i3 = await createPixIntent(cashier, { cartId: "cart-legacy", amount: 1000, description: "x" });
    await store.update("payment_intents", i3.id, { status: "cancelled" });
    simulatedPix().setStatus(i3.reference, "confirmed");
    expect((await checkIntent(cashier, i3.id)).status).toBe("confirmed");
    // venda paga com o Pix integrado: cancelamento pede o estorno ao provedor; sem confirmação fica pendente
    const s = await sale({ idemKey: `cart:${cart.id}`, cartId: cart.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.pix.id, amount: 4490, intentId: i2.id }] });
    const pixBefore = await balanceOf("pix");
    const spy = vi.spyOn(simulatedPix(), "refund").mockRejectedValueOnce(new Error("provedor indisponível"));
    const c = await cancelSale(manager, s.id, "desistiu");
    expect(spy).toHaveBeenCalled();
    expect(c.status).toBe("cancelled");
    expect(c.paymentStatus).toBe("refund_pending");
    expect(c.cancelEffectsStatus).toBe("pending");
    const p1 = (await listAll(store, "sale_payments", { filters: [["eq", "saleId", s.id]] }))[0];
    expect(p1.status).toBe("refund_pending");
    expect(await balanceOf("pix")).toBe(pixBefore); // nada estornado sem confirmação
    const again = await cancelSale(manager, s.id, "desistiu");
    expect(again.paymentStatus).toBe("refunded");
    expect(again.cancelEffectsStatus).toBe("done");
    expect((await listAll(store, "sale_payments", { filters: [["eq", "saleId", s.id]] }))[0].status).toBe("refunded");
    expect((await store.getOrThrow("payment_intents", i2.id)).status).toBe("refunded");
    expect(await balanceOf("pix")).toBe(pixBefore - 4490);
  });

  it("estorno em cartão: devolução sai de 'em processamento' com a confirmação da adquirente", async () => {
    const s = await sale({ idemKey: "card-r-1", items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.debito.id, amount: 4490, nsu: "1" }] });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "card-r", reason: "defeito", compensation: "refund", refundMethod: "card_reversal", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.status).toBe("processing");
    expect(await listAll(store, "titles", { filters: [["eq", "originType", "return"], ["eq", "originId", r.id]] })).toHaveLength(1);
    await expect(confirmCardReversal(cashier, r.id, { reference: "" })).rejects.toThrow(/NSU/);
    const done = await confirmCardReversal(cashier, r.id, { reference: "EST-998877" });
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBeTruthy();
    expect(done.confirmationRef).toBe("EST-998877");
  });

  it("consulta da situação fiscal pela venda usa a tarefa durável (perfil sem permissão fiscal consegue consultar)", async () => {
    const { refreshSaleFiscal } = await import("@/domain/sales");
    const s = await sale({ idemKey: "fq-1", items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490 }] });
    await runDueJobs(store, { limit: 50 });
    const docId = (await store.getOrThrow("sales", s.id)).fiscalDocumentId;
    expect((await store.getOrThrow("fiscal_documents", docId)).status).toBe("authorized");
    await store.update("fiscal_documents", docId, { status: "processing" });
    const fin = await refs.ctxFor("finance", "matriz");
    const r = await refreshSaleFiscal(fin, s.id);
    expect(r.document?.status).toBe("authorized");
    const jobs = await listAll(store, "jobs", { filters: [["eq", "dedupeKey", `fiscal-query:${docId}:consulta-venda`]] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("done");
    // nova consulta reaproveita a mesma tarefa (chave determinística)
    await store.update("fiscal_documents", docId, { status: "processing" });
    await refreshSaleFiscal(fin, s.id);
    expect(await listAll(store, "jobs", { filters: [["eq", "dedupeKey", `fiscal-query:${docId}:consulta-venda`]] })).toHaveLength(1);
  });

  it("devolução em dinheiro de venda a prazo integralmente abatida não exige caixa aberto", async () => {
    const s = await sale({ idemKey: "nc-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 2990 }] });
    const sm = await sessionSummary(cashier, s.cashSessionId);
    await closeSession(cashier, { sessionId: s.cashSessionId, counted: { cash: sm.expected.cash, crediario: 2990 } });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "nc-r", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.compensatedAmount).toBe(0);
    expect(r.cashSessionId).toBeNull();
  });
});
