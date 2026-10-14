import { QTY } from "@/lib/money";
import type { DemoRefs } from "../base";

/**
 * Demonstração do cadastro de depósitos (§39), idempotente (id determinístico e chaves de movimento):
 *  - "Almoxarifado" (tipo almoxarifado / reserva, prioridade 2) na Matriz, com saldo de 2 produtos (caderno e
 *    caneta). Ele entra no disponível para venda: vender no PDV da Matriz mais cadernos do que há no depósito
 *    principal completa a baixa pelo almoxarifado (a divisão fica gravada no item da venda).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const admin = await refs.ctxFor("admin", "matriz");
  const almox = await sd.put("warehouses", "matriz-almox", {
    companyId: refs.company.id, isDemo: true, createdBy: refs.users.admin.id, branchId: refs.branches.matriz.id, code: "ALMOX", name: "Almoxarifado", kind: "available", purpose: "storage",
    salePriority: 2, isDefault: false, status: "active", notes: "Estoque guardado nos fundos da loja (demonstração): completa a venda quando o depósito principal não tem saldo.",
  });
  const { postMovements } = await import("../../stock");
  const stock: Array<[string, number]> = [
    ["caderno-u", 40],
    ["caneta-u", 60],
  ];
  for (const [key, qty] of stock) {
    const sku = refs.skus[key];
    if (!sku) continue;
    await postMovements(admin, [
      { warehouseId: almox.id, skuId: sku.id, qty: qty * QTY, type: "initial", unitCost: sku.costTotal ?? 0, originType: "seed", reason: "Saldo inicial do almoxarifado (demonstração)", idemKey: `seed-almox:${almox.id}:${sku.id}` },
    ]);
  }
  return { warehouse: almox.id, products: stock.map(([k]) => k) };
}
