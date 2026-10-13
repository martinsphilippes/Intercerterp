"use client";

import { BadgeCheck } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { confirmPaymentAction } from "@/app/(app)/contabil/certificados/actions";

const fmtReais = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Confirmação do pagamento pela equipe de certificação: `confirmPaymentAction` (id, ref obrigatória, paidAt
 * datetime-local opcional, amount em reais opcional). A referência da transação fica no histórico do protocolo e a
 * solicitação segue para a validação do titular.
 */
export function PaymentForm({ id, amount, holderName, chargeSends }: { id: string; amount: number; holderName: string; chargeSends: number }) {
  return (
    <ActionForm action={confirmPaymentAction} className="space-y-4" confirm={`Confirmar o pagamento de ${holderName}? A solicitação segue para a validação do titular.`}>
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <FormGrid cols={3}>
            <Field label="Referência da transação" required hint="Comprovante, id do gateway ou número do Pix. Fica no histórico.">
              <Input name="ref" required autoFocus={chargeSends > 0} placeholder="Ex.: PIX E2E123…, comprovante 4521" disabled={pending} />
            </Field>
            <Field label="Pago em (opcional)" hint="Data e hora da transação no horário de Brasília. Vazio = agora.">
              <Input type="datetime-local" name="paidAt" disabled={pending} />
            </Field>
            <Field label="Valor recebido (opcional)" hint="Vazio = valor da cobrança. Informe se foi diferente.">
              <Input name="amount" inputMode="decimal" defaultValue={fmtReais(amount)} placeholder={fmtReais(amount)} pattern="\d{1,3}(\.\d{3})*(,\d{1,2})?|\d+([.,]\d{1,2})?" title="Valor em reais, ex.: 199,00 ou 1.234,56" className="tabular text-right" disabled={pending} />
            </Field>
          </FormGrid>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SubmitButton pending={pending}>
              <BadgeCheck className="size-4" aria-hidden /> Confirmar pagamento
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
