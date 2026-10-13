"use client";

import { useState } from "react";
import { AlertOctagon } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { emissionFailureAction } from "@/app/(app)/contabil/certificados/actions";

/**
 * Falha na emissão: a equipe registra o retorno da certificadora (motivo obrigatório) em diálogo →
 * `emissionFailureAction` (id, reason). O pagamento continua confirmado e o escritório pode pedir nova tentativa.
 */
export function FailureForm({ id, protocol, attempt }: { id: string; protocol: string; attempt: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="danger" onClick={() => setOpen(true)} title="Registra o retorno negativo da certificadora">
        <AlertOctagon className="size-4" aria-hidden /> Registrar falha
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Falha na emissão — ${protocol}`} size="sm">
        <ActionForm action={emissionFailureAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-slate-600">
                Tentativa {attempt.toLocaleString("pt-BR")}. O motivo vai ao histórico e ao escritório, que pode pedir uma nova tentativa neste mesmo protocolo, sem nova cobrança. O pagamento continua confirmado.
              </p>
              <Field label="Retorno da certificadora" required hint="Ex.: divergência cadastral na Receita, documento ilegível, falha técnica na AC.">
                <Textarea name="reason" rows={3} required autoFocus disabled={pending} placeholder="Descreva o motivo informado pela certificadora" />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Voltar
                </Button>
                <SubmitButton pending={pending} variant="danger">
                  Registrar falha
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
