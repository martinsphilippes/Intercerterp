"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Checkbox } from "@/components/ui/form";
import { loginAction } from "@/app/actions/session";

export function LoginForm({ next }: { next?: string }) {
  const [show, setShow] = useState(false);
  return (
    <ActionForm action={loginAction} className="mt-6 space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Usuário ou e-mail" htmlFor="login">
            <Input id="login" name="login" autoComplete="username" autoFocus required />
          </Field>
          <Field label="Senha" htmlFor="password">
            <div className="relative">
              <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-10" />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar senha" : "Mostrar senha"} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </Field>
          <Checkbox name="remember" label="Manter conectado neste dispositivo" />
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <SubmitButton pending={pending} className="w-full">
            Entrar
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
