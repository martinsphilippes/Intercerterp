"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { recordAuthorizationAction } from "../actions";

/**
 * Cliente SEM vínculo com o ERP: o escritório registra como o titular autorizou o download (descrição obrigatória e
 * evidência opcional — termo assinado, e-mail do sócio). Envia `recordAuthorizationAction` (id, notes, evidence) em
 * multipart; o registro fica no histórico com autor, momento e o arquivo anexado.
 */
export function AuthorizationForm({ id, holderName }: { id: string; holderName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)} title="Registra a autorização dada pelo titular fora do ERP">
        <FileCheck2 className="size-4" aria-hidden /> Registrar autorização do titular
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Registrar autorização do titular">
        <ActionForm action={recordAuthorizationAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-slate-600">
                <span className="font-medium text-ink">{holderName}</span> não usa o ERP, por isso a autorização de download é registrada pelo escritório. Descreva como o titular autorizou e, se tiver, anexe a evidência. O registro libera o download do certificado por este protocolo.
              </p>
              <Field label="Como o titular autorizou" required hint="Mínimo de 10 caracteres. Ex.: termo de autorização assinado em 10/10, e-mail do sócio-administrador.">
                <Textarea name="notes" rows={3} required minLength={10} autoFocus disabled={pending} placeholder="Ex.: termo de autorização assinado pelo sócio em 10/10/2026" />
              </Field>
              <Field label="Evidência (opcional)" hint="Termo assinado, e-mail ou outro comprovante. Fica anexado ao protocolo.">
                <Input type="file" name="evidence" disabled={pending} className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium" />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>Registrar autorização</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
