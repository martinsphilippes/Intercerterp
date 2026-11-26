"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { formatDateTimeSeconds } from "@/lib/dates";
import { createInterosLinkCodeAction } from "./actions";

type LinkState = { linked: boolean; linkedAt: string | null; pendingCodeExpiresAt: string | null; erpId: string; cnpj: string | null };

/**
 * Vínculo com o Interos (contrato §4.3): o administrador da empresa informa ao Interos o ID ERP, o CNPJ e um código
 * de uso único gerado aqui. O código aparece só uma vez e vale 72 horas; gerar outro invalida o anterior.
 */
export function InterosLinkCard({ companyId, state, canGenerate }: { companyId: string; state: LinkState; canGenerate: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const copy = async (v: string, what: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("success", `${what} copiado.`);
    } catch {
      toast("error", "Não foi possível copiar automaticamente; selecione o texto.");
    }
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-600">ID ERP:</span>
        <code className="rounded bg-slate-100 px-2 py-0.5 text-xs" data-testid="erp-id">{state.erpId}</code>
        <Button type="button" size="sm" variant="ghost" onClick={() => copy(state.erpId, "ID ERP")}>
          <Copy className="size-4" aria-hidden /> Copiar
        </Button>
      </div>
      {state.linked ? (
        <Notice tone="good" title="Empresa vinculada ao Interos">
          <p>Vinculada em {state.linkedAt ? formatDateTimeSeconds(state.linkedAt) : "—"}. O Interos acompanha a implantação, os módulos contratados e os indicadores desta empresa.</p>
        </Notice>
      ) : (
        <>
          <p className="text-slate-600">
            Para o Interos acompanhar esta empresa, informe a ele o ID ERP, o CNPJ e um código de vínculo. O código vale 72 horas, serve uma única vez e só é mostrado agora.
            {state.pendingCodeExpiresAt && !code && <> Há um código gerado que vale até {formatDateTimeSeconds(state.pendingCodeExpiresAt)}; gerar outro invalida o anterior.</>}
          </p>
          {code && (
            <Notice tone="warn" title="Código de vínculo (mostrado só agora)">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-white/70 px-2 py-1 text-base tracking-widest" data-testid="link-code">{code.code}</code>
                <Button type="button" size="sm" onClick={() => copy(code.code, "Código")}>
                  <Copy className="size-4" aria-hidden /> Copiar código
                </Button>
              </div>
              <p className="mt-1">Vale até {formatDateTimeSeconds(code.expiresAt)}. Entregue ao Interos por um canal seguro.</p>
            </Notice>
          )}
          {canGenerate && (
            <Button
              type="button"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() =>
                start(async () => {
                  const fd = new FormData();
                  fd.set("companyId", companyId);
                  const res = await createInterosLinkCodeAction(fd);
                  if (res.ok && res.data) setCode(res.data as { code: string; expiresAt: string });
                  else if (!res.ok) toast("error", res.error);
                })
              }
            >
              <KeyRound className="size-4" aria-hidden /> Gerar código de vínculo
            </Button>
          )}
        </>
      )}
    </div>
  );
}
