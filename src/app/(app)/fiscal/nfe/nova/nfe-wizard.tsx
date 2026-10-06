"use client";

import { formatTime } from "@/lib/dates";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileSearch, Plus, Save, Send, Trash2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import type { NfeInput, NfeRecipient } from "@/domain/fiscal/nfe";
import { previewNfeAction, saveNfeAction, searchSkusAction } from "../../actions";

type Opt = { value: string; label: string };
type Party = { id: string; name: string; recipient: NfeRecipient };
type SkuHit = { skuId: string; sku: string; name: string; unit: string; ncm: string; price: number; available: number | null; taxGroupId: string | null };
type Preview = { items: any[]; totals: any; payments: any[]; issues: string[]; warnings?: string[]; checks?: Record<string, boolean>; interstate: boolean };

const STEPS = [
  { key: "operacao", label: "Operação" },
  { key: "destinatario", label: "Destinatário" },
  { key: "produtos", label: "Produtos" },
  { key: "tributacao", label: "Tributação" },
  { key: "transporte", label: "Transporte" },
  { key: "pagamento", label: "Pagamento" },
  { key: "informacoes", label: "Informações" },
  { key: "revisao", label: "Revisão" },
] as const;

const PAY_KINDS: Opt[] = [
  { value: "cash", label: "01 — Dinheiro" },
  { value: "check", label: "02 — Cheque" },
  { value: "credit", label: "03 — Cartão de crédito" },
  { value: "debit", label: "04 — Cartão de débito" },
  { value: "store_credit", label: "05 — Crédito loja" },
  { value: "voucher", label: "10 — Vale" },
  { value: "boleto", label: "15 — Boleto" },
  { value: "deposit", label: "16 — Depósito" },
  { value: "pix", label: "17 — Pix" },
  { value: "transfer", label: "18 — Transferência" },
  { value: "none", label: "90 — Sem pagamento" },
  { value: "other", label: "99 — Outros" },
];

const money = (c: number | null | undefined) => ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface WizardProps {
  initial: NfeInput;
  draftId: string | null;
  draftStatus: string | null;
  savedAt: string | null;
  effectsLocked: boolean;
  originLabel: string | null;
  originHref: string | null;
  warnings: string[];
  blockers: string[];
  customers: Party[];
  suppliers: Party[];
  taxGroups: Opt[];
  warehouses: Opt[];
  terms: Opt[];
  branchUf: string;
  context: string;
  natures: string[];
  skuNames: Record<string, { sku: string; name: string; unit: string; ncm: string }>;
}

export function NfeWizard(props: WizardProps) {
  const [input, setInput] = useState<NfeInput>(props.initial);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(props.draftId);
  const [savedAt, setSavedAt] = useState<string | null>(props.savedAt);
  const [skuNames, setSkuNames] = useState(props.skuNames);
  const [pending, start] = useTransition();
  const [calc, startCalc] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  const set = (patch: Partial<NfeInput>) => setInput((i) => ({ ...i, ...patch }));
  const setR = (patch: Partial<NfeRecipient>) => setInput((i) => ({ ...i, recipient: { ...i.recipient, ...patch } }));
  const setA = (patch: Partial<NfeRecipient["address"]>) => setInput((i) => ({ ...i, recipient: { ...i.recipient, address: { ...i.recipient.address, ...patch } } }));
  const setT = (patch: Partial<NfeInput["transport"]>) => setInput((i) => ({ ...i, transport: { ...i.transport, ...patch } }));
  const locked = props.effectsLocked;
  const isManual = input.origin.type === "manual";

  const recalc = useCallback(() => {
    if (!input.items.length) {
      setPreview(null);
      return;
    }
    startCalc(async () => {
      const fd = new FormData();
      fd.set("payload", JSON.stringify(input));
      const r = await previewNfeAction(fd);
      if (!r.ok) {
        setPreviewErr(r.error);
        return;
      }
      setPreviewErr(null);
      setPreview(r.data as Preview);
    });
  }, [input]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      recalc();
      return;
    }
    const t = setTimeout(recalc, 600);
    return () => clearTimeout(t);
  }, [recalc]);

  const save = (intent: "draft" | "transmit" | "preview") => {
    if (props.blockers.length) return toast("error", props.blockers.join(" "));
    if (intent === "transmit" && !window.confirm("Validar e transmitir a NF-e ao provedor fiscal agora?")) return;
    start(async () => {
      const fd = new FormData();
      fd.set("payload", JSON.stringify(input));
      fd.set("intent", intent === "transmit" ? "transmit" : "draft");
      fd.set("_idem", idem);
      if (draftId) fd.set("draftId", draftId);
      if (intent !== "transmit") fd.set("stay", "1");
      const r = await saveNfeAction(fd);
      if (!r.ok) return toast("error", r.error);
      const data = r.data as { id: string; updatedAt: string } | undefined;
      if (data?.id) setDraftId(data.id);
      setSavedAt(data?.updatedAt ?? new Date().toISOString());
      toast("success", r.message ?? "Salvo.");
      if (intent === "preview" && data?.id) window.open(`/fiscal/nfe/${data.id}/imprimir`, "_blank");
      if (intent === "transmit" && r.redirect) router.push(r.redirect);
      else if (!props.draftId && data?.id && intent === "draft") router.replace(`/fiscal/nfe/nova?rascunho=${data.id}`);
    });
  };

  const totals = preview?.totals;
  const checks = preview?.checks;
  const issues = preview?.issues ?? [];
  const warnings = preview?.warnings ?? [];
  const parties = input.recipient.partyType === "supplier" ? props.suppliers : input.recipient.partyType === "customer" ? props.customers : [];
  const destino = input.recipient.address?.uf ? (input.recipient.address.uf === props.branchUf ? `Operação interna — ${props.branchUf}` : `Operação interestadual — ${props.branchUf} → ${input.recipient.address.uf}`) : "Informe a UF do destinatário";
  const paid = input.payments.filter((p) => p.kind !== "none").reduce((a, p) => a + p.amount, 0);

  return (
    <div className="grid gap-5 xl:grid-cols-[200px_1fr_320px]">
      {/* Etapas */}
      <nav aria-label="Etapas da emissão" className="no-print">
        <ol className="flex gap-1 overflow-x-auto xl:flex-col">
          {STEPS.map((s, i) => {
            const done = stepDone(s.key, input, preview);
            return (
              <li key={s.key}>
                <button type="button" onClick={() => setStep(i)} className={cn("focus-ring flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm", i === step ? "bg-brand-800 text-white" : "text-slate-700 hover:bg-white")}>
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px]", i === step ? "bg-white/20" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>{done && i !== step ? "✓" : i + 1}</span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Etapa ativa */}
      <section className="min-w-0 space-y-4 rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{STEPS[step].label}</h2>
          <span className="text-xs text-slate-500">{props.context}</span>
        </div>
        {props.blockers.length > 0 && <Notice tone="bad" title="Esta operação não pode gerar NF-e">{props.blockers.join(" ")}</Notice>}
        {props.originLabel && (
          <Notice tone="info" title={`Origem: ${props.originLabel}`}>
            {props.originHref && <Link className="underline" href={props.originHref}>abrir operação</Link>} {locked ? "· Estoque e financeiro já foram tratados pela operação de origem — esta NF-e é somente documento." : ""}
            {props.warnings.length > 0 && <ul className="mt-1 list-disc pl-5">{props.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </Notice>
        )}

        {STEPS[step].key === "operacao" && (
          <FormGrid cols={2}>
            <Field label="Natureza da operação" required>
              <Input list="natures" value={input.nature} onChange={(e) => set({ nature: e.target.value })} required />
              <datalist id="natures">{props.natures.map((n) => <option key={n} value={n} />)}</datalist>
            </Field>
            <Field label="Finalidade">
              <Select value={input.purpose} onChange={(e) => set({ purpose: e.target.value as NfeInput["purpose"] })} options={[{ value: "normal", label: "1 — NF-e normal" }, { value: "complementar", label: "2 — Complementar" }, { value: "ajuste", label: "3 — Ajuste" }, { value: "devolucao", label: "4 — Devolução" }]} disabled={!isManual} />
            </Field>
            <Field label="Tipo de operação">
              <Select value={input.operationType} onChange={(e) => set({ operationType: e.target.value as NfeInput["operationType"] })} options={[{ value: "saida", label: "1 — Saída" }, { value: "entrada", label: "0 — Entrada" }]} disabled={!isManual} />
            </Field>
            <Field label="Tipo de atendimento (presença)">
              <Select value={input.presence} onChange={(e) => set({ presence: e.target.value })} options={[{ value: "0", label: "0 — Não se aplica" }, { value: "1", label: "1 — Operação presencial" }, { value: "2", label: "2 — Internet" }, { value: "3", label: "3 — Teleatendimento" }, { value: "5", label: "5 — Presencial fora do estabelecimento" }, { value: "9", label: "9 — Outros (não presencial)" }]} />
            </Field>
            <Field label="Data de emissão" hint="Definida no momento da transmissão (a SEFAZ rejeita datas retroativas fora do prazo).">
              <Input value="Na transmissão" disabled />
            </Field>
            <Field label="Data/hora de saída ou entrada" hint="Opcional.">
              <Input type="datetime-local" value={input.exitAt ? input.exitAt.slice(0, 16) : ""} onChange={(e) => set({ exitAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
            <Field label="Consumidor final">
              <Select value={input.recipient.finalConsumer ? "1" : "0"} onChange={(e) => setR({ finalConsumer: e.target.value === "1" })} options={[{ value: "1", label: "Sim" }, { value: "0", label: "Não" }]} />
            </Field>
            <Field label="Destino da operação" hint="Derivado da UF do destinatário.">
              <Input value={destino} disabled />
            </Field>
          </FormGrid>
        )}

        {STEPS[step].key === "destinatario" && (
          <div className="space-y-4">
            <FormGrid cols={3}>
              <Field label="Tipo">
                <Select value={input.recipient.partyType} onChange={(e) => setR({ partyType: e.target.value as NfeRecipient["partyType"], partyId: null })} options={[{ value: "customer", label: "Cliente" }, { value: "supplier", label: "Fornecedor" }, { value: "branch", label: "Filial (transferência)" }, { value: "other", label: "Outro (sem cadastro)" }]} disabled={!isManual && input.origin.type !== "sale"} />
              </Field>
              {parties.length > 0 && (
                <Field label={input.recipient.partyType === "supplier" ? "Fornecedor" : "Cliente"} className="sm:col-span-2">
                  <Select
                    value={input.recipient.partyId ?? ""}
                    placeholder="Selecione para preencher os dados"
                    options={parties.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(e) => {
                      const p = parties.find((x) => x.id === e.target.value);
                      if (p) setInput((i) => ({ ...i, recipient: { ...p.recipient } }));
                    }}
                  />
                </Field>
              )}
            </FormGrid>
            <FormGrid cols={3}>
              <Field label="Nome / razão social" required className="sm:col-span-2"><Input value={input.recipient.name} onChange={(e) => setR({ name: e.target.value })} /></Field>
              <Field label="CPF/CNPJ" required><Input value={input.recipient.doc} onChange={(e) => setR({ doc: e.target.value })} inputMode="numeric" /></Field>
              <Field label="Inscrição estadual" hint="ISENTO quando aplicável"><Input value={input.recipient.ie ?? ""} onChange={(e) => setR({ ie: e.target.value })} /></Field>
              <Field label="Indicador de IE"><Select value={input.recipient.ieIndicator ?? ""} placeholder="Automático" onChange={(e) => setR({ ieIndicator: e.target.value || null })} options={[{ value: "1", label: "1 — Contribuinte" }, { value: "2", label: "2 — Isento" }, { value: "9", label: "9 — Não contribuinte" }]} /></Field>
              <Field label="E-mail (envio do XML)"><Input type="email" value={input.recipient.email ?? ""} onChange={(e) => setR({ email: e.target.value })} /></Field>
            </FormGrid>
            <FormGrid cols={6}>
              <Field label="CEP"><Input value={input.recipient.address.zip ?? ""} onChange={(e) => setA({ zip: e.target.value })} /></Field>
              <Field label="Logradouro" required className="sm:col-span-2 lg:col-span-3"><Input value={input.recipient.address.street ?? ""} onChange={(e) => setA({ street: e.target.value })} /></Field>
              <Field label="Número"><Input value={input.recipient.address.number ?? ""} onChange={(e) => setA({ number: e.target.value })} /></Field>
              <Field label="Complemento"><Input value={input.recipient.address.complement ?? ""} onChange={(e) => setA({ complement: e.target.value })} /></Field>
              <Field label="Bairro" className="lg:col-span-2"><Input value={input.recipient.address.district ?? ""} onChange={(e) => setA({ district: e.target.value })} /></Field>
              <Field label="Município" className="lg:col-span-2"><Input value={input.recipient.address.cityName ?? ""} onChange={(e) => setA({ cityName: e.target.value })} /></Field>
              <Field label="UF" required><Input maxLength={2} value={input.recipient.address.uf ?? ""} onChange={(e) => setA({ uf: e.target.value.toUpperCase() })} /></Field>
              <Field label="Cód. IBGE" required><Input value={input.recipient.address.cityCode ?? ""} onChange={(e) => setA({ cityCode: e.target.value })} inputMode="numeric" /></Field>
            </FormGrid>
          </div>
        )}

        {STEPS[step].key === "produtos" && (
          <div className="space-y-4">
            {(isManual || input.origin.type === "purchase_order") && <SkuSearch onPick={(h) => { setSkuNames((m) => ({ ...m, [h.skuId]: { sku: h.sku, name: h.name, unit: h.unit, ncm: h.ncm } })); set({ items: [...input.items, { skuId: h.skuId, qty: 1000, unitPrice: h.price, discount: 0 }] }); }} />}
            {input.items.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum item. Pesquise e adicione produtos.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead><tr><th>Produto</th><th className="w-28 text-right">Qtd</th><th className="w-36 text-right">Unitário</th><th className="w-32 text-right">Desconto</th><th className="text-right">Total</th><th /></tr></thead>
                  <tbody>
                    {input.items.map((it, idx) => {
                      const info = skuNames[it.skuId];
                      const line = Math.round((it.unitPrice * it.qty) / 1000) - it.discount;
                      return (
                        <tr key={idx}>
                          <td>
                            <span className="font-medium">{it.description || info?.name || it.skuId}</span>
                            <span className="block text-xs text-slate-500">{info?.sku} · {info?.unit} · NCM {info?.ncm || <span className="text-red-700">ausente</span>}</span>
                          </td>
                          <td><QtyInput ariaLabel="Quantidade" value={it.qty} onChange={(v) => set({ items: input.items.map((x, j) => (j === idx ? { ...x, qty: v } : x)) })} /></td>
                          <td><MoneyInput ariaLabel="Preço unitário" value={it.unitPrice} onChange={(v) => set({ items: input.items.map((x, j) => (j === idx ? { ...x, unitPrice: v } : x)) })} /></td>
                          <td><MoneyInput ariaLabel="Desconto" value={it.discount} onChange={(v) => set({ items: input.items.map((x, j) => (j === idx ? { ...x, discount: v } : x)) })} /></td>
                          <td className="tabular text-right">{money(line)}</td>
                          <td>
                            {(isManual || input.origin.type === "purchase_order") && (
                              <Button type="button" variant="ghost" size="sm" aria-label="Remover item" onClick={() => set({ items: input.items.filter((_, j) => j !== idx) })}>
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <FormGrid cols={3}>
              <Field label="Frete (rateado nos itens)"><MoneyInput value={input.freight} onChange={(v) => set({ freight: v })} /></Field>
              <Field label="Seguro (rateado)"><MoneyInput value={input.insurance} onChange={(v) => set({ insurance: v })} /></Field>
              <Field label="Outras despesas/acréscimos (rateado)"><MoneyInput value={input.other} onChange={(v) => set({ other: v })} /></Field>
            </FormGrid>
          </div>
        )}

        {STEPS[step].key === "tributacao" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">CFOP, CST/CSOSN e alíquotas vêm do grupo tributário do produto (ou do padrão da filial). Sobreponha por item quando necessário; o cálculo é sempre refeito no servidor.</p>
            {input.items.length === 0 ? (
              <p className="text-sm text-slate-500">Inclua produtos primeiro.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead><tr><th>Item</th><th>Grupo tributário</th><th className="w-24">CFOP</th><th className="w-24">CST/CSOSN</th><th>Calculado no servidor</th></tr></thead>
                  <tbody>
                    {input.items.map((it, idx) => {
                      const pv = preview?.items?.[idx];
                      return (
                        <tr key={idx}>
                          <td>{skuNames[it.skuId]?.name ?? it.description ?? it.skuId}</td>
                          <td><Select value={it.taxGroupId ?? ""} placeholder={`Do produto${pv?.taxGroupName ? ` (${pv.taxGroupName})` : ""}`} options={props.taxGroups} onChange={(e) => set({ items: input.items.map((x, j) => (j === idx ? { ...x, taxGroupId: e.target.value || null } : x)) })} /></td>
                          <td><Input value={it.cfop ?? ""} placeholder={pv?.cfop ?? ""} maxLength={4} onChange={(e) => set({ items: input.items.map((x, j) => (j === idx ? { ...x, cfop: e.target.value || null } : x)) })} /></td>
                          <td><Input value={it.cstCsosn ?? ""} placeholder={pv?.cstCsosn ?? ""} maxLength={3} onChange={(e) => set({ items: input.items.map((x, j) => (j === idx ? { ...x, cstCsosn: e.target.value || null } : x)) })} /></td>
                          <td className="text-xs">{pv ? <>CFOP <b>{pv.cfop || "—"}</b> · CST <b>{pv.cstCsosn || "—"}</b> · NCM {pv.ncm || <span className="text-red-700">ausente</span>} · base {money(pv.icmsBase)} · ICMS {money(pv.icms)} · trib. aprox. {money(pv.approxTax)}{pv.taxGroupIssue && <span className="block text-red-700">{pv.taxGroupIssue}</span>}</> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={recalc} loading={calc}><RefreshCw className="size-4" /> Recalcular no servidor</Button>
          </div>
        )}

        {STEPS[step].key === "transporte" && (
          <FormGrid cols={3}>
            <Field label="Modalidade do frete" className="sm:col-span-3">
              <Select value={String(input.transport.mode ?? "9")} onChange={(e) => setT({ mode: e.target.value })} options={[{ value: "0", label: "0 — Por conta do emitente (CIF)" }, { value: "1", label: "1 — Por conta do destinatário (FOB)" }, { value: "2", label: "2 — Por conta de terceiros" }, { value: "3", label: "3 — Transporte próprio por conta do remetente" }, { value: "4", label: "4 — Transporte próprio por conta do destinatário" }, { value: "9", label: "9 — Sem ocorrência de transporte" }]} />
            </Field>
            {String(input.transport.mode) !== "9" && (
              <>
                <Field label="Transportador (nome)"><Input value={input.transport.carrierName ?? ""} onChange={(e) => setT({ carrierName: e.target.value })} /></Field>
                <Field label="CPF/CNPJ do transportador"><Input value={input.transport.carrierDoc ?? ""} onChange={(e) => setT({ carrierDoc: e.target.value })} /></Field>
                <Field label="UF do transportador"><Input maxLength={2} value={input.transport.carrierUf ?? ""} onChange={(e) => setT({ carrierUf: e.target.value.toUpperCase() })} /></Field>
                <Field label="Placa do veículo"><Input value={input.transport.vehiclePlate ?? ""} onChange={(e) => setT({ vehiclePlate: e.target.value.toUpperCase() })} placeholder="ABC1D23" /></Field>
                <Field label="UF do veículo"><Input maxLength={2} value={input.transport.vehicleUf ?? ""} onChange={(e) => setT({ vehicleUf: e.target.value.toUpperCase() })} /></Field>
              </>
            )}
            <Field label="Volumes (quantidade)"><Input type="number" min={0} value={input.transport.volumes ?? ""} onChange={(e) => setT({ volumes: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="Espécie"><Input value={input.transport.species ?? ""} onChange={(e) => setT({ species: e.target.value })} placeholder="Caixa" /></Field>
            <Field label="Peso bruto (kg)"><Input type="number" min={0} step="0.001" value={input.transport.grossWeightKg ?? ""} onChange={(e) => setT({ grossWeightKg: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="Peso líquido (kg)"><Input type="number" min={0} step="0.001" value={input.transport.netWeightKg ?? ""} onChange={(e) => setT({ netWeightKg: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          </FormGrid>
        )}

        {STEPS[step].key === "pagamento" && (
          <div className="space-y-4">
            {input.payments.map((p, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                <Select aria-label="Forma de pagamento" value={p.kind} options={PAY_KINDS} onChange={(e) => set({ payments: input.payments.map((x, j) => (j === idx ? { ...x, kind: e.target.value, amount: e.target.value === "none" ? 0 : x.amount } : x)) })} />
                <MoneyInput ariaLabel="Valor" value={p.amount} disabled={p.kind === "none"} onChange={(v) => set({ payments: input.payments.map((x, j) => (j === idx ? { ...x, amount: v } : x)) })} />
                <Button type="button" variant="ghost" aria-label="Remover pagamento" onClick={() => set({ payments: input.payments.filter((_, j) => j !== idx) })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => set({ payments: [...input.payments, { kind: "pix", amount: 0 }] })}><Plus className="size-4" /> Forma de pagamento</Button>
              {totals && <Button type="button" size="sm" variant="secondary" onClick={() => set({ payments: [{ kind: input.payments[0]?.kind && input.payments[0].kind !== "none" ? input.payments[0].kind : "boleto", amount: totals.total }] })}>Usar o total da nota ({money(totals.total)})</Button>}
              <Button type="button" size="sm" variant="ghost" onClick={() => set({ payments: [{ kind: "none", amount: 0 }] })}>Sem pagamento (devolução/remessa)</Button>
            </div>
            {totals && !input.payments.some((p) => p.kind === "none") && paid !== totals.total && <Notice tone="warn">Pagamentos ({money(paid)}) diferem do total da nota ({money(totals.total)}).</Notice>}
            <div className="rounded-md border border-line p-4">
              <p className="mb-2 text-sm font-semibold">Efeitos da operação</p>
              {locked ? (
                <p className="text-sm text-slate-600">Somente documento — estoque e financeiro já foram tratados por {props.originLabel ?? "a operação de origem"}.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Escolha expressamente o que esta NF-e movimenta. Os efeitos são aplicados uma única vez, na autorização, e revertidos se a nota for cancelada.</p>
                  <div className="flex flex-wrap gap-5">
                    <Checkbox label="Somente documento" checked={!input.effects.stock && !input.effects.financial} onChange={(e) => e.target.checked && set({ effects: { ...input.effects, stock: false, financial: false } })} />
                    <Checkbox label={input.operationType === "entrada" ? "Dar entrada no estoque" : "Baixar estoque"} checked={input.effects.stock} onChange={(e) => set({ effects: { ...input.effects, stock: e.target.checked } })} />
                    {isManual && <Checkbox label={input.operationType === "entrada" ? "Gerar conta a pagar" : "Gerar conta a receber"} checked={input.effects.financial} onChange={(e) => set({ effects: { ...input.effects, financial: e.target.checked } })} />}
                  </div>
                  {(input.effects.stock || input.effects.financial) && (
                    <FormGrid cols={3}>
                      {input.effects.stock && <Field label="Depósito"><Select value={input.effects.warehouseId ?? ""} placeholder="Depósito padrão da filial" options={props.warehouses} onChange={(e) => set({ effects: { ...input.effects, warehouseId: e.target.value || null } })} /></Field>}
                      {input.effects.financial && <Field label="Condição de pagamento"><Select value={input.effects.paymentTermId ?? ""} placeholder="Vencimento único" options={props.terms} onChange={(e) => set({ effects: { ...input.effects, paymentTermId: e.target.value || null } })} /></Field>}
                      {input.effects.financial && !input.effects.paymentTermId && <Field label="Vencimento"><Input type="date" value={input.effects.dueDate ?? ""} onChange={(e) => set({ effects: { ...input.effects, dueDate: e.target.value } })} /></Field>}
                    </FormGrid>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {STEPS[step].key === "informacoes" && (
          <div className="space-y-4">
            <Field label="Informações complementares (contribuinte)">
              <Textarea rows={4} maxLength={2000} value={input.additionalInfo ?? ""} onChange={(e) => set({ additionalInfo: e.target.value })} />
            </Field>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Documentos referenciados (chave de acesso de 44 dígitos){input.purpose === "devolucao" && <span className="text-red-600"> *</span>}</p>
              {input.referencedKeys.map((k, idx) => (
                <div key={idx} className="mb-2 flex gap-2">
                  <Input value={k} onChange={(e) => set({ referencedKeys: input.referencedKeys.map((x, j) => (j === idx ? e.target.value : x)) })} className="font-mono" maxLength={54} />
                  <Button type="button" variant="ghost" aria-label="Remover chave" onClick={() => set({ referencedKeys: input.referencedKeys.filter((_, j) => j !== idx) })}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => set({ referencedKeys: [...input.referencedKeys, ""] })}><Plus className="size-4" /> Chave referenciada</Button>
            </div>
          </div>
        )}

        {STEPS[step].key === "revisao" && (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Operação</dt><dd>{input.nature} · {input.operationType === "entrada" ? "entrada" : "saída"} · finalidade {input.purpose}</dd></div>
              <div><dt className="text-xs text-slate-500">Destinatário</dt><dd>{input.recipient.name || "—"} {input.recipient.doc && `· ${input.recipient.doc}`}</dd></div>
              <div><dt className="text-xs text-slate-500">Itens</dt><dd>{input.items.length} item(ns)</dd></div>
              <div><dt className="text-xs text-slate-500">Efeitos</dt><dd>{locked ? "Somente documento (origem)" : [input.effects.stock ? "estoque" : "", input.effects.financial ? "financeiro" : ""].filter(Boolean).join(" + ") || "Somente documento"}</dd></div>
            </dl>
            {issues.length > 0 ? (
              <Notice tone="warn" title="Pendências: a transmissão resultará em 'Pendente' até a correção">
                <ul className="list-disc pl-5">{issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
              </Notice>
            ) : (
              preview && <Notice tone="good">Validação prévia sem pendências. A autorização depende do retorno real do provedor/SEFAZ.</Notice>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft className="size-4" /> Anterior</Button>
          {step < STEPS.length - 1 && <Button type="button" variant="secondary" onClick={() => setStep((s) => s + 1)}>Próxima <ChevronRight className="size-4" /></Button>}
        </div>
      </section>

      {/* Totais e validação */}
      <aside className="space-y-4">
        <div className="rounded-lg border border-line bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Totais da NF-e</h3>
            {calc && <span className="text-xs text-slate-500">calculando…</span>}
          </div>
          {previewErr && <p className="mb-2 text-xs text-red-700">{previewErr}</p>}
          <table className="w-full text-sm">
            <tbody className="[&_td]:py-0.5">
              <tr><td>Produtos</td><td className="tabular text-right">{money(totals?.products)}</td></tr>
              <tr><td>Desconto</td><td className="tabular text-right">{money(totals?.discount)}</td></tr>
              <tr><td>Frete</td><td className="tabular text-right">{money(totals?.freight)}</td></tr>
              <tr><td>Seguro / outras</td><td className="tabular text-right">{money((totals?.insurance ?? 0) + (totals?.other ?? 0))}</td></tr>
              <tr><td>ICMS</td><td className="tabular text-right">{money(totals?.icms)}</td></tr>
              <tr><td>Tributos estimados</td><td className="tabular text-right">{money(totals?.approxTax)}</td></tr>
              <tr className="border-t border-line text-base font-semibold"><td>Total da nota</td><td className="tabular text-right">{money(totals?.total)}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">Calculado no servidor (rateio de frete/seguro/outras despesas pelo maior resto).</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Validação fiscal</h3>
          {!preview ? (
            <p className="text-xs text-slate-500">Inclua itens para validar.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              <Check ok={checks?.issuer !== false} label="Emitente configurado" />
              <Check ok={checks?.recipient !== false} label="Destinatário válido" hint="CPF/CNPJ, nome e endereço" />
              <Check ok={checks?.products !== false} label="Produtos configurados" hint="NCM, CFOP e CST/CSOSN" />
              <Check ok={checks?.totals !== false} label="Totais conferidos" hint="Pagamentos compatíveis" />
              <Check ok={checks?.transport !== false} warn label={checks?.transport === false ? "Transporte incompleto" : "Transporte"} hint={warnings.find((w) => /Transporte/.test(w))} />
              {warnings.filter((w) => !/Transporte/.test(w)).map((w, i) => <Check key={i} ok={false} warn label={w} />)}
            </ul>
          )}
          {issues.length > 0 && <p className="mt-2 text-xs text-amber-800">{issues.length} pendência(s) — veja a etapa Revisão.</p>}
        </div>
        <div className="space-y-2 rounded-lg border border-line bg-white p-4">
          {savedAt && <Badge tone="good">Rascunho salvo às {formatTime(savedAt)}</Badge>}
          {props.draftStatus && props.draftStatus !== "draft" && <Badge tone="warn">Situação atual: {props.draftStatus === "rejected" ? "Rejeitada — corrija e retransmita" : "Pendente"}</Badge>}
          <Button type="button" variant="secondary" className="w-full" onClick={() => save("draft")} loading={pending} disabled={!input.items.length}><Save className="size-4" /> Salvar rascunho</Button>
          <Button type="button" variant="secondary" className="w-full" onClick={() => save("preview")} loading={pending} disabled={!input.items.length}><FileSearch className="size-4" /> Pré-visualizar DANFE</Button>
          <Button type="button" variant="accent" className="w-full" onClick={() => save("transmit")} loading={pending} disabled={!input.items.length || props.blockers.length > 0}><Send className="size-4" /> Validar e transmitir</Button>
          <p className="text-[11px] text-slate-500">A prévia sai marcada “SEM VALOR FISCAL”. Transmitir usa a mesma referência em qualquer reenvio.</p>
        </div>
      </aside>
    </div>
  );
}

function Check({ ok, label, hint, warn }: { ok: boolean; label: string; hint?: string; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : warn ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </li>
  );
}

function stepDone(key: string, i: NfeInput, p: Preview | null) {
  switch (key) {
    case "operacao":
      return Boolean(i.nature.trim());
    case "destinatario":
      return Boolean(i.recipient.name && i.recipient.doc && i.recipient.address?.uf && p?.checks?.recipient !== false);
    case "produtos":
      return i.items.length > 0;
    case "tributacao":
      return i.items.length > 0 && p?.checks?.products !== false;
    case "transporte":
      return p?.checks?.transport !== false;
    case "pagamento":
      return i.payments.length > 0 && p?.checks?.totals !== false;
    case "informacoes":
      return i.purpose !== "devolucao" || i.referencedKeys.some((k) => k.replace(/\D/g, "").length === 44);
    default:
      return Boolean(p && !p.issues.length);
  }
}

function SkuSearch({ onPick }: { onPick: (h: SkuHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      start(async () => {
        const r = await searchSkusAction(q);
        if (!r.ok) return toast("error", r.error);
        setHits((r.data as SkuHit[]) ?? []);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, toast]);
  return (
    <div className="relative">
      <Input placeholder="Pesquisar produto por nome, código ou código de barras" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar produto" />
      {pending && <span className="absolute right-3 top-2.5 text-xs text-slate-400">buscando…</span>}
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-white shadow-lg">
          {hits.map((h) => (
            <li key={h.skuId}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => { onPick(h); setQ(""); setHits([]); }}>
                <span>
                  {h.name}
                  <span className="block text-xs text-slate-500">{h.sku} · NCM {h.ncm || "ausente"} · disponível {h.available != null ? (h.available / 1000).toLocaleString("pt-BR") : "—"} {h.unit}</span>
                </span>
                <span className="tabular text-sm">{money(h.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

