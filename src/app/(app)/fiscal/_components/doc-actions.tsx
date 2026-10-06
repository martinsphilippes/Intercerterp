"use client";

import Link from "@/components/ui/link";
import { Ban, FileDown, FileText, Mail, Pencil, Printer, RefreshCw, Search, Send, Wrench, FilePen } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { FormDialogButton } from "./form-dialog";
import { cancelAction, cceAction, emailAction, queryAction, refreshAction, retransmitAction, transmitAction } from "../actions";

export interface DocActionFlags {
  id: string;
  model: "nfe" | "nfce" | "nfse";
  status: string;
  attempts: number;
  hasProtocol: boolean;
  xmlFileId?: string | null;
  danfeUrl?: string | null;
  isSimulated: boolean;
  /** emissão permitida E documento da filial ativa */
  canIssue: boolean;
  /** cancelamento permitido E documento da filial ativa */
  canCancel: boolean;
  /** motivo pelo qual as ações de escrita não aparecem (consolidado ou outra filial) */
  scopeNote?: string | null;
  cancelAllowed: boolean;
  cancelReason?: string | null;
  defaultEmail?: string | null;
  editHref?: string | null;
  /** origem do documento ("disable" = registro de inutilização: sem descartar/retransmitir/consultar) */
  originType?: string | null;
}

/** Ações conforme o estado real do documento (sem botões inativos sem explicação). */
export function DocActions(f: DocActionFlags) {
  // registro de inutilização: o resultado vem de repetir o pedido de inutilização (não é documento transmissível)
  const disableRecord = f.originType === "disable";
  const editable = ["draft", "pending", "rejected"].includes(f.status) && !disableRecord;
  const retrans = ["rejected", "error", "pending", "queued"].includes(f.status) && !disableRecord;
  // já enviado (attempts > 0, exceto rejeitado): o servidor consulta o provedor antes de descartar
  const discardable = !f.hasProtocol && ["draft", "pending", "rejected", "queued", "error"].includes(f.status) && !disableRecord;
  const sentUnconfirmed = f.attempts > 0 && f.status !== "rejected";
  const printable = f.model !== "nfse" || ["authorized", "cancelled"].includes(f.status) || ["draft", "pending", "rejected"].includes(f.status);
  return (
    <>
      {f.canIssue && f.status === "draft" && !disableRecord && <ActionButton action={transmitAction.bind(null, f.id)} label="Transmitir" variant="primary" icon={<Send className="size-4" />} confirm="Transmitir o documento ao provedor fiscal agora?" />}
      {f.canIssue && editable && f.editHref && (
        <Link href={f.editHref} className={buttonClass("secondary")}>
          <Pencil className="size-4" /> {f.status === "rejected" ? "Corrigir dados" : "Editar"}
        </Link>
      )}
      {f.canIssue && editable && f.model !== "nfse" && <ActionButton action={refreshAction.bind(null, f.id)} label="Atualizar do cadastro" icon={<Wrench className="size-4" />} title="Relê NCM/CEST/CFOP/CST dos produtos (após corrigir o cadastro)" />}
      {f.canIssue && retrans && f.status !== "draft" && <ActionButton action={retransmitAction.bind(null, f.id)} label="Retransmitir" variant={f.status === "rejected" || f.status === "pending" ? "primary" : "secondary"} icon={<RefreshCw className="size-4" />} confirm="Retransmitir com a mesma referência (não cria novo documento)?" />}
      {f.canIssue && f.attempts > 0 && !disableRecord && <ActionButton action={queryAction.bind(null, f.id)} label="Consultar" icon={<Search className="size-4" />} title="Consulta a situação no provedor pela referência" />}
      {printable && (
        <Link href={`/fiscal/${f.model}/${f.id}/imprimir`} className={buttonClass("secondary")} target="_blank">
          <Printer className="size-4" /> {f.status === "authorized" || f.status === "cancelled" ? (f.model === "nfce" ? "DANFCE" : f.model === "nfse" ? "Imprimir" : "DANFE") : "Prévia"}
        </Link>
      )}
      {f.danfeUrl && !f.isSimulated && (
        <a href={f.danfeUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
          <FileText className="size-4" /> PDF do provedor
        </a>
      )}
      {f.xmlFileId && (
        <a href={`/api/files/${f.xmlFileId}`} className={buttonClass("secondary")}>
          <FileDown className="size-4" /> XML
        </a>
      )}
      {f.canIssue && ["authorized", "cancelled"].includes(f.status) && (
        <FormDialogButton action={emailAction.bind(null, f.id)} label="E-mail" icon={<Mail className="size-4" />} title="Enviar por e-mail" name="to" type="email" fieldLabel="Destinatário" defaultValue={f.defaultEmail ?? ""} description="O envio usa o canal de e-mail configurado em Integrações; o resultado exibido é o retorno real do canal. O XML armazenado vai anexo." submitLabel="Enviar" />
      )}
      {f.model === "nfe" && f.status === "authorized" && f.canIssue && (
        <FormDialogButton
          action={cceAction.bind(null, f.id)}
          label="Carta de correção"
          icon={<FilePen className="size-4" />}
          title="Carta de correção eletrônica (CC-e)"
          name="text"
          fieldLabel="Texto da correção"
          min={15}
          max={1000}
          description="A CC-e não pode corrigir valores, impostos, dados cadastrais que mudem o remetente/destinatário, nem a data de emissão/saída. Cada nova CC-e substitui a anterior."
          submitLabel="Registrar CC-e"
        />
      )}
      {f.canCancel && f.status === "authorized" && f.cancelAllowed && (
        <FormDialogButton action={cancelAction.bind(null, f.id)} label="Cancelar" variant="danger" icon={<Ban className="size-4" />} title="Cancelar documento autorizado" name="reason" fieldLabel="Justificativa" min={15} max={255} description="O cancelamento é solicitado ao provedor/SEFAZ. O documento só muda para Cancelado após a homologação. Efeitos de estoque/financeiro gerados por esta nota são revertidos." submitLabel="Solicitar cancelamento" />
      )}
      {f.canCancel && f.status === "authorized" && !f.cancelAllowed && f.cancelReason && (
        <span className="max-w-xs text-xs text-slate-500" title={f.cancelReason}>
          Cancelamento indisponível: {f.cancelReason}
        </span>
      )}
      {f.canCancel && discardable && (
        <FormDialogButton
          action={cancelAction.bind(null, f.id)}
          label="Descartar"
          variant="ghost"
          icon={<Ban className="size-4" />}
          title="Descartar documento não autorizado"
          name="reason"
          fieldLabel="Motivo"
          min={15}
          max={255}
          description={`${sentUnconfirmed ? "Este documento já foi enviado: antes de descartar, o sistema consulta o provedor — se estiver autorizado, a situação é atualizada e o descarte é recusado (use Cancelar). " : ""}O documento não autorizado é descartado (não há evento na SEFAZ). Se já recebeu número, inutilize-o depois em NF-e/NFC-e → Inutilização.`}
          submitLabel="Descartar"
        />
      )}
      {disableRecord && f.canCancel && f.status !== "unused" && (
        <span className="max-w-xs text-xs text-slate-500">Pedido de inutilização sem homologação confirmada: repita-o em “Inutilizar numeração” (mesma faixa) para obter o resultado.</span>
      )}
      {f.scopeNote && <span className="max-w-xs text-xs text-slate-500">{f.scopeNote}</span>}
    </>
  );
}
