import "server-only";
import { defineExport } from "@/lib/exporters";
import { sp } from "@/lib/list";
import { BusinessError } from "@/lib/core/errors";
import { variationBps, managerialReport, paymentBreakdown, branchOperations, type Row, type Totals } from "@/domain/reports";
import { abcReport, abcProductLines, criterionValue } from "@/domain/abc";
import { GOAL_METRICS, GOAL_STATUS_LABEL, goalsProgress } from "@/domain/goals";
import { resolveAbcParams, resolveReportParams } from "@/app/(app)/relatorios/params";

/**
 * Exportações das telas de análise — reaproveitam exatamente as mesmas consultas (serviço único de métricas),
 * com os mesmos parâmetros de URL (período, filial, critério, categoria, classe e limites).
 */

const TOTAL_COLUMNS = [
  { key: "gross", label: "Vendas brutas", type: "money" as const },
  { key: "discounts", label: "Descontos", type: "money" as const },
  { key: "surcharges", label: "Acréscimos", type: "money" as const },
  { key: "returns", label: "Devoluções", type: "money" as const },
  { key: "netRevenue", label: "Vendas líquidas (receita líquida)", type: "money" as const },
  { key: "costSold", label: "Custo dos itens vendidos", type: "money" as const },
  { key: "costReturned", label: "Custo revertido (devoluções)", type: "money" as const },
  { key: "cmv", label: "CMV", type: "money" as const },
  { key: "grossProfit", label: "Lucro bruto", type: "money" as const },
  { key: "marginBps", label: "Margem bruta (%)", type: "bps" as const },
  { key: "salesCount", label: "Nº de vendas", type: "number" as const },
  { key: "ticket", label: "Ticket médio", type: "money" as const },
  { key: "returnsCount", label: "Nº de devoluções", type: "number" as const },
];

const flat = (r: Totals & { label: string }, extra: Record<string, unknown> = {}) => ({ ...r, ...extra });

defineExport("reports-units", {
  module: "reports",
  title: "Relatório gerencial — resultado por unidade",
  columns: [
    { key: "label", label: "Unidade" },
    { key: "from", label: "De", type: "date" },
    { key: "to", label: "Até", type: "date" },
    ...TOTAL_COLUMNS,
    { key: "prevNetRevenue", label: "Receita líquida — período anterior", type: "money" },
    { key: "variationBps", label: "Variação da receita (%)", type: "bps" },
    { key: "prevFrom", label: "Anterior de", type: "date" },
    { key: "prevTo", label: "Anterior até", type: "date" },
  ],
  rows: async (s, params) => {
    const rp = resolveReportParams(s, params);
    const compare = sp(params, "cmp") !== "0";
    const r = await managerialReport(s.ctx.store, rp.scope, { compare, branchIds: rp.branchIds });
    const meta = { from: rp.period.from, to: rp.period.to, prevFrom: r.previousScope?.from ?? null, prevTo: r.previousScope?.to ?? null };
    const rows: Record<string, unknown>[] = r.byBranch.map((b) => {
      const p = r.previousByBranch.get(b.id);
      return flat(b, { ...meta, prevNetRevenue: compare ? (p?.netRevenue ?? 0) : null, variationBps: compare ? variationBps(b.netRevenue, p?.netRevenue ?? 0) : null });
    });
    rows.push(flat({ ...r.totals, label: r.byBranch.length > 1 ? "TOTAL CONSOLIDADO" : "TOTAL" }, { ...meta, prevNetRevenue: r.previous?.netRevenue ?? null, variationBps: r.previous ? variationBps(r.totals.netRevenue, r.previous.netRevenue) : null }));
    return rows;
  },
});

defineExport("reports-breakdown", {
  module: "reports",
  title: "Relatório gerencial — quebra",
  columns: [
    { key: "dimension", label: "Quebra" },
    { key: "label", label: "Item" },
    ...TOTAL_COLUMNS,
    { key: "amount", label: "Valor (meio de pagamento/devolução)", type: "money" },
    { key: "count", label: "Quantidade de documentos", type: "number" },
  ],
  rows: async (s, params) => {
    const rp = resolveReportParams(s, params);
    const tab = sp(params, "tab") || "dia";
    if (tab === "pagamento") {
      const pay = await paymentBreakdown(s.ctx.store, rp.scope);
      return [
        ...pay.rows.map((r) => ({ dimension: "Meio de pagamento", label: r.kind === "return" ? `(−) ${r.label}` : r.label, amount: r.kind === "return" ? -r.amount : r.amount, count: r.count })),
        { dimension: "Meio de pagamento", label: "= Receita líquida", amount: pay.paymentsTotal - pay.returnsTotal, count: null },
      ];
    }
    const r = await managerialReport(s.ctx.store, rp.scope, { compare: false, branchIds: rp.branchIds });
    const map: Record<string, [string, Row[]]> = { dia: ["Dia", r.byDay], categoria: ["Categoria", r.byCategory], operador: ["Operador", r.byOperator] };
    const [dimension, rows] = map[tab] ?? map.dia;
    return [...rows.map((x) => flat(x, { dimension })), flat({ ...r.totals, label: "TOTAL" }, { dimension })];
  },
});

defineExport("reports-branch-ops", {
  module: "reports",
  title: "Resultado detalhado por filial — operações",
  columns: [
    { key: "type", label: "Tipo" },
    { key: "number", label: "Número", type: "number" },
    { key: "at", label: "Data/hora", type: "datetime" },
    { key: "operator", label: "Operador" },
    { key: "customer", label: "Cliente" },
    { key: "origin", label: "Venda de origem" },
    { key: "originAt", label: "Data da venda de origem", type: "datetime" },
    { key: "items", label: "Itens", type: "number" },
    { key: "gross", label: "Bruto", type: "money" },
    { key: "discounts", label: "Descontos", type: "money" },
    { key: "surcharges", label: "Acréscimos", type: "money" },
    { key: "value", label: "Valor líquido (+ venda / − devolução)", type: "money" },
    { key: "cost", label: "Custo (+ vendido / − revertido)", type: "money" },
    { key: "marginBps", label: "Margem (%)", type: "bps" },
  ],
  rows: async (s, params) => {
    const id = sp(params, "id");
    if (!s.branches.some((b) => b.id === id)) throw new BusinessError("Filial inválida.");
    const rp = resolveReportParams(s, { ...params, filial: id });
    const ops = await branchOperations(s.ctx.store, rp.scope);
    return [
      ...ops.sales.map((o) => ({ type: "Venda", number: o.number, at: o.at, operator: o.operatorName, customer: o.customerName ?? "Consumidor", origin: null, originAt: null, items: o.itemsCount, gross: o.gross, discounts: o.discounts, surcharges: o.surcharges, value: o.total, cost: o.cost, marginBps: o.marginBps })),
      ...ops.returns.map((o) => ({ type: o.priorSale ? "Devolução (venda anterior ao período)" : "Devolução", number: o.number, at: o.at, operator: null, customer: null, origin: o.saleNumber != null ? `Venda nº ${o.saleNumber}` : o.saleId, originAt: o.saleAt, items: o.itemsCount, gross: null, discounts: null, surcharges: null, value: -o.total, cost: -o.cost, marginBps: null })),
      { type: "TOTAL", number: null, at: null, items: null, gross: ops.totals.gross, discounts: ops.totals.discounts, surcharges: ops.totals.surcharges, value: ops.totals.netRevenue, cost: ops.totals.cmv, marginBps: ops.totals.marginBps },
    ];
  },
});

const KLASS_LABEL = (r: { klass?: string; noMovement?: boolean }) => (r.klass ? r.klass : r.noMovement ? "Sem vendas no período" : "Sem receita no período");

defineExport("reports-abc", {
  module: "reports",
  title: "Curva ABC de produtos",
  columns: [
    { key: "rank", label: "Posição", type: "number" },
    { key: "klass", label: "Classe" },
    { key: "sku", label: "SKU" },
    { key: "description", label: "Produto" },
    { key: "categoryName", label: "Categoria" },
    { key: "qtySold", label: "Qtd. vendida", type: "qty" },
    { key: "qtyReturned", label: "Qtd. devolvida", type: "qty" },
    { key: "qtyNet", label: "Qtd. líquida", type: "qty" },
    { key: "netRevenue", label: "Receita líquida", type: "money" },
    { key: "cmv", label: "CMV", type: "money" },
    { key: "grossProfit", label: "Lucro bruto", type: "money" },
    { key: "marginBps", label: "Margem (%)", type: "bps" },
    { key: "value", label: "Valor no critério" },
    { key: "shareBps", label: "Participação (%)", type: "bps" },
    { key: "cumAfterBps", label: "Acumulado (%)", type: "bps" },
    { key: "cumBeforeBps", label: "Acumulado anterior (%)", type: "bps" },
  ],
  rows: async (s, params) => {
    const ap = await resolveAbcParams(s, params);
    const r = await abcReport(s.ctx.store, ap.scope, { criterion: ap.criterion, categoryId: ap.categoryId, limits: ap.limits });
    const fmtValue = (row: Totals) => {
      const v = criterionValue(row, ap.criterion);
      return ap.criterion === "quantidade" ? String(v / 1000).replace(".", ",") : (v / 100).toFixed(2).replace(".", ",");
    };
    const base = r.classification.base
      .filter((x) => !ap.klass || ap.klass === x.klass)
      .map((x) => ({ ...x.row, rank: x.rank, klass: x.klass, value: fmtValue(x.row), shareBps: x.shareBps, cumAfterBps: x.cumAfterBps, cumBeforeBps: x.cumBeforeBps }));
    const excluded = !ap.klass || ap.klass === "sem" ? r.classification.excluded.map((x) => ({ ...x.row, rank: null, klass: KLASS_LABEL(x.row), value: fmtValue(x.row), shareBps: null, cumAfterBps: null, cumBeforeBps: null })) : [];
    return [...(ap.klass === "sem" ? [] : base), ...excluded];
  },
});

defineExport("reports-abc-product", {
  module: "reports",
  title: "Curva ABC — composição do produto",
  columns: [
    { key: "type", label: "Tipo" },
    { key: "number", label: "Documento", type: "number" },
    { key: "at", label: "Data/hora", type: "datetime" },
    { key: "origin", label: "Venda de origem" },
    { key: "qty", label: "Quantidade (+ vendida / − devolvida)", type: "qty" },
    { key: "gross", label: "Bruto", type: "money" },
    { key: "discount", label: "Descontos", type: "money" },
    { key: "surcharge", label: "Acréscimos", type: "money" },
    { key: "total", label: "Valor líquido", type: "money" },
    { key: "cost", label: "Custo", type: "money" },
  ],
  rows: async (s, params) => {
    const ap = await resolveAbcParams(s, params);
    const { lines, totals } = await abcProductLines(s.ctx.store, ap.scope, sp(params, "sku"), ap.categoryId);
    return [
      ...lines.map((l) => {
        const sign = l.kind === "sale" ? 1 : -1;
        return { type: l.kind === "sale" ? "Venda" : "Devolução", number: l.docNumber, at: l.at, origin: l.kind === "return" ? `Venda nº ${l.saleNumber ?? "—"}` : null, qty: sign * l.qty, gross: l.gross, discount: l.discount, surcharge: l.surcharge, total: sign * l.total, cost: sign * l.cost };
      }),
      { type: "TOTAL", qty: totals.qtyNet, gross: totals.gross, discount: totals.discounts, surcharge: totals.surcharges, total: totals.netRevenue, cost: totals.cmv },
    ];
  },
});

defineExport("reports-goals", {
  module: "dashboard",
  title: "Metas comerciais",
  columns: [
    { key: "period", label: "Mês" },
    { key: "branchName", label: "Filial" },
    { key: "metricLabel", label: "Métrica" },
    { key: "targetText", label: "Meta" },
    { key: "actualText", label: "Realizado" },
    { key: "progressBps", label: "Atingimento (%)", type: "bps" },
    { key: "expectedText", label: "Esperado até a data" },
    { key: "statusLabel", label: "Situação" },
    { key: "from", label: "Realizado de", type: "date" },
    { key: "to", label: "Realizado até", type: "date" },
    { key: "notes", label: "Observações" },
  ],
  rows: async (s, params) => {
    const rp = resolveReportParams(s, params);
    const mes = /^\d{4}-\d{2}$/.test(sp(params, "mes")) ? sp(params, "mes") : rp.period.to.slice(0, 7);
    const prog = await goalsProgress(s.ctx, mes, { branchIds: rp.branchIds });
    const fmt = (m: string, v: number | null) => (v == null ? "" : GOAL_METRICS[m as keyof typeof GOAL_METRICS]?.unit === "count" ? String(v) : (v / 100).toFixed(2).replace(".", ","));
    return prog
      .filter((g) => (rp.single ? g.goal.branchId === rp.filial : true))
      .map((g) => ({
        period: g.goal.period, branchName: g.branchName, metricLabel: GOAL_METRICS[g.metric]?.label ?? g.metric, targetText: fmt(g.metric, g.target), actualText: fmt(g.metric, g.actual),
        progressBps: g.progressBps, expectedText: fmt(g.metric, g.expected), statusLabel: GOAL_STATUS_LABEL[g.status], from: g.from, to: g.to, notes: g.goal.notes ?? "",
      }));
  },
});
