"use client";

import { useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import type { ObligationTemplate } from "@/domain/fiscal/obligations";
import { completeObligationAction, saveObligationAction, saveTemplatesAction } from "../actions";

type Opt = { value: string; label: string };

export function CompleteObligationButton({ id, name, requiresProof, today, support }: { id: string; name: string; requiresProof: boolean; today: string; support: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-4" /> Concluir
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Concluir: ${name}`}>
        <ActionForm action={completeObligationAction.bind(null, id)} onSuccess={() => setOpen(false)} className="space-y-3">
          {({ pending, error }) => (
            <>
              <p className="text-xs text-slate-600">{support}</p>
              <FormGrid cols={2}>
                <Field label="Data de entrega/pagamento" required><Input type="date" name="deliveredAt" defaultValue={today} max={today} required /></Field>
                <Field label="Recibo / protocolo / autenticação"><Input name="receiptNumber" /></Field>
                <Field label="Valor apurado/pago (opcional)"><MoneyInput name="amount" defaultValue={0} /></Field>
                <Field label={requiresProof ? "Comprovante (obrigatório)" : "Comprovante"} required={requiresProof}><Input type="file" name="proof" accept=".pdf,.png,.jpg,.jpeg,.xml,.txt,.zip" required={requiresProof} /></Field>
              </FormGrid>
              <Field label="Observações"><Textarea name="notes" /></Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Voltar</Button>
                <SubmitButton pending={pending}>Registrar conclusão</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function NewObligationButton({ kinds, users, defaultPeriod }: { kinds: Opt[]; users: Opt[]; defaultPeriod: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Obrigação avulsa
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nova obrigação">
        <ActionForm action={saveObligationAction} onSuccess={() => setOpen(false)} className="space-y-3">
          {({ pending, error }) => (
            <>
              <FormGrid cols={2}>
                <Field label="Tipo" required><Select name="kind" options={kinds} defaultValue="other" /></Field>
                <Field label="Nome" required><Input name="name" required /></Field>
                <Field label="Competência (AAAA-MM ou AAAA)" required><Input name="period" defaultValue={defaultPeriod} required /></Field>
                <Field label="Vencimento (parâmetro)" required><Input type="date" name="dueDate" required /></Field>
                <Field label="Responsável"><Select name="responsibleId" options={users} placeholder="Perfis com emissão fiscal" /></Field>
              </FormGrid>
              <Field label="Observações"><Textarea name="notes" /></Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Voltar</Button>
                <SubmitButton pending={pending}>Salvar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function TemplatesEditor({ initial, kinds }: { initial: ObligationTemplate[]; kinds: Opt[] }) {
  const [rows, setRows] = useState<ObligationTemplate[]>(initial);
  const set = (i: number, patch: Partial<ObligationTemplate>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <ActionForm action={saveTemplatesAction} className="space-y-3">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="templates" value={JSON.stringify(rows)} />
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Nome</th><th>Tipo</th><th>Recorrência</th><th>Vencimento</th><th>Comprovante</th><th>Ativo</th><th /></tr></thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={i}>
                    <td><Input aria-label="Nome" className="min-w-[200px]" value={t.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                    <td><Select aria-label="Tipo" className="min-w-[180px]" value={t.kind} options={kinds} onChange={(e) => set(i, { kind: e.target.value })} /></td>
                    <td><Select aria-label="Recorrência" value={t.recurrence} options={[{ value: "monthly", label: "Mensal (mês seguinte à competência)" }, { value: "annual", label: "Anual (ano seguinte)" }]} onChange={(e) => set(i, { recurrence: e.target.value as ObligationTemplate["recurrence"], dueMonth: e.target.value === "annual" ? (t.dueMonth ?? 3) : undefined })} /></td>
                    <td>
                      <div className="flex items-center gap-1">
                        dia <Input aria-label="Dia" type="number" min={1} max={31} className="w-16" value={t.dueDay} onChange={(e) => set(i, { dueDay: Number(e.target.value) })} />
                        {t.recurrence === "annual" && <>mês <Input aria-label="Mês" type="number" min={1} max={12} className="w-16" value={t.dueMonth ?? 3} onChange={(e) => set(i, { dueMonth: Number(e.target.value) })} /></>}
                      </div>
                    </td>
                    <td><Checkbox label="exigir" checked={t.requiresProof} onChange={(e) => set(i, { requiresProof: e.target.checked })} /></td>
                    <td><Checkbox label="" aria-label="Ativo" checked={t.active} onChange={(e) => set(i, { active: e.target.checked })} /></td>
                    <td><Button type="button" variant="ghost" size="sm" aria-label="Remover" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => [...r, { key: `custom_${Date.now().toString(36)}`, kind: "other", name: "Nova obrigação", recurrence: "monthly", dueDay: 10, requiresProof: false, active: true }])}><Plus className="size-4" /> Modelo</Button>
            <SubmitButton pending={pending}>Salvar calendário</SubmitButton>
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
        </>
      )}
    </ActionForm>
  );
}
