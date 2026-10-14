"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { whatsappUrl } from "@/lib/whatsapp";
import { COLLECTION_TEMPLATE_KINDS, type CollectionTemplateKind } from "@/domain/collection-templates";
import { registerWhatsappCollectionAction } from "../cobranca/actions";

export interface WhatsAppCollectDraft {
  installmentId: string;
  customerName: string;
  phone: string | null;
  suggested: CollectionTemplateKind;
  messages: Record<CollectionTemplateKind, string>;
  amount: number;
  daysLate: number;
}

/**
 * “Cobrar no WhatsApp” (PLA-27): escolhe o modelo, confere/edita a mensagem e abre a conversa (wa.me) no WhatsApp do
 * operador. Ao abrir, o contato é registrado no histórico do título (quem, quando, para qual número, modelo e texto).
 */
export function WhatsAppCollectButton({ draft, label = "Cobrar no WhatsApp", title, size = "sm" }: { draft: WhatsAppCollectDraft; label?: string; title: string; size?: "sm" | "md" }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CollectionTemplateKind>(draft.suggested);
  const [text, setText] = useState(draft.messages[draft.suggested]);
  const [phone, setPhone] = useState(draft.phone ?? "");
  const url = whatsappUrl(phone, text.trim());
  const choose = (k: CollectionTemplateKind) => {
    setKind(k);
    setText(draft.messages[k]);
  };
  const register = () => {
    // a conversa abre em outra aba pelo próprio link; o registro corre em paralelo e informa o resultado
    void registerWhatsappCollectionAction(draft.installmentId, { template: kind, phone, message: text }).then((res) => {
      if (res.ok) toast("success", res.message ?? "Contato registrado.");
      else toast("error", `A conversa foi aberta, mas o contato não foi registrado: ${res.error}`);
    });
    setOpen(false);
  };
  return (
    <>
      <Button type="button" size={size} variant="ghost" onClick={() => setOpen(true)} title="Abrir o WhatsApp com a mensagem de cobrança pronta">
        <MessageCircle className="size-4" /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        size="lg"
        footer={
          <>
            <Button type="button" onClick={() => setOpen(false)}>Cancelar</Button>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" onClick={register} className={buttonClass("primary", "md")}>
                <MessageCircle className="size-4" /> Abrir no WhatsApp
              </a>
            ) : (
              <Button type="button" variant="primary" disabled title="Informe um celular com DDD e a mensagem">
                <MessageCircle className="size-4" /> Abrir no WhatsApp
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {draft.customerName} · {formatMoney(draft.amount)}
            {draft.daysLate > 0 ? ` (com multa e juros sugeridos) · ${draft.daysLate} dia(s) em atraso` : ""}
          </p>
          <div role="radiogroup" aria-label="Modelo de mensagem" className="grid gap-2 sm:grid-cols-3">
            {COLLECTION_TEMPLATE_KINDS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={kind === t.key}
                onClick={() => choose(t.key)}
                className={cn("focus-ring rounded-md border px-3 py-2 text-left text-sm", kind === t.key ? "border-brand-400 bg-brand-50 ring-1 ring-brand-300" : "border-line hover:bg-slate-50")}
                title={t.hint}
              >
                <span className="font-medium text-ink">{t.label}</span>
                {draft.suggested === t.key && <span className="block text-xs text-slate-500">sugerido</span>}
              </button>
            ))}
          </div>
          <Field label="Celular (WhatsApp)" required hint={draft.phone ? "Do cadastro do cliente; pode ser alterado só para este envio." : "Cliente sem celular no cadastro: informe com DDD."} error={phone && !whatsappUrl(phone, "x") ? "Número inválido (DDD + número)" : null}>
            <Input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98765-4321" />
          </Field>
          <Field label="Mensagem" hint="Texto do modelo já preenchido; ajuste se precisar. Os modelos são editados em Financeiro › Modelos de cobrança.">
            <Textarea rows={8} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">O envio é feito por você no WhatsApp (sem integração paga). Ao abrir a conversa, o contato fica registrado no histórico do título.</p>
        </div>
      </Dialog>
    </>
  );
}
