"use client";

import { formatDateTimeSeconds } from "@/lib/dates";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { resendInviteAction } from "./actions";

type Invite = { link: string; delivered: boolean; channel: string; message: string | null; expiresAt: string };

export function InviteLinkPanel({ invite }: { invite: Invite }) {
  const toast = useToast();
  const expires = formatDateTimeSeconds(invite.expiresAt);
  return (
    <Notice tone={invite.delivered ? "good" : "warn"} title={invite.delivered ? "Convite enviado por e-mail" : "Convite criado — e-mail NÃO enviado"}>
      {invite.delivered ? (
        <p>O provedor de e-mail ({invite.channel}) aceitou a mensagem. O link expira em {expires}.</p>
      ) : (
        <p>
          {invite.message ?? "Canal de e-mail não configurado."} Copie o link abaixo e entregue ao usuário por um canal seguro. Ele é exibido somente agora e expira em {expires}.
        </p>
      )}
      {!invite.delivered && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="max-w-full break-all rounded bg-white/70 px-2 py-1 text-xs" data-testid="invite-link">
            {invite.link}
          </code>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invite.link);
                toast("success", "Link copiado.");
              } catch {
                toast("error", "Não foi possível copiar automaticamente; selecione o texto do link.");
              }
            }}
          >
            <Copy className="size-4" /> Copiar link
          </Button>
        </div>
      )}
    </Notice>
  );
}

export function ResendInviteButton({ id, label = "Reenviar convite" }: { id: string; label?: string }) {
  const [pending, start] = useTransition();
  const [invite, setInvite] = useState<Invite | null>(null);
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="contents">
      <Button
        type="button"
        loading={pending}
        onClick={() => {
          if (!window.confirm("Gerar novo link de convite? O link anterior deixará de funcionar.")) return;
          start(async () => {
            const r = await resendInviteAction(id);
            if (!r.ok) return toast("error", r.error);
            toast(r.data && (r.data as any).invite?.delivered ? "success" : "info", r.message ?? "Convite gerado.");
            setInvite((r.data as any).invite);
            router.refresh();
          });
        }}
      >
        <Send className="size-4" /> {label}
      </Button>
      {invite && (
        <div className="basis-full">
          <InviteLinkPanel invite={invite} />
        </div>
      )}
    </div>
  );
}
