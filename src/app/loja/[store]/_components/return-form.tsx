"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/server/action";

/** Pedido de devolução pelo cliente (arrependimento, defeito ou outro motivo). */
export function ReturnForm({ action }: { action: (fd: FormData) => Promise<ActionResult<any>> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
        Solicitar devolução
      </button>
    );
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await action(fd);
          if (!r.ok) return toast("error", r.error);
          toast("success", r.message ?? "Solicitação registrada.");
          router.refresh();
        });
      }}
    >
      <label className="block text-sm font-medium text-slate-800">
        Motivo
        <select name="reason" className="mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm" defaultValue="withdrawal">
          <option value="withdrawal">Desisti da compra (arrependimento)</option>
          <option value="defect">Produto com defeito</option>
          <option value="other">Outro motivo</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Conte o que aconteceu
        <textarea name="details" required minLength={5} rows={3} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-[var(--store-accent)] px-4 py-2 text-sm font-semibold text-[var(--store-on-accent)] disabled:opacity-50">Enviar solicitação</button>
    </form>
  );
}
