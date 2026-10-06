"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, Checkbox, FormGrid } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { PEOPLE_KIND } from "@/domain/accounting/common";
import { savePersonAction } from "../../actions";

const pctText = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100).replace(".", ","));

/**
 * Pessoa do cliente (sócio, representante, procurador ou contato) — botão + diálogo. Os nomes dos campos batem com
 * `savePersonAction`: clientId, personId (edição), kind, name, doc, qualification, sharePct, email, phone, department,
 * isPrimary, startAt, endAt, notes.
 */
export function PersonForm({ clientId, person, personType }: { clientId: string; person?: Record<string, any> | null; personType: "PF" | "PJ" }) {
  const [open, setOpen] = useState(false);
  const r = person ?? {};
  const editing = Boolean(r.id);
  const [kind, setKind] = useState<string>(r.kind ?? (personType === "PJ" ? "partner" : "contact"));
  const partner = kind === "partner";
  return (
    <>
      {editing ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} title="Editar pessoa" aria-label={`Editar ${r.name}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button type="button" variant="primary" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Adicionar pessoa
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? `Editar ${r.name}` : "Adicionar pessoa"} size="lg">
        <ActionForm action={savePersonAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="clientId" value={clientId} />
              {editing && <input type="hidden" name="personId" value={r.id} />}
              <FormGrid cols={3}>
                <Field label="Tipo" required>
                  <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} options={PEOPLE_KIND.map((k) => ({ value: k.value, label: k.label }))} autoFocus />
                </Field>
                <Field label="Nome" required className="sm:col-span-2">
                  <Input name="name" required defaultValue={r.name ?? ""} />
                </Field>
                <Field label="CPF/CNPJ" hint="Opcional; validado quando informado.">
                  <Input name="doc" defaultValue={r.doc ?? ""} inputMode="numeric" />
                </Field>
                <Field label="Qualificação" hint="Ex.: sócio-administrador, diretor, contador." className="sm:col-span-2">
                  <Input name="qualification" defaultValue={r.qualification ?? ""} />
                </Field>
                {partner && (
                  <Field label="Participação (%)" hint="A soma dos sócios ativos não pode passar de 100%.">
                    <Input name="sharePct" inputMode="decimal" defaultValue={pctText(r.shareBps)} placeholder="Ex.: 50 ou 33,33" />
                  </Field>
                )}
                <Field label="E-mail" className={partner ? undefined : "sm:col-span-1"}>
                  <Input name="email" type="email" defaultValue={r.email ?? ""} />
                </Field>
                <Field label="Telefone / WhatsApp">
                  <Input name="phone" defaultValue={r.phone ?? ""} inputMode="tel" />
                </Field>
                <Field label="Área / departamento no cliente" hint="Ex.: financeiro, RH, diretoria.">
                  <Input name="department" defaultValue={r.department ?? ""} />
                </Field>
                <Field label="Entrada" hint={partner ? "Data de entrada na sociedade." : "Desde quando atua."}>
                  <Input type="date" name="startAt" defaultValue={r.startAt ?? ""} />
                </Field>
                <Field label="Saída" hint="Preencha quando a pessoa deixar o cliente; ela passa a contar como inativa.">
                  <Input type="date" name="endAt" defaultValue={r.endAt ?? ""} />
                </Field>
              </FormGrid>
              <Checkbox name="isPrimary" label={partner ? "Sócio principal (quem responde pela empresa)" : "Contato principal deste tipo"} defaultChecked={Boolean(r.isPrimary)} />
              <Field label="Observações">
                <Textarea name="notes" rows={2} defaultValue={r.notes ?? ""} />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>{editing ? "Salvar" : "Adicionar"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
