"use client";

import { useMemo, useState } from "react";
import { CheckCheck, MessageSquare } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty, lineTotal } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SkuPicker } from "../../_shared/sku-picker";
import { saveReceiptAction } from "../actions";

type Opt = { value: string; label: string };

export interface ConfItem {
  idx: number;
  cProd: string | null;
  xProd: string | null;
  uCom: string | null;
  invoicedQtySupplier: number | null;
  conversionFactor: number;
  invoicedQty: number;
  invoicedValue: number;
  invoiceUnitCost: number;
  skuId: string | null;
  sku: string | null;
  description: string;
  unitCode: string | null;
  mapping: string | null;
  expectedQty: number;
  orderUnitCost: number | null;
  receivedQty: number;
  unitCost: number;
  ignore: boolean;
  divergence: string | null;
  checked: boolean;
  lot: string | null;
  expiry: string | null;
  status: string;
  /** valor da linha calculado no servidor na última gravação (valor exato da linha do pedido, sem arredondar pelo custo unitário) */
  lineValue?: number | null;
}

export interface ConfProps {
  receipt: {
    id: string;
    hasXml: boolean;
    /** sem XML: encargos (frete, seguro, outras, IPI, desconto geral) calculados pelo pedido (true) ou informados (false) */
    chargesAuto?: boolean | null;
    /** sem XML: encargos de pedidos já cobrados em outro recebimento (detectado na conclusão) */
    chargesLost?: Array<{ orderNumber: number | null; receiptNumber: number | null }>;
    chargesLostAck?: boolean;
    supplierId: string;
    warehouseId: string;
    orderIds: string[];
    freight: number;
    otherExpenses: number;
    discount: number;
    invoicedTotal: number | null;
    paymentTermId: string | null;
    paymentMethodId: string | null;
    entryCfop: string | null;
    categoryId: string | null;
    costCenterId: string | null;
    differenceAction: string;
    notes: string | null;
    effects: { updateStock: boolean; updateCost: boolean; createPayable: boolean };
    hasDuplicatas: boolean;
  };
  items: ConfItem[];
  orders: Array<{ id: string; number: number; status: string; expectedDate: string | null }>;
  orderSkus: Array<{ skuId: string; label: string }>;
  warehouses: Opt[];
  terms: Opt[];
  methods: Opt[];
  categories: Opt[];
  costCenters: Opt[];
  blockers: string[];
}

export function Conference({ receipt: r, items: initial, orders, orderSkus, warehouses, terms, methods, categories, costCenters, blockers }: ConfProps) {
  const [items, setItems] = useState<ConfItem[]>(initial);
  const [orderIds, setOrderIds] = useState<string[]>(r.orderIds);
  const [freight, setFreight] = useState(r.freight);
  const [other, setOther] = useState(r.otherExpenses);
  const [discount, setDiscount] = useState(r.discount);
  const [invoiced, setInvoiced] = useState<number>(r.invoicedTotal ?? 0);
  const [effects, setEffects] = useState(r.effects);
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const set = (idx: number, patch: Partial<ConfItem>) => {
    setDirty(true);
    setItems((a) => a.map((x) => (x.idx === idx ? { ...x, ...patch } : x)));
  };
  const saved = useMemo(() => new Map(initial.map((i) => [i.idx, i])), [initial]);
  const lineValue = (it: ConfItem) => {
    if (it.ignore || !it.skuId || !it.receivedQty) return 0;
    // item sem alteração desde a gravação: usa o valor calculado no servidor (exato pelo pedido)
    const s0 = saved.get(it.idx);
    if (s0 && s0.lineValue != null && !s0.ignore && s0.skuId === it.skuId && s0.receivedQty === it.receivedQty && s0.unitCost === it.unitCost) return s0.lineValue;
    return it.receivedQty === it.invoicedQty && it.unitCost === it.invoiceUnitCost && it.invoicedValue > 0 ? it.invoicedValue : lineTotal(it.unitCost, it.receivedQty);
  };
  const products = items.reduce((a, it) => a + lineValue(it), 0);
  const due = products - Math.min(discount, products) + freight + other;
  const active = items.filter((i) => !i.ignore);
  const checked = active.filter((i) => i.checked).length;
  const units = active.reduce((a, i) => a + i.receivedQty, 0);
  const payload = JSON.stringify(items.map((i) => ({ idx: i.idx, skuId: i.skuId, receivedQty: i.receivedQty, unitCost: i.unitCost, conversionFactor: i.conversionFactor, divergence: i.divergence ?? "", ignore: i.ignore, checked: i.checked, lot: i.lot ?? "", expiry: i.expiry ?? "" })));
  return (
    <ActionForm action={saveReceiptAction} onSuccess={() => setDirty(false)} className="space-y-5">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="items" value={payload} />
          <input type="hidden" name="orderIdsJson" value={JSON.stringify(orderIds)} />
          <input type="hidden" name="freight" value={freight} />
          <input type="hidden" name="otherExpenses" value={other} />
          <input type="hidden" name="discount" value={discount} />
          {/* valores exibidos ao carregar: só a alteração em relação a eles desliga o cálculo dos encargos pelo pedido */}
          <input type="hidden" name="freightShown" value={r.freight} />
          <input type="hidden" name="otherExpensesShown" value={r.otherExpenses} />
          <input type="hidden" name="discountShown" value={r.discount} />
          {!r.hasXml && <input type="hidden" name="invoicedTotal" value={invoiced} />}
          <input type="hidden" name="effects" value={JSON.stringify(effects)} />
          <FormSection
            title="Conferência dos produtos"
            description={`${formatQty(units)} unidades em ${active.length} item(ns) · ${checked} de ${active.length} conferido(s). Legenda: Confere · Divergência · Pendente.`}
            actions={<span onClickCapture={() => setItems((a) => a.map((x) => (x.ignore ? x : { ...x, checked: true })))}><SubmitButton pending={pending} variant="secondary" size="sm" name="intent" value="checkAll"><CheckCheck className="size-4" /> Marcar todos como conferidos</SubmitButton></span>}
          >
            <div className="-mx-5 overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Produto (NF-e → interno)</th>
                    <th className="text-right">Pedido</th>
                    <th className="text-right">NF-e</th>
                    <th className="w-24 text-right">Recebido</th>
                    <th className="text-right">Diferença</th>
                    <th className="w-32 text-right">Custo unit.</th>
                    <th className="w-36">Lote / validade</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const diff = it.receivedQty - it.invoicedQty;
                    return (
                      <tr key={it.idx} className={cn(it.ignore && "opacity-60")}>
                        <td className="min-w-[260px]">
                          {r.hasXml && <span className="block text-xs text-slate-500">{it.cProd} · {it.xProd} · {formatQty(it.invoicedQtySupplier ?? 0)} {it.uCom}</span>}
                          {it.skuId ? (
                            <span className="flex items-center gap-2">
                              <span className="font-medium">{it.description}</span>
                              <span className="text-xs text-slate-500">{it.sku}</span>
                              {it.mapping && <Badge tone={it.mapping === "manual" ? "warn" : "neutral"} title="Como o item foi associado">{it.mapping === "supplier_code" ? "cód. fornecedor" : it.mapping === "barcode" ? "cód. barras" : it.mapping === "order" ? "pedido" : "manual"}</Badge>}
                              <button type="button" className="text-xs text-brand-700 underline" onClick={() => set(it.idx, { skuId: null, sku: null, mapping: null })}>trocar</button>
                            </span>
                          ) : (
                            <div className="mt-1 space-y-1">
                              {orderSkus.length > 0 && (
                                <Select aria-label="Associar a produto do pedido" value="" onChange={(e) => { const o = orderSkus.find((x) => x.skuId === e.target.value); if (o) set(it.idx, { skuId: o.skuId, sku: null, description: o.label, mapping: "manual" }); }} options={orderSkus.map((o) => ({ value: o.skuId, label: o.label }))} placeholder="Associar a item do pedido…" />
                              )}
                              <SkuPicker supplierId={r.supplierId} placeholder="…ou pesquisar produto interno" onPick={(h) => set(it.idx, { skuId: h.id, sku: h.sku, description: h.name, unitCode: h.unitCode, mapping: "manual" })} />
                            </div>
                          )}
                          {r.hasXml && it.invoicedQtySupplier != null && (
                            <label className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                              Conversão 1 {it.uCom} =
                              <span className="w-20"><QtyInput value={it.conversionFactor} onChange={(v) => { if (v > 0) { const inv = Math.round(((it.invoicedQtySupplier ?? 0) * v) / 1000); const unit = inv > 0 ? Math.round((it.invoicedValue * 1000) / inv) : 0; set(it.idx, { conversionFactor: v, invoicedQty: inv, receivedQty: inv, invoiceUnitCost: unit, unitCost: unit }); } }} ariaLabel="Fator de conversão" className="h-7 text-xs" /></span>
                              {it.unitCode ?? "un."}
                            </label>
                          )}
                        </td>
                        <td className="tabular text-right">{it.expectedQty ? formatQty(it.expectedQty) : <span className="text-slate-400">—</span>}{it.orderUnitCost != null && <span className="block text-xs text-slate-500">{formatMoney(it.orderUnitCost)}</span>}</td>
                        <td className="tabular text-right">{formatQty(it.invoicedQty)}<span className="block text-xs text-slate-500">{formatMoney(it.invoiceUnitCost)}</span></td>
                        <td><QtyInput value={it.receivedQty} onChange={(v) => set(it.idx, { receivedQty: v })} ariaLabel={`Recebido de ${it.description}`} min={0} /></td>
                        <td className={cn("tabular text-right font-medium", diff === 0 ? "text-emerald-700" : "text-red-700")}>{diff > 0 ? "+" : ""}{formatQty(diff)}</td>
                        <td><MoneyInput value={it.unitCost} onChange={(v) => set(it.idx, { unitCost: v })} ariaLabel={`Custo de ${it.description}`} /></td>
                        <td>
                          <Input aria-label="Lote" placeholder="Lote" value={it.lot ?? ""} onChange={(e) => set(it.idx, { lot: e.target.value })} className="h-8 text-xs" />
                          <Input aria-label="Validade" type="date" value={it.expiry ?? ""} onChange={(e) => set(it.idx, { expiry: e.target.value })} className="mt-1 h-8 text-xs" />
                        </td>
                        <td>
                          <StatusBadge kind="receipt_item" status={it.status} />
                          <label className="mt-1 flex items-center gap-1 text-xs"><input type="checkbox" className="accent-brand-700" checked={it.checked} onChange={(e) => set(it.idx, { checked: e.target.checked })} /> conferido</label>
                          <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" className="accent-brand-700" checked={it.ignore} onChange={(e) => set(it.idx, { ignore: e.target.checked })} /> não estocar</label>
                        </td>
                        <td>
                          <Button type="button" size="sm" variant="ghost" aria-label="Observação do item" title={it.divergence ?? "Registrar observação/divergência do item"} onClick={() => setOpenNote(openNote === it.idx ? null : it.idx)} className={it.divergence ? "text-accent-700" : undefined}>
                            <MessageSquare className="size-4" />
                          </Button>
                          {openNote === it.idx && <Textarea aria-label="Divergência do item" rows={2} className="mt-1 w-56 text-xs" value={it.divergence ?? ""} onChange={(e) => set(it.idx, { divergence: e.target.value })} placeholder="Ex.: 2 unidades avariadas" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FormSection>

          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <FormSection title="Dados fiscais e financeiros">
              <FormGrid cols={3}>
                <Field label="CFOP de entrada">
                  <Input name="entryCfop" defaultValue={r.entryCfop ?? ""} list="cfops" onChange={() => setDirty(true)} />
                  <datalist id="cfops">
                    {[["1102", "Compra para comercialização (interna)"], ["2102", "Compra para comercialização (interestadual)"], ["1403", "Compra com ST (interna)"], ["2403", "Compra com ST (interestadual)"], ["1556", "Material de uso e consumo"], ["1910", "Bonificação/brinde"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </datalist>
                </Field>
                <Field label="Local de estoque" required>
                  <Select name="warehouseId" defaultValue={r.warehouseId} options={warehouses} onChange={() => setDirty(true)} />
                </Field>
                <Field label="Plano de contas">
                  <Select name="categoryId" defaultValue={r.categoryId ?? ""} options={categories} placeholder="—" onChange={() => setDirty(true)} />
                </Field>
                <Field label="Centro de custo">
                  <Select name="costCenterId" defaultValue={r.costCenterId ?? ""} options={costCenters} placeholder="—" onChange={() => setDirty(true)} />
                </Field>
                <Field label="Forma de pagamento">
                  <Select name="paymentMethodId" defaultValue={r.paymentMethodId ?? ""} options={methods} placeholder="—" onChange={() => setDirty(true)} />
                </Field>
                <Field label="Condição de pagamento" hint={r.hasDuplicatas ? "Duplicatas do XML têm prioridade." : undefined}>
                  <Select name="paymentTermId" defaultValue={r.paymentTermId ?? ""} options={terms} placeholder="—" onChange={() => setDirty(true)} />
                </Field>
              </FormGrid>
              {orders.length > 0 && (
                <fieldset className="mt-4">
                  <legend className="text-xs font-medium text-slate-600">Pedidos relacionados (saldo previsto)</legend>
                  <div className="mt-1 flex flex-wrap gap-4">
                    {orders.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="accent-brand-700" checked={orderIds.includes(o.id)} onChange={(e) => { setDirty(true); setOrderIds((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id))); }} />
                        nº {o.number} <span className="text-xs text-slate-500">({formatDate(o.expectedDate)})</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-600">Diferença entre faturado e devido</p>
                <div className="mt-1 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="differenceAction" value="adjust_to_due" defaultChecked={r.differenceAction !== "pay_invoiced"} onChange={() => setDirty(true)} className="accent-brand-700" /> Pagar somente o recebido (ajustar parcelas)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="differenceAction" value="pay_invoiced" defaultChecked={r.differenceAction === "pay_invoiced"} onChange={() => setDirty(true)} className="accent-brand-700" /> Pagar o valor faturado (exige justificativa)</label>
                </div>
              </div>
              <Field label="Observações da conferência / justificativas" className="mt-4">
                <Textarea name="notes" defaultValue={r.notes ?? ""} onChange={() => setDirty(true)} placeholder="Ex.: falta de 2 unidades — registrar pendência com o fornecedor." />
              </Field>
            </FormSection>

            <div className="space-y-5">
              <FormSection title="Totais e efeitos da entrada">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt>Produtos recebidos</dt><dd className="tabular">{formatMoney(products)}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Frete</dt><dd className="w-32"><MoneyInput value={freight} onChange={(v) => { setDirty(true); setFreight(v); }} ariaLabel="Frete" /></dd></div>
                  <div className="flex items-center justify-between gap-3"><dt title="Outras despesas, seguro, IPI e ST da nota">Outras despesas/IPI/ST</dt><dd className="w-32"><MoneyInput value={other} onChange={(v) => { setDirty(true); setOther(v); }} ariaLabel="Outras despesas" /></dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Desconto</dt><dd className="w-32"><MoneyInput value={discount} onChange={(v) => { setDirty(true); setDiscount(v); }} ariaLabel="Desconto" /></dd></div>
                  {!r.hasXml && r.chargesAuto != null && <p className="text-xs text-slate-500">{r.chargesAuto ? "Frete, seguro, outras despesas, IPI e desconto geral vêm do pedido, proporcionais ao recebido (recalculados ao salvar). Alterar um desses valores passa a usar o informado." : "Frete, despesas e desconto informados na conferência (não são mais recalculados pelo pedido)."}</p>}
                  {!r.hasXml && r.chargesAuto === false && (
                    <SubmitButton pending={pending} variant="secondary" size="sm" name="intent" value="recalcCharges">Recalcular encargos pelo pedido</SubmitButton>
                  )}
                  {!r.hasXml && r.chargesAuto === false && (r.chargesLost ?? []).length > 0 && (
                    <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                      <p>Frete/despesas de {(r.chargesLost ?? []).map((l) => `pedido nº ${l.orderNumber ?? "—"} (cobrados no recebimento nº ${l.receiptNumber ?? "—"})`).join(", ")} já foram cobrados.</p>
                      <input type="hidden" name="chargesLostAckShown" value="1" />
                      <label className="mt-1 flex items-center gap-2"><input type="checkbox" name="chargesLostAck" value="1" defaultChecked={Boolean(r.chargesLostAck)} onChange={() => setDirty(true)} className="accent-brand-700" /> Cobrar frete/despesas informados mesmo assim (nova cobrança do fornecedor nesta entrega — justifique em observações)</label>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Valor devido</dt><dd className="tabular">{formatMoney(due)}</dd></div>
                  {r.hasXml ? (
                    <div className="flex justify-between text-slate-600"><dt>Total da NF-e (faturado)</dt><dd className="tabular">{formatMoney(r.invoicedTotal)}</dd></div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 text-slate-600"><dt>Total faturado (informado)</dt><dd className="w-32"><MoneyInput value={invoiced} onChange={(v) => { setDirty(true); setInvoiced(v); }} ariaLabel="Total faturado" /></dd></div>
                  )}
                </dl>
                <div className="mt-4 space-y-1.5">
                  <Checkbox label="Atualizar estoque (entrada com custo médio)" checked={effects.updateStock} onChange={(e) => { setDirty(true); setEffects({ ...effects, updateStock: e.target.checked }); }} />
                  <Checkbox label="Atualizar custo dos produtos" checked={effects.updateCost} onChange={(e) => { setDirty(true); setEffects({ ...effects, updateCost: e.target.checked }); }} />
                  <Checkbox label="Gerar contas a pagar" checked={effects.createPayable} onChange={(e) => { setDirty(true); setEffects({ ...effects, createPayable: e.target.checked }); }} />
                  <p className="pl-6 text-xs text-slate-500">{r.hasXml ? "O XML fica arquivado neste recebimento (botão “XML”). O sistema não escritura o livro de entradas — envie os XMLs à contabilidade." : "Sem XML arquivado. O sistema não escritura o livro de entradas — envie o documento à contabilidade."}</p>
                  {(!effects.updateStock || !effects.updateCost || !effects.createPayable) && <p className="text-xs text-amber-700">Efeito desmarcado exige justificativa nas observações.</p>}
                </div>
              </FormSection>
              {dirty && <Notice tone="info">Há alterações não salvas — “Salvar conferência” recalcula previsto, divergências e parcelas.</Notice>}
              {!dirty && blockers.length > 0 && (
                <Notice tone="warn" title="Antes de concluir">
                  <ul className="list-disc pl-4">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </Notice>
              )}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-col gap-2">
                <SubmitButton pending={pending} variant="secondary" name="intent" value="save">Salvar conferência</SubmitButton>
                <SubmitButton pending={pending} variant="accent" size="lg" name="intent" value="confirm">Concluir entrada da NF-e</SubmitButton>
              </div>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}
