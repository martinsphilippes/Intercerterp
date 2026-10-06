"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { reviewDeliveryAction } from "../actions";

/**
 * Conferência de uma entrega da caixa de entrada: "Conferir" abre um formulário curto (observação opcional) num
 * diálogo e envia `reviewDeliveryAction` (campos id, notes); entregas conferidas podem ser reabertas (undo=1).
 */
export function ReviewForm({ id, status, fileName, notes }: { id: string; status: string; fileName: string; notes?: string | null }) {
  const [open, setOpen] = useState(false);
  if (status === "reviewed") {
    return (
      <ActionForm action={reviewDeliveryAction} confirm={`Reabrir a conferência de ${fileName}? A entrega volta para "a conferir".`}>
        {({ pending }) => (
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="undo" value="1" />
            <SubmitButton pending={pending} variant="secondary" size="sm">
              <RotateCcw className="size-3.5" aria-hidden /> Reabrir
            </SubmitButton>
          </>
        )}
      </ActionForm>
    );
  }
  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)} title="Marcar a entrega como conferida">
        <CheckCircle2 className="size-3.5" aria-hidden /> Conferir
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Conferir entrega" size="sm">
        <ActionForm action={reviewDeliveryAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="break-all text-sm text-slate-600">
                Arquivo: <span className="font-medium text-ink">{fileName}</span>
              </p>
              <Field label="Observação (opcional)" hint="Fica registrada na entrega.">
                <Textarea name="notes" rows={3} defaultValue={notes ?? ""} placeholder="Ex.: XMLs conferidos com a escrituração" autoFocus disabled={pending} />
              </Field>
              {error && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>Confirmar conferência</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
