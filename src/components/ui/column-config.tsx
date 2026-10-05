"use client";

import { useEffect, useState } from "react";
import { Columns3 } from "lucide-react";
import { buttonClass } from "./button";

/** Preferência de colunas visíveis por tabela (armazenada no navegador do usuário). */
export function ColumnConfig({ tableId, columns }: { tableId: string; columns: Array<{ key: string; label: string; hidden?: boolean; fixed?: boolean }> }) {
  const storageKey = `ic.cols.${tableId}`;
  const defaults = columns.filter((c) => c.hidden).map((c) => c.key);
  const [hidden, setHidden] = useState<string[]>(defaults);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v) setHidden(JSON.parse(v));
    } catch {
      /* sem armazenamento */
    }
  }, [storageKey]);
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const css = hidden.map((k) => `[data-table="${tableId}"] [data-col="${k}"]{display:none}`).join("");
  return (
    <div className="relative">
      <style>{css}</style>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Columns3 className="size-4" aria-hidden /> Colunas
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-white p-2 shadow-lg" onMouseLeave={() => setOpen(false)}>
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" className="accent-brand-700" disabled={c.fixed} checked={!hidden.includes(c.key)} onChange={() => toggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
