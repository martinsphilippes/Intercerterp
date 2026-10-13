"use client";

import { useState } from "react";
import { CalendarClock, CheckCircle2, CircleSlash } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { VALIDATION_MODE } from "@/domain/accounting/common";
import { approveValidationAction, rejectValidationAction, scheduleValidationAction } from "@/app/(app)/contabil/certificados/actions";

/**
 * Agendamento (ou reagendamento) da validação do titular pela equipe: `scheduleValidationAction` (id, at
 * datetime-local obrigatório no horário de Brasília, mode, notes). O escritório é avisado para orientar o titular.
 * `reschedule`: já houve agendamento (rótulo "Reagendar"); `primary`: é a ação pendente (sem agendamento válido).
 */
export function ScheduleValidationForm({ id, reschedule, primary, defaultAt, defaultMode, defaultNotes, holderName }: { id: string; reschedule: boolean; primary: boolean; defaultAt: string; defaultMode: string; defaultNotes: string; holderName: string }) {
  return (
    <ActionForm action={scheduleValidationAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <FormGrid cols={3}>
            <Field label="Data e hora da validação" required hint="Horário de Brasília. O escritório recebe o aviso para alinhar com o titular.">
              <Input type="datetime-local" name="at" required defaultValue={defaultAt} disabled={pending} />
            </Field>
            <Field label="Modalidade" required hint="Videoconferência ou presencial na AR.">
              <Select name="mode" defaultValue={VALIDATION_MODE.some((m) => m.value === defaultMode) ? defaultMode : "video"} options={VALIDATION_MODE.map((m) => ({ value: m.value, label: m.label }))} disabled={pending} />
            </Field>
            <Field label="Orientações (opcional)" hint="Ex.: documentos a apresentar, link da sala. Aparecem para o escritório.">
              <Textarea name="notes" rows={1} defaultValue={defaultNotes} placeholder={`Ex.: ${holderName} deve apresentar documento com foto e contrato social`} disabled={pending} className="min-h-9" />
            </Field>
          </FormGrid>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SubmitButton pending={pending} variant={primary ? "primary" : "secondary"}>
              <CalendarClock className="size-4" aria-hidden /> {reschedule ? "Reagendar" : "Agendar"}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Validação concluída com sucesso: diálogo com observação opcional → `approveValidationAction` (id, notes). */
export function ApproveValidationForm({ id, holderName }: { id: string; holderName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)} title="Libera a solicitação para a emissão">
        <CheckCircle2 className="size-4" aria-hidden /> Validação aprovada
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Aprovar a validação do titular" size="sm">
        <ActionForm action={approveValidationAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-slate-600">
                Confirma que a identidade e os documentos de <span className="font-medium text-ink">{holderName}</span> foram validados conforme o processo da ICP-Brasil. A solicitação fica pronta para a emissão e o escritório é avisado.
              </p>
              <Field label="Observação (opcional)" hint="Fica no histórico do protocolo.">
                <Textarea name="notes" rows={2} autoFocus disabled={pending} placeholder="Ex.: validado por videoconferência com o sócio-administrador" />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Voltar
                </Button>
                <SubmitButton pending={pending}>Aprovar validação</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Validação não concluída: diálogo com o motivo obrigatório → `rejectValidationAction` (id, reason). */
export function RejectValidationForm({ id, holderName }: { id: string; holderName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} title="Registra a pendência; a validação será reagendada">
        <CircleSlash className="size-4" aria-hidden /> Não concluída
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Validação não concluída" size="sm">
        <ActionForm action={rejectValidationAction} className="space-y-4" onSuccess={() => setOpen(false)}>
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-slate-600">
                O motivo vai ao histórico e ao escritório, que orienta <span className="font-medium text-ink">{holderName}</span>. A solicitação continua na validação até um novo agendamento.
              </p>
              <Field label="Motivo" required hint="Ex.: documento faltante, titular ausente, divergência cadastral.">
                <Textarea name="reason" rows={3} required autoFocus disabled={pending} placeholder="Descreva a pendência encontrada" />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Voltar
                </Button>
                <SubmitButton pending={pending} variant="danger">
                  Registrar pendência
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
