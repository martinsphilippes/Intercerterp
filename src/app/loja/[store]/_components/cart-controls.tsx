"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/server/action";

type Act = (fd: FormData) => Promise<ActionResult<any>>;

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (a: Act, fd = new FormData(), after?: () => void) =>
    start(async () => {
      const r = await a(fd);
      if (!r.ok) return toast("error", r.error);
      if (r.message) toast("success", r.message);
      after?.();
      if (r.redirect) router.push(r.redirect);
      else router.refresh();
    });
  return { pending, run };
}

/** Tela 63: − / + e remover (o servidor limita ao disponível e recalcula os totais). */
export function QtyStepper({ units, max, dec, inc, remove, label }: { units: number; max: number; dec: Act; inc: Act; remove: Act; label: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex items-center rounded-md border border-slate-300" role="group" aria-label={`Quantidade de ${label}`}>
        <button type="button" disabled={pending} onClick={() => run(dec)} className="flex size-9 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40" aria-label="Diminuir"><Minus className="size-4" aria-hidden /></button>
        <span className="w-10 text-center text-sm font-medium tabular-nums" aria-live="polite">{units}</span>
        <button type="button" disabled={pending || units >= max} onClick={() => run(inc)} className="flex size-9 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40" aria-label="Aumentar"><Plus className="size-4" aria-hidden /></button>
      </div>
      <button type="button" disabled={pending} onClick={() => run(remove)} className="text-sm font-semibold text-[var(--store-accent)] hover:underline disabled:opacity-40">Remover</button>
    </div>
  );
}

export function CouponBox({ applied, problem, apply, remove }: { applied: string | null; problem: string | null; apply: Act; remove: Act }) {
  const { pending, run } = useRun();
  const [code, setCode] = useState("");
  if (applied)
    return (
      <div className="flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <span>Cupom <strong>{applied}</strong> aplicado</span>
        <button type="button" disabled={pending} onClick={() => run(remove)} className="font-semibold hover:underline">Remover</button>
      </div>
    );
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("code", code);
        run(apply, fd, () => setCode(""));
      }}
    >
      <label className="sr-only" htmlFor="coupon">Cupom de desconto</label>
      <input id="coupon" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Digite seu cupom" className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm uppercase" />
      <button type="submit" disabled={pending || !code.trim()} className="rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">Aplicar</button>
      {problem && <p className="sr-only" role="alert">{problem}</p>}
    </form>
  );
}

export function ZipBox({ zip, setZip }: { zip: string | null; setZip: Act }) {
  const { pending, run } = useRun();
  const [v, setV] = useState(zip ? zip.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("zip", v);
        run(setZip, fd);
      }}
    >
      <label className="sr-only" htmlFor="zip">CEP para calcular a entrega</label>
      <input id="zip" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2"))} inputMode="numeric" placeholder="00000-000" className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm tabular-nums" />
      <button type="submit" disabled={pending || v.replace(/\D/g, "").length !== 8} className="rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">Calcular</button>
    </form>
  );
}

export function DeliveryChoice({ options, selectedId, select }: { options: Array<{ id: string; label: string; detail: string; price: number; free: boolean }>; selectedId: string | null; select: Record<string, Act> }) {
  const { pending, run } = useRun();
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Forma de entrega">
      {options.map((o) => {
        const on = o.id === selectedId;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() => run(select[o.id])}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left ${on ? "border-[var(--store-accent)] bg-[color-mix(in_srgb,var(--store-accent)_7%,white)]" : "border-slate-200 bg-white hover:border-slate-300"}`}
          >
            <span className="flex items-center gap-3">
              <span className={`flex size-4 items-center justify-center rounded-full border-2 ${on ? "border-[var(--store-accent)]" : "border-slate-300"}`} aria-hidden>{on && <span className="size-2 rounded-full bg-[var(--store-accent)]" />}</span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.detail}</span>
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">{o.free ? <span className="text-emerald-700">Grátis</span> : (o.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Ação simples com botão (cancelar pedido, simular pagamento, nova cobrança). */
export function StoreActionButton({ action, label, confirm, tone = "accent" }: { action: Act; label: string; confirm?: string; tone?: "accent" | "plain" | "danger" }) {
  const { pending, run } = useRun();
  const cls = tone === "accent" ? "bg-[var(--store-accent)] text-[var(--store-on-accent)] hover:brightness-95" : tone === "danger" ? "border border-red-300 bg-white text-red-700 hover:bg-red-50" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  return (
    <button type="button" disabled={pending} onClick={() => (!confirm || window.confirm(confirm)) && run(action)} className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${cls}`}>
      {label}
    </button>
  );
}
