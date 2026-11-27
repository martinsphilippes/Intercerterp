"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { requestUpsellAction } from "./actions";

export function UpsellForm({ module }: { module: string }) {
  return (
    <ActionForm action={requestUpsellAction} className="mx-auto mt-6 max-w-md space-y-3 text-left" resetOnSuccess>
      {({ pending }) => (
        <>
          <input type="hidden" name="module" value={module} />
          <Field label="Observação (opcional)" hint="Vai para a equipe comercial junto com o pedido. Não inclua dados pessoais.">
            <Textarea name="note" maxLength={500} placeholder="Ex.: queremos começar no próximo mês, 2 filiais" />
          </Field>
          <SubmitButton pending={pending}>Solicitar contratação</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
