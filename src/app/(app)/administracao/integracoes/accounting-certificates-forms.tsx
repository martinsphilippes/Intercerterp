"use client";

import { ShieldCheck, ShieldOff, Unlock } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { authorizeDownloadAction, setCertificateTrackingAction } from "@/app/(app)/contabil/certificados/actions";

/**
 * Lado da EMPRESA (titular) — ações do cartão "Certificados digitais" da integração com a contabilidade:
 *  - conceder/retirar a autorização de acompanhamento (setCertificateTrackingAction, campo allowed=1|0);
 *  - autorizar o escritório a baixar o certificado de uma solicitação (authorizeDownloadAction, campo id).
 * Cada envio é uma ação real do administrador da empresa, com autor e momento no histórico do vínculo e do protocolo.
 */
export function TrackingToggle({ allowed, firmName }: { allowed: boolean; firmName: string }) {
  return (
    <ActionForm
      action={setCertificateTrackingAction}
      confirm={
        allowed
          ? `Retirar de ${firmName} a autorização para acompanhar e solicitar certificados digitais desta empresa? O escritório deixa de ver as validades e de abrir novas solicitações até nova autorização; o que já foi registrado permanece no histórico.`
          : undefined
      }
    >
      {({ pending, error }) => (
        <div className="space-y-2">
          <input type="hidden" name="allowed" value={allowed ? "0" : "1"} />
          <SubmitButton pending={pending} variant={allowed ? "danger" : "primary"}>
            {allowed ? (
              <>
                <ShieldOff className="size-4" aria-hidden /> Retirar autorização
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" aria-hidden /> Autorizar acompanhamento
              </>
            )}
          </SubmitButton>
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      )}
    </ActionForm>
  );
}

export function AuthorizeDownloadButton({ id, protocol, productLabel, firmName, issued }: { id: string; protocol: string; productLabel: string; firmName: string; issued: boolean }) {
  return (
    <ActionForm
      action={authorizeDownloadAction}
      confirm={`Autorizar ${firmName} a baixar o certificado ${productLabel} da solicitação ${protocol}? ${issued ? "O certificado já está emitido: o escritório poderá baixá-lo em seguida." : "A autorização vale assim que o certificado for emitido."} Cada download pelo escritório exige a confirmação de senha de quem baixa e fica registrado no histórico. A entrega continua disponível a esta empresa.`}
    >
      {({ pending, error }) => (
        <div className="space-y-1">
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={pending} variant="primary" size="sm">
            <Unlock className="size-3.5" aria-hidden /> Autorizar download pelo escritório
          </SubmitButton>
          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </ActionForm>
  );
}
