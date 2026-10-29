/**
 * Financeiro em camadas da rede (§46) — funções PURAS (sem servidor), usadas no domínio, nas telas e nos testes.
 *
 * A partir do RETRATO IMUTÁVEL da cascata (§45) e da MODALIDADE COMERCIAL de cada relação pai→filho, monta o plano de
 * liquidação de uma venda: quem cobra o cliente final, o que cada camada paga/recebe, como cada valor é liquidado
 * (carteira pré-paga, acúmulo para o fechamento, split no pagamento, já coberto por voucher) e o custo AC da Intercert.
 *
 * Invariante (testada): preço pago pelo cliente = Σ resultado de cada camada (inclusive a plataforma) + custo AC.
 * Todos os valores em CENTAVOS inteiros; percentuais em pontos-base, arredondados para baixo.
 */

export const BILLING_MODES = [
  { value: "prepaid", label: "Pré-pago (créditos)" },
  { value: "postpaid", label: "Pós-pago (fechamento periódico)" },
  { value: "commission", label: "Comissionado" },
] as const;
export type BillingMode = (typeof BILLING_MODES)[number]["value"];
export const BILLING_MODE_LABEL: Record<string, string> = Object.fromEntries(BILLING_MODES.map((m) => [m.value, m.label]));

export const BILLING_PERIODS = [
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quinzenal (dias 1 e 16)" },
  { value: "monthly", label: "Mensal" },
] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number]["value"];
export const BILLING_PERIOD_LABEL: Record<string, string> = Object.fromEntries(BILLING_PERIODS.map((m) => [m.value, m.label]));
export const WEEKDAY_LABEL = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export interface AgreementTerms {
  mode: BillingMode;
  /** pós-pago e comissão por período: periodicidade do fechamento */
  period: BillingPeriod;
  /** semanal: dia da semana do fechamento (0 = domingo … 6 = sábado) */
  weekday: number;
  /** mensal: dia do mês do fechamento (1 a 28) */
  monthDay: number;
  /** vencimento do título do fechamento: dias após o fechamento (0 a 60) */
  dueDays: number;
  /** comissionado: no fim do período ("period") ou no pagamento da venda ("split", repasse pelo provedor) */
  commissionSettlement: "period" | "split";
  /** comissionado: margem do filho pelo retrato (padrão) ou percentual do preço final */
  commissionRule: "margin" | "percent";
  commissionBps: number;
  /** pré-pago: saldo negativo permitido (centavos; 0 = bloqueia a venda sem saldo) */
  overdraftLimit: number;
  /** pré-pago: avisa quando o saldo disponível ficar abaixo (centavos; 0 = sem aviso) */
  lowBalanceAlert: number;
  /** comissão de indicação (contador que indicou o cliente) paga pelo filho quando vende */
  referralKind: "none" | "percent" | "fixed";
  referralBps: number;
  referralCents: number;
  referralSettlement: "period" | "split";
}

/** Relação sem modalidade definida: pós-pago mensal (fechamento no dia 1), vencimento em 10 dias. */
export const DEFAULT_TERMS: AgreementTerms = {
  mode: "postpaid", period: "monthly", weekday: 1, monthDay: 1, dueDays: 10, commissionSettlement: "period", commissionRule: "margin", commissionBps: 0,
  overdraftLimit: 0, lowBalanceAlert: 0, referralKind: "none", referralBps: 0, referralCents: 0, referralSettlement: "period",
};

/** Normaliza e valida os termos (devolve os erros em português). */
export function normalizeTerms(input: Partial<AgreementTerms>): { terms: AgreementTerms; errors: string[] } {
  const errors: string[] = [];
  const int = (v: unknown, d: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? d : Math.round(Number(v)));
  const t: AgreementTerms = {
    mode: (BILLING_MODES.some((m) => m.value === input.mode) ? input.mode : DEFAULT_TERMS.mode) as BillingMode,
    period: (BILLING_PERIODS.some((p) => p.value === input.period) ? input.period : DEFAULT_TERMS.period) as BillingPeriod,
    weekday: int(input.weekday, DEFAULT_TERMS.weekday),
    monthDay: int(input.monthDay, DEFAULT_TERMS.monthDay),
    dueDays: int(input.dueDays, DEFAULT_TERMS.dueDays),
    commissionSettlement: input.commissionSettlement === "split" ? "split" : "period",
    commissionRule: input.commissionRule === "percent" ? "percent" : "margin",
    commissionBps: int(input.commissionBps, 0),
    overdraftLimit: int(input.overdraftLimit, 0),
    lowBalanceAlert: int(input.lowBalanceAlert, 0),
    referralKind: input.referralKind === "percent" || input.referralKind === "fixed" ? input.referralKind : "none",
    referralBps: int(input.referralBps, 0),
    referralCents: int(input.referralCents, 0),
    referralSettlement: input.referralSettlement === "split" ? "split" : "period",
  };
  if (input.mode && !BILLING_MODES.some((m) => m.value === input.mode)) errors.push("Modalidade inválida.");
  if (t.weekday < 0 || t.weekday > 6) errors.push("Dia da semana do fechamento inválido.");
  if (t.monthDay < 1 || t.monthDay > 28) errors.push("Dia do fechamento mensal: de 1 a 28.");
  if (t.dueDays < 0 || t.dueDays > 60) errors.push("Vencimento do fechamento: de 0 a 60 dias.");
  if (t.mode === "commission" && t.commissionRule === "percent" && (t.commissionBps <= 0 || t.commissionBps > 10000)) errors.push("Percentual de comissão: de 0,01% a 100%.");
  if (t.overdraftLimit < 0) errors.push("O limite de saldo negativo não pode ser negativo.");
  if (t.lowBalanceAlert < 0) errors.push("O aviso de saldo baixo não pode ser negativo.");
  if (t.referralKind === "percent" && (t.referralBps <= 0 || t.referralBps > 10000)) errors.push("Percentual da comissão de indicação: de 0,01% a 100%.");
  if (t.referralKind === "fixed" && t.referralCents <= 0) errors.push("Informe o valor da comissão de indicação.");
  return { terms: t, errors };
}

/** Descrição curta da modalidade (telas, auditoria). */
export function describeTerms(t: AgreementTerms, fmt: (c: number) => string = (c) => (c / 100).toFixed(2)): string {
  const period = t.period === "weekly" ? `semanal (${WEEKDAY_LABEL[t.weekday]})` : t.period === "biweekly" ? "quinzenal (dias 1 e 16)" : `mensal (dia ${t.monthDay})`;
  if (t.mode === "prepaid") return `Pré-pago${t.overdraftLimit > 0 ? ` · negativo até ${fmt(t.overdraftLimit)}` : " · bloqueia sem saldo"}${t.lowBalanceAlert > 0 ? ` · aviso abaixo de ${fmt(t.lowBalanceAlert)}` : ""}`;
  if (t.mode === "postpaid") return `Pós-pago ${period} · vencimento ${t.dueDays} dia(s) após o fechamento`;
  const rule = t.commissionRule === "percent" ? `${(t.commissionBps / 100).toLocaleString("pt-BR")}% do preço final` : "margem pelo retrato (preço final − custo)";
  return `Comissionado · ${rule} · ${t.commissionSettlement === "split" ? "split no pagamento" : `fechamento ${period}, vencimento ${t.dueDays} dia(s)`}`;
}

// ------------------------------------------------------------------------------------------------------------- períodos

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const addD = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** Último dia de fechamento ≤ `ref` (o fechamento cobre até a véspera). */
export function lastClosingDay(t: Pick<AgreementTerms, "period" | "weekday" | "monthDay">, ref: string): string {
  const [y, m, d] = ref.split("-").map(Number);
  if (t.period === "weekly") return addD(ref, -((weekday(ref) - t.weekday + 7) % 7));
  if (t.period === "biweekly") return d >= 16 ? ymd(y, m, 16) : ymd(y, m, 1);
  return d >= t.monthDay ? ymd(y, m, t.monthDay) : ymd(y, m - 1, t.monthDay);
}

/** Próximo dia de fechamento > `ref`. */
export function nextClosingDay(t: Pick<AgreementTerms, "period" | "weekday" | "monthDay">, ref: string): string {
  const [y, m, d] = ref.split("-").map(Number);
  if (t.period === "weekly") return addD(ref, ((t.weekday - weekday(ref) + 7) % 7) || 7);
  if (t.period === "biweekly") return d < 16 ? ymd(y, m, 16) : ymd(y, m + 1, 1);
  return d < t.monthDay ? ymd(y, m, t.monthDay) : ymd(y, m + 1, t.monthDay);
}

/** Corte do fechamento devido em `ref`: as vendas pagas até esta data (inclusive) entram. */
export function closingCutoff(t: Pick<AgreementTerms, "period" | "weekday" | "monthDay">, ref: string): string {
  return addD(lastClosingDay(t, ref), -1);
}

// ---------------------------------------------------------------------------------------------------------------- plano

export interface PlanLevel {
  nodeId: string;
  name: string;
  level: string;
  cost: number;
}

export interface PlanSnapshot {
  acCost: number | null;
  levels: PlanLevel[];
  sellerNodeId: string;
  finalPrice: number;
  coupon: { issuerNodeId: string | null; absorbedByNodeId: string | null; belowMin: number } | null;
  voucher: { unitPrice: number; soldByNodeId: string | null } | null;
  costCovered: boolean;
  free: boolean;
}

/** Ponta de um fluxo: cliente final, um nó, a plataforma Intercert ou o fornecedor AC (Soluti/Serpro). */
export interface Party {
  type: "client" | "node" | "platform" | "supplier";
  nodeId: string | null;
  name: string;
}

export type FlowKind = "client" | "cost" | "commission" | "ac_cost" | "referral";
/** como o valor é liquidado */
export type FlowSettlement = "charge" | "wallet" | "accrual" | "split" | "covered";

export interface PlanFlow {
  /** chave estável (idempotência dos lançamentos e agrupamento dos fechamentos) */
  key: string;
  kind: FlowKind;
  payer: Party;
  payee: Party;
  amount: number;
  settlement: FlowSettlement;
  /** nó cuja modalidade rege o fluxo (o filho da relação; null = plataforma/AC) */
  agreementNodeId: string | null;
  /** pré-pago: saldo negativo permitido no momento da venda */
  overdraftLimit?: number;
  note?: string;
}

export interface SalePlan {
  version: 1;
  finalPrice: number;
  acCost: number;
  /** quem cobra o cliente final (null = plataforma Intercert) */
  collectorNodeId: string | null;
  flows: PlanFlow[];
  /** resultado de cada camada nesta venda (recebe − paga); chave = nodeId ou "platform" */
  earnings: Record<string, number>;
  notes: string[];
}

const partyKey = (p: Party) => (p.type === "node" ? `n:${p.nodeId}` : p.type);
export const flowKey = (kind: FlowKind, payer: Party, payee: Party) => `${kind}:${partyKey(payer)}>${partyKey(payee)}`;
/** chave da RELAÇÃO (agrupa os lançamentos de um fechamento): o tipo e as duas pontas */
export const relationKeyOf = (f: Pick<PlanFlow, "kind" | "payer" | "payee">) => flowKey(f.kind, f.payer, f.payee);

export interface PlanOptions {
  /** modalidade da relação de cada nó com o de cima */
  termsOf: (nodeId: string) => AgreementTerms;
  /** fornecedor AC (rótulo) */
  supplier?: string | null;
  /** contador que indicou o cliente (não é o vendedor) */
  referrer?: { nodeId: string; name: string } | null;
}

const PLATFORM: Party = { type: "platform", nodeId: null, name: "Intercert (plataforma)" };
const bps = (base: number, b: number) => Math.floor((base * b) / 10000);

/**
 * Plano de liquidação de uma venda (função pura).
 *
 * Regras:
 *  - Cada camada i paga ao de cima o seu custo do retrato (`cost_i`); o vendedor recebe o preço final.
 *  - Cupom emitido ACIMA do vendedor que deixou o preço abaixo do mínimo: o emissor absorve `belowMin` — o custo de
 *    cada camada entre o emissor e o vendedor é reduzido nesse valor (o emissor ganha menos; ninguém mais muda).
 *  - Voucher: o custo do vendedor já foi pago no pacote a quem o vendeu (S). Entre o vendedor e S nada é cobrado de
 *    novo ("covered", só informativo); de S para cima, a cascata segue normal (S paga o próprio custo ao de cima).
 *  - Quem cobra o cliente: o vendedor, salvo quando a relação dele com o de cima é COMISSIONADA — aí sobe até o
 *    primeiro nível acima cuja relação não é comissionada (ou a plataforma). Cada nível comissionado i recebe do de
 *    cima a comissão c_i = preço final − custo_i (regra "margem", padrão) ou % do preço final, nunca menos do que
 *    repassa ao de baixo. Relação comissionada ACIMA de quem cobra (o cliente pagou embaixo) é liquidada como custo
 *    acumulado (pós-pago) no fechamento.
 *  - Pré-pago: o custo sai da carteira de créditos; pós-pago e comissão por período: acumulam para o fechamento;
 *    split: liquidado no pagamento, como repasse do provedor (a conciliar).
 *  - Custo AC: a plataforma acumula o custo AC devido ao fornecedor (fechado mensalmente).
 *  - Indicação: quando um contador (≠ vendedor) indicou o cliente, o vendedor paga a comissão de indicação definida na
 *    modalidade dele (% do preço final ou valor fixo), limitada ao resultado do vendedor na venda.
 */
export function planSale(s: PlanSnapshot, opts: PlanOptions): SalePlan {
  const notes: string[] = [];
  const F = Math.max(0, Math.round(s.finalPrice));
  const n = s.levels.length;
  const L = (i: number): Party => (i === 0 ? PLATFORM : { type: "node", nodeId: s.levels[i - 1].nodeId, name: s.levels[i - 1].name });
  const idxOf = (nodeId: string | null) => (nodeId == null ? 0 : s.levels.findIndex((l) => l.nodeId === nodeId) + 1);
  // custo efetivo de cada camada (1..n), com a absorção do cupom pelo emissor acima do vendedor
  const cost: number[] = [0, ...s.levels.map((l) => Math.max(0, Math.round(l.cost)))];
  const sellerIdx = n;
  if (s.coupon && s.coupon.belowMin > 0 && s.coupon.absorbedByNodeId !== s.sellerNodeId) {
    const j = idxOf(s.coupon.absorbedByNodeId);
    if (j >= 0 && j < sellerIdx) {
      for (let i = j + 1; i <= sellerIdx; i++) cost[i] = Math.max(0, cost[i] - s.coupon.belowMin);
      notes.push(`Cupom abaixo do mínimo: ${j === 0 ? "a plataforma" : s.levels[j - 1].name} absorve a diferença.`);
    }
  }
  const acCost = Math.max(0, Math.round(s.acCost ?? 0));
  if (s.acCost == null) notes.push("Custo AC não informado no catálogo: nada acumulado ao fornecedor.");
  const flows: PlanFlow[] = [];
  const push = (f: Omit<PlanFlow, "key">) => {
    if (f.amount <= 0) return;
    flows.push({ ...f, key: flowKey(f.kind, f.payer, f.payee) });
  };
  const termsOf = (i: number) => opts.termsOf(s.levels[i - 1].nodeId);
  const costSettlement = (i: number): { settlement: FlowSettlement; overdraftLimit?: number } => {
    const t = termsOf(i);
    return t.mode === "prepaid" ? { settlement: "wallet", overdraftLimit: t.overdraftLimit } : { settlement: "accrual" };
  };

  let top = sellerIdx; // camadas 1..top seguem a cascata de custo normal
  let collector = sellerIdx; // índice de quem cobra o cliente (0 = plataforma)
  if (s.voucher || s.costCovered) {
    // voucher: o vendedor cobra o cliente; o custo dele foi pago no pacote a S
    const j = s.voucher ? idxOf(s.voucher.soldByNodeId) : sellerIdx - 1;
    const S = j >= 0 && j < sellerIdx ? j : sellerIdx - 1;
    push({ kind: "client", payer: { type: "client", nodeId: null, name: "Cliente final" }, payee: L(sellerIdx), amount: F, settlement: "charge", agreementNodeId: null });
    push({ kind: "cost", payer: L(sellerIdx), payee: L(S), amount: Math.round(s.voucher?.unitPrice ?? cost[sellerIdx]), settlement: "covered", agreementNodeId: s.levels[sellerIdx - 1].nodeId, note: "Custo pago antecipadamente no pacote de vouchers" });
    top = S;
  } else {
    while (collector >= 1 && termsOf(collector).mode === "commission") collector--;
    push({ kind: "client", payer: { type: "client", nodeId: null, name: "Cliente final" }, payee: L(collector), amount: F, settlement: "charge", agreementNodeId: null });
    // comissões dos níveis comissionados (do vendedor para cima até quem cobra)
    const c: number[] = [];
    for (let i = sellerIdx; i > collector; i--) {
      const t = termsOf(i);
      let v = t.commissionRule === "percent" ? bps(F, t.commissionBps) : F - cost[i];
      if (i < sellerIdx) v = Math.max(v, c[i + 1]);
      c[i] = Math.min(F, Math.max(0, v));
    }
    for (let i = collector + 1; i <= sellerIdx; i++) {
      const t = termsOf(i);
      push({ kind: "commission", payer: L(i - 1), payee: L(i), amount: c[i], settlement: t.commissionSettlement === "split" ? "split" : "accrual", agreementNodeId: s.levels[i - 1].nodeId });
    }
    top = collector;
  }
  // cascata de custo: de quem cobra (ou de S, no voucher) até a plataforma
  for (let i = top; i >= 1; i--) {
    const t = termsOf(i);
    const st = t.mode === "commission" ? { settlement: "accrual" as FlowSettlement } : costSettlement(i);
    push({ kind: "cost", payer: L(i), payee: L(i - 1), amount: cost[i], ...st, agreementNodeId: s.levels[i - 1].nodeId, ...(t.mode === "commission" ? { note: "Relação comissionada, mas o cliente pagou abaixo: liquidada como custo no fechamento" } : {}) });
  }
  push({ kind: "ac_cost", payer: PLATFORM, payee: { type: "supplier", nodeId: null, name: opts.supplier || "AC de 1º nível" }, amount: acCost, settlement: "accrual", agreementNodeId: null });

  // indicação: paga pelo vendedor, limitada ao resultado dele na venda
  const earnings = earningsOf(flows);
  if (opts.referrer && opts.referrer.nodeId !== s.sellerNodeId && n > 0) {
    const t = termsOf(sellerIdx);
    const want = t.referralKind === "percent" ? bps(F, t.referralBps) : t.referralKind === "fixed" ? t.referralCents : 0;
    const sellerKey = s.sellerNodeId;
    const room = Math.max(0, earnings[sellerKey] ?? 0);
    const amount = Math.min(want, room);
    if (want > 0 && amount < want) notes.push("Comissão de indicação limitada ao resultado do vendedor na venda.");
    if (t.referralKind === "none") notes.push("Indicação registrada; a modalidade do vendedor não prevê comissão de indicação.");
    push({ kind: "referral", payer: L(sellerIdx), payee: { type: "node", nodeId: opts.referrer.nodeId, name: opts.referrer.name }, amount, settlement: t.referralSettlement === "split" ? "split" : "accrual", agreementNodeId: s.sellerNodeId });
  }
  return { version: 1, finalPrice: F, acCost: flows.some((f) => f.kind === "ac_cost") ? acCost : 0, collectorNodeId: collector === 0 ? null : s.levels[collector - 1].nodeId, flows, earnings: earningsOf(flows), notes };
}

/** Resultado de cada parte (nó ou "platform"): recebe − paga, em todos os fluxos (inclusive o coberto por voucher). */
export function earningsOf(flows: PlanFlow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const key = (p: Party) => (p.type === "node" ? p.nodeId! : p.type === "platform" ? "platform" : null);
  for (const f of flows) {
    const a = key(f.payer);
    const b = key(f.payee);
    if (a) out[a] = (out[a] ?? 0) - f.amount;
    if (b) out[b] = (out[b] ?? 0) + f.amount;
  }
  return out;
}

/** Conferência do plano: preço do cliente = Σ resultados + custo AC (diferença deve ser zero). */
export function planCheck(p: SalePlan): { clientPaid: number; sumEarnings: number; acCost: number; difference: number } {
  const clientPaid = p.flows.filter((f) => f.kind === "client").reduce((a, f) => a + f.amount, 0);
  const sumEarnings = Object.values(p.earnings).reduce((a, v) => a + v, 0);
  const ac = p.flows.filter((f) => f.kind === "ac_cost").reduce((a, f) => a + f.amount, 0);
  return { clientPaid, sumEarnings, acCost: ac, difference: clientPaid - sumEarnings - ac };
}

/**
 * Visão do plano para quem olha (visibilidade §45): a plataforma vê tudo; um nó vê os fluxos em que é parte e os dos
 * níveis ABAIXO dele — nunca os fluxos entre os níveis acima, o resultado do pai nem o custo AC.
 */
export function maskPlan(p: SalePlan, s: Pick<PlanSnapshot, "levels">, viewer: { platform: boolean; myNodeId: string | null }): { flows: PlanFlow[]; earnings: Record<string, number>; acCost: number | null } {
  if (viewer.platform) return { flows: p.flows, earnings: p.earnings, acCost: p.acCost };
  const i = s.levels.findIndex((l) => l.nodeId === viewer.myNodeId);
  if (i < 0) {
    // fora do caminho (ex.: o contador indicador): só os fluxos em que é parte
    const me = viewer.myNodeId;
    const own = me ? p.flows.filter((f) => f.payer.nodeId === me || f.payee.nodeId === me) : [];
    return { flows: own, earnings: me && p.earnings[me] != null && own.length ? { [me]: p.earnings[me] } : {}, acCost: null };
  }
  const inPath = new Set(s.levels.map((l) => l.nodeId));
  const mineOrBelow = new Set(s.levels.slice(i).map((l) => l.nodeId));
  // o indicador (contador fora do caminho) fica abaixo do vendedor
  const below = (pt: Party) => pt.type === "client" || (pt.type === "node" && (mineOrBelow.has(pt.nodeId!) || !inPath.has(pt.nodeId!)));
  const me = viewer.myNodeId;
  const flows = p.flows.filter((f) => f.kind !== "ac_cost" && ((below(f.payer) && below(f.payee)) || f.payer.nodeId === me || f.payee.nodeId === me));
  const earnings: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.earnings)) if (k !== "platform" && (mineOrBelow.has(k) || !inPath.has(k))) earnings[k] = v;
  return { flows, earnings, acCost: null };
}
