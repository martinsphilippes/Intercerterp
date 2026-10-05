"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Mail, MessageCircle, Printer, RefreshCcw, ShoppingCart } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton, buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { refreshFiscalAction, sendReceiptAction } from "./actions";
import { MODEL_NAME } from "./labels";

const FISCAL_TEXT: Record<string, string> = {
  not_required: "Venda sem documento fiscal.",
  pending: "Documento pendente: falta configuração/credencial ou há dados a corrigir. A venda está concluída; o documento não foi autorizado.",
  queued: "Documento na fila de transmissão. A autorização só é exibida após o retorno do provedor.",
  processing: "Documento em processamento no provedor/SEFAZ. Consulte novamente em instantes.",
  authorized: "Documento autorizado pelo provedor.",
  rejected: "Documento rejeitado — a venda continua concluída; corrija e retransmita no módulo Fiscal.",
  denied: "Documento denegado pela SEFAZ.",
  error: "Falha de comunicação com o provedor. Nova tentativa automática agendada.",
  cancelled: "Documento cancelado.",
  discarded: "Documento descartado (não transmitido).",
  contingency: "Emitido em contingência — transmissão pendente.",
};

export interface FiscalDocInfo {
  status: string;
  message: string | null;
  documentId: string | null;
  number: number | null;
  simulated: boolean;
  series?: string | null;
  protocol?: string | null;
  authorizedAt?: string | null;
  accessKey?: string | null;
  xmlFileId?: string | null;
}

const fmtKey = (k: string) => k.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Situação fiscal separada da situação comercial; consulta real ao provedor (nunca sucesso antecipado). */
export function FiscalStatus({ saleId, model, initial, auto }: { saleId: string; model: string | null; initial: FiscalDocInfo; auto?: boolean }) {
  const [state, setState] = useState<FiscalDocInfo>(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const ran = useRef(false);
  const query = (silent = false) =>
    start(async () => {
      const res = await refreshFiscalAction(saleId);
      if (!res.ok) return toast("error", res.error);
      setState(res.data as FiscalDocInfo);
      if (!silent) toast("info", `Situação fiscal: ${FISCAL_TEXT[res.data!.status]?.split(".")[0] ?? res.data!.status}`);
      router.refresh();
    });
  useEffect(() => {
    if (auto && !ran.current && ["queued", "processing", "error"].includes(initial.status)) {
      ran.current = true;
      query(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const m = model ?? "nfce";
  const authorized = state.status === "authorized";
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="fiscal" status={state.status} />
        {state.simulated && <SimBadge />}
        {state.documentId && (
          <Link className="text-sm text-brand-700 hover:underline" href={`/fiscal/${m}/${state.documentId}`}>
            {MODEL_NAME[m] ?? m} {state.number ? `nº ${String(state.number).padStart(9, "0")}` : "(sem número)"}{state.series ? ` • Série ${state.series}` : ""}
          </Link>
        )}
        {pending && <Badge tone="info">consultando…</Badge>}
      </div>
      <p className="text-sm text-slate-600">{FISCAL_TEXT[state.status] ?? state.status}</p>
      {authorized && (
        <dl className="grid grid-cols-1 gap-1 text-xs text-slate-600">
          {state.protocol && <div><dt className="inline text-slate-500">Protocolo: </dt><dd className="inline font-mono">{state.protocol}</dd></div>}
          {state.authorizedAt && <div><dt className="inline text-slate-500">Autorização: </dt><dd className="inline">{new Date(state.authorizedAt).toLocaleString("pt-BR")}</dd></div>}
          {state.accessKey && <div><dt className="text-slate-500">Chave de acesso</dt><dd className="break-all font-mono">{fmtKey(state.accessKey)}</dd></div>}
        </dl>
      )}
      {state.message && !authorized && <p className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">Retorno: {state.message}</p>}
      <div className="flex flex-wrap gap-2">
        {state.status !== "not_required" && (
          <Button size="sm" onClick={() => query()} loading={pending}>
            <RefreshCcw className="size-4" /> Consultar situação
          </Button>
        )}
        {state.documentId && ["authorized", "contingency"].includes(state.status) && (
          <LinkButton size="sm" href={`/fiscal/${m}/${state.documentId}/imprimir`} target="_blank">
            <Printer className="size-4" /> {m === "nfce" ? "Imprimir DANFE NFC-e" : "Imprimir DANFE"}
          </LinkButton>
        )}
        {authorized && state.xmlFileId && (
          <a className={buttonClass("secondary", "sm")} href={`/api/files/${state.xmlFileId}`}>
            <Download className="size-4" /> Baixar XML
          </a>
        )}
      </div>
    </div>
  );
}

/** Envio pelo WhatsApp do próprio operador (wa.me): abre a conversa com o resumo; não há integração automática. */
export function WhatsAppLink({ phone, text }: { phone: string | null; text: string }) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return <p className="text-xs text-slate-500">WhatsApp: cliente sem celular cadastrado.</p>;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return (
    <a className={buttonClass("secondary", "sm")} href={`https://wa.me/${full}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" title="Abre o WhatsApp com a mensagem pronta; o envio é feito pelo operador">
      <MessageCircle className="size-4" /> Abrir no WhatsApp
    </a>
  );
}

/** Automatiza o comprovante escolhido no pagamento: impressão (via quadro oculto) e/ou e-mail — mostra o resultado real. */
export function ReceiptAutomation({ saleId, mode, email }: { saleId: string; mode: string | null; email: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const ran = useRef(false);
  const print = mode === "imprimir" || mode === "imprimir_email";
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // a automação roda uma única vez: recarregar a página não reimprime nem reenvia
    if (mode) window.history.replaceState(null, "", window.location.pathname);
    if ((mode === "email" || mode === "imprimir_email") && email) {
      const fd = new FormData();
      fd.set("email", email);
      void sendReceiptAction(saleId, fd).then((r) => setMsg(r.ok ? `E-mail: ${r.message}` : `E-mail não enviado: ${r.error}`));
    }
  }, [mode, email, saleId]);
  return (
    <>
      {print && <iframe src={`/vendas/${saleId}/recibo?print=1`} title="Impressão do recibo" className="pointer-events-none absolute h-0 w-0 opacity-0" aria-hidden />}
      {(print || msg) && (
        <p className="no-print text-xs text-slate-600" role="status">
          {print ? "Recibo enviado para a impressão do navegador. " : ""}
          {msg}
        </p>
      )}
    </>
  );
}

/** Envio do comprovante por e-mail pelo canal configurado; mostra o resultado real. */
export function EmailReceipt({ saleId, defaultEmail }: { saleId: string; defaultEmail: string | null }) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <ActionForm
      action={async (fd) => {
        const r = await sendReceiptAction(saleId, fd);
        setResult(r.ok ? { ok: true, text: r.message ?? "Enviado." } : { ok: false, text: r.error });
        return r;
      }}
    >
      {({ pending }) => (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input name="email" type="email" required defaultValue={defaultEmail ?? ""} placeholder="email@cliente.com" aria-label="E-mail do cliente" />
            <SubmitButton pending={pending} variant="secondary">
              <Mail className="size-4" /> Enviar
            </SubmitButton>
          </div>
          {result && <p className={result.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{result.ok ? "Entregue: " : "Não enviado: "}{result.text}</p>}
        </div>
      )}
    </ActionForm>
  );
}

/** Atalho de teclado da tela de conclusão: Enter ou F2 inicia novo atendimento. */
export function NewSaleShortcut() {
  const router = useRouter();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName)) return;
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        router.push("/pdv");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [router]);
  return (
    <LinkButton href="/pdv" variant="accent" size="lg">
      <ShoppingCart className="size-5" /> Novo atendimento <kbd className="rounded border border-white/40 px-1 text-xs">Enter</kbd>
    </LinkButton>
  );
}

/** Abre a impressão do navegador automaticamente (página de comprovante). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [enabled]);
  return (
    <Button onClick={() => window.print()} variant="primary" className="no-print">
      <Printer className="size-4" /> Imprimir
    </Button>
  );
}
