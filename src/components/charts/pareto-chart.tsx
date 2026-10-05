"use client";

import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, pctBR } from "./format";

export interface ParetoPoint {
  rank: number;
  skuId: string;
  sku: string;
  name: string;
  shareBps: number;
  cumBps: number;
  klass: "A" | "B" | "C";
  valueText: string;
}

const CLASS_COLOR = { A: CHART_COLORS.classA, B: CHART_COLORS.classB, C: CHART_COLORS.classC } as const;

/**
 * Curva ABC (Pareto) num ÚNICO eixo em % do total da base: colunas = participação de cada item
 * (cor pela classe, rampa ordinal), linha = participação acumulada; linhas de referência nos limites A e B.
 */
export function ParetoChart({ points, limitA, limitB, highlight, height = 300, drillBase, caption }: { points: ParetoPoint[]; limitA: number; limitB: number; highlight?: "A" | "B" | "C" | null; height?: number; drillBase?: string | null; caption: string }) {
  const router = useRouter();
  const data = points.map((p) => ({ ...p, share: p.shareBps / 100, cum: p.cumBps / 100 }));
  return (
    <figure className="m-0" aria-label={caption}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden>
        {(["A", "B", "C"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5" style={{ opacity: highlight && highlight !== k ? 0.45 : 1 }}>
            <span className="inline-block size-2.5 rounded-sm" style={{ background: CLASS_COLOR[k] }} /> Classe {k}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: CHART_COLORS.previous }} /> Participação acumulada
        </span>
        <span className="ml-auto text-slate-500">% do total da base da curva</span>
      </div>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} barCategoryGap={1} accessibilityLayer>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="rank" tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} interval="preserveStartEnd" minTickGap={16} height={24} />
            <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={44} />
            <ReferenceLine y={limitA / 100} stroke={CHART_COLORS.axis} strokeWidth={1} label={{ value: `A ${pctBR(limitA, 0)}`, position: "insideTopLeft", fontSize: 11, fill: CHART_COLORS.axis }} />
            <ReferenceLine y={limitB / 100} stroke={CHART_COLORS.axis} strokeWidth={1} label={{ value: `B ${pctBR(limitB, 0)}`, position: "insideBottomLeft", fontSize: 11, fill: CHART_COLORS.axis }} />
            <Tooltip cursor={{ fill: "rgba(47,88,168,0.06)" }} content={<ParetoTooltip />} />
            <Bar dataKey="share" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} cursor={drillBase ? "pointer" : undefined} onClick={(d: any) => drillBase && d?.payload && router.push(`${drillBase}`.replace("{sku}", d.payload.skuId))}>
              {data.map((p) => (
                <Cell key={p.skuId} fill={CLASS_COLOR[p.klass]} fillOpacity={highlight && highlight !== p.klass ? 0.3 : 1} />
              ))}
            </Bar>
            <Line dataKey="cum" type="monotone" stroke={CHART_COLORS.previous} strokeWidth={2} dot={data.length <= 40 ? { r: 3, fill: CHART_COLORS.previous, stroke: "#fff", strokeWidth: 2 } : false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-slate-500">Eixo horizontal: posição do item na curva (maior valor à esquerda). {caption}</figcaption>
    </figure>
  );
}

function ParetoTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as ParetoPoint;
  return (
    <div className="max-w-xs rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-600">
        #{p.rank} · {p.sku}
      </p>
      <p className="mb-1 text-slate-700">{p.name}</p>
      <p>
        <strong className="tabular text-sm text-ink">{pctBR(p.shareBps)}</strong> <span className="text-slate-500">participação · {p.valueText}</span>
      </p>
      <p>
        <strong className="tabular text-sm text-ink">{pctBR(p.cumBps)}</strong> <span className="text-slate-500">acumulado · classe {p.klass}</span>
      </p>
    </div>
  );
}
