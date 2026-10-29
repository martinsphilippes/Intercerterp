"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { saveCustomerAction } from "../vendas/actions";

export interface CustomerFormValues {
  id?: string | null;
  personType: "PF" | "PJ";
  doc: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: Record<string, string | null> | null;
  hasBirdId: boolean;
  birdIdValidTo: string | null;
  notes: string | null;
}

/** Cadastro do cliente de certificado do parceiro (PF/PJ, documento validado no servidor, contato, endereço, BirdID). */
export function CustomerForm({ initial, back }: { initial?: CustomerFormValues | null; back?: string | null }) {
  const [personType, setPersonType] = useState<"PF" | "PJ">(initial?.personType ?? "PF");
  const [hasBirdId, setHasBirdId] = useState(Boolean(initial?.hasBirdId));
  const a = initial?.address ?? {};
  return (
    <ActionForm action={saveCustomerAction} className="space-y-5">
      {({ pending }) => (
        <>
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          {back && <input type="hidden" name="back" value={back} />}
          <FormSection title="Titular" description="Pessoa física (e-CPF, BirdID) ou jurídica (e-CNPJ). O CPF/CNPJ é conferido pelos dígitos e é único no seu parceiro.">
            <FormGrid cols={3}>
              <Field label="Tipo" required>
                <Select name="personType" value={personType} onChange={(e) => setPersonType(e.target.value === "PJ" ? "PJ" : "PF")} options={[{ value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" }]} />
              </Field>
              <Field label={personType === "PF" ? "CPF" : "CNPJ"} required>
                <Input name="doc" defaultValue={initial?.doc ?? ""} inputMode="numeric" required placeholder={personType === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} />
              </Field>
              <Field label={personType === "PF" ? "Nome completo" : "Razão social"} required>
                <Input name="name" defaultValue={initial?.name ?? ""} required minLength={3} maxLength={200} />
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Contato">
            <FormGrid cols={2}>
              <Field label="E-mail"><Input type="email" name="email" defaultValue={initial?.email ?? ""} /></Field>
              <Field label="Telefone / WhatsApp" hint="Com DDD."><Input name="phone" defaultValue={initial?.phone ?? ""} inputMode="tel" /></Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Endereço" description="Opcional.">
            <FormGrid cols={3}>
              <Field label="Logradouro"><Input name="street" defaultValue={a.street ?? ""} /></Field>
              <Field label="Número"><Input name="number" defaultValue={a.number ?? ""} /></Field>
              <Field label="Bairro"><Input name="district" defaultValue={a.district ?? ""} /></Field>
              <Field label="Cidade"><Input name="cityName" defaultValue={a.cityName ?? ""} /></Field>
              <Field label="UF"><Input name="uf" defaultValue={a.uf ?? ""} maxLength={2} className="uppercase" /></Field>
              <Field label="CEP"><Input name="zip" defaultValue={a.zip ?? ""} inputMode="numeric" /></Field>
            </FormGrid>
          </FormSection>
          <FormSection title="BirdID" description="Quem já tem BirdID renova sem nova videoconferência. A venda de BirdID marca o titular automaticamente.">
            <FormGrid cols={2}>
              <Checkbox name="hasBirdId" label="Titular já tem BirdID" checked={hasBirdId} onChange={(e) => setHasBirdId(e.currentTarget.checked)} />
              {hasBirdId && <Field label="Validade do BirdID"><Input type="date" name="birdIdValidTo" defaultValue={initial?.birdIdValidTo ?? ""} /></Field>}
            </FormGrid>
          </FormSection>
          <Field label="Observações"><Textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} maxLength={1000} /></Field>
          <div className="flex justify-end"><SubmitButton pending={pending}>{initial?.id ? "Salvar alterações" : back === "venda" ? "Cadastrar e voltar à venda" : "Cadastrar cliente"}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}
