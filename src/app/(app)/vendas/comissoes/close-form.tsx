"use client";

import { Lock } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/form";
import { closeCommissionAction } from "./actions";

/** Fechamento da apuração do vendedor: gera o título a pagar com o vencimento escolhido. */
export function CloseCommissionForm({ from, to, branchId, sellerId, sellerName, base, amountLabel, defaultDue }: { from: string; to: string; branchId: string | null; sellerId: string; sellerName: string; base: string; amountLabel: string; defaultDue: string }) {
  return (
    <ActionForm action={closeCommissionAction} confirm={`Fechar a comissão de ${sellerName} (${amountLabel})? Será gerado um título a pagar no Financeiro.`} className="flex flex-wrap items-end gap-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <input type="hidden" name="branchId" value={branchId ?? ""} />
          <input type="hidden" name="sellerId" value={sellerId} />
          <input type="hidden" name="base" value={base} />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Vencimento do pagamento
            <Input type="date" name="dueDate" defaultValue={defaultDue} required className="h-9" />
          </label>
          <SubmitButton pending={pending} size="sm">
            <Lock className="size-4" aria-hidden /> Fechar e gerar conta a pagar
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
