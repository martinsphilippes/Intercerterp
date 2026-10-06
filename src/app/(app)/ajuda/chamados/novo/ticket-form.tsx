"use client";

import { useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { createTicketAction } from "../actions";

type Opt = { value: string; label: string };

export function TicketForm({ categories, priorities, origin, branchName, defaultSubject, defaultCategory }: { categories: Opt[]; priorities: Opt[]; origin: string; branchName: string; defaultSubject?: string; defaultCategory?: string }) {
  const [ua, setUa] = useState("");
  const [screen, setScreen] = useState("");
  useEffect(() => {
    setUa(navigator.userAgent);
    setScreen(`${window.screen.width}x${window.screen.height}`);
  }, []);
  return (
    <ActionForm action={createTicketAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="route" value={origin} />
          <input type="hidden" name="userAgent" value={ua} />
          <input type="hidden" name="screen" value={screen} />
          <FormGrid cols={2}>
            <Field label="Categoria" required>
              <Select name="category" required defaultValue={defaultCategory ?? ""} options={categories} placeholder="Selecione" />
            </Field>
            <Field label="Prioridade" required>
              <Select name="priority" required defaultValue="normal" options={priorities} />
            </Field>
            <Field label="Assunto" required className="sm:col-span-2">
              <Input name="subject" required minLength={5} maxLength={200} defaultValue={defaultSubject ?? ""} placeholder="Resumo do problema ou pedido" />
            </Field>
            <Field label="Mensagem" required className="sm:col-span-2" hint="O que você fazia, o que esperava e o que aconteceu. Informe números de venda, nota ou pedido, se houver.">
              <Textarea name="message" required minLength={10} rows={6} />
            </Field>
            <Field label="Anexos" hint="Até 5 arquivos de 8 MB: imagens, PDF, texto, XML ou ZIP." className="sm:col-span-2">
              <input type="file" name="attachments" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/xml,application/xml,application/zip,.zip,.xml" className="text-sm" />
            </Field>
          </FormGrid>
          <div className="rounded-md border border-line bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold">Contexto registrado automaticamente</p>
            <p>Tela: {origin || "—"} · Filial: {branchName} · Navegador: {ua ? ua.slice(0, 120) : "detectando…"} · Tela: {screen || "—"}</p>
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending} variant="accent">Abrir chamado</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
