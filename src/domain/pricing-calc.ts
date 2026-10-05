/**
 * Cálculo de totais de venda — função pura compartilhada por PDV (cliente),
 * servidor, documentos fiscais e relatórios. Valores em centavos, quantidades em milésimos.
 */
import { allocate, lineTotal, pct } from "@/lib/money";

export interface CalcItemInput {
  qty: number;
  unitPrice: number;
  /** desconto do item em centavos */
  itemDiscount?: number;
  /** acréscimo do item em centavos */
  itemSurcharge?: number;
}

export interface CalcItem extends CalcItemInput {
  grossTotal: number;
  itemDiscount: number;
  globalDiscount: number;
  surcharge: number;
  total: number;
}

export interface CalcResult {
  items: CalcItem[];
  subtotal: number; // bruto dos itens
  itemDiscounts: number;
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
    const itemDiscount = Math.min(Math.max(i.itemDiscount ?? 0, 0), grossTotal);
    return { ...i, grossTotal, itemDiscount, net: grossTotal - itemDiscount, itemSurcharge: Math.max(i.itemSurcharge ?? 0, 0) };
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
    globalDiscount: discAlloc[idx] ?? 0,
    surcharge: b.itemSurcharge + (surAlloc[idx] ?? 0),
    total: b.net - (discAlloc[idx] ?? 0) + b.itemSurcharge + (surAlloc[idx] ?? 0),
  }));
  const subtotal = out.reduce((a, b) => a + b.grossTotal, 0);
  const itemDiscounts = out.reduce((a, b) => a + b.itemDiscount, 0);
  const surchargeTotal = out.reduce((a, b) => a + b.surcharge, 0);
  return {
    items: out,
    subtotal,
    itemDiscounts,
    globalDiscount: global,
    discountTotal: itemDiscounts + global,
    surchargeTotal,
    total: subtotal - itemDiscounts - global + surchargeTotal,
  };
}

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  cash: "Dinheiro",
  debit: "Cartão de débito",
  credit: "Cartão de crédito",
  pix: "Pix",
  crediario: "Crediário",
  boleto: "Boleto",
  store_credit: "Vale-crédito",
  voucher: "Voucher/convênio",
  other: "Outros",
};

/** Meios que geram parcelas em aberto (a prazo). */
export const DEFERRED_KINDS = ["crediario", "boleto"];
/** Meios que exigem confirmação do provedor quando integrados. */
export const INTEGRATED_KINDS = ["pix", "debit", "credit"];
