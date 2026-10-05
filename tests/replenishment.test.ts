import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, startOfLocalDay, today } from "@/lib/dates";
import { computeReplenishment, roundToLot } from "@/domain/purchase-calc";
import { computeBranchReplenishment, createDraftsFromReplenishment } from "@/domain/replenishment";
import { createOrder, setOrdersStatus } from "@/domain/purchases";
import { upsertSupplierProduct } from "@/domain/suppliers";

describe("fórmula de reposição (exemplo do requisito)", () => {
  it("prazo 7 + cobertura 14 = 21 dias; consumo 1,2/dia → alvo 26; disp. 1, confirmado 6 → 19 → múltiplo 4 → 20", () => {
    const r = computeReplenishment({ netConsumption: 108000, historyDays: 90, hasHistory: true, leadTimeDays: 7, coverageDays: 14, minQty: 5000, available: 1000, confirmedInHorizon: 6000, multiple: 4000 });
    expect(r.horizonDays).toBe(21);
    expect(r.forecast).toBe(26000);
    expect(r.target).toBe(26000);
    expect(r.grossNeed).toBe(19000);
    expect(r.suggested).toBe(20000);
  });

  it("lote mínimo, múltiplo, segurança e ausência de histórico", () => {
    expect(roundToLot(3000, 12000, 6000)).toBe(12000);
    expect(roundToLot(13000, 12000, 6000)).toBe(18000);
    expect(roundToLot(0, 12000, 6000)).toBe(0);
    const s = computeReplenishment({ netConsumption: 108000, historyDays: 90, hasHistory: true, leadTimeDays: 7, coverageDays: 14, minQty: 0, safetyQty: 4000, available: 1000, confirmedInHorizon: 6000, multiple: 4000 });
    expect(s.target).toBe(30000);
    expect(s.suggested).toBe(24000);
    const n = computeReplenishment({ netConsumption: 0, historyDays: 90, hasHistory: false, leadTimeDays: 7, coverageDays: 14, minQty: 5000, targetQty: 25000, available: 2000, confirmedInHorizon: 0 });
    expect(n.limitation).toMatch(/Sem histórico/);
    expect(n.target).toBe(25000);
    expect(n.suggested).toBe(23000);
  });
});

describe("reposição com dados reais da filial", () => {
  let store: Store;
  let refs: DemoRefs;
  let admin: Ctx;
  const key = "carregador-u";

  beforeAll(async () => {
    store = freshStore();
    refs = await seedBase(store);
    admin = await refs.ctxFor("admin", "matriz");
    const sku = refs.skus[key];
    // prazo 7 e múltiplo 4 no vínculo com o fornecedor
    await upsertSupplierProduct(admin, { supplierId: refs.suppliers.eletro.id, skuId: sku.id, supplierCode: "F-CARREGADOR", lastCost: 2800, leadTimeDays: 7, minQty: 4000, multiple: 4000, preferred: true });
    // histórico: 110 vendidos − 2 devolvidos = 108 nos últimos 90 dias → 1,2/dia
    const branchId = refs.branches.matriz.id;
    for (let i = 0; i < 55; i++) {
      const at = new Date(new Date(startOfLocalDay(addDays(today(), -(1 + i)))).getTime() + 12 * 3600000).toISOString();
      const sale = await store.create("sales", { companyId: refs.company.id, branchId, number: 9000 + i, status: "completed", total: 15980, completedAt: at });
      await store.create("sale_items", { companyId: refs.company.id, branchId, saleId: sale.id, seq: 1, skuId: sku.id, qty: 2000, unitPrice: 7990, total: 15980, completedAt: at });
    }
    // venda cancelada não conta
    const canc = await store.create("sales", { companyId: refs.company.id, branchId, number: 9999, status: "cancelled", total: 7990, completedAt: new Date(Date.now() - 86400000 * 3).toISOString() });
    await store.create("sale_items", { companyId: refs.company.id, branchId, saleId: canc.id, seq: 1, skuId: sku.id, qty: 50000, unitPrice: 7990, total: 7990, completedAt: canc.completedAt });
    // fora do período (100 dias atrás) não conta
    const old = await store.create("sales", { companyId: refs.company.id, branchId, number: 9998, status: "completed", total: 7990, completedAt: new Date(Date.now() - 86400000 * 100).toISOString() });
    await store.create("sale_items", { companyId: refs.company.id, branchId, saleId: old.id, seq: 1, skuId: sku.id, qty: 30000, unitPrice: 7990, total: 7990, completedAt: old.completedAt });
    await store.create("return_items", { companyId: refs.company.id, branchId, returnId: "r1", saleItemId: "x", skuId: sku.id, qty: 2000, completedAt: new Date(Date.now() - 86400000 * 5).toISOString() });
    // confirmado dentro do horizonte: 6 (previsão em 10 dias); fora do horizonte: 5 (em 40 dias); rascunho: 3
    const inH = await createOrder(admin, { supplierId: refs.suppliers.eletro.id, items: [{ skuId: sku.id, qty: 6000, unitCost: 2800 }], expectedDate: addDays(today(), 10) });
    await setOrdersStatus(admin, [inH.id], "approved");
    const outH = await createOrder(admin, { supplierId: refs.suppliers.eletro.id, items: [{ skuId: sku.id, qty: 5000, unitCost: 2800 }], expectedDate: addDays(today(), 40) });
    await setOrdersStatus(admin, [outH.id], "approved");
    await setOrdersStatus(admin, [outH.id], "sent");
    await createOrder(admin, { supplierId: refs.suppliers.eletro.id, items: [{ skuId: sku.id, qty: 3000, unitCost: 2800 }], expectedDate: addDays(today(), 5) });
  }, 120000);

  it("calcula com consumo líquido, disponível, confirmado no horizonte e separa fora do horizonte e rascunhos", async () => {
    const rows = await computeBranchReplenishment(store, refs.company.id, { branchId: refs.branches.matriz.id, coverageDays: 14, historyDays: 90, skuIds: [refs.skus[key].id] });
    const r = rows[0];
    expect(r.netConsumption).toBe(108000);
    expect(r.soldQty).toBe(110000);
    expect(r.returnedQty).toBe(2000);
    expect(r.leadTimeDays).toBe(7);
    expect(r.horizonDays).toBe(21);
    expect(r.available).toBe(1000);
    expect(r.target).toBe(26000);
    expect(r.confirmedInHorizon).toBe(6000);
    expect(r.confirmedOutside).toBe(5000); // entrega fora do horizonte não reduz a necessidade
    expect(r.draftQty).toBe(3000); // rascunho separado: não entra no disponível nem no confirmado
    expect(r.grossNeed).toBe(19000);
    expect(r.afterDrafts).toBe(16000);
    expect(r.suggested).toBe(16000);
    expect(r.supplierId).toBe(refs.suppliers.eletro.id);
    // previsão de falta antes da próxima entrega (1 un. ÷ 1,2/dia < 10 dias)
    expect(r.shortageBeforeArrival).toBe(true);
    expect(r.nextArrival).toBe(addDays(today(), 10));
    const noDraft = await computeBranchReplenishment(store, refs.company.id, { branchId: refs.branches.matriz.id, coverageDays: 14, historyDays: 90, skuIds: [refs.skus[key].id], deductDrafts: false });
    expect(noDraft[0].suggested).toBe(20000);
  });

  it("sem histórico usa mínimo/alvo cadastrado e sinaliza a limitação", async () => {
    const rows = await computeBranchReplenishment(store, refs.company.id, { branchId: refs.branches.matriz.id, skuIds: [refs.skus["cinto-u"].id] });
    expect(rows[0].hasHistory).toBe(false);
    expect(rows[0].limitation).toMatch(/Sem histórico/);
    expect(rows[0].target).toBe(Math.max(rows[0].minQty, rows[0].targetQty));
  });

  it("cria rascunhos por fornecedor vinculados à origem (idempotente)", async () => {
    const lines = [
      { skuId: refs.skus[key].id, qty: 16000, supplierId: refs.suppliers.eletro.id, unitCost: 2800 },
      { skuId: refs.skus["caneta-u"].id, qty: 10000, supplierId: refs.suppliers.papel.id, unitCost: 2100 },
    ];
    const o1 = await createDraftsFromReplenishment(admin, lines, { idemKey: "rep-1" });
    expect(o1).toHaveLength(2);
    expect(o1.every((o) => o.status === "draft" && o.origin === "replenishment")).toBe(true);
    const ele = o1.find((o) => o.supplierId === refs.suppliers.eletro.id)!;
    expect(ele.originData.items[0].grossNeed).toBe(19000);
    const o2 = await createDraftsFromReplenishment(admin, lines, { idemKey: "rep-1" });
    expect(o2.map((o) => o.id).sort()).toEqual(o1.map((o) => o.id).sort());
    expect((await listAll(store, "purchase_orders", { filters: [["eq", "origin", "replenishment"]] })).length).toBe(2);
    // o novo rascunho passa a aparecer separado e reduz a próxima proposta
    const rows = await computeBranchReplenishment(store, refs.company.id, { branchId: refs.branches.matriz.id, coverageDays: 14, historyDays: 90, skuIds: [refs.skus[key].id] });
    expect(rows[0].draftQty).toBe(19000);
    expect(rows[0].confirmedInHorizon).toBe(6000);
    expect(rows[0].suggested).toBe(0);
  });
});
