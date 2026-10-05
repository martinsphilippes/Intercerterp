"use client";

import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, brlCompact, brlFull, dateBR } from "./format";

export interface RevenuePoint {
  key: string;
  label: string;
  date: string;
  current: number;
  previousDate: string | null;
  previous: number | null;
  salesCount: number;
}

/**
 * Evolução da receita líquida (R$) — colunas do período atual e linha do período anterior equivalente,
 * no MESMO eixo. Clicar numa coluna diária abre as vendas do dia (quando `drillBase` é informado).
 */
export function RevenueChart({
  points,
  granularity,
  currentLabel,
  previousLabel,
  height = 260,
  drillBase,
  caption,
  highlightDate,
}: {
  points: RevenuePoint[];
  granularity: "day" | "hour";
  currentLabel: string;
  previousLabel?: string | null;
  height?: number;
  /** ex.: "/vendas?filial=…" — a data é anexada como de/ate */
  drillBase?: string | null;
  caption: string;
  /** data destacada (ex.: hoje) — coluna em tom mais escuro, identificada na legenda */
  highlightDate?: string | null;
}) {
  const router = useRouter();
  const hl = granularity === "day" && highlightDate && points.some((p) => p.date === highlightDate) ? highlightDate : null;
  const hasPrev = previousLabel != null && points.some((p) => p.previous != null);
  const data = points.map((p) => ({ ...p, cur: p.current / 100, prev: p.previous == null ? null : p.previous / 100 }));
  const total = points.reduce((a, p) => a + p.current, 0);
  const max = points.reduce((m, p) => (p.current > m.current ? p : m), points[0] ?? { current: 0, label: "", key: "" });
  const negative = points.some((p) => p.current < 0 || (p.previous ?? 0) < 0);
  const go = (p: RevenuePoint) => {
    if (!drillBase || granularity !== "day") return;
    router.push(`${drillBase}${drillBase.includes("?") ? "&" : "?"}de=${p.date}&ate=${p.date}`);
  };
  return (
    <figure className="m-0" aria-label={caption}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: CHART_COLORS.current }} /> {currentLabel}
        </span>
        {hl && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: CHART_COLORS.classA }} /> Hoje
          </span>
        )}
        {hasPrev && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: CHART_COLORS.previous }} /> {previousLabel}
          </span>
        )}
        <span className="ml-auto text-slate-500">Valores em R$ · {granularity === "hour" ? "por hora" : "por dia"}</span>
      </div>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickFormatter={(v: number) => brlCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={72} />
            {negative && <ReferenceLine y={0} stroke={CHART_COLORS.axis} strokeWidth={1} />}
            <Tooltip cursor={{ fill: "rgba(47,88,168,0.06)" }} content={<RevenueTooltip granularity={granularity} hasPrev={hasPrev} currentLabel={currentLabel} previousLabel={previousLabel ?? ""} />} />
            <Bar
              dataKey="cur"
              name={currentLabel}
              fill={CHART_COLORS.current}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              cursor={drillBase && granularity === "day" ? "pointer" : undefined}
              onClick={(d: any) => d?.payload && go(d.payload as RevenuePoint)}
            >
              {data.map((p) => (
                <Cell key={p.key} fill={hl && p.date === hl ? CHART_COLORS.classA : CHART_COLORS.current} />
              ))}
            </Bar>
            {hasPrev && <Line dataKey="prev" name={previousLabel ?? ""} type="monotone" stroke={CHART_COLORS.previous} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-slate-500">
        {caption} Total {brlFull(total / 100)}
        {max && max.current > 0 ? ` · maior ${granularity === "hour" ? "hora" : "dia"}: ${max.label} (${brlFull(max.current / 100)})` : ""}
        {drillBase && granularity === "day" ? " · clique numa coluna para ver as vendas do dia." : ""}
      </figcaption>
      <details className="no-print mt-2 text-xs" data-print-hide>
        <summary className="cursor-pointer text-brand-700 hover:underline">Ver dados em tabela</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded border border-line">
          <table className="table-base w-full">
            <thead>
              <tr>
                <th>{granularity === "hour" ? "Hora" : "Data"}</th>
                <th className="text-right">Receita líquida</th>
                <th className="text-right">Vendas</th>
                {hasPrev && <th>{granularity === "hour" ? "Hora (anterior)" : "Data (anterior)"}</th>}
                {hasPrev && <th className="text-right">Receita (anterior)</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <td>{granularity === "hour" ? p.label : dateBR(p.date)}</td>
                  <td className="tabular text-right">{brlFull(p.current / 100)}</td>
                  <td className="tabular text-right">{p.salesCount}</td>
                  {hasPrev && <td>{p.previousDate ? (granularity === "hour" ? p.label : dateBR(p.previousDate)) : "—"}</td>}
                  {hasPrev && <td className="tabular text-right">{p.previous == null ? "—" : brlFull(p.previous / 100)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function RevenueTooltip({ active, payload, granularity, hasPrev, currentLabel, previousLabel }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as RevenuePoint & { cur: number; prev: number | null };
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-600">{granularity === "hour" ? `${dateBR(p.date.slice(0, 10))} · ${p.label}` : dateBR(p.date)}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-3" style={{ background: CHART_COLORS.current }} aria-hidden />
        <strong className="tabular text-sm text-ink">{brlFull(p.cur)}</strong>
        <span className="text-slate-500">
          {currentLabel} · {p.salesCount} venda{p.salesCount === 1 ? "" : "s"}
        </span>
      </p>
      {hasPrev && p.prev != null && (
        <p className="mt-0.5 flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: CHART_COLORS.previous }} aria-hidden />
          <strong className="tabular text-sm text-ink">{brlFull(p.prev)}</strong>
          <span className="text-slate-500">
            {previousLabel} · {p.previousDate ? (granularity === "hour" ? `${dateBR(p.previousDate.slice(0, 10))} ${p.label}` : dateBR(p.previousDate)) : ""}
          </span>
        </p>
      )}
    </div>
  );
}
