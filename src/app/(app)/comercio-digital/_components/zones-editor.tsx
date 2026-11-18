"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { inputClass } from "@/components/ui/form";

export interface ZoneRow {
  name: string;
  zipFrom: string;
  zipTo: string;
  price: number;
  days: number;
}

const fmtZip = (v: string) => v.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");

/** Entrega própria (Tela 58): faixas de CEP com preço e prazo — enviadas como JSON no campo "zones". */
export function ZonesEditor({ initial }: { initial: ZoneRow[] }) {
  const [rows, setRows] = useState<ZoneRow[]>(initial.length ? initial : [{ name: "", zipFrom: "", zipTo: "", price: 0, days: 1 }]);
  const set = (i: number, patch: Partial<ZoneRow>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const clean = rows.filter((r) => r.zipFrom.replace(/\D/g, "").length >= 5).map((r) => ({ ...r, zipFrom: r.zipFrom.replace(/\D/g, ""), zipTo: r.zipTo.replace(/\D/g, "") }));
  return (
    <div className="space-y-2">
      <input type="hidden" name="zones" value={JSON.stringify(clean)} />
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th>Região (nome)</th>
              <th>CEP inicial</th>
              <th>CEP final</th>
              <th>Preço</th>
              <th>Prazo (dias úteis)</th>
              <th className="sr-only">Remover</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className={inputClass} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Ex.: Centro e Bela Vista" aria-label={`Nome da região ${i + 1}`} /></td>
                <td><input className={`${inputClass} tabular w-28`} value={fmtZip(r.zipFrom)} onChange={(e) => set(i, { zipFrom: e.target.value })} placeholder="01000-000" inputMode="numeric" aria-label={`CEP inicial da região ${i + 1}`} /></td>
                <td><input className={`${inputClass} tabular w-28`} value={fmtZip(r.zipTo)} onChange={(e) => set(i, { zipTo: e.target.value })} placeholder="01599-999" inputMode="numeric" aria-label={`CEP final da região ${i + 1}`} /></td>
                <td className="w-36"><MoneyInput value={r.price} onChange={(v) => set(i, { price: v })} ariaLabel={`Preço da região ${i + 1}`} /></td>
                <td className="w-28"><input className={`${inputClass} tabular`} type="number" min={0} max={30} value={r.days} onChange={(e) => set(i, { days: Number(e.target.value) || 0 })} aria-label={`Prazo da região ${i + 1}`} /></td>
                <td className="w-10">
                  <button type="button" onClick={() => setRows((x) => x.filter((_, k) => k !== i))} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-red-700" aria-label={`Remover região ${i + 1}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setRows((r) => [...r, { name: "", zipFrom: "", zipTo: "", price: 0, days: 1 }])} className="flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <Plus className="size-4" aria-hidden /> Adicionar faixa de CEP
      </button>
      <p className="text-xs text-slate-500">Prazo 0 = entrega no mesmo dia útil. Faixas sem CEP inicial são ignoradas; o CEP final em branco vale até o fim da faixa iniciada.</p>
    </div>
  );
}
