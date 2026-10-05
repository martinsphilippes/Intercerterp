"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea, FormGrid, FormSection } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { addDays, today } from "@/lib/dates";
import { SkuPicker } from "../_shared/sku-picker";
import { saveQuotationAction } from "./actions";

export interface QItem {
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  qty: number;
  neededBy: string;
}

export function QuotationForm({ quotation, items: initial, suppliers, linked }: { quotation?: Record<string, any> | null; items?: QItem[]; suppliers: Array<{ value: string; label: string }>; linked?: Record<string, string[]> }) {
  const q = quotation ?? {};
  const [items, setItems] = useState<QItem[]>(initial ?? []);
  const [supplierIds, setSupplierIds] = useState<string[]>(q.supplierIds ?? []);
  const [links, setLinks] = useState<Record<string, string[]>>(linked ?? {});
  const suggested = new Set(items.flatMap((i) => links[i.skuId] ?? []));
  const setItem = (i: number, patch: Partial<QItem>) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <ActionForm action={saveQuotationAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {q.id && <input type="hidden" name="id" value={q.id} />}
          <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ skuId: i.skuId, qty: i.qty, neededBy: i.neededBy || null })))} />
          <input type="hidden" name="supplierIds" value={JSON.stringify(supplierIds)} />
          {q.origin && <input type="hidden" name="origin" value={q.origin} />}
          <FormSection title="Cotação">
            <FormGrid cols={3}>
              <Field label="Título" className="sm:col-span-2"><Input name="title" defaultValue={q.title ?? ""} placeholder="Ex.: reposição de acessórios — outubro" /></Field>
              <Field label="Respostas até"><Input type="date" name="responseDue" defaultValue={q.responseDue ?? addDays(today(), 3)} /></Field>
            </FormGrid>
            <Field label="Observações" className="mt-4"><Textarea name="notes" defaultValue={q.notes ?? ""} rows={2} /></Field>
          </FormSection>
          <FormSection title="Produtos e demanda" description="Quantidade demandada e data necessária (entrega até) por produto.">
            <SkuPicker exclude={items.map((i) => i.skuId)} onPick={(h) => { setItems((a) => [...a, { skuId: h.id, sku: h.sku, name: h.name, unitCode: h.unitCode, qty: Math.max(1000, h.minQty ?? 1000), neededBy: addDays(today(), 15) }]); if ((h as any).supplierIds) setLinks((l) => ({ ...l, [h.id]: (h as any).supplierIds })); }} />
            {items.length > 0 && (
              <table className="table-base mt-4 w-full text-sm">
                <thead><tr><th>Produto</th><th className="w-32 text-right">Quantidade</th><th className="w-44">Necessário até</th><th /></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.skuId}>
                      <td>{it.name}<span className="block text-xs text-slate-500">{it.sku} · {it.unitCode}</span></td>
                      <td><QtyInput value={it.qty} onChange={(v) => setItem(i, { qty: v })} ariaLabel={`Quantidade de ${it.name}`} /></td>
                      <td><Input type="date" value={it.neededBy} onChange={(e) => setItem(i, { neededBy: e.target.value })} aria-label="Necessário até" /></td>
                      <td className="text-right"><Button type="button" variant="ghost" size="sm" aria-label={`Remover ${it.name}`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </FormSection>
          <FormSection title="Fornecedores convidados" description="Fornecedores bloqueados, inativos ou com documentação pendente não aparecem.">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s) => (
                <label key={s.value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-brand-700" checked={supplierIds.includes(s.value)} onChange={(e) => setSupplierIds((a) => (e.target.checked ? [...a, s.value] : a.filter((x) => x !== s.value)))} />
                  {s.label}
                  {suggested.has(s.value) && <span className="text-xs text-emerald-700">fornece itens</span>}
                </label>
              ))}
            </div>
          </FormSection>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <SubmitButton pending={pending} variant="accent">{q.id ? "Salvar cotação" : "Criar cotação"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
