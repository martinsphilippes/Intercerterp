"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionButton, ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { cancelCodeAction, createPackageAction, issueCodeAction, purchasePackageAction, setPackageActiveAction } from "../vendas/actions";

type Opt = { value: string; label: string };

/** Novo pacote: itens produto × quantidade × preço unitário (centavos), vigência e destinatário opcional. */
export function PackageForm({ products, recipients, floors }: { products: Opt[]; recipients: Opt[]; floors: Record<string, number> }) {
  const [items, setItems] = useState([{ productKey: products[0]?.value ?? "", qty: 10, unitPrice: floors[products[0]?.value ?? ""] ?? 0 }]);
  const total = items.reduce((a, i) => a + (i.qty || 0) * (i.unitPrice || 0), 0);
  const set = (i: number, patch: Partial<(typeof items)[number]>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <ActionForm action={createPackageAction} className="space-y-4" resetOnSuccess>
      {({ pending }) => (
        <>
          <FormGrid cols={3}>
            <Field label="Nome do pacote" required><Input name="name" required minLength={3} maxLength={120} placeholder="Ex.: 10 e-CPF A1 — campanha" /></Field>
            <Field label="Vigência — início"><Input type="date" name="validFrom" /></Field>
            <Field label="Vigência — fim" required hint="Os vouchers comprados valem até esta data."><Input type="date" name="validTo" required /></Field>
          </FormGrid>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <Field label="Produto"><Select name={`item${i}_product`} value={it.productKey} onChange={(e) => set(i, { productKey: e.target.value })} options={products} /></Field>
                <Field label="Quantidade"><Input type="number" name={`item${i}_qty`} min={1} max={10000} value={it.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></Field>
                <Field label="Preço unitário" hint={floors[it.productKey] != null ? `mín. ${formatMoney(floors[it.productKey])} (seu custo)` : undefined}><MoneyInput name={`item${i}_price`} value={it.unitPrice} onChange={(c) => set(i, { unitPrice: c })} /></Field>
                {items.length > 1 && <Button type="button" variant="ghost" onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))} aria-label="Remover item"><Trash2 className="size-4" aria-hidden /></Button>}
              </div>
            ))}
            {items.length < 10 && <Button type="button" variant="ghost" size="sm" onClick={() => setItems((xs) => [...xs, { productKey: products[0]?.value ?? "", qty: 1, unitPrice: 0 }])}><Plus className="size-4" aria-hidden /> Item</Button>}
          </div>
          <FormGrid cols={2}>
            <Field label="Destinatário" hint="Vazio = qualquer parceiro abaixo pode comprar."><Select name="recipientNodeId" options={recipients} placeholder="Todos abaixo" /></Field>
            <Field label="Observações"><Textarea name="notes" rows={1} maxLength={500} /></Field>
          </FormGrid>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="tabular text-sm">Total do pacote: <strong>{formatMoney(total)}</strong></p>
            <SubmitButton pending={pending}>Criar pacote</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Comprar (nó de baixo) ou atribuir (quem vende o pacote, escolhendo o nó). Gera os saldos e lança no financeiro. */
export function PurchaseForm({ packageId, total, buyers, label }: { packageId: string; total: number; buyers?: Opt[]; label: string }) {
  return (
    <ActionForm action={purchasePackageAction} confirm={`${label} por ${formatMoney(total)}? O valor vai para contas a pagar do comprador e contas a receber de quem vende.`} className="flex flex-wrap items-end gap-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="packageId" value={packageId} />
          {buyers && <Select name="buyerNodeId" options={buyers} required aria-label="Parceiro comprador" placeholder="Parceiro abaixo" className="max-w-xs" />}
          <Checkbox name="generateCodes" label="Gerar códigos individuais" />
          <SubmitButton pending={pending} size="sm">{label}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function IssueCodeForm({ lotId }: { lotId: string }) {
  return (
    <ActionForm action={issueCodeAction} className="flex flex-wrap items-end gap-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="lotId" value={lotId} />
          <Checkbox name="gift" label="Presente (cliente final paga R$ 0)" defaultChecked />
          <Input name="notes" placeholder="Para quem (opcional)" className="max-w-xs" maxLength={300} />
          <SubmitButton pending={pending} size="sm" variant="secondary">Emitir código</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function CancelCodeButton({ id }: { id: string }) {
  return <ActionButton action={async (fd) => { fd.set("id", id); return cancelCodeAction(fd); }} label="Cancelar" askReason="Motivo do cancelamento do código" size="sm" variant="ghost" />;
}

export function PackageToggle({ id, active }: { id: string; active: boolean }) {
  return <ActionButton action={async (fd) => { fd.set("id", id); fd.set("active", active ? "0" : "1"); return setPackageActiveAction(fd); }} label={active ? "Encerrar vendas" : "Reabrir"} size="sm" variant="ghost" confirm={active ? "Encerrar o pacote para novas compras? Os saldos já comprados continuam valendo." : undefined} />;
}
