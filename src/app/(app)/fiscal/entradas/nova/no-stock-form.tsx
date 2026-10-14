"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { createNoStockEntryAction } from "../actions";

type Opt = { value: string; label: string };

/** Formulário da nota de entrada sem estoque: XML da NF-e ou documento digitado (NF-e com chave, NFS-e, outro). */
export function NoStockForm({ suppliers, categories, costCenters, terms, methods, today }: { suppliers: Opt[]; categories: Opt[]; costCenters: Opt[]; terms: Opt[]; methods: Opt[]; today: string }) {
  const [mode, setMode] = useState<"xml" | "manual">("manual");
  const [model, setModel] = useState("nfse");
  return (
    <ActionForm action={createNoStockEntryAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          <FormSection title="Documento" description="A nota é escriturada no livro de entradas e gera só a conta a pagar: nenhum produto entra no estoque e nenhum custo é alterado.">
            <FormGrid cols={2}>
              <Field label="Origem dos dados">
                <Select value={mode} onChange={(e) => setMode(e.target.value as "xml" | "manual")} options={[{ value: "manual", label: "Digitar os dados do documento" }, { value: "xml", label: "Importar o XML da NF-e (uso e consumo, despesa)" }]} />
              </Field>
              {mode === "xml" ? (
                <Field label="Arquivo XML da NF-e" required hint="Fornecedor, número, chave, itens e tributos vêm do XML.">
                  <Input type="file" name="xml" accept=".xml,application/xml,text/xml" required />
                </Field>
              ) : (
                <Field label="Fornecedor / prestador" required>
                  <Select name="supplierId" options={suppliers} placeholder="Selecione" required />
                </Field>
              )}
            </FormGrid>
            {mode === "manual" && (
              <FormGrid cols={4} className="mt-3">
                <Field label="Tipo de documento">
                  <Select name="docModel" value={model} onChange={(e) => setModel(e.target.value)} options={[{ value: "nfse", label: "NFS-e (serviço tomado)" }, { value: "55", label: "NF-e (com chave)" }, { value: "other", label: "Outro documento" }]} />
                </Field>
                {model === "55" && (
                  <Field label="Chave de acesso" required className="sm:col-span-3">
                    <Input name="nfeKey" inputMode="numeric" maxLength={54} placeholder="44 dígitos" required />
                  </Field>
                )}
                <Field label="Número" required={model !== "55"}>
                  <Input name="number" maxLength={20} required={model !== "55"} />
                </Field>
                <Field label="Série">
                  <Input name="series" maxLength={5} />
                </Field>
                <Field label="Emissão">
                  <Input type="date" name="issueDate" defaultValue={today} max={today} />
                </Field>
                <Field label="CFOP de entrada" required={model !== "nfse"} hint="1556 uso e consumo · 1933 serviço (ISS) · 2xxx interestadual">
                  <Input name="cfop" inputMode="numeric" maxLength={4} required={model !== "nfse"} placeholder={model === "nfse" ? "opcional" : "1556"} />
                </Field>
                <Field label="Descrição" required className="sm:col-span-4">
                  <Input name="description" maxLength={200} required placeholder="Ex.: Manutenção do ar-condicionado, material de limpeza" />
                </Field>
                <Field label="Valor total do documento" required>
                  <MoneyInput name="total" required />
                </Field>
                <Field label="Base do ICMS">
                  <MoneyInput name="icmsBase" />
                </Field>
                <Field label="ICMS">
                  <MoneyInput name="icms" />
                </Field>
                <Field label="IPI">
                  <MoneyInput name="ipi" />
                </Field>
              </FormGrid>
            )}
            {mode === "xml" && (
              <FormGrid cols={4} className="mt-3">
                <Field label="CFOP de entrada" hint="Vazio = 1556/2556 (uso e consumo)">
                  <Input name="cfop" inputMode="numeric" maxLength={4} placeholder="1556" />
                </Field>
              </FormGrid>
            )}
          </FormSection>
          <FormSection title="Financeiro">
            <Checkbox name="createPayable" label="Gerar conta a pagar (duplicatas do XML ou condição de pagamento)" defaultChecked />
            <FormGrid cols={4} className="mt-3">
              <Field label="Plano de contas">
                <Select name="categoryId" options={categories} placeholder="Padrão de compras" />
              </Field>
              <Field label="Centro de custo">
                <Select name="costCenterId" options={costCenters} placeholder="—" />
              </Field>
              <Field label="Condição de pagamento">
                <Select name="paymentTermId" defaultValue="__supplier" options={[{ value: "__supplier", label: "A do fornecedor" }, { value: "", label: "À vista (na emissão)" }, ...terms]} />
              </Field>
              <Field label="Forma de pagamento">
                <Select name="paymentMethodId" options={methods} placeholder="—" />
              </Field>
            </FormGrid>
            <Field label="Observações" className="mt-3">
              <Textarea name="notes" rows={2} maxLength={1000} />
            </Field>
          </FormSection>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Registrar nota sem estoque</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
