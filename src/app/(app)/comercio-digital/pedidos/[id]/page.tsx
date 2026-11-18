import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Ban, FileText, PackageCheck, RefreshCcw, Undo2, ExternalLink } from "lucide-react";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { DELIVERY_LABEL, ORDER_STATUS_TONE, PAYMENT_STATUS_LABEL, PAY_METHOD_LABEL, type DeliveryMode, type OrderStatus, type PaymentStatus } from "@/domain/ecommerce/common";
import { operationLabel, orderSteps, orderTimeline, withdrawalDeadline } from "@/domain/ecommerce/orders";
import { orderFiscalDocs } from "@/domain/ecommerce/fiscal";
import { DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { cancelOrderAction, completeReturnAction, invoiceOrderAction, retryChargeAction } from "../../actions";
import { brDate, brDateTime, ecomStorePage } from "../../_lib";

export const metadata = { title: "Pedido on-line" };

const STEP_TONE = { done: "bg-emerald-50 text-emerald-800 border-emerald-200", current: "bg-brand-50 text-brand-800 border-brand-200", todo: "bg-slate-50 text-slate-500 border-slate-200", blocked: "bg-red-50 text-red-700 border-red-200" } as const;

/** Tela 54 (detalhe) — origem, itens, total, pagamento, reserva, documento fiscal e situação de atendimento. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { s, st } = await ecomStorePage(["ecommerce.orders", "ecommerce.cancel", "ecommerce.finance", "ecommerce.manage"]);
  const o = await unscoped(s.ctx.store).get("online_orders", id);
  if (!o || o.companyId !== s.ctx.companyId || o.storeId !== st.id) notFound();
  const [events, docs, reservations] = await Promise.all([
    orderTimeline(s.ctx.store, o.id),
    orderFiscalDocs(s.ctx, o.id),
    unscoped(s.ctx.store).list("stock_reservations", { filters: [["eq", "originType", "online_order"], ["eq", "originId", o.id], ["eq", "status", "active"]], limit: 50 }),
  ]);
  const steps = orderSteps(o);
  const canFiscal = canDo(s.user, "fiscal.issue");
  const canCancel = canDo(s.user, "ecommerce.cancel");
  const canOrders = canDo(s.user, "ecommerce.orders");
  const paid = o.paymentStatus === "paid";
  const fiscalOk = o.fiscalStatus === "authorized";
  const cancellable = ["pending_payment", "paid", "invoiced", "ready_for_pickup"].includes(o.status);
  const doc = docs[0] ?? null;
  const wrongBranch = s.ctx.branchId && o.branchId !== s.ctx.branchId;
  const branch = o.branchId ? await s.ctx.store.get("branches", o.branchId) : null;
  const deadline = withdrawalDeadline(o);
  const items = (o.items ?? []) as Array<{ skuId: string; sku: string; title: string; variant?: string; qty: number; unitPrice: number; discount: number; total: number }>;

  return (
    <>
      <PageHeader
        title={`${o.code} · ${o.customer?.name ?? ""}`}
        crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Pedidos on-line", href: "/comercio-digital/pedidos" }, { label: o.code }]}
        description={`Loja virtual · ${PAY_METHOD_LABEL[o.payment?.method as keyof typeof PAY_METHOD_LABEL] ?? ""} · ${o.delivery?.label ?? ""} · registrado em ${brDateTime(o.createdAt)}`}
        badges={<Badge tone={ORDER_STATUS_TONE[o.status as OrderStatus] ?? "neutral"}>{operationLabel(o)}</Badge>}
      />
      <ol aria-label="Etapas do pedido" className="mb-4 flex flex-wrap gap-2">
        {steps.map((step, i) => (
          <li key={step.key} className={`rounded-md border px-3 py-1.5 text-sm ${STEP_TONE[step.state]}`} title={step.detail}>
            <span className="font-medium">{i + 1}. {step.label}</span> <span className="text-xs opacity-80">· {step.detail}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Itens do pedido" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Desconto</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.skuId}>
                      <td><span className="block font-medium text-ink">{i.title}</span><span className="block text-xs text-slate-500">{[i.sku, i.variant].filter(Boolean).join(" · ")}</span></td>
                      <td className="tabular text-right">{formatQty(i.qty, "", 0)}</td>
                      <td className="tabular text-right">{formatMoney(i.unitPrice)}</td>
                      <td className="tabular text-right">{i.discount ? `− ${formatMoney(i.discount)}` : "—"}</td>
                      <td className="tabular text-right font-medium">{formatMoney(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto max-w-sm space-y-1 px-4 py-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Produtos</dt><dd className="tabular">{formatMoney(o.subtotal)}</dd></div>
              {o.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Cupom {o.couponCode}</dt><dd className="tabular">− {formatMoney(o.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">Frete ({o.delivery?.label})</dt><dd className="tabular">{o.delivery?.free ? "Grátis" : formatMoney(o.shippingAmount)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold text-ink"><dt>Total</dt><dd className="tabular">{formatMoney(o.total)}</dd></div>
            </dl>
            <div className="px-4 pb-4">
              <Notice tone={reservations.items.length ? "info" : o.status === "cancelled" ? "warn" : "good"}>
                {reservations.items.length
                  ? `Estoque reservado no ERP (${branch?.name ?? "filial de expedição"}). ${fiscalOk ? "Documento fiscal autorizado." : "Documento fiscal ainda não autorizado."}`
                  : o.status === "cancelled"
                    ? "Reserva de estoque liberada no cancelamento."
                    : o.dispatchedAt
                      ? "Estoque baixado na saída do pedido (reserva consumida)."
                      : "Sem reserva ativa."}
              </Notice>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
              {paid && !fiscalOk && canFiscal && !wrongBranch && (
                <ActionButton action={invoiceOrderAction.bind(null, o.id)} label={doc ? "Retransmitir / consultar NF-e" : "Emitir NF-e do pedido"} variant="primary" icon={<FileText className="size-4" aria-hidden />} confirm={`Emitir a NF-e do pedido ${o.code} pela filial ${branch?.name ?? ""}?`} />
              )}
              {paid && canFiscal && (
                <Link href={doc ? `/fiscal/nfe/${doc.id}` : `/fiscal/nfe/nova?origem=online_order:${o.id}`} className={buttonClass("secondary")}>
                  <FileText className="size-4" aria-hidden /> Revisar documento fiscal
                </Link>
              )}
              {canOrders &&
                (fiscalOk && paid && ["invoiced", "ready_for_pickup", "shipped"].includes(o.status) ? (
                  <Link href={`/comercio-digital/expedicao?pedido=${o.id}`} className={buttonClass("accent")}>
                    <PackageCheck className="size-4" aria-hidden /> Encaminhar para expedição
                  </Link>
                ) : (
                  !["cancelled", "returned", "delivered"].includes(o.status) && (
                    <span className={buttonClass("secondary", "md", "cursor-not-allowed opacity-50")} aria-disabled="true" title="A expedição exige pagamento aprovado e NF-e autorizada.">
                      <PackageCheck className="size-4" aria-hidden /> Encaminhar para expedição
                    </span>
                  )
                ))}
              {canCancel && cancellable && (
                <ActionButton action={cancelOrderAction.bind(null, o.id)} label="Cancelar pedido" variant="danger" icon={<Ban className="size-4" aria-hidden />} askReason="Motivo do cancelamento (o cliente é avisado)" />
              )}
              {o.status === "pending_payment" && o.payment?.status === "error" && canOrders && <ActionButton action={retryChargeAction.bind(null, o.id)} label="Gerar cobrança novamente" icon={<RefreshCcw className="size-4" aria-hidden />} />}
            </div>
            {wrongBranch && paid && !fiscalOk && <p className="px-4 pb-3 text-xs text-amber-800">A NF-e deste pedido é emitida pela filial {branch?.name}: selecione-a no topo da tela para emitir.</p>}
          </Card>
          {o.status === "return_requested" && canCancel && (
            <Card title="Devolução solicitada pelo cliente">
              <p className="text-sm text-slate-700">
                Motivo: <strong>{o.returnRequest?.reason === "withdrawal" ? "arrependimento (CDC art. 49)" : o.returnRequest?.reason === "defect" ? "produto com defeito" : "outro"}</strong> — {o.returnRequest?.details}
              </p>
              <p className="text-xs text-slate-500">Solicitada em {brDateTime(o.returnRequest?.requestedAt)}{deadline ? ` · prazo de arrependimento até ${brDate(deadline)}` : ""}</p>
              <ActionForm action={completeReturnAction.bind(null, o.id)} className="mt-3 space-y-2">
                <Field label="Conferência da mercadoria devolvida" required htmlFor="note"><Textarea id="note" name="note" rows={2} required placeholder="Estado da embalagem e dos produtos" /></Field>
                <button type="submit" className={buttonClass("primary")}><Undo2 className="size-4" aria-hidden /> Registrar devolução recebida (estoque e estorno)</button>
              </ActionForm>
              <p className="mt-2 text-xs text-slate-500">A entrada no estoque e o estorno são feitos uma única vez. Emita a NF-e de entrada da devolução no Fiscal, referenciando a chave da nota do pedido.</p>
            </Card>
          )}
          <Card title="Linha do tempo">
            <ol className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="w-32 shrink-0 text-xs text-slate-500">{brDateTime(e.at ?? e.createdAt)}</span>
                  <span className="text-slate-700">{e.summary} <span className="text-xs text-slate-400">— {e.actor}</span></span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Pagamento">
            <DefinitionList
              cols={1}
              items={[
                { label: "Meio", value: `${PAY_METHOD_LABEL[o.payment?.method as keyof typeof PAY_METHOD_LABEL] ?? "—"}${o.payment?.installments > 1 ? ` em ${o.payment.installments}x` : ""}` },
                { label: "Situação", value: <Badge tone={paid ? "good" : o.paymentStatus === "pending" ? "warn" : "neutral"}>{PAYMENT_STATUS_LABEL[o.paymentStatus as PaymentStatus] ?? o.paymentStatus}</Badge> },
                { label: "Gateway", value: `${o.payment?.simulated ? "Simulação" : o.payment?.provider ?? "—"} · ${o.payment?.providerRef ?? "sem cobrança"}` },
                o.paidAt && { label: "Aprovado em", value: brDateTime(o.paidAt) },
                o.payment?.fee != null && { label: "Taxa do gateway", value: formatMoney(o.payment.fee) },
                o.status === "pending_payment" && o.expiresAt && { label: "Prazo para pagar", value: brDateTime(o.expiresAt) },
                o.refundStatus && { label: "Estorno", value: o.refundStatus === "done" ? "Registrado" : "Pendente" },
                o.receivableTitleId && { label: "Recebível", value: <Link className="text-brand-700 hover:underline" href={`/financeiro/receber/${o.receivableTitleId}`}>Ver no contas a receber</Link> },
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">Pagamento aprovado não é crédito no banco: a conciliação fica no Banco Intercert.</p>
          </Card>
          <Card title="Documento fiscal">
            {doc ? (
              <DefinitionList
                cols={1}
                items={[
                  { label: "NF-e", value: <Link className="text-brand-700 hover:underline" href={`/fiscal/nfe/${doc.id}`}>{doc.number ? `nº ${doc.number}` : doc.ref}</Link> },
                  { label: "Situação", value: <Badge tone={doc.status === "authorized" ? "good" : ["rejected", "denied", "error"].includes(doc.status) ? "bad" : "warn"}>{DOC_STATUS_LABEL[doc.status] ?? doc.status}</Badge> },
                  doc.status !== "authorized" && doc.statusMessage && { label: "Motivo", value: <span className="text-sm text-amber-800">{doc.statusMessage}</span> },
                  doc.accessKey && { label: "Chave", value: <span className="break-all font-mono text-xs">{doc.accessKey}</span> },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-600">{paid ? "Nota ainda não emitida." : "A nota é emitida depois do pagamento aprovado."}</p>
            )}
            {o.payment?.simulated !== false && <p className="mt-2 text-xs text-slate-500">Com o fiscal em simulação, a nota não tem validade.</p>}
          </Card>
          <Card title="Cliente e entrega">
            <DefinitionList
              cols={1}
              items={[
                { label: "Cliente", value: o.customerId ? <Link className="text-brand-700 hover:underline" href={`/clientes/${o.customerId}`}>{o.customer?.name}</Link> : o.customer?.name },
                { label: "CPF/CNPJ", value: o.customer?.doc ? formatDoc(o.customer.doc) : "—" },
                { label: "Contato", value: `${o.customer?.email ?? ""} · ${formatPhone(o.customer?.phone)}` },
                { label: "Endereço", value: `${o.shippingAddress?.street}, ${o.shippingAddress?.number}${o.shippingAddress?.complement ? ` — ${o.shippingAddress.complement}` : ""} · ${o.shippingAddress?.district} · ${o.shippingAddress?.cityName}/${o.shippingAddress?.uf} · CEP ${String(o.shippingAddress?.zip ?? "").replace(/^(\d{5})(\d{3})$/, "$1-$2")}` },
                { label: "Modalidade", value: `${String(o.delivery?.label ?? "").startsWith(DELIVERY_LABEL[o.delivery?.mode as DeliveryMode] ?? "§") ? "" : `${DELIVERY_LABEL[o.delivery?.mode as DeliveryMode] ?? ""} — `}${o.delivery?.label ?? ""} (${o.delivery?.detail ?? ""})` },
                o.delivery?.mode === "pickup" && { label: "Retirada em", value: branch?.name ?? "—" },
                o.delivery?.trackingCode && { label: "Rastreio", value: o.delivery.trackingCode },
                o.consents && { label: "Consentimentos", value: `Termos aceitos em ${brDateTime(o.consents.termsAt)} · mensagens: ${o.consents.marketing ? "autorizadas" : "não autorizadas"}` },
              ]}
            />
          </Card>
          <Link href={`/loja/${st.slug}/pedido/${o.token}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
            <ExternalLink className="size-4" aria-hidden /> Página de acompanhamento do cliente
          </Link>
        </div>
      </div>
    </>
  );
}
