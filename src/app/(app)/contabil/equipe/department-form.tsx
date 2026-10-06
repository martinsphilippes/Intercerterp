"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { saveDepartmentAction } from "../actions";

type Opt = { value: string; label: string };

export interface DepartmentData {
  id: string;
  name: string;
  kind: string;
  key: string | null;
  managerUserId: string | null;
  active: boolean;
}

/**
 * Novo departamento / edição (botão → diálogo). Envia `saveDepartmentAction` com id, name, kind, key (só na criação),
 * managerUserId e active (só na edição; na criação o servidor assume ativo).
 */
export function DepartmentForm({ department, kinds, users }: { department?: DepartmentData | null; kinds: Opt[]; users: Opt[] }) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(department);
  const pid = department?.id ?? "novo";
  /**
   * Na criação, o único índice único é o identificador (companyId + key). Quando o erro de duplicidade chega como texto
   * técnico do banco (em desenvolvimento o `isConflict` de lib/db pode não reconhecer o ConflictError do store), mostra a
   * mesma mensagem da regra em vez do jargão.
   */
  const friendly = (msg: string | null) => (msg && !editing && /duplicad|u_key|já existe/i.test(msg) ? "Já existe departamento com este identificador. Escolha outro ou deixe em branco para gerar a partir do nome." : msg);
  return (
    <>
      {editing ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} title="Editar nome, tipo, gestor ou situação do departamento">
          <Pencil className="size-3.5" aria-hidden /> Editar
        </Button>
      ) : (
        <Button type="button" variant="primary" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Novo departamento
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? `Editar departamento ${department!.name}` : "Novo departamento"}>
        <ActionForm action={saveDepartmentAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              {department && <input type="hidden" name="id" value={department.id} />}
              <FormGrid cols={2}>
                <Field label="Nome" required className="sm:col-span-2" htmlFor={`dep-name-${pid}`}>
                  <Input id={`dep-name-${pid}`} name="name" required maxLength={120} defaultValue={department?.name ?? ""} placeholder="Ex.: Departamento pessoal" autoFocus disabled={pending} />
                </Field>
                <Field label="Tipo" htmlFor={`dep-kind-${pid}`}>
                  <Select id={`dep-kind-${pid}`} name="kind" defaultValue={department?.kind ?? "custom"} options={kinds} disabled={pending} />
                </Field>
                {editing ? (
                  <Field label="Identificador" hint="Definido na criação; não muda." htmlFor={`dep-key-${pid}`}>
                    <Input id={`dep-key-${pid}`} defaultValue={department!.key ?? "—"} readOnly disabled />
                  </Field>
                ) : (
                  <Field label="Identificador" hint="Opcional: curto e sem espaços (ex.: pessoal). Vazio = gerado a partir do nome." htmlFor={`dep-key-${pid}`}>
                    <Input id={`dep-key-${pid}`} name="key" maxLength={40} placeholder="gerado do nome" disabled={pending} />
                  </Field>
                )}
                <Field label="Gestor do departamento" hint="Enxerga os clientes atribuídos ao departamento mesmo sem a permissão “Ver toda a carteira”." htmlFor={`dep-manager-${pid}`} className={editing ? undefined : "sm:col-span-2"}>
                  <Select id={`dep-manager-${pid}`} name="managerUserId" defaultValue={department?.managerUserId ?? ""} options={users} placeholder="Sem gestor" disabled={pending} />
                </Field>
                {editing && (
                  <Field label="Situação" hint="Inativo: deixa de aparecer para novas atribuições; as atribuições existentes continuam." htmlFor={`dep-active-${pid}`}>
                    <Select id={`dep-active-${pid}`} name="active" defaultValue={department!.active ? "1" : "0"} options={[{ value: "1", label: "Ativo" }, { value: "0", label: "Inativo" }]} disabled={pending} />
                  </Field>
                )}
              </FormGrid>
              {users.length === 0 && <Notice tone="warn">Nenhum usuário ativo no escritório para ser gestor. Cadastre usuários em Administração → Usuários.</Notice>}
              {error && <Notice tone="bad">{friendly(error)}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>{editing ? "Salvar departamento" : "Criar departamento"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
