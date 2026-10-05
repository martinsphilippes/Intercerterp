"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";

/** Percentual digitado em % (aceita vírgula, até 2 casas) e enviado em pontos-base (1% = 100). */
export function PercentField({ name, value }: { name: string; value: number }) {
  const [text, setText] = useState((value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
  const bps = Math.round(Number(text.replace(/\./g, "").replace(",", ".") || 0) * 100);
  return (
    <div className="relative">
      <input inputMode="decimal" className={cn(inputClass, "tabular h-9 pr-8 text-right")} value={text} onChange={(e) => setText(e.target.value.replace(/[^\d,.]/g, ""))} aria-label="Percentual" />
      <span className="pointer-events-none absolute right-3 top-2 text-sm text-slate-400">%</span>
      <input type="hidden" name={name} value={Number.isFinite(bps) ? bps : 0} />
    </div>
  );
}
