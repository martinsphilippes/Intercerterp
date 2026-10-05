"use client";

import { useState } from "react";
import { CheckCircle2, MinusCircle, PlusCircle, ShieldAlert } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { addMovementAction } from "../actions";

const REASONS = {
  withdrawal: ["Retirada para cofre", "Depósito bancário", "Excesso de numerário no caixa", "Recolhimento pelo financeiro", "Outro"],
  supply: ["Reforço de troco", "Troco adicional do cofre", "Recebido do financeiro", "Outro"],
};

/** Nova movimentação: tipo, valor, motivo, origem/destino (conta → transferência), responsável pela conferência e observações. */
export function MovementForm({ sessionId, available, limit, accounts, users }: { sessionId: string; available: number; limit: number; accounts: Array<{ value: string; label: string }>; users: Array<{ value: string; label: string }> }) {
  const [type, setType] = useState<"withdrawal" | "supply">("withdrawal");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState(REASONS.withdrawal[0]);
  // nova chave de idempotência a cada movimento registrado (remonta o formulário)
  const [round, setRound] = useState(0);
  const needsApproval = type === "withdrawal" && limit > 0 && amount > limit;
  const over = type === "withdrawal" && amount > available;
  return (
    <ActionForm key={round} action={addMovementAction.bind(null, sessionId)} onSuccess={() => { setAmount(0); setRound((r) => r + 1); }}>
      {({ pending }) => (
        <section className="rounded-lg border border-line bg-white">
          <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Nova movimentação</h2></header>
          <div className="grid gap-3 p-4">
            <input type="hidden" name="type" value={type} />
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimentação">
              {(["supply", "withdrawal"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => { setType(t); setReason(REASONS[t][0]); }} className={cn("focus-ring flex items-center gap-2 rounded-lg border p-3 text-sm font-medium", type === t ? "border-accent-500 bg-accent-50" : "border-line hover:border-brand-300")}>
                  {t === "supply" ? <PlusCircle className="size-5 text-emerald-600" /> : <MinusCircle className="size-5 text-red-600" />}
                  {t === "supply" ? "Suprimento" : "Sangria"}
                </button>
              ))}
            </div>
            <Field label="Valor" required error={over ? `Maior que o dinheiro disponível (${formatMoney(available)})` : null} hint={type === "withdrawal" ? `Disponível em dinheiro: ${formatMoney(available)}` : undefined}>
              <MoneyInput name="amount" value={amount} onChange={setAmount} ariaLabel="Valor" required />
            </Field>
            <Field label="Motivo" required>
              <Select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS[type].map((r) => ({ value: r, label: r }))} />
            </Field>
            {reason === "Outro" && <Field label="Descreva o motivo" required><Input name="reasonOther" required maxLength={300} /></Field>}
            <Field label={type === "withdrawal" ? "Destino do numerário" : "Origem do numerário"} hint="Conta financeira gera transferência entre contas (não é despesa nem receita).">
              <Select name="accountId" defaultValue="" placeholder={type === "withdrawal" ? "Cofre da loja / guarda física" : "Numerário físico (cofre)"} options={accounts} />
            </Field>
            <Field label="Responsável pela conferência / recebimento">
              <Select name="responsibleId" defaultValue="" placeholder="— informar nome abaixo —" options={users} />
              <Input name="recipient" placeholder="Ou nome de quem recebeu/entregou (ex.: transportadora de valores)" className="mt-1" maxLength={200} />
            </Field>
            <Field label="Observações">
              <Textarea name="notes" placeholder="Informe detalhes adicionais da movimentação" maxLength={500} />
            </Field>
            {limit > 0 && <p className={cn("flex gap-2 rounded-md px-3 py-2 text-xs", needsApproval ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600")}><ShieldAlert className="size-4 shrink-0" />Sangrias acima de {formatMoney(limit)} exigem autorização adicional do gerente.</p>}
            {needsApproval && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-amber-300 p-2">
                <Input name="approvalLogin" placeholder="Login do gerente" autoComplete="off" required aria-label="Login do gerente" />
                <Input name="approvalPassword" type="password" placeholder="Senha" autoComplete="new-password" required aria-label="Senha do gerente" />
              </div>
            )}
            <button type="submit" disabled={pending || amount <= 0 || over} className={buttonClass("accent", "md", "w-full")}>
              <CheckCircle2 className="size-4" /> Registrar {type === "supply" ? "suprimento" : "sangria"}
            </button>
          </div>
        </section>
      )}
    </ActionForm>
  );
}
