"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startRecoveryAction } from "./actions";
import { InviteLinkPanel } from "./invite-link";

type Recovery = { link: string; delivered: boolean; channel: string; message: string | null; expiresAt: string };

/**
 * Recuperação de senha iniciada pelo administrador: gera um link de uso único com validade (o anterior deixa de valer).
 * Vai por e-mail quando há canal; sem canal, o link aparece aqui uma única vez para ser entregue por um canal seguro.
 */
export function StartRecoveryButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="contents">
      <Button
        type="button"
        loading={pending}
        onClick={() => {
          if (!window.confirm(`Enviar a ${name} um link para definir uma nova senha? O link vale uma única vez; um link anterior deixa de funcionar. A senha atual continua valendo até a nova ser definida — aí as sessões abertas são encerradas.`)) return;
          start(async () => {
            const r = await startRecoveryAction(id);
            if (!r.ok) return toast("error", r.error);
            const rec = (r.data as { recovery: Recovery } | undefined)?.recovery ?? null;
            toast(rec?.delivered ? "success" : "info", r.message ?? "Link gerado.");
            setRecovery(rec);
            router.refresh();
          });
        }}
      >
        <Mail className="size-4" /> Enviar link de recuperação
      </Button>
      {recovery && (
        <div className="basis-full">
          <InviteLinkPanel invite={recovery} kind="recovery" />
        </div>
      )}
    </div>
  );
}
