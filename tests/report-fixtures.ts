import type { Store } from "@/lib/db/types";
import { startOfLocalDay } from "@/lib/dates";

/** Fixtures mínimas (banco em memória) para relatórios: vendas, itens e devoluções com valores exatos. */
export const COMPANY = "co-test";
export const BR1 = "br-1";
export const BR2 = "br-2";

export async function baseRefs(store: Store) {
  await store.create("companies", { name: "Empresa Teste", status: "active" }, COMPANY);
  await store.create("branches", { companyId: COMPANY, name: "Filial Um", status: "active" }, BR1);
  await store.create("branches", { companyId: COMPANY, name: "Filial Dois", status: "active" }, BR2);
  await store.create("categories", { companyId: COMPANY, name: "Categoria X", status: "active" }, "cat-x");
  await store.create("categories", { companyId: COMPANY, name: "Categoria Y", status: "active" }, "cat-y");
  await store.create("users", { name: "Operador Um", email: "op1@t.local", status: "active" }, "op-1");
  await store.create("users", { name: "Operador Dois", email: "op2@t.local", status: "active" }, "op-2");
}

/** Instante local (America/Sao_Paulo) de uma data às `hour` horas. */
export const at = (date: string, hour = 12) => new Date(new Date(startOfLocalDay(date)).getTime() + hour * 3600000).toISOString();

let saleNo = 0;
export interface FxItem {
  skuId: string;
  sku?: string;
  qty: number; // milésimos
  unitPrice: number;
  discount?: number;
  surcharge?: number;
  cost: number; // custo total da linha
  categoryId?: string | null;
}

export async function addSale(store: Store, s: { id: string; branchId?: string; at: string; status?: "completed" | "cancelled"; operatorId?: string; items: FxItem[]; payments?: Array<{ methodKind: string; amount: number }> }) {
  const branchId = s.branchId ?? BR1;
  const items = s.items.map((i, idx) => {
    const gross = Math.round((i.unitPrice * i.qty) / 1000);
    const total = gross - (i.discount ?? 0) + (i.surcharge ?? 0);
    return { ...i, idx, gross, total };
  });
  const total = items.reduce((a, i) => a + i.total, 0);
  saleNo++;
  await store.create(
    "sales",
    {
      companyId: COMPANY, branchId, number: saleNo, status: s.status ?? "completed", operatorId: s.operatorId ?? "op-1", completedAt: s.at,
      subtotal: items.reduce((a, i) => a + i.gross, 0), discountTotal: items.reduce((a, i) => a + (i.discount ?? 0), 0), surchargeTotal: items.reduce((a, i) => a + (i.surcharge ?? 0), 0),
      total, costTotal: items.reduce((a, i) => a + i.cost, 0), itemsCount: items.length, returnedTotal: 0, returnedCost: 0,
    },
    s.id,
  );
  for (const i of items) {
    await store.create(
      "sale_items",
      {
        companyId: COMPANY, branchId, saleId: s.id, seq: i.idx + 1, skuId: i.skuId, productId: `p-${i.skuId}`, sku: i.sku ?? i.skuId, description: `Produto ${i.sku ?? i.skuId}`, unitCode: "UN",
        qty: i.qty, unitPrice: i.unitPrice, grossTotal: i.gross, itemDiscount: i.discount ?? 0, globalDiscount: 0, surcharge: i.surcharge ?? 0, total: i.total,
        unitCost: Math.round((i.cost * 1000) / i.qty), costTotal: i.cost, returnedQty: 0, categoryId: i.categoryId ?? "cat-x", completedAt: s.at,
      },
      `${s.id}-i${i.idx + 1}`,
    );
  }
  const pays = s.payments ?? [{ methodKind: "cash", amount: total }];
  for (const [k, p] of pays.entries()) {
    await store.create("sale_payments", { companyId: COMPANY, branchId, saleId: s.id, seq: k + 1, methodKind: p.methodKind, methodName: p.methodKind, amount: p.amount, status: "confirmed" }, `${s.id}-p${k + 1}`);
  }
  return { total };
}

let retNo = 0;
export async function addReturn(store: Store, r: { id: string; saleId: string; branchId?: string; at: string; status?: string; compensation?: string; refundMethod?: string; items: Array<{ seq: number; skuId: string; qty: number; total: number; cost: number }> }) {
  const branchId = r.branchId ?? BR1;
  retNo++;
  await store.create(
    "returns",
    {
      companyId: COMPANY, branchId, number: retNo, saleId: r.saleId, kind: "return", status: r.status ?? "completed", compensation: r.compensation ?? "store_credit", refundMethod: r.refundMethod ?? null,
      itemsTotal: r.items.reduce((a, i) => a + i.total, 0), costTotal: r.items.reduce((a, i) => a + i.cost, 0), completedAt: r.status === "processing" ? null : r.at,
    },
    r.id,
  );
  for (const i of r.items) {
    await store.create(
      "return_items",
      { companyId: COMPANY, branchId, returnId: r.id, saleId: r.saleId, saleItemId: `${r.saleId}-i${i.seq}`, skuId: i.skuId, qty: i.qty, total: i.total, unitCost: 0, costTotal: i.cost, completedAt: r.at, condition: "resellable" },
      `${r.id}-${i.seq}`,
    );
  }
}
