/**
 * Cálculos PUROS do módulo de compras (sem acesso a banco) — usados no servidor (domínio, testes)
 * e nos formulários do navegador, garantindo que tela, revisão e pedido gerado mostrem os mesmos números.
 */
import { lineTotal, pct, roundDiv, splitInstallments, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { addDays } from "@/lib/dates";

// ───────────────────────────── Estados do pedido

export type OrderStatus = "draft" | "in_review" | "adjust" | "approved" | "sent" | "partial" | "received" | "rejected" | "cancelled";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Rascunho",
  in_review: "Em análise",
  adjust: "Em ajuste",
  approved: "Aprovado",
  sent: "Enviado",
  partial: "Parcialmente recebido",
  received: "Recebido",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
};

/**
 * Máquina de estados do pedido de compra:
 *   rascunho → em análise → aprovado → enviado → parcialmente recebido → recebido
 *   em análise → em ajuste → em análise …;  em análise → rejeitado (→ em análise só por revogação)
 *   rascunho/ajuste → aprovado (autoaprovação da política)
 *   aprovado/enviado → em análise (revisão comercial que exige nova análise ou revogação da aprovação)
 *   sem recebimento → cancelado;  parcial → recebido (inclui "encerrar saldo")
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["in_review", "approved", "cancelled"],
  in_review: ["approved", "adjust", "rejected", "cancelled"],
  adjust: ["in_review", "approved", "cancelled"],
  approved: ["sent", "in_review", "partial", "received", "cancelled"],
  sent: ["sent", "partial", "received", "in_review", "cancelled"],
  partial: ["partial", "received"],
  received: [],
  rejected: ["in_review"],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new BusinessError(`Transição inválida do pedido: ${ORDER_STATUS_LABEL[from] ?? from} → ${ORDER_STATUS_LABEL[to] ?? to}.`, "invalid_transition");
}

/** Edição livre (sem revisão). */
export const EDITABLE: OrderStatus[] = ["draft", "adjust"];
/** Alteração comercial gera revisão formal. */
export const REVISABLE: OrderStatus[] = ["approved", "sent"];
/** Contam como pedidos confirmados (reposição/recebimento). */
export const CONFIRMED: OrderStatus[] = ["approved", "sent", "partial"];
/** Ainda não aprovados (rascunho/análise/ajuste). */
export const PENDING: OrderStatus[] = ["draft", "in_review", "adjust"];

// ───────────────────────────── Totais do pedido

export interface OrderItemInput {
  skuId: string;
  qty: number; // milésimos
  unitCost: number; // centavos por unidade interna
  discount?: number; // centavos (desconto da linha)
  ipi?: number; // centavos (IPI da linha, soma ao total)
  description?: string | null;
  unitCode?: string | null;
  supplierCode?: string | null;
}

export interface InstallmentPlan {
  number: number;
  days: number;
  amount: number;
}

export interface OrderTotals {
  items: Array<OrderItemInput & { gross: number; discount: number; ipi: number; total: number }>;
  subtotal: number;
  itemDiscounts: number;
  headerDiscount: number;
  discountTotal: number;
  ipiTotal: number;
  freight: number;
  insurance: number;
  otherExpenses: number;
  total: number;
}

/**
 * Linha = qtd × custo − desconto + IPI.
 * Total = subtotal bruto − descontos (itens + pedido) + IPI + frete + seguro + outras despesas.
 */
export function computeOrderTotals(input: { items: OrderItemInput[]; headerDiscount?: number; freight?: number; insurance?: number; otherExpenses?: number }): OrderTotals {
  const items = input.items.map((it) => {
    const gross = lineTotal(it.unitCost, it.qty);
    const discount = Math.min(Math.max(0, it.discount ?? 0), gross);
    const ipi = Math.max(0, it.ipi ?? 0);
    return { ...it, gross, discount, ipi, total: gross - discount + ipi };
  });
  const subtotal = items.reduce((a, i) => a + i.gross, 0);
  const itemDiscounts = items.reduce((a, i) => a + i.discount, 0);
  const ipiTotal = items.reduce((a, i) => a + i.ipi, 0);
  const headerDiscount = Math.min(Math.max(0, input.headerDiscount ?? 0), subtotal - itemDiscounts);
  const freight = Math.max(0, input.freight ?? 0);
  const insurance = Math.max(0, input.insurance ?? 0);
  const otherExpenses = Math.max(0, input.otherExpenses ?? 0);
  return {
    items, subtotal, itemDiscounts, headerDiscount, discountTotal: itemDiscounts + headerDiscount, ipiTotal, freight, insurance, otherExpenses,
    total: subtotal - itemDiscounts - headerDiscount + ipiTotal + freight + insurance + otherExpenses,
  };
}

/** Plano de parcelas relativo (dias após o faturamento) a partir de condição cadastrada ou de "30/60/90". */
export function buildInstallmentPlan(total: number, term: { installments: number; firstDueDays: number; intervalDays: number } | null, customDays?: string | null): InstallmentPlan[] {
  let days: number[] = [];
  if (customDays && customDays.trim()) {
    days = customDays.split(/[\/;,\s]+/).filter(Boolean).map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0);
    assert(days.length > 0 && days.length <= 24, "Informe os prazos das parcelas como 30/60/90.");
  } else if (term) {
    const n = Math.max(1, term.installments || 1);
    days = Array.from({ length: n }, (_, i) => (term.firstDueDays ?? 0) + (term.intervalDays ?? 30) * i);
  } else days = [0];
  const parts = splitInstallments(total, days.length);
  return days.map((d, i) => ({ number: i + 1, days: d, amount: parts[i] }));
}

/** Custo unitário líquido (após desconto da linha, sem IPI), centavos por unidade interna — comparável ao vUnCom − vDesc da NF-e. */
export function netUnitCost(item: { qty: number; unitCost: number; discount?: number | null }) {
  if (!(item.qty > 0)) return item.unitCost;
  const net = lineTotal(item.unitCost, item.qty) - Math.max(0, item.discount ?? 0);
  return roundDiv(net * QTY, item.qty);
}

/** Alteração relevante = aumento de total, de quantidade ou custo, item novo ou mudança de condição. */
export function isRelevantChange(
  before: { total: number; paymentTermsText?: string | null; items: Array<{ skuId: string; qty: number; unitCost: number }> },
  after: { total: number; paymentTermsText?: string | null; items: Array<{ skuId: string; qty: number; unitCost: number }> },
) {
  if (after.total > before.total) return true;
  if ((after.paymentTermsText ?? "") !== (before.paymentTermsText ?? "")) return true;
  const prev = new Map(before.items.map((i) => [i.skuId, i]));
  for (const it of after.items) {
    const p = prev.get(it.skuId);
    if (!p || it.qty > p.qty || it.unitCost > p.unitCost) return true;
  }
  return false;
}

// ───────────────────────────── Cotação: comparação e seleção

export interface QuoteItem {
  skuId: string;
  sku?: string | null;
  description: string;
  unitCode?: string | null;
  qty: number;
  /** data necessária (entrega até) */
  neededBy?: string | null;
}

export interface ProposalItem {
  skuId: string;
  unitPrice: number; // centavos por unidade interna
  discountBps?: number;
  available?: boolean;
  availableQty?: number | null;
  leadTimeDays?: number | null;
  /** data de entrega prometida (sobrepõe o prazo em dias) */
  deliveryDate?: string | null;
  notes?: string | null;
}

export interface QuoteProposal {
  id: string;
  supplierId: string;
  supplierName: string;
  items: ProposalItem[];
  freight: number;
  leadTimeDays?: number | null;
  paymentTermId?: string | null;
  paymentTermsText?: string | null;
  minOrderValue?: number | null;
  validUntil?: string | null;
  version?: number | null;
}

export interface QuoteLine {
  proposalId: string;
  supplierId: string;
  unitPrice: number;
  discountBps: number;
  gross: number;
  discount: number;
  total: number;
  netUnit: number;
  available: boolean;
  expired: boolean;
  viable: boolean;
  late: boolean;
  deliveryDate: string | null;
  reason?: string;
  leadTimeDays: number | null;
}

export interface QuoteOptions {
  /** somente entregas até a data necessária do item */
  onTimeOnly?: boolean;
}

export function isExpired(p: { validUntil?: string | null }, refDate: string) {
  return Boolean(p.validUntil && p.validUntil < refDate);
}

/**
 * Valor de um item numa proposta: bruto − desconto (bps). Viável = cotado, disponível na quantidade,
 * dentro da validade e (com "somente entregas no prazo") entregue até a data necessária.
 */
export function quoteLine(item: QuoteItem, p: QuoteProposal, refDate: string, opts: QuoteOptions = {}): QuoteLine | null {
  const pi = p.items.find((x) => x.skuId === item.skuId);
  if (!pi || !(pi.unitPrice > 0)) return null;
  const gross = lineTotal(pi.unitPrice, item.qty);
  const discount = pct(gross, Math.max(0, Math.min(10000, pi.discountBps ?? 0)));
  const total = gross - discount;
  const expired = isExpired(p, refDate);
  const available = pi.available !== false && (pi.availableQty == null || pi.availableQty >= item.qty);
  const lead = pi.leadTimeDays ?? p.leadTimeDays ?? null;
  const deliveryDate = pi.deliveryDate ?? (lead != null ? addDays(refDate, lead) : null);
  const late = Boolean(item.neededBy && deliveryDate && deliveryDate > item.neededBy);
  const viable = available && !expired && !(opts.onTimeOnly && late);
  return {
    proposalId: p.id,
    supplierId: p.supplierId,
    unitPrice: pi.unitPrice,
    discountBps: pi.discountBps ?? 0,
    gross,
    discount,
    total,
    netUnit: item.qty > 0 ? roundDiv(total * QTY, item.qty) : pi.unitPrice,
    available,
    expired,
    viable,
    late,
    deliveryDate,
    reason: expired ? "Proposta vencida" : !available ? (pi.available === false ? "Indisponível" : `Disponível: ${(pi.availableQty ?? 0) / QTY} de ${item.qty / QTY}`) : late ? "Após a data necessária" : undefined,
    leadTimeDays: lead,
  };
}

export interface SupplierGroup {
  supplierId: string;
  supplierName: string;
  proposalId: string;
  version: number;
  items: Array<QuoteItem & QuoteLine>;
  products: number;
  discounts: number;
  freight: number;
  total: number;
  minOrderValue: number;
  belowMinimum: boolean;
  expired: boolean;
  validUntil: string | null;
  leadTimeDays: number | null;
  paymentTermId: string | null;
  paymentTermsText: string | null;
  /** maior data de entrega entre os itens do fornecedor */
  deliveryDate: string | null;
}

export interface SelectionEval {
  groups: SupplierGroup[];
  unassigned: QuoteItem[];
  productsTotal: number;
  freightTotal: number;
  grandTotal: number;
  issues: string[];
}

/**
 * Avalia uma seleção item → fornecedor: agrupa por fornecedor, soma produtos, aplica o frete do fornecedor
 * uma única vez quando ele tem algum item e verifica pedido mínimo e validade.
 */
export function evaluateSelection(items: QuoteItem[], proposals: QuoteProposal[], assign: Record<string, string | null | undefined>, refDate: string, opts: QuoteOptions = {}): SelectionEval {
  const bySupplier = new Map(proposals.map((p) => [p.supplierId, p]));
  const groups = new Map<string, SupplierGroup>();
  const unassigned: QuoteItem[] = [];
  const issues: string[] = [];
  for (const it of items) {
    const sid = assign[it.skuId];
    const p = sid ? bySupplier.get(sid) : null;
    const line = p ? quoteLine(it, p, refDate, opts) : null;
    if (!p || !line) {
      unassigned.push(it);
      continue;
    }
    if (!line.available) issues.push(`${it.description}: ${line.reason} em ${p.supplierName}.`);
    else if (line.late) issues.push(`${it.description}: entrega ${line.deliveryDate?.split("-").reverse().join("/")} após a data necessária em ${p.supplierName}.`);
    let g = groups.get(p.supplierId);
    if (!g) {
      g = {
        supplierId: p.supplierId, supplierName: p.supplierName, proposalId: p.id, version: p.version ?? 1, items: [], products: 0, discounts: 0, freight: Math.max(0, p.freight ?? 0), total: 0,
        minOrderValue: p.minOrderValue ?? 0, belowMinimum: false, expired: isExpired(p, refDate), validUntil: p.validUntil ?? null, leadTimeDays: p.leadTimeDays ?? null,
        paymentTermId: p.paymentTermId ?? null, paymentTermsText: p.paymentTermsText ?? null, deliveryDate: null,
      };
      groups.set(p.supplierId, g);
    }
    g.items.push({ ...it, ...line });
    g.products += line.total;
    g.discounts += line.discount;
    const lt = line.leadTimeDays ?? 0;
    if (lt > (g.leadTimeDays ?? 0)) g.leadTimeDays = lt;
    if (line.deliveryDate && (!g.deliveryDate || line.deliveryDate > g.deliveryDate)) g.deliveryDate = line.deliveryDate;
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.total = g.products + g.freight;
    g.belowMinimum = g.minOrderValue > 0 && g.products < g.minOrderValue;
    if (g.belowMinimum) issues.push(`${g.supplierName}: produtos abaixo do pedido mínimo.`);
    if (g.expired) issues.push(`${g.supplierName}: proposta vencida.`);
  }
  if (unassigned.length) issues.push(`${unassigned.length} item(ns) sem fornecedor selecionado.`);
  const productsTotal = out.reduce((a, g) => a + g.products, 0);
  const freightTotal = out.reduce((a, g) => a + g.freight, 0);
  return { groups: out.sort((a, b) => a.supplierName.localeCompare(b.supplierName, "pt-BR")), unassigned, productsTotal, freightTotal, grandTotal: productsTotal + freightTotal, issues };
}

const PENALTY = 1e13;

function selectionCost(items: QuoteItem[], proposals: QuoteProposal[], assign: Record<string, string>, refDate: string, opts: QuoteOptions) {
  const ev = evaluateSelection(items, proposals, assign, refDate, opts);
  return ev.grandTotal + ev.groups.filter((g) => g.belowMinimum).length * PENALTY + ev.unassigned.length * PENALTY * 10;
}

/**
 * Sugestão de menor total viável — HEURÍSTICA (não garante o ótimo global):
 *  1) gulosa: cada item no fornecedor de menor valor de linha entre propostas viáveis (válidas e disponíveis);
 *  2) busca local: mover um item para outro fornecedor ou esvaziar um fornecedor (economiza frete),
 *     aceitando a melhor melhoria a cada rodada; pedido abaixo do mínimo é penalizado;
 *  3) para quando nenhuma troca reduz o custo (produtos + fretes) ou após 60 rodadas.
 * Menor preço unitário não garante menor pedido: frete e pedido mínimo entram no custo.
 */
export function suggestSelection(items: QuoteItem[], proposals: QuoteProposal[], refDate: string, opts: QuoteOptions = {}) {
  const cands = new Map<string, Array<{ supplierId: string; total: number }>>();
  for (const it of items) {
    const list = proposals
      .map((p) => ({ p, l: quoteLine(it, p, refDate, opts) }))
      .filter((x) => x.l?.viable)
      .map((x) => ({ supplierId: x.p.supplierId, total: x.l!.total }))
      .sort((a, b) => a.total - b.total);
    cands.set(it.skuId, list);
  }
  const assign: Record<string, string> = {};
  for (const it of items) {
    const c = cands.get(it.skuId)!;
    if (c.length) assign[it.skuId] = c[0].supplierId;
  }
  const greedyCost = selectionCost(items, proposals, assign, refDate, opts);
  let cost = greedyCost;
  let rounds = 0;
  for (; rounds < 60; rounds++) {
    let best: { assign: Record<string, string>; cost: number } | null = null;
    // movimentos de um item
    for (const it of items) {
      for (const c of cands.get(it.skuId)!) {
        if (assign[it.skuId] === c.supplierId) continue;
        const next = { ...assign, [it.skuId]: c.supplierId };
        const nc = selectionCost(items, proposals, next, refDate, opts);
        if (nc < (best?.cost ?? cost)) best = { assign: next, cost: nc };
      }
    }
    // esvaziar um fornecedor: realoca cada item dele para o melhor outro candidato
    const used = [...new Set(Object.values(assign))];
    for (const s of used) {
      const next = { ...assign };
      let ok = true;
      for (const it of items) {
        if (next[it.skuId] !== s) continue;
        const alt = cands.get(it.skuId)!.filter((c) => c.supplierId !== s);
        if (!alt.length) {
          ok = false;
          break;
        }
        const preferUsed = alt.find((c) => used.includes(c.supplierId) && c.supplierId !== s) ?? alt[0];
        next[it.skuId] = preferUsed.supplierId;
      }
      if (!ok) continue;
      const nc = selectionCost(items, proposals, next, refDate, opts);
      if (nc < (best?.cost ?? cost)) best = { assign: next, cost: nc };
    }
    if (!best) break;
    Object.assign(assign, best.assign);
    cost = best.cost;
  }
  const ev = evaluateSelection(items, proposals, assign, refDate, opts);
  return {
    assign,
    evaluation: ev,
    greedyTotal: evaluateSelection(items, proposals, Object.fromEntries(items.map((it) => [it.skuId, cands.get(it.skuId)![0]?.supplierId ?? null])), refDate, opts).grandTotal,
    rounds,
    feasible: !ev.groups.some((g) => g.belowMinimum) && ev.unassigned.length === 0,
    method: "Heurística gulosa + busca local (frete e pedido mínimo). Não garante o ótimo global.",
  };
}

// ───────────────────────────── Reposição (fórmula)

export interface ReplenishmentInput {
  /** consumo líquido no período de histórico (milésimos) */
  netConsumption: number;
  historyDays: number;
  hasHistory: boolean;
  leadTimeDays: number;
  coverageDays: number;
  minQty: number;
  /** alvo cadastrado (estoque máximo) — usado quando não há histórico */
  targetQty?: number;
  safetyQty?: number;
  available: number;
  confirmedInHorizon: number;
  draftQty?: number;
  supplierMinQty?: number;
  multiple?: number;
  deductDrafts?: boolean;
}

export interface ReplenishmentResult {
  horizonDays: number;
  avgDaily: number; // milésimos por dia (informativo)
  forecast: number; // milésimos (consumo previsto no horizonte, arredondado para cima à unidade)
  target: number;
  grossNeed: number;
  afterDrafts: number;
  suggested: number;
  limitation: string | null;
}

const ceilDiv = (a: number, b: number) => (a <= 0 ? 0 : Math.ceil(a / b));

/** Arredonda para cima ao lote mínimo e ao múltiplo comercial (milésimos). */
export function roundToLot(qty: number, minQty = 0, multiple = 0) {
  if (qty <= 0) return 0;
  let q = Math.max(qty, minQty || 0);
  if (multiple && multiple > 0) q = ceilDiv(q, multiple) * multiple;
  return q;
}

/**
 * Fórmula de reposição (documentada em docs/regras-assumidas.md):
 *   horizonte = prazo do fornecedor + dias de cobertura (replenishment.coverageDays)
 *   consumo médio diário = vendas líquidas (vendas − devoluções) dos últimos N dias ÷ N (replenishment.historyDays)
 *   alvo = máx(mínimo, ⌈consumo médio × horizonte⌉) + estoque de segurança
 *   (sem histórico: alvo = máx(mínimo, alvo cadastrado) + segurança, marcado como limitação)
 *   necessidade bruta = máx(0, alvo − disponível − confirmado com chegada no horizonte)
 *   rascunhos/pedidos em análise podem reduzir a proposta (mostrados à parte; não entram no disponível nem no confirmado)
 *   sugestão = necessidade arredondada para cima ao lote mínimo e ao múltiplo do fornecedor
 */
export function computeReplenishment(i: ReplenishmentInput): ReplenishmentResult {
  const horizonDays = Math.max(0, i.leadTimeDays) + Math.max(0, i.coverageDays);
  let forecast = 0;
  let avgDaily = 0;
  let limitation: string | null = null;
  let base: number;
  if (i.hasHistory && i.historyDays > 0) {
    avgDaily = i.netConsumption / i.historyDays;
    // ⌈consumo × horizonte⌉ em unidades inteiras, sem ponto flutuante
    forecast = ceilDiv(Math.max(0, i.netConsumption) * horizonDays, i.historyDays * QTY) * QTY;
    base = Math.max(i.minQty, forecast);
  } else {
    limitation = "Sem histórico de consumo no período: alvo = mínimo/alvo cadastrado.";
    base = Math.max(i.minQty, i.targetQty ?? 0);
  }
  const target = base + Math.max(0, i.safetyQty ?? 0);
  const grossNeed = Math.max(0, target - i.available - i.confirmedInHorizon);
  const afterDrafts = i.deductDrafts === false ? grossNeed : Math.max(0, grossNeed - Math.max(0, i.draftQty ?? 0));
  const suggested = roundToLot(afterDrafts, i.supplierMinQty ?? 0, i.multiple ?? 0);
  return { horizonDays, avgDaily, forecast, target, grossNeed, afterDrafts, suggested, limitation };
}

// ───────────────────────────── Alçadas (prévia no formulário do pedido)

export interface TierLike {
  above: number;
  steps: Array<{ name: string; kind: string; roleIds?: string[]; userIds?: string[] }>;
}

/** Alçada aplicável: a de maior `above` com total > above (ou a primeira, se nenhuma). */
export function tierFor<T extends TierLike>(rules: { tiers: T[] }, total: number): T {
  const tiers = [...rules.tiers].sort((a, b) => a.above - b.above);
  let chosen = tiers[0];
  for (const t of tiers) if (total > t.above) chosen = t;
  return chosen;
}

// ───────────────────────────── Curva ABC (priorização na reposição)

/** Classifica por participação acumulada na receita: A até limitA (bps), B até limitB, C restante; sem receita = null. */
export function abcClasses(revenueBySku: Map<string, number>, limitA = 8000, limitB = 9500) {
  const total = [...revenueBySku.values()].reduce((a, b) => a + Math.max(0, b), 0);
  const out = new Map<string, "A" | "B" | "C">();
  if (total <= 0) return out;
  let acc = 0;
  for (const [sku, rev] of [...revenueBySku.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])) {
    const before = acc;
    acc += rev;
    const pctBefore = (before * 10000) / total;
    out.set(sku, pctBefore < limitA ? "A" : pctBefore < limitB ? "B" : "C");
  }
  return out;
}
