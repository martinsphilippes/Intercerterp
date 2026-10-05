"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Printer, RefreshCcw, ShoppingCart } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { refreshFiscalAction, sendReceiptAction } from "./actions";

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

/** Situação fiscal separada da situação comercial; consulta real ao provedor (nunca sucesso antecipado). */
export function FiscalStatus({ saleId, status, model, documentId, number, message, simulated, auto }: { saleId: string; status: string; model: string | null; documentId: string | null; number: number | null; message: string | null; simulated: boolean; auto?: boolean }) {
  const [state, setState] = useState({ status, message, documentId, number, simulated });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const ran = useRef(false);
  const query = (silent = false) =>
    start(async () => {
      const res = await refreshFiscalAction(saleId);
      if (!res.ok) return toast("error", res.error);
      const d = res.data!;
      setState({ status: d.status, message: d.message, documentId: d.documentId, number: d.number, simulated: d.simulated });
      if (!silent) toast("info", `Situação fiscal: ${FISCAL_TEXT[d.status]?.split(".")[0] ?? d.status}`);
      router.refresh();
    });
  useEffect(() => {
    if (auto && !ran.current && ["queued", "processing", "error"].includes(status)) {
      ran.current = true;
      query(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const m = model ?? "nfce";
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="fiscal" status={state.status} />
        {state.simulated && <SimBadge />}
        {state.documentId && (
          <Link className="text-sm text-brand-700 hover:underline" href={`/fiscal/${m}/${state.documentId}`}>
            {m.toUpperCase()} {state.number ? `nº ${state.number}` : "(sem número)"}
          </Link>
        )}
        {pending && <Badge tone="info">consultando…</Badge>}
      </div>
      <p className="text-sm text-slate-600">{FISCAL_TEXT[state.status] ?? state.status}</p>
      {state.message && state.status !== "authorized" && <p className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">Retorno: {state.message}</p>}
      <div className="flex flex-wrap gap-2">
        {state.status !== "not_required" && (
          <Button size="sm" onClick={() => query()} loading={pending}>
            <RefreshCcw className="size-4" /> Consultar situação
          </Button>
        )}
        {state.documentId && ["authorized", "contingency"].includes(state.status) && (
          <LinkButton size="sm" href={`/fiscal/${m}/${state.documentId}/imprimir`} target="_blank">
            <Printer className="size-4" /> {m === "nfce" ? "DANFE NFC-e" : "DANFE"}
          </LinkButton>
        )}
      </div>
    </div>
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
