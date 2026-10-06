import Link from "@/components/ui/link";
import { cn } from "@/components/ui/cn";
import { formatBps, formatMoney, roundDiv } from "@/lib/money";
import { variationBps, type Row, type Totals } from "@/domain/reports";
import { marginText } from "./report-ui";

function Var({ cur, prev }: { cur: number; prev: number | null | undefined }) {
  if (prev == null) return <span className="text-slate-400">—</span>;
  const v = variationBps(cur, prev);
  if (v == null) return <span className="text-slate-400" title="Período anterior sem movimento">s/ base</span>;
  return <span className={v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-slate-600"}>{`${v > 0 ? "▲ +" : v < 0 ? "▼ −" : ""}${formatBps(Math.abs(v), 1)}`}</span>;
}

/**
 * Tabela de resultado (unidade, dia, categoria, operador): mesmas colunas e critérios em todas as quebras.
 * Linha de total calculada pelos totais (margem e ticket nunca pela média das linhas).
 */
export function ResultTable({
  rows,
  total,
  firstLabel,
  previous,
  previousTotal,
  hideZero,
  countLabel = "Nº de vendas",
  showShare,
  hideTicket,
  action,
}: {
  rows: Array<Row & { href?: string | null }>;
  total: Row;
  firstLabel: string;
  previous?: Map<string, Totals> | null;
  previousTotal?: Totals | null;
  hideZero?: boolean;
  countLabel?: string;
  showShare?: boolean;
  hideTicket?: boolean;
  /** rótulo do link de ação por linha (ex.: "Detalhes") */
  action?: string;
}) {
  const cmp = Boolean(previous);
  // acréscimos só aparecem quando há algum no recorte (a exportação traz sempre a coluna)
  const showSurcharge = total.surcharges !== 0 || rows.some((r) => r.surcharges !== 0);
  const num = "tabular whitespace-nowrap text-right";
  const cell = (r: Totals & { id: string }, isTotal = false) => {
    const muted = hideZero && !isTotal && r.salesCount === 0 && r.returnsCount === 0;
    const prevRow = isTotal ? previousTotal : previous?.get(r.id);
    return (
      <>
        <td className={cn(num, muted && "text-slate-400")}>{formatMoney(r.gross)}</td>
        <td className={cn(num, muted && "text-slate-400")}>{r.discounts ? `− ${formatMoney(r.discounts)}` : formatMoney(0)}</td>
        {showSurcharge && <td className={cn(num, muted && "text-slate-400")}>{formatMoney(r.surcharges)}</td>}
        <td className={cn(num, r.returns ? "text-amber-800" : muted && "text-slate-400")}>{r.returns ? `− ${formatMoney(r.returns)}` : formatMoney(0)}</td>
        <td className={cn(num, "font-semibold", r.netRevenue < 0 && "text-red-700", muted && "font-normal text-slate-400")}>{formatMoney(r.netRevenue)}</td>
        {cmp && (
          <td className={num} title={`Período anterior: ${formatMoney(prevRow?.netRevenue ?? 0)}`}>
            <Var cur={r.netRevenue} prev={prevRow?.netRevenue ?? 0} />
            <span className="block text-[11px] text-slate-500">{formatMoney(prevRow?.netRevenue ?? 0)}</span>
          </td>
        )}
        {showShare && <td className={num}>{total.netRevenue > 0 ? formatBps(roundDiv(r.netRevenue * 10000, total.netRevenue), 1) : "—"}</td>}
        <td className={cn(num, muted && "text-slate-400")}>{formatMoney(r.cmv)}</td>
        <td className={cn(num, "hidden 2xl:table-cell", muted && "text-slate-400")}>{formatMoney(r.grossProfit)}</td>
        <td className={cn(num, r.marginBps != null && r.marginBps < 0 && "text-red-700", r.marginBps == null && "text-slate-500")}>{marginText(r.marginBps)}</td>
        <td className={cn(num, muted && "text-slate-400")}>{r.salesCount}</td>
        {!hideTicket && <td className={cn(num, muted && "text-slate-400")}>{r.ticket == null ? "—" : formatMoney(r.ticket)}</td>}
      </>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="table-base w-full text-[13px] [&_td]:px-2 [&_th]:px-2">
        <thead>
          <tr>
            <th>{firstLabel}</th>
            <th className="text-right">Vendas brutas</th>
            <th className="text-right">Descontos</th>
            {showSurcharge && <th className="text-right">Acréscimos</th>}
            <th className="text-right">Devoluções</th>
            <th className="text-right">Vendas líquidas</th>
            {cmp && <th className="text-right">Var. (anterior)</th>}
            {showShare && <th className="text-right">Part.</th>}
            <th className="text-right">CMV</th>
            <th className="hidden text-right 2xl:table-cell">Lucro bruto</th>
            <th className="text-right">Margem</th>
            <th className="text-right">{countLabel}</th>
            {!hideTicket && <th className="text-right">Ticket médio</th>}
            {action && <th className="no-print text-right">Ação</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="min-w-[140px]">
                {r.href ? (
                  <Link href={r.href} className="font-medium text-brand-700 hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </td>
              {cell(r)}
              {action && <td className="no-print text-right">{r.href ? <Link href={r.href} className="text-xs font-medium text-brand-700 hover:underline">{action}</Link> : null}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 font-semibold">
            <td className="border-t border-line px-3 py-2">{total.label}</td>
            {cell(total, true)}
            {action && <td className="no-print border-t border-line" />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Indicador × período atual × período anterior × variação. */
export function ComparisonTable({ cur, prev, curLabel, prevLabel }: { cur: Totals; prev: Totals; curLabel: string; prevLabel: string }) {
  const money = (k: keyof Totals, label: string, goodUp = true) => ({ label, cur: cur[k] as number, prev: prev[k] as number, fmt: formatMoney, goodUp });
  const rows = [
    money("gross", "Vendas brutas"),
    money("discounts", "(−) Descontos", false),
    money("surcharges", "(+) Acréscimos"),
    money("returns", "(−) Devoluções", false),
    money("netRevenue", "= Vendas líquidas (receita líquida)"),
    money("cmv", "(−) CMV", false),
    money("grossProfit", "= Lucro bruto"),
    { label: "Número de vendas", cur: cur.salesCount, prev: prev.salesCount, fmt: (v: number) => v.toLocaleString("pt-BR"), goodUp: true },
    { label: "Número de devoluções", cur: cur.returnsCount, prev: prev.returnsCount, fmt: (v: number) => v.toLocaleString("pt-BR"), goodUp: false },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="table-base w-full text-sm">
        <thead>
          <tr>
            <th>Indicador</th>
            <th className="text-right">Atual ({curLabel})</th>
            <th className="text-right">Anterior ({prevLabel})</th>
            <th className="text-right">Variação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = variationBps(r.cur, r.prev);
            const good = v == null || v === 0 ? null : v > 0 === r.goodUp;
            return (
              <tr key={r.label} className={r.label.startsWith("=") ? "font-medium" : undefined}>
                <td>{r.label}</td>
                <td className="tabular text-right">{r.fmt(r.cur)}</td>
                <td className="tabular text-right text-slate-600">{r.fmt(r.prev)}</td>
                <td className={cn("tabular text-right", good == null ? "text-slate-500" : good ? "text-emerald-700" : "text-red-700")}>{v == null ? "sem base" : `${v > 0 ? "▲ +" : v < 0 ? "▼ −" : ""}${formatBps(Math.abs(v), 1)}`}</td>
              </tr>
            );
          })}
          <tr>
            <td>Margem bruta</td>
            <td className="tabular text-right">{marginText(cur.marginBps)}</td>
            <td className="tabular text-right text-slate-600">{marginText(prev.marginBps)}</td>
            <td className="tabular text-right text-slate-600">{cur.marginBps != null && prev.marginBps != null ? `${cur.marginBps - prev.marginBps >= 0 ? "+" : "−"}${formatBps(Math.abs(cur.marginBps - prev.marginBps)).replace("%", "")} p.p.` : "sem base"}</td>
          </tr>
          <tr>
            <td>Ticket médio</td>
            <td className="tabular text-right">{cur.ticket == null ? "—" : formatMoney(cur.ticket)}</td>
            <td className="tabular text-right text-slate-600">{prev.ticket == null ? "—" : formatMoney(prev.ticket)}</td>
            <td className="tabular text-right text-slate-600">{variationBps(cur.ticket, prev.ticket) == null ? "sem base" : `${formatBps(variationBps(cur.ticket, prev.ticket)!, 1)}`}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
