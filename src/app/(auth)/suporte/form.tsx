"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { publicTicketAction } from "@/app/actions/public";

export function PublicTicketForm() {
  const [done, setDone] = useState<string | null>(null);
  if (done) return <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p>;
  return (
    <ActionForm action={publicTicketAction} className="mt-6 space-y-4" onSuccess={(d) => setDone(`Solicitação nº ${d?.number} registrada. Acompanharemos pelo e-mail informado.`)}>
      {({ pending, error }) => (
        <>
          <Field label="Seu nome" required>
            <Input name="name" required />
          </Field>
          <Field label="E-mail para retorno" required>
            <Input name="email" type="email" required />
          </Field>
          <Field label="Descreva o problema" required>
            <Textarea name="message" required rows={4} />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <SubmitButton pending={pending} className="w-full">
            Enviar solicitação
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
