"use client";

import { useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { setDepartmentMemberAction } from "../actions";

type Opt = { value: string; label: string };

const ROLE_OPTIONS: Opt[] = [
  { value: "member", label: "Membro" },
  { value: "manager", label: "Gestor" },
];

/**
 * Adicionar colaborador ao departamento (botão → diálogo). Envia `setDepartmentMemberAction` com departmentId, userId e
 * role (member | manager). Quem já é membro aparece marcado: escolher de novo só altera o papel.
 */
export function MemberForm({ departmentId, departmentName, users, memberIds }: { departmentId: string; departmentName: string; users: Opt[]; memberIds: string[] }) {
  const [open, setOpen] = useState(false);
  const options = users.map((u) => (memberIds.includes(u.value) ? { ...u, label: `${u.label} (já é membro — altera o papel)` } : u));
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} title={`Adicionar colaborador ao departamento ${departmentName}`}>
        <UserPlus className="size-3.5" aria-hidden /> Adicionar membro
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Adicionar membro — ${departmentName}`} size="sm">
        <ActionForm action={setDepartmentMemberAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="departmentId" value={departmentId} />
              <Field label="Colaborador" required htmlFor={`member-user-${departmentId}`}>
                <Select id={`member-user-${departmentId}`} name="userId" required options={options} placeholder="Selecione o colaborador" autoFocus disabled={pending} />
              </Field>
              <Field label="Papel na equipe" hint="O gestor responsável pelo departamento (quem enxerga os clientes atribuídos) é definido em “Editar” do departamento." htmlFor={`member-role-${departmentId}`}>
                <Select id={`member-role-${departmentId}`} name="role" defaultValue="member" options={ROLE_OPTIONS} disabled={pending} />
              </Field>
              {users.length === 0 && <Notice tone="warn">Nenhum usuário ativo no escritório. Cadastre usuários em Administração → Usuários.</Notice>}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending}>Adicionar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Remove o colaborador do departamento (role=remove), com confirmação. As responsabilidades por cliente não mudam. */
export function RemoveMemberForm({ departmentId, departmentName, userId, userName }: { departmentId: string; departmentName: string; userId: string; userName: string }) {
  return (
    <ActionForm action={setDepartmentMemberAction} className="inline" confirm={`Remover ${userName} do departamento ${departmentName}? As responsabilidades por cliente já atribuídas a esta pessoa não mudam.`}>
      {({ pending }) => (
        <>
          <input type="hidden" name="departmentId" value={departmentId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="role" value="remove" />
          <SubmitButton pending={pending} variant="ghost" size="sm" className="text-slate-500 hover:text-red-700">
            <UserMinus className="size-3.5" aria-hidden /> Remover
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
