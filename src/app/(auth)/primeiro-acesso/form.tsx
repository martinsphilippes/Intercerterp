"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid } from "@/components/ui/form";
import { setupInstallationAction } from "@/app/actions/setup";

export function SetupForm() {
  return (
    <div className="mt-6 space-y-6">
      <ActionForm action={setupInstallationAction} className="space-y-4">
        {({ pending, error }) => (
          <>
            <input type="hidden" name="mode" value="company" />
            <FormGrid cols={2}>
              <Field label="Razão social" required className="sm:col-span-2">
                <Input name="companyName" required />
              </Field>
              <Field label="CNPJ">
                <Input name="cnpj" inputMode="numeric" />
              </Field>
              <Field label="Regime tributário">
                <Select name="regime" options={[{ value: "simples", label: "Simples Nacional" }, { value: "presumido", label: "Lucro Presumido" }, { value: "real", label: "Lucro Real" }, { value: "mei", label: "MEI" }]} />
              </Field>
              <Field label="Cidade">
                <Input name="city" />
              </Field>
              <Field label="UF">
                <Input name="uf" maxLength={2} />
              </Field>
              <Field label="Nome do administrador" required>
                <Input name="adminName" required />
              </Field>
              <Field label="E-mail do administrador" required>
                <Input name="email" type="email" required />
              </Field>
              <Field label="Senha" required hint="Mínimo de 8 caracteres.">
                <Input name="password" type="password" required minLength={8} />
              </Field>
            </FormGrid>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <SubmitButton pending={pending} className="w-full">
              Criar empresa e administrador
            </SubmitButton>
          </>
        )}
      </ActionForm>
      <div className="border-t border-line pt-4">
        <ActionForm action={setupInstallationAction}>
          {({ pending }) => (
            <>
              <input type="hidden" name="mode" value="demo" />
              <SubmitButton pending={pending} variant="secondary" className="w-full">
                Carregar ambiente de demonstração
              </SubmitButton>
              <p className="mt-2 text-xs text-slate-500">Cria a empresa “(DEMO)” com duas filiais, usuários por perfil, histórico de vendas, compras e financeiro, usando provedores de simulação.</p>
            </>
          )}
        </ActionForm>
      </div>
    </div>
  );
}
