"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { savePolicyAction } from "../actions";

type Opt = { value: string; label: string };
interface Step { name: string; kind: "role" | "users" | "action"; roleIds?: string[]; userIds?: string[] }
interface Tier { above: number; steps: Step[] }

export function PolicyForm({ policy, roles, users, branches, budgets, canEdit }: { policy: { name: string; tiers: Tier[]; autoApproveBelow: number; allowSelfApproval: boolean; distinctApprovers: boolean; expiredProposalAction: string; reviewOnRevision: string }; roles: Opt[]; users: Opt[]; branches: Opt[]; budgets: Record<string, number>; canEdit: boolean }) {
  const [tiers, setTiers] = useState<Tier[]>(policy.tiers);
  const [auto, setAuto] = useState(policy.autoApproveBelow);
  const [bud, setBud] = useState<Record<string, number>>(budgets);
  const setTier = (i: number, patch: Partial<Tier>) => setTiers((a) => a.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setStep = (i: number, k: number, patch: Partial<Step>) => setTier(i, { steps: tiers[i].steps.map((s, j) => (j === k ? { ...s, ...patch } : s)) });
  const multi = (values: string[] | undefined, opts: Opt[], onChange: (v: string[]) => void) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {opts.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" disabled={!canEdit} className="accent-brand-700" checked={(values ?? []).includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...(values ?? []), o.value] : (values ?? []).filter((x) => x !== o.value))} />
          {o.label}
        </label>
      ))}
    </div>
  );
  return (
    <ActionForm action={savePolicyAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="tiers" value={JSON.stringify(tiers)} />
          <input type="hidden" name="autoApproveBelow" value={auto} />
          <input type="hidden" name="budgets" value={JSON.stringify(bud)} />
          {!canEdit && <Notice tone="info">Somente administradores alteram a política. Você está vendo a configuração vigente.</Notice>}
          <FormSection title="Política" description="A alçada considera o total da solicitação com frete (todos os pedidos). Vale a faixa de maior valor que o total ultrapassa.">
            <FormGrid cols={3}>
              <Field label="Nome" required className="sm:col-span-2"><Input name="name" defaultValue={policy.name} disabled={!canEdit} required /></Field>
              <Field label="Autoaprovar abaixo de" hint="0 = desligado. Abaixo deste total, aprova ao enviar."><MoneyInput value={auto} onChange={setAuto} disabled={!canEdit} ariaLabel="Autoaprovar abaixo de" /></Field>
            </FormGrid>
            <div className="mt-4 flex flex-wrap gap-6">
              <Checkbox name="allowSelfApproval" label="Permitir decidir a própria solicitação" defaultChecked={policy.allowSelfApproval} disabled={!canEdit} />
              <Checkbox name="distinctApprovers" label="Exigir aprovadores diferentes em cada etapa" defaultChecked={policy.distinctApprovers} disabled={!canEdit} />
            </div>
            <FormGrid cols={2} className="mt-4">
              <Field label="Proposta vencida">
                <Select name="expiredProposalAction" defaultValue={policy.expiredProposalAction} disabled={!canEdit} options={[{ value: "block", label: "Bloquear aprovação (devolver para renovar)" }, { value: "warn", label: "Permitir com observação obrigatória" }, { value: "allow", label: "Permitir" }]} />
              </Field>
              <Field label="Alteração comercial após aprovação">
                <Select name="reviewOnRevision" defaultValue={policy.reviewOnRevision} disabled={!canEdit} options={[{ value: "relevant", label: "Nova análise se relevante (aumento de total, qtd., custo, item novo ou condição)" }, { value: "always", label: "Sempre nova análise" }, { value: "never", label: "Nunca (só registra a revisão)" }]} />
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection
            title="Alçadas e etapas"
            actions={canEdit && (
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setTiers([{ above: 0, steps: [{ name: "Aprovação de compras", kind: "action" }] }])}>Fluxo simples (uma etapa)</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTiers((a) => [...a, { above: (a[a.length - 1]?.above ?? 0) + 500000, steps: [{ name: "Nova etapa", kind: "role", roleIds: [] }] }])}><Plus className="size-4" /> Faixa</Button>
              </span>
            )}
          >
            <div className="space-y-4">
              {tiers.map((t, i) => (
                <div key={i} className="rounded-md border border-line p-3">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <Field label={i === 0 ? "Faixa base (a partir de)" : "Acima de"} className="w-56"><MoneyInput value={t.above} onChange={(v) => setTier(i, { above: v })} disabled={!canEdit} ariaLabel="Valor da alçada" /></Field>
                    <span className="text-xs text-slate-500">{t.above ? `Solicitações com total acima de ${formatMoney(t.above)}` : "Qualquer valor (até a próxima faixa)"} · etapas sequenciais</span>
                    {canEdit && tiers.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setTiers((a) => a.filter((_, j) => j !== i))}><Trash2 className="size-4" /> Remover faixa</Button>}
                  </div>
                  <ol className="space-y-3">
                    {t.steps.map((st, k) => (
                      <li key={k} className="rounded-md bg-slate-50 p-3">
                        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
                          <Field label={`Etapa ${k + 1} — nome`}><Input value={st.name} onChange={(e) => setStep(i, k, { name: e.target.value })} disabled={!canEdit} /></Field>
                          <Field label="Responsáveis por">
                            <Select value={st.kind} onChange={(e) => setStep(i, k, { kind: e.target.value as Step["kind"] })} disabled={!canEdit} options={[{ value: "role", label: "Perfil" }, { value: "users", label: "Usuários nomeados" }, { value: "action", label: "Quem tem “Aprovar compras”" }]} />
                          </Field>
                          {canEdit && t.steps.length > 1 && <Button type="button" variant="ghost" size="sm" className="self-end" onClick={() => setTier(i, { steps: t.steps.filter((_, j) => j !== k) })} aria-label="Remover etapa"><Trash2 className="size-4" /></Button>}
                        </div>
                        <div className="mt-2">
                          {st.kind === "role" && multi(st.roleIds, roles, (v) => setStep(i, k, { roleIds: v }))}
                          {st.kind === "users" && multi(st.userIds, users, (v) => setStep(i, k, { userIds: v }))}
                          {st.kind === "action" && <p className="text-xs text-slate-500">Qualquer usuário (não administrador) com a permissão especial “Aprovar compras”.</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {canEdit && t.steps.length < 6 && <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setTier(i, { steps: [...t.steps, { name: "Diretoria", kind: "users", userIds: [] }] })}><Plus className="size-4" /> Etapa</Button>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Somente usuários com a permissão “Aprovar compras” decidem, mesmo que estejam no perfil/lista da etapa. Administradores podem decidir qualquer etapa, respeitando as regras de solicitação própria e aprovadores distintos.</p>
          </FormSection>
          <FormSection title="Orçamento mensal de compras por filial" description="Mostrado no novo pedido (consumido = aprovados no mês + em análise). 0 = não controlado. Não bloqueia: orienta a decisão.">
            <FormGrid cols={3}>
              {branches.map((b) => (
                <Field key={b.value} label={b.label}><MoneyInput value={bud[b.value] ?? 0} onChange={(v) => setBud({ ...bud, [b.value]: v })} disabled={!canEdit} ariaLabel={`Orçamento ${b.label}`} /></Field>
              ))}
            </FormGrid>
          </FormSection>
          {error && <Notice tone="bad">{error}</Notice>}
          {canEdit && <div className="flex justify-end"><SubmitButton pending={pending} variant="accent">Salvar política</SubmitButton></div>}
        </>
      )}
    </ActionForm>
  );
}
