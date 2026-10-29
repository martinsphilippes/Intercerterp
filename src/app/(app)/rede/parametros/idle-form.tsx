"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { saveIdleDaysAction } from "../vendas/actions";

/** Dias antes do vencimento para o alerta "ninguém agiu" (§45). */
export function IdleDaysForm({ days }: { days: number }) {
  return (
    <ActionForm action={saveIdleDaysAction} className="flex flex-wrap items-end gap-3">
      {({ pending }) => (
        <>
          <Field label="Dias antes do vencimento" hint="1 a 30. Sem contato registrado nem renovação aberta, o responsável do nó e o nível acima são avisados.">
            <Input type="number" name="idleAlertDays" min={1} max={30} defaultValue={days} required className="w-28" />
          </Field>
          <SubmitButton pending={pending}>Salvar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
