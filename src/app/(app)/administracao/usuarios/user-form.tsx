"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { saveUserAction } from "./actions";
import { InviteLinkPanel } from "./invite-link";

type Opt = { value: string; label: string };
type RoleOpt = Opt & { discountLimitBps: number; description?: string | null; disabled?: boolean };

export function UserForm({
  user,
  roles,
  companies,
  branches,
  canGrantAdmin,
  currentCompanyId,
  kept,
  self = false,
  editorRestricted = false,
  roleLocked = false,
  branchScope,
  attributes,
}: {
  user?: Record<string, any> | null;
  roles: RoleOpt[];
  companies: Opt[];
  /** filiais DESTA empresa que o editor pode conceder (multiempresa: a atribuição vale por empresa) */
  branches: Array<Opt & { companyId: string }>;
  canGrantAdmin: boolean;
  currentCompanyId: string;
  /** vínculos do usuário com empresas fora do alcance do editor (preservados pelo servidor) */
  kept?: { companies: number; branches: number };
  /** editor (não administrador) editando o próprio cadastro: vínculo, cargo, perfil e limite ficam somente leitura */
  self?: boolean;
  /** o editor acessa só algumas filiais desta empresa: só concede as dele e não libera “todas” */
  editorRestricted?: boolean;
  /** o perfil atual do usuário vai além do acesso do editor: só quem tem esse acesso troca o perfil */
  roleLocked?: boolean;
  /** filiais do usuário NESTA empresa (null = todas; ausente = usuário novo) */
  branchScope?: string[] | null;
  /** cargo, departamento e função do usuário NESTA empresa */
  attributes?: { jobTitle: string | null; department: string | null; jobFunction: string | null };
}) {
  const u = user ?? {};
  const router = useRouter();
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const defaultRole = roles.find((r) => !r.disabled && r.label === "Caixa")?.value ?? roles.find((r) => !r.disabled)?.value ?? "";
  const [roleId, setRoleId] = useState<string>(u.roleId ?? defaultRole);
  const [isAdmin, setIsAdmin] = useState<boolean>(Boolean(u.isAdmin));
  const [companyIds, setCompanyIds] = useState<string[]>(u.companyIds?.length ? u.companyIds : [currentCompanyId]);
  const isNew = !u.id;
  // filiais desta empresa: "todas" ou "só as marcadas"
  const [branchMode, setBranchMode] = useState<"all" | "some">(isNew ? (editorRestricted ? "some" : "all") : branchScope === null || branchScope === undefined ? "all" : "some");
  const [companyBranchIds, setCompanyBranchIds] = useState<string[]>((branchScope ?? []).filter((b) => branches.some((o) => o.value === b)));
  const [ownDiscount, setOwnDiscount] = useState<boolean>(u.discountLimitBps != null);
  const [invite, setInvite] = useState<{ id: string; invite: any } | null>(null);
  const role = roles.find((r) => r.value === roleId);
  // editor com acesso a só algumas filiais diante de quem acessa todas: não restringe (mexeria em filiais fora do alcance dele)
  const lockedAll = !isNew && editorRestricted && (branchScope === null || branchScope === undefined);
  const hiddenOutside = (branchScope ?? []).filter((b) => !branches.some((o) => o.value === b)).length;
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
              <Field label="Cargo nesta empresa" hint="Função da pessoa (ex.: Gerente de loja). Não dá permissões: o acesso vem do perfil — ou da regra de Parâmetros › Perfil por cargo, quando nenhum perfil é escolhido." className="sm:col-span-2">
                {self ? <Input defaultValue={attributes?.jobTitle ?? ""} disabled aria-label="Cargo nesta empresa" /> : <Input name="jobTitle" defaultValue={attributes?.jobTitle ?? ""} maxLength={80} autoComplete="off" />}
              </Field>
              <Field label="Departamento nesta empresa">
                {self ? <Input defaultValue={attributes?.department ?? ""} disabled aria-label="Departamento nesta empresa" /> : <Input name="department" defaultValue={attributes?.department ?? ""} maxLength={80} autoComplete="off" />}
              </Field>
              <Field label="Função nesta empresa">
                {self ? <Input defaultValue={attributes?.jobFunction ?? ""} disabled aria-label="Função nesta empresa" /> : <Input name="jobFunction" defaultValue={attributes?.jobFunction ?? ""} maxLength={80} autoComplete="off" />}
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

          {self && (
            <>
              <Notice tone="info">Você está editando o próprio cadastro: cargo, perfil, empresas, filiais e limite de desconto só podem ser alterados por outro gestor de usuários.</Notice>
              <input type="hidden" name="roleId" value={roleId} />
              {companyIds.map((c) => <input key={c} type="hidden" name="companyIds" value={c} />)}
              {(u.branchIds ?? []).map((b: string) => <input key={b} type="hidden" name="branchIds" value={b} />)}
              {u.discountLimitBps != null && (
                <>
                  <input type="hidden" name="ownDiscount" value="on" />
                  <input type="hidden" name="discountPct" value={String(u.discountLimitBps / 100)} />
                </>
              )}
            </>
          )}
          {!self && roleLocked && <input type="hidden" name="roleId" value={roleId} />}
          <fieldset disabled={self} className="space-y-5">
          <FormSection title="Perfil e permissões" description="O perfil define a matriz por módulo e as operações específicas. Vale na empresa em uso; nas demais empresas do usuário, o perfil de cada uma é mantido. Você só atribui perfis cujo acesso você mesmo tem.">
            <FormGrid cols={3}>
              <Field label="Perfil de acesso nesta empresa" required={!isAdmin}>
                <Select name={self || roleLocked ? undefined : "roleId"} value={roleId} disabled={roleLocked} onChange={(e) => setRoleId(e.target.value)} options={roles} placeholder={isAdmin ? "— (administrador)" : "Selecione"} />
              </Field>
              <div className="flex flex-col justify-end gap-2 sm:col-span-2">
                <Checkbox
                  name="isAdmin"
                  label="Administrador da plataforma (acesso total a todas as empresas, ignora a matriz)"
                  checked={isAdmin}
                  disabled={!canGrantAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                />
                {!canGrantAdmin && <span className="text-xs text-slate-500">Somente o administrador da plataforma concede ou revoga esse acesso.</span>}
                {!canGrantAdmin && isAdmin && <input type="hidden" name="isAdmin" value="on" />}
              </div>
            </FormGrid>
            {roleLocked && !self && (
              <p className="mt-3 text-xs text-amber-800">O perfil atual desta pessoa tem acessos que você não tem nesta empresa: só quem tem esses acessos troca o perfil dela.</p>
            )}
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

          <FormSection title="Empresas e filiais" description="As filiais valem por empresa: aqui você define as filiais desta empresa. Nas demais empresas do usuário, as filiais são definidas a partir de cada uma.">
            {isAdmin ? (
              <p className="text-sm text-slate-600">O administrador da plataforma acessa todas as empresas e filiais.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-600">Empresas</p>
                  <div className="space-y-1.5">
                    {companies.map((c) => (
                      <div key={c.value}>
                        <Checkbox
                          name="companyIds"
                          value={c.value}
                          label={c.label}
                          checked={companyIds.includes(c.value)}
                          disabled={c.value === currentCompanyId}
                          onChange={(e) => setCompanyIds((l) => toggle(l, c.value, e.target.checked))}
                        />
                      </div>
                    ))}
                    {/* a empresa em uso sempre fica vinculada (o perfil escolhido vale nela) */}
                    {!self && <input type="hidden" name="companyIds" value={currentCompanyId} />}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-600">Filiais nesta empresa</p>
                  {self ? (
                    <p className="text-sm text-slate-600">{branchScope === null || branchScope === undefined ? "Todas as filiais desta empresa." : `${companyBranchIds.length} filial(is) desta empresa.`}</p>
                  ) : lockedAll ? (
                    <>
                      <input type="hidden" name="branchMode" value="all" />
                      <p className="text-sm text-slate-600">Todas as filiais desta empresa.</p>
                      <p className="mt-2 text-xs text-slate-500">Você acessa só algumas filiais desta empresa, e esta pessoa acessa todas: só quem acessa todas as filiais pode restringir esse acesso.</p>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <label className={`flex items-center gap-2 text-sm ${editorRestricted ? "text-slate-400" : ""}`}>
                        <input type="radio" name="branchMode" value="all" checked={branchMode === "all"} disabled={editorRestricted} onChange={() => setBranchMode("all")} className="accent-brand-700" />
                        Todas as filiais desta empresa (inclui o consolidado)
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="branchMode" value="some" checked={branchMode === "some"} onChange={() => setBranchMode("some")} className="accent-brand-700" />
                        Somente as filiais marcadas
                      </label>
                      <div className="space-y-1.5 pl-6">
                        {branches.map((b) => (
                          <div key={b.value}>
                            <Checkbox
                              name="companyBranchIds"
                              value={b.value}
                              label={b.label}
                              checked={companyBranchIds.includes(b.value)}
                              disabled={branchMode !== "some"}
                              onChange={(e) => setCompanyBranchIds((l) => toggle(l, b.value, e.target.checked))}
                            />
                          </div>
                        ))}
                        {!branches.length && <p className="text-xs text-slate-500">Nenhuma filial disponível.</p>}
                      </div>
                      {editorRestricted && <p className="text-xs text-slate-500">Você acessa só algumas filiais desta empresa: só concede filiais dentre as suas{hiddenOutside ? `; as ${hiddenOutside} filial(is) desta pessoa fora do seu acesso são mantidas` : ""}.</p>}
                      {branchMode === "some" && companyBranchIds.length === 0 && <p className="text-xs text-amber-800">Marque ao menos uma filial (ou escolha todas as filiais).</p>}
                    </div>
                  )}
                </div>
              </div>
            )}
            {isAdmin && !self && companyIds.map((c) => <input key={c} type="hidden" name="companyIds" value={c} />)}
            {!isAdmin && kept && kept.companies > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Este usuário também está vinculado a {kept.companies} empresa(s) fora do seu alcance (empresas a que você não tem acesso ou em que não administra usuários). Esses vínculos, e o perfil, o cargo e as filiais dele nelas, são mantidos ao salvar.
              </p>
            )}
          </FormSection>
          </fieldset>

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
