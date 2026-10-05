import { describe, it, expect } from "vitest";
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { listAll, detId, ConflictError } from "@/lib/db";
import { adjustStock, balanceId, postMovements, availableMap } from "@/domain/stock";
import { createTransfer, separateTransfer, shipTransfer, receiveTransfer, resolveTransferPending, cancelTransfer, pendingQty } from "@/domain/transfers";
import { createInventory, saveCounts, concludeInventory, addInventoryItem } from "@/domain/inventory";

async function setup() {
  const store = freshStore();
  const refs = await seedBase(store);
  return { store, refs };
}

const bal = async (store: any, wh: string, sku: string) => (await store.get("stock_balances", balanceId(wh, sku))) ?? { physical: 0, reserved: 0, inTransit: 0 };

describe("transferência entre filiais", () => {
  it("parcial com trânsito e divergência conserva o saldo físico total", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const shopping = await refs.ctxFor("stockist", "shopping");
    const sku = refs.skus["caderno-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const wD = refs.warehouses["shopping-main"].id;
    const wA = refs.warehouses["shopping-damaged"].id;
    const o0 = await bal(store, wO, sku.id);
    const d0 = await bal(store, wD, sku.id);
    const total0 = o0.physical + d0.physical;
    const avgO = o0.avgCost;

    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: sku.id, qty: 10000 }] }, { idemKey: "tr-1" });
    expect(t.status).toBe("draft");
    expect((await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: sku.id, qty: 10000 }] }, { idemKey: "tr-1" })).id).toBe(t.id);

    await separateTransfer(matriz, t.id);
    await separateTransfer(matriz, t.id); // idempotente
    let o = await bal(store, wO, sku.id);
    expect(o.reserved).toBe(10000);
    expect(o.physical).toBe(o0.physical);
    const availSep = await availableMap(store, refs.branches.matriz.id, [sku.id]);
    expect(availSep.get(sku.id)!.available).toBe(o0.physical - 10000);

    await Promise.all([shipTransfer(matriz, t.id), shipTransfer(matriz, t.id)]); // concorrente + idempotente
    await shipTransfer(matriz, t.id);
    o = await bal(store, wO, sku.id);
    let d = await bal(store, wD, sku.id);
    expect(o.physical).toBe(o0.physical - 10000);
    expect(o.reserved).toBe(0);
    expect(d.inTransit).toBe(10000);
    expect(d.physical).toBe(d0.physical); // trânsito não é disponível no destino
    expect((await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_out"]] })).length).toBe(1);
    // trânsito nunca disponível nas duas filiais
    const availD = await availableMap(store, refs.branches.shopping.id, [sku.id]);
    expect(availD.get(sku.id)!.available).toBe(d0.physical);

    // recebimento parcial: 6 bons + 1 avariado; 3 continuam em trânsito
    const r1 = await receiveTransfer(shopping, t.id, { idemKey: "rcv-1", lines: [{ skuId: sku.id, receivedQty: 6000, damagedQty: 1000, note: "caixa amassada" }] });
    expect(r1.status).toBe("partial");
    await receiveTransfer(shopping, t.id, { idemKey: "rcv-1", lines: [{ skuId: sku.id, receivedQty: 6000, damagedQty: 1000 }] }); // repetição não duplica
    o = await bal(store, wO, sku.id);
    d = await bal(store, wD, sku.id);
    const a = await bal(store, wA, sku.id);
    expect(d.physical).toBe(d0.physical + 6000);
    expect(a.physical).toBe(1000);
    expect(d.inTransit).toBe(3000);
    expect(o.physical + d.inTransit + d.physical + a.physical).toBe(total0);
    // entrada no destino com o custo de origem
    const tin = (await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_in"]] }))[0];
    expect(tin.unitCost).toBe(avgO);
    expect(r1.divergences.some((x: any) => x.kind === "damaged" && x.qty === 1000)).toBe(true);
    expect(r1.divergences.some((x: any) => x.kind === "missing" && x.qty === 3000 && x.open)).toBe(true);

    // excesso é recusado
    await expect(receiveTransfer(shopping, t.id, { idemKey: "rcv-2", lines: [{ skuId: sku.id, receivedQty: 4000, damagedQty: 0 }] })).rejects.toThrow(/excede/);

    // falta retorna à origem → conservação e trânsito zerado
    const r2 = await resolveTransferPending(matriz, t.id, { mode: "return", reason: "Não embarcado" });
    await resolveTransferPending(matriz, t.id, { mode: "return", reason: "Não embarcado" });
    expect(r2.status).toBe("received");
    o = await bal(store, wO, sku.id);
    d = await bal(store, wD, sku.id);
    expect(d.inTransit).toBe(0);
    expect(o.physical).toBe(o0.physical - 7000);
    expect(o.physical + d.inTransit + d.physical + a.physical).toBe(total0);
    expect(r2.items.map(pendingQty)).toEqual([0]);
    expect(r2.items[0]).toMatchObject({ shippedQty: 10000, receivedQty: 6000, damagedQty: 1000, returnedQty: 3000, lostQty: 0 });
  });

  it("falta baixada como perda e cancelamento libera reservas", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const shopping = await refs.ctxFor("stockist", "shopping");
    const sku = refs.skus["meia-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const o0 = await bal(store, wO, sku.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: sku.id, qty: 5000 }] });
    await shipTransfer(matriz, t.id); // separa automaticamente
    await receiveTransfer(shopping, t.id, { idemKey: "r", lines: [{ skuId: sku.id, receivedQty: 3000, damagedQty: 0 }] });
    const done = await resolveTransferPending(shopping, t.id, { mode: "loss", reason: "Extravio no transporte" });
    expect(done.status).toBe("received");
    expect(done.items[0].lostQty).toBe(2000);
    const o = await bal(store, wO, sku.id);
    expect(o.physical).toBe(o0.physical - 5000); // perda registrada na origem (retorno + perda)
    const loss = await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "loss"]] });
    expect(loss).toHaveLength(1);

    const t2 = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: sku.id, qty: 2000 }] });
    await separateTransfer(matriz, t2.id);
    expect((await bal(store, wO, sku.id)).reserved).toBe(2000);
    await cancelTransfer(matriz, t2.id, "Pedido desistido");
    expect((await bal(store, wO, sku.id)).reserved).toBe(0);
    // reserva acima do disponível é recusada sem deixar reserva parcial
    const t3 = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: sku.id, qty: 999000 }] });
    await expect(separateTransfer(matriz, t3.id)).rejects.toThrow(/insuficiente/);
    expect((await bal(store, wO, sku.id)).reserved).toBe(0);
  });
});

describe("inventário", () => {
  it("considera movimentos durante a contagem e não duplica ajustes ao concluir duas vezes", async () => {
    const { store, refs } = await setup();
    const manager = await refs.ctxFor("manager", "matriz");
    const stockist = await refs.ctxFor("stockist", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const sku = refs.skus["bone-u"]; // 15 un
    const other = refs.skus["caneca-u"]; // 20 un
    const b0 = await bal(store, wh, sku.id);
    expect(b0.physical).toBe(15000);

    const inv = await createInventory(stockist, { warehouseId: wh, scope: "category", categoryId: refs.categories["Acessórios"].id }, { idemKey: "inv-1" });
    const counts = await listAll(store, "inventory_counts", { filters: [["eq", "inventoryId", inv.id]] });
    expect(counts.some((c) => c.skuId === sku.id && c.baseQty === 15000)).toBe(true);
    expect(counts.some((c) => c.skuId === other.id)).toBe(false); // fora da categoria

    // venda (saída) DEPOIS da base e ANTES da contagem: entra no esperado
    await postMovements(manager, [{ warehouseId: wh, skuId: sku.id, qty: -2000, type: "sale", originType: "sale", originId: "venda-x", idemKey: "t-sale-1" }]);
    await saveCounts(stockist, inv.id, [{ skuId: sku.id, qty: 12000, note: "prateleira A" }]); // esperado 13 → diferença −1
    let c = (await store.get("inventory_counts", detId("invcount", inv.id, sku.id)))!;
    expect(c.expectedQty).toBe(13000);
    expect(c.movementsDuringCount).toBe(-2000);
    expect(c.difference).toBe(-1000);
    // venda DEPOIS da contagem: não altera o esperado
    await postMovements(manager, [{ warehouseId: wh, skuId: sku.id, qty: -1000, type: "sale", originType: "sale", originId: "venda-y", idemKey: "t-sale-2" }]);
    // recontagem prevalece
    await saveCounts(stockist, inv.id, [{ skuId: sku.id, qty: 12500, recount: true }]);
    c = (await store.get("inventory_counts", detId("invcount", inv.id, sku.id)))!;
    expect(c.finalQty).toBe(12500);
    expect(c.expectedQty).toBe(12000); // base 15 − 2 − 1 (recontagem após a 2ª venda)
    expect(c.difference).toBe(500);
    // item incluído fora do escopo
    await addInventoryItem(stockist, inv.id, other.id);
    await saveCounts(stockist, inv.id, [{ skuId: other.id, qty: 20000 }]);

    // estoquista não conclui (permissão especial)
    await expect(concludeInventory(stockist, inv.id)).rejects.toThrow(/permissão/);
    const done = await concludeInventory(manager, inv.id);
    expect(done.status).toBe("completed");
    const again = await concludeInventory(manager, inv.id);
    expect(again.id).toBe(done.id);
    const adj = await listAll(store, "stock_movements", { filters: [["eq", "originType", "inventory"], ["eq", "originId", inv.id]] });
    expect(adj).toHaveLength(1);
    expect(adj[0].qty).toBe(500);
    const b = await bal(store, wh, sku.id);
    expect(b.physical).toBe(12500); // contado (12,5) + movimentos após a contagem (nenhum)
    expect(done.summary.itemsAdjusted).toBe(1);
    expect(done.summary.valueNet).toBe(Math.round((500 * c.unitCost) / 1000));
    // itens não contados ficam sem ajuste (política padrão)
    const uncounted = (await listAll(store, "inventory_counts", { filters: [["eq", "inventoryId", inv.id]] })).filter((x) => !x.counted);
    expect(uncounted.every((x) => x.difference == null && !x.adjustmentMovementId)).toBe(true);
  });

  it("conclusões simultâneas lançam um único ajuste por item", async () => {
    const { store, refs } = await setup();
    const manager = await refs.ctxFor("manager", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const sku = refs.skus["cinto-u"];
    const inv = await createInventory(manager, { warehouseId: wh, scope: "all" });
    await saveCounts(manager, inv.id, [{ skuId: sku.id, qty: 5000 }]);
    await Promise.all([concludeInventory(manager, inv.id), concludeInventory(manager, inv.id)]);
    const adj = await listAll(store, "stock_movements", { filters: [["eq", "originType", "inventory"], ["eq", "originId", inv.id]] });
    expect(adj).toHaveLength(1);
    expect((await bal(store, wh, sku.id)).physical).toBe(5000);
  });
});

describe("movimentos e concorrência", () => {
  it("duas saídas paralelas no mesmo saldo não deixam saldo inconsistente", async () => {
    const { store, refs } = await setup();
    const ctx = await refs.ctxFor("manager", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const sku = refs.skus["cinto-u"]; // 8 un
    const b0 = await bal(store, wh, sku.id);
    expect(b0.physical).toBe(8000);
    // 5 + 5 > 8: exatamente uma passa
    const res = await Promise.allSettled([
      postMovements(ctx, [{ warehouseId: wh, skuId: sku.id, qty: -5000, type: "sale", idemKey: "par-a" }]),
      postMovements(ctx, [{ warehouseId: wh, skuId: sku.id, qty: -5000, type: "sale", idemKey: "par-b" }]),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);
    let b = await bal(store, wh, sku.id);
    expect(b.physical).toBe(3000);
    // 1 + 1 cabem: ambas passam com sequência encadeada
    await Promise.all([
      postMovements(ctx, [{ warehouseId: wh, skuId: sku.id, qty: -1000, type: "sale", idemKey: "par-c" }]),
      postMovements(ctx, [{ warehouseId: wh, skuId: sku.id, qty: -1000, type: "sale", idemKey: "par-d" }]),
      postMovements(ctx, [{ warehouseId: wh, skuId: sku.id, qty: -1000, type: "sale", idemKey: "par-d" }]), // repetição idempotente
    ]);
    b = await bal(store, wh, sku.id);
    expect(b.physical).toBe(1000);
    const movs = (await listAll(store, "stock_movements", { filters: [["eq", "balanceId", balanceId(wh, sku.id)]] })).sort((x, y) => x.seq - y.seq);
    expect(movs.map((m) => m.seq)).toEqual(movs.map((_, i) => i + 1));
    for (let i = 1; i < movs.length; i++) expect(movs[i].balanceBefore).toBe(movs[i - 1].balanceAfter);
    expect(movs.reduce((a, m) => a + m.qty, 0)).toBe(b.physical);
    expect(b.seq).toBe(movs.length);
    // a sequência única por saldo impede gravar dois movimentos com o mesmo seq
    await expect(store.create("stock_movements", { ...movs[0], id: undefined, idemKey: "dup-seq" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("ajuste manual exige permissão e motivo e é rastreável", async () => {
    const { store, refs } = await setup();
    const cashier = await refs.ctxFor("cashier", "matriz");
    const stockist = await refs.ctxFor("stockist", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const sku = refs.skus["caneca-u"];
    await expect(adjustStock(cashier, { warehouseId: wh, skuId: sku.id, type: "loss", qty: 1000, reason: "quebra", idemKey: "a1" })).rejects.toThrow(/permissão/);
    await expect(adjustStock(stockist, { warehouseId: wh, skuId: sku.id, type: "loss", qty: 1000, reason: " ", idemKey: "a1" })).rejects.toThrow(/motivo/);
    const m = await adjustStock(stockist, { warehouseId: wh, skuId: sku.id, type: "loss", qty: 1000, reason: "Caneca quebrada na reposição", idemKey: "a1" });
    await adjustStock(stockist, { warehouseId: wh, skuId: sku.id, type: "loss", qty: 1000, reason: "Caneca quebrada na reposição", idemKey: "a1" });
    expect(m!.qty).toBe(-1000);
    expect(m!.balanceAfter).toBe(m!.balanceBefore - 1000);
    expect((await listAll(store, "stock_movements", { filters: [["eq", "idemKey", "manual:a1"]] }))).toHaveLength(1);
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityType", "stock_movement"], ["eq", "entityId", m!.id]] });
    expect(logs[0].reason).toBe("Caneca quebrada na reposição");
    // depósito de outra filial é recusado
    await expect(adjustStock(stockist, { warehouseId: refs.warehouses["shopping-main"].id, skuId: sku.id, type: "adjust_in", qty: 1000, reason: "x", idemKey: "a2" })).rejects.toThrow(/filial/);
  });
});
