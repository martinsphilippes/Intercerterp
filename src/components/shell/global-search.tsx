"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface Hit {
  group: string;
  label: string;
  sub?: string;
  href: string;
}

/** Pesquisa global (Ctrl+K): produtos, clientes, fornecedores, vendas, pedidos, títulos e documentos. */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setHits((await res.json()).hits ?? []);
          setActive(0);
        }
      } catch {
        /* abortado */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && hits[active]) go(hits[active]);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Pesquisar produtos, clientes, vendas, notas… (Ctrl+K)"
        aria-label="Pesquisa global"
        role="combobox"
        aria-controls="global-search-results"
        aria-expanded={open && hits.length > 0}
        className="focus-ring h-9 w-full rounded-md border border-line bg-slate-50 pl-8 pr-3 text-sm focus:bg-white"
      />
      {open && q.trim().length >= 2 && (
        <div id="global-search-results" role="listbox" className="absolute z-40 mt-1 max-h-[70vh] w-full overflow-y-auto rounded-md border border-line bg-white py-1 shadow-xl">
          {loading && hits.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Pesquisando…</p>}
          {!loading && hits.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Nada encontrado para “{q}”.</p>}
          {hits.map((h, i) => (
            <button
              key={h.href + i}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(h)}
              className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
            >
              <span className="mt-0.5 w-20 shrink-0 text-[11px] font-semibold uppercase text-slate-400">{h.group}</span>
              <span className="min-w-0">
                <span className="block truncate text-ink">{h.label}</span>
                {h.sub && <span className="block truncate text-xs text-slate-500">{h.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
