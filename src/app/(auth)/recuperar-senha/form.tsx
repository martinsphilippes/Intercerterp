"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { requestRecoveryAction } from "@/app/actions/session";

export function RecoveryForm() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <ActionForm
      action={async (fd) => {
        const r = await requestRecoveryAction(fd);
        if (r.ok) setMsg(r.message ?? null);
        return { ...r, message: undefined } as any;
      }}
      className="mt-6 space-y-4"
    >
      {({ pending, error }) => (
        <>
          <Field label="Usuário ou e-mail">
            <Input name="login" required autoFocus />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {msg && <p className="break-all rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{msg}</p>}
          <SubmitButton pending={pending} className="w-full">
            Enviar instruções
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
