"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { today } from "@/lib/dates";
import { registerSentAction } from "../actions";

/** Registrar envio do pedido ao fornecedor: manual identificado ou e-mail (resultado real do provedor). */
export function SendOrder({ orderId, supplierEmail, contacts, revision, emailConfigured }: { orderId: string; supplierEmail: string | null; contacts: string[]; revision: number; emailConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"manual" | "email">(emailConfigured && supplierEmail ? "email" : "manual");
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Send className="size-4" /> Registrar envio
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Registrar envio ao fornecedor (revisão ${revision})`}>
        <ActionForm action={registerSentAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={orderId} />
              <input type="hidden" name="method" value={method} />
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {(["email", "manual"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`rounded-md border px-3 py-2 text-left text-sm ${method === m ? "border-brand-600 bg-brand-50 text-brand-900" : "border-line hover:bg-slate-50"}`}>
                    <span className="font-medium">{m === "email" ? "Enviar por e-mail" : "Registrar envio manual"}</span>
                    <span className="block text-xs text-slate-500">{m === "email" ? "O sistema envia e só marca como enviado se o provedor aceitar." : "Canal e contato identificados (telefone, WhatsApp, portal)."}</span>
                  </button>
                ))}
              </div>
              {method === "email" ? (
                <>
                  {!emailConfigured && <Notice tone="warn">Canal de e-mail não configurado em Administração → Integrações. A tentativa será registrada como falha e o pedido continuará aprovado.</Notice>}
                  <Field label="E-mail do fornecedor" required>
                    <Input name="to" type="email" defaultValue={supplierEmail ?? ""} required />
                  </Field>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Canal" required>
                    <Input name="channel" list="send-channels" placeholder="WhatsApp, telefone, portal…" required />
                    <datalist id="send-channels">
                      {["WhatsApp", "Telefone", "Portal do fornecedor", "E-mail enviado fora do sistema", "Representante comercial"].map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </Field>
                  <Field label="Contato no fornecedor" required>
                    <Input name="contact" list="send-contacts" required />
                    <datalist id="send-contacts">{contacts.map((c) => <option key={c} value={c} />)}</datalist>
                  </Field>
                  <Field label="Data do envio">
                    <Input name="sentDate" type="date" defaultValue={today()} max={today()} />
                  </Field>
                </div>
              )}
              <Field label="Observação">
                <Textarea name="notes" rows={2} />
              </Field>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>{method === "email" ? "Enviar e-mail" : "Registrar envio"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
