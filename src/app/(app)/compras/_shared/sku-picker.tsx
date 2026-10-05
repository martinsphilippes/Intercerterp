"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { searchSkusAction, type SkuHit } from "./actions";

/** Seletor de produto (SKU) com pesquisa no servidor; mostra código e último custo do fornecedor quando informado. */
export function SkuPicker({ onPick, supplierId, placeholder, className, autoFocus, exclude = [] }: { onPick: (hit: SkuHit) => void; supplierId?: string | null; placeholder?: string; className?: string; autoFocus?: boolean; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => {
      start(async () => {
        const r = await searchSkusAction(q, supplierId ?? null);
        if (!r.ok) return setError(r.error);
        setError(null);
        setHits((r.data ?? []).filter((h) => !exclude.includes(h.id)));
        setOpen(true);
      });
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, supplierId]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (hits[0]) {
              onPick(hits[0]);
              setQ("");
              setHits([]);
            }
          }
        }}
        placeholder={placeholder ?? "Pesquisar produto por nome, SKU, código de barras ou código do fornecedor"}
        aria-label="Pesquisar produto"
        className={cn(inputClass, "h-9 pl-8")}
      />
      {pending && <span className="absolute right-2.5 top-2.5 size-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && q.trim().length >= 2 && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {hits.length === 0 && !pending && <li className="px-3 py-2 text-sm text-slate-500">Nenhum produto encontrado.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(h);
                  setQ("");
                  setHits([]);
                  setOpen(false);
                }}
              >
                <span>
                  <span className="font-medium text-ink">{h.name}</span>
                  <span className="block text-xs text-slate-500">
                    {h.sku}
                    {h.barcode ? ` · ${h.barcode}` : ""}
                    {h.supplierCode ? ` · cód. fornecedor ${h.supplierCode}` : ""}
                  </span>
                </span>
                <span className="tabular whitespace-nowrap text-xs text-slate-500">{h.lastCost != null ? `último ${formatMoney(h.lastCost)}` : `custo ${formatMoney(h.costAcquisition)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
