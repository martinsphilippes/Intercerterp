import type { Doc } from "@/lib/db/types";
import { roundDiv, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx, CtxUser } from "@/lib/core/ctx";
import { canDo } from "@/lib/permissions";
import { calcSale, manualDiscountBps } from "./pricing-calc";
import { applyPromotions, promoClock, type PromoClock, type PromoRule } from "./promotions-calc";
import { resolvePrices } from "./pricing";
import type { SaleItemInput } from "./sales";

/**
 * Preço e totais de uma venda — regra ÚNICA usada pela conclusão da venda (`prepareSale`) e pelos documentos comerciais
 * (orçamento/pedido, `sales-documents.ts`): cadastro ativo, resolução de preço (`resolvePrices`), preço digitado abaixo
 * da tabela vira desconto do item, totais por `calcSale` (rateio do desconto/acréscimo global) e limites de desconto
 * (máximo da tabela por item e limite do perfil do usuário; acima disso só com "Aprovar desconto acima do limite" do
 * próprio usuário ou do aprovador informado). Extraído de `prepareSale` sem alteração de comportamento.
 */
export interface PriceSaleInput {
  branchId: string;
  priceTableId: string | null;
  items: SaleItemInput[];
  globalDiscount?: number;
  globalDiscountBps?: number;
  surcharge?: number;
  /** data da resolução de preço (padrão: hoje) */
  date?: string;
  /**
   * promoções vigentes (CAD-15) — só a conclusão da venda no PDV informa; ausente/vazio = sem promoção (comportamento
   * anterior, também para orçamentos/pedidos). O desconto de promoção não consome os limites de desconto manual.
   */
  promotions?: PromoRule[] | null;
  /** momento da venda para as condições de dia/horário (padrão: agora) */
  clock?: PromoClock;
}

export async function priceSale(ctx: Ctx, input: PriceSaleInput, opts: { approver?: CtxUser | null } = {}) {
  const skuIds = [...new Set(input.items.map((i) => i.skuId))];
  const skus = new Map<string, Doc>();
  const products = new Map<string, Doc>();
  for (const id of skuIds) {
    const sku = await ctx.store.getOrThrow("skus", id);
    assert(sku.companyId === ctx.companyId, "Produto de outra empresa.");
    assert(sku.active !== false, `Variação ${sku.sku} inativa no cadastro e não pode ser vendida.`, "sku_inactive");
    skus.set(id, sku);
    if (!products.has(sku.productId)) {
      const p = await ctx.store.getOrThrow("products", sku.productId);
      assert(p.active !== false && p.status !== "inactive", `${p.name} está inativo no cadastro e não pode ser vendido.`, "product_inactive");
      assert(p.status !== "draft", `${p.name} ainda é um rascunho no cadastro (complete e ative o produto antes de vender).`, "product_draft");
      assert(p.availablePdv !== false || p.type === "service", `${p.name} não está disponível no PDV.`);
      products.set(p.id, p);
    }
  }
  const prices = await resolvePrices(ctx.store, { companyId: ctx.companyId, branchId: input.branchId, priceTableId: input.priceTableId, items: input.items.map((i) => ({ skuId: i.skuId, qty: i.qty })), date: input.date });

  const lines = input.items.map((i, idx) => {
    assert(i.qty > 0, "Quantidade deve ser positiva.");
    const sku = skus.get(i.skuId)!;
    const product = products.get(sku.productId)!;
    const p = prices[idx];
    assert(p && p.price > 0, `Produto ${sku.sku} sem preço vigente na tabela selecionada.`);
    const listPrice = p.price;
    let unitPrice = listPrice;
    let itemDiscount = i.itemDiscount ?? 0;
    if (i.unitPrice != null && i.unitPrice !== listPrice) {
      if (i.unitPrice > listPrice) unitPrice = i.unitPrice;
      else itemDiscount += roundDiv((listPrice - i.unitPrice) * i.qty, QTY);
    }
    return { input: i, sku, product, unitPrice, listPrice, itemDiscount, maxDiscountBps: p.maxDiscountBps, wholesale: p.wholesale, promoId: null as string | null, promoName: null as string | null, promoDiscount: 0 };
  });
  // promoções: mesma função pura do PDV (cart-calc) — desconto explícito por item com o id/nome da regra
  if (input.promotions?.length) {
    const promos = applyPromotions(
      lines.map((l) => ({ skuId: l.sku.id, productId: l.product.id, categoryId: l.product.categoryId ?? null, qty: l.input.qty, unitPrice: l.unitPrice })),
      input.promotions,
      input.clock ?? promoClock(),
      input.branchId,
    );
    promos.forEach((p, k) => {
      if (p.promoDiscount > 0) Object.assign(lines[k], { promoDiscount: p.promoDiscount, promoId: p.promoId, promoName: p.promoName });
    });
  }
  const calc = calcSale(
    lines.map((l) => ({ qty: l.input.qty, unitPrice: l.unitPrice, itemDiscount: l.itemDiscount, itemSurcharge: l.input.itemSurcharge ?? 0, ...(l.promoDiscount ? { promoDiscount: l.promoDiscount } : {}) })),
    { globalDiscount: input.globalDiscount, globalDiscountBps: input.globalDiscountBps, surcharge: input.surcharge },
  );
  assert(calc.total > 0, "Total da venda deve ser positivo.");

  // Limites de desconto: por item (tabela) e global (perfil do usuário)
  const overLimit = !canDo(ctx.user, "sale.discount_over_limit") && !(opts.approver && canDo(opts.approver, "sale.discount_over_limit"));
  // (o desconto de promoção fica fora: limite sobre o desconto manual, medido sobre o valor já promocional)
  for (const [idx, l] of lines.entries()) {
    const it = calc.items[idx];
    const disc = it.itemDiscount + it.globalDiscount - it.promoDiscount;
    const base = it.grossTotal - it.promoDiscount;
    if (l.maxDiscountBps != null && l.maxDiscountBps > 0 && base > 0 && roundDiv(disc * 10000, base) > l.maxDiscountBps && overLimit) {
      throw new BusinessError(`Desconto em ${l.sku.sku} acima do máximo da tabela (${l.maxDiscountBps / 100}%). Exige autorização de um usuário com permissão.`, "discount_limit");
    }
  }
  const discBps = manualDiscountBps(calc);
  if (overLimit && discBps > (ctx.user.discountLimitBps ?? 0)) {
    throw new BusinessError(`Desconto de ${(discBps / 100).toFixed(2).replace(".", ",")}% acima do seu limite (${((ctx.user.discountLimitBps ?? 0) / 100).toFixed(2).replace(".", ",")}%). Solicite a autorização de um usuário com permissão.`, "discount_limit");
  }
  return { skus, products, lines, calc, prices };
}
