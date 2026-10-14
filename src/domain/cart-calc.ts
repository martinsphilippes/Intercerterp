/**
 * Cálculos puros do atendimento (usados no PDV para totais instantâneos; o servidor recalcula na conclusão).
 * Sem dependências de servidor: pode ser importado em componentes cliente.
 */
import { addDays, addMonths } from "@/lib/dates";
import { adjustDueDate, type NonBusinessDayRule } from "@/lib/business-days";
import { roundDiv, splitInstallments, QTY } from "@/lib/money";
import { calcSale } from "./pricing-calc";
import { applyPromotions, promoClock, type PromoClock, type PromoLineResult, type PromoRule } from "./promotions-calc";

export interface CartItem {
  skuId: string;
  qty: number;
  /** preço digitado pelo operador (null = preço vigente da tabela) */
  unitPrice?: number | null;
  itemDiscount?: number;
  itemSurcharge?: number;
  /** dados de exibição (o servidor revalida tudo na conclusão) */
  sku?: string;
  name?: string;
  unitCode?: string;
  listPrice?: number;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
  available?: number | null;
  service?: boolean;
  maxDiscountBps?: number | null;
  attributes?: Record<string, string>;
  /** etiqueta de balança que lançou a linha (PDV-06; só exibição — linha não é somada a outras do mesmo SKU) */
  scale?: { barcode: string; content: "weight" | "value"; labelValue?: number | null } | null;
  /** produto e categoria do item (para casar com as promoções por produto/categoria) */
  productId?: string | null;
  categoryId?: string | null;
  /** produto com controle de lote (EST-02) e lote escolhido (null/ausente = FEFO automático) */
  lotControl?: boolean;
  lot?: string | null;
}

/** Promoções vigentes enviadas ao PDV (regras + fuso da empresa) — o servidor reaplica tudo na conclusão. */
export interface CartPromotions {
  rules: PromoRule[];
  tz?: string;
  branchId?: string | null;
  /** momento fixo (testes/prévia); padrão: agora */
  clock?: PromoClock;
}

/** Preço de tabela efetivo da linha (atacado quando a quantidade atinge o mínimo). */
export function tablePrice(i: CartItem): number {
  if (i.wholesalePrice && i.wholesaleMinQty && i.qty >= i.wholesaleMinQty) return i.wholesalePrice;
  return i.listPrice ?? 0;
}

/** Preço unitário exibido (digitado pelo operador ou da tabela). */
export function effectiveUnitPrice(i: CartItem): number {
  return i.unitPrice != null ? i.unitPrice : tablePrice(i);
}

/**
 * Totais do atendimento com a MESMA regra do servidor (`prepareSale`):
 * preço digitado abaixo da tabela vira desconto do item; acima da tabela substitui o preço.
 */
export function cartTotals(cart: { items?: CartItem[] | null; globalDiscount?: number | null; globalDiscountBps?: number | null; surcharge?: number | null }, promotions?: CartPromotions | null) {
  const items = cart.items ?? [];
  const lines = items.map((i) => {
    const table = tablePrice(i);
    let unitPrice = table;
    let itemDiscount = i.itemDiscount ?? 0;
    if (i.unitPrice != null && i.unitPrice !== table && table > 0) {
      if (i.unitPrice > table) unitPrice = i.unitPrice;
      else itemDiscount += roundDiv((table - i.unitPrice) * i.qty, QTY);
    } else if (i.unitPrice != null && table === 0) unitPrice = i.unitPrice;
    return { qty: i.qty, unitPrice, itemDiscount, itemSurcharge: i.itemSurcharge ?? 0 };
  });
  // promoções (CAD-15): desconto explícito por item, mesma função do servidor (`priceSale`)
  const promo: PromoLineResult[] | null = promotions?.rules?.length
    ? applyPromotions(
        items.map((i, k) => ({ skuId: i.skuId, productId: i.productId ?? null, categoryId: i.categoryId ?? null, qty: i.qty, unitPrice: lines[k].unitPrice })),
        promotions.rules,
        promotions.clock ?? promoClock(new Date(), promotions.tz),
        promotions.branchId ?? null,
      )
    : null;
  const calc = calcSale(
    lines.map((l, k) => (promo?.[k]?.promoDiscount ? { ...l, promoDiscount: promo[k].promoDiscount } : l)),
    { globalDiscount: cart.globalDiscountBps ? undefined : (cart.globalDiscount ?? 0), globalDiscountBps: cart.globalDiscountBps ?? 0, surcharge: cart.surcharge ?? 0 },
  );
  return { ...calc, promos: promo ?? items.map(() => ({ promoDiscount: 0, promoId: null, promoName: null })) };
}

/**
 * Prévia dos vencimentos de venda a prazo — mesma regra de `buildSchedule` (financeiro):
 * parcelas iguais (diferença de centavos na 1ª), vencimentos mensais quando o intervalo é 30 dias.
 */
export function previewSchedule(total: number, term: { installments: number; firstDueDays: number; intervalDays: number } | null, base: string, nonBusinessDay?: NonBusinessDayRule | null) {
  const n = Math.max(1, term?.installments ?? 1);
  const parts = splitInstallments(total, n);
  const first = term?.firstDueDays ?? 0;
  const interval = term?.intervalDays ?? 30;
  return parts.map((amount, i) => ({
    amount,
    dueDate: adjustDueDate(interval === 30 && first % 30 === 0 ? addMonths(base, first / 30 + i) : addDays(base, first + interval * i), nonBusinessDay),
  }));
}

/** Troco do pagamento em dinheiro: recebido − aplicado (nunca negativo). */
export function changeFor(received: number, applied: number) {
  return Math.max(0, received - applied);
}
