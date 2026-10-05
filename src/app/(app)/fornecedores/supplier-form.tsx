"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { saveSupplierAction, lookupSupplierCnpjAction } from "./actions";
import type { SupplierAddress, SupplierContact } from "@/domain/suppliers";

type Opt = { value: string; label: string };

export function SupplierForm({ supplier, terms }: { supplier?: Record<string, any> | null; terms: Opt[] }) {
  const c = supplier ?? {};
  const [personType, setPersonType] = useState<"PF" | "PJ">(c.personType ?? "PJ");
  const [addresses, setAddresses] = useState<SupplierAddress[]>(c.addresses?.length ? c.addresses : [{ type: "principal" }]);
  const [contacts, setContacts] = useState<SupplierContact[]>(c.contacts?.length ? c.contacts : [{ name: "" }]);
  const [form, setForm] = useState({ name: c.name ?? "", tradeName: c.tradeName ?? "", email: c.email ?? "", phone: c.phone ?? "", doc: c.doc ?? "" });
  const [lookup, setLookup] = useState<{ source?: string; consultedAt?: string; situation?: string } | null>(null);
  const [pendingLookup, startLookup] = useTransition();
  const toast = useToast();
  const status: string = c.status ?? "active";
  const setAddr = (i: number, patch: Partial<SupplierAddress>) => setAddresses((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const setContact = (i: number, patch: Partial<SupplierContact>) => setContacts((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  return (
    <ActionForm action={saveSupplierAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {c.id && <input type="hidden" name="id" value={c.id} />}
          <input type="hidden" name="addresses" value={JSON.stringify(addresses)} />
          <input type="hidden" name="contacts" value={JSON.stringify(contacts)} />
          <FormSection title="Identificação" description="CPF/CNPJ é único na empresa: a mesma identidade é usada na cotação, no pedido, no recebimento (emitente da NF-e) e no contas a pagar.">
            <FormGrid cols={4}>
              <Field label="Tipo de pessoa" required>
                <Select name="personType" value={personType} onChange={(e) => setPersonType(e.target.value as "PF" | "PJ")} options={[{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }]} />
              </Field>
              <Field label={personType === "PF" ? "CPF" : "CNPJ"} required hint="Obrigatório para cadastro ativo.">
                <div className="flex gap-2">
                  <Input name="doc" value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })} inputMode="numeric" placeholder={personType === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} />
                  {personType === "PJ" && (
                    <Button
                      type="button"
                      variant="secondary"
                      title="Consultar CNPJ em serviço externo (BrasilAPI)"
                      loading={pendingLookup}
                      onClick={() =>
                        startLookup(async () => {
                          const r = await lookupSupplierCnpjAction(form.doc);
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
              <Field label="Código" hint="Gerado automaticamente se vazio.">
                <Input name="code" defaultValue={c.code ?? ""} />
              </Field>
              <Field label="Inscrição estadual">
                <Input name="ie" defaultValue={c.ie ?? ""} />
              </Field>
              <Field label={personType === "PF" ? "Nome completo" : "Razão social"} required className="sm:col-span-2">
                <Input name="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Nome fantasia" className="sm:col-span-2">
                <Input name="tradeName" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
              </Field>
              <Field label="Inscrição municipal">
                <Input name="im" defaultValue={c.im ?? ""} />
              </Field>
              <Field label="E-mail (pedidos)">
                <Input name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Telefone">
                <Input name="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
              </Field>
            </FormGrid>
            {lookup && (
              <div className="mt-4">
                <Notice tone="info" title="Dados sugeridos por consulta externa">
                  Fonte: {lookup.source} · situação cadastral: {lookup.situation ?? "—"} · consultado em {new Date(lookup.consultedAt!).toLocaleString("pt-BR")}. Confira antes de salvar.
                </Notice>
              </div>
            )}
          </FormSection>

          <FormSection title="Condições comerciais" description="Usadas como sugestão no pedido de compra e no planejamento de reposição.">
            <FormGrid cols={4}>
              <Field label="Condição de pagamento">
                <Select name="paymentTermId" defaultValue={c.paymentTermId ?? ""} options={terms} placeholder="—" />
              </Field>
              <Field label="Condição (texto livre)" hint="Ex.: 30/60 dias, boleto.">
                <Input name="paymentTermsText" defaultValue={c.paymentTermsText ?? ""} />
              </Field>
              <Field label="Prazo de entrega (dias)">
                <Input name="leadTimeDays" type="number" min={0} defaultValue={c.leadTimeDays ?? ""} />
              </Field>
              <Field label="Pedido mínimo">
                <MoneyInput name="minOrderValue" defaultValue={c.minOrderValue ?? 0} />
              </Field>
              <Field label="Política de frete" className="sm:col-span-2" hint="Ex.: CIF acima de R$ 1.000; FOB abaixo.">
                <Input name="freightPolicy" defaultValue={c.freightPolicy ?? ""} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Contatos" actions={<Button type="button" size="sm" variant="ghost" onClick={() => setContacts((a) => [...a, { name: "" }])}><Plus className="size-4" /> Contato</Button>}>
            <div className="space-y-2">
              {contacts.map((ct, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                  <Input aria-label="Nome do contato" placeholder="Nome" value={ct.name} onChange={(e) => setContact(i, { name: e.target.value })} />
                  <Input aria-label="Cargo / área" placeholder="Cargo / área" value={ct.role ?? ""} onChange={(e) => setContact(i, { role: e.target.value })} />
                  <Input aria-label="E-mail do contato" placeholder="E-mail" value={ct.email ?? ""} onChange={(e) => setContact(i, { email: e.target.value })} />
                  <Input aria-label="Telefone do contato" placeholder="Telefone" value={ct.phone ?? ""} onChange={(e) => setContact(i, { phone: e.target.value })} />
                  <Button type="button" variant="ghost" aria-label="Remover contato" onClick={() => setContacts((a) => a.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {contacts.length === 0 && <p className="text-sm text-slate-500">Nenhum contato.</p>}
            </div>
          </FormSection>

          <FormSection title="Endereços" actions={<Button type="button" size="sm" variant="ghost" onClick={() => setAddresses((a) => [...a, { type: "coleta" }])}><Plus className="size-4" /> Endereço</Button>}>
            <div className="space-y-5">
              {addresses.map((a, i) => (
                <div key={i} className="rounded-md border border-line p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <Select aria-label="Tipo de endereço" className="w-52" value={a.type ?? "principal"} onChange={(e) => setAddr(i, { type: e.target.value })} options={[{ value: "principal", label: "Principal / fiscal" }, { value: "comercial", label: "Comercial" }, { value: "coleta", label: "Coleta / expedição" }, { value: "cobranca", label: "Cobrança" }]} />
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
                    <Field label="Cód. IBGE"><Input value={a.cityCode ?? ""} onChange={(e) => setAddr(i, { cityCode: e.target.value })} /></Field>
                  </FormGrid>
                </div>
              ))}
            </div>
          </FormSection>

          <FormSection title="Observações">
            <Textarea name="notes" aria-label="Observações" defaultValue={c.notes ?? ""} />
          </FormSection>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <SubmitButton pending={pending} variant="secondary" name="status" value="draft">
              Salvar rascunho
            </SubmitButton>
            <SubmitButton pending={pending} name="status" value={status === "inactive" ? "inactive" : "active"}>
              Salvar fornecedor
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
