"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/server/action";

export interface VariantView {
  skuId: string;
  label: string;
  price: number;
  available: number;
}

const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Tela 62: variação (tamanho/cor), quantidade limitada ao disponível, "Adicionar ao carrinho" e "Comprar agora". */
export function BuyBox({ slug, variants, axis, action, compareAt, canBuy }: { slug: string; variants: VariantView[]; axis: string | null; action: (fd: FormData) => Promise<ActionResult<any>>; compareAt: number | null; canBuy: boolean }) {
  const firstAvailable = variants.find((v) => v.available > 0) ?? variants[0];
  const [skuId, setSkuId] = useState(variants.length === 1 ? variants[0].skuId : (firstAvailable?.skuId ?? ""));
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const v = variants.find((x) => x.skuId === skuId) ?? null;
  const max = v ? Math.min(v.available, 99) : 0;
  const submit = (buyNow: boolean) => {
    if (!v) return toast("error", `Escolha ${axis ? axis.toLowerCase() : "a variação"}.`);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("skuId", v.skuId);
    fd.set("qty", String(Math.min(qty, max)));
    if (buyNow) fd.set("buyNow", "1");
    start(async () => {
      const r = await action(fd);
      if (!r.ok) return toast("error", r.error);
      toast("success", r.message ?? "Produto adicionado ao carrinho.");
      if (r.redirect) router.push(r.redirect);
      else router.refresh();
    });
  };
  return (
    <div className="space-y-4">
      <div>
        {compareAt && v && compareAt > v.price && <p className="text-sm text-slate-400 line-through">{money(compareAt)}</p>}
        <p className="text-3xl font-bold text-slate-900">{v ? money(v.price) : money(Math.min(...variants.map((x) => x.price)))}</p>
        <p className="mt-1 text-sm text-slate-500">Pix, cartão ou boleto. Condições definidas no checkout.</p>
      </div>
      {variants.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-slate-900">{axis ?? "Variação"}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((x) => (
              <button
                key={x.skuId}
                type="button"
                onClick={() => setSkuId(x.skuId)}
                disabled={x.available < 1}
                aria-pressed={x.skuId === skuId}
                className={`min-w-12 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through ${x.skuId === skuId ? "border-[var(--store-accent)] bg-[color-mix(in_srgb,var(--store-accent)_10%,white)] text-slate-900" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {v && (variants.length > 1 || v.available <= 5) && (
        <p className={`text-sm font-medium ${v.available > 0 ? "text-emerald-700" : "text-red-700"}`}>
          {v.available > 5 ? "Disponível" : v.available > 0 ? `Últimas ${v.available} unidades` : "Sem estoque no momento"}
        </p>
      )}
      <div className="flex items-end gap-3">
        <label className="text-sm font-semibold text-slate-900">
          Quantidade
          <input type="number" min={1} max={Math.max(1, max)} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(Math.max(1, max), Math.floor(Number(e.target.value) || 1))))} className="mt-1 block h-10 w-24 rounded-md border border-slate-300 px-3 text-base" disabled={!v || max < 1} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !canBuy || !v || max < 1} onClick={() => submit(false)} className="inline-flex items-center gap-2 rounded-md bg-[var(--store-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--store-on-accent)] shadow-sm hover:brightness-95 disabled:opacity-50">
          <ShoppingBag className="size-4" aria-hidden /> Adicionar ao carrinho
        </button>
        <button type="button" disabled={pending || !canBuy || !v || max < 1} onClick={() => submit(true)} className="rounded-md border border-[color-mix(in_srgb,var(--store-accent)_30%,white)] bg-[color-mix(in_srgb,var(--store-accent)_8%,white)] px-5 py-2.5 text-sm font-semibold text-[var(--store-accent)] hover:brightness-95 disabled:opacity-50">
          Comprar agora
        </button>
      </div>
      {!canBuy && <p className="text-sm text-amber-800">A loja não está recebendo pedidos no momento.</p>}
    </div>
  );
}
