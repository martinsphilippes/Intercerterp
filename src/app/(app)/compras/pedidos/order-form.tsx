"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { FileText, ListPlus, Star, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button, buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatMoney, formatQty } from "@/lib/money";
import { addDays, formatDate, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { computeOrderTotals, buildInstallmentPlan, tierFor } from "@/domain/purchase-calc";
import { SkuPicker } from "../_shared/sku-picker";
import { supplierCostsAction } from "../_shared/actions";
import { saveOrderAction, suggestionsForSupplierAction, quotationFromFormAction } from "./actions";

type Opt = { value: string; label: string };
export type SupplierOpt = Opt & { leadTimeDays: number | null; paymentTermId: string | null; minOrderValue: number; email: string | null; doc: string | null; contact: string | null; terms: string | null; score: number | null };
export type TermOpt = Opt & { installments: number; firstDueDays: number; intervalDays: number };
export interface PolicyPreview {
  configured: boolean;
  name: string;
  tiers: Array<{ above: number; steps: Array<{ name: string; kind: string; responsibleNames: string[] }> }>;
  autoApproveBelow: number;
}
export interface BudgetInfo {
  limit: number;
  consumed: number;
}

export interface FormItem {
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  supplierCode: string | null;
  qty: number;
  unitCost: number;
  discount: number;
  ipi: number;
  available: number | null;
  stockMin: number | null;
}

export function OrderForm({
  order,
  items: initialItems,
  suppliers,
  warehouses,
  terms,
  methods,
  costCenters,
  buyers,
  policy,
  budget,
  branchName,
  currentUserId,
  defaultSupplierId,
  revising,
  revisionMode,
}: {
  order?: Record<string, any> | null;
  items?: FormItem[];
  suppliers: SupplierOpt[];
  warehouses: Opt[];
  terms: TermOpt[];
  methods: Opt[];
  costCenters: Opt[];
  buyers: Opt[];
  policy: PolicyPreview;
  budget: BudgetInfo | null;
  branchName: string;
  currentUserId: string;
  defaultSupplierId?: string | null;
  revising?: boolean;
  revisionMode?: string;
}) {
  const o = order ?? {};
  const toast = useToast();
  const [supplierId, setSupplierId] = useState<string>(o.supplierId ?? defaultSupplierId ?? "");
  const supplier = suppliers.find((s) => s.value === supplierId);
  const [items, setItems] = useState<FormItem[]>(initialItems ?? []);
  const [headerDiscount, setHeaderDiscount] = useState<number>(o.id ? Math.max(0, (o.discountTotal ?? 0) - (initialItems ?? []).reduce((a, i) => a + i.discount, 0)) : 0);
  const [freight, setFreight] = useState<number>(o.freight ?? 0);
  const [insurance, setInsurance] = useState<number>(o.insurance ?? 0);
  const [other, setOther] = useState<number>(o.otherExpenses ?? 0);
  const [termId, setTermId] = useState<string>(o.paymentTermId ?? supplier?.paymentTermId ?? "");
  const [customDays, setCustomDays] = useState<string>(o.paymentTermsText?.startsWith("Prazos ") ? o.paymentTermsText.replace(/^Prazos | dias$/g, "") : "");
  const [expectedDate, setExpectedDate] = useState<string>(o.expectedDate ?? (supplier?.leadTimeDays != null ? addDays(today(), supplier.leadTimeDays) : ""));
  const [purpose, setPurpose] = useState<string>(o.purpose ?? "");
  const [loading, start] = useTransition();
  const totals = useMemo(() => computeOrderTotals({ items, headerDiscount, freight, insurance, otherExpenses: other }), [items, headerDiscount, freight, insurance, other]);
  const term = terms.find((t) => t.value === termId) ?? null;
  let plan: Array<{ number: number; days: number; amount: number }> = [];
  let planError: string | null = null;
  try {
    plan = buildInstallmentPlan(totals.total, term, customDays);
  } catch (e: any) {
    planError = e.message;
  }
  const units = items.reduce((a, i) => a + i.qty, 0);
  const setItem = (i: number, patch: Partial<FormItem>) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const changeSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find((x) => x.value === id);
    if (!o.id) {
      if (s?.paymentTermId) setTermId(s.paymentTermId);
      if (s?.leadTimeDays != null) setExpectedDate(addDays(today(), s.leadTimeDays));
    }
    if (id && items.length)
      start(async () => {
        const r = await supplierCostsAction(id, items.map((i) => i.skuId));
        if (!r.ok) return toast("error", r.error);
        const map = r.data ?? {};
        setItems((a) => a.map((x) => (map[x.skuId] ? { ...x, unitCost: map[x.skuId].lastCost ?? x.unitCost, supplierCode: map[x.skuId].supplierCode } : { ...x, supplierCode: null })));
        toast("info", "Custos sugeridos atualizados a partir do último custo deste fornecedor.");
      });
  };
  const addSuggestions = () =>
    start(async () => {
      if (!supplierId) return toast("error", "Selecione o fornecedor.");
      const r = await suggestionsForSupplierAction(supplierId);
      if (!r.ok) return toast("error", r.error);
      const list = (r.data ?? []).filter((x) => !items.some((i) => i.skuId === x.skuId));
      if (!list.length) return toast("info", "Nenhuma sugestão de reposição pendente para este fornecedor.");
      setItems((a) => [...a, ...list.map((x) => ({ skuId: x.skuId, sku: x.sku, name: x.name, unitCode: x.unitCode, supplierCode: x.supplierCode, qty: x.qty, unitCost: x.unitCost, discount: 0, ipi: 0, available: x.available, stockMin: x.stockMin }))]);
      toast("success", `${list.length} produto(s) adicionados pela sugestão de reposição.`);
    });
  const belowMin = supplier && supplier.minOrderValue > 0 && totals.subtotal - totals.discountTotal < supplier.minOrderValue;
  const tier = policy.tiers.length ? tierFor(policy, totals.total) : null;
  const auto = policy.autoApproveBelow > 0 && totals.total > 0 && totals.total < policy.autoApproveBelow;
  const budgetAfter = budget && budget.limit ? budget.limit - budget.consumed - totals.total : null;
  const itemsJson = JSON.stringify(items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitCost: i.unitCost, discount: i.discount, ipi: i.ipi, description: i.name, unitCode: i.unitCode, supplierCode: i.supplierCode })));
  return (
    <ActionForm action={saveOrderAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {o.id && <input type="hidden" name="id" value={o.id} />}
          <input type="hidden" name="items" value={itemsJson} />
          <input type="hidden" name="supplierId" value={supplierId} />
          <input type="hidden" name="headerDiscount" value={headerDiscount} />
          <input type="hidden" name="freight" value={freight} />
          <input type="hidden" name="insurance" value={insurance} />
          <input type="hidden" name="otherExpenses" value={other} />
          {revising && (
            <Notice tone="warn" title="Alteração após aprovação gera revisão">
              A versão atual será preservada em Revisões. Regra da política: {revisionMode === "always" ? "toda alteração volta para análise" : revisionMode === "never" ? "revisões não exigem nova análise" : "alterações relevantes (aumento de total, quantidade, custo, novo item ou condição de pagamento) voltam para análise"}. O fornecedor não pode ser trocado.
            </Notice>
          )}
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-5">
              <FormSection title="Fornecedor e entrega">
                <FormGrid cols={4}>
                  <Field label="Fornecedor" required className="sm:col-span-2">
                    <Select value={supplierId} disabled={revising} onChange={(e) => changeSupplier(e.target.value)} options={suppliers} placeholder="Selecione…" aria-label="Fornecedor" />
                  </Field>
                  <Field label="Data do pedido">
                    <Input value={formatDate(o.createdAt ?? today())} readOnly disabled aria-label="Data do pedido" />
                  </Field>
                  <Field label="Comprador responsável">
                    <Select name="buyerId" defaultValue={o.buyerId ?? currentUserId} options={buyers} aria-label="Comprador responsável" />
                  </Field>
                </FormGrid>
                {supplier && (
                  <div className="mt-4 grid gap-3 rounded-md bg-brand-50/60 p-3 text-sm sm:grid-cols-4">
                    <div><p className="text-xs text-slate-500">CNPJ</p><p>{formatDoc(supplier.doc) || "—"}</p></div>
                    <div><p className="text-xs text-slate-500">Contato comercial</p><p>{supplier.contact ?? "—"}</p></div>
                    <div><p className="text-xs text-slate-500">Prazo negociado</p><p>{supplier.terms ?? "—"}{supplier.leadTimeDays != null ? ` · entrega ${supplier.leadTimeDays} d` : ""}</p></div>
                    <div><p className="text-xs text-slate-500">Desempenho</p><p className="flex items-center gap-1">{supplier.score != null ? <><Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden /> {(supplier.score / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })} de 5</> : "sem recebimentos"}</p></div>
                  </div>
                )}
                <FormGrid cols={4} className="mt-4">
                  <Field label="Filial de destino">
                    <Input value={branchName} readOnly disabled aria-label="Filial de destino" />
                  </Field>
                  <Field label="Local de entrega (depósito)" required>
                    <Select name="warehouseId" defaultValue={o.warehouseId ?? warehouses[0]?.value ?? ""} options={warehouses} aria-label="Local de entrega" />
                  </Field>
                  <Field label="Previsão de entrega" hint={supplier?.leadTimeDays != null ? `Prazo do fornecedor: ${supplier.leadTimeDays} dias` : undefined}>
                    <Input type="date" name="expectedDate" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                  </Field>
                  <Field label="Finalidade da compra">
                    <Input name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Ex.: reposição da coleção de verão" maxLength={200} />
                  </Field>
                </FormGrid>
              </FormSection>

              <FormSection
                title="Produtos do pedido"
                description="Custo sugerido pelo último custo do fornecedor. Linha = qtd. × custo − desconto + IPI. Quantidades na unidade interna."
                actions={
                  <Button type="button" size="sm" variant="ghost" onClick={addSuggestions} loading={loading} disabled={!supplierId || revising}>
                    <ListPlus className="size-4" /> Adicionar pela sugestão de compra
                  </Button>
                }
              >
                <SkuPicker supplierId={supplierId || null} exclude={items.map((i) => i.skuId)} onPick={(h) => setItems((a) => [...a, { skuId: h.id, sku: h.sku, name: h.name, unitCode: h.unitCode, supplierCode: h.supplierCode, qty: Math.max(1000, h.minQty ?? 1000), unitCost: h.lastCost ?? h.costAcquisition ?? 0, discount: 0, ipi: 0, available: h.available, stockMin: h.stockMin }])} />
                {items.length === 0 ? (
                  <p className="mt-4 rounded-md border border-dashed border-line p-6 text-center text-sm text-slate-500">Nenhum produto. Pesquise acima ou use a sugestão de compra.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="table-base w-full text-sm">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="text-right">Estoque</th>
                          <th className="w-24 text-right">Qtd.</th>
                          <th className="w-32 text-right">Custo unit.</th>
                          <th className="w-28 text-right">Desc. (R$)</th>
                          <th className="w-28 text-right">IPI (R$)</th>
                          <th className="text-right">Total</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => {
                          const line = totals.items[i];
                          const low = it.available != null && it.stockMin != null && it.available <= it.stockMin;
                          return (
                            <tr key={it.skuId}>
                              <td>
                                {it.name}
                                <span className="block text-xs text-slate-500">{it.sku}{it.supplierCode ? ` · cód. fornecedor ${it.supplierCode}` : ""}</span>
                              </td>
                              <td className={`tabular whitespace-nowrap text-right ${low ? "font-medium text-accent-700" : "text-slate-500"}`} title={it.stockMin ? `Mínimo ${formatQty(it.stockMin)}` : undefined}>{it.available != null ? formatQty(it.available, it.unitCode) : "—"}</td>
                              <td><QtyInput value={it.qty} onChange={(v) => setItem(i, { qty: v })} ariaLabel={`Quantidade de ${it.name}`} /></td>
                              <td><MoneyInput value={it.unitCost} onChange={(v) => setItem(i, { unitCost: v })} ariaLabel={`Custo unitário de ${it.name}`} /></td>
                              <td><MoneyInput value={it.discount} onChange={(v) => setItem(i, { discount: v })} ariaLabel={`Desconto de ${it.name}`} /></td>
                              <td><MoneyInput value={it.ipi} onChange={(v) => setItem(i, { ipi: v })} ariaLabel={`IPI de ${it.name}`} /></td>
                              <td className="tabular text-right">{formatMoney(line?.total ?? 0)}</td>
                              <td className="text-right">
                                <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${it.name}`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>
                                  <Trash2 className="size-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-slate-500">{items.length} produto(s) · {formatQty(units)} unidades</p>
                  </div>
                )}
              </FormSection>

              <FormSection title="Condições e observações">
                <FormGrid cols={2}>
                  <Field label="Condição de pagamento">
                    <Select name="paymentTermId" value={termId} onChange={(e) => setTermId(e.target.value)} options={terms} placeholder="—" aria-label="Condição de pagamento" />
                  </Field>
                  <Field label="Ou prazos personalizados (dias)" hint="Ex.: 28/56 — substitui a condição." error={planError}>
                    <Input name="customDays" value={customDays} onChange={(e) => setCustomDays(e.target.value)} placeholder="28/56" />
                  </Field>
                  <Field label="Forma de pagamento">
                    <Select name="paymentMethodId" defaultValue={o.paymentMethodId ?? ""} options={methods} placeholder="—" aria-label="Forma de pagamento" />
                  </Field>
                  <Field label="Centro de custo">
                    <Select name="costCenterId" defaultValue={o.costCenterId ?? ""} options={costCenters} placeholder="—" aria-label="Centro de custo" />
                  </Field>
                </FormGrid>
                {plan.length > 0 && (
                  <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
                    <p className="mb-1 text-xs font-semibold text-slate-600">Parcelas previstas (dias após o faturamento)</p>
                    <ul className="space-y-0.5">
                      {plan.map((p) => (
                        <li key={p.number} className="flex justify-between tabular">
                          <span>{p.number}ª — {p.days === 0 ? "à vista" : `${p.days} dias`}</span>
                          <span>{formatMoney(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Field label="Observações ao fornecedor" className="mt-4">
                  <Textarea name="notes" defaultValue={o.notes ?? ""} placeholder="Ex.: entregar no depósito da Matriz, de segunda a sexta, das 8h às 17h." />
                </Field>
                {revising && (
                  <Field label="Motivo da revisão" required className="mt-4">
                    <Input name="revisionReason" required placeholder="Ex.: fornecedor reajustou o preço do item X" />
                  </Field>
                )}
              </FormSection>
            </div>

            <div className="space-y-5">
              <FormSection title="Resumo financeiro">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt>Subtotal dos produtos</dt><dd className="tabular">{formatMoney(totals.subtotal)}</dd></div>
                  <div className="flex justify-between text-slate-600"><dt>Descontos nos itens</dt><dd className="tabular">− {formatMoney(totals.itemDiscounts)}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Desconto geral</dt><dd className="w-36"><MoneyInput value={headerDiscount} onChange={setHeaderDiscount} ariaLabel="Desconto geral" /></dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Frete</dt><dd className="w-36"><MoneyInput value={freight} onChange={setFreight} ariaLabel="Frete" /></dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Seguro</dt><dd className="w-36"><MoneyInput value={insurance} onChange={setInsurance} ariaLabel="Seguro" /></dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Outras despesas</dt><dd className="w-36"><MoneyInput value={other} onChange={setOther} ariaLabel="Outras despesas" /></dd></div>
                  <div className="flex justify-between text-slate-600"><dt>IPI (soma das linhas)</dt><dd className="tabular">{formatMoney(totals.ipiTotal)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total do pedido</dt><dd className="tabular">{formatMoney(totals.total)}</dd></div>
                </dl>
                {belowMin && <p className="mt-3 text-xs text-amber-700">Produtos abaixo do pedido mínimo do fornecedor ({formatMoney(supplier!.minOrderValue)}).</p>}
                {expectedDate && <p className="mt-2 text-xs text-slate-500">Previsão de entrega: {formatDate(expectedDate)}</p>}
                <div className="mt-4 rounded-md border border-line p-3">
                  <p className="text-xs font-semibold text-slate-600">Orçamento mensal de compras ({branchName})</p>
                  {budget && budget.limit > 0 ? (
                    <>
                      <p className="tabular mt-1 text-sm">{formatMoney(budget.consumed)} / {formatMoney(budget.limit)}</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(((budget.consumed + totals.total) * 100) / budget.limit))}>
                        <div className="h-full bg-brand-600" style={{ width: `${Math.min(100, (budget.consumed * 100) / budget.limit)}%` }} />
                      </div>
                      <p className={`mt-1 text-xs ${budgetAfter! < 0 ? "text-red-700" : "text-slate-500"}`}>{budgetAfter! < 0 ? `Excede o orçamento em ${formatMoney(-budgetAfter!)}.` : `Restarão ${formatMoney(budgetAfter!)} após este pedido.`}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Orçamento não configurado. <Link className="text-brand-700 underline" href="/compras/aprovacoes/politica">Definir na política de compras</Link>.</p>
                  )}
                </div>
              </FormSection>
              <FormSection title="Fluxo de aprovação">
                {!policy.configured && <p className="mb-2 text-xs text-amber-700">Política não configurada: uma etapa por quem tem “Aprovar compras”.</p>}
                {auto ? (
                  <p className="text-sm text-emerald-700">Abaixo de {formatMoney(policy.autoApproveBelow)}: autoaprovado pela política ao enviar.</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    <li className="flex items-start justify-between gap-2"><span>Solicitante<span className="block text-xs text-slate-500">Você</span></span><Badge tone="warn">Preparando</Badge></li>
                    {(tier?.steps ?? []).map((st, i) => (
                      <li key={i} className="flex items-start justify-between gap-2">
                        <span>{i + 1}. {st.name}<span className="block text-xs text-slate-500">{st.responsibleNames.join(", ") || "sem responsáveis"}{tier!.above > 0 ? ` · acima de ${formatMoney(tier!.above)}` : ""}</span></span>
                        <Badge tone="neutral">Pendente</Badge>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-2 text-xs text-slate-500">A alçada considera o total com frete. <Link className="text-brand-700 underline" href="/compras/aprovacoes/politica">Ver política</Link></p>
              </FormSection>
            </div>
          </div>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <Link href={o.id ? `/compras/pedidos/${o.id}` : "/compras/pedidos"} className={buttonClass("ghost")}>Cancelar</Link>
            {revising ? (
              <SubmitButton pending={pending} name="intent" value="revision">
                Salvar revisão
              </SubmitButton>
            ) : (
              <>
                <SubmitButton pending={pending} variant="secondary" name="intent" value="draft">
                  Salvar rascunho
                </SubmitButton>
                {!o.id && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!items.length || pending}
                    loading={loading}
                    title="Cria uma cotação com estes itens para comparar fornecedores"
                    onClick={() =>
                      start(async () => {
                        const fd = new FormData();
                        fd.set("items", itemsJson);
                        fd.set("supplierId", supplierId);
                        fd.set("purpose", purpose);
                        fd.set("expectedDate", expectedDate);
                        fd.set("_idem", `${Date.now()}`);
                        const r = await quotationFromFormAction(fd);
                        if (!r.ok) return toast("error", r.error);
                        toast("success", r.message ?? "Cotação criada.");
                        if (r.redirect) window.location.href = r.redirect;
                      })
                    }
                  >
                    <FileText className="size-4" /> Gerar cotação
                  </Button>
                )}
                <SubmitButton pending={pending} variant="accent" name="intent" value="submit">
                  Enviar para aprovação
                </SubmitButton>
              </>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}
