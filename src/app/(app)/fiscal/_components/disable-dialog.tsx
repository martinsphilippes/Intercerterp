"use client";

import { useState } from "react";
import { Hash } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { disableAction } from "../actions";

/** Inutilização de faixa de numeração (NF-e/NFC-e) com sugestão das lacunas detectadas. */
export function DisableDialog({ model, series, gaps, disabled }: { model: "nfe" | "nfce"; series: string; gaps: Array<{ series: string; number: number; status: string }>; disabled?: string | null }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(gaps[0]?.number ?? 0);
  const [to, setTo] = useState(gaps[0]?.number ?? 0);
  const [ser, setSer] = useState(gaps[0]?.series ?? series);
  const [text, setText] = useState("");
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} disabled={Boolean(disabled)} title={disabled ?? undefined}>
        <Hash className="size-4" /> Inutilizar numeração{gaps.length ? ` (${gaps.length})` : ""}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Inutilização de numeração — ${model === "nfe" ? "NF-e" : "NFC-e"}`}>
        <ActionForm action={disableAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="model" value={model} />
              <p className="text-sm text-slate-600">Inutilize números atribuídos que não serão usados (ex.: notas rejeitadas e descartadas). Números autorizados ou cancelados não podem ser inutilizados.</p>
              {gaps.length > 0 ? (
                <div className="rounded-md border border-line p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold text-slate-600">Lacunas detectadas (descartadas/rejeitadas sem autorização)</p>
                  <div className="flex flex-wrap gap-2">
                    {gaps.map((g) => (
                      <button key={`${g.series}-${g.number}`} type="button" className="rounded border border-line px-2 py-0.5 font-mono text-xs hover:border-brand-400" onClick={() => { setSer(g.series); setFrom(g.number); setTo(g.number); }}>
                        série {g.series} nº {g.number}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <Notice tone="info">Nenhuma lacuna detectada nesta filial.</Notice>
              )}
              <FormGrid cols={3}>
                <Field label="Série" required>
                  <Input name="series" value={ser} onChange={(e) => setSer(e.target.value)} required />
                </Field>
                <Field label="Número inicial" required>
                  <Input name="from" type="number" min={1} value={from || ""} onChange={(e) => setFrom(Number(e.target.value))} required />
                </Field>
                <Field label="Número final" required>
                  <Input name="to" type="number" min={1} value={to || ""} onChange={(e) => setTo(Number(e.target.value))} required />
                </Field>
              </FormGrid>
              <Field label="Justificativa" hint={`${text.trim().length} caractere(s) — mínimo 15.`} required>
                <Textarea name="justification" value={text} onChange={(e) => setText(e.target.value)} minLength={15} maxLength={255} required />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Voltar</Button>
                <SubmitButton pending={pending} variant="danger">Solicitar inutilização</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
