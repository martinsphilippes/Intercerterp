import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import { BusinessError } from "@/lib/core/errors";
import { nowIso } from "@/lib/dates";
import { adjustStock, balanceId } from "@/domain/stock";
import { cancelTransfer, createTransfer, separateTransfer, shipTransfer, transferItemsFromMovements } from "@/domain/transfers";

async function setup() {
  const store = freshStore();
  const refs = await seedBase(store);
  return { store, refs };
}

const bal = async (store: any, wh: string, sku: string) => (await store.get("stock_balances", balanceId(wh, sku))) ?? { physical: 0, reserved: 0, inTransit: 0 };

/** Falha simulada de gravação na primeira escrita que casar com o critério. */
function failOnce(store: any, method: "create" | "update", match: (collection: string, data: any) => boolean) {
  const orig = store[method].bind(store);
  let armed = true;
  store[method] = async (collection: string, a: any, b?: any) => {
    const data = method === "create" ? a : b;
    if (armed && match(collection, data)) {
      armed = false;
      throw new BusinessError("Falha simulada de gravação.");
    }
    return orig(collection, a, b);
  };
  return () => {
    delete store[method];
  };
}

describe("reserva × saída manual simultâneas", () => {
  it("reserva que leu o saldo antes de uma saída manual é refeita sobre o físico atual (não passa do físico)", async () => {
    const { store, refs } = await setup();
    const stockist = await refs.ctxFor("stockist", "matriz");
    const B = refs.skus["caneca-u"]; // 20 un
    const wO = refs.warehouses["matriz-main"].id;
    const bid = balanceId(wO, B.id);
    const t = await createTransfer(stockist, { toBranchId: refs.branches.shopping.id, items: [{ skuId: B.id, qty: 18000 }] });
    // a separação lê o saldo (20 físico, 0 reservado); antes do commit da reserva, a saída manual de 5 é gravada
    const origGet = store.get.bind(store);
    let armed = true;
    (store as any).get = async (c: string, id: string) => {
      const r = await origGet(c, id);
      if (armed && c === "stock_balances" && id === bid) {
        armed = false;
        await adjustStock(stockist, { warehouseId: wO, skuId: B.id, type: "manual_out", qty: 5000, reason: "Consumo interno", idemKey: "race-out" });
      }
      return r;
    };
    await expect(separateTransfer(stockist, t.id)).rejects.toThrow(/insuficiente/);
    delete (store as any).get;
    const b = await bal(store, wO, B.id);
    expect(b.physical).toBe(15000);
    expect(b.reserved).toBe(0);
    expect(b.physical - b.reserved).toBeGreaterThanOrEqual(0);
    expect((await store.get("transfers", t.id))!.status).toBe("draft");
    // com quantidade possível, a nova separação reserva normalmente
    const t2 = await createTransfer(stockist, { toBranchId: refs.branches.shopping.id, items: [{ skuId: B.id, qty: 15000 }] });
    expect((await separateTransfer(stockist, t2.id)).status).toBe("separated");
    expect((await bal(store, wO, B.id)).reserved).toBe(15000);
  });

  it("saída manual que leu o reservado antes de uma separação é recusada no commit (não consome o reservado)", async () => {
    const { store, refs } = await setup();
    const stockist = await refs.ctxFor("stockist", "matriz");
    const B = refs.skus["caneca-u"]; // 20 un
    const wO = refs.warehouses["matriz-main"].id;
    const bid = balanceId(wO, B.id);
    const stale = await store.get("stock_balances", bid); // 20 físico, 0 reservado
    const t = await createTransfer(stockist, { toBranchId: refs.branches.shopping.id, items: [{ skuId: B.id, qty: 18000 }] });
    await separateTransfer(stockist, t.id); // reserva 18 gravada
    // a saída manual enxerga o saldo de antes da reserva (leitura obsoleta, como numa requisição simultânea)
    const origGet = store.get.bind(store);
    let staleReads = 2; // garantia do saldo + leitura dentro da transação
    (store as any).get = async (c: string, id: string) => {
      if (staleReads > 0 && c === "stock_balances" && id === bid) {
        staleReads--;
        return { ...stale };
      }
      return origGet(c, id);
    };
    await expect(adjustStock(stockist, { warehouseId: wO, skuId: B.id, type: "manual_out", qty: 5000, reason: "Consumo interno", idemKey: "race-out-2" })).rejects.toThrow(/disponível/);
    delete (store as any).get;
    const b = await bal(store, wO, B.id);
    expect(b.physical).toBe(20000);
    expect(b.reserved).toBe(18000);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "skuId", B.id], ["eq", "type", "manual_out"]] })).toHaveLength(0);
    // a reserva continua expedível
    expect((await shipTransfer(stockist, t.id)).status).toBe("in_transit");
  });
});

describe("expedir × cancelar simultâneos", () => {
  it("cancelamento que leu antes da expedição conclui a devolução: nada fica em trânsito e o reservado não é baixado duas vezes", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const wD = refs.warehouses["shopping-main"].id;
    const o0 = await bal(store, wO, A.id);
    const d0 = await bal(store, wD, A.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }] });
    await separateTransfer(matriz, t.id);
    // o cancelamento lê movimentos (nada expedido) e reservas ativas; nesse intervalo a expedição inteira acontece
    const origList = store.list.bind(store);
    let armed = true;
    let shipped: any = null;
    (store as any).list = async (c: string, opts: any) => {
      const r = await origList(c, opts);
      if (armed && c === "stock_reservations" && JSON.stringify(opts?.filters ?? []).includes(t.id)) {
        armed = false;
        shipped = await shipTransfer(matriz, t.id);
      }
      return r;
    };
    const c = await cancelTransfer(matriz, t.id, "Desistência");
    delete (store as any).list;
    expect(shipped?.status).toBe("in_transit"); // a expedição terminou antes de o cancelamento gravar
    expect(c.status).toBe("cancelled");
    const o = await bal(store, wO, A.id);
    expect(o.physical).toBe(o0.physical);
    expect(o.reserved).toBe(0); // não −2000
    expect((await bal(store, wD, A.id)).inTransit ?? 0).toBe(d0.inTransit ?? 0);
    const tr = (await store.get("transfers", t.id))!;
    expect(tr.status).toBe("cancelled");
    expect(tr.items[0].shippedQty).toBe(2000);
    expect(tr.items[0].returnedQty).toBe(2000);
    expect(tr.returnedAt).toBeTruthy();
    expect(tr.divergences.filter((d: any) => d.kind === "returned")).toEqual([expect.objectContaining({ skuId: A.id, qty: 2000 })]);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_return"]] })).toHaveLength(1);
    // repetição: nada a fazer
    const again = await cancelTransfer(matriz, t.id, "Desistência");
    expect(again.updatedAt).toBe(tr.updatedAt);
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/cancelada/);
  });

  it("expedição nunca grava \"em trânsito\" sobre um cancelamento gravado no meio dela", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const B = refs.skus["caneca-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const wD = refs.warehouses["shopping-main"].id;
    const oA0 = await bal(store, wO, A.id);
    const oB0 = await bal(store, wO, B.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }, { skuId: B.id, qty: 3000 }] });
    await separateTransfer(matriz, t.id);
    // o cancelamento é gravado entre a última conferência da expedição e a gravação de "em trânsito"
    const origUpdate = store.update.bind(store);
    let armed = true;
    (store as any).update = async (c: string, id: string, patch: any) => {
      if (armed && c === "transfers" && id === t.id && patch.status === "in_transit") {
        armed = false;
        await cancelTransfer(matriz, t.id, "Cliente desistiu");
      }
      return origUpdate(c, id, patch);
    };
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/cancelada durante a expedição: 2 item\(ns\) que já tinham saído voltaram à origem/);
    delete (store as any).update;
    const tr = (await store.get("transfers", t.id))!;
    expect(tr.status).toBe("cancelled");
    expect(tr.cancelReason).toBe("Cliente desistiu");
    expect(tr.items.map((i: any) => i.returnedQty)).toEqual([2000, 3000]);
    expect((await bal(store, wO, A.id)).physical).toBe(oA0.physical);
    expect((await bal(store, wO, B.id)).physical).toBe(oB0.physical);
    expect((await bal(store, wO, A.id)).reserved).toBe(0);
    expect((await bal(store, wD, A.id)).inTransit ?? 0).toBe(0);
    expect((await bal(store, wD, B.id)).inTransit ?? 0).toBe(0);
    expect(tr.divergences.filter((d: any) => d.kind === "returned")).toHaveLength(2);
  });

  it("cancelar de novo uma transferência cancelada com pendente em trânsito devolve à origem", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const wD = refs.warehouses["shopping-main"].id;
    const o0 = await bal(store, wO, A.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 4000 }] });
    await shipTransfer(matriz, t.id);
    // estado deixado pela corrida antes da correção: cancelada com mercadoria em trânsito
    await store.update("transfers", t.id, { status: "cancelled", cancelledAt: nowIso(), cancelReason: "Corrida" });
    const c = await cancelTransfer(matriz, t.id, "Concluir");
    expect(c.status).toBe("cancelled");
    expect(c.cancelReason).toBe("Corrida");
    expect(c.items[0].returnedQty).toBe(4000);
    expect((await bal(store, wO, A.id)).physical).toBe(o0.physical);
    expect((await bal(store, wD, A.id)).inTransit ?? 0).toBe(0);
    const items = await transferItemsFromMovements(matriz, c);
    expect(items[0].shippedQty - items[0].returnedQty).toBe(0);
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/cancelada não pode ser expedida/);
  });
});

describe("cancelamento interrompido", () => {
  it("repetir o cancelamento após falha no registro final regrava itens, divergências e data de devolução", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const B = refs.skus["caneca-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const oA0 = await bal(store, wO, A.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }, { skuId: B.id, qty: 3000 }] });
    await separateTransfer(matriz, t.id);
    let restore = failOnce(store, "create", (c, d) => c === "stock_movements" && d.idemKey === `transfer:${t.id}:out:${B.id}`);
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/Expedição incompleta/);
    restore();
    // a devolução de A é lançada, mas o registro final do cancelamento falha
    restore = failOnce(store, "update", (c, p) => c === "transfers" && p.status === "cancelled");
    await expect(cancelTransfer(matriz, t.id, "Abortada")).rejects.toThrow(/Falha simulada/);
    restore();
    expect((await bal(store, wO, A.id)).physical).toBe(oA0.physical);
    const c = await cancelTransfer(matriz, t.id, "Abortada");
    expect(c.status).toBe("cancelled");
    const a = c.items.find((i: any) => i.skuId === A.id);
    expect(a.shippedQty).toBe(2000);
    expect(a.returnedQty).toBe(2000);
    expect(c.returnedAt).toBeTruthy();
    expect(c.divergences.filter((d: any) => d.kind === "returned")).toEqual([expect.objectContaining({ skuId: A.id, qty: 2000 })]);
    expect((await bal(store, wO, B.id)).reserved).toBe(0);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_return"]] })).toHaveLength(1);
  });
});

describe("lista de produtos respeita as filiais do usuário", () => {
  it("colunas por filial, totais, trânsito e texto de exportação só com as filiais permitidas", async () => {
    const { refs } = await setup();
    const { queryProducts } = await import("@/app/(app)/produtos/queries");
    const cashier = await refs.ctxFor("cashier", "matriz"); // filiais: Matriz
    const stockist = await refs.ctxFor("stockist", "matriz"); // Matriz e Shopping
    const matrizId = refs.branches.matriz.id;
    const shopId = refs.branches.shopping.id;
    const A = refs.skus["caderno-u"];
    // trânsito no destino (Shopping) não pode aparecer para quem só vê a Matriz
    const t = await createTransfer(stockist, { toBranchId: shopId, items: [{ skuId: A.id, qty: 1000 }] });
    await shipTransfer(stockist, t.id);
    const mine = await queryProducts(cashier, { q: "", f: {} });
    const all = await queryProducts(stockist, { q: "", f: {} });
    expect(mine.branches.map((b) => b.id)).toEqual([matrizId]);
    expect(all.branches.map((b) => b.id).sort()).toEqual([matrizId, shopId].sort());
    expect(mine.rows.every((r) => Object.keys(r.stock).every((k) => k === matrizId))).toBe(true);
    const withShop = all.rows.find((r) => (r.stock[shopId] ?? 0) > 0)!;
    expect(withShop).toBeTruthy();
    const same = mine.rows.find((r) => r.id === withShop.id)!;
    expect(same.available).toBe(withShop.stock[matrizId] ?? 0);
    expect(same.stockValue).toBe(withShop.valueByBranch[matrizId] ?? 0);
    expect(same.stockText).not.toContain(`${refs.branches.shopping.code}:`);
    const caderno = (rows: any[]) => rows.find((r) => r.id === A.productId)!;
    expect(caderno(all.rows).inTransit).toBe(1000);
    expect(caderno(mine.rows).inTransit).toBe(0);
  });
});
