"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { saveParametersAction } from "./actions";
import type { ParamDef } from "./catalog";

type State = { def: ParamDef; company: unknown; branch: unknown; effective: unknown; source: string; updatedAt: string | null };

export function ParamsForm({ scope, states, groups, readOnly }: { scope: string; states: State[]; groups: string[]; readOnly: boolean }) {
  const isBranch = scope !== "company";
  const [clear, setClear] = useState<string[]>([]);
  const visible = states.filter((s) => s.def.scopes.includes(isBranch ? "branch" : "company"));
  return (
    <ActionForm action={saveParametersAction} className="space-y-5">
      {({ pending, error }) => (
        <fieldset disabled={readOnly} className="space-y-5">
          <input type="hidden" name="scope" value={scope} />
          {clear.map((k) => (
            <input key={k} type="hidden" name="clear" value={k} />
          ))}
          {groups.map((g) => {
            const items = visible.filter((s) => s.def.group === g);
            if (!items.length) return null;
            return (
              <section key={g} className="rounded-lg border border-line bg-white">
                <header className="border-b border-line px-5 py-3">
                  <h2 className="text-sm font-semibold text-ink">{g}</h2>
                </header>
                <ul className="divide-y divide-line">
                  {items.map((st) => {
                    const d = st.def;
                    const name = `p.${d.key}`;
                    const cleared = clear.includes(d.key);
                    const v = cleared ? st.company ?? d.default : st.effective;
                    return (
                      <li key={d.key} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_280px]">
                        <div>
                          <p className="text-sm font-medium text-ink">{d.label}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{d.help}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <Badge tone={st.source === "filial" ? "accent" : st.source === "empresa" ? "brand" : "neutral"}>{st.source === "padrão" ? "Valor padrão" : st.source === "instalação" ? "Definido na instalação (somente leitura)" : `Definido na ${st.source}`}</Badge>
                            <span>Usado em: {d.usedBy}</span>
                            {isBranch && st.source === "filial" && !readOnly && (
                              <button type="button" className="text-brand-700 underline" onClick={() => setClear((c) => (c.includes(d.key) ? c.filter((x) => x !== d.key) : [...c, d.key]))}>
                                {cleared ? "manter valor da filial" : "voltar a seguir a empresa"}
                              </button>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2" key={cleared ? "c" : "n"}>
                          {d.type === "bool" && (
                            <>
                              <input type="hidden" name={`present.${d.key}`} value="1" />
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input type="checkbox" name={name} defaultChecked={Boolean(v)} disabled={cleared} className="size-4 accent-brand-700" /> {Boolean(v) ? "Ligado" : "Desligado"}
                              </label>
                            </>
                          )}
                          {d.type === "int" && <Input name={name} type="number" min={d.min} max={d.max} defaultValue={String(v ?? "")} disabled={cleared} className="w-32" aria-label={d.label} />}
                          {d.type === "bps" && <Input name={name} type="number" step={0.01} min={(d.min ?? 0) / 100} max={(d.max ?? 10000) / 100} defaultValue={String(Number(v ?? 0) / 100)} disabled={cleared} className="w-32" aria-label={d.label} />}
                          {d.type === "money" && <MoneyInput name={name} defaultValue={Number(v ?? 0)} disabled={cleared} ariaLabel={d.label} />}
                          {d.type === "select" && <Select name={name} defaultValue={String(v ?? "")} options={d.options ?? []} disabled={cleared} aria-label={d.label} />}
                          {d.type === "timezone" && <span className="text-sm font-medium text-ink" aria-label={d.label}>{String(v ?? "")}</span>}
                          {d.unit && <span className="text-sm text-slate-500">{d.unit}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {!readOnly && (
            <div className="rounded-lg border border-line bg-white p-4">
              <label className="text-xs font-medium text-slate-600" htmlFor="reason">Motivo da alteração (registrado no histórico)</label>
              <Textarea id="reason" name="reason" rows={2} placeholder="Opcional" />
            </div>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          {!readOnly && (
            <div className="sticky bottom-0 z-10 -mx-1 flex justify-end border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
              <SubmitButton pending={pending}>Salvar parâmetros {isBranch ? "da filial" : "da empresa"}</SubmitButton>
            </div>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}
