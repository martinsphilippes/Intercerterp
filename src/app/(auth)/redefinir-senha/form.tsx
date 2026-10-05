"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { completeRecoveryAction } from "@/app/actions/session";

export function ResetForm({ userId, secret }: { userId: string; secret: string }) {
  return (
    <ActionForm action={completeRecoveryAction} className="mt-6 space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="secret" value={secret} />
          <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
            <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
          </Field>
          <Field label="Confirme a senha">
            <Input name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <SubmitButton pending={pending} className="w-full">
            Salvar nova senha
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
