"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid, FormSection } from "@/components/ui/form";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { saveGroupAction } from "../actions";

type Opt = { value: string; label: string };

export interface GroupData {
  id: string;
  name: string;
  kind: string;
  notes: string | null;
  active: boolean;
}

/**
 * Cadastro de grupo de clientes (novo e edição), exibido na própria lista de grupos. Os nomes dos campos batem com o
 * que `saveGroupAction` lê (id, name, kind, notes, active). Ao salvar, volta para a lista limpa (sem ?editar/?novo).
 */
export function GroupForm({ group, kinds, cancelHref, clientsCount = 0 }: { group?: GroupData | null; kinds: Opt[]; cancelHref: string; clientsCount?: number }) {
  const editing = Boolean(group);
  const pid = group?.id ?? "novo";
  return (
    <ActionForm action={saveGroupAction} redirectTo={cancelHref}>
      {({ pending, error }) => (
        <FormSection
          title={editing ? `Editar grupo ${group!.name}` : "Novo grupo"}
          description={
            editing
              ? `${clientsCount.toLocaleString("pt-BR")} ${clientsCount === 1 ? "cliente aponta" : "clientes apontam"} para este grupo. O grupo de cada cliente é definido no cadastro dele.`
              : "Reúna clientes do mesmo grupo econômico, dos mesmos sócios ou de um agrupamento comercial. Depois, escolha o grupo no cadastro de cada cliente."
          }
        >
          <div className="space-y-4">
            {group && <input type="hidden" name="id" value={group.id} />}
            <FormGrid cols={3}>
              <Field label="Nome" required htmlFor={`group-name-${pid}`}>
                <Input id={`group-name-${pid}`} name="name" required maxLength={200} defaultValue={group?.name ?? ""} placeholder="Ex.: Grupo Horizonte" autoFocus disabled={pending} />
              </Field>
              <Field label="Tipo" htmlFor={`group-kind-${pid}`}>
                <Select id={`group-kind-${pid}`} name="kind" defaultValue={group?.kind ?? "economic"} options={kinds} disabled={pending} />
              </Field>
              <Field label="Situação" hint="Grupos inativos deixam de aparecer para seleção no cadastro do cliente." htmlFor={`group-active-${pid}`}>
                <Select id={`group-active-${pid}`} name="active" defaultValue={group && !group.active ? "0" : "1"} options={[{ value: "1", label: "Ativo" }, { value: "0", label: "Inativo" }]} disabled={pending} />
              </Field>
              <Field label="Observações" hint="Opcional. Ex.: sócios em comum, holding, consolidação de relatórios." className="sm:col-span-2 lg:col-span-3" htmlFor={`group-notes-${pid}`}>
                <Textarea id={`group-notes-${pid}`} name="notes" rows={2} maxLength={500} defaultValue={group?.notes ?? ""} disabled={pending} />
              </Field>
            </FormGrid>
            {error && <Notice tone="bad">{error}</Notice>}
            <div className="flex flex-wrap justify-end gap-2">
              <LinkButton href={cancelHref} variant="ghost">
                Cancelar
              </LinkButton>
              <SubmitButton pending={pending}>{editing ? "Salvar grupo" : "Criar grupo"}</SubmitButton>
            </div>
          </div>
        </FormSection>
      )}
    </ActionForm>
  );
}
