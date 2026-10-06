import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { setSetting } from "@/lib/core/settings";
import "@/domain/jobs-registry";
import { runDueJobs } from "@/lib/core/jobs";
import { today } from "@/lib/dates";
import { addCashMovement, bindingRecount, closeSession, openSession, previewClose } from "@/domain/cash";
import { cancelSale, finalizeSale, openCancelPending } from "@/domain/sales";
import { cancelTitle, reverseSettlement, settleInstallment } from "@/domain/finance";
import { querySessions } from "@/app/(app)/caixa/queries";
import { querySales } from "@/app/(app)/vendas/queries";

/**
 * Rodada 3 (vendas e caixa): a recontagem cega não apaga diferença já revelada; valores de sessão em conferência cega
 * ocultos também no histórico de vendas filtrado pela sessão; pendência do cancelamento some quando o Financeiro resolve.
 */

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;

const sellCash = (idemKey: string, amount = 2990) =>
  finalizeSale(cashier, { idemKey, terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount }] });

describe("caixa — rodada 3 (recontagem cega)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    await setSetting(store, refs.company.id, null, "cash.blindClose", true);
  });

  it("falta revelada na contagem não é apagada pela recontagem após um suprimento de R$ 0,01", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    const p1 = await previewClose(cashier, s.id, { cash: 8000 });
    expect(p1.differences).toEqual({ cash: -2000 });
    await addCashMovement(cashier, { sessionId: s.id, type: "supply", amount: 1, reason: "troco", idemKey: "r3-sup" });
    // o operador já sabe o previsto (100,00 + 0,01) e informa 100,01 na recontagem
    const p2 = await previewClose(cashier, s.id, { cash: 10001 });
    expect(p2.recount).toBe(true);
    expect(p2.differences).toEqual({ cash: -2000 });
    expect(p2.counted).toEqual({ cash: 8001 }); // contagem efetiva = 80,00 + 0,01
    expect(p2.informed).toEqual({ cash: 10001 });
    expect(p2.kept).toEqual({ cash: { previousDifference: -2000, informed: 10001, informedDifference: 0 } });
    // fechamento com divergência: exige justificativa
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10001 } })).rejects.toThrow(/justificativa/);
    // recolhimento limitado ao dinheiro contado vinculante (80,01), não ao informado na recontagem
    await expect(closeSession(cashier, { sessionId: s.id, counted: {}, justification: "conferir", transferToAccountId: refs.accounts.banco.id, transferAmount: 10001 })).rejects.toThrow(/maior que o dinheiro contado/);
    const closed = await closeSession(cashier, { sessionId: s.id, counted: { cash: 10001 }, justification: "faltou troco" });
    expect(closed.differences).toEqual({ cash: -2000 });
    expect(closed.counted).toEqual({ cash: 8001 });
    const last = (closed.history as any[]).at(-1);
    expect(last.blindCount.superseded).toHaveLength(1);
    expect(last.blindCount.superseded[0].differences).toEqual({ cash: -2000 });
    expect(last.blindCount.kept.cash.informed).toBe(10001);
    const rows = await querySessions(cashier, { q: "", f: { divergencia: "1" } });
    const row = rows.find((r) => r.id === s.id)!;
    expect(row.hasDiff).toBe(true);
    expect(row.totalDiff).toBe(-2000);
  });

  it("recontagem pode revelar falta maior (no mesmo sentido), mas não reduzir nem inverter a já revelada", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    await previewClose(cashier, s.id, { cash: 8000 }); // −20,00
    await sellCash("r3-v1"); // previsto 129,90
    const p2 = await previewClose(cashier, s.id, { cash: 9990 }); // −30,00: falta maior, vale a nova contagem
    expect(p2.differences).toEqual({ cash: -3000 });
    expect(p2.counted).toEqual({ cash: 9990 });
    expect(p2.kept).toEqual({});
    await sellCash("r3-v2"); // previsto 159,80
    const p3 = await previewClose(cashier, s.id, { cash: 16980 }); // +10,00: inverteria — mantém −30,00
    expect(p3.differences).toEqual({ cash: -3000 });
    expect(p3.counted).toEqual({ cash: 12980 });
    const closed = await closeSession(cashier, { sessionId: s.id, counted: {}, justification: "conferido com o gerente" });
    expect(closed.differences).toEqual({ cash: -3000 });
  });

  it("sobra revelada também é mantida; recolhimento limitado ao menor entre contado vinculante e informado", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    expect((await previewClose(cashier, s.id, { cash: 12000 })).differences).toEqual({ cash: 2000 });
    await addCashMovement(cashier, { sessionId: s.id, type: "supply", amount: 1, reason: "troco", idemKey: "r3-sup2" });
    const p2 = await previewClose(cashier, s.id, { cash: 10001 });
    expect(p2.differences).toEqual({ cash: 2000 });
    expect(p2.counted).toEqual({ cash: 12001 });
    await expect(closeSession(cashier, { sessionId: s.id, counted: {}, justification: "sobra", transferToAccountId: refs.accounts.banco.id, transferAmount: 10002 })).rejects.toThrow(/maior que o dinheiro contado \(R\$\s*100,01\)/);
    const closed = await closeSession(cashier, { sessionId: s.id, counted: {}, justification: "sobra", transferToAccountId: refs.accounts.banco.id, transferAmount: 10001 });
    expect(closed.differences).toEqual({ cash: 2000 });
  });

  it("sem diferença na contagem anterior, vale a nova contagem (inclusive falta nova)", () => {
    const r = bindingRecount({ counted: { cash: 10000 }, expected: { cash: 10000 } }, { cash: 12000 }, { cash: 12990 });
    expect(r).toEqual({ counted: { cash: 12000 }, differences: { cash: -990 }, kept: {} });
    // contagem efetiva negativa (saída registrada depois de uma falta) não gera valor contado negativo; a diferença fica
    const neg = bindingRecount({ counted: { cash: 0 }, expected: { cash: 10000 } }, { cash: 0 }, { cash: 0 });
    expect(neg.counted).toEqual({ cash: 0 });
    expect(neg.differences).toEqual({ cash: -10000 });
  });

  it("histórico de vendas filtrado pela sessão em conferência cega oculta os valores (tela e CSV) até a contagem", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    await sellCash("r3-h1");
    const rows = await querySales(cashier, { q: "", f: { sessao: s.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountsHidden).toBe(true);
    expect(rows[0].total).toBeNull();
    expect(rows[0].net).toBeNull();
    // supervisor de caixa vê
    expect((await querySales(manager, { q: "", f: { sessao: s.id } }))[0].total).toBe(2990);
    // depois da contagem, o operador também vê
    await previewClose(cashier, s.id, { cash: 12990 });
    const after = await querySales(cashier, { q: "", f: { sessao: s.id } });
    expect(after[0].amountsHidden).toBe(false);
    expect(after[0].total).toBe(2990);
  });
});

describe("vendas — rodada 3 (pendência do cancelamento)", () => {
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
  });

  /** Queda do processo logo após o commit do cancelamento (escritas falham até `restore()`). */
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

  it("aviso 'Pendente no Financeiro' reflete a situação atual do título (some quando o título é cancelado)", async () => {
    const sale = await finalizeSale(cashier, { idemKey: "r3-cp", terminalId, customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 4490 }] });
    await runDueJobs(store, { limit: 50 });
    restore = crashAfterCommit(async () => (await store.get("sales", sale.id))?.status === "cancelled");
    await cancelSale(manager, sale.id, "desistiu").catch(() => null);
    restore();
    restore = null;
    const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", sale.id]] }))[0];
    const [inst] = await listAll(store, "installments", { filters: [["eq", "titleId", title.id]] });
    const st = await settleInstallment(manager, { installmentId: inst.id, date: today(), principal: 4490, accountId: refs.accounts.banco.id, idemKey: "r3-cp-pay" });
    await runDueJobs(store, { limit: 50 });
    let cur = await store.getOrThrow("sales", sale.id);
    expect(cur.cancelPending).toHaveLength(1);
    expect(await openCancelPending(store, cur)).toEqual([expect.objectContaining({ titleId: title.id, message: expect.stringMatching(/1 baixa\(s\) ativa\(s\)/) })]);
    // Financeiro estorna a baixa: continua pendente (falta cancelar o título), com o motivo atualizado
    await reverseSettlement(manager, st.id, "devolvido ao cliente");
    expect(await openCancelPending(store, cur)).toEqual([expect.objectContaining({ titleId: title.id, message: expect.stringMatching(/falta cancelar o título/) })]);
    // e cancela o título: a pendência deixa de existir (aviso e mensagem da ação)
    await cancelTitle(manager, title.id, "venda cancelada");
    cur = await store.getOrThrow("sales", sale.id);
    expect(await openCancelPending(store, cur)).toEqual([]);
  });
});
