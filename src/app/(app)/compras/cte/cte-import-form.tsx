"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { importCteAction } from "./actions";

type Opt = { value: string; label: string };
type ReceiptOpt = { id: string; label: string; hint: string; status: string };

/** Importação do CT-e de frete: XML, recebimentos do frete (vazio = os das NF-e transportadas) e pagamento. */
export function CteImportForm({ receipts, terms, categories }: { receipts: ReceiptOpt[]; terms: Opt[]; categories: Opt[] }) {
  return (
    <ActionForm action={importCteAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <FormGrid cols={3}>
            <Field label="Arquivo XML do CT-e" required hint="CT-e modelo 57 em que a empresa é a tomadora do serviço (frete FOB).">
              <Input type="file" name="xml" accept=".xml,application/xml,text/xml" required />
            </Field>
            <Field label="CFOP de entrada" hint="Vazio = 1353 (interno) ou 2353 (interestadual)">
              <Input name="entryCfop" inputMode="numeric" maxLength={4} placeholder="1353" />
            </Field>
            <Field label="Condição de pagamento" hint="Usada quando o XML não traz duplicatas.">
              <Select name="paymentTermId" defaultValue="__carrier" options={[{ value: "__carrier", label: "A da transportadora" }, { value: "", label: "À vista (na emissão)" }, ...terms]} />
            </Field>
            <Field label="Plano de contas do título">
              <Select name="categoryId" options={categories} placeholder="Padrão (fretes/compras)" />
            </Field>
            <Field label="Observações" className="sm:col-span-2">
              <Input name="notes" maxLength={500} />
            </Field>
          </FormGrid>
          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Recebimentos do frete</legend>
            <p className="mb-2 text-xs text-slate-500">Sem marcar nenhum, o sistema usa os recebimentos das NF-e citadas no CT-e. O valor é rateado entre eles pelo valor dos produtos.</p>
            {receipts.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum recebimento em conferência ou concluído nos últimos 120 dias nesta filial.</p>
            ) : (
              <ul className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
                {receipts.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" name="receiptIds" value={r.id} className="mt-1" />
                      <span>
                        <span className="font-medium">{r.label}</span>
                        <span className="block text-xs text-slate-500">{r.hint}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Importar CT-e e lançar o frete</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
