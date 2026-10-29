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
import { getNetworkSale, networkSettings } from "@/domain/network";
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
