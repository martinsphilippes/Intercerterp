"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { setPasswordAction } from "./actions";

export function SetPasswordButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" /> Definir nova senha
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Nova senha para ${name}`} size="sm">
        <ActionForm action={setPasswordAction} onSuccess={() => setOpen(false)} className="space-y-3">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-xs text-slate-500">As sessões abertas do usuário são encerradas. Informe a senha por um canal seguro.</p>
              <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
                <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
              </Field>
              <Field label="Confirme a senha">
                <Input name="confirm" type="password" minLength={8} required autoComplete="new-password" />
              </Field>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>Salvar senha</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
