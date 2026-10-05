"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { savePrefsAction } from "./actions";

export function PrefsForm({ types, muted }: { types: Array<{ key: string; label: string; description: string; count: number }>; muted: string[] }) {
  return (
    <ActionForm action={savePrefsAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {types.map((t) => (
              <li key={t.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <input type="hidden" name="type" value={t.key} />
                <div>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-slate-500">{t.description} · {t.count} na sua caixa de entrada</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="receive" value={t.key} defaultChecked={!muted.includes(t.key)} className="size-4 accent-brand-700" />
                  Receber
                </label>
              </li>
            ))}
          </ul>
          <Notice tone="info">Silenciar evita novos avisos daquele tipo para você; avisos de prioridade crítica sempre são entregues. Ocorrências continuam existindo na origem.</Notice>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Salvar preferências</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
