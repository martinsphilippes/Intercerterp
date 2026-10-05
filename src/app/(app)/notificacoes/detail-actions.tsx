"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { markAction, archiveAction, unarchiveAction } from "./actions";

export function DetailActions({ id, read, canArchive, archived }: { id: string; read: boolean; canArchive: boolean; archived: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast("error", r.error);
      else toast("success", r.message ?? "Concluído.");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={pending} onClick={() => run(() => markAction([id], !read))}>
        {read ? "Marcar como não lida" : "Marcar como lida"}
      </Button>
      {archived ? (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => unarchiveAction([id]))}>
          Devolver à caixa de entrada
        </Button>
      ) : (
        <Button type="button" variant="ghost" disabled={pending || !canArchive} onClick={() => run(() => archiveAction([id]))} title={canArchive ? "Arquivar aviso" : "Disponível após a resolução na origem"}>
          Arquivar aviso
        </Button>
      )}
    </div>
  );
}
