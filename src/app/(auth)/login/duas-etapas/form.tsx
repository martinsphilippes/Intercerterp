"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { cancelTwoFactorLoginAction, verifyTwoFactorLoginAction } from "@/app/actions/session";
import { RecoveryCodesList } from "@/components/auth/recovery-codes";

/**
 * Código da segunda etapa (ou confirmação do cadastro). Formulário próprio (sem atualizar a página no sucesso): depois
 * do cadastro, os códigos de recuperação aparecem uma única vez antes de seguir para o sistema.
 */
export function TwoFactorLoginForm({ kind }: { kind: "verify" | "enroll" }) {
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ recoveryCodes: string[]; next: string } | null>(null);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <div className="mt-6 space-y-4">
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Autenticação em duas etapas ativada.</p>
        <RecoveryCodesList codes={done.recoveryCodes} />
        <Button variant="primary" className="w-full" onClick={() => (window.location.href = done.next)}>
          Guardei os códigos — continuar
        </Button>
      </div>
    );
  }
  const submit = (fd: FormData) =>
    start(async () => {
      setError(null);
      const res = await verifyTwoFactorLoginAction(fd);
      if (!res.ok) {
        setError(res.error);
        if (res.code && res.code !== "invalid_code") setTimeout(() => (window.location.href = "/login"), 2500);
        return;
      }
      if (res.data?.recoveryCodes) setDone({ recoveryCodes: res.data.recoveryCodes, next: res.data.next ?? "/dashboard" });
      else window.location.href = res.redirect ?? "/dashboard";
    });
  return (
    <div className="mt-6 space-y-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) submit(new FormData(e.currentTarget));
        }}
      >
        {recovery ? (
          <Field label="Código de recuperação" htmlFor="code" hint="Cada código de recuperação vale uma única vez.">
            <Input id="code" name="code" autoComplete="off" autoFocus required placeholder="xxxxx-xxxxx" className="font-mono" />
          </Field>
        ) : (
          <Field label={kind === "enroll" ? "Código exibido no aplicativo" : "Código de verificação"} htmlFor="code">
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={7} pattern="[0-9 ]{6,7}" placeholder="000000" className="tabular text-center text-lg tracking-[0.4em]" />
          </Field>
        )}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={pending}>
          {kind === "enroll" ? "Confirmar e ativar" : "Verificar e entrar"}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {kind === "verify" ? (
          <button type="button" className="text-brand-700 hover:underline" onClick={() => setRecovery((r) => !r)}>
            {recovery ? "Usar o código do aplicativo" : "Sem acesso ao aplicativo? Use um código de recuperação"}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={pending}
          className="text-slate-500 hover:underline"
          onClick={() =>
            start(async () => {
              const r = await cancelTwoFactorLoginAction();
              window.location.href = (r.ok && r.redirect) || "/login";
            })
          }
        >
          Voltar ao login
        </button>
      </div>
      {kind === "verify" && <p className="text-xs text-slate-500">Perdeu o aparelho e os códigos de recuperação? Peça ao administrador a redefinição da autenticação em duas etapas.</p>}
    </div>
  );
}
