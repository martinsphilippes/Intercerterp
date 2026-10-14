import { isConflict, listAll, detId } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { dayRange, diffDays, formatDate, toLocalDate, today } from "@/lib/dates";
import { formatMoney, roundDiv } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting } from "@/lib/core/settings";
import { DEFERRED_KINDS } from "./pricing-calc";
import { loadFacts, MAX_PERIOD_DAYS } from "./reports";
import { cancelTitle, createTitle, titleId as titleIdOf } from "./finance";
import { saleTitleChain } from "./sales";
import { hasAllBranches } from "./goals";
import { sellerOfSale, sellerRateFor } from "./sellers";

/**
 * Comissões de vendedores (VEN-05) — apuração por período e vendedor sobre as VENDAS existentes.
 *
 * Regras (docs/regras-assumidas.md › Comissões):
 *  - vendedor da venda = `sales.sellerId`; sem vendedor informado, o operador da venda (mesma exibição da tela da venda);
 *  - percentual = o da categoria do produto no cadastro do vendedor, senão o geral (`users.commissionBps`), vigente na
 *    apuração (o fechamento grava o percentual usado na memória de cálculo);
 *  - base "invoiced" (padrão, parâmetro `commission.base`): valor líquido dos itens da venda concluída no período
 *    (bruto − descontos, sem acréscimos; juros de parcelamento ficam no título e nunca entram); devolução com movimento
 *    no período abate a comissão do item devolvido na proporção da quantidade devolvida;
 *  - base "received": comissão proporcional ao que entrou no período — à vista (inclui cartão e vale) na data da venda;
 *    a prazo, o principal das baixas ativas do título da venda (e das renegociações dele) com data no período, limitado
 *    ao total da venda; devolução no período abate a parte reembolsada/creditada ao cliente (o que foi abatido do título
 *    simplesmente deixa de ser recebido);
 *  - venda cancelada não conta; se já estava em um fechamento vigente, o período do cancelamento recebe o estorno;
 *  - cada evento tem chave própria: o que já está em fechamento vigente aparece como "já fechado" e não entra de novo,
 *    mesmo com períodos sobrepostos;
 *  - fechamento = título a pagar ao vendedor via finance.createTitle (origem "commission"), idempotente por
 *    período + filial + vendedor; reabrir só cancelando o título enquanto estiver em aberto (sem baixa).
 */

export type CommissionBase = "invoiced" | "received";

export const COMMISSION_BASE_LABEL: Record<CommissionBase, string> = {
  invoiced: "Venda faturada (líquida de descontos)",
  received: "Valor recebido",
};

export type CommissionLineKind = "sale" | "return" | "receipt" | "cancel";

export const COMMISSION_LINE_LABEL: Record<CommissionLineKind, string> = {
  sale: "Venda",
  return: "Devolução",
  receipt: "Recebimento",
  cancel: "Estorno (venda cancelada)",
};

export interface CommissionLine {
  key: string;
  kind: CommissionLineKind;
  saleId: string;
  saleNumber: number | null;
  /** nº da devolução (kind=return) */
  docNumber: number | null;
  date: string;
  branchId: string | null;
  customerName: string | null;
  /** valor-base (negativo em devoluções e estornos) */
  base: number;
  /** percentual efetivo em bps (null quando a base é zero) */
  rateBps: number | null;
  /** comissão (negativa abate) */
  amount: number;
  note: string | null;
  /** evento já incluído em fechamento vigente (não entra de novo) */
  closedIn: { titleId: string; number: number; otherBase?: boolean } | null;
}

export interface CommissionClosing {
  titleId: string;
  number: number;
  status: string;
  total: number;
  balance: number;
  from: string;
  to: string;
  branchId: string | null;
  sellerId: string;
  sellerName: string;
  base: CommissionBase;
  dueDate: string | null;
  createdAt: string;
  linesCount: number;
}

export interface SellerCommission {
  sellerId: string;
  sellerName: string;
  loginDisabled: boolean;
  /** percentual geral do cadastro (bps) */
  rateBps: number | null;
  hasCategoryRates: boolean;
  lines: CommissionLine[];
  /** somente eventos ainda não fechados */
  openBase: number;
  openAmount: number;
  /** eventos do período já incluídos em fechamentos vigentes */
  closedAmount: number;
  /** fechamento vigente exatamente deste período/filial */
  closing: CommissionClosing | null;
}

export interface CommissionQuery {
  from: string;
  to: string;
  /** filial do recorte; null = todas as filiais acessíveis */
  branchId?: string | null;
  sellerId?: string | null;
  base?: CommissionBase | null;
}

export interface CommissionReport {
  from: string;
  to: string;
  branchId: string | null;
  base: CommissionBase;
  sellers: SellerCommission[];
  totals: { openBase: number; openAmount: number; closedAmount: number };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function commissionBaseSetting(store: Store, companyId: string, branchId?: string | null): Promise<CommissionBase> {
  const v = await getSetting<string>(store, companyId, branchId ?? null, "commission.base", "invoiced");
  return v === "received" ? "received" : "invoiced";
}

function guard(ctx: Ctx) {
  requirePerm(ctx, "sales", "view");
  requireAction(ctx, "sales.commissions");
}

/** Filiais do recorte respeitando o acesso do usuário (null = todas). */
async function branchScope(ctx: Ctx, branchId: string | null | undefined): Promise<string[] | null> {
  if (branchId) {
    const b = await ctx.store.get("branches", branchId);
    assert(b && b.companyId === ctx.companyId, "Filial inválida.");
    assert(hasAllBranches(ctx.user) || (ctx.user.branchIds ?? []).includes(branchId), "Você não tem acesso a esta filial.");
    return [branchId];
  }
  return hasAllBranches(ctx.user) ? null : [...(ctx.user.branchIds ?? [])];
}

export { sellerOfSale };

async function byIds(store: Store, collection: string, ids: Array<string | null | undefined>): Promise<Map<string, Doc>> {
  const out = new Map<string, Doc>();
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  for (let i = 0; i < uniq.length; i += 100) {
    for (const r of await listAll(store, collection, { filters: [["eq", "id", uniq.slice(i, i + 100)]] })) out.set(r.id, r);
  }
  return out;
}

const itemBase = (i: Record<string, any>) => (i.grossTotal ?? 0) - (i.itemDiscount ?? 0) - (i.globalDiscount ?? 0);

/** Comissão integral de cada item (base × percentual), para os modos proporcionais. */
function fullCommission(items: Doc[], seller: Doc | null) {
  let base = 0;
  let amount = 0;
  for (const i of items) {
    const b = itemBase(i);
    base += b;
    amount += roundDiv(b * sellerRateFor(seller, i.categoryId), 10000);
  }
  return { base, amount };
}

const effRate = (amount: number, base: number) => (base ? roundDiv(amount * 10000, base) : null);

/** Fechamentos (títulos de comissão) da empresa. */
async function loadClosings(ctx: Ctx, opts: { sellerId?: string | null; includeCancelled?: boolean } = {}): Promise<Doc[]> {
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "originType", "commission"]];
  if (opts.sellerId) filters.push(["eq", "partyId", opts.sellerId]);
  const rows = await listAll(ctx.store, "titles", { filters });
  return rows.filter((t) => opts.includeCancelled || t.status !== "cancelled");
}

export function closingOf(t: Doc): CommissionClosing {
  const d = t.commissionDetail ?? {};
  return {
    titleId: t.id, number: t.number, status: t.status, total: t.total, balance: t.balance, from: d.from ?? "", to: d.to ?? "", branchId: d.branchId ?? null,
    sellerId: d.sellerId ?? t.partyId, sellerName: d.sellerName ?? t.partyName ?? "—", base: d.base === "received" ? "received" : "invoiced", dueDate: d.dueDate ?? null,
    createdAt: t.createdAt, linesCount: Array.isArray(d.lines) ? d.lines.length : 0,
  };
}

/**
 * Apuração (prévia) por vendedor no período: uma linha por evento (venda, devolução, recebimento, estorno),
 * marcando o que já está em fechamento vigente.
 */
export async function commissionReport(ctx: Ctx, q: CommissionQuery): Promise<CommissionReport> {
  guard(ctx);
  assert(DATE_RE.test(q.from ?? "") && DATE_RE.test(q.to ?? ""), "Informe o período (de/até).");
  assert(q.from <= q.to, "A data inicial deve ser anterior à final.");
  assert(diffDays(q.from, q.to) + 1 <= MAX_PERIOD_DAYS, `Período máximo de ${MAX_PERIOD_DAYS} dias.`);
  const base: CommissionBase = q.base === "received" || q.base === "invoiced" ? q.base : await commissionBaseSetting(ctx.store, ctx.companyId, q.branchId ?? ctx.branchId);
  const branchIds = await branchScope(ctx, q.branchId);
  const inScope = (b: string | null | undefined) => !branchIds || (b != null && branchIds.includes(b));
  const scope = { companyId: ctx.companyId, branchIds, from: q.from, to: q.to };
  const facts = await loadFacts(ctx.store, scope);
  const wantSeller = (id: string | null) => Boolean(id) && (!q.sellerId || id === q.sellerId);

  const lines: Array<CommissionLine & { sellerId: string }> = [];
  const sellers = new Map<string, Doc | null>();
  const sellerDoc = async (id: string) => {
    if (!sellers.has(id)) sellers.set(id, await ctx.store.get("users", id));
    return sellers.get(id) ?? null;
  };
  const customerName = (s: Doc | undefined | null) => s?.customerSnapshot?.name ?? null;

  // itens das vendas do período (vêm dos fatos) e das vendas de origem de devoluções/recebimentos
  const itemsBySale = new Map<string, Doc[]>();
  const loadItems = async (saleIds: string[]) => {
    const missing = saleIds.filter((id) => !itemsBySale.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const rows = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", missing.slice(i, i + 100)]] });
      for (const id of missing.slice(i, i + 100)) itemsBySale.set(id, []);
      for (const r of rows) itemsBySale.get(r.saleId)!.push(r);
    }
  };

  if (base === "invoiced") {
    // vendas concluídas no período
    const saleById = new Map(facts.sales.map((s) => [s.id, s]));
    await loadItems(facts.sales.map((s) => s.id));
    for (const sale of facts.sales) {
      const sid = sellerOfSale(sale);
      if (!wantSeller(sid)) continue;
      const seller = await sellerDoc(sid!);
      const fc = fullCommission(itemsBySale.get(sale.id) ?? [], seller);
      lines.push({
        sellerId: sid!, key: `sale:${sale.id}`, kind: "sale", saleId: sale.id, saleNumber: sale.number ?? null, docNumber: null, date: formatDateKey(sale.completedAt),
        branchId: sale.branchId ?? null, customerName: customerName(sale), base: fc.base, rateBps: effRate(fc.amount, fc.base), amount: fc.amount, note: null, closedIn: null,
      });
    }
    // devoluções com movimento no período (abatem a comissão do item devolvido, proporcional à quantidade)
    const retLines = facts.lines.filter((l) => l.kind === "return");
    const originItems = await byIds(ctx.store, "sale_items", retLines.map((l) => l.saleItemId));
    const byReturn = new Map<string, typeof retLines>();
    for (const l of retLines) byReturn.set(l.docId, [...(byReturn.get(l.docId) ?? []), l]);
    for (const [retId, ls] of byReturn) {
      const sale = facts.originSales.get(ls[0].saleId) ?? saleById.get(ls[0].saleId);
      if (!sale || sale.status === "cancelled") continue;
      const sid = sellerOfSale(sale);
      if (!wantSeller(sid)) continue;
      const seller = await sellerDoc(sid!);
      let b = 0;
      let amt = 0;
      for (const l of ls) {
        const it = l.saleItemId ? originItems.get(l.saleItemId) : null;
        if (!it || !it.qty) continue;
        const ib = itemBase(it);
        b += roundDiv(ib * l.qty, it.qty);
        amt += roundDiv(ib * l.qty * sellerRateFor(seller, it.categoryId), it.qty * 10000);
      }
      if (!b && !amt) continue;
      const ret = facts.returns.get(retId);
      lines.push({
        sellerId: sid!, key: `return:${retId}`, kind: "return", saleId: sale.id, saleNumber: sale.number ?? null, docNumber: ret?.number ?? ls[0].docNumber ?? null, date: ls[0].date,
        branchId: ls[0].branchId ?? null, customerName: customerName(sale), base: -b, rateBps: effRate(amt, b), amount: -amt, note: "Proporcional à quantidade devolvida", closedIn: null,
      });
    }
  } else {
    // à vista: pagamentos não diferidos das vendas concluídas no período
    await loadItems(facts.sales.map((s) => s.id));
    const pays = facts.sales.length ? await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", facts.sales.map((s) => s.id)]] }) : [];
    const immediateBySale = new Map<string, number>();
    for (const p of pays) if (!DEFERRED_KINDS.includes(p.methodKind)) immediateBySale.set(p.saleId, (immediateBySale.get(p.saleId) ?? 0) + (p.amount ?? 0));
    for (const sale of facts.sales) {
      const sid = sellerOfSale(sale);
      if (!wantSeller(sid)) continue;
      const amtIn = Math.min(sale.total ?? 0, immediateBySale.get(sale.id) ?? 0);
      if (amtIn <= 0 || !sale.total) continue;
      const seller = await sellerDoc(sid!);
      const fc = fullCommission(itemsBySale.get(sale.id) ?? [], seller);
      const amount = roundDiv(fc.amount * amtIn, sale.total);
      lines.push({
        sellerId: sid!, key: `receipt:${sale.id}:avista`, kind: "receipt", saleId: sale.id, saleNumber: sale.number ?? null, docNumber: null,
        date: formatDateKey(sale.completedAt), branchId: sale.branchId ?? null, customerName: customerName(sale),
        base: amtIn, rateBps: effRate(amount, amtIn), amount, note: amtIn < sale.total ? `À vista (de ${formatMoney(sale.total)})` : "À vista", closedIn: null,
      });
    }
    // a prazo: baixas ativas no período em títulos de venda (e renegociações), limitadas ao total da venda
    const settled = (await listAll(ctx.store, "settlements", { filters: [["eq", "companyId", ctx.companyId], ["gte", "date", q.from], ["lte", "date", q.to]] })).filter(
      (s) => s.status === "active" && (s.kind ?? "settlement") === "settlement",
    );
    const titles = await byIds(ctx.store, "titles", settled.map((s) => s.titleId));
    // raiz (venda) de cada título, subindo as renegociações
    const rootSale = new Map<string, string | null>();
    const resolveRoot = async (t: Doc | undefined, depth = 0): Promise<string | null> => {
      if (!t || depth > 20) return null;
      if (rootSale.has(t.id)) return rootSale.get(t.id)!;
      let r: string | null = null;
      if (t.kind === "receivable" && t.originType === "sale") r = t.originId ?? null;
      else if (t.kind === "receivable" && t.originType === "renegotiation" && t.originId) r = await resolveRoot(titles.get(t.originId) ?? (await ctx.store.get("titles", t.originId)) ?? undefined, depth + 1);
      rootSale.set(t.id, r);
      return r;
    };
    const saleIds = new Set<string>();
    for (const s of settled) {
      const r = await resolveRoot(titles.get(s.titleId));
      if (r) saleIds.add(r);
    }
    const salesMap = await byIds(ctx.store, "sales", [...saleIds]);
    const targetSales = [...salesMap.values()].filter((s) => s.status === "completed" && inScope(s.branchId) && wantSeller(sellerOfSale(s)));
    await loadItems(targetSales.map((s) => s.id));
    const allPays = targetSales.length ? await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", targetSales.map((s) => s.id)]] }) : [];
    for (const sale of targetSales) {
      const sid = sellerOfSale(sale)!;
      const seller = await sellerDoc(sid);
      const fc = fullCommission(itemsBySale.get(sale.id) ?? [], seller);
      const total = sale.total ?? 0;
      if (total <= 0) continue;
      const chain = await saleTitleChain(ctx.store, sale.id, ["sale"]);
      const chainIds = chain.filter((t) => t.kind === "receivable").map((t) => t.id);
      const all = chainIds.length ? (await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", chainIds]] })).filter((s) => s.status === "active" && (s.kind ?? "settlement") === "settlement") : [];
      all.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
      let cum = allPays.filter((p) => p.saleId === sale.id && !DEFERRED_KINDS.includes(p.methodKind)).reduce((a, p) => a + (p.amount ?? 0), 0);
      for (const st of all) {
        const principal = st.principal ?? 0;
        const eff = Math.min(total, cum + principal) - Math.min(total, cum);
        cum += principal;
        if (st.date < q.from || st.date > q.to || eff <= 0) continue;
        const amount = roundDiv(fc.amount * eff, total);
        lines.push({
          sellerId: sid, key: `receipt:${st.id}`, kind: "receipt", saleId: sale.id, saleNumber: sale.number ?? null, docNumber: null, date: st.date, branchId: sale.branchId ?? null,
          customerName: customerName(sale), base: eff, rateBps: effRate(amount, eff), amount, note: "Parcela recebida", closedIn: null,
        });
      }
    }
    // devoluções no período: abatem a parte reembolsada/creditada ao cliente
    const retIds = [...new Set(facts.lines.filter((l) => l.kind === "return").map((l) => l.docId))];
    for (const retId of retIds) {
      const ret = facts.returns.get(retId);
      const first = facts.lines.find((l) => l.kind === "return" && l.docId === retId)!;
      const sale = facts.originSales.get(first.saleId);
      if (!ret || !sale || sale.status === "cancelled" || !sale.total) continue;
      const sid = sellerOfSale(sale);
      if (!wantSeller(sid)) continue;
      const compensated = ret.compensatedAmount ?? ret.itemsTotal ?? 0;
      if (compensated <= 0) continue;
      await loadItems([sale.id]);
      const fc = fullCommission(itemsBySale.get(sale.id) ?? [], await sellerDoc(sid!));
      const amount = roundDiv(fc.amount * compensated, sale.total);
      lines.push({
        sellerId: sid!, key: `return:${retId}`, kind: "return", saleId: sale.id, saleNumber: sale.number ?? null, docNumber: ret.number ?? null, date: first.date, branchId: first.branchId ?? null,
        customerName: customerName(sale), base: -compensated, rateBps: effRate(amount, compensated), amount: -amount, note: "Valor reembolsado/creditado ao cliente", closedIn: null,
      });
    }
  }

  // fechamentos vigentes: eventos já fechados e estornos de vendas canceladas no período
  const closings = await loadClosings(ctx, { sellerId: q.sellerId ?? null });
  const closedKeys = new Map<string, { titleId: string; number: number }>();
  const closedBySale = new Map<string, { amount: number; base: number; sellerId: string; branchId: string | null; saleNumber: number | null; customerName: string | null }>();
  const otherBaseSales = new Map<string, { titleId: string; number: number }>();
  for (const t of closings) {
    const d = t.commissionDetail ?? {};
    for (const l of (d.lines ?? []) as Array<Record<string, any>>) {
      closedKeys.set(l.key, { titleId: t.id, number: t.number });
      const cur = closedBySale.get(l.saleId) ?? { amount: 0, base: 0, sellerId: d.sellerId ?? t.partyId, branchId: l.branchId ?? null, saleNumber: l.saleNumber ?? null, customerName: l.customerName ?? null };
      cur.amount += l.amount ?? 0;
      cur.base += l.base ?? 0;
      closedBySale.set(l.saleId, cur);
      if ((d.base ?? "invoiced") !== base && l.kind !== "cancel") otherBaseSales.set(l.saleId, { titleId: t.id, number: t.number });
    }
  }
  const { start, end } = dayRange(q.from, q.to);
  const cancelledNow = (await listAll(ctx.store, "sales", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", "cancelled"], ["gte", "cancelledAt", start], ["lt", "cancelledAt", end]] })).filter((s) => inScope(s.branchId));
  for (const sale of cancelledNow) {
    const c = closedBySale.get(sale.id);
    if (!c || (!c.amount && !c.base)) continue;
    const sid = sellerOfSale(sale) ?? c.sellerId;
    if (!wantSeller(sid)) continue;
    lines.push({
      sellerId: sid!, key: `cancel:${sale.id}`, kind: "cancel", saleId: sale.id, saleNumber: sale.number ?? null, docNumber: null, date: formatDateKey(sale.cancelledAt),
      branchId: sale.branchId ?? null, customerName: customerName(sale), base: -c.base, rateBps: effRate(c.amount, c.base), amount: -c.amount, note: "Comissão já fechada estornada", closedIn: null,
    });
  }
  for (const l of lines) {
    const k = closedKeys.get(l.key);
    if (k) l.closedIn = k;
    else if (l.kind !== "cancel" && otherBaseSales.has(l.saleId)) l.closedIn = { ...otherBaseSales.get(l.saleId)!, otherBase: true };
  }

  // agrupa por vendedor
  const groups = new Map<string, CommissionLine[]>();
  for (const { sellerId, ...l } of lines) groups.set(sellerId, [...(groups.get(sellerId) ?? []), l]);
  if (q.sellerId && !groups.has(q.sellerId)) groups.set(q.sellerId, []);
  const exactClosings = closings.filter((t) => {
    const d = t.commissionDetail ?? {};
    return d.from === q.from && d.to === q.to && (d.branchId ?? null) === (q.branchId ?? null);
  });
  const out: SellerCommission[] = [];
  for (const [sid, ls] of groups) {
    const seller = await sellerDoc(sid);
    // quem vendeu sem percentual cadastrado (ex.: operador de caixa) e não tem nada fechado não entra na apuração
    const configured = seller?.commissionBps != null || Object.keys(seller?.commissionByCategory ?? {}).length > 0;
    if (!configured && sid !== q.sellerId && ls.every((l) => !l.amount && !l.closedIn)) continue;
    ls.sort((a, b) => a.date.localeCompare(b.date) || (a.saleNumber ?? 0) - (b.saleNumber ?? 0) || a.key.localeCompare(b.key));
    const open = ls.filter((l) => !l.closedIn);
    const exact = exactClosings.find((t) => t.partyId === sid);
    out.push({
      sellerId: sid, sellerName: seller?.name ?? "Vendedor removido", loginDisabled: Boolean(seller?.loginDisabled), rateBps: seller?.commissionBps ?? null,
      hasCategoryRates: Object.keys(seller?.commissionByCategory ?? {}).length > 0, lines: ls,
      openBase: open.reduce((a, l) => a + l.base, 0), openAmount: open.reduce((a, l) => a + l.amount, 0), closedAmount: ls.filter((l) => l.closedIn && !l.closedIn.otherBase).reduce((a, l) => a + l.amount, 0),
      closing: exact ? closingOf(exact) : null,
    });
  }
  out.sort((a, b) => a.sellerName.localeCompare(b.sellerName, "pt-BR"));
  return {
    from: q.from, to: q.to, branchId: q.branchId ?? null, base, sellers: out,
    totals: { openBase: out.reduce((a, s) => a + s.openBase, 0), openAmount: out.reduce((a, s) => a + s.openAmount, 0), closedAmount: out.reduce((a, s) => a + s.closedAmount, 0) },
  };
}

const formatDateKey = (iso: string | null | undefined) => (iso ? toLocalDate(iso) : today());

/** Chave do fechamento (período + filial + vendedor). */
export const closingKey = (companyId: string, sellerId: string, branchId: string | null, from: string, to: string) => detId("commission", companyId, sellerId, branchId ?? "*", from, to);

export interface CloseCommissionInput extends CommissionQuery {
  sellerId: string;
  /** vencimento do título a pagar */
  dueDate: string;
  notes?: string | null;
}

/** Categoria financeira de despesa "Comissões…" da empresa, se cadastrada. */
async function commissionCategory(ctx: Ctx): Promise<string | null> {
  const cats = await listAll(ctx.store, "fin_categories", { filters: [["eq", "companyId", ctx.companyId], ["eq", "type", "expense"]] });
  return cats.find((c) => c.active !== false && /comiss/i.test(c.name ?? ""))?.id ?? null;
}

/**
 * Fecha a apuração do vendedor no período: gera o título a pagar (finance.createTitle, origem "commission") com a
 * memória de cálculo. Idempotente por período + filial + vendedor: repetir a confirmação concorrente devolve o mesmo
 * título; um fechamento vigente do mesmo recorte recusa o segundo.
 */
export async function closeCommission(ctx: Ctx, input: CloseCommissionInput): Promise<Doc> {
  guard(ctx);
  assert(input.sellerId, "Escolha o vendedor.");
  assert(DATE_RE.test(input.dueDate ?? ""), "Informe o vencimento do pagamento da comissão.");
  const branchId = input.branchId ?? null;
  const originId = closingKey(ctx.companyId, input.sellerId, branchId, input.from, input.to);
  const previous = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "commission"], ["eq", "originId", originId]] })).filter((t) => t.companyId === ctx.companyId);
  const live = previous.find((t) => t.status !== "cancelled");
  if (live) throw new BusinessError(`A comissão deste vendedor no período já foi fechada (título a pagar nº ${live.number}). Para refazer, reabra o fechamento.`, "already_closed");
  const report = await commissionReport(ctx, { ...input, branchId });
  const sc = report.sellers.find((s) => s.sellerId === input.sellerId);
  const open = (sc?.lines ?? []).filter((l) => !l.closedIn);
  const total = open.reduce((a, l) => a + l.amount, 0);
  assert(open.length > 0, "Não há comissão a fechar para este vendedor no período.", "nothing_to_close");
  assert(total > 0, `O saldo de comissão do período é ${formatMoney(total)}: não há valor a pagar. Amplie o período para compensar as devoluções/estornos.`, "nothing_to_close");
  const seller = await ctx.store.get("users", input.sellerId);
  const sellerName = seller?.name ?? sc!.sellerName;
  const idemKey = `commission:${originId}:${previous.length}`;
  const id = titleIdOf(idemKey);
  const existing = await ctx.store.get("titles", id);
  if (existing) return existing;
  const branchName = branchId ? ((await ctx.store.get("branches", branchId))?.name ?? null) : null;
  const detail = {
    version: 1, base: report.base, from: input.from, to: input.to, branchId, branchName, sellerId: input.sellerId, sellerName, rateBps: seller?.commissionBps ?? null,
    commissionByCategory: seller?.commissionByCategory ?? null, dueDate: input.dueDate, closedBy: ctx.user.id, closedByName: ctx.user.name,
    totals: { base: open.reduce((a, l) => a + l.base, 0), amount: total },
    lines: open.map((l) => ({ key: l.key, kind: l.kind, saleId: l.saleId, saleNumber: l.saleNumber, docNumber: l.docNumber, date: l.date, branchId: l.branchId, customerName: l.customerName, base: l.base, rateBps: l.rateBps, amount: l.amount, note: l.note })),
  };
  const description = `Comissão — ${sellerName} — ${formatDate(input.from)} a ${formatDate(input.to)}${branchName ? ` (${branchName})` : ""}`;
  const categoryId = await commissionCategory(ctx);
  let title: Doc;
  try {
    title = await ctx.store.transaction(async (t) => {
      const created = await createTitle(
        ctx,
        {
          kind: "payable", partyType: "other", partyId: input.sellerId, partyName: sellerName, description: description.slice(0, 300), documentNumber: null,
          originType: "commission", originId, issueDate: today(), competenceDate: input.to, categoryId, installments: [{ dueDate: input.dueDate, amount: total }],
          notes: [`Apuração: ${COMMISSION_BASE_LABEL[report.base]}; ${open.length} evento(s).`, input.notes ?? ""].filter(Boolean).join("\n"), idemKey, branchId: branchId ?? ctx.branchId,
        },
        t,
      );
      await t.update("titles", created.id, { commissionDetail: detail });
      return created;
    });
  } catch (e) {
    if (isConflict(e)) {
      const again = await ctx.store.get("titles", id);
      if (again) return again;
    }
    throw e;
  }
  const saved = (await ctx.store.get("titles", id)) ?? title;
  await audit(ctx, {
    module: "sales", action: "commission.close", entityType: "title", entityId: id,
    summary: `Comissão fechada: ${sellerName}, ${formatDate(input.from)} a ${formatDate(input.to)} — ${formatMoney(total)} (título a pagar nº ${saved.number})`,
    after: { total, base: report.base, events: open.length, dueDate: input.dueDate, branchId }, related: [`commissions:${ctx.companyId}`, `user:${input.sellerId}`, `commission:${originId}`],
    branchId,
  });
  return saved;
}

/** Reabre um fechamento: cancela o título a pagar (somente em aberto, sem baixa). Os eventos voltam à apuração. */
export async function reopenCommission(ctx: Ctx, titleId: string, reason: string): Promise<Doc> {
  guard(ctx);
  assert(reason?.trim(), "Informe o motivo da reabertura.");
  const t = await ctx.store.get("titles", titleId);
  assert(t && t.companyId === ctx.companyId && t.originType === "commission", "Fechamento de comissão não encontrado.", "not_found");
  if (t.status === "cancelled") return t;
  assert(t.status === "open" && (t.balance ?? 0) === (t.total ?? 0), `O título nº ${t.number} já tem pagamento registrado: estorne a baixa no Financeiro antes de reabrir.`, "has_settlements");
  const after = await cancelTitle(ctx, titleId, `Reabertura da comissão: ${reason.trim()}`);
  const c = closingOf(t);
  await audit(ctx, {
    module: "sales", action: "commission.reopen", entityType: "title", entityId: titleId,
    summary: `Comissão reaberta: ${c.sellerName}, ${formatDate(c.from)} a ${formatDate(c.to)} (título nº ${t.number} cancelado)`, reason: reason.trim(),
    related: [`commissions:${ctx.companyId}`, `user:${c.sellerId}`, `commission:${t.originId}`], branchId: c.branchId,
  });
  return after;
}

/** Fechamentos que se sobrepõem ao período (ou todos do vendedor), mais recentes primeiro. */
export async function listClosings(ctx: Ctx, opts: { from?: string; to?: string; sellerId?: string | null; includeCancelled?: boolean } = {}): Promise<CommissionClosing[]> {
  guard(ctx);
  const rows = (await loadClosings(ctx, { sellerId: opts.sellerId, includeCancelled: opts.includeCancelled ?? true })).map(closingOf);
  const fullAccess = hasAllBranches(ctx.user);
  return rows
    .filter((c) => (!opts.from || c.to >= opts.from) && (!opts.to || c.from <= opts.to))
    .filter((c) => fullAccess || (c.branchId != null && (ctx.user.branchIds ?? []).includes(c.branchId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Fechamento com a memória de cálculo (tela de detalhe/impressão). */
export async function closingDetail(ctx: Ctx, titleId: string) {
  guard(ctx);
  const t = await ctx.store.get("titles", titleId);
  if (!t || t.companyId !== ctx.companyId || t.originType !== "commission") return null;
  const c = closingOf(t);
  if (!hasAllBranches(ctx.user) && !(c.branchId && (ctx.user.branchIds ?? []).includes(c.branchId))) return null;
  return { title: t, closing: c, lines: ((t.commissionDetail?.lines ?? []) as CommissionLine[]).map((l) => ({ ...l, closedIn: null })) };
}
