/**
 * Promoções (CAD-15) — cálculo PURO, compartilhado pelo PDV (cliente), pelo servidor (`priceSale`) e pela prévia
 * do cadastro. Sem dependências de servidor: pode ser importado em componentes cliente.
 *
 * A promoção nunca muda o preço de tabela: ela vira um DESCONTO EXPLÍCITO no item (`promoDiscount`, com o id e o
 * nome da regra), somado ao desconto do item dentro de `calcSale` — o arredondamento e o rateio continuam os mesmos.
 * Valores em centavos, quantidades em milésimos (1 un = 1000).
 *
 * Tipos de regra:
 *  - "buy_x_pay_y" (leve X, pague Y): a cada X unidades do MESMO SKU no atendimento, X − Y saem de graça
 *    (as unidades gratuitas são as de menor preço unitário entre as linhas do SKU);
 *  - "min_qty" (a partir de N unidades): com N ou mais unidades do MESMO SKU, cada unidade sai pelo preço Z
 *    (`promoPrice`) ou com P% de desconto (`percentBps`); N = 1 é o desconto simples (ex.: "terça da papelaria 10%").
 * Escopo: SKUs, produtos (todas as variações) ou categorias. Condições: ativa, filial (vazia = todas), vigência
 * (datas inclusivas), dias da semana e faixa de horário (início inclusivo, fim exclusivo; início > fim atravessa a
 * meia-noite). Várias regras para o mesmo item NÃO se acumulam: vale a de maior desconto (empate: menor id).
 */
import { lineTotal, pct, QTY } from "@/lib/money";

export type PromoKind = "buy_x_pay_y" | "min_qty";
export type PromoScope = "sku" | "product" | "category";

export interface PromoRule {
  id: string;
  name: string;
  kind: PromoKind;
  scope: PromoScope;
  targetIds: string[];
  /** leve X (milésimos; unidades inteiras) */
  buyQty?: number | null;
  /** pague Y (milésimos; unidades inteiras, menor que X) */
  payQty?: number | null;
  /** a partir de N (milésimos) */
  minQty?: number | null;
  /** preço unitário promocional Z (centavos) */
  promoPrice?: number | null;
  /** desconto percentual (pontos-base) */
  percentBps?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  /** 0 = domingo … 6 = sábado; vazio = todos os dias */
  weekdays?: number[] | null;
  /** "HH:MM" */
  startTime?: string | null;
  endTime?: string | null;
  /** null = todas as filiais */
  branchId?: string | null;
  active?: boolean | null;
}

/** Momento da venda no fuso da empresa. */
export interface PromoClock {
  date: string;
  weekday: number;
  time: string;
}

export interface PromoLineInput {
  skuId: string;
  productId?: string | null;
  categoryId?: string | null;
  qty: number;
  /** preço unitário efetivo da linha antes de descontos (tabela/atacado, ou o digitado quando maior) */
  unitPrice: number;
}

export interface PromoLineResult {
  promoDiscount: number;
  promoId: string | null;
  promoName: string | null;
}

export const PROMO_KIND_LABEL: Record<PromoKind, string> = { buy_x_pay_y: "Leve X, pague Y", min_qty: "A partir de N unidades" };
export const PROMO_SCOPE_LABEL: Record<PromoScope, string> = { sku: "Variações (SKU)", product: "Produtos", category: "Categorias" };
export const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Momento local (data, dia da semana e hora) de um instante no fuso informado. */
export function promoClock(instant: Date | string = new Date(), tz = "America/Sao_Paulo"): PromoClock {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  const date = `${o.year}-${o.month}-${o.day}`;
  return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), time: `${o.hour}:${o.minute}` };
}

/** A regra vale neste momento e nesta filial? */
export function promoLiveAt(r: PromoRule, clock: PromoClock, branchId?: string | null): boolean {
  if (r.active === false) return false;
  if (r.branchId && branchId && r.branchId !== branchId) return false;
  if (r.branchId && !branchId) return false;
  if (r.validFrom && r.validFrom > clock.date) return false;
  if (r.validTo && r.validTo < clock.date) return false;
  if (r.weekdays && r.weekdays.length && !r.weekdays.includes(clock.weekday)) return false;
  const start = r.startTime || null;
  const end = r.endTime || null;
  if (start && end) {
    if (start < end) return clock.time >= start && clock.time < end;
    if (start > end) return clock.time >= start || clock.time < end;
    return true;
  }
  if (start) return clock.time >= start;
  if (end) return clock.time < end;
  return true;
}

export function promoMatches(r: PromoRule, line: Pick<PromoLineInput, "skuId" | "productId" | "categoryId">): boolean {
  const target = r.scope === "sku" ? line.skuId : r.scope === "product" ? line.productId : line.categoryId;
  return Boolean(target) && (r.targetIds ?? []).includes(target!);
}

/** Desconto de uma regra sobre as linhas de um mesmo SKU (por linha, na ordem recebida). */
export function promoDiscounts(r: PromoRule, lines: Array<Pick<PromoLineInput, "qty" | "unitPrice">>): number[] {
  const out = lines.map(() => 0);
  const total = lines.reduce((a, l) => a + Math.max(0, l.qty), 0);
  if (r.kind === "buy_x_pay_y") {
    const x = r.buyQty ?? 0;
    const y = r.payQty ?? 0;
    if (!(x > 0 && y >= 0 && y < x)) return out;
    let free = Math.floor(total / x) * (x - y);
    // as unidades gratuitas são as de menor preço (empate: ordem das linhas)
    const order = lines.map((l, i) => ({ i, price: l.unitPrice })).sort((a, b) => a.price - b.price || a.i - b.i);
    for (const o of order) {
      if (free <= 0) break;
      const take = Math.min(free, Math.max(0, lines[o.i].qty));
      out[o.i] = lineTotal(lines[o.i].unitPrice, take);
      free -= take;
    }
    return out;
  }
  // min_qty
  if (!(r.minQty && r.minQty > 0) || total < r.minQty) return out;
  return lines.map((l) => {
    const gross = lineTotal(l.unitPrice, l.qty);
    if (r.promoPrice != null && r.promoPrice >= 0) return r.promoPrice < l.unitPrice ? gross - lineTotal(r.promoPrice, l.qty) : 0;
    if (r.percentBps && r.percentBps > 0) return pct(gross, Math.min(10000, r.percentBps));
    return 0;
  });
}

/**
 * Promoção de cada linha do atendimento/venda. Linhas do mesmo SKU são somadas para a contagem de quantidade
 * (leve X pague Y / a partir de N) e recebem a mesma regra. Sem regras vigentes, devolve desconto zero em tudo.
 */
export function applyPromotions(lines: PromoLineInput[], rules: PromoRule[] | null | undefined, clock: PromoClock, branchId?: string | null): PromoLineResult[] {
  const out: PromoLineResult[] = lines.map(() => ({ promoDiscount: 0, promoId: null, promoName: null }));
  const live = (rules ?? []).filter((r) => promoLiveAt(r, clock, branchId)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!live.length) return out;
  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (!(l.qty > 0) || !(l.unitPrice > 0)) return;
    groups.set(l.skuId, [...(groups.get(l.skuId) ?? []), i]);
  });
  for (const idxs of groups.values()) {
    const first = lines[idxs[0]];
    let best: { rule: PromoRule; discounts: number[]; sum: number } | null = null;
    for (const r of live) {
      if (!promoMatches(r, first)) continue;
      const discounts = promoDiscounts(r, idxs.map((i) => lines[i])).map((d, k) => Math.min(Math.max(0, d), lineTotal(lines[idxs[k]].unitPrice, lines[idxs[k]].qty)));
      const sum = discounts.reduce((a, b) => a + b, 0);
      if (sum > 0 && (!best || sum > best.sum)) best = { rule: r, discounts, sum };
    }
    if (!best) continue;
    idxs.forEach((i, k) => {
      if (best!.discounts[k] > 0) out[i] = { promoDiscount: best!.discounts[k], promoId: best!.rule.id, promoName: best!.rule.name };
    });
  }
  return out;
}

/** Texto curto da regra (listagem, cupom, prévia). */
export function describePromotion(r: Pick<PromoRule, "kind" | "buyQty" | "payQty" | "minQty" | "promoPrice" | "percentBps">, money: (v: number) => string): string {
  const u = (q: number | null | undefined) => String((q ?? 0) / QTY).replace(".", ",");
  if (r.kind === "buy_x_pay_y") return `Leve ${u(r.buyQty)}, pague ${u(r.payQty)}`;
  const from = (r.minQty ?? 0) > QTY ? `A partir de ${u(r.minQty)} un.: ` : "";
  if (r.promoPrice != null) return `${from}${money(r.promoPrice)} cada`;
  return `${from}${String((r.percentBps ?? 0) / 100).replace(".", ",")}% de desconto`;
}

/** Janela de vigência/dias/horário em texto. */
export function describeWhen(r: Pick<PromoRule, "validFrom" | "validTo" | "weekdays" | "startTime" | "endTime">, date: (v: string) => string): string {
  const parts: string[] = [];
  if (r.validFrom || r.validTo) parts.push(r.validFrom && r.validTo ? `${date(r.validFrom)} a ${date(r.validTo)}` : r.validFrom ? `a partir de ${date(r.validFrom)}` : `até ${date(r.validTo!)}`);
  if (r.weekdays && r.weekdays.length && r.weekdays.length < 7) parts.push([...r.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABEL[d]).join(", "));
  if (r.startTime || r.endTime) parts.push(`${r.startTime || "00:00"}–${r.endTime || "24:00"}`);
  return parts.join(" · ") || "Sempre";
}

/** Validação da regra (servidor e formulário). Lança mensagem em português na primeira inconsistência. */
export function promotionProblem(r: Partial<PromoRule>): string | null {
  if (!r.name || r.name.trim().length < 2) return "Informe o nome da promoção.";
  if (r.kind !== "buy_x_pay_y" && r.kind !== "min_qty") return "Tipo de promoção inválido.";
  if (r.scope !== "sku" && r.scope !== "product" && r.scope !== "category") return "Escolha a quem a promoção se aplica.";
  if (!r.targetIds || !r.targetIds.length) return "Escolha ao menos um item, produto ou categoria.";
  if (r.targetIds.length > 200) return "Máximo de 200 itens por promoção.";
  if (r.kind === "buy_x_pay_y") {
    const x = r.buyQty ?? 0;
    const y = r.payQty ?? 0;
    if (!(x >= 2 * QTY) || x % QTY !== 0) return "“Leve” deve ser um número inteiro de unidades, a partir de 2.";
    if (!(y >= QTY) || y % QTY !== 0) return "“Pague” deve ser um número inteiro de unidades, a partir de 1.";
    if (y >= x) return "“Pague” deve ser menor que “Leve”.";
  } else {
    if (!(r.minQty && r.minQty > 0)) return "Informe a quantidade mínima (a partir de 1 unidade).";
    const hasPrice = r.promoPrice != null;
    const hasPct = r.percentBps != null && r.percentBps > 0;
    if (hasPrice === hasPct) return "Informe o preço promocional OU o percentual de desconto (um dos dois).";
    if (hasPrice && (!Number.isInteger(r.promoPrice) || r.promoPrice! <= 0)) return "Preço promocional inválido.";
    if (hasPrice && r.scope === "category") return "Preço promocional fixo vale só para produtos ou SKUs; para categoria use percentual.";
    if (hasPct && r.percentBps! > 9900) return "Percentual de desconto deve ser menor que 99%.";
  }
  if (r.validFrom && r.validTo && r.validTo < r.validFrom) return "O fim da vigência deve ser igual ou posterior ao início.";
  if (r.weekdays && r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Dia da semana inválido.";
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (r.startTime && !hhmm.test(r.startTime)) return "Horário inicial inválido (use HH:MM).";
  if (r.endTime && !hhmm.test(r.endTime)) return "Horário final inválido (use HH:MM).";
  if (r.startTime && r.endTime && r.startTime === r.endTime) return "Horário inicial e final iguais: deixe em branco para o dia todo.";
  return null;
}
