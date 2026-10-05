"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { replyTicketAction, updateTicketAction } from "../actions";

type Opt = { value: string; label: string };

export function ReplyForm({ id, agent, isRequester, statuses, currentStatus }: { id: string; agent: boolean; isRequester: boolean; statuses: Opt[]; currentStatus: string }) {
  return (
    <ActionForm action={replyTicketAction.bind(null, id)} resetOnSuccess className="space-y-3">
      {({ pending, error }) => (
        <>
          <Field label={agent && !isRequester ? "Resposta ao solicitante" : "Sua mensagem"}>
            <Textarea name="body" rows={4} required minLength={2} />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Anexos" hint="Até 5 arquivos de 8 MB.">
              <input type="file" name="attachments" multiple className="text-sm" />
            </Field>
            {agent && (
              <Field label="Situação após responder">
                <Select name="status" defaultValue={isRequester ? currentStatus : "waiting"} options={statuses} />
              </Field>
            )}
            {agent && <Checkbox name="internal" label="Nota interna (não visível ao solicitante)" />}
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Enviar</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function ManageForm({ id, status, priority, assigneeId, statuses, priorities, agents }: { id: string; status: string; priority: string; assigneeId: string | null; statuses: Opt[]; priorities: Opt[]; agents: Opt[] }) {
  return (
    <ActionForm action={updateTicketAction.bind(null, id)} className="space-y-3">
      {({ pending, error }) => (
        <>
          <Field label="Situação"><Select name="status" defaultValue={status} options={statuses} /></Field>
          <Field label="Prioridade"><Select name="priority" defaultValue={priority} options={priorities} /></Field>
          <Field label="Responsável"><Select name="assigneeId" defaultValue={assigneeId ?? ""} options={agents} placeholder="Sem responsável" /></Field>
          <Field label="Motivo (opcional)"><Textarea name="reason" rows={2} /></Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending} variant="secondary">Atualizar chamado</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
