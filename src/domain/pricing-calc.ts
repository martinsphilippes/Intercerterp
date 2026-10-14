/**
 * Cálculo de totais de venda — função pura compartilhada por PDV (cliente),
 * servidor, documentos fiscais e relatórios. Valores em centavos, quantidades em milésimos.
 */
import { allocate, lineTotal, pct, roundDiv } from "@/lib/money";

export interface CalcItemInput {
  qty: number;
  unitPrice: number;
  /** desconto do item em centavos */
  itemDiscount?: number;
  /** acréscimo do item em centavos */
  itemSurcharge?: number;
  /**
   * desconto de PROMOÇÃO do item em centavos (CAD-15): somado ao desconto do item (mesmo arredondamento e rateio);
   * fica identificado à parte para não consumir o limite de desconto manual do operador. Ausente/0 = sem promoção.
   */
  promoDiscount?: number;
}

export interface CalcItem extends CalcItemInput {
  grossTotal: number;
  /** desconto do item, INCLUINDO o de promoção */
  itemDiscount: number;
  /** parte do desconto do item que veio de promoção */
  promoDiscount: number;
  globalDiscount: number;
  surcharge: number;
  total: number;
}

export interface CalcResult {
  items: CalcItem[];
  subtotal: number; // bruto dos itens
  itemDiscounts: number;
  /** soma dos descontos de promoção (já incluída em itemDiscounts e discountTotal) */
  promoDiscount: number;
  globalDiscount: number;
  discountTotal: number;
  surchargeTotal: number;
  total: number;
}

/**
 * Desconto global (valor ou %) é rateado entre os itens proporcionalmente ao líquido de cada item,
 * fechando os centavos exatamente (maior resto). O mesmo vale para acréscimo global.
 */
export function calcSale(items: CalcItemInput[], opts: { globalDiscount?: number; globalDiscountBps?: number; surcharge?: number } = {}): CalcResult {
  const base = items.map((i) => {
    const grossTotal = lineTotal(i.unitPrice, i.qty);
    const promo = Math.min(Math.max(i.promoDiscount ?? 0, 0), grossTotal);
    const itemDiscount = Math.min(Math.max(i.itemDiscount ?? 0, 0) + promo, grossTotal);
    return { ...i, grossTotal, itemDiscount, promoDiscount: promo, net: grossTotal - itemDiscount, itemSurcharge: Math.max(i.itemSurcharge ?? 0, 0) };
  });
  const netSum = base.reduce((a, b) => a + b.net, 0);
  let global = opts.globalDiscount ?? 0;
  if (opts.globalDiscountBps) global = pct(netSum, opts.globalDiscountBps);
  global = Math.min(Math.max(global, 0), netSum);
  const discAlloc = allocate(global, base.map((b) => b.net));
  const surch = Math.max(opts.surcharge ?? 0, 0);
  const surAlloc = allocate(surch, base.map((b) => b.net || 1));
  const out: CalcItem[] = base.map((b, idx) => ({
    qty: b.qty,
    unitPrice: b.unitPrice,
    grossTotal: b.grossTotal,
    itemDiscount: b.itemDiscount,
    promoDiscount: b.promoDiscount,
    globalDiscount: discAlloc[idx] ?? 0,
    surcharge: b.itemSurcharge + (surAlloc[idx] ?? 0),
    total: b.net - (discAlloc[idx] ?? 0) + b.itemSurcharge + (surAlloc[idx] ?? 0),
  }));
  const subtotal = out.reduce((a, b) => a + b.grossTotal, 0);
  const itemDiscounts = out.reduce((a, b) => a + b.itemDiscount, 0);
  const promoDiscount = out.reduce((a, b) => a + b.promoDiscount, 0);
  const surchargeTotal = out.reduce((a, b) => a + b.surcharge, 0);
  return {
    items: out,
    subtotal,
    itemDiscounts,
    promoDiscount,
    globalDiscount: global,
    discountTotal: itemDiscounts + global,
    surchargeTotal,
    total: subtotal - itemDiscounts - global + surchargeTotal,
  };
}

/**
 * Desconto MANUAL da venda em pontos-base — base do limite de desconto do operador. O desconto de promoção não conta
 * (nem no numerador nem na base: o limite incide sobre o valor já promocional). Sem promoção, é exatamente
 * descontos ÷ bruto, como antes.
 */
export function manualDiscountBps(calc: Pick<CalcResult, "subtotal" | "discountTotal" | "promoDiscount">): number {
  const base = calc.subtotal - (calc.promoDiscount ?? 0);
  return base > 0 ? roundDiv((calc.discountTotal - (calc.promoDiscount ?? 0)) * 10000, base) : 0;
}

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  cash: "Dinheiro",
  debit: "Cartão de débito",
  credit: "Cartão de crédito",
  pix: "Pix",
  crediario: "Crediário",
  boleto: "Boleto",
  store_credit: "Vale-crédito",
  loyalty: "Pontos de fidelidade",
  voucher: "Voucher/convênio",
  other: "Outros",
};

/** Meios que geram parcelas em aberto (a prazo). */
export const DEFERRED_KINDS = ["crediario", "boleto"];
/** Meios que exigem confirmação do provedor quando integrados. */
export const INTEGRATED_KINDS = ["pix", "debit", "credit"];
