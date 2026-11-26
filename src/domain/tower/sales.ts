import type { Doc } from "@/lib/db/types";
import { addDays, monthEnd, toLocalDate } from "@/lib/dates";
import {
  branchOperations,
  commercialOverview,
  emptyTotals,
  groupTotals,
  loadFacts,
  managerialReport,
  totalsOf,
  variationBps,
  type Line,
  type Totals,
} from "@/domain/reports";
import {
  COMPENSATION_PT,
  FISCAL_STATUS_PT,
  REFUND_METHOD_PT,
  RETURN_KIND_PT,
  RETURN_STATUS_PT,
  SALE_ORIGIN_PT,
  periodRange,
  pt,
  reportScope,
  sum,
  type TowerRequest,
} from "./common";
import { pageBy } from "./pagination";

/**
 * Vendas na Torre = base comercial ÚNICA do ERP (`loadFacts` + `totalsOf`, src/domain/reports.ts), a mesma do painel do
 * gestor, dos relatórios gerenciais, do detalhe por filial e da curva ABC. Nada é recalculado aqui: os totais vêm de
 * `totalsOf`/`groupTotals` e as linhas por operação de `branchOperations`.
 */

/** Totais da base comercial no formato do contrato (centavos, milésimos, pontos-base). */
export function salesFigures(t: Totals) {
  return {
    receitaBrutaCentavos: t.gross,
    descontosCentavos: t.discounts,
    acrescimosCentavos: t.surcharges,
    receitaAntesDevolucoesCentavos: t.salesNet,
    devolucoesCentavos: t.returns,
    receitaLiquidaCentavos: t.netRevenue,
    custoVendasCentavos: t.costSold,
    custoDevolucoesCentavos: t.costReturned,
    custoMercadoriaVendidaCentavos: t.cmv,
    lucroBrutoCentavos: t.grossProfit,
    margemBrutaBps: t.marginBps,
    quantidadeVendas: t.salesCount,
    quantidadeDevolucoes: t.returnsCount,
    ticketMedioCentavos: t.ticket,
    quantidadeVendidaMilesimos: t.qtySold,
    quantidadeDevolvidaMilesimos: t.qtyReturned,
    quantidadeLiquidaMilesimos: t.qtyNet,
  };
}

/** Variação contra o período anterior equivalente (mesma regra do painel: relativa em bps; margem em pontos). */
function variation(cur: Totals, prev: Totals) {
  return {
    receitaLiquidaBps: variationBps(cur.netRevenue, prev.netRevenue),
    quantidadeVendasBps: variationBps(cur.salesCount, prev.salesCount),
    ticketMedioBps: variationBps(cur.ticket, prev.ticket),
    margemBrutaPontosBps: cur.marginBps != null && prev.marginBps != null ? cur.marginBps - prev.marginBps : null,
  };
}

function returnSplit(lines: Line[], key: (l: Line) => string | null, label: Record<string, string>) {
  return [...groupTotals(lines, key)]
    .map(([k, tot]) => ({ chave: k === "__none__" ? null : (label[k] ?? k), valorCentavos: tot.returns, quantidadeDocumentos: tot.returnsCount, custoRevertidoCentavos: tot.costReturned }))
    .sort((a, b) => String(a.chave).localeCompare(String(b.chave)));
}

/** Blocos "vendas" e "devoluções" do resumo — `commercialOverview` (painel do gestor). */
export async function salesSummary(t: TowerRequest<any>) {
  const scope = reportScope(t);
  const ov = await commercialOverview(t.store, scope);
  const { totals, previous, previousScope, cancelled, facts } = ov;
  const returnLines = facts.lines.filter((l) => l.kind === "return");
  const { start } = periodRange(t);
  const startMs = new Date(start).getTime();
  // mesma marcação do detalhe por filial (`branchOperations.priorSale`): venda original anterior ao início do recorte
  const prior = groupTotals(returnLines, (l) => (l.saleAt && new Date(l.saleAt).getTime() < startMs ? "anterior" : "no_periodo")).get("anterior") ?? emptyTotals();
  return {
    vendas: {
      ...salesFigures(totals),
      canceladas: { quantidade: cancelled.count, valorCentavos: cancelled.total },
      periodoAnterior: { de: previousScope.from, ate: previousScope.to, ...salesFigures(previous) },
      variacao: variation(totals, previous),
      porCanal: {
        // a base comercial só contém vendas do PDV (inclusive trocas): o canal PDV é o total da base
        pdv: { receitaLiquidaCentavos: totals.netRevenue, quantidadeVendas: totals.salesCount, ticketMedioCentavos: totals.ticket, devolucoesCentavos: totals.returns },
        comercioDigital: null as Record<string, unknown> | null,
        pedidoDeVenda: null,
      },
    },
    devolucoes: {
      valorCentavos: totals.returns,
      quantidadeDocumentos: totals.returnsCount,
      custoRevertidoCentavos: totals.costReturned,
      quantidadeItensMilesimos: totals.qtyReturned,
      deVendasAnterioresAoPeriodo: { valorCentavos: prior.returns, quantidadeDocumentos: prior.returnsCount },
      porSituacao: returnSplit(returnLines, (l) => facts.returns.get(l.docId)?.status ?? null, RETURN_STATUS_PT).map(({ chave, ...r }) => ({ situacao: chave, ...r })),
      porTipo: returnSplit(returnLines, (l) => facts.returns.get(l.docId)?.kind ?? "return", RETURN_KIND_PT).map(({ chave, ...r }) => ({ tipo: chave, ...r })),
    },
  };
}

/** Série da receita: por dia (`managerialReport.byDay`) ou por mês (`groupTotals` por mês sobre a mesma base). */
export async function salesSeries(t: TowerRequest<{ granularidade: "dia" | "mes" }>) {
  const scope = reportScope(t);
  if (t.extra.granularidade === "dia") {
    const rep = await managerialReport(t.store, scope, { compare: false });
    return { granularidade: "dia" as const, itens: rep.byDay.map((r) => ({ data: r.id, ...salesFigures(r) })), total: salesFigures(rep.totals) };
  }
  const facts = await loadFacts(t.store, scope);
  const perMonth = groupTotals(facts.lines, (l) => l.date.slice(0, 7));
  const itens = [];
  for (let m = scope.from.slice(0, 7); m <= scope.to.slice(0, 7); m = addDays(monthEnd(`${m}-01`), 1).slice(0, 7)) {
    const de = `${m}-01` < scope.from ? scope.from : `${m}-01`;
    const ate = monthEnd(`${m}-01`) > scope.to ? scope.to : monthEnd(`${m}-01`);
    itens.push({ mes: m, de, ate, ...salesFigures(perMonth.get(m) ?? emptyTotals()) });
  }
  return { granularidade: "mes" as const, itens, total: salesFigures(totalsOf(facts.lines)) };
}

/** Resultado por unidade (`managerialReport.byBranch`): todas as filiais do recorte, inclusive sem movimento. */
export async function salesByUnit(t: TowerRequest<any>) {
  const rep = await managerialReport(t.store, reportScope(t), { compare: true, branchIds: t.scopeBranchIds });
  const branchById = new Map(t.branches.map((b) => [b.id as string, b]));
  return {
    itens: rep.byBranch.map((r) => {
      const prev = rep.previousByBranch.get(r.id) ?? emptyTotals();
      const b = branchById.get(r.id);
      return {
        idUnidade: r.id,
        codigo: (b?.code as string | undefined) ?? null,
        nome: r.label,
        situacaoUnidade: b?.status === "inactive" ? "inativa" : "ativa",
        ...salesFigures(r),
        periodoAnterior: { receitaLiquidaCentavos: prev.netRevenue, quantidadeVendas: prev.salesCount, ticketMedioCentavos: prev.ticket, margemBrutaBps: prev.marginBps },
        variacao: variation(r, prev),
      };
    }),
    total: salesFigures(rep.totals),
    periodoAnterior: rep.previousScope ? { de: rep.previousScope.from, ate: rep.previousScope.to, ...salesFigures(rep.previous ?? emptyTotals()) } : null,
  };
}

// ───────────────────────────── Transações (escopo torre:transacoes)

export type SaleSituation = "concluida" | "cancelada" | "todas";

function saleIds(s: Doc) {
  return {
    origem: pt(SALE_ORIGIN_PT, s.origin) ?? "pdv",
    canal: "pdv",
    idUnidade: (s.branchId ?? null) as string | null,
    idTerminal: (s.terminalId ?? null) as string | null,
    idSessaoCaixa: (s.cashSessionId ?? null) as string | null,
    idOperador: (s.operatorId ?? null) as string | null,
    idVendedor: (s.sellerId ?? null) as string | null,
    // somente o identificador do cliente: nome, CPF/CNPJ e contatos nunca saem pela Torre
    idCliente: (s.customerId ?? null) as string | null,
    situacaoFiscal: pt(FISCAL_STATUS_PT, s.fiscalStatus),
    idDocumentoFiscal: (s.fiscalDocumentId ?? null) as string | null,
  };
}

/**
 * Vendas do recorte, uma linha por venda — as MESMAS operações que formam os totais (`branchOperations`): concluídas com
 * data de conclusão no período; canceladas (opcional) pela mesma data de referência do aviso de canceladas do painel.
 */
export async function saleTransactions(t: TowerRequest<{ situacao: SaleSituation }>) {
  const ops = await branchOperations(t.store, reportScope(t));
  const saleById = new Map(ops.facts.sales.map((s) => [s.id, s]));
  const rows: Array<Record<string, any>> = [];
  if (t.extra.situacao !== "cancelada") {
    for (const o of ops.sales) {
      const s = saleById.get(o.id)!;
      rows.push({
        idVenda: o.id,
        numero: o.number,
        situacao: "concluida",
        ...saleIds(s),
        concluidaEm: s.completedAt,
        data: toLocalDate(s.completedAt),
        canceladaEm: null,
        quantidadeLinhas: o.itemsCount,
        quantidadeItensVenda: s.itemsCount ?? null,
        receitaBrutaCentavos: o.gross,
        descontosCentavos: o.discounts,
        acrescimosCentavos: o.surcharges,
        valorLiquidoCentavos: o.total,
        custoCentavos: o.cost,
        margemBrutaBps: o.marginBps,
      });
    }
  }
  if (t.extra.situacao !== "concluida") {
    for (const s of ops.cancelled) {
      rows.push({
        idVenda: s.id,
        numero: s.number ?? null,
        situacao: "cancelada",
        ...saleIds(s),
        concluidaEm: s.completedAt,
        data: toLocalDate(s.completedAt),
        canceladaEm: s.cancelledAt ?? null,
        quantidadeLinhas: null,
        quantidadeItensVenda: s.itemsCount ?? null,
        receitaBrutaCentavos: s.subtotal ?? 0,
        descontosCentavos: s.discountTotal ?? 0,
        acrescimosCentavos: s.surchargeTotal ?? 0,
        valorLiquidoCentavos: s.total ?? 0,
        custoCentavos: s.costTotal ?? 0,
        margemBrutaBps: null,
      });
    }
  }
  const completed = rows.filter((r) => r.situacao === "concluida");
  const cancelled = rows.filter((r) => r.situacao === "cancelada");
  const page = pageBy(rows, (r) => [String(r.concluidaEm), String(r.idVenda)], ["asc", "asc"], t.page!);
  return {
    ...page,
    totais: {
      concluidas: { quantidade: completed.length, valorLiquidoCentavos: sum(completed, (r) => r.valorLiquidoCentavos) },
      canceladas: t.extra.situacao === "concluida" ? null : { quantidade: cancelled.length, valorLiquidoCentavos: sum(cancelled, (r) => r.valorLiquidoCentavos) },
    },
  };
}

/** Devoluções do recorte, uma linha por documento (data e filial do MOVIMENTO, como na base comercial). */
export async function returnTransactions(t: TowerRequest<any>) {
  const ops = await branchOperations(t.store, reportScope(t));
  const customerOf = new Map<string, string | null>();
  for (const l of ops.facts.lines) if (l.kind === "return" && !customerOf.has(l.docId)) customerOf.set(l.docId, l.customerId);
  const rows = ops.returns.map((o) => {
    const r = ops.facts.returns.get(o.id) ?? ({} as Doc);
    return {
      idDevolucao: o.id,
      numero: o.number,
      tipo: pt(RETURN_KIND_PT, o.kind),
      situacao: pt(RETURN_STATUS_PT, o.status),
      compensacao: pt(COMPENSATION_PT, o.compensation),
      formaReembolso: o.compensation === "refund" ? pt(REFUND_METHOD_PT, r.refundMethod ?? "refund") : null,
      idUnidade: (r.branchId ?? null) as string | null,
      idCliente: customerOf.get(o.id) ?? null,
      registradaEm: o.at,
      data: toLocalDate(o.at),
      idVendaOriginal: o.saleId,
      numeroVendaOriginal: o.saleNumber,
      vendaOriginalEm: o.saleAt,
      vendaAnteriorAoPeriodo: o.priorSale,
      quantidadeLinhas: o.itemsCount,
      valorCentavos: o.total,
      custoRevertidoCentavos: o.cost,
      valorAbatidoTituloCentavos: (r.abatedAmount ?? null) as number | null,
    };
  });
  const page = pageBy(rows, (r) => [String(r.registradaEm), String(r.idDevolucao)], ["asc", "asc"], t.page!);
  return { ...page, totais: { quantidade: rows.length, valorCentavos: sum(rows, (r) => r.valorCentavos), custoRevertidoCentavos: sum(rows, (r) => r.custoRevertidoCentavos) } };
}
