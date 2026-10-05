"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartBucket {
  key: string;
  label: string;
  from: string;
  to: string;
  realizedIn: number;
  forecastIn: number;
  realizedOut: number;
  forecastOut: number;
  balance: number;
  hasToday: boolean;
}

// Paleta validada (categórica: azul = entradas, laranja = saídas); previsto = mesma cor com hachura
const IN = "#2a78d6";
const OUT = "#eb6834";
const INK = "#475569";
const GRID = "#e2e8f0";

const brl = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const short = (v: number) => {
  const r = v / 100;
  const a = Math.abs(r);
  return a >= 1_000_000 ? `R$ ${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : a >= 1000 ? `R$ ${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${r.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

function TooltipBox({ active, payload, label, kind }: any) {
  if (!active || !payload?.length) return null;
  const b: ChartBucket = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {kind === "flow" ? (
        <table className="tabular">
          <tbody>
            <tr><td className="pr-3 text-slate-500">Entradas realizadas</td><td className="text-right">{brl(b.realizedIn)}</td></tr>
            <tr><td className="pr-3 text-slate-500">Entradas previstas</td><td className="text-right">{brl(b.forecastIn)}</td></tr>
            <tr><td className="pr-3 text-slate-500">Saídas realizadas</td><td className="text-right">{brl(-b.realizedOut)}</td></tr>
            <tr><td className="pr-3 text-slate-500">Saídas previstas</td><td className="text-right">{brl(-b.forecastOut)}</td></tr>
          </tbody>
        </table>
      ) : (
        <p className="tabular">Saldo projetado ao fim: <b>{brl(b.balance)}</b></p>
      )}
      <p className="mt-1 text-slate-400">Clique para ver os lançamentos</p>
    </div>
  );
}

/** Entradas × saídas por período (realizado sólido, previsto hachurado) e, separado, o saldo projetado (mesma unidade, escalas distintas → dois gráficos). */
export function CashflowCharts({ buckets, showBalance, baseHref }: { buckets: ChartBucket[]; showBalance: boolean; baseHref: string }) {
  const router = useRouter();
  const data = buckets.map((b) => ({ ...b, outR: -b.realizedOut, outF: -b.forecastOut }));
  const go = (d: any, side: "in" | "out" | "all") => {
    const b: ChartBucket | undefined = d?.payload ?? d?.activePayload?.[0]?.payload;
    if (!b) return;
    router.push(`${baseHref}&tab=movimentos&from=${b.from}&to=${b.to}${side === "all" ? "" : `&type=${side}`}`);
  };
  const today = buckets.find((b) => b.hasToday)?.label;
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">Entradas e saídas por período</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
              <defs>
                <pattern id="hatch-in" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="#dbeafe" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={IN} strokeWidth="2" />
                </pattern>
                <pattern id="hatch-out" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
                  <rect width="6" height="6" fill="#ffedd5" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={OUT} strokeWidth="2" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} width={72} />
              <Tooltip content={<TooltipBox kind="flow" />} cursor={{ fill: "#f1f5f9" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="realizedIn" name="Entradas realizadas" stackId="in" fill={IN} radius={[0, 0, 0, 0]} onClick={(d) => go(d, "in")} cursor="pointer" isAnimationActive={false} />
              <Bar dataKey="forecastIn" name="Entradas previstas" stackId="in" fill="url(#hatch-in)" stroke={IN} strokeWidth={1} radius={[4, 4, 0, 0]} onClick={(d) => go(d, "in")} cursor="pointer" isAnimationActive={false} />
              <Bar dataKey="outR" name="Saídas realizadas" stackId="out" fill={OUT} onClick={(d) => go(d, "out")} cursor="pointer" isAnimationActive={false} />
              <Bar dataKey="outF" name="Saídas previstas" stackId="out" fill="url(#hatch-out)" stroke={OUT} strokeWidth={1} radius={[4, 4, 0, 0]} onClick={(d) => go(d, "out")} cursor="pointer" isAnimationActive={false} />
              {today && <ReferenceLine x={today} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "hoje", position: "top", fontSize: 10, fill: INK }} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {showBalance && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">Saldo projetado ao fim de cada período (realizado + previsto)</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} onClick={(d: any) => go(d, "all")}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={8} />
                <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} width={72} domain={["auto", "auto"]} />
                <Tooltip content={<TooltipBox kind="balance" />} />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                {today && <ReferenceLine x={today} stroke="#94a3b8" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="balance" name="Saldo projetado" stroke="#183772" strokeWidth={2} dot={{ r: 3, fill: "#183772", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
