"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { addDays, formatDate, today } from "@/lib/dates";
import { computeOrderTotals, buildInstallmentPlan } from "@/domain/purchase-calc";
import { SkuPicker } from "../_shared/sku-picker";
import { supplierCostsAction } from "../_shared/actions";
import { saveOrderAction } from "./actions";

type Opt = { value: string; label: string };
export type SupplierOpt = Opt & { leadTimeDays: number | null; paymentTermId: string | null; minOrderValue: number; email: string | null };
export type TermOpt = Opt & { installments: number; firstDueDays: number; intervalDays: number };

export interface FormItem {
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  supplierCode: string | null;
  qty: number;
  unitCost: number;
  discount: number;
}

export function OrderForm({
  order,
  items: initialItems,
  suppliers,
  warehouses,
  terms,
  defaultSupplierId,
  revising,
  revisionMode,
}: {
  order?: Record<string, any> | null;
  items?: FormItem[];
  suppliers: SupplierOpt[];
  warehouses: Opt[];
  terms: TermOpt[];
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
  const [other, setOther] = useState<number>(o.otherExpenses ?? 0);
  const [termId, setTermId] = useState<string>(o.paymentTermId ?? supplier?.paymentTermId ?? "");
  const [customDays, setCustomDays] = useState<string>(o.paymentTermsText?.startsWith("Prazos ") ? o.paymentTermsText.replace(/^Prazos | dias$/g, "") : "");
  const [expectedDate, setExpectedDate] = useState<string>(o.expectedDate ?? (supplier?.leadTimeDays != null ? addDays(today(), supplier.leadTimeDays) : ""));
  const [loadingCosts, startCosts] = useTransition();
  const totals = useMemo(() => computeOrderTotals({ items, headerDiscount, freight, otherExpenses: other }), [items, headerDiscount, freight, other]);
  const term = terms.find((t) => t.value === termId) ?? null;
  let plan: Array<{ number: number; days: number; amount: number }> = [];
  let planError: string | null = null;
  try {
    plan = buildInstallmentPlan(totals.total, term, customDays);
  } catch (e: any) {
    planError = e.message;
  }
  const setItem = (i: number, patch: Partial<FormItem>) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const changeSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find((x) => x.value === id);
    if (!o.id) {
      if (s?.paymentTermId) setTermId(s.paymentTermId);
      if (s?.leadTimeDays != null) setExpectedDate(addDays(today(), s.leadTimeDays));
    }
    if (id && items.length)
      startCosts(async () => {
        const r = await supplierCostsAction(id, items.map((i) => i.skuId));
        if (!r.ok) return toast("error", r.error);
        const map = r.data ?? {};
        setItems((a) => a.map((x) => (map[x.skuId] ? { ...x, unitCost: map[x.skuId].lastCost ?? x.unitCost, supplierCode: map[x.skuId].supplierCode } : { ...x, supplierCode: null })));
        toast("info", "Custos sugeridos atualizados a partir do último custo deste fornecedor.");
      });
  };
  const belowMin = supplier && supplier.minOrderValue > 0 && totals.subtotal - totals.discountTotal < supplier.minOrderValue;
  return (
    <ActionForm action={saveOrderAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {o.id && <input type="hidden" name="id" value={o.id} />}
          <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitCost: i.unitCost, discount: i.discount, description: i.name, unitCode: i.unitCode, supplierCode: i.supplierCode })))} />
          <input type="hidden" name="supplierId" value={supplierId} />
          <input type="hidden" name="headerDiscount" value={headerDiscount} />
          <input type="hidden" name="freight" value={freight} />
          <input type="hidden" name="otherExpenses" value={other} />
          {revising && (
            <Notice tone="warn" title="Alteração após aprovação gera revisão">
              A versão atual será preservada em Revisões. Regra da política: {revisionMode === "always" ? "toda alteração volta para análise" : revisionMode === "never" ? "revisões não exigem nova análise" : "alterações relevantes (aumento de total, quantidade, custo, novo item ou condição de pagamento) voltam para análise"}. O fornecedor não pode ser trocado.
            </Notice>
          )}
          <FormSection title="Fornecedor e entrega">
            <FormGrid cols={4}>
              <Field label="Fornecedor" required className="sm:col-span-2">
                <Select value={supplierId} disabled={revising} onChange={(e) => changeSupplier(e.target.value)} options={suppliers} placeholder="Selecione…" aria-label="Fornecedor" />
              </Field>
              <Field label="Depósito de entrega (filial atual)" required>
                <Select name="warehouseId" defaultValue={o.warehouseId ?? warehouses[0]?.value ?? ""} options={warehouses} aria-label="Depósito de entrega" />
              </Field>
              <Field label="Previsão de entrega" hint={supplier?.leadTimeDays != null ? `Prazo do fornecedor: ${supplier.leadTimeDays} dias` : undefined}>
                <Input type="date" name="expectedDate" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Produtos" description="O custo é sugerido pelo último custo do fornecedor (cadastro de produtos fornecidos). Quantidades na unidade interna do produto.">
            <SkuPicker supplierId={supplierId || null} exclude={items.map((i) => i.skuId)} onPick={(h) => setItems((a) => [...a, { skuId: h.id, sku: h.sku, name: h.name, unitCode: h.unitCode, supplierCode: h.supplierCode, qty: Math.max(1000, h.minQty ?? 1000), unitCost: h.lastCost ?? h.costAcquisition ?? 0, discount: 0 }])} />
            {loadingCosts && <p className="mt-2 text-xs text-slate-500">Atualizando custos do fornecedor…</p>}
            {items.length === 0 ? (
              <p className="mt-4 rounded-md border border-dashed border-line p-6 text-center text-sm text-slate-500">Nenhum produto. Pesquise acima para incluir.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Un.</th>
                      <th className="w-28 text-right">Quantidade</th>
                      <th className="w-36 text-right">Custo unitário</th>
                      <th className="w-32 text-right">Desconto (R$)</th>
                      <th className="text-right">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const line = totals.items[i];
                      return (
                        <tr key={it.skuId}>
                          <td>
                            {it.name}
                            <span className="block text-xs text-slate-500">{it.sku}{it.supplierCode ? ` · cód. fornecedor ${it.supplierCode}` : ""}</span>
                          </td>
                          <td>{it.unitCode}</td>
                          <td><QtyInput value={it.qty} onChange={(v) => setItem(i, { qty: v })} ariaLabel={`Quantidade de ${it.name}`} /></td>
                          <td><MoneyInput value={it.unitCost} onChange={(v) => setItem(i, { unitCost: v })} ariaLabel={`Custo unitário de ${it.name}`} /></td>
                          <td><MoneyInput value={it.discount} onChange={(v) => setItem(i, { discount: v })} ariaLabel={`Desconto de ${it.name}`} /></td>
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
              </div>
            )}
          </FormSection>

          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <FormSection title="Pagamento e observações">
              <FormGrid cols={2}>
                <Field label="Condição de pagamento">
                  <Select name="paymentTermId" value={termId} onChange={(e) => setTermId(e.target.value)} options={terms} placeholder="—" aria-label="Condição de pagamento" />
                </Field>
                <Field label="Ou prazos personalizados (dias)" hint="Ex.: 30/60/90 — substitui a condição." error={planError}>
                  <Input name="customDays" value={customDays} onChange={(e) => setCustomDays(e.target.value)} placeholder="30/60/90" />
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
              <Field label="Observação para o fornecedor" className="mt-4">
                <Textarea name="notes" defaultValue={o.notes ?? ""} />
              </Field>
              {revising && (
                <Field label="Motivo da revisão" required className="mt-4">
                  <Input name="revisionReason" required placeholder="Ex.: fornecedor reajustou o preço do item X" />
                </Field>
              )}
            </FormSection>
            <FormSection title="Total detalhado">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt>Produtos (bruto)</dt><dd className="tabular">{formatMoney(totals.subtotal)}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>Descontos nos itens</dt><dd className="tabular">− {formatMoney(totals.itemDiscounts)}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt>Desconto no pedido</dt><dd className="w-36"><MoneyInput value={headerDiscount} onChange={setHeaderDiscount} ariaLabel="Desconto no pedido" /></dd></div>
                <div className="flex items-center justify-between gap-3"><dt>Frete</dt><dd className="w-36"><MoneyInput value={freight} onChange={setFreight} ariaLabel="Frete" /></dd></div>
                <div className="flex items-center justify-between gap-3"><dt>Outras despesas</dt><dd className="w-36"><MoneyInput value={other} onChange={setOther} ariaLabel="Outras despesas" /></dd></div>
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total do pedido</dt><dd className="tabular">{formatMoney(totals.total)}</dd></div>
              </dl>
              {belowMin && <p className="mt-3 text-xs text-amber-700">Produtos abaixo do pedido mínimo do fornecedor ({formatMoney(supplier!.minOrderValue)}).</p>}
              {expectedDate && <p className="mt-2 text-xs text-slate-500">Previsão de entrega: {formatDate(expectedDate)}</p>}
            </FormSection>
          </div>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            {revising ? (
              <SubmitButton pending={pending} name="intent" value="revision">
                Salvar revisão
              </SubmitButton>
            ) : (
              <>
                <SubmitButton pending={pending} variant="secondary" name="intent" value="draft">
                  Salvar rascunho
                </SubmitButton>
                <SubmitButton pending={pending} name="intent" value="submit">
                  Salvar e enviar para análise
                </SubmitButton>
              </>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}
