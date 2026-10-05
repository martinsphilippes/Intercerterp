"use client";

import { useMemo, useState } from "react";
import { Handshake } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { renegotiateAction } from "../actions";
import { addDays, brl, dmy, lateCharges, schedule, type LateParams } from "./calc";

type Inst = { id: string; number: number; dueDate: string; balance: number };

/** Renegociação (Tela 22 — "Negociar"): parcelas em aberto → novo título com novo cronograma. */
export function RenegotiateDialog({ titleId, titleNumber, installments, late, today, disabled, disabledReason }: { titleId: string; titleNumber: number; installments: Inst[]; late: LateParams; today: string; disabled?: boolean; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(installments.map((i) => i.id));
  const chosen = installments.filter((i) => sel.includes(i.id));
  const base = chosen.reduce((a, i) => a + i.balance, 0);
  const suggested = chosen.reduce((a, i) => {
    const c = lateCharges(i.dueDate, today, i.balance, late);
    return a + c.fine + c.interest;
  }, 0);
  const [charges, setCharges] = useState(suggested);
  const [discount, setDiscount] = useState(0);
  const [count, setCount] = useState(3);
  const [first, setFirst] = useState(addDays(today, 30));
  const [interval, setIntervalDays] = useState(30);
  const total = base + charges - discount;
  const [plan, setPlan] = useState<Array<{ dueDate: string; amount: number }>>([]);
  const planned = plan.reduce((a, p) => a + p.amount, 0);
  const gen = () => setPlan(schedule(total, count, first, interval));
  const ok = chosen.length > 0 && total > 0 && plan.length > 0 && planned === total;
  const diffMsg = useMemo(() => (plan.length && planned !== total ? `As parcelas somam ${brl(planned)}; o valor renegociado é ${brl(total)}. Gere novamente ou ajuste.` : null), [plan, planned, total]);
  return (
    <>
      <Button type="button" variant="secondary" disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => (setSel(installments.map((i) => i.id)), setCharges(installments.reduce((a, i) => { const c = lateCharges(i.dueDate, today, i.balance, late); return a + c.fine + c.interest; }, 0)), setPlan([]), setOpen(true))}>
        <Handshake className="size-4" /> Negociar
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Renegociar título nº ${titleNumber}`} size="lg">
        <ActionForm action={renegotiateAction.bind(null, titleId)} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <p className="text-sm text-slate-600">As parcelas escolhidas saem do saldo deste título (sem movimento em conta) e um novo título vinculado é criado com o valor acordado.</p>
              <fieldset className="rounded-md border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-slate-600">Parcelas em aberto</legend>
                {installments.map((i) => (
                  <label key={i.id} className="flex items-center justify-between gap-3 py-1 text-sm">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" name="installmentIds" value={i.id} checked={sel.includes(i.id)} onChange={(e) => (setSel((x) => (e.target.checked ? [...x, i.id] : x.filter((y) => y !== i.id))), setPlan([]))} className="size-4 accent-brand-700" />
                      Parcela {i.number} — vence {dmy(i.dueDate)}
                    </span>
                    <span className="tabular">{brl(i.balance)}</span>
                  </label>
                ))}
              </fieldset>
              <FormGrid cols={3}>
                <Field label="Saldo renegociado">
                  <Input value={brl(base)} readOnly className="tabular text-right" />
                </Field>
                <Field label="Encargos incorporados" hint={`Sugestão por atraso: ${brl(suggested)}`}>
                  <MoneyInput name="charges" value={charges} onChange={(v) => (setCharges(v), setPlan([]))} />
                </Field>
                <Field label="Desconto concedido">
                  <MoneyInput name="discount" value={discount} onChange={(v) => (setDiscount(v), setPlan([]))} />
                </Field>
                <Field label="Nº de parcelas">
                  <Input type="number" min={1} max={60} value={count} onChange={(e) => (setCount(Number(e.target.value) || 1), setPlan([]))} />
                </Field>
                <Field label="1º vencimento">
                  <Input type="date" value={first} min={today} onChange={(e) => (setFirst(e.target.value), setPlan([]))} />
                </Field>
                <Field label="Intervalo (dias)" hint="30 = mensal">
                  <Input type="number" min={1} max={365} value={interval} onChange={(e) => (setIntervalDays(Number(e.target.value) || 30), setPlan([]))} />
                </Field>
              </FormGrid>
              <div className="flex items-center justify-between rounded-md bg-brand-50 px-4 py-2">
                <span className="text-sm text-slate-600">Valor renegociado = saldo + encargos − desconto</span>
                <span className="tabular text-lg font-semibold text-brand-800">{brl(total)}</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={gen} disabled={total <= 0 || !chosen.length}>
                Gerar novas parcelas
              </Button>
              {plan.length > 0 && (
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((pl, k) => (
                      <tr key={k}>
                        <td>{k + 1}</td>
                        <td>
                          <Input type="date" value={pl.dueDate} onChange={(e) => setPlan((x) => x.map((y, j) => (j === k ? { ...y, dueDate: e.target.value } : y)))} aria-label={`Vencimento ${k + 1}`} />
                        </td>
                        <td className="w-44">
                          <MoneyInput value={pl.amount} onChange={(v) => setPlan((x) => x.map((y, j) => (j === k ? { ...y, amount: v } : y)))} ariaLabel={`Valor ${k + 1}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <input type="hidden" name="installments" value={JSON.stringify(plan)} />
              <Field label="Condições / motivo" required>
                <Textarea name="reason" required rows={2} maxLength={300} placeholder="Ex.: acordo por telefone em 3x, cliente com dificuldade temporária" />
              </Field>
              {diffMsg && <Notice tone="warn">{diffMsg}</Notice>}
              {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                {ok ? (
                  <SubmitButton pending={pending} variant="accent">
                    Confirmar renegociação
                  </SubmitButton>
                ) : (
                  <Button type="button" variant="accent" disabled title="Gere as novas parcelas somando o valor renegociado">
                    Confirmar renegociação
                  </Button>
                )}
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
