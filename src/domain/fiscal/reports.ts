import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { addDays, dayRange, monthStart, toLocalDate, today } from "@/lib/dates";
import type { Ctx } from "@/lib/core/ctx";
import type { DocItem } from "./service";

/**
 * Relatórios fiscais (Tela 35). Critérios explícitos:
 *  - Faturamento fiscal = Σ valor das notas AUTORIZADAS de SAÍDA (NF-e, NFC-e, NFS-e), exceto finalidade devolução,
 *    com data de emissão no período. Canceladas, rejeitadas, denegadas, descartadas, rascunhos e pendentes NÃO entram.
 *  - Transferências entre filiais (origem "transfer") e itens com CFOP que não é venda (transferência, remessa, retorno,
 *    devolução, outras saídas — ver NON_REVENUE_CFOP) ficam FORA do faturamento e são totalizados à parte.
 *  - Devoluções recebidas = Σ NF-e AUTORIZADAS de ENTRADA com finalidade devolução (deduzidas no faturamento líquido).
 *  - Canceladas são listadas pelo instante do cancelamento; rejeições pelo evento de retorno no período.
 *  - Documentos de SIMULAÇÃO são contados à parte (sem validade fiscal) e identificados em todas as saídas.
 */

export interface FiscalReportFilter {
  from: string;
  to: string;
  branchId?: string | null;
  model?: string | null;
  includeSimulated?: boolean;
}

export const PENDING_STATES = ["draft", "pending", "queued", "processing", "rejected", "error"];

export function defaultPeriod() {
  const t = today();
  return { from: monthStart(t), to: t };
}

export function normalizeFilter(p: Record<string, string | undefined>): FiscalReportFilter {
  const d = defaultPeriod();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.from ?? "") ? p.from! : d.from;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.to ?? "") ? p.to! : d.to;
  return { from: from <= to ? from : to, to: from <= to ? to : from, branchId: p.branch || null, model: ["nfe", "nfce", "nfse"].includes(p.model ?? "") ? p.model! : null, includeSimulated: p.sim !== "0" };
}

function baseFilters(ctx: Ctx, f: FiscalReportFilter) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  const branch = f.branchId ?? ctx.branchId;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (f.model) filters.push(["eq", "model", f.model]);
  return filters;
}

/** Documentos emitidos no período (exceto registros de inutilização). */
export async function periodDocuments(ctx: Ctx, f: FiscalReportFilter) {
  const { start, end } = dayRange(f.from, f.to);
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [...baseFilters(ctx, f), ["gte", "issuedAt", start], ["lt", "issuedAt", end]], orderBy: [{ field: "issuedAt", dir: "asc" }] });
  return docs.filter((d) => d.originType !== "disable" && (f.includeSimulated !== false || !d.isSimulated));
}

/**
 * CFOPs de saída que NÃO são receita: transferências (x15x, x408/x409, x552, x557), devoluções (x20x, x21x, x41x, x553, x555, x556),
 * remessa de ativo (x554) e remessas/retornos/outras saídas (x9xx), exceto x922 (simples faturamento de venda para entrega futura)
 * e x933 (serviço tributado pelo ISSQN). Regra assumida — validar com a contabilidade.
 */
export const NON_REVENUE_CFOP = /^[567](15\d|20\d|21\d|40[89]|41\d|55[2-7]|9(?!22|33)\d\d)$/;
export const isRevenueItem = (i: { cfop?: string | null }) => !NON_REVENUE_CFOP.test(String(i.cfop ?? ""));

/** Saída autorizada (fora devoluções) que não é receita: transferência entre filiais ou só itens de remessa/transferência. */
export const isNonRevenueOut = (d: Doc) =>
  d.status === "authorized" && d.operationType !== "entrada" && d.purpose !== "devolucao" &&
  (d.originType === "transfer" || (d.model !== "nfse" && (d.items ?? []).length > 0 && !(d.items as DocItem[]).some(isRevenueItem)));

export const isRevenue = (d: Doc) => d.status === "authorized" && d.operationType !== "entrada" && d.purpose !== "devolucao" && !isNonRevenueOut(d);

/** Valor do documento no faturamento: em nota mista (venda + remessa/bonificação), só os itens com CFOP de venda. */
export function revenueAmount(d: Doc): number {
  if (!isRevenue(d)) return 0;
  const items = (d.items ?? []) as DocItem[];
  if (d.model === "nfse" || !items.length || items.every(isRevenueItem)) return d.total ?? 0;
  return items.filter(isRevenueItem).reduce((a, i) => a + (i.total ?? 0), 0);
}
export const isReturnIn = (d: Doc) => d.status === "authorized" && d.operationType === "entrada" && d.purpose === "devolucao";

export function summarize(docs: Doc[], f: FiscalReportFilter) {
  const byStatus: Record<string, { count: number; total: number }> = {};
  const byModel: Record<string, { count: number; total: number }> = {};
  for (const d of docs) {
    const s = (byStatus[d.status] ??= { count: 0, total: 0 });
    s.count++;
    s.total += d.total ?? 0;
  }
  const revenue = docs.filter(isRevenue);
  const returnsIn = docs.filter(isReturnIn);
  const nonRevenueOut = docs.filter(isNonRevenueOut);
  for (const d of revenue) {
    const m = (byModel[d.model] ??= { count: 0, total: 0 });
    m.count++;
    m.total += revenueAmount(d);
  }
  const sum = (arr: Doc[], fn: (d: Doc) => number) => arr.reduce((a, d) => a + (fn(d) || 0), 0);
  const gross = sum(revenue, revenueAmount);
  const returns = sum(returnsIn, (d) => d.total);
  const goods = revenue.filter((d) => d.model !== "nfse");
  const services = revenue.filter((d) => d.model === "nfse");
  const taxes = {
    icms: sum(goods, (d) => d.totals?.icms),
    icmsBase: sum(goods, (d) => d.totals?.icmsBase),
    pis: sum(goods, (d) => d.totals?.pis),
    cofins: sum(goods, (d) => d.totals?.cofins),
    iss: sum(services, (d) => d.service?.iss),
    issWithheld: sum(services, (d) => d.service?.issWithheldValue),
    federalWithheld: sum(services, (d) => d.service?.federalWithheld),
  };
  // série diária (autorizadas de saída)
  const days: string[] = [];
  for (let d = f.from; d <= f.to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const daily = days.map((day) => {
    const row: Record<string, any> = { date: day, nfe: 0, nfce: 0, nfse: 0 };
    return row;
  });
  const idx = new Map(daily.map((r, i) => [r.date, i]));
  for (const d of revenue) {
    const i = idx.get(toLocalDate(d.issuedAt));
    if (i != null) daily[i][d.model] += revenueAmount(d);
  }
  const pending = docs.filter((d) => PENDING_STATES.includes(d.status));
  const excluded = docs.filter((d) => !isRevenue(d) && !isReturnIn(d));
  // itens de remessa/bonificação em notas mistas também ficam fora do faturamento
  const mixedNonRevenue = sum(revenue, (d) => (d.total ?? 0) - revenueAmount(d));
  return {
    count: docs.length,
    gross,
    returns,
    net: gross - returns,
    revenueCount: revenue.length,
    returnsCount: returnsIn.length,
    nonRevenue: sum(nonRevenueOut, (d) => d.total) + mixedNonRevenue,
    nonRevenueCount: nonRevenueOut.length,
    byStatus,
    byModel,
    taxes,
    daily,
    pendingCount: pending.length,
    pendingTotal: sum(pending, (d) => d.total),
    excludedCount: excluded.length,
    simulatedCount: docs.filter((d) => d.isSimulated).length,
    realCount: docs.filter((d) => !d.isSimulated).length,
  };
}

export interface BookRow {
  id: string;
  docId: string;
  model: string;
  date: string;
  series: string;
  number: number | null;
  accessKey: string | null;
  recipient: string;
  recipientDoc: string;
  uf: string;
  cfop: string;
  value: number;
  icmsBase: number;
  icms: number;
  exemptOther: number;
  status: string;
  note: string;
  simulated: boolean;
}

/** Livro (registro) de saídas: um lançamento por documento e CFOP; canceladas aparecem zeradas com observação. */
export function outputBook(docs: Doc[]): BookRow[] {
  const rows: BookRow[] = [];
  for (const d of docs) {
    if (d.model === "nfse" || d.operationType === "entrada") continue;
    if (!["authorized", "cancelled"].includes(d.status)) continue;
    const groups = new Map<string, { value: number; base: number; icms: number }>();
    for (const i of (d.items ?? []) as DocItem[]) {
      const g = groups.get(i.cfop) ?? { value: 0, base: 0, icms: 0 };
      g.value += i.total;
      g.base += i.icmsBase;
      g.icms += i.icms;
      groups.set(i.cfop, g);
    }
    for (const [cfop, g] of groups) {
      const cancelled = d.status === "cancelled";
      rows.push({
        id: `${d.id}:${cfop}`,
        docId: d.id,
        model: d.model,
        date: toLocalDate(d.issuedAt),
        series: d.series ?? "",
        number: d.number ?? null,
        accessKey: d.accessKey ?? null,
        recipient: d.recipientName ?? "Consumidor final",
        recipientDoc: d.recipientDoc ?? "",
        uf: d.recipient?.address?.uf ?? "",
        cfop,
        value: cancelled ? 0 : g.value,
        icmsBase: cancelled ? 0 : g.base,
        icms: cancelled ? 0 : g.icms,
        exemptOther: cancelled ? 0 : g.value - g.base,
        status: d.status,
        note: [cancelled ? "DOCUMENTO CANCELADO" : "", d.isSimulated ? "SIMULAÇÃO — sem validade fiscal" : "", d.purpose === "devolucao" ? "Devolução" : ""].filter(Boolean).join(" · "),
        simulated: Boolean(d.isSimulated),
      });
    }
  }
  return rows;
}

export interface NcmRow {
  id: string;
  ncm: string;
  description: string;
  docs: number;
  qty: number;
  value: number;
  icmsBase: number;
  icms: number;
  pis: number;
  cofins: number;
}

/** Tributos por NCM — somente notas autorizadas de saída (critério do faturamento). */
export function taxesByNcm(docs: Doc[]): NcmRow[] {
  const map = new Map<string, NcmRow & { docSet: Set<string> }>();
  for (const d of docs.filter(isRevenue)) {
    if (d.model === "nfse") continue;
    for (const i of ((d.items ?? []) as DocItem[]).filter(isRevenueItem)) {
      const k = i.ncm || "(sem NCM)";
      const r = map.get(k) ?? { id: k, ncm: k, description: i.description, docs: 0, qty: 0, value: 0, icmsBase: 0, icms: 0, pis: 0, cofins: 0, docSet: new Set<string>() };
      r.docSet.add(d.id);
      r.qty += i.qty;
      r.value += i.total;
      r.icmsBase += i.icmsBase;
      r.icms += i.icms;
      r.pis += i.pis;
      r.cofins += i.cofins;
      map.set(k, r);
    }
  }
  return [...map.values()].map(({ docSet, ...r }) => ({ ...r, docs: docSet.size })).sort((a, b) => b.value - a.value);
}

export interface CfopRow {
  id: string;
  cfop: string;
  direction: string;
  docs: number;
  value: number;
  icmsBase: number;
  icms: number;
  pis: number;
  cofins: number;
}

/** Resumo contábil por CFOP (autorizadas: saídas e entradas de devolução). */
export function summaryByCfop(docs: Doc[]): CfopRow[] {
  const map = new Map<string, CfopRow & { docSet: Set<string> }>();
  for (const d of docs.filter((x) => x.status === "authorized" && x.model !== "nfse")) {
    for (const i of (d.items ?? []) as DocItem[]) {
      const r = map.get(i.cfop) ?? { id: i.cfop, cfop: i.cfop, direction: /^[123]/.test(i.cfop) ? "Entrada" : "Saída", docs: 0, value: 0, icmsBase: 0, icms: 0, pis: 0, cofins: 0, docSet: new Set<string>() };
      r.docSet.add(d.id);
      r.value += i.total;
      r.icmsBase += i.icmsBase;
      r.icms += i.icms;
      r.pis += i.pis;
      r.cofins += i.cofins;
      map.set(i.cfop, r);
    }
  }
  return [...map.values()].map(({ docSet, ...r }) => ({ ...r, docs: docSet.size })).sort((a, b) => a.cfop.localeCompare(b.cfop));
}

export interface ServiceRow {
  id: string;
  serviceListItem: string;
  docs: number;
  amount: number;
  base: number;
  iss: number;
  issWithheld: number;
  federalWithheld: number;
  net: number;
}

export function servicesSummary(docs: Doc[]): ServiceRow[] {
  const map = new Map<string, ServiceRow>();
  for (const d of docs.filter((x) => isRevenue(x) && x.model === "nfse")) {
    const s = d.service ?? {};
    const k = s.serviceListItem ?? "—";
    const r = map.get(k) ?? { id: k, serviceListItem: k, docs: 0, amount: 0, base: 0, iss: 0, issWithheld: 0, federalWithheld: 0, net: 0 };
    r.docs++;
    r.amount += s.amount ?? 0;
    r.base += s.base ?? 0;
    r.iss += s.iss ?? 0;
    r.issWithheld += s.issWithheldValue ?? 0;
    r.federalWithheld += s.federalWithheld ?? 0;
    r.net += s.net ?? 0;
    map.set(k, r);
  }
  return [...map.values()];
}

/** Cancelamentos com instante de cancelamento no período (independe da data de emissão). */
export async function cancellations(ctx: Ctx, f: FiscalReportFilter) {
  const { start, end } = dayRange(f.from, f.to);
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [...baseFilters(ctx, f), ["eq", "status", "cancelled"], ["gte", "cancelledAt", start], ["lt", "cancelledAt", end]], orderBy: [{ field: "cancelledAt", dir: "asc" }] });
  return docs
    .filter((d) => f.includeSimulated !== false || !d.isSimulated)
    .map((d) => ({ id: d.id, model: d.model, number: d.number ?? d.rpsNumber ?? null, series: d.series ?? "", accessKey: d.accessKey ?? null, issuedAt: d.issuedAt, cancelledAt: d.cancelledAt, total: d.total ?? 0, reason: d.cancelReason ?? "", originType: d.originType, originId: d.originId, simulated: Boolean(d.isSimulated), recipient: d.recipientName ?? "" }));
}

/** Rejeições/denegações retornadas no período (inclusive de documentos depois corrigidos e autorizados). */
export async function rejections(ctx: Ctx, f: FiscalReportFilter) {
  const { start, end } = dayRange(f.from, f.to);
  const evFilters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "status", ["rejected", "denied"]], ["gte", "occurredAt", start], ["lt", "occurredAt", end]];
  const branch = f.branchId ?? ctx.branchId;
  if (branch) evFilters.push(["eq", "branchId", branch]);
  const events = (await listAll(ctx.store, "fiscal_events", { filters: evFilters, orderBy: [{ field: "occurredAt", dir: "desc" }] })).filter((e) => ["send", "query"].includes(e.type));
  const ids = [...new Set(events.map((e) => e.documentId))];
  const docs = new Map<string, Doc>();
  for (const id of ids) {
    const d = await ctx.store.get("fiscal_documents", id);
    if (d) docs.set(id, d);
  }
  return events
    .filter((e) => {
      const d = docs.get(e.documentId);
      return d && (!f.model || d.model === f.model) && (f.includeSimulated !== false || !d.isSimulated);
    })
    .map((e) => {
      const d = docs.get(e.documentId)!;
      return { id: e.id, docId: d.id, model: d.model, number: d.number ?? d.rpsNumber ?? null, ref: d.ref, occurredAt: e.occurredAt, status: e.status, message: e.message, currentStatus: d.status, total: d.total ?? 0, simulated: Boolean(d.isSimulated) };
    });
}

export function sumBy<T>(rows: T[], fn: (r: T) => number) {
  return rows.reduce((a, r) => a + (fn(r) || 0), 0);
}
