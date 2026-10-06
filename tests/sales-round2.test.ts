import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import { runDueJobs } from "@/lib/core/jobs";
import { today, addDays } from "@/lib/dates";
import { openSession } from "@/domain/cash";
import { finalizeSale, cancelSale, processReturn, returnableItems, type FinalizeSaleInput } from "@/domain/sales";
import { createCart, cancelCart } from "@/domain/carts";
import { renegotiate, settleInstallment } from "@/domain/finance";
import { availableMap } from "@/domain/stock";
import { pixProviderFrom } from "@/domain/payments/providers";

/**
 * Rodada 2 (vendas e caixa): devolução a prazo com desconto concedido na baixa, cancelamento com baixa registrada
 * entre o commit e os efeitos, renegociação do título da venda, situação de pagamento após devolução, troca sem
 * vale, cobrança Pix vencida sem provedor e URL fixa do Mercado Pago (credencial nunca vai a host do banco).
 */

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;

const avail = async (skuKey: string) => (await availableMap(store, refs.branches.matriz.id, [refs.skus[skuKey].id])).get(refs.skus[skuKey].id)?.available ?? 0;
const sale = (input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }, ctx = cashier) => finalizeSale(ctx, { terminalId, ...input });
const saleTitle = async (saleId: string) => (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", saleId]] }))[0];
const instsOf = (titleId: string) => listAll(store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number" }] });

/** Queda do processo logo após o commit (escritas falham até `restore()`). */
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

describe("vendas — rodada 2", () => {
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

  it("devolução a prazo: desconto concedido na baixa não é reembolsado (só o valor efetivamente pago)", async () => {
    const s = await sale({ idemKey: "disc-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 5980 }] });
    const title = await saleTitle(s.id);
    const [inst] = await instsOf(title.id);
    // cliente quitou a parcela de 59,80 pagando 50,00 (desconto de 9,80 concedido no recebimento)
    await settleInstallment(manager, { installmentId: inst.id, date: today(), principal: 5980, discount: 980, accountId: refs.accounts.banco.id, idemKey: "disc-pay" });
    const [line] = await returnableItems(store, s.id);
    const r1 = await processReturn(cashier, { saleId: s.id, idemKey: "disc-r1", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r1.abatedAmount).toBe(0);
    expect(r1.compensatedAmount).toBe(2990);
    const r2 = await processReturn(cashier, { saleId: s.id, idemKey: "disc-r2", reason: "defeito", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    // pago de fato: 50,00 → já devolvidos 29,90; restam 20,10 (os 9,80 de desconto não voltam ao cliente)
    expect(r2.compensatedAmount).toBe(2010);
    expect((await store.getOrThrow("credit_vouchers", r2.creditVoucherId)).balance).toBe(2010);
    const refunded = (await listAll(store, "returns", { filters: [["eq", "saleId", s.id]] })).reduce((a, r) => a + r.compensatedAmount, 0);
    expect(refunded).toBe(5000);
  });

  it("cancelamento: baixa registrada entre o commit e os efeitos não trava estoque nem fiscal; título fica como pendência do Financeiro", async () => {
    const s = await sale({ idemKey: "cx-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 4490 }] });
    await runDueJobs(store, { limit: 50 });
    const before = await avail("bone-u");
    restore = crashAfterCommit(async () => (await store.get("sales", s.id))?.status === "cancelled");
    await cancelSale(manager, s.id, "desistiu").catch(() => null);
    restore();
    restore = null;
    expect((await store.getOrThrow("sales", s.id)).cancelEffectsStatus).toBe("pending");
    // o Financeiro recebe a parcela antes da conclusão dos efeitos
    const title = await saleTitle(s.id);
    const [inst] = await instsOf(title.id);
    await settleInstallment(manager, { installmentId: inst.id, date: today(), principal: 4490, accountId: refs.accounts.banco.id, idemKey: "cx-pay" });
    await runDueJobs(store, { limit: 50 });
    const after = await store.getOrThrow("sales", s.id);
    expect(after.cancelEffectsStatus).toBe("done");
    expect(await avail("bone-u")).toBe(before + 1000);
    const doc = await store.getOrThrow("fiscal_documents", after.fiscalDocumentId);
    expect(["cancelled", "discarded"].includes(doc.status) || Boolean(doc.cancelRequestedAt)).toBe(true);
    // título com recebimento mantido (não cancelado), registrado como pendência e notificado ao Financeiro
    expect((await store.getOrThrow("titles", title.id)).status).not.toBe("cancelled");
    expect(after.cancelPending).toEqual([expect.objectContaining({ titleId: title.id, number: title.number })]);
    const notes = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `sale-cancel-titles:${s.id}`]] });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.link === `/financeiro/receber/${title.id}`)).toBe(true);
    // nada fica para repetir: a tarefa durável terminou
    const job = await store.getOrThrow("jobs", detId("job", `sale-cancel-effects:${s.id}`));
    expect(job.status).toBe("done");
    const again = await cancelSale(manager, s.id, "desistiu");
    expect(again.cancelEffectsStatus).toBe("done");
    expect(await avail("bone-u")).toBe(before + 1000);
  });

  it("cancelamento de venda com título renegociado: recusa se a renegociação tem baixa; sem baixa, cancela a renegociação e o título", async () => {
    const mk = async (k: string) => {
      const s = await sale({ idemKey: k, customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 4490, paymentTermId: refs.terms["30-60"].id }] });
      const title = await saleTitle(s.id);
      const insts = await instsOf(title.id);
      const nt = await renegotiate(manager, { titleId: title.id, installmentIds: insts.map((i) => i.id), charges: 0, discount: 0, installments: [{ dueDate: addDays(today(), 90), amount: 4490 }], reason: "cliente pediu prazo", idemKey: `reneg-${k}` });
      return { s, title, nt };
    };
    // renegociação com recebimento: recusa apontando o título da renegociação
    const a = await mk("rn-1");
    const [ni] = await instsOf(a.nt.id);
    await settleInstallment(manager, { installmentId: ni.id, date: today(), principal: 1000, accountId: refs.accounts.banco.id, idemKey: "rn-pay" });
    await expect(cancelSale(manager, a.s.id, "desistiu")).rejects.toThrow(new RegExp(`título nº ${a.nt.number} \\(renegociação do título nº ${a.title.number}`));
    expect((await store.getOrThrow("sales", a.s.id)).status).toBe("completed");
    // renegociação sem recebimento: o cancelamento da venda cancela a renegociação e o título de origem
    const b = await mk("rn-2");
    const c = await cancelSale(manager, b.s.id, "desistiu");
    expect(c.cancelEffectsStatus).toBe("done");
    expect(c.cancelPending ?? null).toBeNull();
    expect((await store.getOrThrow("titles", b.nt.id)).status).toBe("cancelled");
    expect((await store.getOrThrow("titles", b.title.id)).status).toBe("cancelled");
    const open = await listAll(store, "installments", { filters: [["eq", "titleId", [b.nt.id, b.title.id]], ["eq", "status", ["open", "partial"]]] });
    expect(open).toHaveLength(0);
  });

  it("cancelamento: renegociação com recebimento criada depois do commit não trava os efeitos (renegociação e origem viram pendência)", async () => {
    const s = await sale({ idemKey: "cr-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 4490 }] });
    const before = await avail("bone-u");
    restore = crashAfterCommit(async () => (await store.get("sales", s.id))?.status === "cancelled");
    await cancelSale(manager, s.id, "desistiu").catch(() => null);
    restore();
    restore = null;
    const title = await saleTitle(s.id);
    const insts = await instsOf(title.id);
    const nt = await renegotiate(manager, { titleId: title.id, installmentIds: insts.map((i) => i.id), charges: 0, discount: 0, installments: [{ dueDate: addDays(today(), 60), amount: 4490 }], reason: "prazo", idemKey: "cr-reneg" });
    const [ni] = await instsOf(nt.id);
    await settleInstallment(manager, { installmentId: ni.id, date: today(), principal: 1000, accountId: refs.accounts.banco.id, idemKey: "cr-pay" });
    await runDueJobs(store, { limit: 50 });
    const after = await store.getOrThrow("sales", s.id);
    expect(after.cancelEffectsStatus).toBe("done");
    expect(await avail("bone-u")).toBe(before + 1000);
    expect((after.cancelPending as any[]).map((p) => p.titleId).sort()).toEqual([title.id, nt.id].sort());
    expect((await store.getOrThrow("titles", nt.id)).status).not.toBe("cancelled");
    expect((await store.getOrThrow("titles", title.id)).status).not.toBe("cancelled");
    expect((await store.getOrThrow("jobs", detId("job", `sale-cancel-effects:${s.id}`))).status).toBe("done");
  });

  it("devolução que zera título com renegociação vigente: o título não é cancelado e os efeitos concluem", async () => {
    const s = await sale({ idemKey: "rr-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 5980, paymentTermId: refs.terms["30-60"].id }] });
    const title = await saleTitle(s.id);
    const insts = await instsOf(title.id);
    // só a 2ª parcela é renegociada; a devolução de 1 unidade abate a 1ª e zera o título de origem
    const nt = await renegotiate(manager, { titleId: title.id, installmentIds: [insts[1].id], charges: 0, discount: 0, installments: [{ dueDate: addDays(today(), 90), amount: insts[1].amount }], reason: "prazo", idemKey: "rr-reneg" });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "rr-r", reason: "defeito", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.abatedAmount).toBe(insts[0].amount);
    expect(r.effectsStatus).toBe("done");
    const t = await store.getOrThrow("titles", title.id);
    expect(t.balance).toBe(0);
    expect(t.status).not.toBe("cancelled");
    expect((await store.getOrThrow("titles", nt.id)).status).toBe("open");
    // a dívida renegociada continua: a venda segue "a receber"
    expect((await store.getOrThrow("sales", s.id)).paymentStatus).toBe("pending");
  });

  it("devolução que zera o título a prazo tira a venda de 'a receber'; devolução parcial mantém", async () => {
    const s = await sale({ idemKey: "ps-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 5980 }] });
    expect(s.paymentStatus).toBe("pending");
    const [line] = await returnableItems(store, s.id);
    await processReturn(cashier, { saleId: s.id, idemKey: "ps-r1", reason: "defeito", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect((await store.getOrThrow("sales", s.id)).paymentStatus).toBe("pending");
    await processReturn(cashier, { saleId: s.id, idemKey: "ps-r2", reason: "defeito", compensation: "store_credit", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect((await saleTitle(s.id)).status).toBe("cancelled");
    expect((await store.getOrThrow("sales", s.id)).paymentStatus).toBe("paid");
  });

  it("troca de venda a prazo não paga: sem vale; a nova venda da troca é paga integralmente", async () => {
    const s = await sale({ idemKey: "tx-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 2990 }] });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "tx-r", reason: "tamanho", compensation: "exchange", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r.kind).toBe("exchange");
    expect(r.creditVoucherId).toBeNull();
    expect(r.compensatedAmount).toBe(0);
    const ns = await sale({ idemKey: "tx-2", customerId: refs.customers.joao.id, exchangeReturnId: r.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490 }] });
    const linked = await store.getOrThrow("returns", r.id);
    expect(linked.exchangeSaleId).toBe(ns.id);
    expect(linked.difference).toBe(4490);
  });

  it("atendimento com Pix vencido cancela mesmo sem provedor configurado; cobrança ainda válida continua bloqueando", async () => {
    const integ = detId("integration", `${refs.company.id}|*|pix`);
    await store.update("integrations", integ, { enabled: false });
    const mkIntent = async (cartId: string, ref: string, expiresAt: string) =>
      store.create("payment_intents", { companyId: refs.company.id, branchId: refs.branches.matriz.id, createdBy: cashier.user.id, provider: "mercadopago", kind: "pix", amount: 1000, status: "pending", reference: ref, cartId, attempts: 1, isSimulated: false, expiresAt }, detId("intent", ref));
    const cart = await createCart(cashier, terminalId);
    const expired = await mkIntent(cart.id, "pix-exp-1", new Date(Date.now() - 3600_000).toISOString());
    const c = await cancelCart(cashier, cart.id, "cliente desistiu");
    expect(c.status).toBe("cancelled");
    const after = await store.getOrThrow("payment_intents", expired.id);
    expect(after.status).toBe("expired");
    expect(after.errorMessage).toMatch(/sem confirmação do provedor/);
    expect(await listAll(store, "audit_logs", { filters: [["eq", "entityId", expired.id], ["eq", "action", "pix.expire_local"]] })).toHaveLength(1);
    // dentro da validade: sem provedor não há como garantir que não será paga
    const cart2 = await createCart(cashier, terminalId);
    expect(cart2.id).not.toBe(cart.id);
    await mkIntent(cart2.id, "pix-val-1", new Date(Date.now() + 3600_000).toISOString());
    await expect(cancelCart(cashier, cart2.id, "x")).rejects.toThrow(/pode continuar pagável/);
  });
});

describe("Pix Mercado Pago — endereço da API fixo (credencial nunca vai a host vindo do banco)", () => {
  const ENV = "MERCADOPAGO_ACCESS_TOKEN_TESTE_R2";
  afterEach(() => {
    delete process.env[ENV];
    delete process.env.MERCADOPAGO_BASE_URL;
    vi.restoreAllMocks();
  });

  it("config.baseUrl da integração é ignorado; só a variável de ambiente do servidor troca o endereço", async () => {
    process.env[ENV] = "token-secreto";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("[]", { status: 200 }));
    const p = pixProviderFrom({ provider: "mercadopago", secretRefs: { accessToken: ENV }, config: { baseUrl: "https://atacante.example.com" } });
    expect(p).toBeTruthy();
    const r = await p!.test();
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://api.mercadopago.com/v1/payment_methods");
    expect(String(url)).not.toContain("atacante");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-secreto");
    // override somente pelo ambiente do servidor
    process.env.MERCADOPAGO_BASE_URL = "https://sandbox.interno.test/";
    await pixProviderFrom({ provider: "mercadopago", secretRefs: { accessToken: ENV }, config: { baseUrl: "https://atacante.example.com" } })!.test();
    expect(String(fetchSpy.mock.calls[1][0])).toBe("https://sandbox.interno.test/v1/payment_methods");
    // referência de credencial com nome inválido não é lida do ambiente
    expect(pixProviderFrom({ provider: "mercadopago", secretRefs: { accessToken: "path" } })).toBeNull();
  });
});
