import { listAll } from "@/lib/db";
import type { Doc, Filter } from "@/lib/db/types";
import { today } from "@/lib/dates";
import { financeSnapshot, fiscalSnapshot, openCashSessions, stockAlerts, type FiscalBucket } from "@/app/(app)/dashboard/queries";
import { queryBalances } from "@/app/(app)/estoque/queries";
import { querySessions } from "@/app/(app)/caixa/queries";
import { installmentKpis } from "@/app/(app)/financeiro/queries";
import { queryOrders } from "@/app/(app)/compras/pedidos/queries";
import { queryReceipts } from "@/app/(app)/compras/recebimentos/queries";
import { PENDING_STATES, cancellations, periodDocuments, rejections, summarize, type FiscalReportFilter } from "@/domain/fiscal/reports";
import { AGING_BUCKETS, computeAging, computeDre } from "@/domain/finance-reports";
import { slugify, storeOfCompany } from "@/domain/ecommerce/common";
import { bankOverview } from "@/domain/ecommerce/bank";
import { monitorCounts } from "@/domain/ecommerce/monitor";
import {
  ACCOUNT_KIND_PT,
  AGING_BUCKET_PT,
  FISCAL_STATUS_PT,
  ORDER_STATUS_PT,
  PURCHASE_STATUS_PT,
  RECEIPT_STATUS_PT,
  STORE_STATUS_PT,
  WAREHOUSE_KIND_PT,
  countValue,
  inUnits,
  periodRange,
  pt,
  sum,
  type TowerRequest,
} from "./common";
import { pageBy } from "./pagination";

/**
 * Blocos operacionais da Torre. Cada número vem da consulta da tela correspondente (mesmo filtro, mesma soma):
 * caixa (`querySessions`, `openCashSessions`), estoque (`queryBalances`, `stockAlerts`), compras (`queryOrders`,
 * `queryReceipts`), financeiro (`installmentKpis`, `financeSnapshot`, `computeAging`, `computeDre`), fiscal
 * (`fiscalSnapshot`, `periodDocuments`/`summarize`, `rejections`, `cancellations`) e comércio digital (pedidos da loja,
 * `bankOverview`, `monitorCounts`). Leitura pura: nada é gravado (ex.: a Torre não expira pedidos pendentes).
 * Convenção dos blocos: `noPeriodo` segue `de`/`ate`; `posicaoAtual` é a situação no momento da consulta.
 */

const MODELS = ["nfce", "nfe", "nfse"] as const;

/** Uma chamada por unidade do filtro (as consultas das telas aceitam uma filial) ou uma só, sem filtro (todas). */
function perUnit<T>(t: TowerRequest<any>, fn: (branchId: string | null) => Promise<T[]>): Promise<T[]> {
  return Promise.all((t.branchIds ?? [null]).map(fn)).then((lists) => lists.flat());
}

// ───────────────────────────── PDV (caixa)

export async function cashBlock(t: TowerRequest<any>) {
  const { from, to } = t.period!;
  const { start, end } = periodRange(t);
  const [rows, open, terminals] = await Promise.all([
    perUnit(t, (b) => querySessions(t.ctx, { q: "", f: { de: from, ate: to, ...(b ? { filial: b } : {}) } })),
    openCashSessions(t.ctx, t.scopeBranchIds),
    listAll(t.store, "terminals", { filters: [["eq", "companyId", t.companyId]] }),
  ]);
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  // a tela lista as sessões ABERTAS no período e as que continuam abertas de antes; no período = abertura no período
  const inPeriod = unique.filter((r) => r.openedAt >= start && r.openedAt < end);
  const closed = inPeriod.filter((r) => r.status === "closed");
  const withDiff = closed.filter((r) => r.hasDiff);
  return {
    noPeriodo: {
      caixasAbertos: inPeriod.length,
      caixasFechados: closed.length,
      caixasComDiferenca: withDiff.length,
      diferencaTotalCentavos: sum(closed, (r) => r.totalDiff),
      sobrasCentavos: sum(closed.filter((r) => r.totalDiff > 0), (r) => r.totalDiff),
      faltasCentavos: sum(closed.filter((r) => r.totalDiff < 0), (r) => r.totalDiff),
    },
    posicaoAtual: {
      caixasEmAberto: open.length,
      caixasAbertosDeDiasAnteriores: open.filter((s) => s.stale).length,
      terminaisAtivos: terminals.filter((x) => x.status === "active" && inUnits(t, x.branchId)).length,
    },
  };
}

// ───────────────────────────── Estoque

async function balances(t: TowerRequest<any>) {
  // `filial=all`: todas as filiais da empresa (o contexto técnico não tem restrição de filial); o filtro de unidades
  // é aplicado sobre as MESMAS linhas da tela de saldos
  return (await queryBalances(t.ctx, { q: "", f: { filial: "all" } })).filter((r) => inUnits(t, r.branchId));
}

export async function stockBlock(t: TowerRequest<any>) {
  const [rows, alerts] = await Promise.all([balances(t), stockAlerts(t.ctx, t.scopeBranchIds)]);
  return {
    posicaoAtual: {
      saldos: rows.length,
      valorCentavos: sum(rows, (r) => r.value),
      fisicoMilesimos: sum(rows, (r) => r.physical),
      reservadoMilesimos: sum(rows, (r) => r.reserved),
      disponivelMilesimos: sum(rows, (r) => r.available),
      emTransitoMilesimos: sum(rows, (r) => r.inTransit),
      abaixoDoMinimo: rows.filter((r) => r.belowMin).length,
      rupturas: alerts.filter((a) => a.available <= 0).length,
      saldosZerados: rows.filter((r) => (r.physical ?? 0) === 0).length,
      saldosNegativos: rows.filter((r) => (r.physical ?? 0) < 0).length,
    },
  };
}

/** Posições por SKU × depósito (cada depósito pertence a uma unidade), paginadas. */
export async function stockPositions(t: TowerRequest<any>) {
  const rows = (await balances(t)).map((r) => ({
    idSaldo: r.id as string,
    idSku: r.skuId as string,
    codigoSku: r.skuCode as string,
    descricaoSku: r.skuName as string,
    idProduto: (r.productId ?? null) as string | null,
    nomeProduto: r.productName as string,
    idCategoria: (r.categoryId ?? null) as string | null,
    produtoAtivo: r.productActive,
    unidadeMedida: (r.unitCode || null) as string | null,
    idUnidade: r.branchId as string,
    idDeposito: r.warehouseId as string,
    nomeDeposito: r.warehouseName as string,
    tipoDeposito: pt(WAREHOUSE_KIND_PT, r.warehouseKind),
    fisicoMilesimos: (r.physical ?? 0) as number,
    reservadoMilesimos: (r.reserved ?? 0) as number,
    disponivelMilesimos: r.available,
    emTransitoMilesimos: (r.inTransit ?? 0) as number,
    aChegarMilesimos: r.incoming,
    minimoMilesimos: (r.minQty ?? 0) as number,
    custoMedioCentavos: (r.avgCost ?? 0) as number,
    valorCentavos: r.value,
    abaixoDoMinimo: r.belowMin,
    ultimoMovimentoEm: (r.lastMovementAt ?? null) as string | null,
  }));
  const page = pageBy(rows, (r) => [r.codigoSku, r.idUnidade, r.idDeposito, r.idSaldo], ["asc", "asc", "asc", "asc"], t.page!);
  return {
    ...page,
    totais: {
      saldos: rows.length,
      valorCentavos: sum(rows, (r) => r.valorCentavos),
      fisicoMilesimos: sum(rows, (r) => r.fisicoMilesimos),
      reservadoMilesimos: sum(rows, (r) => r.reservadoMilesimos),
      disponivelMilesimos: sum(rows, (r) => r.disponivelMilesimos),
      abaixoDoMinimo: rows.filter((r) => r.abaixoDoMinimo).length,
    },
  };
}

// ───────────────────────────── Compras

function byStatusList<T extends Record<string, any>>(rows: T[], map: Record<string, string>, value: (r: T) => number) {
  const out = new Map<string, { situacao: string | null; quantidade: number; valorCentavos: number }>();
  for (const r of rows) {
    const k = String(r.status ?? "");
    const cur = out.get(k) ?? { situacao: pt(map, k), quantidade: 0, valorCentavos: 0 };
    cur.quantidade++;
    cur.valorCentavos += Number(value(r)) || 0;
    out.set(k, cur);
  }
  return [...out.values()].sort((a, b) => String(a.situacao).localeCompare(String(b.situacao)));
}

export async function purchasesBlock(t: TowerRequest<any>, detail = false) {
  const { from, to } = t.period!;
  const { start, end } = periodRange(t);
  const [allOrders, createdOrders, allReceipts] = await Promise.all([
    queryOrders(t.ctx, { q: "", f: {} }),
    queryOrders(t.ctx, { q: "", f: { from, to } }),
    queryReceipts(t.ctx, { q: "", f: {} }),
  ]);
  const ref = today();
  const orders = allOrders.filter((r) => inUnits(t, r.branchId));
  const created = createdOrders.filter((r) => inUnits(t, r.branchId));
  const createdLive = created.filter((r) => r.status !== "cancelled");
  const inReview = orders.filter((r) => r.status === "in_review");
  const open = orders.filter((r) => ["approved", "sent", "partial"].includes(r.status));
  const next7 = open.filter((r) => r.daysToExpected != null && r.daysToExpected >= 0 && r.daysToExpected <= 7);
  const late = open.filter((r) => r.overdue);
  const receivedIn = orders.filter((r) => r.status === "received" && r.updatedAt >= start && r.updatedAt < end);
  const onTime = receivedIn.filter((r) => !r.expectedDate || String(r.updatedAt ?? "").slice(0, 10) <= r.expectedDate);
  const receipts = allReceipts.filter((r) => inUnits(t, r.branchId));
  const confirmedIn = receipts.filter((r) => r.status === "confirmed" && r.confirmedAt && r.confirmedAt >= start && r.confirmedAt < end);
  const drafts = receipts.filter((r) => ["draft", "confirming"].includes(r.status));
  const awaiting = receipts.filter((r) => r.documentStatus === "pending_invoice");
  const awaitingOverdue = awaiting.filter((r) => r.status !== "scheduled" && r.invoiceDueAt && r.invoiceDueAt < ref);
  const block = {
    noPeriodo: {
      pedidosCriados: countValue(createdLive, (r) => r.total),
      pedidosRecebidos: { quantidade: receivedIn.length, noPrazo: onTime.length },
      recebimentosConfirmados: { quantidade: confirmedIn.length, valorDevidoCentavos: sum(confirmedIn, (r) => r.dueTotal), valorFaturadoCentavos: sum(confirmedIn, (r) => r.invoicedTotal) },
    },
    posicaoAtual: {
      aguardandoAprovacao: countValue(inReview, (r) => r.total),
      aReceber: { quantidade: open.length, valorRestanteCentavos: sum(open, (r) => r.remainingValue), atrasados: late.length, previstosProximos7Dias: next7.length },
      recebimentosEmConferencia: { quantidade: drafts.length, valorFaturadoCentavos: sum(drafts, (r) => r.invoicedTotal) },
      recebimentosComDivergencia: receipts.filter((r) => r.divergenceCount > 0).length,
      aguardandoNota: { quantidade: awaiting.length, valorProvisorioCentavos: sum(awaiting, (r) => r.dueTotal), comPrazoVencido: awaitingOverdue.length },
    },
  };
  if (!detail) return block;
  return {
    ...block,
    noPeriodo: { ...block.noPeriodo, pedidosCriadosPorSituacao: byStatusList(created, PURCHASE_STATUS_PT, (r) => r.total) },
    posicaoAtual: {
      ...block.posicaoAtual,
      pedidosPorSituacao: byStatusList(orders, PURCHASE_STATUS_PT, (r) => r.total),
      recebimentosPorSituacao: byStatusList(receipts, RECEIPT_STATUS_PT, (r) => r.dueTotal),
    },
  };
}

// ───────────────────────────── Financeiro

function kpiSum(list: Array<Awaited<ReturnType<typeof installmentKpis>>>, key: "open" | "overdue" | "dueToday" | "next7" | "pendingApproval") {
  return { quantidade: sum(list, (k) => k[key].count), valorCentavos: sum(list, (k) => k[key].amount) };
}

/** Recebido/pago no período: mesma regra de "Recebido/Pago no mês" das contas a receber/pagar, no intervalo de/ate. */
async function settledInPeriod(t: TowerRequest<any>) {
  const { from, to } = t.period!;
  const sf: Filter[] = [["eq", "companyId", t.companyId], ["gte", "date", from], ["lte", "date", to], ["eq", "kind", "settlement"], ["eq", "status", "active"]];
  if (t.branchIds) sf.push(["eq", "branchId", t.branchIds]);
  const settled = await listAll(t.store, "settlements", { filters: sf });
  const ids = [...new Set(settled.map((s) => s.titleId).filter(Boolean))];
  const titles = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 100) for (const x of await listAll(t.store, "titles", { filters: [["eq", "id", ids.slice(i, i + 100)]] })) titles.set(x.id, x);
  const of = (kind: string) => settled.filter((s) => titles.get(s.titleId)?.kind === kind);
  const view = (rows: Doc[]) => ({ quantidadeBaixas: rows.length, valorCentavos: sum(rows, (s) => s.total) });
  return { recebido: view(of("receivable")), pago: view(of("payable")) };
}

async function financeData(t: TowerRequest<any>) {
  const units = t.branchIds ?? [null];
  const [rec, pay, snap, settled] = await Promise.all([
    Promise.all(units.map((b) => installmentKpis(t.ctx, "receivable", b))),
    Promise.all(units.map((b) => installmentKpis(t.ctx, "payable", b))),
    // contas: as das unidades do recorte + as compartilhadas (sem filial), só ativas — "Saldo disponível" do painel
    financeSnapshot(t.ctx, t.scopeBranchIds, !t.branchIds),
    settledInPeriod(t),
  ]);
  return { rec, pay, snap, settled };
}

function financePosition(d: Awaited<ReturnType<typeof financeData>>) {
  const { rec, pay, snap } = d;
  return {
    dataReferencia: rec[0]?.today ?? today(),
    aReceber: { emAberto: kpiSum(rec, "open"), vencido: kpiSum(rec, "overdue"), venceHoje: kpiSum(rec, "dueToday"), proximos7Dias: kpiSum(rec, "next7") },
    aPagar: { emAberto: kpiSum(pay, "open"), vencido: kpiSum(pay, "overdue"), venceHoje: kpiSum(pay, "dueToday"), proximos7Dias: kpiSum(pay, "next7"), aAutorizar: kpiSum(pay, "pendingApproval") },
    saldoContasCentavos: snap.accountsTotal,
  };
}

export async function financeBlock(t: TowerRequest<any>) {
  const d = await financeData(t);
  return { noPeriodo: { recebido: d.settled.recebido, pago: d.settled.pago }, posicaoAtual: financePosition(d) };
}

/** Grupos do DRE fora do resultado (chaves internas) → valores do contrato. */
const DRE_OUTSIDE_PT: Record<string, string> = { __purchases: "compras_mercadorias", __investments: "investimentos", __advances: "adiantamentos_rede" };

export async function financeDetail(t: TowerRequest<any>) {
  const ref = today();
  const [d, agingRec, agingPay, dre] = await Promise.all([
    financeData(t),
    computeAging(t.ctx, { kind: "receivable", ref, branchIds: t.branchIds }),
    computeAging(t.ctx, { kind: "payable", ref, branchIds: t.branchIds }),
    computeDre(t.ctx, { from: t.period!.from, to: t.period!.to, branchIds: t.branchIds }),
  ]);
  const aging = (a: typeof agingRec) => ({
    dataReferencia: a.ref,
    totalCentavos: a.totals.total,
    vencidoCentavos: a.totals.overdue,
    faixas: AGING_BUCKETS.map((b) => ({ faixa: pt(AGING_BUCKET_PT, b.key), valorCentavos: a.totals[b.key], quantidadeParcelas: a.counts[b.key] })),
  });
  const group = (s: { key: string; label: string; total: number }) => ({ grupo: DRE_OUTSIDE_PT[s.key] ?? slugify(s.key).replace(/-/g, "_"), rotulo: s.label, valorCentavos: s.total });
  return {
    noPeriodo: {
      recebido: d.settled.recebido,
      pago: d.settled.pago,
      dre: {
        receitaLiquidaCentavos: dre.subtotals.netRevenue.total,
        lucroBrutoCentavos: dre.subtotals.grossProfit.total,
        resultadoOperacionalCentavos: dre.subtotals.operating.total,
        resultadoCentavos: dre.subtotals.result.total,
        cmvCentavos: dre.check.cmv,
        grupos: dre.sections.map(group),
        foraDoResultado: dre.outside.map(group),
        conferenciaDiferencaCentavos: dre.check.difference,
        itensSemClassificacao: dre.counts.unclassified,
      },
    },
    posicaoAtual: {
      ...financePosition(d),
      aging: { aReceber: aging(agingRec), aPagar: aging(agingPay) },
      contas: d.snap.accounts.map((a) => ({ idConta: a.id, nome: a.name, tipo: pt(ACCOUNT_KIND_PT, a.kind), compartilhada: a.shared, saldoCentavos: a.balance })),
    },
  };
}

// ───────────────────────────── Fiscal

function fiscalFilter(t: TowerRequest<any>, branchId: string | null): FiscalReportFilter {
  return { from: t.period!.from, to: t.period!.to, branchId, model: null, includeSimulated: true };
}

export async function fiscalBlock(t: TowerRequest<any>, detail = false) {
  const [snap, docsAll, rej, canc] = await Promise.all([
    fiscalSnapshot(t.ctx, t.scopeBranchIds, t.period!),
    periodDocuments(t.ctx, fiscalFilter(t, null)),
    perUnit(t, (b) => rejections(t.ctx, fiscalFilter(t, b))),
    perUnit(t, (b) => cancellations(t.ctx, fiscalFilter(t, b))),
  ]);
  const docs = docsAll.filter((d) => inUnits(t, d.branchId));
  const sm = summarize(docs, fiscalFilter(t, null));
  const auth = { quantidade: sum(snap.grid, (g) => g.authorizedCount), valorCentavos: sum(snap.grid, (g) => g.authorizedTotal) };
  const sim = { quantidade: sum(snap.grid, (g) => g.simulatedCount), valorCentavos: sum(snap.grid, (g) => g.simulatedTotal) };
  const pendingIssued = docs.filter((d) => PENDING_STATES.includes(d.status));
  const buckets = (counts: Record<FiscalBucket, number>) => ({ pendentes: counts.pending, processando: counts.processing, rejeitados: counts.rejected });
  const block = {
    noPeriodo: {
      autorizadas: auth,
      simuladas: sim,
      documentosEmitidos: docs.length,
      documentosEmitidosSimulados: sm.simulatedCount,
      faturamentoFiscal: { brutoCentavos: sm.gross, devolucoesCentavos: sm.returns, liquidoCentavos: sm.net, documentos: sm.revenueCount },
      pendentesEntreEmitidos: countValue(pendingIssued, (d) => d.total),
      rejeicoes: rej.length,
      cancelamentos: countValue(canc, (c) => c.total),
    },
    posicaoAtual: {
      pendencias: buckets(snap.totals),
      porModelo: snap.grid.map((g) => ({ modelo: g.model, ...buckets(g.counts) })),
    },
  };
  if (!detail) return block;
  const porModelo = MODELS.map((m) => {
    const ofModel = docs.filter((d) => d.model === m);
    const s = summarize(ofModel, fiscalFilter(t, null));
    const g = snap.grid.find((x) => x.model === m)!;
    return {
      modelo: m,
      autorizadas: { quantidade: g.authorizedCount, valorCentavos: g.authorizedTotal },
      simuladas: { quantidade: g.simulatedCount, valorCentavos: g.simulatedTotal },
      emitidos: ofModel.length,
      porSituacao: Object.entries(s.byStatus)
        .map(([status, v]) => ({ situacao: pt(FISCAL_STATUS_PT, status), quantidade: v.count, valorCentavos: v.total }))
        .sort((a, b) => String(a.situacao).localeCompare(String(b.situacao))),
      faturamentoFiscalBrutoCentavos: s.gross,
      rejeicoes: rej.filter((r) => r.model === m).length,
      cancelamentos: countValue(canc.filter((c) => c.model === m), (c) => c.total),
    };
  });
  return { ...block, noPeriodo: { ...block.noPeriodo, porModelo } };
}

// ───────────────────────────── Comércio digital

const ORDER_STATUSES = ["pending_payment", "paid", "invoiced", "ready_for_pickup", "shipped", "delivered", "cancelled", "return_requested", "returned"];

function ordersByStatus(rows: Doc[]) {
  return ORDER_STATUSES.map((s) => {
    const of = rows.filter((o) => o.status === s);
    return { situacao: pt(ORDER_STATUS_PT, s), quantidade: of.length, valorCentavos: sum(of, (o) => o.total) };
  });
}

/** Pedidos da loja virtual (não entram na base comercial do PDV: RBC-8). */
export async function commerceBlock(t: TowerRequest<any>, detail = false) {
  const st = await storeOfCompany(t.store, t.companyId);
  if (!st) return { lojaCriada: false, situacaoLoja: null, noPeriodo: null, posicaoAtual: null };
  const { start, end } = periodRange(t);
  const within = (v: unknown) => typeof v === "string" && v >= start && v < end;
  const orders = (await listAll(t.store, "online_orders", { filters: [["eq", "companyId", t.companyId], ["eq", "storeId", st.id]] })).filter((o) => inUnits(t, o.branchId));
  const created = orders.filter((o) => within(o.createdAt));
  const createdLive = created.filter((o) => o.status !== "cancelled");
  const paid = orders.filter((o) => within(o.paidAt) && o.status !== "cancelled");
  const cancelled = orders.filter((o) => o.status === "cancelled" && within(o.cancelledAt));
  const count = (...s: string[]) => orders.filter((o) => s.includes(o.status)).length;
  const block = {
    lojaCriada: true,
    situacaoLoja: pt(STORE_STATUS_PT, st.status ?? "draft"),
    noPeriodo: {
      pedidosCriados: countValue(createdLive, (o) => o.total),
      pedidosPagos: { quantidade: paid.length, valorCentavos: sum(paid, (o) => o.total), freteCentavos: sum(paid, (o) => o.shippingAmount), descontosCentavos: sum(paid, (o) => o.discount) },
      pedidosCancelados: countValue(cancelled, (o) => o.total),
      porSituacao: ordersByStatus(created),
    },
    posicaoAtual: {
      aguardandoPagamento: count("pending_payment"),
      aFaturar: count("paid"),
      aExpedirOuRetirar: count("invoiced", "ready_for_pickup"),
      devolucoesSolicitadas: count("return_requested"),
    },
  };
  if (!detail) return block;
  const [bank, monitor] = await Promise.all([bankOverview(t.ctx).catch(() => null), monitorCounts(t.ctx).catch(() => null)]);
  return {
    ...block,
    posicaoAtual: {
      ...block.posicaoAtual,
      porSituacao: ordersByStatus(orders),
      banco: bank
        ? {
            previstoLiquidoCentavos: bank.expectedNet,
            creditadoLiquidoCentavos: bank.creditedNet,
            conciliadoLiquidoCentavos: bank.reconciledNet,
            transacoesConciliadas: bank.reconciledCount,
            brutoCentavos: bank.gross,
            taxasCentavos: bank.fees,
            disponivelCentavos: bank.available,
            simulado: Boolean(bank.provider?.simulated),
          }
        : null,
      monitor: monitor ? { falhas: monitor.failed, pendentes: monitor.pending, concluidos: monitor.ok, ignorados: monitor.ignored, total: monitor.all } : null,
    },
  };
}

/** Recorte do canal "comércio digital" para `vendas.porCanal` (pedidos pagos no período; fora da receita do PDV). */
export function commerceChannel(block: Awaited<ReturnType<typeof commerceBlock>>) {
  if (!block.lojaCriada || !block.noPeriodo) return null;
  const p = block.noPeriodo.pedidosPagos;
  return { quantidadePedidosPagos: p.quantidade, valorPedidosPagosCentavos: p.valorCentavos, freteCentavos: p.freteCentavos, incluidoNaReceitaLiquida: false };
}

