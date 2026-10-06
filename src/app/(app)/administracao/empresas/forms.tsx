"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid, FormSection, Checkbox } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { saveCompanyAction, saveBranchAction, setCompanyUsersAction } from "./actions";

type Opt = { value: string; label: string };

function AddressFields({ a, ufs }: { a: Record<string, any>; ufs: string[] }) {
  return (
    <FormGrid cols={6}>
      <Field label="CEP"><Input name="zip" defaultValue={a.zip ?? ""} inputMode="numeric" maxLength={9} /></Field>
      <Field label="Logradouro" className="sm:col-span-2 lg:col-span-3"><Input name="street" defaultValue={a.street ?? ""} /></Field>
      <Field label="Número"><Input name="number" defaultValue={a.number ?? ""} /></Field>
      <Field label="Complemento"><Input name="complement" defaultValue={a.complement ?? ""} /></Field>
      <Field label="Bairro" className="lg:col-span-2"><Input name="district" defaultValue={a.district ?? ""} /></Field>
      <Field label="Município" className="lg:col-span-2"><Input name="cityName" defaultValue={a.cityName ?? ""} /></Field>
      <Field label="UF"><Select name="uf" defaultValue={a.uf ?? ""} placeholder="—" options={ufs.map((u) => ({ value: u, label: u }))} /></Field>
      <Field label="Município (IBGE)" hint="7 dígitos — exigido na NF-e."><Input name="cityCode" defaultValue={a.cityCode ?? ""} inputMode="numeric" maxLength={7} /></Field>
    </FormGrid>
  );
}

export function CompanyForm({ company, regimes, crts, ufs }: { company?: Record<string, any> | null; regimes: Array<Opt & { crt: string }>; crts: Opt[]; ufs: string[] }) {
  const c = company ?? {};
  const [regime, setRegime] = useState<string>(c.regime ?? "simples");
  const [crt, setCrt] = useState<string>(c.crt ?? regimes.find((r) => r.value === (c.regime ?? "simples"))?.crt ?? "1");
  return (
    <ActionForm action={saveCompanyAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {c.id && <input type="hidden" name="id" value={c.id} />}
          <FormSection title="Identificação">
            <FormGrid cols={4}>
              <Field label="Razão social" required className="sm:col-span-2"><Input name="name" required defaultValue={c.name ?? ""} /></Field>
              <Field label="Nome fantasia" className="sm:col-span-2"><Input name="tradeName" defaultValue={c.tradeName ?? ""} /></Field>
              <Field label="CNPJ" hint="Único no sistema."><Input name="cnpj" defaultValue={c.cnpj ?? ""} inputMode="numeric" /></Field>
              {!c.id && <Field label="Nome da filial matriz"><Input name="branchName" defaultValue="Matriz" /></Field>}
            </FormGrid>
          </FormSection>
          <FormSection title="Contatos">
            <FormGrid cols={3}>
              <Field label="E-mail"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
              <Field label="Telefone"><Input name="phone" defaultValue={c.phone ?? ""} inputMode="tel" /></Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Endereço (sede)">
            <AddressFields a={c.address ?? {}} ufs={ufs} />
          </FormSection>
          <FormSection title="Dados fiscais" description="Usados na emissão de documentos novos; documentos já emitidos mantêm os dados da época.">
            <FormGrid cols={4}>
              <Field label="Inscrição estadual" hint="Use ISENTO quando aplicável."><Input name="ie" defaultValue={c.ie ?? ""} /></Field>
              <Field label="Inscrição municipal"><Input name="im" defaultValue={c.im ?? ""} /></Field>
              <Field label="Regime tributário">
                <Select
                  name="regime"
                  value={regime}
                  onChange={(e) => {
                    setRegime(e.target.value);
                    setCrt(regimes.find((r) => r.value === e.target.value)?.crt ?? crt);
                  }}
                  options={regimes}
                />
              </Field>
              <Field label="CRT"><Select name="crt" value={crt} onChange={(e) => setCrt(e.target.value)} options={crts} /></Field>
              <Field label="CNAE principal" hint="7 dígitos."><Input name="cnae" defaultValue={c.cnae ?? ""} inputMode="numeric" /></Field>
            </FormGrid>
            <Field label="Observações" className="mt-4"><Textarea name="notes" defaultValue={c.notes ?? ""} /></Field>
          </FormSection>
          {!c.id && <Notice tone="info">Ao salvar, são criados a filial matriz, depósitos (principal e avarias), perfis padrão, tabela de preço Varejo, contas caixa/banco, meios e condições de pagamento e categorias financeiras. A configuração fiscal fica pendente.</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <SubmitButton pending={pending}>{c.id ? "Salvar empresa" : "Criar empresa"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function BranchForm({
  branch,
  companyId,
  warehouses,
  priceTables,
  timezone,
  ufs,
  users,
}: {
  branch?: Record<string, any> | null;
  companyId: string;
  warehouses: Opt[];
  priceTables: Opt[];
  /** fuso único da instalação (somente leitura) */
  timezone: string;
  ufs: string[];
  users: Opt[];
}) {
  const b = branch ?? {};
  return (
    <ActionForm action={saveBranchAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {b.id && <input type="hidden" name="id" value={b.id} />}
          <input type="hidden" name="companyId" value={companyId} />
          <FormSection title="Identificação e contatos">
            <FormGrid cols={4}>
              <Field label="Código" required hint="Ex.: 01, 02 — único na empresa."><Input name="code" required defaultValue={b.code ?? ""} maxLength={20} /></Field>
              <Field label="Nome da filial" required className="sm:col-span-2 lg:col-span-3"><Input name="name" required defaultValue={b.name ?? ""} /></Field>
              <Field label="CNPJ da filial"><Input name="cnpj" defaultValue={b.cnpj ?? ""} inputMode="numeric" /></Field>
              <Field label="Inscrição estadual"><Input name="ie" defaultValue={b.ie ?? ""} /></Field>
              <Field label="Inscrição municipal"><Input name="im" defaultValue={b.im ?? ""} /></Field>
              <Field label="Telefone"><Input name="phone" defaultValue={b.phone ?? ""} inputMode="tel" /></Field>
              <Field label="E-mail"><Input name="email" type="email" defaultValue={b.email ?? ""} /></Field>
              <Field label="Responsável pela unidade"><Select name="managerUserId" defaultValue={b.managerUserId ?? ""} options={users} placeholder="—" /></Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Endereço">
            <AddressFields a={b.address ?? { uf: b.uf, cityName: b.cityName, cityCode: b.cityCode }} ufs={ufs} />
          </FormSection>
          <FormSection title="Parametrização da unidade" description="Usada pelo PDV, preços e relatórios desta filial.">
            <FormGrid cols={3}>
              <Field label="Tabela de preço padrão">
                <Select name="defaultPriceTableId" defaultValue={b.defaultPriceTableId ?? ""} options={priceTables} placeholder="Tabela padrão da empresa" />
              </Field>
              {b.id ? (
                <Field label="Depósito padrão" hint="Origem do estoque nas vendas (salvo configuração do terminal).">
                  <Select name="defaultWarehouseId" defaultValue={b.defaultWarehouseId ?? ""} options={warehouses} />
                </Field>
              ) : (
                <Field label="Depósito padrão"><p className="pt-2 text-sm text-slate-500">“Depósito principal”, criado com a filial.</p></Field>
              )}
              <Field label="Fuso horário" hint="Único para toda a instalação: alterado pelo responsável técnico na variável APP_TIMEZONE do servidor.">
                <p className="pt-2 text-sm text-slate-700">{timezone.replace("America/", "").replace("_", " ")} <span className="text-xs text-slate-500">({timezone})</span></p>
              </Field>
            </FormGrid>
          </FormSection>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <SubmitButton pending={pending}>{b.id ? "Salvar filial" : "Criar filial"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function CompanyUsersForm({ companyId, users, disabled }: { companyId: string; users: Array<{ id: string; name: string; email: string; linked: boolean; isAdmin: boolean; status: string; self?: boolean }>; disabled?: boolean }) {
  return (
    <ActionForm action={setCompanyUsersAction} className="space-y-3">
      {({ pending, error }) => (
        <fieldset disabled={disabled} className="space-y-3">
          <input type="hidden" name="companyId" value={companyId} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {users.map((u) => (
              <div key={u.id} className="rounded-md border border-line px-3 py-2">
                {u.isAdmin ? (
                  <p className="text-sm">
                    {u.name} <span className="text-xs text-slate-500">— administrador (todas as empresas)</span>
                  </p>
                ) : u.self ? (
                  <p className="text-sm">
                    {u.name} <span className="block text-xs text-slate-500">você — {u.linked ? "vinculado" : "não vinculado"} (o próprio vínculo é alterado por outro gestor)</span>
                  </p>
                ) : (
                  <Checkbox name="userIds" value={u.id} defaultChecked={u.linked} label={<span>{u.name} <span className="block text-xs text-slate-500">{u.email}{u.status !== "active" ? ` · ${u.status}` : ""}</span></span>} />
                )}
              </div>
            ))}
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          {!disabled && (
            <div className="flex justify-end">
              <SubmitButton pending={pending}>Salvar vínculos</SubmitButton>
            </div>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}
