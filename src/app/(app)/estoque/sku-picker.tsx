"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { searchSkusAction } from "./actions";

export interface SkuHit {
  id: string;
  sku: string;
  name: string;
  unitCode: string;
  barcode: string | null;
  physical: number;
  available: number;
  avgCost: number;
  location?: string | null;
  minQty?: number;
}

const fmt = (m: number) => (m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Seletor de SKU com pesquisa (nome, SKU ou código de barras/leitor). Mostra o disponível no depósito informado. */
export function SkuPicker({ value, onChange, warehouseId, placeholder = "Produto, SKU ou código de barras", autoFocus, clearOnSelect }: { value?: SkuHit | null; onChange: (s: SkuHit | null) => void; warehouseId?: string | null; placeholder?: string; autoFocus?: boolean; clearOnSelect?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const listId = useId();
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchSkusAction(q, warehouseId ?? null);
      if (my !== seq.current) return;
      setLoading(false);
      setHits(r.ok ? ((r.data as SkuHit[]) ?? []) : []);
      setActive(0);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q, warehouseId]);
  const pick = (h: SkuHit) => {
    onChange(h);
    setOpen(false);
    setQ("");
    setHits([]);
  };
  if (value && !clearOnSelect) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-line bg-slate-50 px-3 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-mono text-xs">{value.sku}</span> — {value.name}
          {warehouseId && <span className="ml-2 text-xs text-slate-500">disp. {fmt(value.available)} {value.unitCode}</span>}
        </span>
        <button type="button" aria-label="Trocar produto" className="rounded p-0.5 hover:bg-slate-200" onClick={() => onChange(null)}>
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
      <input
        className={cn(inputClass, "h-9 pl-8")}
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Pesquisar produto"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (hits[active]) pick(hits[active]);
          }
        }}
      />
      {open && (q.trim().length >= 2) && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-white py-1 text-sm shadow-lg">
          {loading && hits.length === 0 && <li className="px-3 py-2 text-slate-500">Pesquisando…</li>}
          {!loading && hits.length === 0 && <li className="px-3 py-2 text-slate-500">Nenhum produto encontrado.</li>}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left", i === active ? "bg-brand-50" : "hover:bg-slate-50")}>
                <span className="min-w-0">
                  <span className="block truncate">{h.name}</span>
                  <span className="block font-mono text-xs text-slate-500">{h.sku}{h.barcode ? ` · ${h.barcode}` : ""}</span>
                </span>
                {warehouseId && <span className="tabular shrink-0 text-xs text-slate-600">disp. {fmt(h.available)} {h.unitCode}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
