import "server-only";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { addDays, diffDays, monthEnd, monthStart, today } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { cardFeeByInstallment, dueState, liveRenegotiationsOf, type TitleKind } from "@/domain/finance";
import { categoryDefaults, categoryFilterValue, computeCashflow, entrySide, isSettlementFeeReversal, methodAccountMap, resolveCategory, type CashflowFilter, type Granularity } from "@/domain/cashflow";
import { roundDiv } from "@/lib/money";

type P = Pick<ListParams, "q" | "f">;

export const ORIGIN_LABEL: Record<string, string> = {
  manual: "Lançamento manual",
  sale: "Venda a prazo",
  sale_card: "Venda no cartão",
  return: "Devolução",
  purchase: "Compra",
  purchase_order: "Pedido de compra",
  receipt: "Recebimento de compra",
  purchase_receipt: "Recebimento de compra",
  service: "Serviço",
  renegotiation: "Renegociação",
};

export const ENTRY_KIND_LABEL: Record<string, string> = {
  receipt: "Recebimento", payment: "Pagamento", transfer_in: "Transferência (entrada)", transfer_out: "Transferência (saída)", fee: "Tarifa/taxa", adjustment: "Ajuste",
  initial: "Saldo inicial", cash_supply: "Suprimento", cash_withdrawal: "Sangria", reversal: "Estorno", card_settlement: "Liquidação de cartão",
};

/** Link para a operação de origem do título. */
export function originHref(t: { originType?: string | null; originId?: string | null }) {
  if (!t.originId) return null;
  if (t.originType === "sale" || t.originType === "sale_card") return `/vendas/${t.originId}`;
  if (t.originType === "return") return `/vendas/devolucoes/${t.originId}`;
  if (t.originType === "receipt" || t.originType === "purchase_receipt") return `/compras/recebimentos/${t.originId}`;
  if (t.originType === "purchase" || t.originType === "purchase_order") return `/compras/pedidos/${t.originId}`;
  if (t.originType === "renegotiation") return `/financeiro/receber/${t.originId}`;
  return null;
}

export function partyHref(t: { partyType?: string | null; partyId?: string | null }) {
  if (!t.partyId) return null;
  if (t.partyType === "customer") return `/clientes/${t.partyId}`;
  if (t.partyType === "supplier") return `/fornecedores/${t.partyId}`;
  return null;
}

/** Filial efetiva da consulta: a do contexto; no consolidado, a escolhida no filtro (ou todas). */
export function branchScope(ctx: Ctx, p: P) {
  return ctx.branchId ?? (p.f.branch || null);
}

async function titlesMap(ctx: Ctx, ids: string[]) {
  const map = new Map<string, Doc>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 100) for (const t of await listAll(ctx.store, "titles", { filters: [["eq", "id", uniq.slice(i, i + 100)]] })) map.set(t.id, t);
  return map;
}

/** Abatimentos de devolução ativos por parcela (a receber): valor total e datas. */
async function abatementsByInstallment(ctx: Ctx) {
  const map = new Map<string, { total: number; dates: string[] }>();
  const list = await listAll(ctx.store, "settlements", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "abatement"], ["eq", "status", "active"]] });
  for (const s of list) {
    const cur = map.get(s.installmentId) ?? { total: 0, dates: [] };
    cur.total += s.principal ?? 0;
    cur.dates.push(s.date);
    map.set(s.installmentId, cur);
  }
  return map;
}

/**
 * Consulta única das listagens de contas a receber/pagar (tela e exportação): uma linha por parcela.
 * Filtros: state (overdue|due_today|upcoming|open|partial|paid|cancelled), dueFrom/dueTo, compFrom/compTo,
 * party, branch (consolidado), category, costCenter, origin, approval (a pagar), method, q;
 * abFrom/abTo (a receber): parcelas com abatimento de devolução no período (detalhamento da competência).
 * "paid" = principal baixado sem os abatimentos; "abated" = abatido por devolução (coluna própria).
 */
export async function queryInstallments(ctx: Ctx, kind: TitleKind, p: P) {
  const t0 = today();
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "kind", kind]];
  const branch = branchScope(ctx, p);
  if (branch) filters.push(["eq", "branchId", branch]);
  const st = p.f.state;
  if (st === "overdue") filters.push(["eq", "status", ["open", "partial"]], ["lt", "dueDate", t0]);
  else if (st === "due_today") filters.push(["eq", "status", ["open", "partial"]], ["eq", "dueDate", t0]);
  else if (st === "upcoming") filters.push(["eq", "status", ["open", "partial"]], ["gt", "dueDate", t0]);
  else if (st === "open") filters.push(["eq", "status", ["open", "partial"]]);
  else if (st === "partial") filters.push(["eq", "status", "partial"]);
  else if (st === "paid") filters.push(["eq", "status", "paid"]);
  else if (st === "cancelled") filters.push(["eq", "status", "cancelled"]);
  else filters.push(["ne", "status", "cancelled"]);
  if (p.f.dueFrom) filters.push(["gte", "dueDate", p.f.dueFrom]);
  if (p.f.dueTo) filters.push(["lte", "dueDate", p.f.dueTo]);
  if (p.f.compFrom) filters.push(["gte", "competenceDate", p.f.compFrom]);
  if (p.f.compTo) filters.push(["lte", "competenceDate", p.f.compTo]);
  if (p.f.party) filters.push(["eq", "partyId", p.f.party]);
  if (p.f.costCenter) filters.push(["eq", "costCenterId", p.f.costCenter]);
  if (p.f.method) filters.push(["eq", "methodKind", p.f.method]);
  if (p.f.title) filters.push(["eq", "titleId", p.f.title]);
  const allInsts = await listAll(ctx.store, "installments", { filters, orderBy: [{ field: "dueDate", dir: "asc" }] });
  // abatimentos de devolução (a receber): baixa sem dinheiro — fica fora do "recebido" e dos descontos, em coluna própria
  const abated = kind === "receivable" ? await abatementsByInstallment(ctx) : new Map<string, { total: number; dates: string[] }>();
  const abFrom = p.f.abFrom || "";
  const abTo = p.f.abTo || "";
  // detalhamento da competência: parcelas com abatimento no período (abFrom/abTo)
  const insts = abFrom || abTo ? allInsts.filter((i) => (abated.get(i.id)?.dates ?? []).some((d) => (!abFrom || d >= abFrom) && (!abTo || d <= abTo))) : allInsts;
  const titles = await titlesMap(ctx, insts.map((i) => i.titleId));
  const [cats, ccs, branches] = await Promise.all([nameMap(ctx, "fin_categories"), nameMap(ctx, "cost_centers"), nameMap(ctx, "branches")]);
  // categoria efetiva (mesma regra do fluxo de caixa/competência): títulos de venda/compra sem categoria caem na padrão
  const catFilter = categoryFilterValue(p.f.category);
  const defaults = await categoryDefaults(ctx.store, ctx.companyId);
  const q = p.q ? normalizeSearch(p.q) : "";
  const rows = [];
  for (const i of insts) {
    const t = titles.get(i.titleId);
    if (!t) continue;
    if (p.f.origin && t.originType !== p.f.origin) continue;
    // "títulos que compõem a competência": renegociações não entram (receita já reconhecida no título original)
    if (p.f.competence === "1" && (t.originType === "renegotiation" || t.status === "cancelled")) continue;
    const catId = resolveCategory({ categoryId: i.categoryId, kind: "", originType: t.originType }, t, defaults);
    if (catFilter !== undefined && catId !== catFilter) continue;
    if (p.f.approval && kind === "payable" && (t.approvalStatus ?? "pending") !== p.f.approval) continue;
    if (q) {
      const hay = normalizeSearch(`${t.number} ${i.partyName ?? ""} ${i.description ?? ""} ${t.documentNumber ?? ""} ${i.ourNumber ?? ""}`);
      if (!hay.includes(q)) continue;
    }
    const ab = abated.get(i.id)?.total ?? 0;
    rows.push({
      id: i.id,
      titleId: t.id,
      titleNumber: t.number as number,
      ref: `${t.number}/${i.number}`,
      installment: i.number as number,
      installments: t.installmentsCount as number,
      partyName: (i.partyName ?? t.partyName ?? "—") as string,
      partyId: t.partyId as string | null,
      partyType: t.partyType as string | null,
      description: i.description as string,
      documentNumber: t.documentNumber as string | null,
      issueDate: t.issueDate as string,
      competenceDate: i.competenceDate as string,
      dueDate: i.dueDate as string,
      amount: i.amount as number,
      /** principal efetivamente recebido/pago (sem abatimentos de devolução) */
      paid: ((i.paid ?? 0) - ab) as number,
      /** abatido por devolução de mercadoria (sem movimento em conta) */
      abated: ab,
      balance: i.balance as number,
      extras: ((i.interest ?? 0) + (i.fine ?? 0) - ((i.discount ?? 0) - ab)) as number,
      status: i.status as string,
      state: dueState(i, t0),
      daysLate: i.status !== "paid" && i.status !== "cancelled" && i.dueDate < t0 ? Math.round((Date.parse(t0) - Date.parse(i.dueDate)) / 86400000) : 0,
      categoryId: catId,
      category: catId ? (cats.get(catId) ?? "—") : "—",
      costCenter: i.costCenterId ? (ccs.get(i.costCenterId) ?? "—") : "—",
      branch: t.branchId ? (branches.get(t.branchId) ?? "—") : "—",
      originType: t.originType as string,
      origin: ORIGIN_LABEL[t.originType] ?? t.originType,
      originId: t.originId as string | null,
      approvalStatus: (t.approvalStatus ?? null) as string | null,
      methodKind: i.methodKind as string | null,
      ourNumber: i.ourNumber as string | null,
      lastSettlementAt: i.lastSettlementAt as string | null,
    });
  }
  return rows;
}

/** Indicadores fixos da tela (independentes do recorte) com links para as listas filtradas. */
export async function installmentKpis(ctx: Ctx, kind: TitleKind, branch: string | null) {
  const t0 = today();
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "kind", kind], ["eq", "status", ["open", "partial"]]];
  if (branch) filters.push(["eq", "branchId", branch]);
  const open = await listAll(ctx.store, "installments", { filters });
  const sum = (xs: Doc[]) => xs.reduce((a, i) => a + i.balance, 0);
  const overdue = open.filter((i) => i.dueDate < t0);
  const dueToday = open.filter((i) => i.dueDate === t0);
  const next7 = open.filter((i) => i.dueDate > t0 && i.dueDate <= addDays(t0, 7));
  let pendingApproval = { count: 0, amount: 0 };
  if (kind === "payable") {
    const titles = await titlesMap(ctx, open.map((i) => i.titleId));
    const pend = open.filter((i) => (titles.get(i.titleId)?.approvalStatus ?? "pending") === "pending");
    pendingApproval = { count: pend.length, amount: sum(pend) };
  }
  const sf: any[] = [["eq", "companyId", ctx.companyId], ["gte", "date", `${t0.slice(0, 7)}-01`], ["eq", "kind", "settlement"], ["eq", "status", "active"]];
  if (branch) sf.push(["eq", "branchId", branch]);
  const settled = await listAll(ctx.store, "settlements", { filters: sf });
  const settledTitles = await titlesMap(ctx, settled.map((s) => s.titleId));
  const monthSettled = settled.filter((s) => settledTitles.get(s.titleId)?.kind === kind).reduce((a, s) => a + s.total, 0);
  return {
    today: t0,
    open: { count: open.length, amount: sum(open) },
    overdue: { count: overdue.length, amount: sum(overdue) },
    dueToday: { count: dueToday.length, amount: sum(dueToday) },
    next7: { count: next7.length, amount: sum(next7), to: addDays(t0, 7) },
    pendingApproval,
    monthSettled,
  };
}

/** Detalhe do título: parcelas, baixas (com lançamento/conciliação) e anexos. */
export async function titleDetail(ctx: Ctx, id: string) {
  const title = await ctx.store.get("titles", id);
  if (!title || title.companyId !== ctx.companyId) return null;
  const installments = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", id]], orderBy: [{ field: "number", dir: "asc" }] });
  const settlements = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", id]], orderBy: [{ field: "date", dir: "asc" }] });
  const entryIds = settlements.map((s) => s.accountEntryId).filter(Boolean);
  const entries = new Map<string, Doc>();
  for (let i = 0; i < entryIds.length; i += 100) for (const e of await listAll(ctx.store, "account_entries", { filters: [["eq", "id", entryIds.slice(i, i + 100)]] })) entries.set(e.id, e);
  const bankTxBySettlement = new Map<string, Doc>();
  const sIds = settlements.map((s) => s.id);
  for (let i = 0; i < sIds.length; i += 100) for (const b of await listAll(ctx.store, "bank_transactions", { filters: [["eq", "settlementId", sIds.slice(i, i + 100)]] })) bankTxBySettlement.set(b.settlementId, b);
  const [accounts, methods, users, cats, ccs, branches] = await Promise.all([
    nameMap(ctx, "financial_accounts"), nameMap(ctx, "payment_methods"), nameMap(ctx, "users"), nameMap(ctx, "fin_categories"), nameMap(ctx, "cost_centers"), nameMap(ctx, "branches"),
  ]);
  const fileIds = [...new Set([...(title.attachments ?? []).map((a: any) => a.fileId), ...settlements.map((s) => s.attachmentFileId).filter(Boolean)])];
  const files = fileIds.length ? await listAll(ctx.store, "files", { filters: [["eq", "id", fileIds]] }) : [];
  let cardFee = new Map<string, number>();
  if (title.originType === "sale_card") cardFee = await cardFeeByInstallment(ctx.store, [title]);
  // parcela renegociada → título da renegociação (marcador mais recente na sequência da parcela)
  const renegOf = new Map<string, { id: string; number: number }>();
  const marks = settlements.filter((x) => x.kind === "renegotiation" && x.operationId).sort((a, b) => a.seq - b.seq);
  const renegTitles = marks.length ? await titlesMap(ctx, marks.map((m) => m.operationId)) : new Map<string, Doc>();
  for (const m of marks) {
    const nt = renegTitles.get(m.operationId);
    if (nt && nt.companyId === ctx.companyId) renegOf.set(m.installmentId, { id: nt.id, number: nt.number });
  }
  // baixas, estornos e abatimentos de devolução (marcadores de renegociação/cancelamento não são movimentos)
  const moves = settlements.filter((x) => x.kind === "settlement" || x.kind === "reversal" || x.kind === "abatement");
  // principal efetivamente recebido/pago (baixas ativas) separado do abatido por devolução (sem dinheiro)
  const principalSettled = moves.filter((x) => x.kind === "settlement" && x.status === "active").reduce((a, x) => a + (x.principal ?? 0), 0);
  const abated = moves.filter((x) => x.kind === "abatement" && x.status === "active").reduce((a, x) => a + (x.principal ?? 0), 0);
  const abatedByInst = new Map<string, number>();
  for (const x of moves) if (x.kind === "abatement" && x.status === "active") abatedByInst.set(x.installmentId, (abatedByInst.get(x.installmentId) ?? 0) + (x.principal ?? 0));
  // renegociações vigentes geradas a partir deste título (bloqueiam o cancelamento) e título de origem de uma renegociação
  const renegChildren = await liveRenegotiationsOf(ctx, id);
  const origin = title.originType === "renegotiation" && title.originId ? await ctx.store.get("titles", title.originId) : null;
  return {
    title, installments, settlements: moves, entries, bankTxBySettlement, accounts, methods, users, cats, ccs, branches, files: new Map(files.map((f) => [f.id, f])), cardFee, renegOf,
    principalSettled, abated, abatedByInst, renegChildren, origin: origin && origin.companyId === ctx.companyId ? origin : null,
  };
}

/** Lançamentos que compõem os números do fluxo de caixa (mesma classificação de computeCashflow). */
export async function queryCashflowEntries(ctx: Ctx, p: P) {
  const from = p.f.from || `${today().slice(0, 7)}-01`;
  const to = p.f.to || today();
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["between", "date", from, to]];
  if (p.f.account) filters.push(["eq", "accountId", p.f.account]);
  // filial: contas da filial + contas compartilhadas (mesmo critério de computeCashflow)
  const branch = branchScope(ctx, p);
  const scopeAccounts = branch ? new Set((await listAll(ctx.store, "financial_accounts", { filters: [["eq", "companyId", ctx.companyId]] })).filter((a) => !a.branchId || a.branchId === branch).map((a) => a.id)) : null;
  const entries = (await listAll(ctx.store, "account_entries", { filters, orderBy: [{ field: "date", dir: "asc" }] })).filter((e) => !scopeAccounts || scopeAccounts.has(e.accountId));
  const titles = await titlesMap(ctx, entries.map((e) => e.titleId).filter(Boolean));
  const defaults = await categoryDefaults(ctx.store, ctx.companyId);
  const [accounts, cats, ccs] = await Promise.all([nameMap(ctx, "financial_accounts"), nameMap(ctx, "fin_categories"), nameMap(ctx, "cost_centers")]);
  const q = p.q ? normalizeSearch(p.q) : "";
  const rows = [];
  for (const e of entries) {
    const side = entrySide(e);
    if (side === "skip") continue;
    if (p.f.side && p.f.side !== side) continue;
    const title = e.titleId ? titles.get(e.titleId) : null;
    const categoryId = side === "transfer" ? null : resolveCategory(e, title, defaults);
    // transferências não têm categoria e ficam fora do resultado filtrado (mesmo critério de computeCashflow)
    if (p.f.category && (side === "transfer" || categoryId !== categoryFilterValue(p.f.category))) continue;
    const cc = e.costCenterId ?? title?.costCenterId ?? null;
    if (p.f.costCenter && cc !== p.f.costCenter) continue;
    if (p.f.direct === "1" && (e.titleId || e.settlementId) && e.kind !== "fee" && !isSettlementFeeReversal(e)) continue;
    if (q && !normalizeSearch(`${e.description} ${title?.partyName ?? ""} ${title?.number ?? ""}`).includes(q)) continue;
    rows.push({
      id: e.id,
      date: e.date as string,
      seq: e.seq as number,
      accountId: e.accountId as string,
      account: accounts.get(e.accountId) ?? "—",
      description: e.description as string,
      kind: e.kind as string,
      kindLabel: ENTRY_KIND_LABEL[e.kind] ?? e.kind,
      side,
      amount: e.amount as number,
      inflow: side === "in" ? (e.amount as number) : 0,
      outflow: side === "out" ? (e.amount as number) : 0,
      transfer: side === "transfer" ? (e.amount as number) : 0,
      balanceAfter: e.balanceAfter as number,
      categoryId,
      category: categoryId ? (cats.get(categoryId) ?? "—") : side === "transfer" ? "Transferência" : "Sem categoria",
      costCenter: cc ? (ccs.get(cc) ?? "—") : "—",
      titleId: e.titleId as string | null,
      titleKind: title?.kind as string | null,
      titleNumber: title?.number as number | null,
      party: (title?.partyName ?? null) as string | null,
      reconciled: Boolean(e.reconciled),
      reconciliationId: e.reconciliationId as string | null,
      originType: e.originType as string | null,
      originId: e.originId as string | null,
      reversed: Boolean(e.reversedBy),
    });
  }
  return rows;
}

/** Recebíveis de cartão (títulos da adquirente) por previsão de liquidação. */
export async function queryCardReceivables(ctx: Ctx, p: P) {
  const t0 = today();
  const titleFilters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "originType", "sale_card"], ["ne", "status", "cancelled"]];
  const branch = branchScope(ctx, p);
  if (branch) titleFilters.push(["eq", "branchId", branch]);
  const titles = (await listAll(ctx.store, "titles", { filters: titleFilters })).filter((t) => t.status !== "cancelled");
  const fees = await cardFeeByInstallment(ctx.store, titles);
  const tmap = new Map(titles.map((t) => [t.id, t]));
  const insts: Doc[] = [];
  const ids = titles.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 100) insts.push(...(await listAll(ctx.store, "installments", { filters: [["eq", "titleId", ids.slice(i, i + 100)]] })));
  const pays = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 100) for (const sp of await listAll(ctx.store, "sale_payments", { filters: [["eq", "titleId", ids.slice(i, i + 100)]] })) pays.set(sp.titleId, sp);
  const sales = new Map<string, Doc>();
  const saleIds = [...new Set(titles.map((t) => t.originId).filter(Boolean))] as string[];
  for (let i = 0; i < saleIds.length; i += 100) for (const s of await listAll(ctx.store, "sales", { filters: [["eq", "id", saleIds.slice(i, i + 100)]] })) sales.set(s.id, s);
  const settles = new Map<string, Doc[]>();
  const instIds = insts.map((i) => i.id);
  for (let i = 0; i < instIds.length; i += 100)
    for (const s of await listAll(ctx.store, "settlements", { filters: [["eq", "installmentId", instIds.slice(i, i + 100)], ["eq", "kind", "settlement"], ["eq", "status", "active"]] })) settles.set(s.installmentId, [...(settles.get(s.installmentId) ?? []), s]);
  const rows = [];
  for (const i of insts) {
    const t = tmap.get(i.titleId)!;
    const pay = pays.get(t.id);
    const st = i.status === "paid" ? "settled" : i.dueDate < t0 ? "late" : i.dueDate === t0 ? "today" : "scheduled";
    if (p.f.status === "open" && i.status === "paid") continue;
    if (p.f.status === "settled" && i.status !== "paid") continue;
    if (p.f.status === "late" && st !== "late") continue;
    if (p.f.from && i.dueDate < p.f.from) continue;
    if (p.f.to && i.dueDate > p.f.to) continue;
    if (p.f.kind && i.methodKind !== p.f.kind) continue;
    const fee = fees.get(i.id) ?? 0;
    const s = settles.get(i.id) ?? [];
    const sale = t.originId ? sales.get(t.originId) : null;
    rows.push({
      id: i.id,
      titleId: t.id,
      saleId: t.originId as string | null,
      saleNumber: (sale?.number ?? null) as number | null,
      saleDate: t.issueDate as string,
      method: (pay?.methodName ?? t.partyName ?? "Cartão") as string,
      methodId: (pay?.methodId ?? null) as string | null,
      kind: i.methodKind as string,
      brand: (pay?.cardBrand ?? null) as string | null,
      nsu: (pay?.nsu ?? t.documentNumber ?? null) as string | null,
      installment: `${i.number}/${t.installmentsCount}`,
      expectedDate: i.dueDate as string,
      gross: i.amount as number,
      expectedFee: fee,
      expectedNet: (i.amount - fee) as number,
      openGross: i.balance as number,
      openFee: roundDiv(fee * i.balance, Math.max(1, i.amount)),
      settledGross: s.reduce((a, x) => a + x.principal, 0),
      settledFee: s.reduce((a, x) => a + (x.fee ?? 0), 0),
      settledNet: s.reduce((a, x) => a + x.total - (x.fee ?? 0), 0),
      settledAt: (i.lastSettlementAt ?? null) as string | null,
      status: st,
      branchId: t.branchId as string | null,
    });
  }
  rows.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  return rows;
}

/** Linhas de extrato/retorno importadas (listagem e exportação). */
export async function queryBankTransactions(ctx: Ctx, p: P) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.account) filters.push(["eq", "accountId", p.f.account]);
  if (p.f.import) filters.push(["eq", "importId", p.f.import]);
  if (p.f.from) filters.push(["gte", "date", p.f.from]);
  if (p.f.to) filters.push(["lte", "date", p.f.to]);
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.kind) filters.push(["eq", "kind", p.f.kind === "collection" ? ["collection", "collection_fee"] : p.f.kind]);
  const txs = await listAll(ctx.store, "bank_transactions", { filters, orderBy: [{ field: "date", dir: "asc" }] });
  const accounts = await nameMap(ctx, "financial_accounts");
  const q = p.q ? normalizeSearch(p.q) : "";
  return txs
    .filter((t) => !q || normalizeSearch(`${t.description} ${t.docNumber ?? ""} ${t.ourNumber ?? ""} ${t.yourNumber ?? ""}`).includes(q))
    .map((t) => ({ ...t, account: accounts.get(t.accountId) ?? "—" })) as Array<Doc & { account: string }>;
}

/** Extrato interno de uma conta (todas as filiais; inclui marcadores de saldo inicial). */
export async function queryAccountEntries(ctx: Ctx, accountId: string, p: P) {
  const filters: any[] = [["eq", "accountId", accountId]];
  if (p.f.from) filters.push(["gte", "date", p.f.from]);
  if (p.f.to) filters.push(["lte", "date", p.f.to]);
  const entries = await listAll(ctx.store, "account_entries", { filters, orderBy: [{ field: "seq", dir: "asc" }] });
  const titles = await titlesMap(ctx, entries.map((e) => e.titleId).filter(Boolean));
  const defaults = await categoryDefaults(ctx.store, ctx.companyId);
  const cats = await nameMap(ctx, "fin_categories");
  const q = p.q ? normalizeSearch(p.q) : "";
  return entries
    .filter((e) => e.companyId === ctx.companyId)
    .filter((e) => (p.f.reconciled === "no" ? !e.reconciled && e.kind !== "initial" : p.f.reconciled === "yes" ? e.reconciled : true))
    .filter((e) => !q || normalizeSearch(e.description ?? "").includes(q))
    .map((e) => {
      const title = e.titleId ? titles.get(e.titleId) : null;
      const side = entrySide(e);
      const categoryId = side === "transfer" || side === "skip" ? null : resolveCategory(e, title, defaults);
      return {
        id: e.id, seq: e.seq as number, date: e.date as string, description: e.description as string, kind: e.kind as string, kindLabel: ENTRY_KIND_LABEL[e.kind] ?? e.kind, side,
        amount: e.amount as number, balanceAfter: e.balanceAfter as number, reconciled: Boolean(e.reconciled), reconciliationId: e.reconciliationId as string | null,
        titleId: e.titleId as string | null, titleKind: (title?.kind ?? null) as string | null, titleNumber: (title?.number ?? null) as number | null, settlementId: e.settlementId as string | null,
        category: categoryId ? (cats.get(categoryId) ?? "—") : "—", originType: e.originType as string | null, originId: e.originId as string | null,
        reversedBy: e.reversedBy as string | null, reversalOf: e.reversalOf as string | null, transferId: e.transferId as string | null,
      };
    });
}

// ───────────────────────────── Fluxo de caixa: filtro e movimentações (realizadas + previstas)

export const CASHFLOW_PRESETS = [
  { value: "month", label: "Mês da data de referência" },
  { value: "next7", label: "Próximos 7 dias" },
  { value: "next30", label: "Próximos 30 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "prev_month", label: "Mês anterior" },
  { value: "next90", label: "Próximos 90 dias" },
  { value: "custom", label: "Personalizado (de/até)" },
];

/** Filtro do fluxo de caixa a partir da URL (mesmo critério na tela e na exportação). */
export function cashflowFilter(ctx: Ctx, p: P): CashflowFilter & { preset: string; ref: string } {
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(p.f.ref ?? "") ? p.f.ref : today();
  const preset = p.f.from || p.f.to ? "custom" : p.f.preset || "month";
  let from = monthStart(ref);
  let to = monthEnd(ref);
  if (preset === "next7") [from, to] = [ref, addDays(ref, 6)];
  else if (preset === "next30") [from, to] = [ref, addDays(ref, 29)];
  else if (preset === "next90") [from, to] = [ref, addDays(ref, 89)];
  else if (preset === "last30") [from, to] = [addDays(ref, -29), ref];
  else if (preset === "prev_month") [from, to] = [monthStart(addDays(monthStart(ref), -1)), addDays(monthStart(ref), -1)];
  else if (preset === "custom") [from, to] = [p.f.from || monthStart(ref), p.f.to || monthEnd(ref)];
  if (to < from) [from, to] = [to, from];
  const span = diffDays(from, to);
  let granularity = (["day", "week", "month"].includes(p.f.g) ? p.f.g : span > 62 ? "month" : span > 31 ? "week" : "day") as Granularity;
  if (granularity === "day" && span > 92) granularity = "week";
  return {
    preset, ref, from, to, granularity,
    accountId: p.f.account || p.f.conta || null, // "conta" = contrato de links entre módulos
    categoryId: p.f.category || null,
    costCenterId: p.f.costCenter || null,
    branchId: branchScope(ctx, p),
    includeOverdue: p.f.overdue === "1",
  };
}

/**
 * Movimentações do período: lançamentos realizados (extrato interno) + parcelas previstas em aberto,
 * em ordem cronológica, com saldo acumulado a partir do saldo inicial (quando o recorte permite).
 */
export async function queryCashflowMovements(ctx: Ctx, p: P) {
  const f = cashflowFilter(ctx, p);
  const t0 = today();
  const type = p.f.type || "";
  const status = p.f.status || "";
  const realized = status === "forecast" ? [] : await queryCashflowEntries(ctx, { q: p.q, f: { ...p.f, from: f.from, to: f.to, side: type, branch: f.branchId ?? "", account: f.accountId ?? "" } });
  const rows: Array<{
    id: string; date: string; status: "realized" | "forecast"; description: string; party: string | null; category: string; account: string; accountId: string | null; document: string | null;
    amount: number; side: string; balance: number | null; href: string | null; reconciled: boolean;
  }> = realized.map((e) => ({
    id: e.id, date: e.date, status: "realized", description: e.description, party: e.party, category: e.category, account: e.account, accountId: e.accountId, document: e.titleNumber ? `Título nº ${e.titleNumber}` : null,
    amount: e.amount, side: e.side, balance: null, href: e.titleId ? `/financeiro/${e.titleKind === "payable" ? "pagar" : "receber"}/${e.titleId}` : `/financeiro/contas/${e.accountId}?from=${e.date}&to=${e.date}`, reconciled: e.reconciled,
  }));
  if (!f.accountId && status !== "realized" && type !== "transfer") {
    const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "status", ["open", "partial"]], ["lte", "dueDate", f.to]];
    if (f.branchId) filters.push(["eq", "branchId", f.branchId]);
    // categoria/centro de custo filtrados depois de resolver a categoria efetiva (mesmo critério de computeCashflow)
    const catFilter = categoryFilterValue(f.categoryId);
    const open = await listAll(ctx.store, "installments", { filters });
    const titles = await titlesMap(ctx, open.map((i) => i.titleId));
    const cardTitles = [...titles.values()].filter((t) => t.originType === "sale_card");
    const fees = cardTitles.length ? await cardFeeByInstallment(ctx.store, cardTitles) : new Map<string, number>();
    const [cats, accs] = await Promise.all([nameMap(ctx, "fin_categories"), nameMap(ctx, "financial_accounts")]);
    const mAcc = await methodAccountMap(ctx.store, ctx.companyId);
    const defaults = await categoryDefaults(ctx.store, ctx.companyId);
    const q = p.q ? normalizeSearch(p.q) : "";
    for (const i of open) {
      const t = titles.get(i.titleId);
      if (!t || t.status === "cancelled") continue;
      const overdue = i.dueDate < t0;
      if (overdue && !f.includeOverdue) continue;
      const date = overdue ? t0 : i.dueDate;
      if (date < f.from || date > f.to) continue;
      let value = i.balance;
      if (t.originType === "sale_card") value -= roundDiv((fees.get(i.id) ?? 0) * i.balance, Math.max(1, i.amount));
      const amount = i.kind === "receivable" ? value : -value;
      const side = amount > 0 ? "in" : "out";
      if (type && type !== side) continue;
      const catId = resolveCategory({ categoryId: i.categoryId, kind: "", originType: t.originType }, t, defaults);
      if (catFilter !== undefined && catId !== catFilter) continue;
      if (f.costCenterId && (i.costCenterId ?? t.costCenterId ?? null) !== f.costCenterId) continue;
      if (q && !normalizeSearch(`${i.description} ${i.partyName ?? ""} ${t.documentNumber ?? ""} ${t.number}`).includes(q)) continue;
      const accId = i.kind === "receivable" && i.methodKind ? (mAcc.get(i.methodKind) ?? null) : null;
      rows.push({
        id: `f-${i.id}`, date, status: "forecast", description: `${i.description} — parcela ${i.number}/${t.installmentsCount}${overdue ? ` (vencida em ${i.dueDate.split("-").reverse().join("/")})` : ""}${t.kind === "payable" && t.approvalStatus !== "approved" ? " · a autorizar" : ""}`,
        party: i.partyName ?? t.partyName ?? null, category: catId ? (cats.get(catId) ?? "—") : "Sem categoria", account: accId ? (accs.get(accId) ?? "—") : "Sem conta definida", accountId: accId,
        document: t.documentNumber ? `Doc. ${t.documentNumber}` : `Título nº ${t.number}`, amount, side, balance: null, href: `/financeiro/${t.kind === "payable" ? "pagar" : "receber"}/${t.id}`, reconciled: false,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.status === b.status ? 0 : a.status === "realized" ? -1 : 1));
  // saldo acumulado só faz sentido sem recortes que excluem movimentos (tipo, categoria, centro, busca)
  const canRun = !type && !f.categoryId && !f.costCenterId && !p.q && !status;
  let opening: number | null = null;
  if (canRun) {
    const cf = await computeCashflow(ctx, f);
    opening = cf.openingProjected;
    let run = opening;
    for (const r of rows) {
      if (r.side === "skip") continue;
      run += r.amount;
      r.balance = run;
    }
  }
  return { rows, filter: f, opening };
}
