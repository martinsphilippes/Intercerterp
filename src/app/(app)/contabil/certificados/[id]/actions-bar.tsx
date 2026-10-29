"use client";

import { BellRing, RefreshCw, Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import type { ActionResult } from "@/lib/server/action";
import { requestEmissionAction, requestDownloadAuthorizationAction } from "../actions";

/**
 * Ações de um clique do protocolo (escritório). Cada uma é um formulário mínimo com o id da solicitação:
 * a ActionForm bloqueia o duplo envio, pede confirmação e mostra o resultado (mensagem do servidor).
 */

/** Pede a emissão do certificado (pagamento confirmado e titular validado) ou uma nova tentativa após falha. */
/** `action`: padrão = a ação do escritório (Tela 67); a venda da rede (§45) passa a dela — mesma regra no domínio. */
export function RequestEmissionButton({ id, holderName, retry, action = requestEmissionAction }: { id: string; holderName: string; retry: boolean; action?: (fd: FormData) => Promise<ActionResult<any>> }) {
  return (
    <ActionForm
      action={action}
      confirm={retry ? `Pedir nova tentativa de emissão para ${holderName}? O mesmo protocolo é usado, sem gerar outra cobrança.` : `Pedir a emissão do certificado de ${holderName}? A certificadora é acionada neste protocolo.`}
    >
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={pending} variant="primary">
            {retry ? <RefreshCw className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {retry ? "Tentar emissão novamente" : "Emitir certificado"}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Notifica os administradores da empresa vinculada no ERP para autorizarem o download pelo escritório. */
export function RequestAuthorizationButton({ id, holderName }: { id: string; holderName: string }) {
  return (
    <ActionForm action={requestDownloadAuthorizationAction} confirm={`Enviar o pedido de autorização de download aos administradores de ${holderName} no ERP?`}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={pending} variant="primary">
            <BellRing className="size-4" aria-hidden /> Preparar pedido de autorização
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
