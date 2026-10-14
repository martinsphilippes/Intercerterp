"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { inputClass } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { percentTextToBps } from "./percent";

interface Row {
  brand: string;
  min: string;
  max: string;
  fee: string;
  days: string;
}

interface FeeRow {
  brand: string | null;
  minInstallments: number;
  maxInstallments: number;
  feeBps: number;
  settlementDays: number;
}

const toRow = (r: FeeRow): Row => ({ brand: r.brand ?? "", min: String(r.minInstallments), max: String(r.maxInstallments), fee: (r.feeBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }), days: String(r.settlementDays) });

/**
 * FIN-24 — Tabela de taxas do meio de cartão por bandeira × faixa de parcelas (taxa % e prazo do 1º crédito em dias).
 * Bandeira vazia = qualquer bandeira. Enviada como JSON em `feeTable` (o servidor valida faixas e limites).
 */
export function FeeTableEditor({ initial, brands, maxHint }: { initial: FeeRow[] | null | undefined; brands: string[]; maxHint: number }) {
  const [rows, setRows] = useState<Row[]>(() => (initial ?? []).map(toRow));
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const json = rows
    .filter((r) => r.brand.trim() || r.fee.trim())
    .map((r) => ({ brand: r.brand.trim() || null, minInstallments: Number(r.min) || 1, maxInstallments: Number(r.max) || Number(r.min) || 1, feeBps: percentTextToBps(r.fee) ?? -1, settlementDays: Number(r.days) || 0 }));
  const listId = "fee-table-brands";
  return (
    <div className="rounded-md border border-line bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Taxas por bandeira e nº de parcelas</p>
          <p className="text-xs text-slate-500">Vale para cartões. Na venda, usa a linha da bandeira e das parcelas; bandeira vazia = qualquer bandeira. Sem linha aplicável, valem a taxa e o prazo acima.</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, { brand: "", min: "1", max: "1", fee: "", days: "30" }])}>
          <Plus className="size-4" aria-hidden /> Linha
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sem tabela: a venda usa a taxa e o prazo únicos do meio.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Bandeira</th>
                <th className="py-1 pr-2 font-medium">Parcelas de</th>
                <th className="py-1 pr-2 font-medium">até</th>
                <th className="py-1 pr-2 font-medium">Taxa (%)</th>
                <th className="py-1 pr-2 font-medium">Crédito em (dias)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bad = percentTextToBps(r.fee) == null;
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <input className={cn(inputClass, "h-8 min-w-[120px]")} list={listId} value={r.brand} placeholder="Qualquer" onChange={(e) => set(i, { brand: e.target.value })} aria-label="Bandeira" maxLength={40} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={cn(inputClass, "tabular h-8 w-16 text-right")} type="number" min={1} max={maxHint} value={r.min} onChange={(e) => set(i, { min: e.target.value })} aria-label="Parcelas de" />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={cn(inputClass, "tabular h-8 w-16 text-right")} type="number" min={1} max={maxHint} value={r.max} onChange={(e) => set(i, { max: e.target.value })} aria-label="Parcelas até" />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={cn(inputClass, "tabular h-8 w-20 text-right", bad && "border-red-400")} inputMode="decimal" value={r.fee} onChange={(e) => set(i, { fee: e.target.value.replace(/[^\d,.]/g, "") })} aria-label="Taxa em %" aria-invalid={bad} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={cn(inputClass, "tabular h-8 w-20 text-right")} type="number" min={0} max={400} value={r.days} onChange={(e) => set(i, { days: e.target.value })} aria-label="Dias até o crédito" />
                    </td>
                    <td className="py-1 text-right">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} title="Remover linha" aria-label="Remover linha">
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <datalist id={listId}>
        {brands.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <input type="hidden" name="feeTable" value={JSON.stringify(json)} />
    </div>
  );
}
