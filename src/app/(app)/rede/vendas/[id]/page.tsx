import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { Timeline } from "@/components/ui/timeline";
import { CertificateDownloadButton } from "@/components/certificates/download-button";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { BusinessError } from "@/lib/core/errors";
import { CERT_KIND_LABEL, CHARGE_CHANNEL_LABEL, VALIDATION_MODE_LABEL, certificationSettings, chargeMessage, requestNextAction } from "@/domain/accounting";
import { FIN_KIND_LABEL, FIN_SETTLEMENT_LABEL, FIN_STATUS_LABEL, getNetworkSale, isPlatform, networkSettings, saleFinanceView } from "@/domain/network";
import { canDo } from "@/lib/permissions";
import { ReprocessForm, ReverseSaleForm } from "../../financeiro/forms";
import { ChargeForm } from "@/app/(app)/contabil/certificados/[id]/charge-form";
import { CancelForm } from "@/app/(app)/contabil/certificados/[id]/cancel-form";
import { AuthorizationForm } from "@/app/(app)/contabil/certificados/[id]/authorization-form";
import { RequestEmissionButton } from "@/app/(app)/contabil/certificados/[id]/actions-bar";
import { requireNetworkSession } from "../../shared";
import { CascadeView, SaleProgress } from "../components";
import { cancelSaleAction, recordSaleAuthorizationAction, requestSaleEmissionAction, sendSaleChargeAction } from "../actions";

export const metadata = { title: "Venda de certificado" };

const OWNER_LABEL: Record<string, string> = { firm: "Vendedor (você)", team: "Equipe de certificação Intercert", company: "Titular", none: "Nenhuma ação pendente" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireNetworkSession();
  const { id } = await params;
  let sale;
  try {
    sale = await getNetworkSale(s.ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const { request: r, masked, canOperate, own, nodeName, displayStatus } = sale;
  const [{ levelLabels }, settings] = await Promise.all([networkSettings(s.ctx.store), certificationSettings(s.ctx.store)]);
  const next = requestNextAction(r);
  const firmSale = r.channel !== "network";
  const ack = r.duplicateAck as { reason: string; byName: string; at: string; matches: string[] } | null;
  const historyStore = own ? s.ctx.store : scopeStore(unscoped(s.ctx.store), r.companyId);
  // §46: lançamentos da venda em cada camada (mascarados para quem olha) e estorno da venda paga pela plataforma
  const finance = await saleFinanceView(s.ctx, r.id);
  const platform = isPlatform(s.ctx);
  const canReverse = (platform || canDo(s.user, "certification.operate")) && Boolean(r.paymentConfirmedAt) && ["validation", "ready_to_issue", "issue_failed"].includes(r.status) && Number(r.amount) > 0;
  return (
    <>
      <PageHeader
        title={`${r.protocol} · ${r.holderName}`}
        crumbs={[{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Vendas", href: "/rede/vendas" }, { label: r.protocol }]}
        badges={<><StatusBadge kind="certificate_request" status={displayStatus} />{r.free && <Badge tone="good">gratuito</Badge>}{r.gift && <Badge tone="info">voucher presente</Badge>}{firmSale && <Badge>venda do contador</Badge>}</>}
        description={`${r.productLabel} · ${CERT_KIND_LABEL[r.kind] ?? r.kind} · ${own ? "seu nó" : nodeName}${r.sellerName ? ` · vendedor ${r.sellerName}` : ""}`}
      />
      <div className="mb-4 rounded-lg border border-line bg-white p-3">
        <SaleProgress r={r} />
        <p className="mt-2 text-sm text-slate-700"><span className="font-medium">Próxima ação:</span> {next.label} <span className="text-xs text-slate-500">({OWNER_LABEL[next.owner] ?? next.owner})</span></p>
      </div>
      {!canOperate && <div className="mb-4"><Notice tone="info">{own ? "Consulta: operar esta venda é do vendedor dela ou de quem vê todas as vendas do nó com a operação de venda." : "Consulta: venda de um parceiro abaixo do seu nó. Você vê os custos a partir do seu nível."}</Notice></div>}
      {ack && <div className="mb-4"><Notice tone="warn" title="Vendida apesar do aviso de duplicidade">{ack.matches.join("; ")}. Motivo: {ack.reason} — {ack.byName}, {formatDateTime(ack.at)}.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {canOperate && r.status === "awaiting_payment" && (
            <Card title={(r.chargeSends ?? 0) > 0 ? "Reenviar a cobrança" : "Enviar a cobrança"} description="Cobrança única da certificação digital; a equipe confirma o pagamento com a referência da transação.">
              <ChargeForm id={r.id} overdue={displayStatus === "overdue"} dueDate={r.dueDate} contactEmail={r.contactEmail ?? null} contactPhone={r.contactPhone ?? null} chargeSends={r.chargeSends ?? 0} chargeChannel={r.chargeChannel ?? null} chargeTo={r.chargeTo ?? null} preview={chargeMessage(r, settings)} action={sendSaleChargeAction} />
            </Card>
          )}
          {canOperate && ["ready_to_issue", "issue_failed"].includes(r.status) && (
            <Card title="Emissão">
              {r.status === "issue_failed" && <div className="mb-3"><Notice tone="bad">Falha na emissão: {r.emissionFailure}</Notice></div>}
              <RequestEmissionButton id={r.id} holderName={r.holderName} retry={r.status === "issue_failed"} action={requestSaleEmissionAction} />
            </Card>
          )}
          {canOperate && r.status === "awaiting_authorization" && (
            <Card title="Entrega ao titular" description="Registre como o titular autorizou a entrega (termo, e-mail, WhatsApp). Depois, o download é liberado com a confirmação da sua senha.">
              <AuthorizationForm id={r.id} holderName={r.holderName} action={recordSaleAuthorizationAction} />
            </Card>
          )}
          {canOperate && ["ready_to_download", "downloaded"].includes(r.status) && (
            <Card title="Download do certificado" description={`Downloads registrados: ${r.downloads ?? 0}. Cada download exige a confirmação da sua senha e fica no histórico.`}>
              <CertificateDownloadButton requestId={r.id} fileName={r.fileName ?? "certificado.pfx"} />
            </Card>
          )}
          {masked && (
            <Card title="Retrato da cascata" description="Gravado no momento da venda e imutável: base do financeiro em cascata e das comissões. Custos de níveis acima do seu parceiro não aparecem.">
              <CascadeView m={masked} labels={levelLabels} />
            </Card>
          )}
          {finance && (
            <Card title="Financeiro em camadas" description={`Quem cobra o cliente: ${finance.collectorName ?? "—"}${finance.referrerName ? ` · indicado por ${finance.referrerName}` : ""}. Cada fluxo vira títulos no financeiro de cada empresa (ou débito na carteira pré-paga).`}>
              {finance.issues.length > 0 && <div className="mb-3"><Notice tone="warn" title="Lançamentos pendentes">{finance.issues.join(" ")}</Notice></div>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Fluxo</th><th className="py-1 text-left font-medium">De → para</th><th className="py-1 text-left font-medium">Liquidação</th><th className="py-1 text-right font-medium">Valor</th><th className="py-1 text-left font-medium pl-3">Situação</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {finance.plan!.flows.map((fl) => {
                      const ents = finance.entries.filter((e) => e.flowKey === fl.key);
                      const paid = ents.find((e) => e.event === "paid");
                      const rev = ents.find((e) => e.event === "reversal");
                      return (
                        <tr key={fl.key}>
                          <td className="py-1.5">{FIN_KIND_LABEL[fl.kind] ?? fl.kind}</td>
                          <td className="py-1.5 text-xs">{fl.payer.name} → {fl.payee.name}</td>
                          <td className="py-1.5 text-xs">{FIN_SETTLEMENT_LABEL[fl.settlement] ?? fl.settlement}</td>
                          <td className="tabular py-1.5 text-right">{formatMoney(fl.amount)}</td>
                          <td className="py-1.5 pl-3 text-xs">{rev ? <Badge tone="warn">estornado</Badge> : paid ? <Badge tone="good">{FIN_STATUS_LABEL[paid.status] ?? paid.status}</Badge> : <Badge>{r.status === "cancelled" ? "cancelado" : "aguardando pagamento"}</Badge>}{paid?.reconcile === "pending" && <span className="ml-1 text-amber-700">a conciliar</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(canReverse || (platform && finance.issues.length > 0)) && (
                <div className="mt-4 space-y-3 border-t border-line pt-3">
                  {platform && finance.issues.length > 0 && <ReprocessForm id={r.id} />}
                  {canReverse && <ReverseSaleForm id={r.id} protocol={r.protocol} amount={r.amount} />}
                </div>
              )}
            </Card>
          )}
          <Card title="Histórico">
            <Timeline store={historyStore} refs={[`certificate_request:${r.id}`]} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Titular">
            <DefinitionList cols={1} items={[
              { label: "Nome", value: r.holderName },
              { label: "Documento", value: formatDoc(r.holderDoc) },
              { label: "E-mail", value: r.contactEmail ?? "—" },
              { label: "Telefone", value: r.contactPhone ? formatPhone(r.contactPhone) : "—" },
            ]} />
          </Card>
          <Card title="Venda">
            <DefinitionList cols={1} items={[
              { label: "Valor ao cliente", value: formatMoney(r.amount) },
              { label: "Vencimento da cobrança", value: r.free || r.gift ? "sem cobrança" : formatDate(r.dueDate) },
              r.chargeSends ? { label: "Cobrança enviada", value: `${r.chargeSends}× · ${CHARGE_CHANNEL_LABEL[r.chargeChannel] ?? r.chargeChannel} para ${r.chargeTo}` } : null,
              r.paymentConfirmedAt ? { label: "Pagamento", value: `${formatDateTime(r.paymentConfirmedAt)} · ${r.paymentRef ?? ""}` } : null,
              r.validationAt ? { label: "Validação", value: `${formatDateTime(r.validationAt)} · ${VALIDATION_MODE_LABEL[r.validationMode] ?? ""}` } : null,
              r.validTo ? { label: "Validade do certificado", value: `${formatDate(r.validFrom)} a ${formatDate(r.validTo)}` } : null,
              { label: "Aberta em", value: formatDateTime(r.createdAt) },
            ]} />
            {canOperate && (r.status === "awaiting_payment" || ((r.free || r.gift) && r.status === "validation")) && (
              <div className="mt-3"><CancelForm id={r.id} protocol={r.protocol} holderName={r.holderName} action={cancelSaleAction} /></div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
