"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { assignResponsibleAction } from "../../actions";

type Opt = { value: string; label: string };

/**
 * Atribuição de responsável (aba Responsáveis). Envia `assignResponsibleAction` com clientId, departmentId (vazio = geral),
 * userId, role (titular/substituto), validFrom e validTo. Só há um titular por departamento: o anterior vira substituto.
 */
export function AssignmentForm({ clientId, departments, users }: { clientId: string; departments: Opt[]; users: Opt[] }) {
  if (users.length === 0) return <Notice tone="warn">Não há usuários ativos no escritório para atribuir. Cadastre a equipe em Administração → Usuários.</Notice>;
  return (
    <ActionForm action={assignResponsibleAction} resetOnSuccess className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="clientId" value={clientId} />
          <FormGrid cols={1}>
            <Field label="Departamento" hint="Vazio = responsável geral pelo cliente (sem departamento).">
              <Select name="departmentId" defaultValue="" placeholder="Geral (sem departamento)" options={departments} />
            </Field>
            <Field label="Responsável" required>
              <Select name="userId" required defaultValue="" placeholder="Selecione" options={users} />
            </Field>
            <Field label="Papel" required hint="Só há um titular por departamento; o anterior vira substituto.">
              <Select name="role" defaultValue="titular" options={[{ value: "titular", label: "Titular" }, { value: "substituto", label: "Substituto" }]} />
            </Field>
            <Field label="Vigência de" hint="Opcional.">
              <Input type="date" name="validFrom" />
            </Field>
            <Field label="Vigência até" hint="Opcional; a atribuição pode ser encerrada depois pela tabela.">
              <Input type="date" name="validTo" />
            </Field>
          </FormGrid>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Definir responsável</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
