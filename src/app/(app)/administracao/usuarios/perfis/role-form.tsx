"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea, FormGrid, FormSection, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { saveRoleAction } from "../actions";

type Mod = { key: string; label: string };
type Op = { key: string; label: string };
type Act = { key: string; label: string; module: string };

/** Editor da matriz visualizar/criar/editar/excluir por módulo + operações específicas (visão 9). */
export function RoleForm({ role, modules, ops, actions, na, readOnly, usersCount }: { role?: Record<string, any> | null; modules: Mod[]; ops: Op[]; actions: Act[]; na: Record<string, string[]>; readOnly?: boolean; usersCount?: number }) {
  const r = role ?? {};
  const initialPerm = () => JSON.parse(JSON.stringify(r.permissions ?? {}));
  const [perm, setPerm] = useState<Record<string, Record<string, boolean>>>(initialPerm);
  const [acts, setActs] = useState<string[]>(r.actions ?? []);
  const [dirty, setDirty] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const isNa = (m: string, op: string) => (na[m] ?? []).includes(op);
  const set = (m: string, op: string, v: boolean) => {
    if (isNa(m, op)) return;
    setDirty(true);
    setPerm((p) => {
      const row = { ...(p[m] ?? {}), [op]: v };
      if (op !== "view" && v) row.view = true;
      if (op === "view" && !v) {
        row.create = false;
        row.edit = false;
        row.delete = false;
      }
      return { ...p, [m]: row };
    });
  };
  const setColumn = (op: string, v: boolean) => {
    for (const m of modules) set(m.key, op, v);
  };
  const setRow = (m: string, v: boolean) => {
    setDirty(true);
    setPerm((p) => ({ ...p, [m]: Object.fromEntries(ops.filter((o) => !isNa(m, o.key)).map((o) => [o.key, v])) }));
  };
  const toggleAct = (k: string, v: boolean) => {
    setDirty(true);
    setActs((a) => (v ? [...new Set([...a, k])] : a.filter((x) => x !== k)));
  };
  const discard = () => {
    setPerm(initialPerm());
    setActs(r.actions ?? []);
    setDirty(false);
    setFormKey((k) => k + 1);
  };
  const grouped = modules.map((m) => ({ ...m, acts: actions.filter((a) => a.module === m.key) })).filter((m) => m.acts.length);

  return (
    <ActionForm key={formKey} action={saveRoleAction} className="space-y-5" onSuccess={() => setDirty(false)}>
      {({ pending, error }) => (
        <fieldset disabled={readOnly} className="space-y-5" onChange={() => setDirty(true)}>
          {r.id && <input type="hidden" name="id" value={r.id} />}
          <FormSection title="Perfil" description={r.system ? "Perfil de sistema: pode ser editado, mas não excluído." : undefined}>
            <FormGrid cols={4}>
              <Field label="Nome" required className="sm:col-span-2">
                <Input name="name" required defaultValue={r.name ?? ""} />
              </Field>
              <Field label="Desconto máximo (%)" hint="Acima do limite: solicitar aprovação de um usuário autorizado. Usuários podem ter limite próprio.">
                <Input name="discountPct" type="number" min={0} max={100} step={0.01} defaultValue={(r.discountLimitBps ?? 0) / 100} />
              </Field>
              <Field label="Situação">
                <Select name="active" defaultValue={r.active === false ? "0" : "1"} options={[{ value: "1", label: "Ativo" }, { value: "0", label: "Inativo (não pode ser atribuído)" }]} />
              </Field>
              <Field label="Descrição" className="sm:col-span-2 lg:col-span-4">
                <Textarea name="description" rows={2} defaultValue={r.description ?? ""} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection
            title="Matriz de permissões por módulo"
            description="Criar, editar ou excluir implicam visualizar. “—” = não se aplica. Excluir vale somente para cadastros sem movimentação; documentos fiscais, vendas e movimentos não são excluídos (são cancelados/estornados)."
            actions={!readOnly && <span className={`text-xs ${dirty ? "font-medium text-accent-700" : "text-slate-500"}`}>{dirty ? "Alterações não salvas" : "Sem alterações"}</span>}
          >
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Módulo</th>
                    {ops.map((o) => (
                      <th key={o.key} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          {o.label}
                          {!readOnly && (
                            <span className="flex gap-1 text-[10px] font-normal">
                              <button type="button" className="text-brand-700 hover:underline" onClick={() => setColumn(o.key, true)}>todos</button>/
                              <button type="button" className="text-brand-700 hover:underline" onClick={() => setColumn(o.key, false)}>nenhum</button>
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="text-center">Linha</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map((m) => (
                    <tr key={m.key}>
                      <td className="font-medium">{m.label}</td>
                      {ops.map((o) => (
                        <td key={o.key} className="text-center">
                          {isNa(m.key, o.key) ? (
                            <span className="text-slate-300" title="Não se aplica a este módulo">—</span>
                          ) : (
                          <input
                            type="checkbox"
                            aria-label={`${m.label}: ${o.label}`}
                            name={`perm.${m.key}.${o.key}`}
                            checked={Boolean(perm[m.key]?.[o.key])}
                            onChange={(e) => set(m.key, o.key, e.target.checked)}
                            className="focus-ring size-4 accent-brand-700"
                          />
                          )}
                        </td>
                      ))}
                      <td className="text-center text-xs">
                        <button type="button" className="text-brand-700 hover:underline" onClick={() => setRow(m.key, !ops.filter((o) => !isNa(m.key, o.key)).every((o) => perm[m.key]?.[o.key]))}>
                          {ops.filter((o) => !isNa(m.key, o.key)).every((o) => perm[m.key]?.[o.key]) ? "limpar" : "tudo"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>

          <FormSection title="Operações sensíveis" description="Ações concedidas à parte da matriz e verificadas também no servidor; tentativas sem permissão ficam no histórico de auditoria.">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {grouped.map((g) => (
                <div key={g.key} className="rounded-md border border-line p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">{g.label}</p>
                  <div className="space-y-1.5">
                    {g.acts.map((a) => (
                      <label key={a.key} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="action" value={a.key} checked={acts.includes(a.key)} onChange={(e) => toggleAct(a.key, e.target.checked)} className="focus-ring size-4 accent-brand-700" />
                        {a.label}
                        <code className="ml-auto text-[10px] text-slate-400">{a.key}</code>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </FormSection>

          {error && <Notice tone="bad">{error}</Notice>}
          {!readOnly && (
            <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
              <span className="mr-auto text-xs text-slate-500">{r.id ? `Aplicação a todos os usuários deste perfil (${usersCount ?? 0}), a partir da próxima ação de cada um.` : "O perfil poderá ser atribuído a usuários após criado."}</span>
              <button type="button" disabled={!dirty || pending} onClick={discard} className="focus-ring inline-flex h-9 items-center rounded-md border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400">
                Descartar
              </button>
              <SubmitButton pending={pending}>{r.id ? "Salvar perfil" : "Criar perfil"}</SubmitButton>
            </div>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}
