"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Link2, Link2Off, RefreshCw, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { startNavigationProgress } from "@/components/ui/nav-progress";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { issueLinkCodeAction, cancelLinkCodeAction, revokeLinkByFirmAction } from "../../actions";

export interface LinkCardProps {
  clientId: string;
  /** CPF/CNPJ do cadastro (só dígitos) — a empresa precisa ter o mesmo CNPJ para aceitar o código */
  clientDoc: string | null;
  personType: "PF" | "PJ";
  clientStatus: string;
  linkStatus: "none" | "pending" | "active" | "revoked";
  linkCodeExpiresAt: string | null;
  linkedAt: string | null;
  linkedCompany: { name: string; tradeName: string | null; cnpj: string | null } | null;
  canLink: boolean;
  codeDays: number;
}

/**
 * Cartão "Vínculo com o ERP" da aba Resumo. O código emitido é devolvido pelo servidor UMA vez (só o hash fica
 * guardado), por isso aparece em destaque aqui até a página ser recarregada.
 */
export function LinkCard(p: LinkCardProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const refresh = () => {
    startNavigationProgress();
    router.refresh();
  };

  const issue = (reissue: boolean) => {
    if (reissue && !window.confirm("Reemitir o código? O código anterior deixa de valer imediatamente.")) return;
    start(async () => {
      const r = await issueLinkCodeAction(p.clientId);
      if (!r.ok) return toast("error", r.error);
      setIssued(r.data as { code: string; expiresAt: string });
      toast("success", r.message ?? "Código emitido.");
      refresh();
    });
  };
  const cancel = () => {
    if (!window.confirm("Cancelar o código de vínculo? A empresa não conseguirá mais usá-lo; um novo pode ser emitido depois.")) return;
    start(async () => {
      const r = await cancelLinkCodeAction(p.clientId);
      if (!r.ok) return toast("error", r.error);
      setIssued(null);
      toast("success", r.message ?? "Código cancelado.");
      refresh();
    });
  };
  const revoke = () => {
    if (!window.confirm("Desfazer o vínculo com a empresa do ERP? O escritório deixa de ver a situação fiscal e de receber os pacotes mensais. As entregas já recebidas são mantidas.")) return;
    start(async () => {
      const r = await revokeLinkByFirmAction(p.clientId);
      if (!r.ok) return toast("error", r.error);
      toast("success", r.message ?? "Vínculo desfeito.");
      refresh();
    });
  };

  const expired = p.linkStatus === "pending" && Boolean(p.linkCodeExpiresAt) && p.linkCodeExpiresAt! < new Date().toISOString();
  const closed = p.clientStatus === "closed";
  const canIssue = p.canLink && p.personType === "PJ" && !closed;

  return (
    <Card title="Vínculo com o ERP" description="Com o vínculo ativo, o escritório lê a situação fiscal da empresa (somente leitura) e recebe o pacote mensal de XMLs automaticamente." actions={<StatusBadge kind="link" status={p.linkStatus} />}>
      <div className="space-y-3 text-sm">
        {p.personType === "PF" ? (
          <Notice tone="info">Somente pessoa jurídica pode ser vinculada a uma empresa que usa o ERP. Para pessoa física o escritório trabalha apenas com o cadastro próprio.</Notice>
        ) : (
          <>
            {issued && (
              <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Código de vínculo — anote agora, ele não é mostrado de novo</p>
                <p className="my-2 select-all font-mono text-3xl font-bold tracking-widest text-emerald-900">{issued.code}</p>
                <p className="text-emerald-900">
                  Válido até <b>{formatDateTime(issued.expiresAt)}</b>. Informe-o ao administrador da empresa: no ERP, em <b>Administração → Integrações → Área da contabilidade</b>, ele digita o código e aceita o vínculo. {p.clientDoc ? <>O CNPJ da empresa precisa ser o mesmo do cadastro ({formatDoc(p.clientDoc)}).</> : <>Como o cadastro está sem CNPJ, qualquer empresa com o código consegue aceitar o vínculo — confira o CNPJ depois.</>}
                </p>
              </div>
            )}

            {(p.linkStatus === "none" || p.linkStatus === "revoked") && (
              <>
                <p className="text-slate-600">
                  {p.linkStatus === "revoked" ? "O vínculo anterior foi desfeito. " : "Este cliente ainda não está vinculado a uma empresa do ERP. "}
                  Para vincular, emita um código de vínculo (validade de {p.codeDays} dias) e peça ao administrador da empresa que o informe no ERP.
                </p>
                {closed ? (
                  <Notice tone="warn">Cliente encerrado não pode ser vinculado. Reative o cliente antes de emitir um código.</Notice>
                ) : canIssue ? (
                  <Button type="button" variant="primary" loading={pending} onClick={() => issue(false)}>
                    <KeyRound className="size-4" aria-hidden /> Emitir código de vínculo
                  </Button>
                ) : (
                  <p className="text-xs text-slate-500">Emitir o código exige a permissão “Vincular/desvincular empresas do ERP a clientes”.</p>
                )}
              </>
            )}

            {p.linkStatus === "pending" && (
              <>
                <Notice tone={expired ? "warn" : "info"} title={expired ? "Código expirado" : "Aguardando a empresa"}>
                  {expired ? (
                    <>O código venceu em {formatDateTime(p.linkCodeExpiresAt)} sem ser aceito. Reemita um novo código e informe-o à empresa.</>
                  ) : (
                    <>
                      Um código foi emitido e vale até <b>{formatDateTime(p.linkCodeExpiresAt)}</b>. O vínculo passa a valer quando o administrador da empresa informar o código no ERP (Administração → Integrações → Área da contabilidade).
                    </>
                  )}
                </Notice>
                {canIssue ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" loading={pending} onClick={() => issue(true)} title="Gera um novo código; o anterior deixa de valer">
                      <RefreshCw className="size-4" aria-hidden /> Reemitir
                    </Button>
                    <Button type="button" variant="ghost" loading={pending} onClick={cancel}>
                      <XCircle className="size-4" aria-hidden /> Cancelar código
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Reemitir ou cancelar o código exige a permissão “Vincular/desvincular empresas do ERP a clientes”.</p>
                )}
              </>
            )}

            {p.linkStatus === "active" && (
              <>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Empresa vinculada</dt>
                    <dd className="mt-0.5 flex items-start gap-1.5 text-ink">
                      <Link2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                      {p.linkedCompany ? (
                        <span>
                          {p.linkedCompany.tradeName || p.linkedCompany.name}
                          {p.linkedCompany.tradeName && p.linkedCompany.tradeName !== p.linkedCompany.name && <span className="block text-xs text-slate-500">{p.linkedCompany.name}</span>}
                        </span>
                      ) : (
                        <span className="text-slate-500">Empresa não encontrada</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">CNPJ da empresa</dt>
                    <dd className="mt-0.5 tabular text-ink">{p.linkedCompany?.cnpj ? formatDoc(p.linkedCompany.cnpj) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Vinculada desde</dt>
                    <dd className="mt-0.5 text-ink">{p.linkedAt ? formatDateTime(p.linkedAt) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">O que o escritório recebe</dt>
                    <dd className="mt-0.5 text-ink">Situação fiscal (aba Fiscal) e pacote mensal de XMLs (aba Entregas)</dd>
                  </div>
                </dl>
                {p.canLink ? (
                  <Button type="button" variant="danger" loading={pending} onClick={revoke}>
                    <Link2Off className="size-4" aria-hidden /> Desfazer vínculo
                  </Button>
                ) : (
                  <p className="text-xs text-slate-500">Desfazer o vínculo exige a permissão “Vincular/desvincular empresas do ERP a clientes”. A empresa também pode desfazê-lo pelo ERP.</p>
                )}
              </>
            )}
          </>
        )}
        {p.linkStatus === "revoked" && p.linkedAt && <p className="text-xs text-slate-500">Último vínculo aceito em {formatDate(p.linkedAt)}.</p>}
      </div>
    </Card>
  );
}
