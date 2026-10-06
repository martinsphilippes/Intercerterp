"use client";

import { KeyRound } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { acceptLinkCodeAction } from "@/app/(app)/contabil/actions";

/**
 * Lado da EMPRESA: informa o código de vínculo emitido pelo escritório contábil no Intercert.
 * O servidor normaliza o código (maiúsculas, sem hífen) e valida validade, CNPJ e uso único.
 */
export function AcceptLinkForm() {
  return (
    <ActionForm action={acceptLinkCodeAction} className="space-y-3" resetOnSuccess>
      {({ pending, error }) => (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Código de vínculo" required htmlFor="accounting-link-code" className="w-full max-w-xs">
              <Input
                id="accounting-link-code"
                name="code"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXXX-XXXXX"
                className="font-mono uppercase tracking-widest"
                onInput={(e) => {
                  // sem limite de tamanho no campo: um código colado com espaços não pode ser cortado antes de o servidor normalizá-lo
                  e.currentTarget.value = e.currentTarget.value.toUpperCase().replace(/\s+/g, "");
                }}
              />
            </Field>
            <SubmitButton pending={pending}>
              <KeyRound className="size-4" aria-hidden /> Aceitar vínculo
            </SubmitButton>
          </div>
          <p className="text-xs text-slate-500">Letras e números no formato XXXXX-XXXXX (maiúsculas ou minúsculas, com ou sem o hífen). O código é de uso único e só funciona enquanto estiver dentro da validade informada pelo escritório.</p>
          {error && <Notice tone="bad">{error}</Notice>}
        </>
      )}
    </ActionForm>
  );
}
