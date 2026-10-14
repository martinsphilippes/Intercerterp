"use client";

import { useMemo, useState } from "react";
import { MessageCircle, RotateCcw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import {
  COLLECTION_TEMPLATE_KINDS, COLLECTION_VARIABLES, DEFAULT_COLLECTION_TEMPLATES, MAX_TEMPLATE_LENGTH, renderCollectionTemplate,
  type CollectionTemplateKind, type CollectionTemplates,
} from "@/domain/collection-templates";
import { saveCollectionTemplatesAction } from "../actions";

/** Edição dos modelos de cobrança com variáveis clicáveis e prévia com dados de exemplo. */
export function TemplatesForm({ initial, readOnly, sample }: { initial: CollectionTemplates; readOnly: boolean; sample: Record<string, string | null> }) {
  const [values, setValues] = useState<CollectionTemplates>(initial);
  const [focus, setFocus] = useState<CollectionTemplateKind>("overdue");
  const pix = values.pixLink.trim() || sample.link_pix;
  const preview = useMemo(() => renderCollectionTemplate(values[focus], { ...sample, link_pix: pix, ...(focus === "reminder" ? { dias_atraso: "0" } : {}) }), [values, focus, sample, pix]);
  const insert = (key: string) => {
    if (readOnly) return;
    setValues((v) => ({ ...v, [focus]: `${v[focus]}${v[focus].endsWith(" ") || v[focus].endsWith("\n") || !v[focus] ? "" : " "}{${key}}` }));
  };
  return (
    <ActionForm action={saveCollectionTemplatesAction}>
      {({ pending, error }) => (
        <fieldset disabled={readOnly} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {COLLECTION_TEMPLATE_KINDS.map((t) => (
              <section key={t.key} className={`rounded-lg border bg-white p-4 ${focus === t.key ? "border-brand-300 ring-1 ring-brand-200" : "border-line"}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">{t.label}</h2>
                    <p className="text-xs text-slate-500">{t.hint}</p>
                  </div>
                  {!readOnly && values[t.key] !== DEFAULT_COLLECTION_TEMPLATES[t.key] && (
                    <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700 underline" onClick={() => setValues((v) => ({ ...v, [t.key]: DEFAULT_COLLECTION_TEMPLATES[t.key] }))}>
                      <RotateCcw className="size-3.5" aria-hidden /> Restaurar padrão
                    </button>
                  )}
                </div>
                <Textarea
                  name={t.key}
                  rows={6}
                  maxLength={MAX_TEMPLATE_LENGTH}
                  value={values[t.key]}
                  onFocus={() => setFocus(t.key)}
                  onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value }))}
                  aria-label={t.label}
                />
                <p className="mt-1 text-right text-xs text-slate-500">{values[t.key].length}/{MAX_TEMPLATE_LENGTH}</p>
              </section>
            ))}
            <section className="rounded-lg border border-line bg-white p-4">
              <Field label="Link de pagamento ou chave Pix ({link_pix})" hint="Opcional. Vazio: usa a chave Pix cadastrada na conta financeira (Cadastros financeiros); sem nenhuma, a linha com {link_pix} é omitida da mensagem.">
                <Input name="pixLink" maxLength={300} value={values.pixLink} onChange={(e) => setValues((v) => ({ ...v, pixLink: e.target.value }))} placeholder="Ex.: https://pag.loja.com.br/pix ou financeiro@loja.com.br" />
              </Field>
              <Field label="Motivo da alteração (registrado no histórico)" className="mt-3">
                <Input name="reason" maxLength={300} placeholder="Opcional" />
              </Field>
            </section>
            {error && <Notice tone="bad">{error}</Notice>}
            {!readOnly && (
              <div className="flex justify-end">
                <SubmitButton pending={pending}>Salvar modelos</SubmitButton>
              </div>
            )}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section className="rounded-lg border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink">Variáveis</h2>
              <p className="mt-0.5 text-xs text-slate-500">Clique para inserir no modelo selecionado ({COLLECTION_TEMPLATE_KINDS.find((t) => t.key === focus)?.label.toLowerCase()}).</p>
              <ul className="mt-2 space-y-1">
                {COLLECTION_VARIABLES.map((v) => (
                  <li key={v.key} className="flex items-start gap-2 text-xs">
                    <button type="button" onClick={() => insert(v.key)} className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-brand-800 hover:bg-brand-50" disabled={readOnly}>{`{${v.key}}`}</button>
                    <span className="text-slate-600">{v.label}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-line bg-white p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><MessageCircle className="size-4" aria-hidden /> Prévia (dados de exemplo)</h2>
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm text-ink ring-1 ring-emerald-100">{preview || "—"}</p>
            </section>
          </aside>
        </fieldset>
      )}
    </ActionForm>
  );
}
