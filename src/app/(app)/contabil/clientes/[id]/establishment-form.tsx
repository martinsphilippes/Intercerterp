"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { saveEstablishmentAction } from "../../actions";

/**
 * Estabelecimento (matriz/filial) do cliente PJ — botão + diálogo. Campos conforme `saveEstablishmentAction`:
 * clientId, establishmentId (edição), kind, name, cnpj, ie, im, zip/street/number/complement/district/cityName/cityCode/uf,
 * status, notes.
 */
export function EstablishmentForm({ clientId, establishment, ufs, clientDoc }: { clientId: string; establishment?: Record<string, any> | null; ufs: string[]; clientDoc: string | null }) {
  const [open, setOpen] = useState(false);
  const r = establishment ?? {};
  const a = r.address ?? {};
  const editing = Boolean(r.id);
  const root = clientDoc && clientDoc.length === 14 ? clientDoc.slice(0, 8) : null;
  return (
    <>
      {editing ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} title="Editar estabelecimento" aria-label={`Editar ${r.name ?? r.cnpj ?? "estabelecimento"}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button type="button" variant="primary" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Adicionar estabelecimento
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar estabelecimento" : "Adicionar estabelecimento"} size="lg">
        <ActionForm action={saveEstablishmentAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="clientId" value={clientId} />
              {editing && <input type="hidden" name="establishmentId" value={r.id} />}
              <FormGrid cols={4}>
                <Field label="Tipo" required>
                  <Select name="kind" defaultValue={r.kind ?? "filial"} options={[{ value: "matriz", label: "Matriz" }, { value: "filial", label: "Filial" }]} autoFocus />
                </Field>
                <Field label="Nome / identificação" className="sm:col-span-2 lg:col-span-3" hint="Ex.: Filial — Shopping Norte.">
                  <Input name="name" defaultValue={r.name ?? ""} />
                </Field>
                <Field label="CNPJ" hint={root ? `Precisa ter a mesma raiz do cliente (${root.replace(/(\d{2})(\d{3})(\d{3})/, "$1.$2.$3")}).` : "Opcional; validado quando informado."} className="sm:col-span-2">
                  <Input name="cnpj" defaultValue={r.cnpj ?? ""} inputMode="numeric" />
                </Field>
                <Field label="Inscrição estadual">
                  <Input name="ie" defaultValue={r.ie ?? ""} />
                </Field>
                <Field label="Inscrição municipal">
                  <Input name="im" defaultValue={r.im ?? ""} />
                </Field>
              </FormGrid>
              <FormGrid cols={6}>
                <Field label="CEP"><Input name="zip" defaultValue={a.zip ?? ""} inputMode="numeric" maxLength={9} /></Field>
                <Field label="Logradouro" className="sm:col-span-2 lg:col-span-3"><Input name="street" defaultValue={a.street ?? ""} /></Field>
                <Field label="Número"><Input name="number" defaultValue={a.number ?? ""} /></Field>
                <Field label="Complemento"><Input name="complement" defaultValue={a.complement ?? ""} /></Field>
                <Field label="Bairro" className="lg:col-span-2"><Input name="district" defaultValue={a.district ?? ""} /></Field>
                <Field label="Município" className="lg:col-span-2"><Input name="cityName" defaultValue={a.cityName ?? ""} /></Field>
                <Field label="UF"><Select name="uf" defaultValue={a.uf ?? ""} placeholder="—" options={ufs.map((u) => ({ value: u, label: u }))} /></Field>
                <Field label="Município (IBGE)" hint="7 dígitos."><Input name="cityCode" defaultValue={a.cityCode ?? ""} inputMode="numeric" maxLength={7} /></Field>
              </FormGrid>
              <FormGrid cols={4}>
                <Field label="Situação">
                  <Select name="status" defaultValue={r.status ?? "active"} options={[{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo (baixado)" }]} />
                </Field>
                <Field label="Observações" className="sm:col-span-2 lg:col-span-3">
                  <Textarea name="notes" rows={2} defaultValue={r.notes ?? ""} />
                </Field>
              </FormGrid>
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
