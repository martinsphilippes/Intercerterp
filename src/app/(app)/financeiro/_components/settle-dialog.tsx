"use client";

import { useMemo, useState } from "react";
import { Calculator, HandCoins } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { settleAction } from "../actions";
import { brl, dmy, lateCharges, type LateParams } from "./calc";

type Opt = { value: string; label: string };
type MethodOpt = Opt & { kind: string; accountId: string | null };

/**
 * Visão 3 (recebimento de título) / visão 4 (baixa de pagamento): principal, desconto, juros, multa, data,
 * meio, conta, referência/observação e comprovante. Encargos por atraso são sugeridos e sempre editáveis.
 */
export function SettleDialog({
  kind,
  installment,
  titleLabel,
  accounts,
  methods,
  late,
  today,
  disabled,
  disabledReason,
  size = "sm",
}: {
  kind: "receivable" | "payable";
  installment: { id: string; number: number; balance: number; dueDate: string; amount: number };
  titleLabel: string;
  accounts: Opt[];
  methods: MethodOpt[];
  late: LateParams;
  today: string;
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "md";
}) {
  const rec = kind === "receivable";
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [principal, setPrincipal] = useState(installment.balance);
  const sugg0 = rec ? lateCharges(installment.dueDate, today, installment.balance, late) : { daysLate: 0, fine: 0, interest: 0 };
  const [interest, setInterest] = useState(sugg0.interest);
  const [fine, setFine] = useState(sugg0.fine);
  const [discount, setDiscount] = useState(0);
  const [methodId, setMethodId] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.value ?? "");
  const sugg = useMemo(() => lateCharges(installment.dueDate, date || today, principal, late), [installment.dueDate, date, today, principal, late]);
  const total = principal - discount + interest + fine;
  const remaining = installment.balance - principal;
  const problems: string[] = [];
  if (principal <= 0) problems.push("Informe o principal.");
  if (principal > installment.balance) problems.push(`Principal maior que o saldo (${brl(installment.balance)}).`);
  if (discount > principal) problems.push("Desconto maior que o principal.");
  if (date > today) problems.push("Data futura não é permitida.");
  const reset = () => {
    setDate(today);
    setPrincipal(installment.balance);
    setInterest(sugg0.interest);
    setFine(sugg0.fine);
    setDiscount(0);
  };
  return (
    <>
      <Button type="button" size={size} variant="primary" disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => (reset(), setOpen(true))}>
        <HandCoins className="size-4" /> {rec ? "Receber" : "Pagar"}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${rec ? "Recebimento" : "Pagamento"} — ${titleLabel}, parcela ${installment.number}`} size="lg">
        <ActionForm action={settleAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="installmentId" value={installment.id} />
              <div className="grid grid-cols-3 gap-3 rounded-md bg-slate-50 p-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Vencimento</p>
                  <p className="font-medium">{dmy(installment.dueDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Valor da parcela</p>
                  <p className="tabular font-medium">{brl(installment.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Saldo em aberto</p>
                  <p className="tabular font-semibold text-ink">{brl(installment.balance)}</p>
                </div>
              </div>
              <FormGrid cols={3}>
                <Field label={rec ? "Data do recebimento" : "Data do pagamento"} required>
                  <Input type="date" name="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
                </Field>
                <Field label="Principal (abate o saldo)" required hint={remaining > 0 && principal > 0 ? `Baixa parcial: restará ${brl(remaining)}` : principal === installment.balance ? "Quita a parcela" : undefined}>
                  <MoneyInput name="principal" value={principal} onChange={setPrincipal} ariaLabel="Principal" />
                </Field>
                <Field label="Desconto concedido">
                  <MoneyInput name="discount" value={discount} onChange={setDiscount} ariaLabel="Desconto" />
                </Field>
                <Field label={rec ? "Juros" : "Acréscimos — juros"}>
                  <MoneyInput name="interest" value={interest} onChange={setInterest} ariaLabel="Juros" />
                </Field>
                <Field label={rec ? "Multa" : "Acréscimos — multa"}>
                  <MoneyInput name="fine" value={fine} onChange={setFine} ariaLabel="Multa" />
                </Field>
                <div className="flex flex-col justify-end">
                  {rec && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setInterest(sugg.interest);
                        setFine(sugg.fine);
                      }}
                    >
                      <Calculator className="size-4" /> Sugerir encargos
                    </Button>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {sugg.daysLate > 0
                      ? `${sugg.daysLate} dia(s) de atraso: multa ${(late.fineBps / 100).toLocaleString("pt-BR")}% (${brl(sugg.fine)}) + juros ${(late.interestMonthlyBps / 100).toLocaleString("pt-BR")}% a.m. pro rata (${brl(sugg.interest)})${late.graceDays ? `; tolerância ${late.graceDays} dia(s)` : ""}.`
                      : "Sem atraso na data informada."}
                  </p>
                </div>
                <Field label={rec ? "Forma de recebimento" : "Forma de pagamento"} required>
                  <Select
                    required
                    name="methodId"
                    value={methodId}
                    onChange={(e) => {
                      setMethodId(e.target.value);
                      const m = methods.find((x) => x.value === e.target.value);
                      if (m?.accountId) setAccountId(m.accountId);
                    }}
                    options={methods}
                    placeholder="—"
                  />
                </Field>
                <Field label={rec ? "Conta de entrada" : "Conta de saída"} required>
                  <Select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts} required />
                </Field>
                <Field label="Referência" hint="Nº do comprovante, autenticação, E2E Pix…">
                  <Input name="reference" maxLength={120} />
                </Field>
              </FormGrid>
              <Field label="Observação">
                <Textarea name="notes" rows={2} maxLength={400} />
              </Field>
              <Field label="Comprovante (PDF ou imagem, até 10 MB)">
                <input type="file" name="file" accept="application/pdf,image/*" className="text-sm" />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-100 bg-brand-50 px-4 py-3">
                <div className="text-sm text-slate-600">
                  Valor movimentado na conta = principal − desconto + juros + multa
                  <p className="tabular text-xs">
                    {brl(principal)} − {brl(discount)} + {brl(interest)} + {brl(fine)}
                  </p>
                </div>
                <p className="tabular text-xl font-semibold text-brand-800">{brl(total)}</p>
              </div>
              {problems.length > 0 && <Notice tone="warn">{problems.join(" ")}</Notice>}
              {error && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending} variant="primary">
                  Confirmar {rec ? "recebimento" : "pagamento"} de {brl(total)}
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
