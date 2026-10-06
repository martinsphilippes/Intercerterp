"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { decideAction } from "../actions";

const LABEL: Record<string, string> = { approve: "Aprovar", adjust: "Devolver para ajuste", reject: "Rejeitar" };

/** Registrar decisão: escolha + observação/motivo (até 500) → “Revisar decisão” mostra o resumo antes de confirmar. */
export function DecisionPanel({ requestId, currentStep, revision, stepName, canDecide, reason, requiresNote, expiredBlocks, total, nextStep }: { requestId: string; currentStep: number; revision: number; stepName: string; canDecide: boolean; reason?: string | null; requiresNote: boolean; expiredBlocks: boolean; total: string; nextStep: string | null }) {
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [review, setReview] = useState(false);
  const noteRequired = decision === "adjust" || decision === "reject" || (decision === "approve" && requiresNote);
  const blocked = decision === "approve" && expiredBlocks;
  return (
    <div className="space-y-3">
      {!canDecide && reason && <Notice tone="warn">{reason}</Notice>}
      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <Field label="Decisão" required>
          <Select value={decision} onChange={(e) => setDecision(e.target.value)} disabled={!canDecide} options={[{ value: "approve", label: "Aprovar" }, { value: "adjust", label: "Devolver para ajuste" }, { value: "reject", label: "Rejeitar" }]} placeholder="Escolha uma decisão" aria-label="Decisão" />
        </Field>
        <Field label="Observação / motivo" required={noteRequired} hint={`${noteRequired ? "Obrigatório para esta decisão" : "Opcional"} · até 500 caracteres (${note.length}/500).`}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} disabled={!canDecide} placeholder="Registre o motivo da sua decisão." rows={3} />
        </Field>
      </div>
      {blocked && <Notice tone="bad">A política bloqueia a aprovação com proposta vencida. Devolva para ajuste (renovar a cotação/proposta).</Notice>}
      <div className="flex justify-end">
        <Button variant="accent" disabled={!canDecide || !decision || (noteRequired && !note.trim()) || blocked} onClick={() => setReview(true)}>Revisar decisão</Button>
      </div>
      <Dialog open={review} onClose={() => setReview(false)} title="Confirmar decisão">
        <ActionForm action={decideAction} onSuccess={() => setReview(false)} className="space-y-3">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="requestId" value={requestId} />
              {/* a decisão vale para a etapa/revisão exibida: se outra pessoa decidir antes, o servidor recusa */}
              <input type="hidden" name="step" value={currentStep} />
              <input type="hidden" name="revision" value={revision} />
              <input type="hidden" name="decision" value={decision} />
              <input type="hidden" name="note" value={note} />
              <p className="text-sm">Você vai <b>{LABEL[decision]?.toLowerCase()}</b> a etapa <b>{stepName}</b> desta solicitação ({total} com frete).</p>
              {decision === "approve" && <p className="text-sm text-slate-600">{nextStep ? `A solicitação seguirá para a etapa “${nextStep}”.` : "Esta é a última etapa: os pedidos ficam aprovados e aguardam o registro de envio ao fornecedor (não são enviados automaticamente)."}</p>}
              {decision === "adjust" && <p className="text-sm text-slate-600">Os pedidos voltam ao solicitante para ajuste; o reenvio gera nova revisão da solicitação.</p>}
              {decision === "reject" && <p className="text-sm text-slate-600">Os pedidos ficam rejeitados (a decisão pode ser revista por quem decidiu).</p>}
              {note && <blockquote className="border-l-2 border-line pl-3 text-sm text-slate-700">{note}</blockquote>}
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setReview(false)}>Voltar</Button>
                <SubmitButton pending={pending} variant={decision === "reject" ? "danger" : "primary"}>Confirmar: {LABEL[decision]}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </div>
  );
}
