"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

/** Diálogo modal acessível (ações curtas). */
export function Dialog({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className={cn("m-auto w-[calc(100vw-2rem)] rounded-lg border border-line bg-white p-0 shadow-xl", w)}>
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="focus-ring rounded p-1 hover:bg-slate-100">
              <X className="size-4" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Painel lateral para consulta rápida. */
export function Drawer({ open, onClose, title, children, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Fechar painel" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className={cn("relative flex h-full w-full flex-col bg-white shadow-2xl", width)}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="focus-ring rounded p-1 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
