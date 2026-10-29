"use client";

import { useState } from "react";
import { Copy, Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { formatDate, today } from "@/lib/dates";
import { CHARGE_CHANNEL } from "@/domain/accounting/common";
import type { ActionResult } from "@/lib/server/action";
import { sendChargeAction } from "../actions";

export interface ChargeFormProps {
  id: string;
  /** cobrança vencida: o novo vencimento é obrigatório antes de reenviar */
  overdue: boolean;
  dueDate: string;
  contactEmail: string | null;
  contactPhone: string | null;
  chargeSends: number;
  chargeChannel: string | null;
  chargeTo: string | null;
  /** prévia idêntica ao texto enviado (chargeMessage do domínio, para o vencimento atual) */
  preview: { subject: string; text: string; link: string | null };
  /** padrão = ação do escritório (Tela 67); a venda da rede (§45) passa a dela */
  action?: (fd: FormData) => Promise<ActionResult<any>>;
}

const CHANNEL_HINT: Record<string, string> = {
  email: "Enviado de verdade pelo canal de e-mail do escritório; o envio fica no histórico com data, hora e destinatário.",
  whatsapp: "Você envia o texto abaixo pelo WhatsApp; o sistema registra quem enviou, quando e para quem.",
  phone: "Você passa a cobrança por telefone; o sistema registra quem fez o contato, quando e com quem.",
  other: "Você envia o texto por outro canal; o sistema registra quem enviou, quando e para quem.",
};

/**
 * Envio/reenvio da cobrança do certificado (sendChargeAction: id, channel, to, dueDate, message). A prévia é o
 * texto exato que o cliente recebe; mudar o vencimento no formulário atualiza a data na prévia (o servidor monta o
 * mesmo texto com o vencimento informado). Canais manuais trazem "Copiar texto".
 */
export function ChargeForm(p: ChargeFormProps) {
  const toast = useToast();
  const [channel, setChannel] = useState<string>(p.chargeChannel && CHARGE_CHANNEL.some((c) => c.value === p.chargeChannel) ? p.chargeChannel : p.contactEmail ? "email" : "whatsapp");
  const [due, setDue] = useState<string>(p.overdue ? today() : p.dueDate);
  const [message, setMessage] = useState("");
  const isEmail = channel === "email";
  const resend = p.chargeSends > 0;
  // prévia com o vencimento escolhido: o domínio escreve a data uma única vez no texto
  const previewText = due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due !== p.dueDate ? p.preview.text.split(formatDate(p.dueDate)).join(formatDate(due)) : p.preview.text;
  const fullText = `${p.preview.subject}\n\n${previewText}${message.trim() ? `\n\n${message.trim()}` : ""}`;
  // destinatário padrão por canal: e-mail do cadastro ou o último contato usado no mesmo canal
  const defaultTo = isEmail ? (p.chargeChannel === "email" && p.chargeTo ? p.chargeTo : (p.contactEmail ?? "")) : p.chargeChannel && p.chargeChannel !== "email" && p.chargeTo ? p.chargeTo : (p.contactPhone ?? "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      toast("success", "Texto da cobrança copiado. Cole no canal escolhido e registre o envio.");
    } catch {
      toast("error", "Não foi possível copiar automaticamente. Selecione o texto da prévia e copie.");
    }
  };

  return (
    <ActionForm action={p.action ?? sendChargeAction} className="space-y-4" onSuccess={() => setMessage("")}>
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={p.id} />
          <FormGrid cols={3}>
            <Field label="Canal" required hint={CHANNEL_HINT[channel]}>
              <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} options={CHARGE_CHANNEL.map((c) => ({ value: c.value, label: c.label }))} disabled={pending} />
            </Field>
            <Field label="Vencimento" required={p.overdue} hint={p.overdue ? `Venceu em ${formatDate(p.dueDate)}. Informe o novo vencimento (hoje ou depois).` : "Vazio = mantém o vencimento atual; uma nova data atualiza a cobrança."}>
              <Input type="date" name="dueDate" value={due} min={today()} required={p.overdue} onChange={(e) => setDue(e.target.value)} disabled={pending} />
            </Field>
            <Field label={isEmail ? "E-mail do cliente" : "Telefone ou contato"} required hint={isEmail ? "Para quem a cobrança é enviada." : "Quem recebeu a cobrança; fica no histórico."}>
              <Input key={channel} type={isEmail ? "email" : "text"} name="to" defaultValue={defaultTo} required placeholder={isEmail ? "financeiro@cliente.com.br" : "Ex.: Fernanda — (11) 99999-0000"} disabled={pending} />
            </Field>
          </FormGrid>
          <Field label="Mensagem adicional (opcional)" hint={isEmail ? "Vai ao final do e-mail." : "Entra no texto copiado para o canal manual."}>
            <Textarea name="message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: qualquer dúvida, fale com o escritório." disabled={pending} />
          </Field>

          <div className="rounded-md border border-line bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Prévia da cobrança</p>
              {!isEmail && (
                <Button type="button" variant="secondary" size="sm" onClick={copy} disabled={pending} title="Copia assunto e texto para colar no canal manual">
                  <Copy className="size-3.5" aria-hidden /> Copiar texto
                </Button>
              )}
            </div>
            <p className="mt-2 text-sm font-medium text-ink">{p.preview.subject}</p>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-700">{previewText}</pre>
            {message.trim() && <pre className="mt-2 whitespace-pre-wrap border-t border-line pt-2 font-sans text-sm text-slate-700">{message.trim()}</pre>}
            {!p.preview.link && <p className="mt-2 text-xs text-slate-500">Sem link de pagamento automático: as instruções de pagamento vão na mensagem e a equipe de certificação confirma o pagamento pela referência da transação.</p>}
          </div>

          {resend && <Notice tone="info">Reenvio da mesma cobrança, sem duplicar o valor a pagar. O histórico guarda cada envio.</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SubmitButton pending={pending}>
              <Send className="size-4" aria-hidden /> {resend ? "Reenviar cobrança" : "Enviar cobrança"}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
