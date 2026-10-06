"use client";

import dynamic from "next/dynamic";

/** Espaço reservado do gráfico (mesma altura: a página não "pula" quando o gráfico chega). */
function ChartPlaceholder({ height }: { height: number }) {
  return <div style={{ height }} className="w-full animate-pulse rounded-md bg-slate-100" role="status" aria-label="Carregando gráfico" />;
}

/*
 * Gráficos carregados depois da página: a biblioteca de gráficos (~120 KB) deixa de atrasar a primeira exibição
 * do painel e dos relatórios — números, tabelas e botões aparecem antes e o gráfico entra em seguida.
 */
export const RevenueChart = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), { ssr: false, loading: () => <ChartPlaceholder height={260} /> });
export const ParetoChart = dynamic(() => import("./pareto-chart").then((m) => m.ParetoChart), { ssr: false, loading: () => <ChartPlaceholder height={300} /> });
export const StackedByModel = dynamic(() => import("@/app/(app)/fiscal/relatorios/charts").then((m) => m.StackedByModel), { ssr: false, loading: () => <ChartPlaceholder height={240} /> });
export const CashflowCharts = dynamic(() => import("@/app/(app)/financeiro/fluxo-caixa/charts").then((m) => m.CashflowCharts), { ssr: false, loading: () => <ChartPlaceholder height={320} /> });
