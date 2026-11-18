"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copia um texto (registro DNS, código Pix, link da loja) para a área de transferência. */
export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* navegador sem permissão de área de transferência: o texto continua visível para copiar à mão */
        }
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
      aria-label={`${label}: ${text}`}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {done ? "Copiado" : label}
    </button>
  );
}
