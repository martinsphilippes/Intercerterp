"use client";

import { useState } from "react";
import { inputClass } from "./form";
import { cn } from "./cn";

function fmt(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Campo monetário: o usuário digita em reais (ex.: 1.234,56); o formulário envia centavos inteiros no `name`.
 */
export function MoneyInput({ name, defaultValue = 0, value, onChange, className, disabled, required, id, placeholder, autoFocus, ariaLabel }: { name?: string; defaultValue?: number | null; value?: number; onChange?: (cents: number) => void; className?: string; disabled?: boolean; required?: boolean; id?: string; placeholder?: string; autoFocus?: boolean; ariaLabel?: string }) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState<number>(defaultValue ?? 0);
  const cents = controlled ? value! : inner;
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">R$</span>
      <input
        id={id}
        inputMode="decimal"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        disabled={disabled}
        required={required}
        placeholder={placeholder ?? "0,00"}
        className={cn(inputClass, "tabular h-9 pl-9 text-right", className)}
        value={text ?? fmt(cents)}
        onFocus={(e) => {
          setText(cents ? fmt(cents) : "");
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          const raw = e.target.value.replace(/[^\d,.-]/g, "");
          const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
          const n = Math.round(Number(normalized || 0) * 100);
          if (Number.isFinite(n)) {
            if (!controlled) setInner(n);
            onChange?.(n);
          }
        }}
        onBlur={() => setText(null)}
      />
      {name && <input type="hidden" name={name} value={cents} />}
    </div>
  );
}

/** Quantidade: digitada em unidades (aceita vírgula), enviada em milésimos. */
export function QtyInput({ name, defaultValue = 1000, value, onChange, className, decimals = 3, id, ariaLabel, min }: { name?: string; defaultValue?: number; value?: number; onChange?: (milli: number) => void; className?: string; decimals?: number; id?: string; ariaLabel?: string; min?: number }) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const milli = controlled ? value! : inner;
  const [text, setText] = useState<string | null>(null);
  return (
    <>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        className={cn(inputClass, "tabular h-9 text-right", className)}
        value={text ?? (milli / 1000).toLocaleString("pt-BR", { maximumFractionDigits: decimals })}
        onFocus={(e) => {
          setText((milli / 1000).toLocaleString("pt-BR", { maximumFractionDigits: decimals }));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.round(Number(e.target.value.replace(/\./g, "").replace(",", ".") || 0) * 1000);
          if (Number.isFinite(n) && (min == null || n >= min)) {
            if (!controlled) setInner(n);
            onChange?.(n);
          }
        }}
        onBlur={() => setText(null)}
      />
      {name && <input type="hidden" name={name} value={milli} />}
    </>
  );
}
