"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { percentTextToBps } from "./percent";

/** Percentual digitado em % (aceita vírgula ou ponto decimal, até 2 casas) e enviado em pontos-base (1% = 100). */
export function PercentField({ name, value }: { name: string; value: number }) {
  const [text, setText] = useState((value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
  const bps = percentTextToBps(text);
  const shown = bps == null ? null : (bps / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div>
      <div className="relative">
        <input
          inputMode="decimal"
          className={cn(inputClass, "tabular h-9 pr-8 text-right", bps == null && "border-red-400")}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d,.]/g, ""))}
          aria-label="Percentual"
          aria-invalid={bps == null}
        />
        <span className="pointer-events-none absolute right-3 top-2 text-sm text-slate-400">%</span>
      </div>
      {/* valor interpretado: o usuário vê exatamente o que será gravado */}
      <p className={cn("mt-0.5 text-right text-xs", bps == null ? "text-red-700" : "text-slate-500")}>{bps == null ? "Percentual inválido" : `Será gravado: ${shown}%`}</p>
      {/* inválido → -1: o servidor recusa pelos limites em vez de gravar 0% */}
      <input type="hidden" name={name} value={bps ?? -1} />
    </div>
  );
}
