"use client";

import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { registerKnownCertificateAction } from "./actions";

type Opt = { value: string; label: string };

/**
 * "Registrar certificado existente": certificado emitido por outra origem (outra certificadora, escritório anterior)
 * entra na carteira para o acompanhamento de validade e renovação. Envia `registerKnownCertificateAction`
 * (clientId, productLabel, serial, issuer, validFrom, validTo, notes); a validade final é obrigatória.
 */
export function KnownCertificateForm({ clients, defaultClientId, dueSoonDays }: { clients: Opt[]; defaultClientId: string | null; /** antecedência do aviso de vencimento (CERT_DUE_SOON_DAYS) */ dueSoonDays: number }) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(defaultClientId && clients.some((c) => c.value === defaultClientId) ? defaultClientId : "");
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} title="Certificado emitido fora do Intercert: entra na carteira só para acompanhar a validade">
        <FilePlus2 className="size-4" aria-hidden /> Registrar certificado existente
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Registrar certificado existente" size="lg">
        {clients.length === 0 ? (
          <Notice tone="info">Nenhum cliente na sua carteira para registrar um certificado.</Notice>
        ) : (
          <ActionForm action={registerKnownCertificateAction} className="space-y-4" onSuccess={() => setOpen(false)}>
            {({ pending, error }) => (
              <>
                <p className="text-sm text-slate-600">Para clientes que já têm certificado de outra origem. O registro serve ao acompanhamento de validade e à renovação; o arquivo do certificado não é guardado aqui.</p>
                <Field label="Cliente" required>
                  <Select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} options={clients} placeholder="Selecione o cliente" required autoFocus disabled={pending} />
                </Field>
                <FormGrid cols={2}>
                  <Field label="Produto / descrição" hint="Ex.: e-CNPJ A1 · 12 meses. Vazio = “Certificado digital”.">
                    <Input name="productLabel" maxLength={120} placeholder="e-CNPJ A1 · 12 meses" disabled={pending} />
                  </Field>
                  <Field label="Emissor (autoridade certificadora)" hint="Quem emitiu o certificado, se souber.">
                    <Input name="issuer" maxLength={120} placeholder="Ex.: AC Certisign" disabled={pending} />
                  </Field>
                  <Field label="Número de série" hint="Opcional; ajuda a identificar o arquivo.">
                    <Input name="serial" maxLength={80} disabled={pending} />
                  </Field>
                  <div />
                  <Field label="Início da validade" hint="Opcional.">
                    <Input type="date" name="validFrom" disabled={pending} />
                  </Field>
                  <Field label="Fim da validade" required hint={`A partir dela a carteira avisa com ${dueSoonDays} dias de antecedência.`}>
                    <Input type="date" name="validTo" required disabled={pending} />
                  </Field>
                </FormGrid>
                <Field label="Observações" hint="Opcional; fica no registro do certificado.">
                  <Textarea name="notes" rows={2} maxLength={500} disabled={pending} />
                </Field>
                {error && <Notice tone="bad">{error}</Notice>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                    Cancelar
                  </Button>
                  <SubmitButton pending={pending}>Registrar certificado</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )}
      </Dialog>
    </>
  );
}
