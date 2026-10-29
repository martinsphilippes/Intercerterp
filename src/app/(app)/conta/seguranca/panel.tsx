"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { RecoveryCodesList } from "@/components/auth/recovery-codes";
import { confirmTwoFactorSetupAction, disableTwoFactorAction, regenerateRecoveryCodesAction, startTwoFactorSetupAction } from "./actions";

/** Cadastro, códigos de recuperação e desativação do 2FA (as ações não atualizam a página antes de mostrar os códigos). */
export function TwoFactorPanel({ enabled, required, recoveryLeft }: { enabled: boolean; required: boolean; recoveryLeft: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<null | "disable" | "regenerate">(null);

  const call = <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T; message?: string }>, after: (d: T | undefined) => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Falha.");
        return;
      }
      if (r.message) toast("success", r.message);
      after(r.data);
    });

  if (codes) {
    return (
      <div className="mt-4 space-y-3">
        <RecoveryCodesList codes={codes} />
        <Button variant="primary" onClick={() => { setCodes(null); setSetup(null); setMode(null); router.refresh(); }}>Guardei os códigos</Button>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mt-2 space-y-3">
        {!setup ? (
          <>
            <p className="text-sm text-slate-600">Proteja o acesso com um segundo fator: além da senha, o código do aplicativo autenticador do seu celular.</p>
            <Button variant="primary" loading={pending} onClick={() => call(() => startTwoFactorSetupAction(), (d) => d && setSetup(d))}><ShieldCheck className="size-4" /> Configurar aplicativo autenticador</Button>
          </>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); call(() => confirmTwoFactorSetupAction(fd), (d) => d && setCodes(d.recoveryCodes)); }}>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>No aplicativo autenticador, adicione uma conta lendo o QR code.</li>
              <li>Digite o código de 6 dígitos exibido para confirmar o cadastro.</li>
            </ol>
            <div className="flex justify-center rounded-lg border border-line bg-white p-3" aria-label="QR code para o aplicativo autenticador" dangerouslySetInnerHTML={{ __html: setup.qr }} />
            <p className="text-xs text-slate-500">Sem câmera? Digite a chave: <span className="break-all font-mono text-sm text-ink">{setup.secret}</span></p>
            <Field label="Código do aplicativo" htmlFor="totp-code">
              <Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} placeholder="000000" className="tabular max-w-40 text-center tracking-[0.3em]" />
            </Field>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={pending}>Confirmar e ativar</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => call(() => startTwoFactorSetupAction(true), (d) => d && setSetup(d))}>Gerar outro QR code</Button>
            </div>
          </form>
        )}
        {!setup && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setMode(mode === "regenerate" ? null : "regenerate"); setError(null); }}><KeyRound className="size-4" /> Gerar novos códigos de recuperação</Button>
        {!required && <Button variant="danger" onClick={() => { setMode(mode === "disable" ? null : "disable"); setError(null); }}><ShieldOff className="size-4" /> Desativar</Button>}
      </div>
      {recoveryLeft <= 2 && <p className="text-xs text-amber-800">Restam poucos códigos de recuperação: gere novos.</p>}
      {mode === "regenerate" && (
        <form className="space-y-2 rounded-md border border-line p-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); call(() => regenerateRecoveryCodesAction(fd), (d) => d && setCodes(d.recoveryCodes)); }}>
          <p className="text-sm text-slate-600">Os códigos anteriores deixam de valer. Confirme com o código atual do aplicativo.</p>
          <Field label="Código do aplicativo"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required className="max-w-40" /></Field>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" variant="primary" loading={pending}>Gerar códigos</Button>
        </form>
      )}
      {mode === "disable" && (
        <form className="space-y-2 rounded-md border border-red-200 p-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); call(() => disableTwoFactorAction(fd), () => { setMode(null); router.refresh(); }); }}>
          <p className="text-sm text-slate-600">Para desativar, confirme sua senha e um código do aplicativo (ou de recuperação).</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Senha"><Input name="password" type="password" autoComplete="current-password" required /></Field>
            <Field label="Código"><Input name="code" autoComplete="one-time-code" required /></Field>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button type="submit" variant="danger" loading={pending}>Desativar autenticação em duas etapas</Button>
        </form>
      )}
    </div>
  );
}
