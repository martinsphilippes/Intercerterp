import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { openSession, currentSession, addCashMovement, sessionSummary, closeSession, reopenSession } from "@/domain/cash";
import { finalizeSale, processReturn, returnableItems } from "@/domain/sales";

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;
const balanceOf = async (k: string) => (await store.getOrThrow("financial_accounts", refs.accounts[k].id)).balance;

describe("caixa", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
  });

  it("abertura única por terminal: o mesmo operador retoma, outro operador é bloqueado", async () => {
    const s1 = await openSession(cashier, { terminalId, openingFund: 20000, peripheralsCheck: { printer: "browser" } });
    const again = await openSession(cashier, { terminalId, openingFund: 5000 });
    expect(again.id).toBe(s1.id);
    await expect(openSession(manager, { terminalId, openingFund: 0 })).rejects.toThrow(/Já existe caixa aberto/);
    const opening = await listAll(store, "cash_movements", { filters: [["eq", "sessionId", s1.id], ["eq", "type", "opening"]] });
    expect(opening).toHaveLength(1);
    expect(opening[0].amount).toBe(20000);
    // fundo de troco não é receita: nenhum lançamento financeiro na abertura
    expect(await listAll(store, "account_entries", { filters: [["eq", "originId", s1.id]] })).toHaveLength(0);
    // outro terminal abre independente
    const s2 = await openSession(manager, { terminalId: refs.terminals.cx2.id, openingFund: 0 });
    expect(s2.id).not.toBe(s1.id);
  });

  it("sangria/suprimento e fechamento com divergência preservada (sem ajuste automático)", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 20000 });
    const sup = await addCashMovement(cashier, { sessionId: s.id, type: "supply", amount: 5000, reason: "Reforço de troco", recipient: "Gerente", idemKey: "sup-1" });
    const supAgain = await addCashMovement(cashier, { sessionId: s.id, type: "supply", amount: 5000, reason: "Reforço de troco", idemKey: "sup-1" });
    expect(supAgain.id).toBe(sup.id);
    // venda em dinheiro com troco: entra só o valor aplicado
    const sale = await finalizeSale(cashier, { idemKey: "c-1", terminalId, items: [{ skuId: refs.skus["bone-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 8980, received: 10000 }] });
    await finalizeSale(cashier, { idemKey: "c-2", terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.debito.id, amount: 2990, nsu: "77" }] });
    // devolução em espécie de 1 boné
    const [line] = await returnableItems(store, sale.id);
    await processReturn(cashier, { saleId: sale.id, idemKey: "c-r", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "damaged" }] });
    // sangria maior que o disponível é bloqueada
    await expect(addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 1_000_000, reason: "x", idemKey: "w-x" })).rejects.toThrow(/maior que o dinheiro/);
    // sangria para o banco = transferência entre contas (não é despesa nem reduz faturamento)
    const caixaBefore = await balanceOf("caixa-matriz");
    const bancoBefore = await balanceOf("banco");
    const w = await addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 10000, reason: "Depósito bancário", recipient: "Malote", accountId: refs.accounts.banco.id, idemKey: "w-1" });
    expect(w.amount).toBe(-10000);
    expect(w.transferId).toBeTruthy();
    expect(await balanceOf("caixa-matriz")).toBe(caixaBefore - 10000);
    expect(await balanceOf("banco")).toBe(bancoBefore + 10000);
    const sum = await sessionSummary(cashier, s.id);
    // fundo + recebimentos em espécie + suprimentos − sangrias − devoluções em espécie
    const expectedCash = 20000 + 8980 + 5000 - 10000 - 4490;
    expect(sum.expected.cash).toBe(expectedCash);
    expect(sum.totals.sales).toBe(8980 + 2990); // faturamento não muda com sangria/suprimento
    expect(sum.byMethod.debit.expected).toBe(2990);
    // fechamento com divergência exige justificativa e a preserva
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: expectedCash - 500, debit: 2990 } })).rejects.toThrow(/justificativa/);
    const closed = await closeSession(cashier, { sessionId: s.id, counted: { cash: expectedCash - 500, debit: 2990 }, justification: "Faltou R$ 5,00 na contagem", checklist: { cashCounted: true }, idemKey: "close-1" });
    expect(closed.status).toBe("closed");
    expect(closed.differences).toEqual({ cash: -500 });
    expect(closed.expected.cash).toBe(expectedCash);
    // repetir o mesmo fechamento não falha nem altera
    const again = await closeSession(cashier, { sessionId: s.id, counted: { cash: 1 }, idemKey: "close-1" });
    expect(again.differences).toEqual({ cash: -500 });
    // nenhum movimento de ajuste foi criado para esconder a diferença
    expect(await listAll(store, "cash_movements", { filters: [["eq", "sessionId", s.id], ["eq", "type", "closing_adjust"]] })).toHaveLength(0);
    expect(await currentSession(cashier, terminalId)).toBeNull();
    // venda com caixa fechado é bloqueada
    await expect(finalizeSale(cashier, { idemKey: "c-3", terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 2990 }] })).rejects.toThrow(/Abra o caixa/);
  });

  it("reabertura exige permissão, gera evento e nova versão preservando o fechamento anterior", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    await closeSession(cashier, { sessionId: s.id, counted: { cash: 9000 }, justification: "faltou 10" });
    await expect(reopenSession(cashier, s.id, "conferir")).rejects.toThrow(/permissão/);
    await expect(reopenSession(manager, s.id, "")).rejects.toThrow(/motivo/);
    const r = await reopenSession(manager, s.id, "Nota de 10 encontrada no chão do caixa");
    expect(r.status).toBe("reopened");
    expect(r.version).toBe(2);
    // a sessão reaberta volta a ser a sessão corrente do terminal e aceita movimentos
    expect((await currentSession(cashier, terminalId))!.id).toBe(s.id);
    await addCashMovement(cashier, { sessionId: s.id, type: "supply", amount: 1000, reason: "Nota localizada", idemKey: "re-sup" });
    const closed2 = await closeSession(cashier, { sessionId: s.id, counted: { cash: 11000 } });
    expect(closed2.differences).toEqual({});
    const events = (closed2.history as any[]).map((h) => `${h.event}${h.version ? ":" + h.version : ""}`);
    expect(events).toEqual(["opened", "closed:1", "reopened", "closed:2"]);
    const v1 = (closed2.history as any[]).find((h) => h.event === "closed" && h.version === 1);
    expect(v1.differences).toEqual({ cash: -1000 });
    expect(v1.justification).toBe("faltou 10");
    const audits = await listAll(store, "audit_logs", { filters: [["eq", "entityId", s.id], ["eq", "action", "session.reopen"]] });
    expect(audits).toHaveLength(1);
    // reabrir com outra sessão aberta no terminal é bloqueado
    const other = await openSession(cashier, { terminalId, openingFund: 0 });
    await expect(reopenSession(manager, s.id, "x")).rejects.toThrow(/outra sessão/);
    expect(other.status).toBe("open");
  });

  it("sangria acima da política exige autorização de outro usuário (gerente); conferências finais obrigatórias", async () => {
    const { setSetting } = await import("@/lib/core/settings");
    await setSetting(store, refs.company.id, null, "cash.withdrawalApprovalAbove", 5000);
    const s = await openSession(cashier, { terminalId, openingFund: 20000 });
    await finalizeSale(cashier, { idemKey: "p-1", terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.pix.id, amount: 2990, reference: "E2E-1" }] });
    await addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 5000, reason: "cofre", idemKey: "w-ok" });
    await expect(addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 6000, reason: "cofre", idemKey: "w-big" })).rejects.toThrow(/autorização adicional/);
    await expect(addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 6000, reason: "cofre", idemKey: "w-big", approval: { login: "caixa", password: "Intercert@2026" } })).rejects.toThrow(/permissão|outro usuário/);
    const ok = await addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 6000, reason: "cofre", idemKey: "w-big", responsibleId: refs.users.finance.id, approval: { login: "gerente", password: "Intercert@2026" } });
    expect(ok.approvedBy).toBe(refs.users.manager.id);
    expect(ok.recipient).toBe(refs.users.finance.name);
    const { requiredChecklist } = await import("@/domain/cash");
    const sum = await sessionSummary(cashier, s.id);
    expect(requiredChecklist(sum).map((c) => c.key)).toEqual(["cashCounted", "pixReconciled", "cashDelivered"]);
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: sum.expected.cash, pix: 2990 }, enforceChecklist: true, checklist: { cashCounted: true } })).rejects.toThrow(/Conferências finais pendentes/);
    const closed = await closeSession(cashier, { sessionId: s.id, counted: { cash: sum.expected.cash, pix: 2990 }, enforceChecklist: true, checklist: { cashCounted: true, pixReconciled: true, cashDelivered: true } });
    expect(closed.differences).toEqual({});
    // sem o parâmetro de conferência cega, o fechamento não é registrado como cego (o formulário não decide isso)
    expect((closed.history as any[]).at(-1).blind).toBe(false);
  });
});

describe("caixa — correções da revisão", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
  });

  it("recolhimento do fechamento só para conta ativa da própria empresa, validado antes de fechar", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    const foreign = await store.create("financial_accounts", { companyId: "OTHERCO", name: "Conta de outra empresa", kind: "bank", balance: 0, seq: 0, active: true });
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, transferToAccountId: foreign.id, transferAmount: 5000 })).rejects.toThrow(/Conta de destino/);
    expect((await store.getOrThrow("financial_accounts", foreign.id)).balance).toBe(0);
    expect(await listAll(store, "fin_transfers")).toHaveLength(0);
    expect((await store.getOrThrow("cash_sessions", s.id)).status).toBe("open");
    await store.update("financial_accounts", refs.accounts.banco.id, { active: false });
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, transferToAccountId: refs.accounts.banco.id, transferAmount: 5000 })).rejects.toThrow(/Conta de destino/);
    await store.update("financial_accounts", refs.accounts.banco.id, { active: true });
    // recolhimento maior que o contado: recusado sem fechar a sessão
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, transferToAccountId: refs.accounts.banco.id, transferAmount: 20000, idemKey: "cl-1" })).rejects.toThrow(/maior que o dinheiro contado/);
    expect((await store.getOrThrow("cash_sessions", s.id)).status).toBe("open");
  });

  it("fechamento interrompido antes do recolhimento: repetir conclui a transferência uma única vez", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    const caixaBefore = await balanceOf("caixa-matriz");
    const bancoBefore = await balanceOf("banco");
    // a primeira transação depois de fechar (a transferência) falha
    const proto = Object.getPrototypeOf(store);
    let fail = true;
    (store as any).transaction = async (fn: any) => {
      if (fail) {
        fail = false;
        throw new Error("tempo esgotado");
      }
      return proto.transaction.call(store, fn);
    };
    try {
      await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, transferToAccountId: refs.accounts.banco.id, transferAmount: 8000, idemKey: "cl-2" })).rejects.toThrow(/tempo esgotado/);
    } finally {
      delete (store as any).transaction;
    }
    const closed = await store.getOrThrow("cash_sessions", s.id);
    expect(closed.status).toBe("closed");
    expect(await listAll(store, "fin_transfers")).toHaveLength(0);
    const { pendingCloseTransfer } = await import("@/domain/cash");
    expect((await pendingCloseTransfer(cashier, closed))?.amount).toBe(8000);
    await closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, transferToAccountId: refs.accounts.banco.id, transferAmount: 8000, idemKey: "cl-2" });
    await closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, transferToAccountId: refs.accounts.banco.id, transferAmount: 8000, idemKey: "cl-2" });
    expect(await listAll(store, "fin_transfers")).toHaveLength(1);
    expect(await balanceOf("caixa-matriz")).toBe(caixaBefore - 8000);
    expect(await balanceOf("banco")).toBe(bancoBefore + 8000);
    expect(await pendingCloseTransfer(cashier, await store.getOrThrow("cash_sessions", s.id))).toBeNull();
  });

  it("operações de caixa somente na filial ativa e na gaveta do próprio operador (ou supervisor)", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    const consolidated = await refs.ctxFor("manager", null);
    await expect(closeSession(consolidated, { sessionId: s.id, counted: { cash: 10000 } })).rejects.toThrow(/filial/);
    const otherBranch = await refs.ctxFor("manager", "shopping");
    await expect(addCashMovement(otherBranch, { sessionId: s.id, type: "supply", amount: 1000, reason: "x", idemKey: "ob-1" })).rejects.toThrow(/outra filial/);
    await expect(closeSession(otherBranch, { sessionId: s.id, counted: { cash: 10000 } })).rejects.toThrow(/outra filial/);
    // outro operador sem supervisão não movimenta a gaveta alheia
    const other = { ...cashier, user: { ...cashier.user, id: refs.users.stockist.id, name: "Outro operador" } };
    await expect(addCashMovement(other, { sessionId: s.id, type: "withdrawal", amount: 1000, reason: "x", idemKey: "oo-1" })).rejects.toThrow(/operador desta sessão/);
    await expect(closeSession(other, { sessionId: s.id, counted: { cash: 10000 } })).rejects.toThrow(/operador desta sessão/);
    // supervisor (Reabrir caixa) pode
    const sup = await addCashMovement(manager, { sessionId: s.id, type: "supply", amount: 1000, reason: "troco", idemKey: "sup-ok" });
    expect(sup.amount).toBe(1000);
    const closed = await closeSession(cashier, { sessionId: s.id, counted: { cash: 11000 } });
    await expect(reopenSession(otherBranch, closed.id, "conferir")).rejects.toThrow(/outra filial/);
  });

  it("conferência cega imposta pelo servidor: contagem registrada antes de revelar o previsto", async () => {
    const { setSetting } = await import("@/lib/core/settings");
    const { previewClose, expectedVisible } = await import("@/domain/cash");
    await setSetting(store, refs.company.id, null, "cash.blindClose", true);
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    expect(await expectedVisible(cashier, await store.getOrThrow("cash_sessions", s.id))).toBe(false);
    // sem apurar (contagem registrada), não fecha
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, justification: "x" })).rejects.toThrow(/Apurar diferenças/);
    const p1 = await previewClose(cashier, s.id, { cash: 0 });
    expect(p1.expected.cash).toBe(10000);
    expect(p1.differences).toEqual({ cash: -10000 });
    // depois de ver o previsto, recontar não altera a contagem registrada
    const p2 = await previewClose(cashier, s.id, { cash: 10000 });
    expect(p2.counted).toEqual({ cash: 0 });
    expect(await expectedVisible(cashier, await store.getOrThrow("cash_sessions", s.id))).toBe(true);
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 } })).rejects.toThrow(/justificativa/);
    const closed = await closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 }, justification: "conferido" });
    expect(closed.counted).toEqual({ cash: 0 });
    expect(closed.differences).toEqual({ cash: -10000 });
    const last = (closed.history as any[]).at(-1);
    expect(last.blind).toBe(true);
    expect(last.blindCount.counted).toEqual({ cash: 0 });
    // reabertura: nova versão exige nova contagem cega
    await reopenSession(manager, s.id, "recontagem");
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 10000 } })).rejects.toThrow(/Apurar diferenças/);
  });

  it("sangrias simultâneas não deixam o dinheiro esperado negativo", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    const res = await Promise.allSettled([
      addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 8000, reason: "cofre", idemKey: "wc-1" }),
      addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 8000, reason: "cofre", idemKey: "wc-2" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/maior que o dinheiro disponível/);
    expect((await sessionSummary(cashier, s.id)).expected.cash).toBe(2000);
    // repetição da mesma sangria (mesma chave) devolve o mesmo movimento
    const again = await addCashMovement(cashier, { sessionId: s.id, type: "withdrawal", amount: 8000, reason: "cofre", idemKey: (res[0].status === "fulfilled" ? "wc-1" : "wc-2") });
    expect(again.amount).toBe(-8000);
    expect((await sessionSummary(cashier, s.id)).expected.cash).toBe(2000);
  });
});
