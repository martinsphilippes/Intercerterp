"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { emailSendAction, whatsappSendAction } from "./actions";

/**
 * Enviar ao cliente: WhatsApp (abre wa.me com o texto e o link de visualização/impressão — sem API paga) e, quando o
 * canal de e-mail está configurado, envio por e-mail (só registra "enviado" se o provedor aceitar).
 */
export function SendDocument({ id, phone, email, emailConfigured, label }: { id: string; phone: string | null; email: string | null; emailConfigured: boolean; label: string }) {
  const [open, setOpen] = useState<null | "whatsapp" | "email">(null);
  const [tel, setTel] = useState(phone ?? "");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen("whatsapp")}>
        <MessageCircle className="size-4" /> WhatsApp
      </Button>
      {emailConfigured && (
        <Button variant="secondary" onClick={() => setOpen("email")}>
          <Mail className="size-4" /> E-mail
        </Button>
      )}
      <Dialog open={open === "whatsapp"} onClose={() => setOpen(null)} title={`Enviar ${label} pelo WhatsApp`}>
        <div className="space-y-4">
          <Field label="Telefone do cliente" hint="Com DDD. Em branco, o WhatsApp pede para escolher o contato.">
            <Input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="(11) 90000-0000" />
          </Field>
          <p className="text-xs text-slate-500">A mensagem leva o total, a validade e um link para o cliente ver e imprimir o documento (somente leitura). O envio é concluído no seu WhatsApp; o sistema registra que a conversa foi aberta.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                // janela aberta no clique (bloqueadores de pop-up recusam abrir depois da resposta do servidor)
                const win = window.open("", "_blank");
                start(async () => {
                  const r = await whatsappSendAction(id, tel || null);
                  if (!r.ok) {
                    win?.close();
                    return toast("error", r.error);
                  }
                  const url = (r.data as { url: string }).url;
                  if (win) win.location.href = url;
                  else window.location.href = url;
                  toast("success", r.message ?? "Envio registrado.");
                  setOpen(null);
                  router.refresh();
                });
              }}
            >
              <MessageCircle className="size-4" /> Abrir WhatsApp
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={open === "email"} onClose={() => setOpen(null)} title={`Enviar ${label} por e-mail`}>
        <ActionForm action={emailSendAction.bind(null, id)} onSuccess={() => setOpen(null)} className="space-y-4">
          {({ pending: p, error }) => (
            <>
              <Field label="E-mail do cliente" required>
                <Input name="to" type="email" defaultValue={email ?? ""} required />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(null)}>Cancelar</Button>
                <SubmitButton pending={p}>Enviar e-mail</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
