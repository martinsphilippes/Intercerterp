"use client";

import { useState, useTransition } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTimeSeconds } from "@/lib/dates";
import { CLIENT_STATUS, SERVICE_CATALOG } from "@/domain/accounting/common";
import { saveClientAction, lookupClientCnpjAction } from "../actions";

type Opt = { value: string; label: string };
type Regime = Opt & { crt: string };
type Address = { zip: string; street: string; number: string; complement: string; district: string; cityName: string; cityCode: string; uf: string };
type System = { name: string; kind: string };
type Lookup = {
  source: string;
  consultedAt: string;
  rfbStatus: string | null;
  cnaeDescription: string | null;
  simples: boolean | null;
  mei: boolean | null;
  partners: Array<{ name: string; qualification: string | null }>;
  /** o que vai gravado no cadastro (fonte, data e CNPJ consultado) */
  lookup: Record<string, any>;
};

const COMM_CHANNELS: Opt[] = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Telefone" },
];

const emptyAddress = (a?: Record<string, any> | null): Address => ({
  zip: a?.zip ?? "",
  street: a?.street ?? "",
  number: a?.number ?? "",
  complement: a?.complement ?? "",
  district: a?.district ?? "",
  cityName: a?.cityName ?? "",
  cityCode: a?.cityCode ?? "",
  uf: a?.uf ?? "",
});

/** Sugestão de regime a partir da consulta pública — só texto; o contador decide. */
function suggestedRegime(l: Lookup, regimes: Regime[]): string | null {
  const key = l.mei ? "mei" : l.simples ? "simples" : null;
  return key ? (regimes.find((r) => r.value === key)?.label ?? key) : null;
}

/**
 * Cadastro do cliente contábil (novo e edição). Os campos com nome batem com o que `saveClientAction` lê.
 * Regime e situação só são definidos na CRIAÇÃO: depois mudam pelo histórico de regime e pelas transições de situação
 * da página do cliente (a edição do cadastro não os altera).
 * `canLookup`: a consulta de CNPJ exige a permissão de criar clientes — sem ela o botão não aparece (nada de botão que só dá erro).
 * `defaultOnboardedAt`: data de hoje calculada no servidor (evita diferença entre servidor e navegador na hidratação).
 */
export function ClientForm({ client, groups, users, regimes, crts, ufs, canLookup = true, defaultOnboardedAt = "" }: { client?: Record<string, any> | null; groups: Opt[]; users: Opt[]; regimes: Regime[]; crts: Opt[]; ufs: string[]; canLookup?: boolean; defaultOnboardedAt?: string }) {
  const c = client ?? {};
  const editing = Boolean(c.id);
  const linked = c.linkStatus === "active";
  const toast = useToast();
  const [personType, setPersonType] = useState<"PF" | "PJ">(c.personType ?? "PJ");
  const [form, setForm] = useState({
    doc: c.doc ?? "",
    name: c.name ?? "",
    tradeName: c.tradeName ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    cnae: c.cnae ?? "",
    cnaes: (c.cnaes ?? []).join(", "),
    legalNature: c.legalNature ?? "",
    size: c.size ?? "",
    openedAt: c.openedAt ?? "",
    rfbStatus: c.rfbStatus ?? "",
  });
  const [address, setAddress] = useState<Address>(emptyAddress(c.address));
  const [regime, setRegime] = useState<string>(c.regime ?? "");
  const [crt, setCrt] = useState<string>(c.crt ?? "");
  const [systems, setSystems] = useState<System[]>((c.systems ?? []).map((s: any) => ({ name: s?.name ?? "", kind: s?.kind ?? "" })));
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [pendingLookup, startLookup] = useTransition();

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setAddr = (patch: Partial<Address>) => setAddress((a) => ({ ...a, ...patch }));
  const setSystem = (i: number, patch: Partial<System>) => setSystems((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const consultCnpj = () =>
    startLookup(async () => {
      const r = await lookupClientCnpjAction(form.doc);
      if (!r.ok) return toast("error", r.error);
      const d = r.data as any;
      set({
        name: d.name ?? form.name,
        tradeName: d.tradeName ?? form.tradeName,
        email: d.email ?? form.email,
        phone: d.phone ?? form.phone,
        cnae: d.cnae ?? form.cnae,
        cnaes: Array.isArray(d.cnaes) && d.cnaes.length ? d.cnaes.join(", ") : form.cnaes,
        legalNature: d.legalNature ?? form.legalNature,
        size: d.size ?? form.size,
        openedAt: d.openedAt ?? form.openedAt,
        rfbStatus: d.rfbStatus ?? form.rfbStatus,
      });
      if (d.address) {
        const a = d.address as Record<string, any>;
        const picked = Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === "string" && v.trim() !== "")) as Partial<Address>;
        setAddr(picked);
      }
      setLookup({ source: d.source, consultedAt: d.consultedAt, rfbStatus: d.rfbStatus ?? null, cnaeDescription: d.cnaeDescription ?? null, simples: d.simples ?? null, mei: d.mei ?? null, partners: Array.isArray(d.partners) ? d.partners : [], lookup: d.lookup ?? { source: d.source, consultedAt: d.consultedAt } });
      toast("info", "Dados preenchidos a partir da consulta. Confira antes de salvar.");
    });

  const regimeLabel = c.regime ? (regimes.find((r) => r.value === c.regime)?.label ?? c.regime) : "Não informado";
  const crtLabel = c.crt ? (crts.find((x) => x.value === c.crt)?.label ?? c.crt) : null;
  const suggestion = lookup ? suggestedRegime(lookup, regimes) : null;
  const sections = [
    ["dados", "Identificação"],
    ["contato", "Contato e comunicação"],
    ["endereco", "Endereço"],
    ["fiscal", "Dados fiscais e regime"],
    ["servicos", "Serviços e atendimento"],
    ["operacao", "Volume e sistemas"],
    ["obs", "Observações"],
  ];

  return (
    <ActionForm action={saveClientAction} className="grid gap-5 lg:grid-cols-[200px_1fr]">
      {({ pending, error }) => (
        <>
          <nav aria-label="Seções do cadastro" className="no-print hidden lg:block">
            <ol className="sticky top-20 space-y-1 text-sm">
              {sections.map(([id, label], i) => (
                <li key={id}>
                  <a href={`#${id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-slate-600 hover:bg-white hover:text-brand-700">
                    <span className="flex size-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold">{i + 1}</span>
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="min-w-0 space-y-5">
            {editing && <input type="hidden" name="id" value={c.id} />}
            <input type="hidden" name="systems" value={JSON.stringify(systems.filter((s) => s.name.trim()))} />
            <input type="hidden" name="docLookup" value={lookup ? JSON.stringify(lookup.lookup) : ""} />
            <input type="hidden" name="rfbStatus" value={form.rfbStatus} />

            <FormSection id="dados" title="Identificação" description="CPF/CNPJ é único na carteira do escritório — evita cadastros duplicados.">
              <FormGrid cols={4}>
                <Field label="Tipo de pessoa" required>
                  <Select name="personType" value={personType} onChange={(e) => setPersonType(e.target.value as "PF" | "PJ")} options={[{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }]} />
                </Field>
                <Field
                  label={personType === "PF" ? "CPF" : "CNPJ"}
                  hint={linked ? "Cliente vinculado a uma empresa do ERP: o CNPJ não pode ser alterado enquanto o vínculo estiver ativo." : personType === "PJ" && !canLookup ? "A consulta pública do CNPJ exige a permissão de cadastrar clientes." : undefined}
                  className={personType === "PJ" ? "sm:col-span-2" : undefined}
                >
                  <div className="flex gap-2">
                    <Input name="doc" value={form.doc} onChange={(e) => set({ doc: e.target.value })} inputMode="numeric" readOnly={linked} placeholder={personType === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} />
                    {personType === "PJ" && canLookup && (
                      <Button type="button" variant="secondary" title="Consultar dados públicos da Receita Federal (serviço externo) e preencher o cadastro" loading={pendingLookup} onClick={consultCnpj}>
                        <Search className="size-4" /> Consultar CNPJ
                      </Button>
                    )}
                  </div>
                </Field>
                {editing && (
                  <Field label="Código">
                    <p className="pt-2 font-mono text-sm text-slate-700">{c.code}</p>
                  </Field>
                )}
                <Field label={personType === "PF" ? "Nome completo" : "Razão social"} required className="sm:col-span-2">
                  <Input name="name" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
                </Field>
                {personType === "PJ" && (
                  <Field label="Nome fantasia" className="sm:col-span-2">
                    <Input name="tradeName" value={form.tradeName} onChange={(e) => set({ tradeName: e.target.value })} />
                  </Field>
                )}
              </FormGrid>
              {lookup && (
                <div className="mt-4 space-y-3">
                  <Notice tone="info" title="Dados preenchidos pela consulta pública do CNPJ">
                    Fonte: {lookup.source} · consultado em {formatDateTimeSeconds(lookup.consultedAt)}
                    {lookup.rfbStatus && <> · situação na Receita: <b>{lookup.rfbStatus}</b></>}
                    {lookup.cnaeDescription && <> · atividade principal: {lookup.cnaeDescription}</>}. Confira antes de salvar — a fonte e a data ficam registradas no cadastro.
                  </Notice>
                  {suggestion && (
                    <Notice tone="warn" title="Sugestão de regime">
                      A consulta indica opção pelo <b>{suggestion}</b>. {editing ? "Se for o caso, registre a mudança pela aba Regime do cliente — o cadastro não altera o regime vigente." : "Se for o caso, selecione o regime em “Dados fiscais e regime”: o cadastro não escolhe por você."}
                    </Notice>
                  )}
                  {lookup.partners.length > 0 && (
                    <Notice tone="info" title={`${lookup.partners.length} sócio${lookup.partners.length === 1 ? "" : "s"} encontrado${lookup.partners.length === 1 ? "" : "s"} — cadastre na aba Pessoas depois de salvar`}>
                      {lookup.partners.map((p) => `${p.name}${p.qualification ? ` (${p.qualification})` : ""}`).join(" · ")}
                    </Notice>
                  )}
                </div>
              )}
              {!editing ? (
                <FormGrid cols={4} className="mt-4">
                  <Field label="Situação inicial" required hint="Depois, a situação muda pelas ações da página do cliente.">
                    <Select name="status" defaultValue="onboarding" options={CLIENT_STATUS.filter((s) => s.value === "onboarding" || s.value === "active").map((s) => ({ value: s.value, label: s.label }))} />
                  </Field>
                  <Field label="Entrada no escritório" hint="Data em que o cliente passou a ser atendido.">
                    <Input type="date" name="onboardedAt" defaultValue={defaultOnboardedAt} />
                  </Field>
                  <Field label="Início dos serviços">
                    <Input type="date" name="serviceStartAt" defaultValue="" />
                  </Field>
                </FormGrid>
              ) : (
                <FormGrid cols={4} className="mt-4">
                  <Field label="Situação" hint="Muda pelas ações da página do cliente (ativar, encerrar…).">
                    <div className="pt-1.5"><StatusBadge kind="accounting_client" status={c.status} /></div>
                  </Field>
                  <Field label="Entrada no escritório" hint="Registrada no cadastro; não é alterada pela edição.">
                    <p className="pt-2 text-sm text-slate-700">{formatDate(c.onboardedAt)}</p>
                  </Field>
                  <Field label="Início dos serviços">
                    <Input type="date" name="serviceStartAt" defaultValue={c.serviceStartAt ?? ""} />
                  </Field>
                </FormGrid>
              )}
            </FormSection>

            <FormSection id="contato" title="Contato e comunicação" description="Como o escritório fala com o cliente no dia a dia.">
              <FormGrid cols={4}>
                <Field label="E-mail" className="sm:col-span-2">
                  <Input name="email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                </Field>
                <Field label="Telefone / WhatsApp">
                  <Input name="phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" />
                </Field>
                <Field label="Canal preferido">
                  <Select name="commChannel" defaultValue={c.commPrefs?.channel ?? ""} placeholder="—" options={COMM_CHANNELS} />
                </Field>
                <Field label="Combinados de comunicação" className="sm:col-span-2 lg:col-span-4" hint="Ex.: horários, quem recebe os avisos, o que não enviar por WhatsApp.">
                  <Textarea name="commNotes" rows={2} defaultValue={c.commPrefs?.notes ?? ""} />
                </Field>
              </FormGrid>
            </FormSection>

            <FormSection id="endereco" title="Endereço">
              <FormGrid cols={6}>
                <Field label="CEP"><Input name="zip" value={address.zip} onChange={(e) => setAddr({ zip: e.target.value })} inputMode="numeric" maxLength={9} /></Field>
                <Field label="Logradouro" className="sm:col-span-2 lg:col-span-3"><Input name="street" value={address.street} onChange={(e) => setAddr({ street: e.target.value })} /></Field>
                <Field label="Número"><Input name="number" value={address.number} onChange={(e) => setAddr({ number: e.target.value })} /></Field>
                <Field label="Complemento"><Input name="complement" value={address.complement} onChange={(e) => setAddr({ complement: e.target.value })} /></Field>
                <Field label="Bairro" className="lg:col-span-2"><Input name="district" value={address.district} onChange={(e) => setAddr({ district: e.target.value })} /></Field>
                <Field label="Município" className="lg:col-span-2"><Input name="cityName" value={address.cityName} onChange={(e) => setAddr({ cityName: e.target.value })} /></Field>
                <Field label="UF"><Select name="uf" value={address.uf} onChange={(e) => setAddr({ uf: e.target.value })} placeholder="—" options={ufs.map((u) => ({ value: u, label: u }))} /></Field>
                <Field label="Município (IBGE)" hint="7 dígitos."><Input name="cityCode" value={address.cityCode} onChange={(e) => setAddr({ cityCode: e.target.value })} inputMode="numeric" maxLength={7} /></Field>
              </FormGrid>
            </FormSection>

            <FormSection id="fiscal" title="Dados fiscais e regime" description={editing ? "O regime vigente tem histórico próprio: mudanças são registradas com data de início pela aba Regime do cliente." : "O regime informado aqui abre o histórico de regime do cliente a partir da data de entrada."}>
              <FormGrid cols={4}>
                {!editing ? (
                  <>
                    <Field label="Regime tributário">
                      <Select
                        name="regime"
                        value={regime}
                        onChange={(e) => {
                          setRegime(e.target.value);
                          setCrt(regimes.find((r) => r.value === e.target.value)?.crt ?? "");
                        }}
                        placeholder="Não informado"
                        options={regimes}
                      />
                    </Field>
                    <Field label="CRT" hint="Preenchido conforme o regime; ajuste se necessário.">
                      <Select name="crt" value={crt} onChange={(e) => setCrt(e.target.value)} placeholder="—" options={crts} disabled={!regime} />
                    </Field>
                  </>
                ) : (
                  <Field label="Regime tributário vigente" className="sm:col-span-2">
                    <p className="pt-2 text-sm text-slate-700">
                      {regimeLabel}
                      {crtLabel && <span className="text-xs text-slate-500"> · CRT {crtLabel}</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      Para mudar, <Link className="text-brand-700 underline" href={`/contabil/clientes/${c.id}?tab=regime`}>registre a nova vigência na aba Regime</Link> — o histórico anterior é preservado.
                    </p>
                  </Field>
                )}
                {personType === "PJ" && (
                  <>
                    <Field label="Inscrição estadual" hint="Use ISENTO quando aplicável.">
                      <Input name="ie" defaultValue={c.ie ?? ""} />
                    </Field>
                    <Field label="Inscrição municipal">
                      <Input name="im" defaultValue={c.im ?? ""} />
                    </Field>
                    <Field label="CNAE principal" hint="7 dígitos.">
                      <Input name="cnae" value={form.cnae} onChange={(e) => set({ cnae: e.target.value })} inputMode="numeric" />
                    </Field>
                    <Field label="CNAEs secundários" hint="Separados por vírgula." className="sm:col-span-2 lg:col-span-3">
                      <Input name="cnaes" value={form.cnaes} onChange={(e) => set({ cnaes: e.target.value })} />
                    </Field>
                    <Field label="Natureza jurídica" className="sm:col-span-2">
                      <Input name="legalNature" value={form.legalNature} onChange={(e) => set({ legalNature: e.target.value })} />
                    </Field>
                    <Field label="Porte">
                      <Input name="size" value={form.size} onChange={(e) => set({ size: e.target.value })} placeholder="ME, EPP, Demais" />
                    </Field>
                    <Field label="Abertura (Receita)">
                      <Input type="date" name="openedAt" value={form.openedAt} onChange={(e) => set({ openedAt: e.target.value })} />
                    </Field>
                    <Field label="Situação na Receita" hint="Vem da consulta do CNPJ.">
                      <p className="pt-2 text-sm text-slate-700">{form.rfbStatus || "—"}</p>
                    </Field>
                  </>
                )}
              </FormGrid>
            </FormSection>

            <FormSection id="servicos" title="Serviços e atendimento" description="Serviços contratados, responsável geral e grupo de clientes.">
              <p className="mb-2 text-xs font-medium text-slate-600">Serviços contratados</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {SERVICE_CATALOG.map((sv) => (
                  <Checkbox key={sv.key} name="services" value={sv.key} label={sv.label} defaultChecked={(c.services ?? []).includes(sv.key)} />
                ))}
              </div>
              <FormGrid cols={4} className="mt-4">
                <Field label="Responsável geral" hint="Responsáveis por departamento ficam na aba Responsáveis da página do cliente." className="sm:col-span-2">
                  <Select name="responsibleUserId" defaultValue={c.responsibleUserId ?? ""} placeholder="—" options={users} />
                </Field>
                <Field label="Grupo de clientes" className="sm:col-span-2">
                  <Select name="groupId" defaultValue={c.groupId ?? ""} placeholder="—" options={groups} />
                </Field>
                <Field label="Etiquetas" hint="Separadas por vírgula. Aparecem na busca." className="sm:col-span-2 lg:col-span-4">
                  <Input name="tags" defaultValue={(c.tags ?? []).join(", ")} />
                </Field>
              </FormGrid>
            </FormSection>

            <FormSection id="operacao" title="Volume e sistemas" description="Usado para dimensionar o trabalho e planejar integrações.">
              <FormGrid cols={3}>
                <Field label="Funcionários">
                  <Input type="number" name="employeesCount" min={0} step={1} defaultValue={c.employeesCount ?? ""} />
                </Field>
                <Field label="Documentos por mês">
                  <Input type="number" name="monthlyDocs" min={0} step={1} defaultValue={c.monthlyDocs ?? ""} />
                </Field>
                <Field label="Lançamentos por mês">
                  <Input type="number" name="monthlyEntries" min={0} step={1} defaultValue={c.monthlyEntries ?? ""} />
                </Field>
              </FormGrid>
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-slate-600">Sistemas usados pelo cliente</p>
                {systems.length === 0 && <p className="mb-2 text-xs text-slate-500">Nenhum sistema informado.</p>}
                {systems.map((sys, i) => (
                  <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                    <Input aria-label="Nome do sistema" placeholder="Nome (ex.: Intercert ERP, planilhas)" value={sys.name} onChange={(e) => setSystem(i, { name: e.target.value })} />
                    <Input aria-label="Tipo do sistema" placeholder="Tipo (ex.: ERP, folha, financeiro)" value={sys.kind} onChange={(e) => setSystem(i, { kind: e.target.value })} />
                    <Button type="button" variant="ghost" aria-label="Remover sistema" onClick={() => setSystems((all) => all.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => setSystems((all) => [...all, { name: "", kind: "" }])}>
                  <Plus className="size-4" /> Adicionar sistema
                </Button>
              </div>
            </FormSection>

            <FormSection id="obs" title="Observações">
              <Textarea name="notes" defaultValue={c.notes ?? ""} placeholder="Particularidades do cliente, pendências de implantação, combinados." />
            </FormSection>

            {error && <Notice tone="bad">{error}</Notice>}
            <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
              <Link href={editing ? `/contabil/clientes/${c.id}` : "/contabil/clientes"} className="inline-flex h-9 items-center rounded-md px-4 text-sm text-slate-600 hover:bg-slate-100">
                Cancelar
              </Link>
              <SubmitButton pending={pending}>{editing ? "Salvar alterações" : "Cadastrar cliente"}</SubmitButton>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}
