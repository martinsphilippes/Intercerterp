"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { saveCustomerAction, lookupCnpjAction } from "./actions";
import type { Address } from "@/domain/customers";

type Opt = { value: string; label: string };

export function CustomerForm({ customer, sellers, priceTables, terms }: { customer?: Record<string, any> | null; sellers: Opt[]; priceTables: Opt[]; terms: Opt[] }) {
  const c = customer ?? {};
  const [personType, setPersonType] = useState<"PF" | "PJ">(c.personType ?? "PF");
  const [addresses, setAddresses] = useState<Address[]>(c.addresses?.length ? c.addresses : [{ type: "principal" }]);
  const [contacts, setContacts] = useState<Array<{ name: string; role?: string; email?: string; phone?: string }>>(c.contacts ?? []);
  const [promo, setPromo] = useState<boolean>(Boolean(c.acceptsPromotions));
  const [lookup, setLookup] = useState<{ source?: string; consultedAt?: string; situation?: string } | null>(null);
  const status: string = c.status ?? "active";
  const [pendingLookup, startLookup] = useTransition();
  const toast = useToast();
  const [form, setForm] = useState({ name: c.name ?? "", tradeName: c.tradeName ?? "", email: c.email ?? "", phone: c.phone ?? "", doc: c.doc ?? "" });

  const setAddr = (i: number, patch: Partial<Address>) => setAddresses((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <ActionForm action={saveCustomerAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {c.id && <input type="hidden" name="id" value={c.id} />}
          <input type="hidden" name="addresses" value={JSON.stringify(addresses)} />
          <input type="hidden" name="contacts" value={JSON.stringify(contacts)} />
          <FormSection title="Identificação" description="CPF/CNPJ é normalizado e único na empresa — evita cadastros duplicados.">
            <FormGrid cols={4}>
              <Field label="Tipo de pessoa" required>
                <Select name="personType" value={personType} onChange={(e) => setPersonType(e.target.value as "PF" | "PJ")} options={[{ value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" }]} />
              </Field>
              <Field label={personType === "PF" ? "CPF" : "CNPJ"} required={personType === "PJ"}>
                <div className="flex gap-2">
                  <Input name="doc" value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })} inputMode="numeric" placeholder={personType === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} />
                  {personType === "PJ" && (
                    <Button
                      type="button"
                      variant="secondary"
                      title="Consultar CNPJ em serviço externo"
                      loading={pendingLookup}
                      onClick={() =>
                        startLookup(async () => {
                          const r = await lookupCnpjAction(form.doc);
                          if (!r.ok) return toast("error", r.error);
                          const d: any = (r.data as any).result;
                          if (!d.ok) return toast("error", d.message);
                          setForm((f) => ({ ...f, name: d.data.name ?? f.name, tradeName: d.data.tradeName ?? f.tradeName, email: d.data.email ?? f.email, phone: d.data.phone ?? f.phone }));
                          setAddresses((a) => [{ ...a[0], ...d.data.address, type: "principal" }, ...a.slice(1)]);
                          setLookup({ source: d.source, consultedAt: d.consultedAt, situation: d.data.situation });
                          toast("info", "Dados preenchidos a partir da consulta. Confira antes de salvar.");
                        })
                      }
                    >
                      <Search className="size-4" />
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="Código do cliente" hint="Gerado automaticamente se vazio.">
                <Input name="code" defaultValue={c.code ?? ""} />
              </Field>
              <Field label="Vendedor responsável">
                <Select name="sellerId" defaultValue={c.sellerId ?? ""} options={sellers} placeholder="—" />
              </Field>
              <Field label={personType === "PF" ? "Nome completo" : "Razão social"} required className="sm:col-span-2">
                <Input name="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              {personType === "PJ" ? (
                <Field label="Nome fantasia" className="sm:col-span-2">
                  <Input name="tradeName" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
                </Field>
              ) : (
                <>
                  <Field label="Data de nascimento">
                    <Input type="date" name="birthDate" defaultValue={c.birthDate ?? ""} />
                  </Field>
                  <Field label="Gênero">
                    <Select name="gender" defaultValue={c.gender ?? ""} placeholder="Não informado" options={["Feminino", "Masculino", "Não binário", "Prefere não informar"].map((v) => ({ value: v, label: v }))} />
                  </Field>
                  <Field label="Estado civil">
                    <Select name="maritalStatus" defaultValue={c.maritalStatus ?? ""} placeholder="Não informado" options={["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"].map((v) => ({ value: v, label: v }))} />
                  </Field>
                  <Field label="Profissão">
                    <Input name="profession" defaultValue={c.profession ?? ""} />
                  </Field>
                </>
              )}
            </FormGrid>
            {lookup && (
              <div className="mt-4">
                <Notice tone="info" title="Dados sugeridos por consulta externa">
                  Fonte: {lookup.source} · situação cadastral: {lookup.situation ?? "—"} · consultado em {new Date(lookup.consultedAt!).toLocaleString("pt-BR")}. Confira antes de salvar.
                </Notice>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-6">
              <Checkbox name="vip" label="Cliente VIP" defaultChecked={Boolean(c.vip)} />
              <Checkbox name="finalConsumer" label="Consumidor final" defaultChecked={c.finalConsumer ?? personType === "PF"} />
            </div>
          </FormSection>

          <FormSection title="Contato">
            <FormGrid cols={3}>
              <Field label="E-mail">
                <Input name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Celular / WhatsApp">
                <Input name="mobile" defaultValue={c.mobile ?? ""} inputMode="tel" />
              </Field>
              <Field label="Telefone">
                <Input name="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
              </Field>
            </FormGrid>
            <div className="mt-4 space-y-2">
              <Checkbox label="Aceita receber promoções" name="acceptsPromotions" checked={promo} onChange={(e) => setPromo(e.target.checked)} />
              {promo && (
                <div className="flex flex-wrap gap-4 pl-6">
                  {[["email", "E-mail"], ["whatsapp", "WhatsApp"], ["sms", "SMS"]].map(([v, l]) => (
                    <Checkbox key={v} name="promoChannels" value={v} label={l} defaultChecked={(c.promoChannels ?? []).includes(v)} />
                  ))}
                </div>
              )}
            </div>
            {personType === "PJ" && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-slate-600">Contatos da empresa</p>
                {contacts.map((ct, i) => (
                  <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                    <Input aria-label="Nome" placeholder="Nome" value={ct.name} onChange={(e) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <Input aria-label="Cargo" placeholder="Cargo" value={ct.role ?? ""} onChange={(e) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                    <Input aria-label="E-mail" placeholder="E-mail" value={ct.email ?? ""} onChange={(e) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                    <Input aria-label="Telefone" placeholder="Telefone" value={ct.phone ?? ""} onChange={(e) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                    <Button type="button" variant="ghost" aria-label="Remover contato" onClick={() => setContacts((a) => a.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => setContacts((a) => [...a, { name: "" }])}>
                  <Plus className="size-4" /> Adicionar contato
                </Button>
              </div>
            )}
          </FormSection>

          <FormSection title="Endereços" actions={<Button type="button" size="sm" variant="ghost" onClick={() => setAddresses((a) => [...a, { type: "entrega" }])}><Plus className="size-4" /> Endereço</Button>}>
            <div className="space-y-5">
              {addresses.map((a, i) => (
                <div key={i} className="rounded-md border border-line p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <Select aria-label="Tipo de endereço" className="w-48" value={a.type ?? "principal"} onChange={(e) => setAddr(i, { type: e.target.value })} options={[{ value: "principal", label: "Principal / fiscal" }, { value: "entrega", label: "Entrega" }, { value: "cobranca", label: "Cobrança" }]} />
                    {addresses.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAddresses((x) => x.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" /> Remover
                      </Button>
                    )}
                  </div>
                  <FormGrid cols={6}>
                    <Field label="CEP"><Input value={a.zip ?? ""} onChange={(e) => setAddr(i, { zip: e.target.value })} inputMode="numeric" /></Field>
                    <Field label="Logradouro" className="sm:col-span-2 lg:col-span-3"><Input value={a.street ?? ""} onChange={(e) => setAddr(i, { street: e.target.value })} /></Field>
                    <Field label="Número"><Input value={a.number ?? ""} onChange={(e) => setAddr(i, { number: e.target.value })} /></Field>
                    <Field label="Complemento"><Input value={a.complement ?? ""} onChange={(e) => setAddr(i, { complement: e.target.value })} /></Field>
                    <Field label="Bairro" className="lg:col-span-2"><Input value={a.district ?? ""} onChange={(e) => setAddr(i, { district: e.target.value })} /></Field>
                    <Field label="Cidade" className="lg:col-span-2"><Input value={a.cityName ?? ""} onChange={(e) => setAddr(i, { cityName: e.target.value })} /></Field>
                    <Field label="UF"><Input maxLength={2} value={a.uf ?? ""} onChange={(e) => setAddr(i, { uf: e.target.value.toUpperCase() })} /></Field>
                    <Field label="Cód. IBGE" hint="Necessário para NF-e."><Input value={a.cityCode ?? ""} onChange={(e) => setAddr(i, { cityCode: e.target.value })} /></Field>
                  </FormGrid>
                </div>
              ))}
            </div>
          </FormSection>

          <FormSection title="Dados fiscais">
            <FormGrid cols={4}>
              <Field label="Inscrição estadual" hint="Use ISENTO quando aplicável.">
                <Input name="ie" defaultValue={c.ie ?? ""} />
              </Field>
              <Field label="Indicador de IE">
                <Select name="ieIndicator" defaultValue={c.ieIndicator ?? ""} placeholder="Automático" options={[{ value: "1", label: "1 — Contribuinte ICMS" }, { value: "2", label: "2 — Contribuinte isento" }, { value: "9", label: "9 — Não contribuinte" }]} />
              </Field>
              <Field label="Inscrição municipal">
                <Input name="im" defaultValue={c.im ?? ""} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Condições comerciais e crédito" description="O limite de crédito é concedido manualmente por usuário autorizado; não há concessão automática.">
            <FormGrid cols={4}>
              <Field label="Limite de crédito (crediário)">
                <MoneyInput name="creditLimit" defaultValue={c.creditLimit ?? 0} />
              </Field>
              <Field label="Prazo padrão (dias)">
                <Input name="paymentTermDays" type="number" min={0} defaultValue={c.paymentTermDays ?? 0} />
              </Field>
              <Field label="Condição de pagamento">
                <Select name="paymentTermId" defaultValue={c.paymentTermId ?? ""} options={terms} placeholder="—" />
              </Field>
              <Field label="Tabela de preço">
                <Select name="priceTableId" defaultValue={c.priceTableId ?? ""} options={priceTables} placeholder="Padrão da filial" />
              </Field>
            </FormGrid>
            <Field label="Observações" className="mt-4">
              <Textarea name="notes" defaultValue={c.notes ?? ""} />
            </Field>
          </FormSection>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <SubmitButton pending={pending} variant="secondary" name="status" value="draft">
              Salvar rascunho
            </SubmitButton>
            <SubmitButton pending={pending} name="status" value={status === "inactive" ? "inactive" : "active"}>
              Salvar cadastro
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
