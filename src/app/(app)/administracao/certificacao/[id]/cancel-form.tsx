"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { teamCancelRequestAction } from "@/app/(app)/contabil/certificados/actions";

/**
 * Cancelamento pela equipe (só enquanto a solicitação aguarda pagamento): link discreto → diálogo com o motivo
 * obrigatório → `teamCancelRequestAction` (id, reason). Fica no histórico do protocolo com autor e momento.
 */
export function CancelForm({ id, protocol, holderName, firmName }: { id: string; protocol: string; holderName: string; firmName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="focus-ring inline-flex items-center gap-1 rounded text-sm text-red-700 hover:underline" title="Encerra o atendimento deste protocolo">
        <XCircle className="size-4" aria-hidden /> Cancelar solicitação
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Cancelar solicitação ${protocol}`} size="sm">
        <ActionForm action={teamCancelRequestAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-slate-600">
                O cancelamento bloqueia o pagamento, a emissão e o download deste protocolo e fica registrado no histórico, com quem cancelou e quando. O escritório <span className="font-medium text-ink">{firmName}</span> precisará abrir uma nova solicitação para <span className="font-medium text-ink">{holderName}</span>.
              </p>
              <Field label="Motivo do cancelamento" required hint="Fica no histórico do atendimento e visível ao escritório.">
                <Textarea name="reason" rows={3} required autoFocus disabled={pending} placeholder="Ex.: solicitação em duplicidade, pedido do escritório…" />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Voltar
                </Button>
                <SubmitButton pending={pending} variant="danger">
                  Cancelar solicitação
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
