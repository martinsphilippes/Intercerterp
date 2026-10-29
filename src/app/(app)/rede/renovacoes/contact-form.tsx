"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { CONTACT_CHANNELS, CONTACT_RESULTS } from "@/domain/network/renewal-options";
import { registerContactAction } from "../vendas/actions";

/** Registrar contato de renovação (data, canal, resultado, próxima ação) — mostra que o nó agiu. */
export function ContactForm({ certificateId, today }: { certificateId: string; today: string }) {
  return (
    <ActionForm action={registerContactAction} className="space-y-3" resetOnSuccess>
      {({ pending }) => (
        <>
          <input type="hidden" name="certificateId" value={certificateId} />
          <FormGrid cols={3}>
            <Field label="Data"><Input type="date" name="contactDate" defaultValue={today} max={today} /></Field>
            <Field label="Canal" required><Select name="channel" options={CONTACT_CHANNELS.map((c) => ({ value: c.value, label: c.label }))} required /></Field>
            <Field label="Resultado" required><Select name="result" options={CONTACT_RESULTS.map((c) => ({ value: c.value, label: c.label }))} required /></Field>
          </FormGrid>
          <FormGrid cols={3}>
            <Field label="Próxima ação"><Input name="nextAction" maxLength={200} placeholder="Ex.: enviar link da renovação" /></Field>
            <Field label="Quando"><Input type="date" name="nextActionDate" min={today} /></Field>
            <Field label="Observação"><Input name="notes" maxLength={500} /></Field>
          </FormGrid>
          <div className="flex justify-end"><SubmitButton pending={pending} size="sm">Registrar contato</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}
