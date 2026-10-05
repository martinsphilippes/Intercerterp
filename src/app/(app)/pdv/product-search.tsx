"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LayoutGrid, List, Loader2, ScanBarcode, Search, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty } from "@/lib/money";

export interface ProductHit {
  skuId: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  productName: string;
  attributes: Record<string, string>;
  unitCode: string;
  categoryId: string | null;
  categoryName: string | null;
  brandName?: string | null;
  productCode?: string | null;
  minQty?: number | null;
  service: boolean;
  hasVariants: boolean;
  listPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  maxDiscountBps: number | null;
  priced: boolean;
  available: number | null;
}

export interface ProductSearchHandle {
  focus: () => void;
  clear: () => void;
  isOpen: () => boolean;
  close: () => void;
  hasText: () => boolean;
}

/** Interpreta "3*7891000…" (quantidade × código) do leitor/teclado. */
function parseEntry(raw: string): { qty: number; term: string } {
  const m = raw.trim().match(/^(\d+(?:[.,]\d{1,3})?)\s*[*xX]\s*(.+)$/);
  if (m) return { qty: Math.round(Number(m[1].replace(",", ".")) * 1000), term: m[2].trim() };
  return { qty: 1000, term: raw.trim() };
}

const looksLikeCode = (t: string) => /^[0-9]{6,14}$/.test(t) || /^[A-Z0-9][A-Z0-9-]{2,}$/.test(t);

/**
 * Busca de produtos do PDV (Tela 5): descrição, SKU e código de barras com debounce e limite,
 * categorias, lista ou grade, preço da tabela, unidade e disponível na filial; escolha de variação e quantidade.
 * Enter com código (leitor) resolve o SKU exato e adiciona sem sair do atendimento.
 */
export const ProductSearch = forwardRef<ProductSearchHandle, {
  priceTableId: string | null;
  categories: Array<{ value: string; label: string }>;
  brands: Array<{ value: string; label: string }>;
  branchName: string;
  allowNegative: boolean;
  onAdd: (hit: ProductHit, qty: number) => boolean | void;
  onKeyPassthrough?: (e: React.KeyboardEvent<HTMLInputElement>) => boolean;
  disabled?: boolean;
}>(function ProductSearch({ priceTableId, categories, brands, branchName, allowNegative, onAdd, onKeyPassthrough, disabled }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [scannerHint, setScannerHint] = useState(false);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [view, setView] = useState<"list" | "grid">("list");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});
  const reqId = useRef(0);

  useEffect(() => {
    try {
      const v = localStorage.getItem("ic.pdv.searchView");
      if (v === "grid" || v === "list") setView(v);
    } catch {
      /* sem armazenamento */
    }
  }, []);

  const fetchHits = useCallback(
    async (params: Record<string, string>) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ ...params, ...(priceTableId ? { tabela: priceTableId } : {}) });
        const res = await fetch(`/api/pdv/products?${qs}`, { cache: "no-store" });
        const body = await res.json();
        if (id !== reqId.current) return null;
        if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
        return body as { items: ProductHit[]; exact: boolean };
      } catch (e: any) {
        if (id === reqId.current) setError(e.message ?? "Falha na busca");
        return null;
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [priceTableId],
  );

  // busca com debounce: evita consultar o catálogo a cada tecla
  useEffect(() => {
    if (!open) return;
    const { term } = parseEntry(text);
    if (term.length < 2 && !category && !brand) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetchHits({ q: term, ...(category ? { categoria: category } : {}), ...(brand ? { marca: brand } : {}), limit: "30" });
      if (r) {
        setHits(r.items);
        setActive(0);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text, category, brand, open, fetchHits]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    },
    clear: () => {
      setText("");
      setHits([]);
    },
    isOpen: () => open && (text.length > 0 || Boolean(category) || Boolean(brand)),
    close: () => {
      setOpen(false);
      setText("");
      setCategory("");
      setBrand("");
      setHits([]);
    },
    hasText: () => text.length > 0,
  }));

  const groups = useMemo(() => {
    const m = new Map<string, ProductHit[]>();
    for (const h of hits) m.set(h.productId, [...(m.get(h.productId) ?? []), h]);
    return [...m.values()];
  }, [hits]);

  const add = (hit: ProductHit, qty: number) => {
    const ok = onAdd(hit, qty);
    if (ok !== false) {
      setText("");
      setHits([]);
      setOpen(false);
      inputRef.current?.focus();
    }
  };

  const submit = async () => {
    const { qty, term } = parseEntry(text);
    if (!term) return;
    // 1) leitor / código digitado: SKU exato
    if (looksLikeCode(term.toUpperCase())) {
      const r = await fetchHits({ code: term });
      if (r?.exact && r.items[0]) return add(r.items[0], qty);
    }
    // 2) resultado único da busca por texto
    const r = hits.length ? { items: hits } : await fetchHits({ q: term, limit: "30" });
    if (!r) return;
    if (r.items.length === 1) return add(r.items[0], qty);
    if (r.items.length > 1 && hits.length && hits[active]) return add(hits[active], qty);
    setHits(r.items);
    setOpen(true);
    if (!r.items.length) setError(`Nenhum produto para "${term}".`);
  };

  const showPanel = open && (text.trim().length >= 2 || Boolean(category) || Boolean(brand) || loading || error);
  const stockTone = (h: ProductHit) => {
    if (h.service || h.available == null) return { cls: "bg-slate-100 text-slate-600", label: "serviço" };
    if (h.available <= 0) return { cls: "bg-red-50 text-red-700 ring-1 ring-red-200", label: "Sem estoque" };
    if (h.minQty && h.available <= h.minQty) return { cls: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", label: `${formatQty(h.available)} em estoque` };
    return { cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200", label: `${formatQty(h.available)} em estoque` };
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            data-pdv-search
            disabled={disabled}
            value={text}
            autoComplete="off"
            spellCheck={false}
            aria-label="Buscar produto por descrição, SKU ou código de barras (F2)"
            placeholder={scannerHint ? "Leitor ativo: leia o código de barras…" : "Leia o código de barras ou pesquise por nome, código ou referência (F2)"}
            className="focus-ring h-12 w-full rounded-lg border border-line bg-white pl-11 pr-24 text-base text-ink placeholder:text-slate-400"
            onFocus={() => setOpen(true)}
            onBlur={() => setScannerHint(false)}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (onKeyPassthrough?.(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              } else if (e.key === "ArrowDown" && hits.length) {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp" && hits.length) {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
            }}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-slate-400">
            {loading ? <Loader2 className="size-4 animate-spin" aria-label="Buscando" /> : <ScanBarcode className="size-4" aria-hidden />}
            <kbd className="rounded border border-line px-1">F2</kbd>
          </span>
        </div>
        <button
          type="button"
          title="Leitor de código de barras (emulação de teclado): posiciona o foco no campo para a leitura"
          onClick={() => {
            setScannerHint(true);
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
          className={cn("focus-ring flex h-12 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium", scannerHint ? "border-accent-500 bg-accent-50 text-accent-700" : "border-line bg-white hover:border-brand-300")}
        >
          <ScanBarcode className="size-5" /> <span className="hidden sm:inline">Leitor</span>
        </button>
        <select
          aria-label="Marca"
          className="focus-ring hidden h-12 rounded-lg border border-line bg-white px-2 text-sm xl:block"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setOpen(true);
          }}
        >
          <option value="">Todas as marcas</option>
          {brands.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {showPanel && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-[62vh] flex-col overflow-hidden rounded-lg border border-line bg-white shadow-xl" role="listbox" aria-label="Resultados da busca">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs text-slate-500">
            <span className="tabular">{loading ? "Buscando…" : `${groups.length} produto(s) · ${hits.length} variação(ões)`} · Estoque: {branchName}</span>
            <div className="flex flex-1 gap-1 overflow-x-auto">
              <button type="button" onClick={() => setCategory("")} className={cn("whitespace-nowrap rounded-full border px-2 py-0.5", !category ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line")}>Todas</button>
              {categories.map((c) => (
                <button key={c.value} type="button" onClick={() => setCategory(category === c.value ? "" : c.value)} className={cn("whitespace-nowrap rounded-full border px-2 py-0.5", category === c.value ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line")}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" aria-label="Lista" aria-pressed={view === "list"} className={cn("rounded p-1", view === "list" && "bg-slate-100 text-ink")} onClick={() => { setView("list"); try { localStorage.setItem("ic.pdv.searchView", "list"); } catch {} }}>
                <List className="size-4" />
              </button>
              <button type="button" aria-label="Grade" aria-pressed={view === "grid"} className={cn("rounded p-1", view === "grid" && "bg-slate-100 text-ink")} onClick={() => { setView("grid"); try { localStorage.setItem("ic.pdv.searchView", "grid"); } catch {} }}>
                <LayoutGrid className="size-4" />
              </button>
              <button type="button" aria-label="Fechar busca (Esc)" className="rounded p-1 hover:bg-slate-100" onClick={() => { setOpen(false); setText(""); setCategory(""); setHits([]); }}>
                <X className="size-4" />
              </button>
            </div>
          </div>
          {error && <p className="px-3 py-3 text-sm text-red-700">{error}</p>}
          {!error && !loading && hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Nenhum produto encontrado. Confira o código ou busque pela descrição.</p>}
          <div className={cn("overflow-y-auto", view === "grid" && "grid grid-cols-2 gap-2 p-2 lg:grid-cols-3 xl:grid-cols-4")}>
            {groups.map((g) => {
              const p = g[0];
              const qty = qtyByProduct[p.productId] ?? 1000;
              return (
                <div key={p.productId} className={cn(view === "list" ? "border-b border-line px-3 py-2" : "rounded-md border border-line p-2")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{p.productName}</p>
                      <p className="text-xs text-slate-500">{[p.productCode, p.brandName, p.categoryName ?? "Sem categoria", p.unitCode].filter(Boolean).join(" • ")}{p.service ? " · serviço" : ""}</p>
                    </div>
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      Qtd
                      <input
                        type="number"
                        min={0.001}
                        step="any"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${p.productName}`}
                        className="focus-ring h-7 w-16 rounded border border-line px-1 text-right text-sm tabular"
                        value={qty / 1000}
                        onChange={(e) => setQtyByProduct((m) => ({ ...m, [p.productId]: Math.max(1, Math.round(Number(e.target.value || 0) * 1000)) }))}
                      />
                    </label>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.map((h) => {
                      const idx = hits.indexOf(h);
                      const noStock = !h.service && (h.available ?? 0) <= 0;
                      const blocked = !h.priced || (noStock && !allowNegative);
                      const tone = stockTone(h);
                      const attrs = Object.values(h.attributes ?? {}).join(" • ");
                      return (
                        <button
                          key={h.skuId}
                          type="button"
                          role="option"
                          aria-selected={idx === active}
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => add(h, qty)}
                          disabled={blocked}
                          title={!h.priced ? "Sem preço vigente na tabela selecionada" : noStock && !allowNegative ? "Sem estoque disponível — a configuração comercial não permite venda sem saldo" : `Adicionar ${h.name}`}
                          className={cn(
                            "focus-ring flex min-w-[140px] flex-col items-start rounded-md border px-2 py-1 text-left text-xs transition-colors",
                            idx === active ? "border-brand-500 bg-brand-50" : "border-line hover:border-brand-300",
                            blocked && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span className="font-medium text-ink">{attrs || h.sku}</span>
                          <span className="font-mono text-[11px] text-slate-500">{h.sku}{h.barcode ? ` · ${h.barcode}` : ""}</span>
                          <span className="tabular mt-0.5 flex w-full justify-between gap-2">
                            <span className="font-semibold text-ink">{h.priced ? formatMoney(h.listPrice) : "sem preço"}</span>
                            <span className={cn("rounded-full px-1.5 text-[11px]", tone.cls)}>{tone.label}</span>
                          </span>
                          {h.wholesalePrice && h.wholesaleMinQty ? <span className="text-[11px] text-accent-700">Atacado {formatMoney(h.wholesalePrice)} a partir de {formatQty(h.wholesaleMinQty)}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-slate-500">↑↓ escolher · Enter adicionar · Esc fechar · disponível = físico − reservado na filial</p>
        </div>
      )}
    </div>
  );
});
