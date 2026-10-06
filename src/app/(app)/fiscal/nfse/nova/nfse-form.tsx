"use client";

import { useMemo, useState } from "react";
import Link from "@/components/ui/link";
import { Save, Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, FormSection, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { calcNfse } from "@/domain/fiscal/calc";
import { saveNfseAction } from "../../actions";

type Opt = { value: string; label: string };
export type Tomador = { id: string; name: string; doc: string; im: string; email: string; address: Record<string, string | undefined> };
export type ServiceProduct = { id: string; name: string; serviceListItem: string; municipalCode: string; issRateBps: number; price: number; description: string };

const pctText = (bps: number | null | undefined) => (bps ? (bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "");
const toBps = (v: string) => {
  const n = Number(String(v).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function NfseForm({
  doc,
  tomadores,
  services,
  lc116,
  categories,
  prestador,
  branchCity,
  standard,
  today,
}: {
  doc: Record<string, any> | null;
  tomadores: Tomador[];
  services: ServiceProduct[];
  lc116: Opt[];
  categories: Opt[];
  prestador: string;
  branchCity: { code: string; name: string; uf: string };
  standard: string;
  today: string;
}) {
  const svc = doc?.service ?? {};
  const rec = doc?.recipient ?? {};
  const [customerId, setCustomerId] = useState<string>(doc?.partyId ?? "");
  const [tom, setTom] = useState({ name: rec.name ?? "", doc: rec.doc ?? "", im: rec.im ?? "", email: rec.email ?? "", ...(rec.address ?? {}) } as Record<string, string>);
  const [simples, setSimples] = useState<string>(rec.simplesOptant == null ? "" : rec.simplesOptant ? "1" : "0");
  const [serviceId, setServiceId] = useState<string>(svc.productId ?? "");
  const [item, setItem] = useState<string>(svc.serviceListItem ?? "");
  const [muni, setMuni] = useState<string>(svc.municipalCode ?? "");
  const [desc, setDesc] = useState<string>(svc.description ?? "");
  const [placeMode, setPlaceMode] = useState<string>(!svc.serviceCityCode || svc.serviceCityCode === branchCity.code ? "prestador" : svc.serviceCityCode === rec.address?.cityCode ? "tomador" : "outro");
  const [placeCode, setPlaceCode] = useState<string>(svc.serviceCityCode ?? branchCity.code);
  const [amount, setAmount] = useState<number>(svc.amount ?? 0);
  const [disc, setDisc] = useState<number>(svc.unconditionalDiscount ?? 0);
  const [ded, setDed] = useState<number>(svc.deductions ?? 0);
  const [issRate, setIssRate] = useState<string>(pctText(svc.issRateBps));
  const [issWithheld, setIssWithheld] = useState<boolean>(Boolean(svc.issWithheld));
  const r0 = svc.rates ?? {};
  const w0 = svc.withhold ?? {};
  const [rates, setRates] = useState({ inss: pctText(r0.inssBps), ir: pctText(r0.irBps), csll: pctText(r0.csllBps), pis: pctText(r0.pisBps), cofins: pctText(r0.cofinsBps) });
  const [withhold, setWithhold] = useState({ inss: Boolean(w0.inss), ir: Boolean(w0.ir), csll: Boolean(w0.csll), pis: Boolean(w0.pis), cofins: Boolean(w0.cofins) });
  const [receivable, setReceivable] = useState<boolean>(Boolean(doc?.effects?.financial));
  const calc = useMemo(() => {
    try {
      return calcNfse({ amount, unconditionalDiscount: disc, deductions: ded, issRateBps: toBps(issRate), issWithheld, inssBps: toBps(rates.inss), irBps: toBps(rates.ir), csllBps: toBps(rates.csll), pisBps: toBps(rates.pis), cofinsBps: toBps(rates.cofins), withhold });
    } catch (e: any) {
      return { error: e.message as string };
    }
  }, [amount, disc, ded, issRate, issWithheld, rates, withhold]);
  const placeCodeFinal = placeMode === "prestador" ? branchCity.code : placeMode === "tomador" ? (tom.cityCode ?? "") : placeCode;
  const muniOptions = useMemo(() => [...new Set(services.map((s) => s.municipalCode).filter(Boolean))], [services]);
  const itemOptions = useMemo(() => {
    const extra = item && !lc116.some((o) => o.value === item) ? [{ value: item, label: `${item} — (informado)` }] : [];
    return [...extra, ...lc116];
  }, [item, lc116]);
  return (
    <ActionForm action={saveNfseAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {doc?.id && <input type="hidden" name="id" value={doc.id} />}
          <p className="text-sm text-slate-600">Prestador: <b>{prestador}</b> · padrão {standard === "nacional" ? "NFS-e nacional (DPS)" : "municipal via provedor"}</p>
          <FormSection title="Tomador do serviço" description="Selecione o cliente: CPF/CNPJ, inscrição municipal, e-mail e endereço são preenchidos do cadastro.">
            <FormGrid cols={3}>
              <Field label="Cliente" required className="sm:col-span-2">
                <Select
                  name="customerId"
                  value={customerId}
                  placeholder="Tomador sem cadastro (preencher abaixo)"
                  options={tomadores.map((t) => ({ value: t.id, label: `${t.name}${t.doc ? ` — ${t.doc}` : ""}` }))}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    const t = tomadores.find((x) => x.id === e.target.value);
                    if (t) setTom({ name: t.name, doc: t.doc, im: t.im, email: t.email, ...(t.address as Record<string, string>) });
                  }}
                />
              </Field>
              <Field label="Optante do Simples Nacional">
                <Select name="simplesOptant" value={simples} onChange={(e) => setSimples(e.target.value)} placeholder="Não informado" options={[{ value: "1", label: "Sim" }, { value: "0", label: "Não" }]} />
              </Field>
            </FormGrid>
            <div className={customerId ? "mt-4 rounded-md bg-slate-50 p-3" : "mt-4"}>
              <FormGrid cols={4}>
                <Field label="Nome / razão social" required className="sm:col-span-2"><Input name="name" value={tom.name ?? ""} readOnly={Boolean(customerId)} onChange={(e) => setTom({ ...tom, name: e.target.value })} required /></Field>
                <Field label="CPF/CNPJ"><Input name="doc" value={tom.doc ?? ""} readOnly={Boolean(customerId)} onChange={(e) => setTom({ ...tom, doc: e.target.value })} /></Field>
                <Field label="Inscrição municipal"><Input name="im" value={tom.im ?? ""} onChange={(e) => setTom({ ...tom, im: e.target.value })} /></Field>
                <Field label="E-mail" className="sm:col-span-2"><Input name="email" type="email" value={tom.email ?? ""} onChange={(e) => setTom({ ...tom, email: e.target.value })} /></Field>
                <Field label="Município do tomador"><Input name="cityName" value={tom.cityName ?? ""} onChange={(e) => setTom({ ...tom, cityName: e.target.value })} /></Field>
                <Field label="UF / IBGE">
                  <div className="flex gap-2">
                    <Input name="uf" className="w-16" maxLength={2} value={tom.uf ?? ""} onChange={(e) => setTom({ ...tom, uf: e.target.value.toUpperCase() })} />
                    <Input name="cityCode" value={tom.cityCode ?? ""} onChange={(e) => setTom({ ...tom, cityCode: e.target.value })} placeholder="IBGE" />
                  </div>
                </Field>
                <Field label="Logradouro" className="sm:col-span-2"><Input name="street" value={tom.street ?? ""} onChange={(e) => setTom({ ...tom, street: e.target.value })} /></Field>
                <Field label="Número"><Input name="number" value={tom.number ?? ""} onChange={(e) => setTom({ ...tom, number: e.target.value })} /></Field>
                <Field label="Bairro / CEP">
                  <div className="flex gap-2">
                    <Input name="district" value={tom.district ?? ""} onChange={(e) => setTom({ ...tom, district: e.target.value })} />
                    <Input name="zip" className="w-28" value={tom.zip ?? ""} onChange={(e) => setTom({ ...tom, zip: e.target.value })} placeholder="CEP" />
                  </div>
                </Field>
              </FormGrid>
            </div>
          </FormSection>

          <FormSection title="Serviço prestado" description="Serviços cadastrados (produtos do tipo serviço) preenchem item da lista, código municipal e alíquota." actions={<Link className="text-xs text-brand-700 underline" href="/produtos?tipo=service">Cadastro de serviços</Link>}>
            <FormGrid cols={3}>
              <Field label="Serviço cadastrado">
                <Select
                  name="serviceProductId"
                  value={serviceId}
                  placeholder="—"
                  options={services.map((s) => ({ value: s.id, label: s.name }))}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    const s = services.find((x) => x.id === e.target.value);
                    if (s) {
                      setItem(s.serviceListItem);
                      setMuni(s.municipalCode);
                      setIssRate(pctText(s.issRateBps));
                      if (!desc) setDesc(s.description);
                      if (!amount) setAmount(s.price);
                    }
                  }}
                />
              </Field>
              <Field label="Data de competência" required><Input type="date" name="competence" defaultValue={svc.competence ?? today} required /></Field>
              <Field label="Item da lista de serviços (LC 116)" required>
                <Select name="serviceListItem" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Selecione" options={itemOptions} required />
              </Field>
              <Field label="Código de tributação municipal" hint="Conforme a lista do município.">
                <Input name="municipalCode" list="muni-codes" value={muni} onChange={(e) => setMuni(e.target.value)} />
                <datalist id="muni-codes">{muniOptions.map((m) => <option key={m} value={m} />)}</datalist>
              </Field>
              <Field label="Local da prestação">
                <Select value={placeMode} onChange={(e) => setPlaceMode(e.target.value)} options={[{ value: "prestador", label: `${branchCity.name}/${branchCity.uf} (prestador)` }, { value: "tomador", label: `Município do tomador${tom.cityName ? ` (${tom.cityName})` : ""}` }, { value: "outro", label: "Outro município (IBGE)" }]} />
                {placeMode === "outro" && <Input className="mt-2" value={placeCode} onChange={(e) => setPlaceCode(e.target.value)} placeholder="Código IBGE" />}
                <input type="hidden" name="serviceCityCode" value={placeCodeFinal} />
              </Field>
              <Field label="Exigibilidade do ISS">
                <Select name="issExigibility" defaultValue={svc.issExigibility ?? "1"} options={[{ value: "1", label: "1 — Exigível" }, { value: "2", label: "2 — Não incidência" }, { value: "3", label: "3 — Isenção" }, { value: "4", label: "4 — Exportação" }, { value: "5", label: "5 — Imunidade" }, { value: "6", label: "6 — Suspensa (decisão judicial)" }, { value: "7", label: "7 — Suspensa (processo administrativo)" }]} />
              </Field>
              {standard === "nacional" && <Field label="Código de tributação nacional" hint="6 dígitos (padrão nacional)."><Input name="nationalCode" defaultValue={svc.nationalCode ?? ""} maxLength={6} /></Field>}
              <Field label="CNAE do serviço (opcional)"><Input name="cnae" defaultValue={svc.cnae ?? ""} /></Field>
            </FormGrid>
            <Field label="Discriminação do serviço" required className="mt-4">
              <Textarea name="description" rows={4} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} required />
            </Field>
          </FormSection>

          <FormSection title="Valores e retenções" description="Base = serviços − desconto incondicionado − deduções. ISS calculado = base × alíquota; só é descontado do líquido quando retido pelo tomador.">
            <FormGrid cols={4}>
              <Field label="Valor dos serviços" required><MoneyInput name="amount" value={amount} onChange={setAmount} /></Field>
              <Field label="Desconto incondicionado"><MoneyInput name="unconditionalDiscount" value={disc} onChange={setDisc} /></Field>
              <Field label="Deduções (base do ISS)"><MoneyInput name="deductions" value={ded} onChange={setDed} /></Field>
              <Field label="Alíquota ISS (%)" required><Input name="issRate" inputMode="decimal" value={issRate} onChange={(e) => setIssRate(e.target.value)} placeholder="ex.: 5" /></Field>
            </FormGrid>
            <div className="mt-3"><Checkbox name="issWithheld" label="ISS retido pelo tomador (exige tomador pessoa jurídica)" checked={issWithheld} onChange={(e) => setIssWithheld(e.target.checked)} /></div>
            <p className="mb-2 mt-5 text-xs font-semibold text-slate-600">Retenções federais (alíquota sobre serviços − desconto incondicionado)</p>
            <div className="grid gap-3 sm:grid-cols-5">
              {(["inss", "ir", "csll", "pis", "cofins"] as const).map((k) => {
                const v = "error" in calc ? 0 : (calc as any)[k];
                return (
                  <div key={k} className="rounded-md border border-line p-3">
                    <p className="text-xs font-semibold">{k.toUpperCase()}</p>
                    <Input aria-label={`Alíquota ${k}`} name={`${k}Rate`} inputMode="decimal" className="mt-1" value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} placeholder="% (ex.: 1,5)" />
                    <Checkbox className="mt-2" name={`w${k[0].toUpperCase()}${k.slice(1)}`} label="Retido" checked={withhold[k]} onChange={(e) => setWithhold({ ...withhold, [k]: e.target.checked })} />
                    <p className="tabular mt-1 text-sm">{money(v)}</p>
                  </div>
                );
              })}
            </div>
            {"error" in calc ? (
              <div className="mt-4"><Notice tone="bad">{calc.error}</Notice></div>
            ) : (
              <div className="mt-4 grid gap-3 rounded-md bg-slate-50 p-4 sm:grid-cols-4">
                <div><p className="text-xs text-slate-500">Base de cálculo</p><p className="tabular font-semibold">{money(calc.base)}</p></div>
                <div><p className="text-xs text-slate-500">ISS calculado</p><p className="tabular font-semibold">{money(calc.iss)}</p><p className="text-xs text-slate-500">{issWithheld ? "retido pelo tomador" : "devido pelo prestador (não retido)"}</p></div>
                <div><p className="text-xs text-slate-500">Retenções (ISS retido + federais)</p><p className="tabular font-semibold">{money(calc.withheld)}</p></div>
                <div><p className="text-xs text-slate-500">Valor líquido</p><p className="tabular text-lg font-semibold text-brand-800">{money(calc.net)}</p></div>
              </div>
            )}
          </FormSection>

          <FormSection title="Cobrança" description="O título é criado uma única vez, quando a NFS-e for autorizada, pelo valor líquido; cancelar a nota cancela o título (se não houver baixa).">
            <Checkbox name="createReceivable" label="Gerar conta a receber do valor líquido" checked={receivable} onChange={(e) => setReceivable(e.target.checked)} />
            {receivable && (
              <FormGrid cols={3} className="mt-3">
                <Field label="Vencimento" required><Input type="date" name="dueDate" defaultValue={doc?.effects?.dueDate ?? today} required /></Field>
                <Field label="Categoria financeira"><Select name="categoryId" defaultValue={doc?.effects?.categoryId ?? ""} placeholder="Padrão (receita)" options={categories} /></Field>
                {!customerId && <Notice tone="warn">Selecione o tomador entre os clientes cadastrados para gerar o título.</Notice>}
              </FormGrid>
            )}
          </FormSection>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <Link href={doc?.id ? `/fiscal/nfse/${doc.id}` : "/fiscal/nfse"} className={buttonClass("ghost")}>Cancelar</Link>
            <SubmitButton pending={pending} variant="secondary" name="intent" value="draft"><Save className="size-4" /> Salvar rascunho</SubmitButton>
            <SubmitButton pending={pending} variant="accent" name="intent" value="transmit"><Send className="size-4" /> Emitir NFS-e</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
