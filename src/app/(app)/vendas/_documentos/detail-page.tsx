import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Copy, FileText, Pencil, Printer, ScanBarcode, ShoppingCart } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { featureOn, requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { formatMoney, formatQty } from "@/lib/money";
import { addDays, formatDate, formatDateTime, today } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getSetting } from "@/lib/core/settings";
import { getIntegration } from "@/domain/integrations";
import { DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { docLabel, RESERVATION_LABEL, type SalesDocType } from "@/domain/sales-documents";
import { documentView } from "./queries";
import { DocumentForm } from "./document-form";
import { SendDocument } from "./send-document";
import { approveQuoteAction, cancelOrderAction, convertToOrderAction, duplicateDocumentAction, rejectQuoteAction, renewReservationAction } from "./actions";

const SENT_VIA: Record<string, string> = { whatsapp: "WhatsApp", email: "e-mail", manual: "manual", print: "impresso" };

/** Detalhe do orçamento/pedido: itens com faturado × saldo, faturamentos (PDV e NF-e), reserva, envio e histórico. */
export async function DocumentDetail({ type, params, searchParams }: { type: SalesDocType; params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; editar?: string }> }) {
  const s = await requireSession("sales");
  await requireFeaturePage(s, "documentoComercial");
  const { id } = await params;
  const { tab = "itens", editar } = await searchParams;
  const v = await documentView(s.ctx, id);
  if (!v || v.doc.type !== type) notFound();
  const { doc, items } = v;
  const quote = type === "quote";
  const base = `/vendas/${quote ? "orcamentos" : "pedidos"}/${id}`;
  const sameBranch = s.ctx.branchId === doc.branchId;
  const canQuote = canDo(s.user, "sales_doc.quote");
  const canOrder = canDo(s.user, "sales_doc.order");
  const canManage = quote ? canQuote : canOrder;
  const t = today();
  const expired = quote && doc.validUntil && doc.validUntil < t;
  const quoteOpen = quote && ["draft", "sent", "approved"].includes(doc.status) && !expired;
  const orderOpen = !quote && ["open", "partial"].includes(doc.status);
  const nfeInProgress = v.nfes.filter((n) => !["authorized", "cancelled", "denied", "unused", "discarded"].includes(n.status));
  const editable = quote ? doc.status !== "converted" : doc.status === "open" && (doc.invoicedQtyTotal ?? 0) === 0 && !nfeInProgress.length;
  const pending = items.reduce((a, i) => a + Math.max(0, i.qty - (i.invoicedQty ?? 0)), 0);
  const reservedBySku = new Map<string, number>();
  for (const r of v.reservations) reservedBySku.set(r.skuId, (reservedBySku.get(r.skuId) ?? 0) + r.qty);

  if (editar === "1" && sameBranch && canManage && editable) {
    const [customers, sellers, priceTables, terms] = await Promise.all([lookups.customers(s.ctx), lookups.users(s.ctx), lookups.priceTables(s.ctx), lookups.paymentTerms(s.ctx)]);
    return (
      <>
        <PageHeader title={`Editar ${docLabel(doc).toLowerCase()}`} crumbs={[{ label: quote ? "Orçamentos" : "Pedidos de venda", href: `/vendas/${quote ? "orcamentos" : "pedidos"}` }, { label: `nº ${doc.number}`, href: base }, { label: "Editar" }]} description={quote ? "Salvar volta o orçamento a rascunho (reenvie ao cliente)." : "Salvar refaz a reserva de estoque do pedido."} />
        <DocumentForm
          initial={{
            id, type, number: doc.number, customerId: doc.customerId, contactName: doc.customerId ? null : doc.customerSnapshot?.name, contactPhone: doc.customerId ? null : doc.customerSnapshot?.phone, sellerId: doc.sellerId, priceTableId: doc.priceTableId,
            items: items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice !== i.listPrice ? i.unitPrice : null, itemDiscount: i.itemDiscount, itemSurcharge: i.itemSurcharge ?? 0, sku: i.sku, name: i.description, description: i.description, unitCode: i.unitCode, listPrice: i.listPrice, wholesalePrice: null, wholesaleMinQty: null, available: null, service: Boolean(i.service), maxDiscountBps: i.maxDiscountBps ?? null })),
            globalDiscount: doc.globalDiscountBps ? 0 : doc.globalDiscount, globalDiscountBps: doc.globalDiscountBps ?? 0, surcharge: doc.surcharge ?? 0, validUntil: doc.validUntil && doc.validUntil >= t ? doc.validUntil : null, deliveryDate: doc.deliveryDate,
            paymentTermId: doc.paymentTermId, paymentNotes: doc.paymentNotes, notes: doc.notes, internalNotes: doc.internalNotes,
          }}
          customers={customers}
          sellers={sellers}
          priceTables={priceTables}
          terms={terms}
          defaultValidUntil={quote ? addDays(t, Number(await getSetting<number>(s.ctx.store, s.ctx.companyId, s.ctx.branchId, "sales.quoteValidityDays", 10)) || 10) : null}
          discountLimitBps={s.user.discountLimitBps ?? 0}
          canOverLimit={canDo(s.user, "sale.discount_over_limit")}
        />
      </>
    );
  }

  const email = await getIntegration(s.ctx.store, s.ctx.companyId, null, "email");
  const canPdv = can(s.user, "pdv", "create") && (await featureOn(s, "documentoComercial"));
  const canNfe = canDo(s.user, "fiscal.issue") && can(s.user, "fiscal", "create");
  const c = doc.customerSnapshot ?? {};
  const shortage = (doc.reservationShortage ?? []) as Array<{ sku: string; missing: number }>;
  return (
    <>
      <PageHeader
        title={docLabel(doc)}
        crumbs={[{ label: quote ? "Orçamentos" : "Pedidos de venda", href: `/vendas/${quote ? "orcamentos" : "pedidos"}` }, { label: `nº ${doc.number}` }]}
        badges={
          <>
            <StatusBadge kind={quote ? "sales_quote" : "sales_order"} status={expired && ["draft", "sent", "approved"].includes(doc.status) ? "expired" : doc.status} />
            {!quote && orderOpen && <StatusBadge kind="reservation" status={doc.reservationStatus ?? "none"} />}
            {(doc.revision ?? 1) > 1 && <Badge tone="info">Revisão {doc.revision}</Badge>}
            {doc.sentAt && <Badge tone="brand">Enviado ({SENT_VIA[doc.sentVia] ?? doc.sentVia}) {formatDate(doc.sentAt)}</Badge>}
          </>
        }
        description={`${c.name ?? "Sem cliente"} · ${v.branch?.name ?? ""} · criado em ${formatDateTime(doc.createdAt)} por ${v.createdByName ?? "—"}${v.sellerName ? ` · vendedor ${v.sellerName}` : ""}`}
        actions={
          <>
            <LinkButton href={`${base}/imprimir?print=1`}><Printer className="size-4" /> Imprimir</LinkButton>
            {sameBranch && canManage && (
              <>
                {editable && <LinkButton href={`${base}?editar=1`}><Pencil className="size-4" /> Editar</LinkButton>}
                {canQuote && <ActionButton action={duplicateDocumentAction.bind(null, id)} label="Duplicar" icon={<Copy className="size-4" />} confirm="Criar um novo orçamento (rascunho) com os mesmos itens? Os preços são revalidados pela tabela vigente." />}
                {(quoteOpen || orderOpen) && <SendDocument id={id} phone={c.phone ?? null} email={c.email ?? null} emailConfigured={Boolean(email)} label={docLabel(doc).toLowerCase()} />}
                {quote && ["draft", "sent"].includes(doc.status) && !expired && <ActionButton action={approveQuoteAction.bind(null, id)} label="Cliente aprovou" variant="secondary" confirm="Registrar que o cliente aprovou o orçamento?" />}
                {quote && ["draft", "sent", "approved"].includes(doc.status) && <ActionButton action={rejectQuoteAction.bind(null, id)} label="Recusado" variant="ghost" askReason="Motivo da recusa (ex.: preço, prazo, desistência):" />}
              </>
            )}
            {sameBranch && quoteOpen && canOrder && <ActionButton action={convertToOrderAction.bind(null, id)} label="Converter em pedido" variant="primary" icon={<FileText className="size-4" />} confirm="Converter o orçamento em pedido de venda? O pedido reserva o estoque disponível." />}
            {sameBranch && (quoteOpen || orderOpen) && canPdv && <LinkButton href={`/pdv?importar=${id}`} variant="accent"><ScanBarcode className="size-4" /> Faturar no PDV</LinkButton>}
            {sameBranch && orderOpen && canNfe && !nfeInProgress.length && <LinkButton href={`/fiscal/nfe/nova?origem=sales_document:${id}`} variant="primary"><FileText className="size-4" /> Emitir NF-e</LinkButton>}
            {sameBranch && orderOpen && canOrder && doc.reservationStatus !== "active" && <ActionButton action={renewReservationAction.bind(null, id)} label="Reservar estoque" confirm="Reservar o saldo a faturar sobre o disponível atual pelo prazo do parâmetro?" />}
            {sameBranch && orderOpen && canDo(s.user, "sales_doc.cancel") && <ActionButton action={cancelOrderAction.bind(null, id)} label="Cancelar pedido" variant="danger" askReason="Motivo do cancelamento (o saldo não faturado é cancelado e a reserva liberada):" />}
          </>
        }
      />
      {!sameBranch && <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">Documento da filial {v.branch?.name}. Selecione essa filial para executar ações.</p>}
      {expired && ["draft", "sent", "approved"].includes(doc.status) && <Notice tone="warn" title="Orçamento vencido">A validade terminou em {formatDate(doc.validUntil)}. Edite o orçamento para definir nova validade antes de vender ou converter.</Notice>}
      {doc.status === "rejected" && <Notice tone="bad" title="Recusado pelo cliente">{doc.rejectReason}</Notice>}
      {doc.status === "cancelled" && <Notice tone="bad" title={`Pedido cancelado em ${formatDateTime(doc.cancelledAt)}`}>{doc.cancelReason}</Notice>}
      {nfeInProgress.length > 0 && <Notice tone="info" title="NF-e em andamento">{nfeInProgress.map((n) => <Link key={n.id} className="mr-2 underline" href={`/fiscal/nfe/${n.id}`}>NF-e {n.number ? `nº ${n.number}` : n.ref} ({DOC_STATUS_LABEL[n.status]})</Link>)} — as quantidades dela não podem ser faturadas no PDV até a autorização ou o descarte.</Notice>}
      {orderOpen && shortage.length > 0 && <Notice tone="warn" title="Reserva parcial">Sem saldo disponível para reservar: {shortage.map((x) => `${x.sku} (faltam ${formatQty(x.missing)})`).join(", ")}. O pedido pode ser faturado quando houver estoque; use “Reservar estoque” após a entrada.</Notice>}
      <div className="my-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Total do ${quote ? "orçamento" : "pedido"}`} value={formatMoney(doc.total)} hint={`Bruto ${formatMoney(doc.subtotal)} − desc. ${formatMoney(doc.discountTotal)}${doc.surchargeTotal ? ` + acrésc. ${formatMoney(doc.surchargeTotal)}` : ""}`} />
        {quote ? (
          <>
            <Stat label="Validade" value={formatDate(doc.validUntil)} tone={expired ? "bad" : doc.validUntil && doc.validUntil <= addDays(t, 3) ? "warn" : "default"} hint={expired ? "Vencido" : "Parâmetro de validade padrão em Vendas e PDV"} />
            <Stat label="Itens" value={items.length} hint={`${formatQty(doc.qtyTotal)} unidades`} />
            <Stat label="Conversão" value={doc.convertedOrderId ? "Pedido" : doc.convertedSaleId ? "Venda (PDV)" : "—"} hint={v.related.find((r) => r.id === doc.convertedOrderId) ? `Pedido nº ${v.related.find((r) => r.id === doc.convertedOrderId)!.number}` : doc.convertedSaleId ? `Venda ${v.sales.find((x) => x.id === doc.convertedSaleId)?.number ?? ""}` : "Aguardando o cliente"} href={doc.convertedOrderId ? `/vendas/pedidos/${doc.convertedOrderId}` : doc.convertedSaleId ? `/vendas/${doc.convertedSaleId}` : undefined} />
          </>
        ) : (
          <>
            <Stat label="Faturado" value={`${formatQty(doc.invoicedQtyTotal ?? 0)} de ${formatQty(doc.qtyTotal)}`} hint={`${v.sales.filter((x) => x.status === "completed").length} venda(s) no PDV · ${v.nfes.filter((n) => n.status === "authorized").length} NF-e autorizada(s)`} href={`${base}?tab=faturamento`} />
            <Stat label="Saldo a faturar" value={formatQty(pending)} tone={pending && doc.status !== "cancelled" ? "warn" : "default"} hint={doc.deliveryDate ? `Entrega prevista ${formatDate(doc.deliveryDate)}` : undefined} />
            <Stat label="Reserva de estoque" value={RESERVATION_LABEL[doc.reservationStatus ?? "none"] ?? "—"} hint={doc.reservationStatus === "active" && doc.reserveUntil ? `Até ${formatDate(doc.reserveUntil)} · ${formatQty(v.reservations.reduce((a, r) => a + r.qty, 0))} un.` : undefined} tone={doc.reservationStatus === "expired" ? "warn" : "default"} />
          </>
        )}
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "itens", label: "Itens e condições" },
          { key: "faturamento", label: quote ? "Conversões" : "Faturamento", count: v.sales.length + v.nfes.length + v.related.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "itens" && (
        <div className="space-y-4">
          <Card bodyClass="p-0" title="Itens">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>#</th><th>Produto</th><th className="text-right">Qtd.</th>
                    {!quote && <><th className="text-right">Faturado</th><th className="text-right">Saldo</th><th className="text-right">Reservado</th></>}
                    <th className="text-right">Preço unit.</th><th className="text-right">Desconto</th><th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const rest = Math.max(0, i.qty - (i.invoicedQty ?? 0));
                    return (
                      <tr key={i.id}>
                        <td className="tabular text-slate-500">{i.seq}</td>
                        <td>{i.productId ? <Link className="text-brand-700 hover:underline" href={`/produtos/${i.productId}`}>{i.description}</Link> : i.description}<span className="block text-xs text-slate-500">{i.sku}{i.service ? " · serviço" : ""}{i.wholesale ? " · atacado" : ""}</span></td>
                        <td className="tabular text-right">{formatQty(i.qty, i.unitCode)}</td>
                        {!quote && (
                          <>
                            <td className="tabular text-right">{i.invoicedQty ? formatQty(i.invoicedQty) : "—"}</td>
                            <td className="tabular text-right">{rest && doc.status !== "cancelled" ? <span className="text-amber-700">{formatQty(rest)}</span> : "—"}</td>
                            <td className="tabular text-right text-slate-500">{i.service ? "—" : reservedBySku.has(i.skuId) ? formatQty(reservedBySku.get(i.skuId)) : "—"}</td>
                          </>
                        )}
                        <td className="tabular text-right">{formatMoney(i.unitPrice)}{i.unitPrice !== i.listPrice && <span className="block text-xs text-slate-400">tabela {formatMoney(i.listPrice)}</span>}</td>
                        <td className="tabular text-right">{(i.itemDiscount ?? 0) + (i.globalDiscount ?? 0) ? formatMoney((i.itemDiscount ?? 0) + (i.globalDiscount ?? 0)) : "—"}</td>
                        <td className="tabular text-right font-medium">{formatMoney(i.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Cliente e condições">
            <DefinitionList
              cols={3}
              items={[
                { label: "Cliente", value: doc.customerId ? <Link className="text-brand-700 hover:underline" href={`/clientes/${doc.customerId}`}>{c.name}</Link> : (c.name ?? "—") },
                { label: "CPF/CNPJ", value: c.doc ? formatDoc(c.doc) : "—" },
                { label: "Telefone / e-mail", value: [c.phone ? formatPhone(c.phone) : "", c.email ?? ""].filter(Boolean).join(" · ") || "—" },
                { label: "Vendedor", value: v.sellerName ?? "—" },
                { label: "Tabela de preço", value: v.priceTableName ?? "Padrão" },
                { label: "Condição de pagamento", value: [v.termName, doc.paymentNotes].filter(Boolean).join(" · ") || "—" },
                quote ? { label: "Validade", value: formatDate(doc.validUntil) } : { label: "Reserva até", value: doc.reservationStatus === "active" ? formatDate(doc.reserveUntil) : "—" },
                { label: "Previsão de entrega", value: formatDate(doc.deliveryDate) },
                { label: "Aprovação de desconto", value: doc.discountApprovedBy ? "Autorizado por supervisor" : "Dentro do limite" },
                { label: "Observações ao cliente", value: doc.notes ?? "—" },
                { label: "Observações internas", value: doc.internalNotes ?? "—" },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === "faturamento" && (
        <div className="space-y-4">
          {v.related.length > 0 && (
            <Card title="Documentos relacionados">
              <ul className="space-y-1 text-sm">
                {v.related.map((r) => (
                  <li key={r.id}>
                    <Link className="text-brand-700 hover:underline" href={`/vendas/${r.type === "quote" ? "orcamentos" : "pedidos"}/${r.id}`}>{docLabel(r)}</Link> · {r.id === doc.sourceQuoteId ? "orçamento de origem" : r.id === doc.convertedOrderId ? "pedido gerado" : "copiado de"} · {formatMoney(r.total)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card bodyClass="p-0" title="Vendas no PDV">
            {v.sales.length ? (
              <table className="table-base w-full text-sm">
                <thead><tr><th>Venda</th><th>Data</th><th>Situação</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {v.sales.map((x) => (
                    <tr key={x.id}><td><Link className="text-brand-700 hover:underline" href={`/vendas/${x.id}`}>nº {x.number}</Link></td><td>{formatDateTime(x.completedAt)}</td><td><StatusBadge kind="sale" status={x.status} /></td><td className="tabular text-right">{formatMoney(x.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-4 text-sm text-slate-500">Nenhuma venda no PDV a partir deste documento.</p>
            )}
          </Card>
          {!quote && (
            <Card bodyClass="p-0" title="NF-e do pedido" actions={sameBranch && orderOpen && canNfe && !nfeInProgress.length ? <LinkButton size="sm" href={`/fiscal/nfe/nova?origem=sales_document:${id}`}><FileText className="size-4" /> Emitir NF-e do saldo</LinkButton> : undefined}>
              {v.nfes.length ? (
                <table className="table-base w-full text-sm">
                  <thead><tr><th>NF-e</th><th>Criada em</th><th>Situação</th><th className="text-right">Valor</th></tr></thead>
                  <tbody>
                    {v.nfes.map((n) => (
                      <tr key={n.id}><td><Link className="text-brand-700 hover:underline" href={`/fiscal/nfe/${n.id}`}>{n.number ? `nº ${n.number}` : n.ref}</Link> {n.isSimulated && <SimBadge />}</td><td>{formatDateTime(n.createdAt)}</td><td><StatusBadge kind="fiscal" status={n.status} /></td><td className="tabular text-right">{formatMoney(n.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-sm text-slate-500">Nenhuma NF-e emitida para este pedido.</p>
              )}
            </Card>
          )}
          {!quote && (
            <Card title="Quantidades faturadas por origem">
              {v.billings.length ? (
                <ul className="space-y-1 text-sm">
                  {v.billings.map((b) => (
                    <li key={b.id} className={b.reversed ? "text-slate-400 line-through" : ""}>
                      {formatDateTime(b.at)} · {b.source === "sale" ? `Venda nº ${b.sourceNumber ?? ""}` : `NF-e nº ${b.sourceNumber ?? ""}`}: {b.lines.length ? b.lines.map((l) => `item ${l.seq} ${formatQty(l.qty)}`).join(", ") : "—"}
                      {b.reversed && <span className="ml-1 no-underline">(desfeito por cancelamento)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Sem faturamento. Fature no PDV (“Faturar no PDV”, inclusive parcial) ou emita a NF-e do saldo: o pedido não movimenta estoque nem financeiro — a venda ou a NF-e é que movimentam, uma única vez.</p>
              )}
            </Card>
          )}
        </div>
      )}
      {tab === "historico" && (
        <Card title="Histórico">
          <Timeline store={s.ctx.store} refs={[`sales_document:${id}`]} />
        </Card>
      )}
      <p className="mt-4 text-xs text-slate-500">
        <ShoppingCart className="mr-1 inline size-3.5" aria-hidden />
        {quote ? "O orçamento não reserva estoque nem gera títulos." : "Reserva: disponível = físico − reservado. Faturar no PDV ou em NF-e consome a reserva; cancelamento e expiração (rotina diária) liberam."}
      </p>
    </>
  );
}
