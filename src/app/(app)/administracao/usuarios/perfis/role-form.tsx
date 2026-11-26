"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea, FormGrid, FormSection, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import type { ActionResult } from "@/lib/server/action";
import { previewRoleImpactAction, saveRoleAction } from "../actions";

type Mod = { key: string; label: string };
type Op = { key: string; label: string };
type Act = { key: string; label: string; module: string };
type Impact = {
  roleName: string;
  affected: Array<{ id: string; name: string; email: string; status: string }>;
  diff: { before: Record<string, string>; after: Record<string, string> };
  changes: number;
  required: boolean;
  token: string;
};

/**
 * Impacto antes de salvar um perfil compartilhado: lista das pessoas afetadas (nome, e-mail, situação) e a diferença das
 * permissões; salvar só depois da confirmação explícita (o servidor também recusa sem ela).
 */
function ImpactDialog({ impact, onAnswer }: { impact: Impact; onAnswer: (ok: boolean) => void }) {
  const [ack, setAck] = useState(false);
  const n = impact.affected.length;
  return (
    <Dialog
      open
      onClose={() => onAnswer(false)}
      title={`Confirmar alteração do perfil “${impact.roleName}”`}
      size="xl"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onAnswer(false)}>
            Voltar sem salvar
          </Button>
          <Button type="button" variant="primary" disabled={!ack} onClick={() => onAnswer(true)}>
            Confirmar e salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p>
          O perfil é compartilhado: a alteração vale para <b>{n} pessoa{n === 1 ? "" : "s"}</b>, a partir da próxima ação de cada uma.
        </p>
        <div className="max-h-64 overflow-y-auto rounded-md border border-line">
          <table className="table-base w-full text-sm" aria-label="Pessoas afetadas">
            <thead>
              <tr><th>Nome</th><th>E-mail</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {impact.affected.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.email}</td>
                  <td><StatusBadge kind="user" status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="mb-1 font-medium">O que muda ({impact.changes} item{impact.changes === 1 ? "" : "s"})</p>
          <div className="max-h-64 overflow-y-auto rounded-md border border-line">
            <table className="table-base w-full text-sm" aria-label="Diferença das permissões">
              <thead>
                <tr><th>Item</th><th>Antes</th><th>Depois</th></tr>
              </thead>
              <tbody>
                {Object.keys(impact.diff.after).map((k) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="text-slate-500">{impact.diff.before[k] ?? "—"}</td>
                    <td className="font-medium">{impact.diff.after[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="focus-ring mt-0.5 size-4 shrink-0 accent-brand-700" />
          <span>Revisei as pessoas afetadas e as mudanças, e quero aplicá-las a todas elas.</span>
        </label>
      </div>
    </Dialog>
  );
}

/** Editor da matriz visualizar/criar/editar/excluir por módulo + operações específicas (visão 9). */
export function RoleForm({ role, modules, ops, actions, na, readOnly, usersCount }: { role?: Record<string, any> | null; modules: Mod[]; ops: Op[]; actions: Act[]; na: Record<string, string[]>; readOnly?: boolean; usersCount?: number }) {
  const r = role ?? {};
  const [pendingImpact, setPendingImpact] = useState<{ impact: Impact; resolve: (ok: boolean) => void } | null>(null);
  // perfil existente: antes de salvar, mostra o impacto (pessoas + diferença) e só segue com a confirmação explícita
  const submit = async (fd: FormData): Promise<ActionResult<any>> => {
    if (r.id) {
      fd.delete("confirmImpact");
      const p = await previewRoleImpactAction(fd);
      if (!p.ok) return p;
      const impact = p.data as Impact | undefined;
      if (impact?.required) {
        const ok = await new Promise<boolean>((resolve) => setPendingImpact({ impact, resolve }));
        setPendingImpact(null);
        if (!ok) return { ok: false, error: "Alteração não salva: o impacto não foi confirmado." };
        fd.set("confirmImpact", impact.token);
      }
    }
    return saveRoleAction(fd);
  };
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
    <>
    {pendingImpact && <ImpactDialog impact={pendingImpact.impact} onAnswer={pendingImpact.resolve} />}
    <ActionForm key={formKey} action={submit} className="space-y-5" onSuccess={() => setDirty(false)}>
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
              <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-4">
                <input type="checkbox" name="requireTwoFactor" defaultChecked={Boolean(r.requireTwoFactor)} className="focus-ring mt-0.5 size-4 shrink-0 accent-brand-700" />
                <span>
                  <span className="font-medium">Exigir autenticação em duas etapas</span>
                  <span className="block text-xs text-slate-500">Depois da senha, o usuário informa o código do aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…). Quem ainda não cadastrou o aplicativo é levado ao cadastro no próximo login, sem acesso ao restante do sistema até concluir.</span>
                </span>
              </label>
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
                      <label key={a.key} className="flex items-center gap-2 text-sm" title={a.key}>
                        <input type="checkbox" name="action" value={a.key} checked={acts.includes(a.key)} onChange={(e) => toggleAct(a.key, e.target.checked)} className="focus-ring size-4 shrink-0 accent-brand-700" />
                        {a.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </FormSection>

          {r.id && !readOnly && (
            <FormSection title="Motivo / contexto da alteração" description="Opcional; fica registrado no histórico de auditoria junto com o antes/depois.">
              <Textarea name="reason" rows={2} placeholder="Ex.: ajuste do perfil Caixa para a operação do cliente-piloto" />
            </FormSection>
          )}
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
    </>
  );
}
