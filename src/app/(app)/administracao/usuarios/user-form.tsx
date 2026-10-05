"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { saveUserAction } from "./actions";
import { InviteLinkPanel } from "./invite-link";

type Opt = { value: string; label: string };
type RoleOpt = Opt & { discountLimitBps: number; description?: string | null };

export function UserForm({
  user,
  roles,
  companies,
  branches,
  canGrantAdmin,
  currentCompanyId,
}: {
  user?: Record<string, any> | null;
  roles: RoleOpt[];
  companies: Opt[];
  branches: Array<Opt & { companyId: string }>;
  canGrantAdmin: boolean;
  currentCompanyId: string;
}) {
  const u = user ?? {};
  const router = useRouter();
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [roleId, setRoleId] = useState<string>(u.roleId ?? roles.find((r) => r.label === "Caixa")?.value ?? roles[0]?.value ?? "");
  const [isAdmin, setIsAdmin] = useState<boolean>(Boolean(u.isAdmin));
  const [companyIds, setCompanyIds] = useState<string[]>(u.companyIds?.length ? u.companyIds : [currentCompanyId]);
  const [branchIds, setBranchIds] = useState<string[]>(u.branchIds ?? []);
  const [ownDiscount, setOwnDiscount] = useState<boolean>(u.discountLimitBps != null);
  const [invite, setInvite] = useState<{ id: string; invite: any } | null>(null);
  const role = roles.find((r) => r.value === roleId);
  const visibleBranches = useMemo(() => branches.filter((b) => isAdmin || companyIds.includes(b.companyId)), [branches, companyIds, isAdmin]);
  const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  if (invite) {
    return (
      <div className="space-y-4">
        <InviteLinkPanel invite={invite.invite} />
        <div className="flex gap-2">
          <button type="button" className="text-sm font-medium text-brand-700 underline" onClick={() => router.push(`/administracao/usuarios/${invite.id}`)}>
            Abrir cadastro do usuário
          </button>
        </div>
      </div>
    );
  }

  return (
    <ActionForm
      action={saveUserAction}
      className="space-y-5"
      onSuccess={(data) => {
        if (data?.invite) setInvite(data);
      }}
    >
      {({ pending, error }) => (
        <>
          {u.id && <input type="hidden" name="id" value={u.id} />}
          <FormSection title="Identificação">
            <FormGrid cols={4}>
              <Field label="Nome completo" required className="sm:col-span-2">
                <Input name="name" required defaultValue={u.name ?? ""} autoComplete="off" />
              </Field>
              <Field label="E-mail" required hint="Usado para login, convite e recuperação de senha." className="sm:col-span-2">
                <Input name="email" type="email" required defaultValue={u.email ?? ""} autoComplete="off" />
              </Field>
              <Field label="Login (apelido de acesso)" hint="Opcional. Ex.: maria.silva">
                <Input name="login" defaultValue={u.login ?? ""} autoComplete="off" />
              </Field>
              <Field label="Telefone">
                <Input name="phone" defaultValue={u.phone ?? ""} inputMode="tel" />
              </Field>
            </FormGrid>
          </FormSection>

          {!u.id && (
            <FormSection title="Forma de acesso" description="O convite gera um link de primeiro acesso com validade; a senha inicial é definida por você e informada ao usuário.">
              <div className="flex flex-wrap gap-6">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="mode" value="invite" checked={mode === "invite"} onChange={() => setMode("invite")} className="accent-brand-700" /> Enviar convite (o usuário define a senha)
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="mode" value="password" checked={mode === "password"} onChange={() => setMode("password")} className="accent-brand-700" /> Criar acesso com senha inicial
                </label>
              </div>
              {mode === "password" ? (
                <FormGrid cols={3} className="mt-4">
                  <Field label="Senha inicial" required hint="Mínimo de 8 caracteres.">
                    <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
                  </Field>
                </FormGrid>
              ) : (
                <p className="mt-3 text-xs text-slate-500">O e-mail é enviado pelo canal configurado em Integrações → E-mail. Sem canal configurado, o link é exibido aqui para você copiar e entregar ao usuário.</p>
              )}
            </FormSection>
          )}

          <FormSection title="Perfil e permissões" description="O perfil define a matriz por módulo e as operações específicas.">
            <FormGrid cols={3}>
              <Field label="Perfil de acesso" required={!isAdmin}>
                <Select name="roleId" value={roleId} onChange={(e) => setRoleId(e.target.value)} options={roles} placeholder={isAdmin ? "— (administrador)" : "Selecione"} />
              </Field>
              <div className="flex flex-col justify-end gap-2 sm:col-span-2">
                <Checkbox
                  name="isAdmin"
                  label="Administrador do sistema (acesso total a todas as empresas, ignora a matriz)"
                  checked={isAdmin}
                  disabled={!canGrantAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                />
                {!canGrantAdmin && <span className="text-xs text-slate-500">Somente administradores concedem ou revogam acesso de administrador.</span>}
                {!canGrantAdmin && isAdmin && <input type="hidden" name="isAdmin" value="on" />}
              </div>
            </FormGrid>
            {role?.description && !isAdmin && <p className="mt-3 text-xs text-slate-500">{role.description}</p>}
            <div className="mt-4 rounded-md border border-line p-3">
              <Checkbox name="ownDiscount" label="Definir limite de desconto próprio para este usuário" checked={ownDiscount} onChange={(e) => setOwnDiscount(e.target.checked)} />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {ownDiscount ? (
                  <>
                    <Input name="discountPct" type="number" min={0} max={100} step={0.01} defaultValue={u.discountLimitBps != null ? u.discountLimitBps / 100 : ((role?.discountLimitBps ?? 0) / 100)} className="w-28" aria-label="Limite de desconto (%)" />
                    <span className="text-slate-500">% — substitui o limite do perfil ({((role?.discountLimitBps ?? 0) / 100).toLocaleString("pt-BR")}%).</span>
                  </>
                ) : (
                  <span className="text-slate-500">Usa o limite do perfil: {isAdmin ? "100" : ((role?.discountLimitBps ?? 0) / 100).toLocaleString("pt-BR")}%.</span>
                )}
              </div>
            </div>
          </FormSection>

          <FormSection title="Empresas e filiais" description="Sem filiais marcadas, o usuário acessa todas as filiais das empresas vinculadas.">
            {isAdmin ? (
              <p className="text-sm text-slate-600">Administradores acessam todas as empresas e filiais.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-600">Empresas</p>
                  <div className="space-y-1.5">
                    {companies.map((c) => (
                      <div key={c.value}>
                        <Checkbox name="companyIds" value={c.value} label={c.label} checked={companyIds.includes(c.value)} onChange={(e) => setCompanyIds((l) => toggle(l, c.value, e.target.checked))} />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-600">Filiais permitidas</p>
                  <div className="space-y-1.5">
                    {visibleBranches.map((b) => (
                      <div key={b.value}>
                        <Checkbox name="branchIds" value={b.value} label={b.label} checked={branchIds.includes(b.value)} onChange={(e) => setBranchIds((l) => toggle(l, b.value, e.target.checked))} />
                      </div>
                    ))}
                    {!visibleBranches.length && <p className="text-xs text-slate-500">Selecione ao menos uma empresa.</p>}
                  </div>
                  {branchIds.filter((b) => visibleBranches.some((v) => v.value === b)).length === 0 && <p className="mt-2 text-xs text-slate-500">Nenhuma marcada: todas as filiais.</p>}
                </div>
              </div>
            )}
            {isAdmin && companyIds.map((c) => <input key={c} type="hidden" name="companyIds" value={c} />)}
          </FormSection>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <a href={u.id ? `/administracao/usuarios/${u.id}` : "/administracao/usuarios"} className="focus-ring inline-flex h-9 items-center rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-slate-50">
              Descartar
            </a>
            <SubmitButton pending={pending}>{u.id ? "Salvar alterações" : mode === "invite" ? "Criar e convidar" : "Criar acesso"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
