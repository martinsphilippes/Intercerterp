"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const Ctx = createContext<(tone: ToastTone, message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastTone, message: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, message }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === "error" ? 9000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${t.tone === "error" ? "border-red-200 bg-red-50 text-red-900" : t.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-sky-200 bg-white text-ink"}`}>
            {t.tone === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : t.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button type="button" aria-label="Fechar" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
