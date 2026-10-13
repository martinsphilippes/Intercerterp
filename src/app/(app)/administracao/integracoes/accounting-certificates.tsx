import { FileKey2 } from "lucide-react";
import type { Store } from "@/lib/db/types";
import { getSession } from "@/lib/server/session";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { CertificateDownloadButton } from "@/components/certificates/download-button";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can, canDo, type PermissionSubject } from "@/lib/permissions";
import { CERT_KIND_LABEL, certificateTrackingAuthorized, companyAccountingLink, companyCertificateRequests, requestDisplayStatus } from "@/domain/accounting";
import { AuthorizeDownloadButton, TrackingToggle } from "./accounting-certificates-forms";

/**
 * Lado da EMPRESA (titular) na integração com a contabilidade — Tela 67, certificados digitais:
 *  - autorização de acompanhamento: o escritório vinculado só vê validades e abre solicitações com esta permissão,
 *    independente das autorizações fiscais do vínculo;
 *  - solicitações abertas pelo escritório para esta empresa: etapa, cobrança, validade quando emitido, autorização
 *    de download pelo escritório (por solicitação) e o download pelo próprio titular (confirmação de senha).
 * Renderizado dentro do cartão do vínculo ATIVO. `user` e `firmName` são opcionais: sem eles, lê a sessão e o vínculo.
 */
export async function AccountingCertificates({ companyId, store, canEdit, user, firmName }: { companyId: string; store: Store; canEdit: boolean; user?: PermissionSubject | null; firmName?: string | null }) {
  const [authorized, requests, link, session] = await Promise.all([
    certificateTrackingAuthorized(store, companyId),
    companyCertificateRequests(store, companyId),
    firmName ? Promise.resolve(null) : companyAccountingLink(store, companyId),
    user ? Promise.resolve(null) : getSession(),
  ]);
  const firm = firmName ?? (link ? link.firm.tradeName || link.firm.name : "O escritório contábil");
  const subject = user ?? session?.user ?? null;
  // as ações do titular exigem "Configurar integrações" (canEdit) e edição no módulo Administração — a mesma régua das server actions
  const canManage = canEdit && Boolean(subject && can(subject, "admin", "edit"));
  const canDownload = Boolean(subject && canDo(subject, "fiscal.configure"));
  const issued = (r: Record<string, any>) => Boolean(r.fileId) && ["awaiting_authorization", "ready_to_download", "downloaded"].includes(r.status);

  return (
    <Card title="Certificados digitais" description="Acompanhamento pelo escritório e autorização de download dos certificados solicitados para esta empresa." actions={authorized ? <Badge tone="good">Acompanhamento autorizado</Badge> : <Badge tone="neutral">Acompanhamento não autorizado</Badge>}>
      <div className="space-y-5 text-sm">
        <section aria-label="Autorização de acompanhamento" className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">Autorização de acompanhamento</p>
          <p className="flex items-start gap-1.5 text-slate-700">
            <FileKey2 className={`mt-0.5 size-4 shrink-0 ${authorized ? "text-emerald-600" : "text-slate-400"}`} aria-hidden />
            <span>
              {authorized ? (
                <>
                  O escritório <b>{firm}</b> está autorizado a acompanhar e solicitar certificados digitais desta empresa.
                </>
              ) : (
                <>
                  O escritório <b>{firm}</b> ainda não está autorizado a acompanhar nem a solicitar certificados digitais desta empresa.
                </>
              )}
            </span>
          </p>
          <p className="text-xs text-slate-500">Permissão independente das autorizações financeiras, fiscais e de folha. A indicação comercial ou a licença do ERP não liberam os dados automaticamente.</p>
          {canManage ? <TrackingToggle allowed={authorized} firmName={firm} /> : <p className="text-xs text-slate-500">Autorizar ou retirar a autorização exige a permissão “Configurar integrações” e edição em Administração.</p>}
        </section>

        <section aria-label="Solicitações de certificado" className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">Solicitações abertas pelo escritório</p>
          {requests.length === 0 ? (
            <EmptyState title="O escritório ainda não abriu solicitações de certificado para esta empresa" description="Quando o escritório solicitar um certificado digital (e-CNPJ ou e-CPF A1) para esta empresa, a solicitação aparece aqui com a etapa, a cobrança e a autorização de download." />
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Protocolo</th>
                      <th>Produto</th>
                      <th>Etapa</th>
                      <th className="text-right">Cobrança</th>
                      <th>Validade</th>
                      <th>Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="font-mono text-xs text-ink">{r.protocol}</td>
                        <td>
                          <span className="font-medium text-ink">{r.productLabel}</span>
                          <span className="block text-xs text-slate-500">{CERT_KIND_LABEL[r.kind] ?? r.kind}</span>
                        </td>
                        <td>
                          <StatusBadge kind="certificate_request" status={requestDisplayStatus(r)} />
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <span className="tabular">{formatMoney(r.amount)}</span>
                          <span className="block text-xs text-slate-500">{r.paymentConfirmedAt ? `Pago em ${formatDate(r.paymentConfirmedAt)}` : `Vencimento ${formatDate(r.dueDate)}`}</span>
                        </td>
                        <td className="whitespace-nowrap">{issued(r) && r.validTo ? `${formatDate(r.validFrom)} a ${formatDate(r.validTo)}` : <span className="text-slate-400">—</span>}</td>
                        <td>
                          <div className="flex flex-col items-start gap-1.5">
                            {r.downloadAuthorized ? (
                              <span className="block text-xs text-emerald-800">
                                Download autorizado ao escritório em {formatDateTime(r.downloadAuthorizedAt)}
                                {r.downloadAuthorizedBy === "firm" && <span className="block text-slate-500">Autorização registrada pelo escritório</span>}
                              </span>
                            ) : r.status === "cancelled" ? (
                              <span className="text-xs text-slate-400">Solicitação cancelada</span>
                            ) : canManage ? (
                              <AuthorizeDownloadButton id={r.id} protocol={r.protocol} productLabel={r.productLabel} firmName={firm} issued={issued(r)} />
                            ) : (
                              <span className="block text-xs text-slate-500">Escritório não autorizado — autorizar exige a permissão “Configurar integrações” e edição em Administração.</span>
                            )}
                            {issued(r) ? (
                              canDownload ? (
                                <CertificateDownloadButton requestId={r.id} fileName={r.fileName} label="Baixar (titular)" variant="secondary" size="sm" />
                              ) : (
                                <span className="block text-xs text-slate-500">Baixar pelo titular exige a permissão “Configurar fiscal e certificados”.</span>
                              )
                            ) : (
                              <span className="text-xs text-slate-500">Ainda não emitido</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">A entrega permanece disponível ao próprio titular: baixar aqui exige a confirmação da sua senha e fica registrado no histórico da solicitação. A cobrança é da certificação digital, separada da mensalidade do ERP.</p>
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
