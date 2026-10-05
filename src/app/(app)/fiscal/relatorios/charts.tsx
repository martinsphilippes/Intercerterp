"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Cores por tipo de documento (validadas: separação CVD ≥ 8; laranja abaixo de 3:1 → tabela ao lado). */
export const MODEL_COLORS = { nfe: "#2f58a8", nfce: "#f2711c", nfse: "#0f9d76" } as const;
const NAMES: Record<string, string> = { nfe: "NF-e", nfce: "NFC-e", nfse: "NFS-e" };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function Tip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a: number, p: any) => a + (p.value ?? 0), 0);
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-700">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />
          {NAMES[p.dataKey]}: <span className="tabular ml-auto">{money ? brl(p.value) : p.value.toLocaleString("pt-BR")}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-line pt-1 text-slate-700">Total: <span className="tabular">{money ? brl(total) : total.toLocaleString("pt-BR")}</span></p>
    </div>
  );
}

/** Barras empilhadas por tipo de documento (quantidade por mês ou valor por dia). */
export function StackedByModel({ data, xKey, money, height = 240 }: { data: Array<Record<string, any>>; xKey: string; money?: boolean; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={money ? "Faturamento autorizado por dia e tipo de documento" : "Documentos emitidos por mês e tipo"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: money ? 12 : 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="#e3e6eb" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} tick={{ fontSize: 11, fill: "#5b6474" }} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#5b6474" }} tickFormatter={(v) => (money ? brl(v) : String(v))} width={money ? 72 : 36} allowDecimals={false} />
          <Tooltip content={<Tip money={money} />} cursor={{ fill: "rgba(47,88,168,0.06)" }} />
          <Legend formatter={(v) => <span className="text-xs text-slate-700">{NAMES[v as string] ?? v}</span>} iconType="square" iconSize={10} />
          {(["nfe", "nfce", "nfse"] as const).map((k, i) => (
            <Bar key={k} dataKey={k} stackId="m" fill={MODEL_COLORS[k]} stroke="#fff" strokeWidth={1} radius={i === 2 ? [4, 4, 0, 0] : 0} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
