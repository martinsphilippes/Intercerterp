"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { acceptInviteAction } from "@/app/actions/session";

export function ResetLike({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInviteAction} className="mt-6 space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field label="Senha" hint="Mínimo de 8 caracteres.">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Confirme a senha">
            <Input name="confirm" type="password" required autoComplete="new-password" />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <SubmitButton pending={pending} className="w-full">
            Ativar acesso
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
