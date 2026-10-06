"use client";

import { useState } from "react";
import { Copy, Check, LogIn, Zap } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { loginAction } from "@/app/actions/session";

export interface QuickUser {
  login: string;
  name: string;
  sector: string;
  scope: string;
}

/** Acesso rápido da demonstração: um clique entra como o usuário do setor (somente usuários da empresa DEMO). */
export function QuickAccess({ users, password }: { users: QuickUser[]; password: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }, () => undefined);
  };
  return (
    <section aria-labelledby="quick-access-title" className="mt-6 rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 p-4">
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-fuchsia-700" aria-hidden />
        <h2 id="quick-access-title" className="text-sm font-semibold text-fuchsia-900">
          Acesso rápido — ambiente de teste
        </h2>
      </div>
      <p className="mt-1 text-xs text-fuchsia-900/80">
        Usuários da empresa de demonstração (dados fictícios, notas e Pix simulados). Senha de todos:{" "}
        <button type="button" onClick={() => copy(password, "pwd")} className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-fuchsia-950 ring-1 ring-fuchsia-200 hover:bg-fuchsia-100" title="Copiar senha">
          {password}
          {copied === "pwd" ? <Check className="size-3" aria-label="Copiada" /> : <Copy className="size-3" aria-hidden />}
        </button>
      </p>
      <ul className="mt-3 divide-y divide-fuchsia-100 overflow-hidden rounded-md border border-fuchsia-100 bg-white">
        {users.map((u) => (
          <li key={u.login}>
            <ActionForm action={loginAction} className="flex items-center gap-3 px-3 py-2">
              {({ pending }) => (
                <>
                  <input type="hidden" name="login" value={u.login} />
                  <input type="hidden" name="password" value={password} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{u.sector}</p>
                    <p className="text-xs text-slate-500">
                      <code className="font-mono text-slate-700">{u.login}</code> · {u.name}
                    </p>
                    <p className="text-[11px] text-slate-400">{u.scope}</p>
                  </div>
                  <button
                    type="submit"
                    disabled={pending}
                    className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:bg-brand-300"
                    aria-label={`Entrar como ${u.sector} (${u.login})`}
                  >
                    <LogIn className="size-3.5" aria-hidden />
                    {pending ? "Entrando…" : "Entrar"}
                  </button>
                </>
              )}
            </ActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}
