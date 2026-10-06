import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Printer, Send, ShoppingCart, Undo2 } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { formatBps, formatMoney, formatQty, marginBps } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { dueState } from "@/domain/finance";
import { MOVEMENT_LABEL } from "@/domain/stock";
import { COMPENSATION_LABEL, REFUND_METHOD_LABEL } from "@/domain/sales";
import { saleDetail } from "../queries";
import { cancelSaleAction } from "../actions";
import { EmailReceipt, FiscalStatus, WhatsAppLink } from "../sale-widgets";
import { MODEL_NAME } from "../labels";

export const metadata = { title: "Detalhes da venda" };

const ORIGIN: Record<string, string> = { pdv: "PDV", exchange: "Troca" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("sales");
  const { id } = await params;
  const { tab = "visao" } = await searchParams;
  const d = await saleDetail(s.ctx, id);
  if (!d) notFound();
  const { sale, items, payments } = d;
  const [users, terminals, branches, priceTables, customers] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "terminals"), nameMap(s.ctx, "branches"), nameMap(s.ctx, "price_tables"), sale.customerId ? s.ctx.store.get("customers", sale.customerId) : null]);
  const c = sale.customerSnapshot;
  const base = `/vendas/${id}`;
  const units = items.reduce((a, i) => a + i.qty, 0);
  const returnable = items.reduce((a, i) => a + (i.qty - (i.returnedQty ?? 0)), 0);
  const netRevenue = sale.total - (sale.returnedTotal ?? 0);
  const netCost = (sale.costTotal ?? 0) - (sale.returnedCost ?? 0);
  const margin = netRevenue - netCost;
  const mBps = marginBps(netRevenue, netCost);
  const doc = d.docs.find((x) => x.originType === "sale") ?? null;
  // a prazo: título da venda e as renegociações dele (o saldo renegociado passa ao novo título)
  const deferred = d.installments.filter((i) => i.kind === "receivable" && ["sale", "renegotiation"].includes(d.titles.find((t) => t.id === i.titleId)?.originType ?? ""));
  const openDeferred = deferred.reduce((a, i) => a + (i.balance ?? 0), 0);
  const refundPending = payments.filter((p) => p.status === "refund_pending");
  const refundManual = payments.filter((p) => p.status === "refund_manual");
  const paymentHint = sale.status === "cancelled" ? (refundPending.length ? "Estorno Pix pendente no provedor" : refundManual.length ? "Devolver Pix manual ao cliente" : "Estornado no cancelamento") : sale.paymentStatus === "paid" ? (deferred.length && (sale.returnedTotal ?? 0) > 0 && openDeferred === 0 ? "Nada a receber (saldo abatido por devolução)" : "Recebido integralmente") : `A receber ${formatMoney(openDeferred)} em ${deferred.filter((i) => i.balance > 0).length} parcela(s)`;
  const stockDone = sale.effectsStatus === "done";
  const canCancel = sale.status === "completed" && (sale.returnedTotal ?? 0) === 0 && canDo(s.user, "sale.cancel") && s.ctx.branchId === sale.branchId;
  const canReturn = sale.status === "completed" && returnable > 0 && canDo(s.user, "sale.return") && s.ctx.branchId === sale.branchId;
  const titleLink = (t: any) => `/financeiro/${t.kind === "payable" ? "pagar" : "receber"}/${t.id}`;
  const waText = `Comprovante da compra nº ${sale.number} (${formatDateTime(sale.completedAt)}) — total ${formatMoney(sale.total)}.`;
  return (
    <>
      <PageHeader
        title={`Venda nº ${sale.number}`}
        crumbs={[{ label: "Vendas e caixa" }, { label: "Histórico de vendas", href: "/vendas" }, { label: `nº ${sale.number}` }]}
        badges={
          <>
            <StatusBadge kind="sale" status={sale.status} />
            <StatusBadge kind="payment" status={sale.paymentStatus} />
            <StatusBadge kind="fiscal" status={sale.fiscalStatus} />
            {(sale.returnedTotal ?? 0) > 0 && <Badge tone="warn">{sale.returnedTotal >= sale.total ? "Devolvida" : "Devolução parcial"}</Badge>}
            {sale.origin === "exchange" && <Badge tone="info">Troca</Badge>}
          </>
        }
        description={`${formatDateTime(sale.completedAt)} · ${branches.get(sale.branchId) ?? ""} · ${sale.terminalId ? terminals.get(sale.terminalId) : "—"} · Operador: ${users.get(sale.operatorId) ?? "—"}`}
        actions={
          <>
            <LinkButton href={`${base}/recibo?print=1`} target="_blank"><Printer className="size-4" /> Imprimir</LinkButton>
            <LinkButton href={`${base}?tab=visao#enviar`}><Send className="size-4" /> Enviar</LinkButton>
            {canReturn && <LinkButton href={`${base}/devolucoes`}><Undo2 className="size-4" /> Troca ou devolução</LinkButton>}
            {canCancel && (
              <ActionButton
                action={cancelSaleAction.bind(null, id)}
                label="Cancelar venda"
                icon={<Ban className="size-4" />}
                variant="danger"
                askReason="Motivo do cancelamento (obrigatório). Estoque, caixa, títulos e documento fiscal serão estornados; cartões devem ser estornados na maquininha/TEF; Pix integrado tem o estorno solicitado ao provedor e Pix manual deve ser devolvido ao cliente."
              />
            )}
            {sale.customerId && can(s.user, "pdv", "create") && s.ctx.branchId && <LinkButton href={`/pdv?cliente=${sale.customerId}`} variant="ghost"><ShoppingCart className="size-4" /> Nova venda</LinkButton>}
          </>
        }
      />
      {sale.status === "cancelled" && (
        <div className="mb-4">
          <Notice tone="bad" title={`Venda cancelada em ${formatDateTime(sale.cancelledAt)} por ${users.get(sale.cancelledBy) ?? "—"}`}>
            Motivo: {sale.cancelReason}. A venda original é preservada;{" "}
            {sale.cancelEffectsStatus === "pending" ? "os efeitos do cancelamento (estoque, títulos, fiscal, estorno Pix) estão sendo concluídos pela tarefa durável." : "os efeitos foram estornados (veja as abas)."}
            {Array.isArray(sale.cancelPending) && sale.cancelPending.length > 0 && (
              <>
                {" "}<b>Pendente no Financeiro:</b> título(s){" "}
                {sale.cancelPending.map((p: { titleId: string; number: number; message: string }, i: number) => (
                  <span key={p.titleId}>{i > 0 ? "; " : ""}<Link className="underline" href={`/financeiro/receber/${p.titleId}`}>nº {p.number}</Link> ({p.message})</span>
                ))}{" "}
                mantido(s) por terem recebimento — o Financeiro foi notificado para estornar as baixas, devolver o valor ao cliente e cancelar os títulos.
              </>
            )}
            {refundPending.length > 0 && <> Estorno Pix de {formatMoney(refundPending.reduce((a, p) => a + p.amount, 0))} <b>pendente no provedor</b>{refundPending[0].refundMessage ? ` (${refundPending[0].refundMessage})` : ""}.</>}
            {refundManual.length > 0 && <> Pix manual: <b>devolva {formatMoney(refundManual.reduce((a, p) => a + p.amount, 0))} ao cliente</b> pela conta do Pix (o sistema não estorna Pix manual).</>}
          </Notice>
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total da venda" value={formatMoney(sale.total)} hint={`${formatQty(units)} unidade(s) • ${items.length} produto(s)${sale.discountTotal ? ` · desc. ${formatMoney(sale.discountTotal)}` : ""}`} />
        <Stat label="Pagamento" value={[...new Set(payments.map((p) => p.methodName))].join(" + ") || "—"} hint={paymentHint} href={`${base}?tab=pagamentos`} tone={sale.paymentStatus === "pending" ? "warn" : "default"} />
        <Stat label="Documento fiscal" value={doc ? `${MODEL_NAME[doc.model] ?? doc.model} ${doc.number ? String(doc.number).padStart(9, "0") : "pendente"}` : "Sem documento"} hint={doc ? `${doc.series ? `Série ${doc.series} • ` : ""}${doc.status === "authorized" ? "Autorizada" : "Situação: " + doc.status}${doc.isSimulated ? " (simulação)" : ""}` : "—"} href={`${base}?tab=fiscal`} tone={doc && doc.status !== "authorized" ? "warn" : "default"} />
        <Stat label="Margem estimada" value={sale.status === "cancelled" ? "—" : formatMoney(margin)} hint={sale.status === "cancelled" ? "Venda cancelada" : `${mBps == null ? "sem receita" : formatBps(mBps, 1)} sobre a venda líquida · custo registrado ${formatMoney(netCost)}`} tone={margin < 0 ? "bad" : "default"} />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {sale.status === "cancelled" ? "Estoque devolvido no cancelamento." : stockDone ? `Estoque baixado na ${branches.get(sale.branchId)}.` : "Baixa de estoque pendente (tarefa em execução)."}{" "}
        {(sale.returnedTotal ?? 0) > 0 && `Devolvido: ${formatMoney(sale.returnedTotal)}.`}
      </p>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "visao", label: "Visão geral" },
          { key: "pagamentos", label: "Pagamento e financeiro", count: payments.length },
          { key: "fiscal", label: "Fiscal", count: d.docs.length },
          { key: "estoque", label: "Estoque", count: d.stockMovs.length },
          { key: "devolucoes", label: "Trocas e devoluções", count: d.returns.length },
          { key: "historico", label: "Histórico e auditoria" },
        ]}
      />
      {tab === "visao" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Produtos da venda" className="lg:col-span-2" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right" title="Desconto no item + rateio do desconto geral; acréscimos">Desc. / acrésc.</th><th className="text-right">Subtotal</th><th className="text-right">Custo reg.</th><th className="text-right">Devolvido</th></tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}<span className="block font-mono text-xs text-slate-500">{i.sku}{i.ncm ? ` · NCM ${i.ncm}` : ""}</span></td>
                      <td className="tabular text-right">{formatQty(i.qty, i.unitCode)}</td>
                      <td className="tabular text-right">{formatMoney(i.unitPrice)}</td>
                      <td className="tabular text-right text-xs">
                        {i.itemDiscount ? <span className="block text-red-700">item −{formatMoney(i.itemDiscount)}</span> : null}
                        {i.globalDiscount ? <span className="block text-red-700">rateio −{formatMoney(i.globalDiscount)}</span> : null}
                        {i.surcharge ? <span className="block text-emerald-700">+{formatMoney(i.surcharge)}</span> : null}
                        {!i.itemDiscount && !i.globalDiscount && !i.surcharge ? "—" : null}
                      </td>
                      <td className="tabular text-right font-medium">{formatMoney(i.total)}</td>
                      <td className="tabular text-right text-slate-500">{formatMoney(i.costTotal)}</td>
                      <td className="tabular text-right">{i.returnedQty ? formatQty(i.returnedQty) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 text-sm"><td colSpan={4} className="px-3 py-1.5 text-right text-slate-500">Subtotal (bruto)</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(sale.subtotal)}</td><td colSpan={2} /></tr>
                  <tr className="bg-slate-50 text-sm"><td colSpan={4} className="px-3 py-1.5 text-right text-slate-500">Descontos (itens + rateio do desconto geral)</td><td className="tabular px-3 py-1.5 text-right text-red-700">−{formatMoney(sale.discountTotal)}</td><td colSpan={2} /></tr>
                  {sale.surchargeTotal > 0 && <tr className="bg-slate-50 text-sm"><td colSpan={4} className="px-3 py-1.5 text-right text-slate-500">Acréscimos</td><td className="tabular px-3 py-1.5 text-right">+{formatMoney(sale.surchargeTotal)}</td><td colSpan={2} /></tr>}
                  <tr className="bg-slate-50 font-semibold"><td colSpan={4} className="px-3 py-2 text-right">Total</td><td className="tabular px-3 py-2 text-right text-brand-800">{formatMoney(sale.total)}</td><td className="tabular px-3 py-2 text-right text-slate-500">{formatMoney(sale.costTotal)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <div className="space-y-4">
            <Card title="Cliente e operação">
              <DefinitionList
                cols={1}
                items={[
                  { label: "Cliente", value: c ? (sale.customerId ? <Link className="text-brand-700 hover:underline" href={`/clientes/${sale.customerId}`}>{c.name}</Link> : c.name) : "Consumidor final (não identificado)" },
                  { label: "CPF/CNPJ", value: c?.doc ? formatDoc(c.doc) : "Não informado" },
                  { label: "Celular", value: formatPhone(customers?.mobile ?? c?.phone) || "—" },
                  { label: "Vendedor", value: sale.sellerId ? users.get(sale.sellerId) : "— (operador)" },
                  { label: "Operador", value: users.get(sale.operatorId) },
                  { label: "Tabela de preço", value: sale.priceTableId ? priceTables.get(sale.priceTableId) : "—" },
                  { label: "Origem", value: `${ORIGIN[sale.origin] ?? sale.origin} — ${sale.terminalId ? terminals.get(sale.terminalId) : "—"}` },
                  { label: "Filial", value: branches.get(sale.branchId) },
                  { label: "Sessão de caixa", value: d.session ? <Link className="text-brand-700 hover:underline" href={`/caixa/${d.session.id}`}>Caixa nº {d.session.number} ({formatDate(d.session.openedAt)})</Link> : "—" },
                  sale.discountApprovedBy && { label: "Desconto autorizado por", value: users.get(sale.discountApprovedBy) },
                  d.origin && { label: "Troca da devolução", value: <Link className="text-brand-700 hover:underline" href={`/vendas/devolucoes/${d.origin.id}`}>nº {d.origin.number}{d.originSale ? ` (venda nº ${d.originSale.number})` : ""}</Link> },
                  sale.notes && { label: "Observações", value: sale.notes },
                ]}
              />
            </Card>
            <Card title="Enviar comprovante" description="Pelo canal de e-mail configurado ou pelo WhatsApp do operador">
              <div id="enviar" className="space-y-3">
                <EmailReceipt saleId={id} defaultEmail={c?.email ?? null} />
                <WhatsAppLink phone={customers?.mobile ?? c?.phone ?? null} text={waText} />
              </div>
            </Card>
          </div>
        </div>
      )}
      {tab === "pagamentos" && (
        <div className="space-y-4">
          <Card title="Meios de pagamento" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Meio</th><th>Identificação</th><th className="text-right">Parcelas</th><th className="text-right">Recebido</th><th className="text-right">Troco</th><th className="text-right">Aplicado</th><th className="text-right">Taxa prevista</th><th className="text-right">Líquido</th><th>Liquidação</th><th>Situação</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.methodName}{p.manual && ["pix", "debit", "credit"].includes(p.methodKind) && <Badge className="ml-1">manual</Badge>}</td>
                      <td className="text-xs text-slate-600">{[p.nsu && `NSU ${p.nsu}`, p.authCode && `Aut. ${p.authCode}`, p.cardBrand, p.providerRef && `Ref. ${p.providerRef}`, p.provider && `via ${p.provider}`].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="tabular text-right">{p.installments ?? 1}</td>
                      <td className="tabular text-right">{formatMoney(p.received)}</td>
                      <td className="tabular text-right">{p.change ? formatMoney(p.change) : "—"}</td>
                      <td className="tabular text-right font-medium">{formatMoney(p.amount)}</td>
                      <td className="tabular text-right">{p.feeAmount ? formatMoney(p.feeAmount) : "—"}</td>
                      <td className="tabular text-right">{formatMoney(p.netAmount)}</td>
                      <td>{p.settlementDate ? formatDate(p.settlementDate) : p.dueDates?.length ? `${p.dueDates.length} venc.` : "—"}</td>
                      <td><StatusBadge kind="payment" status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Títulos e parcelas" description="Recebíveis da adquirente (cartões), crediário/boleto e obrigações de estorno" bodyClass="p-0">
            {d.titles.length === 0 ? (
              <EmptyState title="Sem títulos" description="Pagamentos à vista em dinheiro/Pix entram direto nas contas (veja lançamentos)." />
            ) : (
              <table className="table-base w-full text-sm">
                <thead><tr><th>Título</th><th>Parcela</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th><th className="text-right">Saldo</th><th>Baixas</th></tr></thead>
                <tbody>
                  {d.installments.map((i) => {
                    const t = d.titles.find((x) => x.id === i.titleId)!;
                    // somente baixas e estornos (marcadores de renegociação têm valor 0); abatimentos de devolução à parte
                    const st = d.settlements.filter((x) => x.installmentId === i.id && (x.kind === "settlement" || x.kind === "reversal"));
                    const ab = d.settlements.filter((x) => x.installmentId === i.id && x.kind === "abatement" && x.status === "active");
                    return (
                      <tr key={i.id}>
                        <td><Link className="text-brand-700 hover:underline" href={titleLink(t)}>{t.kind === "payable" ? "A pagar" : "A receber"} nº {t.number}</Link><span className="block text-xs text-slate-500">{t.partyName} · {t.description}</span></td>
                        <td>{i.number}/{t.installmentsCount}</td>
                        <td>{formatDate(i.dueDate)}</td>
                        <td><StatusBadge kind="title" status={t.status === "cancelled" ? "cancelled" : dueState(i)} /></td>
                        <td className="tabular text-right">{formatMoney(i.amount)}</td>
                        <td className="tabular text-right">{formatMoney(i.balance)}</td>
                        <td className="text-xs">
                          {st.map((x) => <span key={x.id} className="block">{formatDate(x.date)} · {formatMoney(x.total)} {x.status !== "active" ? "(estornada)" : ""}</span>)}
                          {ab.map((x) => <span key={x.id} className="block text-amber-800">{formatDate(x.date)} · abatido {formatMoney(x.principal)} ({x.reference ?? "devolução"})</span>)}
                          {!st.length && !ab.length && "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Lançamentos em conta e caixa" bodyClass="p-0">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Data</th><th>Conta / sessão</th><th>Descrição</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {d.entries.map((e) => (
                  <tr key={e.id}><td>{formatDate(e.date)}</td><td><Link className="text-brand-700 hover:underline" href={`/financeiro/contas/${e.accountId}`}>{d.accounts.get(e.accountId) ?? "Conta"}</Link></td><td>{e.description}</td><td className={`tabular text-right ${e.amount < 0 ? "text-red-700" : ""}`}>{formatMoney(e.amount)}</td></tr>
                ))}
                {d.cashMovs.map((m) => (
                  <tr key={m.id}><td>{formatDateTime(m.occurredAt)}</td><td><Link className="text-brand-700 hover:underline" href={`/caixa/${m.sessionId}`}>Movimento de caixa</Link></td><td>{m.reason}</td><td className={`tabular text-right ${m.amount < 0 ? "text-red-700" : ""}`}>{formatMoney(m.amount)}</td></tr>
                ))}
                {d.entries.length + d.cashMovs.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Sem lançamentos diretos (pagamentos a prazo/cartão geram títulos).</td></tr>}
              </tbody>
            </table>
          </Card>
          {d.vouchers.length > 0 && (
            <Card title="Vales-crédito relacionados" bodyClass="p-0">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Código</th><th>Origem</th><th>Situação</th><th className="text-right">Emitido</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>{d.vouchers.map((v) => <tr key={v.id}><td className="font-mono">{v.code}</td><td>{v.returnId ? <Link className="text-brand-700 hover:underline" href={`/vendas/devolucoes/${v.returnId}`}>Devolução</Link> : "—"}</td><td><StatusBadge kind="generic" status={v.status === "used" ? "completed" : v.status} /></td><td className="tabular text-right">{formatMoney(v.originalAmount)}</td><td className="tabular text-right">{formatMoney(v.balance)}</td></tr>)}</tbody>
              </table>
            </Card>
          )}
        </div>
      )}
      {tab === "fiscal" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Situação do documento da venda">
            <FiscalStatus
              saleId={id}
              model={doc?.model ?? null}
              initial={{ status: doc?.status ?? sale.fiscalStatus, message: doc?.statusMessage ?? null, documentId: doc?.id ?? null, number: doc?.number ?? null, simulated: Boolean(doc?.isSimulated), series: doc?.series ?? null, protocol: doc?.protocol ?? null, authorizedAt: doc?.authorizedAt ?? null, accessKey: doc?.accessKey ?? null, xmlFileId: doc?.xmlFileId ?? null }}
            />
          </Card>
          <Card title="Documentos vinculados" className="lg:col-span-2" bodyClass="p-0">
            {d.docs.length === 0 ? (
              <EmptyState title="Sem documentos fiscais" />
            ) : (
              <table className="table-base w-full text-sm">
                <thead><tr><th>Documento</th><th>Finalidade</th><th>Situação</th><th>Emissão</th><th className="text-right">Valor</th><th>Arquivos</th></tr></thead>
                <tbody>
                  {d.docs.map((x) => (
                    <tr key={x.id}>
                      <td><Link className="text-brand-700 hover:underline" href={`/fiscal/${x.model}/${x.id}`}>{MODEL_NAME[x.model] ?? x.model} {x.number ? `nº ${x.number}` : x.ref}</Link> <SimBadge show={Boolean(x.isSimulated)} /></td>
                      <td>{x.originType === "return" ? "Devolução" : x.purpose === "normal" ? "Venda" : x.purpose}</td>
                      <td><StatusBadge kind="fiscal" status={x.status} /></td>
                      <td>{formatDateTime(x.issuedAt)}</td>
                      <td className="tabular text-right">{formatMoney(x.total)}</td>
                      <td className="text-xs">{x.status === "authorized" && <Link className="mr-2 text-brand-700 hover:underline" href={`/fiscal/${x.model}/${x.id}/imprimir`} target="_blank">DANFE</Link>}{x.xmlFileId && <a className="text-brand-700 hover:underline" href={`/api/files/${x.xmlFileId}`}>XML</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.events.length > 0 && (
              <div className="border-t border-line p-4">
                <p className="mb-2 text-sm font-semibold">Eventos fiscais</p>
                <ol className="space-y-1 text-xs text-slate-600">{d.events.map((e) => <li key={e.id}>{formatDateTime(e.occurredAt)} · {e.type} · <StatusBadge kind="fiscal" status={e.status} /> {e.message}</li>)}</ol>
              </div>
            )}
          </Card>
        </div>
      )}
      {tab === "estoque" && (
        <Card title="Movimentos de estoque" actions={<Link className="text-sm text-brand-700 hover:underline" href={`/estoque/movimentos?origem=sale:${id}`}>Abrir em Movimentação de estoque</Link>} bodyClass="p-0">
          {d.stockMovs.length === 0 ? (
            <EmptyState title="Nenhum movimento" description={sale.effectsStatus === "done" ? "Venda somente de serviços." : "Baixa de estoque pendente."} />
          ) : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Data</th><th>Tipo</th><th>SKU</th><th>Depósito</th><th className="text-right">Qtd.</th><th className="text-right">Saldo após</th><th className="text-right">Custo</th><th>Origem</th></tr></thead>
              <tbody>
                {d.stockMovs.map((m) => {
                  const item = items.find((i) => i.skuId === m.skuId);
                  return (
                    <tr key={m.id}>
                      <td>{formatDateTime(m.occurredAt)}</td>
                      <td>{MOVEMENT_LABEL[m.type as keyof typeof MOVEMENT_LABEL] ?? m.type}</td>
                      <td>{item?.sku ?? m.skuId.slice(0, 8)}<span className="block text-xs text-slate-500">{item?.description}</span></td>
                      <td>{d.warehouses.get(m.warehouseId) ?? "—"}</td>
                      <td className={`tabular text-right ${m.qty < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatQty(m.qty)}</td>
                      <td className="tabular text-right">{formatQty(m.balanceAfter)}</td>
                      <td className="tabular text-right">{formatMoney(m.totalCost)}</td>
                      <td><Link className="text-brand-700 hover:underline" href={`/estoque/movimentos?origem=${m.originType}:${m.originId}`}>{m.originType === "return" ? "Devolução" : m.originType === "sale_cancel" ? "Cancelamento" : "Venda"}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "devolucoes" && (
        <Card title="Trocas e devoluções desta venda" actions={canReturn && <LinkButton size="sm" href={`${base}/devolucoes`}><Undo2 className="size-4" /> Nova troca ou devolução</LinkButton>} bodyClass="p-0">
          {d.returns.length === 0 ? (
            <EmptyState title="Nenhuma troca ou devolução" description={returnable > 0 ? `${formatQty(returnable)} unidade(s) ainda devolvível(is).` : "Nada a devolver."} />
          ) : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Devolução</th><th>Data</th><th>Tipo / compensação</th><th>Situação</th><th>Motivo</th><th className="text-right">Valor</th><th>Troca</th></tr></thead>
              <tbody>
                {d.returns.map((r) => {
                  const ex = d.linked.find((x) => x.id === r.exchangeSaleId);
                  return (
                    <tr key={r.id}>
                      <td><Link className="text-brand-700 hover:underline" href={`/vendas/devolucoes/${r.id}`}>nº {r.number}</Link></td>
                      <td>{formatDateTime(r.createdAt)}</td>
                      <td>{COMPENSATION_LABEL[r.compensation] ?? r.compensation}{r.refundMethod ? ` — ${REFUND_METHOD_LABEL[r.refundMethod] ?? r.refundMethod}` : ""}</td>
                      <td><StatusBadge kind="generic" status={r.status} /></td>
                      <td className="max-w-xs truncate">{r.reason}</td>
                      <td className="tabular text-right">{formatMoney(r.itemsTotal)}</td>
                      <td>{ex ? <Link className="text-brand-700 hover:underline" href={`/vendas/${ex.id}`}>venda nº {ex.number} ({r.difference >= 0 ? "+" : ""}{formatMoney(r.difference)})</Link> : r.kind === "exchange" ? "aguardando nova venda" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Histórico e auditoria" description="Conclusão, cancelamento, devoluções, envios e consultas — com usuário, data e motivo">
          <Timeline store={s.ctx.store} refs={[`sale:${id}`, ...d.returns.map((r) => `return:${r.id}`)]} />
        </Card>
      )}
    </>
  );
}
