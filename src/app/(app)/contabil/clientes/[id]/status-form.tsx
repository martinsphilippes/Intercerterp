"use client";

import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { today } from "@/lib/dates";
import { setClientStatusAction } from "../../actions";

type Opt = { value: string; label: string };

/** Transições permitidas pelo domínio (setClientStatus): a tela só oferece o que o servidor aceita. */
const TRANSITIONS: Record<string, string[]> = {
  onboarding: ["active", "closed"],
  active: ["offboarding", "closed"],
  offboarding: ["closed", "active"],
  closed: ["active"],
};

const HINT: Record<string, string> = {
  active: "O cliente passa a ser atendido normalmente. Se ainda não houver data de início dos serviços, a data informada é registrada como início.",
  offboarding: "Fase de transição: o cliente continua visível na carteira enquanto a saída é organizada.",
  closed: "Encerra o atendimento. A data e o motivo ficam registrados no cadastro e no histórico.",
};

/**
 * Mudança de situação do cliente (botão no cabeçalho → diálogo). Envia `setClientStatusAction` com id, status, date e
 * reason (obrigatório ao encerrar). Só lista as transições válidas a partir da situação atual.
 */
export function StatusForm({ clientId, status, statusOptions, linked }: { clientId: string; status: string; statusOptions: Opt[]; linked: boolean }) {
  const [open, setOpen] = useState(false);
  const allowed = TRANSITIONS[status] ?? [];
  const options = statusOptions.filter((o) => allowed.includes(o.value));
  const [chosen, setNext] = useState<string>("");
  // a situação muda sem recarregar a página (router.refresh): a escolha anterior pode não valer mais — cai na 1ª transição válida
  const next = allowed.includes(chosen) ? chosen : (options[0]?.value ?? "");
  const closing = next === "closed";
  if (options.length === 0) return null;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} title="Mudar a situação do cliente na carteira">
        <ArrowRightLeft className="size-4" aria-hidden /> Mudar situação
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Mudar situação do cliente">
        <ActionForm action={setClientStatusAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="id" value={clientId} />
              <FormGrid cols={2}>
                <Field label="Nova situação" required hint={HINT[next]}>
                  <Select name="status" value={next} onChange={(e) => setNext(e.target.value)} options={options} autoFocus />
                </Field>
                <Field label="Data" hint="Data em que a mudança vale. Vazio = hoje.">
                  <Input type="date" name="date" defaultValue={today()} />
                </Field>
              </FormGrid>
              <Field label={closing ? "Motivo do encerramento" : "Motivo"} required={closing} hint={closing ? "Obrigatório ao encerrar; fica no histórico do cliente." : "Opcional; fica no histórico do cliente."}>
                <Textarea name="reason" rows={2} required={closing} placeholder={closing ? "Ex.: encerrou as atividades, trocou de escritório…" : ""} />
              </Field>
              {closing && linked && (
                <Notice tone="warn" title="Cliente vinculado a uma empresa do ERP">
                  Desfaça o vínculo (aba Resumo → Vínculo com o ERP) antes de encerrar: o servidor recusa o encerramento enquanto o vínculo estiver ativo.
                </Notice>
              )}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending} variant={closing ? "danger" : "primary"}>
                  {closing ? "Encerrar cliente" : "Confirmar mudança"}
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
