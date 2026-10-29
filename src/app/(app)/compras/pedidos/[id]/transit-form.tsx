"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { today } from "@/lib/dates";
import { registerTransitAction } from "../actions";

/** §44 — registrar o pedido como "Em trânsito" (todos os campos opcionais; pode ser atualizado depois). */
export function TransitButton({ orderId, current }: { orderId: string; current: Record<string, any> | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Truck className="size-4" /> {current ? "Atualizar transporte" : "Em trânsito"}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={current ? "Atualizar dados do transporte" : "Registrar pedido em trânsito"}>
        <ActionForm action={registerTransitAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={orderId} />
              <p className="text-sm text-slate-600">O fornecedor despachou a mercadoria. O pedido continua aguardando o recebimento (que funciona normalmente); a previsão de entrega do transporte passa a valer para o alerta de atraso.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Data de despacho">
                  <Input name="shippedDate" type="date" defaultValue={current?.shippedDate ?? today()} max={today()} />
                </Field>
                <Field label="Previsão de entrega">
                  <Input name="eta" type="date" defaultValue={current?.eta ?? ""} />
                </Field>
                <Field label="Transportadora">
                  <Input name="carrier" defaultValue={current?.carrier ?? ""} maxLength={120} placeholder="Ex.: Correios, Jadlog, frota do fornecedor" />
                </Field>
                <Field label="Código de rastreio">
                  <Input name="tracking" defaultValue={current?.tracking ?? ""} maxLength={120} />
                </Field>
              </div>
              <Field label="Observação">
                <Textarea name="notes" rows={2} defaultValue={current?.notes ?? ""} maxLength={500} />
              </Field>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>{current ? "Salvar" : "Registrar em trânsito"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
