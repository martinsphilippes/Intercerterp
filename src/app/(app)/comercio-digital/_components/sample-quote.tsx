"use client";

import { useState, useTransition } from "react";
import { Calculator } from "lucide-react";
import { Field, inputClass } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Spinner } from "@/components/ui/button";
import type { ActionResult } from "@/lib/server/action";

type Quote = { options: Array<{ id: string; label: string; detail: string; price: number; free: boolean; simulated: boolean }>; problems: string[] };

const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Tela 58 "Cotação de exemplo": as mesmas regras do carrinho, para um destino e um pacote demonstrativo. */
export function SampleQuote({ action }: { action: (fd: FormData) => Promise<ActionResult<Quote>> }) {
  const [zip, setZip] = useState("01310-100");
  const [value, setValue] = useState(15000);
  const [weight, setWeight] = useState(800);
  const [res, setRes] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("zip", zip);
      fd.set("value", String(value));
      fd.set("weight", String(weight));
      const r = await action(fd);
      if (!r.ok) {
        setError(r.error);
        setRes(null);
      } else {
        setError(null);
        setRes(r.data ?? null);
      }
    });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="CEP de destino" htmlFor="sq-zip">
          <input id="sq-zip" className={`${inputClass} tabular`} value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Valor dos produtos">
          <MoneyInput value={value} onChange={setValue} ariaLabel="Valor dos produtos" />
        </Field>
        <Field label="Peso (gramas)" htmlFor="sq-w">
          <input id="sq-w" className={`${inputClass} tabular`} type="number" min={1} value={weight} onChange={(e) => setWeight(Number(e.target.value) || 1)} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">Pacote demonstrativo com a embalagem padrão da loja. Nenhum frete é contratado.</p>
      <button type="button" onClick={run} disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-60">
        {pending ? <Spinner /> : <Calculator className="size-4" aria-hidden />} Calcular exemplo
      </button>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {res && (
        <div className="space-y-2" aria-live="polite">
          {res.options.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-ink">{o.label}</p>
                <p className="text-xs text-slate-500">{o.detail}</p>
              </div>
              <p className="tabular text-sm font-semibold text-ink">{o.free ? <span className="text-emerald-700">Grátis</span> : money(o.price)}</p>
            </div>
          ))}
          {res.problems.map((p) => (
            <p key={p} className="text-sm text-amber-800">{p}</p>
          ))}
          {res.options.some((o) => o.simulated) && <p className="text-xs text-slate-500">Cotação de exemplo, sem consulta a transportadoras (logística em simulação).</p>}
        </div>
      )}
    </div>
  );
}
