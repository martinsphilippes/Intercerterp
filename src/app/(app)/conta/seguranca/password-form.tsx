"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { changeOwnPasswordAction } from "./actions";

/** Troca da própria senha (Minha conta › Segurança): senha atual, nova e confirmação. */
export function PasswordForm() {
  return (
    <ActionForm action={changeOwnPasswordAction} resetOnSuccess className="space-y-3">
      {({ pending, error }) => (
        <>
          <Field label="Senha atual">
            <Input name="current" type="password" required autoComplete="current-password" />
          </Field>
          <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Confirme a nova senha">
            <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <SubmitButton pending={pending}>Trocar senha</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
