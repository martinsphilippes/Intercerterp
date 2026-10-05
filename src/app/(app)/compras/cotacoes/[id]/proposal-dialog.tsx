"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, FormGrid } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { formatQty } from "@/lib/money";
import { saveProposalAction } from "../actions";

export interface PItem {
  skuId: string;
  name: string;
  sku: string;
  qty: number;
  unitCode: string;
}

export function ProposalDialog({ quotationId, supplier, items, proposal, terms, defaultOpen }: { quotationId: string; supplier: { id: string; name: string; leadTimeDays: number | null; minOrderValue: number; paymentTermId: string | null }; items: PItem[]; proposal: Record<string, any> | null; terms: Array<{ value: string; label: string }>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const init = (skuId: string) => (proposal?.items ?? []).find((x: any) => x.skuId === skuId) ?? null;
  const [rows, setRows] = useState(
    items.map((i) => {
      const p = init(i.skuId);
      return { skuId: i.skuId, quoted: Boolean(p), unitPrice: p?.unitPrice ?? 0, discountPct: p ? String((p.discountBps ?? 0) / 100).replace(".", ",") : "0", available: p ? p.available !== false : true, partial: p?.availableQty != null, availableQty: p?.availableQty ?? i.qty, leadTimeDays: p?.leadTimeDays != null ? String(p.leadTimeDays) : "", deliveryDate: p?.deliveryDate ?? "" };
    }),
  );
  const [freight, setFreight] = useState<number>(proposal?.freight ?? 0);
  const [minOrder, setMinOrder] = useState<number>(proposal?.minOrderValue ?? supplier.minOrderValue ?? 0);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const payload = rows
    .filter((r) => r.quoted && r.unitPrice > 0)
    .map((r) => ({ skuId: r.skuId, unitPrice: r.unitPrice, discountBps: Math.round(Number(r.discountPct.replace(",", ".") || 0) * 100), available: r.available, availableQty: r.available && r.partial ? r.availableQty : r.available ? null : 0, leadTimeDays: r.leadTimeDays === "" ? null : Number(r.leadTimeDays), deliveryDate: r.deliveryDate || null }));
  return (
    <>
      <Button size="sm" variant={proposal ? "ghost" : "primary"} onClick={() => setOpen(true)}>{proposal ? <><Pencil className="size-4" /> Editar proposta</> : <><Plus className="size-4" /> Registrar proposta</>}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Proposta — ${supplier.name}`} size="xl">
        <ActionForm action={saveProposalAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="quotationId" value={quotationId} />
              <input type="hidden" name="supplierId" value={supplier.id} />
              <input type="hidden" name="items" value={JSON.stringify(payload)} />
              <input type="hidden" name="freight" value={freight} />
              <input type="hidden" name="minOrderValue" value={minOrder} />
              <FormGrid cols={3}>
                <Field label="Frete (cobrado uma vez)"><MoneyInput value={freight} onChange={setFreight} ariaLabel="Frete" /></Field>
                <Field label="Pedido mínimo"><MoneyInput value={minOrder} onChange={setMinOrder} ariaLabel="Pedido mínimo" /></Field>
                <Field label="Válida até" required><Input type="date" name="validUntil" defaultValue={proposal?.validUntil ?? ""} required /></Field>
                <Field label="Prazo de entrega (dias)"><Input type="number" min={0} name="leadTimeDays" defaultValue={proposal?.leadTimeDays ?? supplier.leadTimeDays ?? ""} /></Field>
                <Field label="Condição de pagamento"><Select name="paymentTermId" defaultValue={proposal?.paymentTermId ?? supplier.paymentTermId ?? ""} options={terms} placeholder="—" /></Field>
                <Field label="Condição (texto)" hint="Ex.: 28 dias, boleto"><Input name="paymentTermsText" defaultValue={proposal?.paymentTermsText ?? ""} /></Field>
              </FormGrid>
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead><tr><th>Cotado</th><th>Produto</th><th className="w-32 text-right">Preço unit.</th><th className="w-20 text-right">Desc. %</th><th>Disponibilidade</th><th className="w-20">Prazo (d)</th><th className="w-36">Entrega</th></tr></thead>
                  <tbody>
                    {items.map((it, i) => {
                      const r = rows[i];
                      return (
                        <tr key={it.skuId} className={r.quoted ? undefined : "opacity-60"}>
                          <td><input type="checkbox" aria-label={`Cotou ${it.name}`} className="accent-brand-700" checked={r.quoted} onChange={(e) => set(i, { quoted: e.target.checked })} /></td>
                          <td>{it.name}<span className="block text-xs text-slate-500">{it.sku} · {formatQty(it.qty, it.unitCode)}</span></td>
                          <td><MoneyInput value={r.unitPrice} onChange={(v) => set(i, { unitPrice: v, quoted: v > 0 || r.quoted })} ariaLabel={`Preço de ${it.name}`} /></td>
                          <td><Input aria-label="Desconto %" inputMode="decimal" value={r.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} className="text-right" /></td>
                          <td className="text-xs">
                            <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-700" checked={r.available} onChange={(e) => set(i, { available: e.target.checked })} /> disponível</label>
                            {r.available && <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-700" checked={r.partial} onChange={(e) => set(i, { partial: e.target.checked })} /> parcial:</label>}
                            {r.available && r.partial && <QtyInput value={r.availableQty} onChange={(v) => set(i, { availableQty: v })} ariaLabel="Quantidade disponível" className="mt-1 h-7 text-xs" />}
                          </td>
                          <td><Input aria-label="Prazo do item" type="number" min={0} value={r.leadTimeDays} onChange={(e) => set(i, { leadTimeDays: e.target.value })} /></td>
                          <td><Input aria-label="Data de entrega" type="date" value={r.deliveryDate} onChange={(e) => set(i, { deliveryDate: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Field label="Observações"><Textarea name="notes" rows={2} defaultValue={proposal?.notes ?? ""} /></Field>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>Salvar proposta</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
