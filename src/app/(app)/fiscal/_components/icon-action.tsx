"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import type { ActionResult } from "@/lib/server/action";

/** Botão de ícone para ações de linha (com confirmação, bloqueio de duplo clique e retorno real). */
export function IconAction({ action, title, confirm, children }: { action: (fd: FormData) => Promise<ActionResult<any>>; title: string; confirm?: string; children: React.ReactNode }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={pending}
      className="focus-ring inline-flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-brand-700 disabled:opacity-50"
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData();
        fd.set("_idem", idem);
        start(async () => {
          const r = await action(fd);
          if (!r.ok) toast("error", r.error);
          else toast("success", r.message ?? "Concluído.");
          router.refresh();
        });
      }}
    >
      {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : children}
    </button>
  );
}
