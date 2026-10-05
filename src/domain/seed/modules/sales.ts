import { detId } from "@/lib/db";
import { today } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/core/settings";
import type { DemoRefs } from "../base";
import { cartTotals, type CartItem } from "../../cart-calc";

/**
 * Cenários de demonstração de vendas/caixa complementares ao seed base (idempotente):
 *  - política de autorização adicional para sangrias acima de R$ 500,00 (parâmetro explícito);
 *  - meio de pagamento "Convênio / voucher" (outras formas cadastradas);
 *  - pré-venda salva aguardando retomada no PDV;
 *  - troca aguardando a nova venda (vale da troca a aplicar no PDV).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const companyId = refs.company.id;
  const out: Record<string, unknown> = {};

  if ((await getSetting(store, companyId, null, "cash.withdrawalApprovalAbove", null)) == null) {
    await setSetting(store, companyId, null, "cash.withdrawalApprovalAbove", 50000);
    out.withdrawalPolicy = 50000;
  }

  await refs.seeder.put("payment_methods", "convenio", {
    companyId, isDemo: true, name: "Convênio / voucher", kind: "voucher", accountId: refs.accounts.banco.id, feeBps: 0, settlementDays: 30, allowsChange: false,
    requiresCustomer: false, maxInstallments: 1, active: true, sortOrder: 7, availablePdv: true,
  });

  // Pré-venda salva (atendimento em espera) para demonstrar a retomada
  const items: CartItem[] = [
    { skuId: refs.skus["tenis-41"].id, qty: 1000, unitPrice: null, itemDiscount: 0, itemSurcharge: 0, sku: refs.skus["tenis-41"].sku, name: refs.skus["tenis-41"].name, unitCode: "PAR", listPrice: 27990, available: null, attributes: refs.skus["tenis-41"].attributes },
    { skuId: refs.skus["meia-u"].id, qty: 2000, unitPrice: null, itemDiscount: 0, itemSurcharge: 0, sku: refs.skus["meia-u"].sku, name: refs.skus["meia-u"].name, unitCode: "UN", listPrice: 2990, wholesalePrice: 2390, wholesaleMinQty: 12000, available: null },
  ];
  const totals = cartTotals({ items });
  const cart = await refs.seeder.put("carts", "prevenda-maria", {
    companyId, branchId: refs.branches.matriz.id, isDemo: true, createdBy: refs.users.cashier.id, terminalId: refs.terminals.cx2.id, operatorId: refs.users.cashier.id,
    status: "parked", name: "Maria — volta às 15h para provar o tênis", customerId: refs.customers.maria.id, customerName: refs.customers.maria.name,
    priceTableId: refs.priceTables.varejo.id, items, globalDiscount: 0, globalDiscountBps: 0, surcharge: 0, payments: [], total: totals.total, itemsCount: items.length, revision: 1,
    parkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(), emitFiscal: true,
  });
  out.presale = cart.id;

  // Troca aguardando nova venda: devolução de troca da venda a prazo do dia (se a demonstração do dia existir)
  const saleId = detId("sale", "demo-today-3");
  const sale = await store.get("sales", saleId);
  if (sale && sale.status === "completed") {
    const { processReturn, returnableItems } = await import("../../sales");
    const ctx = await refs.ctxFor("cashier", "matriz");
    const lines = await returnableItems(store, saleId);
    const cinto = lines.find((l) => l.skuId === refs.skus["cinto-u"].id && l.returnable > 0);
    if (cinto) {
      const ret = await processReturn(ctx, { saleId, idemKey: "demo-exchange-pending", reason: "Cliente prefere outro modelo de cinto", compensation: "exchange", items: [{ saleItemId: cinto.id, qty: 1000, condition: "resellable", reason: "Arrependimento da compra" }], notes: "Cliente volta amanhã para escolher" });
      out.pendingExchange = ret.id;
    }
  }
  out.date = today();
  return out;
}
