"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { settleCardAction } from "../actions";
import { brl, dmy } from "../_components/calc";

type Opt = { value: string; label: string };

/** Liquidação de recebível de cartão: conta bancária, valor bruto e taxa (sugerida pela venda/meio) → líquido creditado. */
export function CardSettleDialog({ row, accounts, defaultAccount, today, disabled, disabledReason }: { row: { id: string; installment: string; expectedDate: string; openGross: number; openFee: number; method: string; saleNumber: number | null }; accounts: Opt[]; defaultAccount: string; today: string; disabled?: boolean; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [gross, setGross] = useState(row.openGross);
  const [fee, setFee] = useState(row.openFee);
  return (
    <>
      <Button size="sm" variant="primary" disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => (setGross(row.openGross), setFee(row.openFee), setOpen(true))}>
        <CreditCard className="size-4" /> Liquidar
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Liquidar recebível — ${row.method}${row.saleNumber ? ` · venda nº ${row.saleNumber}` : ""} (${row.installment})`}>
        <ActionForm action={settleCardAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="installmentId" value={row.id} />
              <p className="text-sm text-slate-600">
                Previsão {dmy(row.expectedDate)} · em aberto {brl(row.openGross)} · taxa prevista {brl(row.openFee)}
              </p>
              <FormGrid cols={2}>
                <Field label="Conta bancária de crédito" required>
                  <Select name="accountId" defaultValue={defaultAccount} options={accounts} required />
                </Field>
                <Field label="Data da liquidação" required>
                  <Input type="date" name="date" defaultValue={row.expectedDate <= today ? row.expectedDate : today} max={today} required />
                </Field>
                <Field label="Valor bruto liquidado" required>
                  <MoneyInput name="gross" value={gross} onChange={setGross} />
                </Field>
                <Field label="Taxa da adquirente" hint={`Sugerida: ${brl(row.openFee)}`}>
                  <MoneyInput name="fee" value={fee} onChange={setFee} />
                </Field>
                <Field label="Referência (lote/ID da adquirente)" className="sm:col-span-2">
                  <Input name="reference" maxLength={120} />
                </Field>
              </FormGrid>
              <div className="flex items-center justify-between rounded-md bg-brand-50 px-4 py-2 text-sm">
                <span>Líquido creditado = bruto − taxa (taxa lançada separadamente, categoria tarifas)</span>
                <span className="tabular text-lg font-semibold text-brand-800">{brl(gross - fee)}</span>
              </div>
              {gross > row.openGross && <p className="text-sm text-red-700">Bruto maior que o saldo em aberto.</p>}
              {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>Confirmar liquidação</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
