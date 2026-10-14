import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { setSetting } from "@/lib/core/settings";
import { openSession } from "@/domain/cash";
import { finalizeSale } from "@/domain/sales";

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let otherCashier: Ctx;
let manager: Ctx;
let terminalId: string;

async function sell(ctx: Ctx, idemKey: string) {
  return finalizeSale(ctx, { terminalId, idemKey, items: [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4990, received: 5000 }] });
}

const mismatchAudits = async () => (await listAll(store, "audit_logs", { filters: [["eq", "action", "sale.operator_mismatch"]] }));
const mismatchNotifications = async () => (await listAll(store, "notifications", {})).filter((n) => String(n.occurrenceKey ?? "").startsWith("cash-operator:"));

describe("venda em caixa aberto por outro operador (cash.operatorMismatch)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    // segundo operador com o mesmo perfil de caixa (sem "reabrir caixa")
    otherCashier = { ...cashier, user: { ...cashier.user, id: "outro-operador", name: "Otávio Operador" } };
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("o próprio operador vende sem aviso", async () => {
    await sell(cashier, "op-1");
    expect(await mismatchAudits()).toHaveLength(0);
    expect(await mismatchNotifications()).toHaveLength(0);
  });

  it("padrão (avisar): a venda conclui, fica no histórico e avisa quem pode reabrir caixas — um aviso por operador e sessão", async () => {
    await sell(otherCashier, "op-2");
    const afterFirst = await mismatchNotifications();
    await sell(otherCashier, "op-3");
    expect(await mismatchAudits()).toHaveLength(2);
    // um aviso por destinatário (perfis com "reabrir caixa"); a segunda venda não gera aviso novo
    expect(afterFirst.length).toBeGreaterThan(0);
    expect(new Set(afterFirst.map((n) => n.occurrenceKey)).size).toBe(1);
    expect(await mismatchNotifications()).toHaveLength(afterFirst.length);
  });

  it("bloquear: o vendedor precisa abrir o próprio caixa", async () => {
    await setSetting(store, refs.company.id, null, "cash.operatorMismatch", "block");
    await expect(sell(otherCashier, "op-4")).rejects.toMatchObject({ code: "cash_operator_mismatch" });
    expect(await mismatchAudits()).toHaveLength(0);
  });

  it("supervisor (reabrir caixa) continua liberado mesmo com bloqueio", async () => {
    await setSetting(store, refs.company.id, null, "cash.operatorMismatch", "block");
    await sell(manager, "op-5");
    expect(await mismatchAudits()).toHaveLength(0);
  });

  it("permitir sem aviso: nada é registrado", async () => {
    await setSetting(store, refs.company.id, null, "cash.operatorMismatch", "allow");
    await sell(otherCashier, "op-6");
    expect(await mismatchAudits()).toHaveLength(0);
    expect(await mismatchNotifications()).toHaveLength(0);
  });
});
