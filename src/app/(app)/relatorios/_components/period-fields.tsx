"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";

/** Período: preset ou intervalo personalizado. Alterar uma data muda o período para "Personalizado". */
export function PeriodFields({ preset, from, to, presets }: { preset: string; from: string; to: string; presets: Array<{ key: string; label: string }> }) {
  const [p, setP] = useState(preset);
  const [de, setDe] = useState(from);
  const [ate, setAte] = useState(to);
  const custom = p === "personalizado";
  return (
    <>
      <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-slate-600">
        Período
        <select name="periodo" value={p} onChange={(e) => setP(e.target.value)} className={cn(inputClass, "h-9")}>
          {presets.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        De
        <input
          type="date"
          name={custom ? "de" : undefined}
          value={de}
          max={ate || undefined}
          onChange={(e) => {
            setDe(e.target.value);
            setP("personalizado");
          }}
          className={cn(inputClass, "h-9", !custom && "text-slate-500")}
          aria-describedby="period-hint"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Até
        <input
          type="date"
          name={custom ? "ate" : undefined}
          value={ate}
          min={de || undefined}
          onChange={(e) => {
            setAte(e.target.value);
            setP("personalizado");
          }}
          className={cn(inputClass, "h-9", !custom && "text-slate-500")}
          aria-describedby="period-hint"
        />
      </label>
      <span id="period-hint" className="sr-only">
        Alterar as datas seleciona o período personalizado. O último dia é incluído integralmente.
      </span>
    </>
  );
}
