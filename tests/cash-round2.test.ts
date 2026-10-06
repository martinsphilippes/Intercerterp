import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { setSetting } from "@/lib/core/settings";
import { addCashMovement, closeSession, expectedVisible, openSession, previewClose } from "@/domain/cash";
import { finalizeSale } from "@/domain/sales";
import { queryCashMovements, querySessions } from "@/app/(app)/caixa/queries";

/** Rodada 2 (caixa): contagem cega invalidada por movimento posterior e valores dedutíveis ocultos até a contagem. */

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let terminalId: string;

describe("caixa — rodada 2 (conferência cega)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    await setSetting(store, refs.company.id, null, "cash.blindClose", true);
  });

  it("venda ou movimento depois da contagem cega exige nova contagem (sem divergência falsa); a anterior fica preservada", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    const p1 = await previewClose(cashier, s.id, { cash: 10000 });
    expect(p1.differences).toEqual({});
    expect(await expectedVisible(cashier, await store.getOrThrow("cash_sessions", s.id))).toBe(true);
    // venda em dinheiro depois da contagem
    await finalizeSale(cashier, { idemKey: "bc-1", terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 2990 }] });
    // a contagem deixou de valer: previsto volta a ficar oculto e o fechamento exige recontagem
    expect(await expectedVisible(cashier, await store.getOrThrow("cash_sessions", s.id))).toBe(false);
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 12990 } })).rejects.toThrow(/conte novamente/);
    const p2 = await previewClose(cashier, s.id, { cash: 12990 });
    expect(p2.recount).toBe(true);
    expect(p2.counted).toEqual({ cash: 12990 });
    expect(p2.differences).toEqual({});
    // sem nova movimentação, a contagem fica travada (não é possível recontar depois de ver o previsto)
    const p3 = await previewClose(cashier, s.id, { cash: 1 });
    expect(p3.counted).toEqual({ cash: 12990 });
    // suprimento posterior também invalida
    await addCashMovement(cashier, { sessionId: s.id, type: "supply", amount: 500, reason: "troco", idemKey: "bc-sup" });
    await expect(closeSession(cashier, { sessionId: s.id, counted: { cash: 13490 } })).rejects.toThrow(/conte novamente/);
    await previewClose(cashier, s.id, { cash: 13490 });
    const closed = await closeSession(cashier, { sessionId: s.id, counted: { cash: 0 } });
    expect(closed.counted).toEqual({ cash: 13490 });
    expect(closed.differences).toEqual({});
    const last = (closed.history as any[]).at(-1);
    expect(last.blindCount.superseded.map((x: any) => x.counted.cash)).toEqual([10000, 12990]);
  });

  it("antes da contagem, recebimentos de venda em dinheiro e total vendido ficam ocultos (tela e CSV) para quem não é supervisor", async () => {
    const s = await openSession(cashier, { terminalId, openingFund: 10000 });
    await finalizeSale(cashier, { idemKey: "hd-1", terminalId, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 2990 }] });
    const salesRows = (ctx: Ctx) => queryCashMovements(ctx, { q: "", f: { sessao: s.id, tipo: "vendas" } });
    expect(await salesRows(cashier)).toHaveLength(0);
    expect((await querySessions(cashier, { q: "", f: {} })).find((r) => r.id === s.id)!.salesTotal).toBeNull();
    // supervisor de caixa vê
    expect(await salesRows(manager)).toHaveLength(1);
    expect((await querySessions(manager, { q: "", f: {} })).find((r) => r.id === s.id)!.salesTotal).toBe(2990);
    // depois da contagem, o operador também vê
    await previewClose(cashier, s.id, { cash: 12990 });
    expect(await salesRows(cashier)).toHaveLength(1);
    expect((await querySessions(cashier, { q: "", f: {} })).find((r) => r.id === s.id)!.salesTotal).toBe(2990);
  });
});
