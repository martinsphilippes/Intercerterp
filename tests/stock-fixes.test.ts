import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { listAll, detId } from "@/lib/db";
import { BusinessError } from "@/lib/core/errors";
import { notify } from "@/lib/core/notify";
import { adjustStock, balanceId, localDateTimeToIso, postMovements } from "@/domain/stock";
import { cancelTransfer, createTransfer, receiveTransfer, separateTransfer, setTransferDocument, shipTransfer, updateTransferDraft, resolveTransferPending } from "@/domain/transfers";
import { cancelInventory, concludeInventory, createInventory, resumeInventoryOpening, saveCounts } from "@/domain/inventory";

async function setup() {
  const store = freshStore();
  const refs = await seedBase(store);
  return { store, refs };
}

const bal = async (store: any, wh: string, sku: string) => (await store.get("stock_balances", balanceId(wh, sku))) ?? { physical: 0, reserved: 0, inTransit: 0 };

/** Falha simulada de gravação (queda/erro do banco) na primeira escrita que casar com o critério. */
function failOnce(store: any, match: (collection: string, data: any) => boolean) {
  const orig = store.create.bind(store);
  let armed = true;
  store.create = async (collection: string, data: any, id?: string) => {
    if (armed && match(collection, data)) {
      armed = false;
      throw new BusinessError("Falha simulada de gravação.");
    }
    return orig(collection, data, id);
  };
  return () => {
    delete store.create;
  };
}

describe("transferência — expedição incompleta, reserva e recebimentos", () => {
  it("expedição que falha no meio não deixa mercadoria presa: cancelar devolve à origem (idempotente)", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const B = refs.skus["caneca-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const wD = refs.warehouses["shopping-main"].id;
    const oA0 = await bal(store, wO, A.id);
    const oB0 = await bal(store, wO, B.id);
    const dA0 = await bal(store, wD, A.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }, { skuId: B.id, qty: 3000 }] });
    await separateTransfer(matriz, t.id);

    const restore = failOnce(store, (c, d) => c === "stock_movements" && d.idemKey === `transfer:${t.id}:out:${B.id}`);
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/Expedição incompleta: 1 de 2/);
    restore();
    let tr = (await store.get("transfers", t.id))!;
    expect(tr.status).toBe("shipping"); // nunca "separado" com mercadoria já em trânsito
    expect((await bal(store, wO, A.id)).physical).toBe(oA0.physical - 2000);
    expect((await bal(store, wD, A.id)).inTransit).toBe(2000);
    expect((await bal(store, wO, B.id)).reserved).toBe(3000); // reserva de B intacta

    tr = await cancelTransfer(matriz, t.id, "Expedição abortada");
    expect(tr.status).toBe("cancelled");
    await cancelTransfer(matriz, t.id, "Expedição abortada"); // repetição não devolve de novo
    const oA = await bal(store, wO, A.id);
    const oB = await bal(store, wO, B.id);
    expect(oA.physical).toBe(oA0.physical);
    expect(oA.reserved).toBe(0);
    expect(oB.physical).toBe(oB0.physical);
    expect(oB.reserved).toBe(0);
    expect((await bal(store, wD, A.id)).inTransit).toBe(dA0.inTransit ?? 0);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_return"]] })).toHaveLength(1);
    // nada pendente: resolver de novo não altera
    await resolveTransferPending(matriz, t.id, { mode: "return", reason: "x" });
    expect((await bal(store, wO, A.id)).physical).toBe(oA0.physical);
  });

  it("expedição incompleta pode ser concluída com nova tentativa", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const B = refs.skus["caneca-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const wD = refs.warehouses["shopping-main"].id;
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }, { skuId: B.id, qty: 3000 }] });
    await separateTransfer(matriz, t.id);
    const restore = failOnce(store, (c, d) => c === "stock_movements" && d.idemKey === `transfer:${t.id}:out:${B.id}`);
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/Expedição incompleta/);
    restore();
    const done = await shipTransfer(matriz, t.id);
    expect(done.status).toBe("in_transit");
    expect(done.items.map((i: any) => i.shippedQty)).toEqual([2000, 3000]);
    expect((await bal(store, wO, A.id)).reserved).toBe(0);
    expect((await bal(store, wO, B.id)).reserved).toBe(0);
    expect((await bal(store, wD, B.id)).inTransit).toBe(3000);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_out"]] })).toHaveLength(2);
  });

  it("expedição confere o físico de todos os itens antes de expedir qualquer um", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const manager = await refs.ctxFor("manager", "matriz");
    const A = refs.skus["caderno-u"];
    const B = refs.skus["caneca-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const oA0 = await bal(store, wO, A.id);
    const oB0 = await bal(store, wO, B.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }, { skuId: B.id, qty: 3000 }] });
    await separateTransfer(matriz, t.id);
    // venda baixa o físico de B abaixo do separado
    await postMovements(manager, [{ warehouseId: wO, skuId: B.id, qty: -(oB0.physical - 1000), type: "sale", idemKey: "venda-b" }]);
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/Saldo insuficiente para expedir/);
    expect((await store.get("transfers", t.id))!.status).toBe("separated");
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_out"]] })).toHaveLength(0);
    expect((await bal(store, wO, A.id)).physical).toBe(oA0.physical);
  });

  it("nova separação após falha reserva de novo (reservas liberadas não são reaproveitadas)", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["caderno-u"];
    const B = refs.skus["meia-u"];
    const wO = refs.warehouses["matriz-main"].id;
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 2000 }, { skuId: B.id, qty: 999000 }] });
    await expect(separateTransfer(matriz, t.id)).rejects.toThrow(/insuficiente/);
    expect((await bal(store, wO, A.id)).reserved).toBe(0);
    await updateTransferDraft(matriz, t.id, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 3000 }, { skuId: B.id, qty: 1000 }] });
    const s = await separateTransfer(matriz, t.id);
    expect(s.status).toBe("separated");
    expect((await bal(store, wO, A.id)).reserved).toBe(3000);
    expect((await bal(store, wO, B.id)).reserved).toBe(1000);
    const active = await listAll(store, "stock_reservations", { filters: [["eq", "originType", "transfer"], ["eq", "originId", t.id], ["eq", "status", "active"]] });
    expect(active.map((r) => [r.skuId, r.qty]).sort()).toEqual([[A.id, 3000], [B.id, 1000]].sort());
    // a expedição consome exatamente o reservado
    await shipTransfer(matriz, t.id);
    expect((await bal(store, wO, A.id)).reserved).toBe(0);
    expect((await bal(store, wO, B.id)).reserved).toBe(0);
  });

  it("\"Confirmar e enviar\" reenviado após erro usa os dados corrigidos do rascunho", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const A = refs.skus["cinto-u"]; // 8 un na matriz
    const input = (qty: number) => ({ toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty }] });
    const t = await createTransfer(matriz, input(15000), { idemKey: "form-1" });
    await expect(shipTransfer(matriz, t.id)).rejects.toThrow(/insuficiente/);
    expect((await store.get("transfers", t.id))!.status).toBe("draft");
    const again = await createTransfer(matriz, input(5000), { idemKey: "form-1" });
    expect(again.id).toBe(t.id);
    expect(again.items[0].qty).toBe(5000);
    const sent = await shipTransfer(matriz, again.id);
    expect(sent.status).toBe("in_transit");
    expect(sent.items[0].shippedQty).toBe(5000);
    // depois de enviada, o reenvio é só retomada idempotente
    const third = await createTransfer(matriz, input(1000), { idemKey: "form-1" });
    expect(third.status).toBe("in_transit");
    expect(third.items[0].qty).toBe(5000);
    expect(await listAll(store, "transfers", { filters: [["eq", "companyId", matriz.companyId]] })).toHaveLength(1);
  });

  it("recebimentos simultâneos com chaves diferentes não passam do expedido (nem consomem trânsito de outra transferência)", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const shopping = await refs.ctxFor("stockist", "shopping");
    const A = refs.skus["caderno-u"];
    const wD = refs.warehouses["shopping-main"].id;
    const d0 = await bal(store, wD, A.id);
    const x = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 10000 }] });
    const y = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 10000 }] });
    await shipTransfer(matriz, x.id);
    await shipTransfer(matriz, y.id);
    expect((await bal(store, wD, A.id)).inTransit).toBe(20000);
    const res = await Promise.allSettled([
      receiveTransfer(shopping, x.id, { idemKey: "rx-1", lines: [{ skuId: A.id, receivedQty: 10000, damagedQty: 0 }] }),
      receiveTransfer(shopping, x.id, { idemKey: "rx-2", lines: [{ skuId: A.id, receivedQty: 10000, damagedQty: 0 }] }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);
    const d = await bal(store, wD, A.id);
    expect(d.physical).toBe(d0.physical + 10000);
    expect(d.inTransit).toBe(10000); // trânsito de Y intacto
    const tx = (await store.get("transfers", x.id))!;
    expect(tx.status).toBe("received");
    expect(tx.items[0].receivedQty).toBe(10000);
    expect(tx.receipts).toHaveLength(1);
    // Y continua recebível integralmente
    const ry = await receiveTransfer(shopping, y.id, { idemKey: "ry-1", lines: [{ skuId: A.id, receivedQty: 10000, damagedQty: 0 }] });
    expect(ry.status).toBe("received");
    expect((await bal(store, wD, A.id)).inTransit).toBe(0);
  });

  it("recebimento repetido após falha antes do registro final completa sem duplicar", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const shopping = await refs.ctxFor("stockist", "shopping");
    const A = refs.skus["caderno-u"];
    const wD = refs.warehouses["shopping-main"].id;
    const d0 = await bal(store, wD, A.id);
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 4000 }] });
    await shipTransfer(matriz, t.id);
    // registro final do recebimento falha depois de os movimentos terem sido gravados
    const origUpdate = (store as any).update.bind(store);
    let armed = true;
    (store as any).update = async (c: string, id: string, patch: any) => {
      if (armed && c === "transfers" && patch.receipts) {
        armed = false;
        throw new BusinessError("Falha simulada de gravação.");
      }
      return origUpdate(c, id, patch);
    };
    await expect(receiveTransfer(shopping, t.id, { idemKey: "r-1", lines: [{ skuId: A.id, receivedQty: 4000, damagedQty: 0 }] })).rejects.toThrow(/Falha simulada/);
    delete (store as any).update;
    const r = await receiveTransfer(shopping, t.id, { idemKey: "r-1", lines: [{ skuId: A.id, receivedQty: 4000, damagedQty: 0 }] });
    expect(r.status).toBe("received");
    expect(r.receipts).toHaveLength(1);
    expect((await bal(store, wD, A.id)).physical).toBe(d0.physical + 4000);
    expect(await listAll(store, "stock_movements", { filters: [["eq", "originId", t.id], ["eq", "type", "transfer_in"]] })).toHaveLength(1);
  });

  it("referência do documento: só na filial de origem, fora do consolidado e não cancelada", async () => {
    const { refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const shopping = await refs.ctxFor("stockist", "shopping");
    const consolidated = await refs.ctxFor("manager", null);
    const A = refs.skus["caderno-u"];
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 1000 }] });
    await expect(setTransferDocument(consolidated, t.id, "NF-e 1")).rejects.toThrow(/consolidado/);
    await expect(setTransferDocument(shopping, t.id, "NF-e 1")).rejects.toThrow(/filial de origem/);
    const ok = await setTransferDocument(matriz, t.id, "NF-e 1");
    expect(ok.documentRef).toBe("NF-e 1");
    await cancelTransfer(matriz, t.id, "Desistência");
    await expect(setTransferDocument(matriz, t.id, "NF-e 2")).rejects.toThrow(/cancelada/);
  });

  it("alerta de transferência atrasada é resolvido no recebimento total e no cancelamento", async () => {
    const { store, refs } = await setup();
    const matriz = await refs.ctxFor("stockist", "matriz");
    const shopping = await refs.ctxFor("stockist", "shopping");
    const A = refs.skus["caderno-u"];
    const t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 1000 }] });
    await shipTransfer(matriz, t.id);
    const key = `transfer_overdue:${t.id}`;
    await notify(store, { companyId: matriz.companyId, branchId: refs.branches.shopping.id, type: "deadline", title: "Atrasada", occurrenceKey: key, audience: { module: "stock" } });
    const open = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", key]] });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((n) => n.occurrenceStatus === "open")).toBe(true);
    await receiveTransfer(shopping, t.id, { idemKey: "rr", lines: [{ skuId: A.id, receivedQty: 1000, damagedQty: 0 }] });
    expect((await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", key]] })).every((n) => n.occurrenceStatus === "resolved")).toBe(true);

    const t2 = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items: [{ skuId: A.id, qty: 1000 }] });
    const key2 = `transfer_overdue:${t2.id}`;
    await notify(store, { companyId: matriz.companyId, type: "deadline", title: "Atrasada", occurrenceKey: key2, audience: { module: "stock" } });
    await cancelTransfer(matriz, t2.id, "Desistência");
    expect((await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", key2]] })).every((n) => n.occurrenceStatus === "resolved")).toBe(true);
  });
});

describe("saídas manuais respeitam o reservado", () => {
  it("saída manual, ajuste de saída e perda não consomem o que está reservado para transferência", async () => {
    const { store, refs } = await setup();
    const stockist = await refs.ctxFor("stockist", "matriz");
    const B = refs.skus["caneca-u"]; // 20 un
    const wO = refs.warehouses["matriz-main"].id;
    const t = await createTransfer(stockist, { toBranchId: refs.branches.shopping.id, items: [{ skuId: B.id, qty: 15000 }] });
    await separateTransfer(stockist, t.id);
    await expect(adjustStock(stockist, { warehouseId: wO, skuId: B.id, type: "manual_out", qty: 10000, reason: "Consumo interno", idemKey: "m1" })).rejects.toThrow(/disponível/);
    await expect(adjustStock(stockist, { warehouseId: wO, skuId: B.id, type: "loss", qty: 6000, reason: "Quebra", idemKey: "m2" })).rejects.toThrow(/reservado/);
    await expect(adjustStock(stockist, { warehouseId: wO, skuId: B.id, type: "adjust_out", qty: 5001, reason: "Correção", idemKey: "m3" })).rejects.toThrow(/disponível/);
    const ok = await adjustStock(stockist, { warehouseId: wO, skuId: B.id, type: "loss", qty: 5000, reason: "Quebra", idemKey: "m4" });
    expect(ok!.balanceAfter).toBe(15000);
    const b = await bal(store, wO, B.id);
    expect(b.physical - b.reserved).toBe(0);
    // a expedição segue possível
    const sent = await shipTransfer(stockist, t.id);
    expect(sent.status).toBe("in_transit");
  });
});

describe("data do movimento manual", () => {
  it("interpreta o campo datetime-local no fuso de São Paulo", () => {
    expect(localDateTimeToIso("2026-10-05T10:00", "America/Sao_Paulo")).toBe("2026-10-05T13:00:00.000Z");
    expect(localDateTimeToIso("2026-10-06T01:30", "America/Sao_Paulo")).toBe("2026-10-06T04:30:00.000Z");
    expect(localDateTimeToIso("2026-10-06T01:30:15")).toBe("2026-10-06T04:30:15.000Z");
    expect(localDateTimeToIso("2026-02-30T10:00")).toBeNull();
    expect(localDateTimeToIso("ontem")).toBeNull();
    expect(localDateTimeToIso("2026-10-05T25:00")).toBeNull();
  });
});

describe("inventário — um por depósito e abertura retomável", () => {
  it("não abre dois inventários no mesmo depósito (nem em aberturas simultâneas) e libera ao concluir/cancelar", async () => {
    const { store, refs } = await setup();
    const manager = await refs.ctxFor("manager", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const sku = refs.skus["bone-u"]; // 15 un
    const inv1 = await createInventory(manager, { warehouseId: wh, scope: "all" }, { idemKey: "i1" });
    expect(inv1.status).toBe("open");
    await expect(createInventory(manager, { warehouseId: wh, scope: "category", categoryId: refs.categories["Acessórios"].id }, { idemKey: "i2" })).rejects.toThrow(/em andamento/);
    expect((await createInventory(manager, { warehouseId: wh, scope: "all" }, { idemKey: "i1" })).id).toBe(inv1.id); // repetição idempotente
    // contagem 13 (base 15) → um único ajuste de −2
    await saveCounts(manager, inv1.id, [{ skuId: sku.id, qty: 13000 }]);
    await concludeInventory(manager, inv1.id);
    expect((await bal(store, wh, sku.id)).physical).toBe(13000);
    // depósito liberado: novo inventário abre e, sem diferença, não altera o saldo
    const inv2 = await createInventory(manager, { warehouseId: wh, scope: "category", categoryId: refs.categories["Acessórios"].id }, { idemKey: "i3" });
    await saveCounts(manager, inv2.id, [{ skuId: sku.id, qty: 13000 }]);
    await concludeInventory(manager, inv2.id);
    expect((await bal(store, wh, sku.id)).physical).toBe(13000);

    // aberturas simultâneas no mesmo depósito: só uma passa
    const shop = await refs.ctxFor("manager", "shopping");
    const whS = refs.warehouses["shopping-main"].id;
    const res = await Promise.allSettled([createInventory(shop, { warehouseId: whS, scope: "all" }, { idemKey: "s1" }), createInventory(shop, { warehouseId: whS, scope: "all" }, { idemKey: "s2" })]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await listAll(store, "inventories", { filters: [["eq", "warehouseId", whS]] })).filter((i) => i.status !== "cancelled")).toHaveLength(1);
    const opened = (res.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>).value;
    await cancelInventory(shop, opened.id, "Teste");
    const again = await createInventory(shop, { warehouseId: whS, scope: "all" }, { idemKey: "s3" });
    expect(again.status).toBe("open");
  });

  it("abertura interrompida fica em preparação, bloqueia contagem e é completada pela repetição", async () => {
    const { store, refs } = await setup();
    const manager = await refs.ctxFor("manager", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const restore = failOnce(store, (c) => c === "inventory_counts");
    await expect(createInventory(manager, { warehouseId: wh, scope: "all" }, { idemKey: "inv-crash" })).rejects.toThrow(/Falha simulada/);
    restore();
    const id = detId("inventory", manager.companyId, "inv-crash");
    const inv = (await store.get("inventories", id))!;
    expect(inv.status).toBe("preparing");
    await expect(saveCounts(manager, id, [{ skuId: refs.skus["bone-u"].id, qty: 1000 }])).rejects.toThrow(/abertura/);
    await expect(concludeInventory(manager, id)).rejects.toThrow(/abertura/);
    await expect(createInventory(manager, { warehouseId: wh, scope: "all" }, { idemKey: "outra" })).rejects.toThrow(/em andamento/);
    const done = await createInventory(manager, { warehouseId: wh, scope: "all" }, { idemKey: "inv-crash" });
    expect(done.status).toBe("open");
    const counts = await listAll(store, "inventory_counts", { filters: [["eq", "inventoryId", id]] });
    expect(counts.length).toBeGreaterThan(5);
    expect(done.itemsCount).toBe(counts.length);
    expect(new Set(counts.map((c) => c.skuId)).size).toBe(counts.length);
    // retomada explícita depois de aberto não muda nada
    expect((await resumeInventoryOpening(manager, id)).status).toBe("open");
  });

  it("alerta de inventário parado é resolvido ao concluir ou cancelar", async () => {
    const { store, refs } = await setup();
    const manager = await refs.ctxFor("manager", "matriz");
    const wh = refs.warehouses["matriz-main"].id;
    const inv = await createInventory(manager, { warehouseId: wh, scope: "all" });
    const key = `inventory_stale:${inv.id}`;
    await notify(store, { companyId: manager.companyId, type: "info", title: "Parado", occurrenceKey: key, audience: { module: "stock" } });
    await cancelInventory(manager, inv.id, "Refazer");
    const ns = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", key]] });
    expect(ns.length).toBeGreaterThan(0);
    expect(ns.every((n) => n.occurrenceStatus === "resolved")).toBe(true);
  });
});

describe("consultas de estoque respeitam as filiais do usuário", () => {
  it("usuário restrito à Matriz não vê saldos, movimentos, transferências nem inventários de outra filial", async () => {
    const { refs } = await setup();
    const { queryBalances, queryMovements, queryTransfers, queryInventories, branchScope } = await import("@/app/(app)/estoque/queries");
    const cashier = await refs.ctxFor("cashier", "matriz"); // filiais: Matriz
    const stockist = await refs.ctxFor("stockist", "matriz"); // Matriz e Shopping
    const shopId = refs.branches.shopping.id;
    const matrizId = refs.branches.matriz.id;
    const shopping = await refs.ctxFor("stockist", "shopping");
    await createInventory(shopping, { warehouseId: refs.warehouses["shopping-main"].id, scope: "all" });
    const t = await createTransfer(shopping, { toBranchId: refs.branches.matriz.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000 }] });
    expect(branchScope(cashier, { filial: shopId })).toBe(matrizId);
    for (const f of [{ filial: shopId }, { filial: "all" }]) {
      const bals = await queryBalances(cashier, { q: "", f });
      expect(bals.length).toBeGreaterThan(0);
      expect(bals.every((b) => b.branchId === matrizId)).toBe(true);
      const movs = await queryMovements(cashier, { q: "", f: { ...f, de: "2000-01-01" } });
      expect(movs.rows.every((m) => m.branchId === matrizId)).toBe(true);
      expect((await queryInventories(cashier, { q: "", f })).length).toBe(0);
    }
    // transferência que envolve a Matriz continua visível; a que não envolve, não
    expect((await queryTransfers(cashier, { q: "", f: { filial: "all" } })).map((x) => x.id)).toContain(t.id);
    const all = await queryBalances(stockist, { q: "", f: { filial: "all" } });
    expect(all.some((b) => b.branchId === shopId)).toBe(true);
    expect((await queryInventories(stockist, { q: "", f: { filial: "all" } })).length).toBe(1);
  });
});
