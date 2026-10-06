import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { PackageCheck, Pencil, Send } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { orderItems, orderNeedsSending, remainingQty, EDITABLE, REVISABLE } from "@/domain/purchases";
import { requestDecisions, stepState } from "@/domain/approvals";
import { getIntegration } from "@/domain/integrations";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { submitOrderAction, cancelOrderAction, closeBalanceAction } from "../actions";
import { SendOrder } from "./send-order";

export const metadata = { title: "Pedido de compra" };
const ORIGIN: Record<string, string> = { manual: "Manual", quotation: "Cotação", replenishment: "Planejamento de reposição" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("purchases");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const store = s.ctx.store;
  const o = await store.get("purchase_orders", id);
  if (!o || o.companyId !== s.ctx.companyId) notFound();
  const [items, receipts, revisions, requests, supplier, users, terms, methods, costCenters] = await Promise.all([
    orderItems(store, id),
    listAll(store, "receipts", { filters: [["contains", "orderIds", id]], orderBy: [{ field: "number", dir: "asc" }] }),
    listAll(store, "purchase_order_revisions", { filters: [["eq", "orderId", id]], orderBy: [{ field: "revision", dir: "asc" }] }),
    listAll(store, "purchase_requests", { filters: [["contains", "orderIds", id]], orderBy: [{ field: "number", dir: "asc" }] }),
    store.get("suppliers", o.supplierId),
    nameMap(s.ctx, "users"),
    nameMap(s.ctx, "payment_terms"),
    nameMap(s.ctx, "payment_methods"),
    nameMap(s.ctx, "cost_centers"),
  ]);
  const skus = new Map((await Promise.all(items.map((i) => store.get("skus", i.skuId)))).filter(Boolean).map((k) => [k!.id, k!]));
  const wh = o.warehouseId ? await store.get("warehouses", o.warehouseId) : null;
  const branch = o.branchId ? await store.get("branches", o.branchId) : null;
  const quotation = o.quotationId ? await store.get("quotations", o.quotationId) : null;
  const email = await getIntegration(store, s.ctx.companyId, null, "email");
  const currentReq = o.requestId ? requests.find((r) => r.id === o.requestId) ?? null : null;
  const decisionsByReq = new Map<string, any[]>();
  for (const r of requests) decisionsByReq.set(r.id, await requestDecisions(store, r.id));
  const base = `/compras/pedidos/${id}`;
  const canEdit = can(s.user, "purchases", "edit");
  const sameBranch = s.ctx.branchId === o.branchId;
  const remaining = items.reduce((a, i) => a + remainingQty(i), 0);
  const remainingValue = ["approved", "sent", "partial"].includes(o.status) ? Math.max(0, o.total - (o.receivedValue ?? 0)) : 0;
  const t = today();
  const label = supplier ? supplier.tradeName || supplier.name : o.supplierSnapshot?.name;
  const confirmedReceipts = receipts.filter((r) => r.status === "confirmed");
  const received = (itemId: string) => confirmedReceipts.flatMap((r) => (r.items ?? []).flatMap((it: any) => (it.allocations ?? []).filter((a: any) => a.orderItemId === itemId).map((a: any) => ({ receipt: r, qty: a.qty }))));
  const proposalExpired = o.proposalRef?.validUntil && o.proposalRef.validUntil < t;
  return (
    <>
      <PageHeader
        title={`Pedido de compra nº ${o.number}`}
        crumbs={[{ label: "Pedidos de compra", href: "/compras/pedidos" }, { label: `nº ${o.number}` }]}
        badges={
          <>
            <StatusBadge kind="purchase" status={o.status} />
            {(o.revision ?? 1) > 1 && <Badge tone="info">Revisão {o.revision}</Badge>}
            <Badge>{ORIGIN[o.origin] ?? o.origin}</Badge>
            {orderNeedsSending(o) && o.status === "sent" && <Badge tone="warn">Revisão {o.revision} ainda não enviada</Badge>}
          </>
        }
        description={`${o.purpose ? `${o.purpose} · ` : ""}${label ?? "—"} · ${branch?.name ?? ""} · solicitado em ${formatDateTime(o.createdAt)} por ${users.get(o.createdBy) ?? "—"}${o.buyerId ? ` · comprador ${users.get(o.buyerId) ?? "—"}` : ""}`}
        actions={
          sameBranch && canEdit ? (
            <>
              {EDITABLE.includes(o.status) && (
                <>
                  <LinkButton href={`${base}/editar`}><Pencil className="size-4" /> Editar</LinkButton>
                  <ActionButton variant="primary" icon={<Send className="size-4" />} action={submitOrderAction.bind(null, id)} label={o.status === "adjust" ? "Reenviar para análise" : "Enviar para análise"} confirm="Enviar o pedido para análise conforme a política de aprovação?" />
                </>
              )}
              {orderNeedsSending(o) && <SendOrder orderId={id} supplierEmail={supplier?.email ?? null} contacts={(supplier?.contacts ?? []).map((c: any) => c.name).filter(Boolean)} revision={o.revision ?? 1} emailConfigured={Boolean(email)} />}
              {REVISABLE.includes(o.status) && !items.some((i) => (i.receivedQty ?? 0) > 0) && <LinkButton href={`${base}/editar`}><Pencil className="size-4" /> Alterar (revisão)</LinkButton>}
              {["approved", "sent", "partial"].includes(o.status) && canDo(s.user, "purchase.receive") && <LinkButton variant="primary" href={`/compras/recebimentos/novo?pedido=${id}`}><PackageCheck className="size-4" /> Receber</LinkButton>}
              {o.status === "partial" && <ActionButton action={closeBalanceAction.bind(null, id)} label="Encerrar saldo" askReason="Motivo para encerrar o saldo pendente (o fornecedor não entregará o restante):" />}
              {["draft", "in_review", "adjust", "approved", "sent"].includes(o.status) && !items.some((i) => (i.receivedQty ?? 0) > 0) && <ActionButton variant="danger" action={cancelOrderAction.bind(null, id)} label="Cancelar" askReason="Motivo do cancelamento:" />}
            </>
          ) : null
        }
      />
      {!sameBranch && <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">Pedido da filial {branch?.name}. Selecione essa filial para executar ações.</p>}
      {o.status === "approved" && <Notice tone="info" title="Aprovado — ainda não enviado">A aprovação interna não envia o pedido ao fornecedor nem registra recebimento ou pagamento. Use “Registrar envio”.</Notice>}
      {o.status === "adjust" && currentReq && <Notice tone="warn" title="Devolvido para ajuste">{(decisionsByReq.get(currentReq.id) ?? []).filter((d) => d.decision === "adjust" && !d.revokedAt).pop()?.note ?? ""}</Notice>}
      {o.status === "rejected" && <Notice tone="bad" title="Pedido rejeitado">{o.rejectReason}</Notice>}
      <div className="my-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Total do pedido"
          value={formatMoney(o.total)}
          hint={[`Produtos ${formatMoney((o.subtotal ?? 0) - (o.discountTotal ?? 0))}`, ...([["IPI", o.ipiTotal], ["frete", o.freight], ["seguro", o.insurance], ["outras despesas", o.otherExpenses]] as const).filter(([, v]) => (v ?? 0) > 0).map(([l, v]) => `${l} ${formatMoney(v)}`)].join(" + ")}
        />
        <Stat label="Recebido" value={formatMoney(o.receivedValue)} hint={`${confirmedReceipts.length} recebimento(s) confirmado(s)`} href={`${base}?tab=recebimentos`} />
        <Stat label="Saldo a receber" value={formatMoney(remainingValue)} hint={`${formatQty(remaining)} un. pendentes`} tone={remainingValue && o.expectedDate && o.expectedDate < t ? "bad" : "default"} />
        <Stat label="Previsão de entrega" value={formatDate(o.expectedDate)} hint={o.expectedDate && o.expectedDate < t && remaining ? "Atrasado" : wh?.name} tone={o.expectedDate && o.expectedDate < t && remaining && ["approved", "sent", "partial"].includes(o.status) ? "bad" : "default"} />
        <Stat label="Aprovação" value={currentReq ? <StatusBadge kind="approval" status={currentReq.status} /> : "—"} hint={currentReq ? `Solicitação nº ${currentReq.number}` : "Não enviado para análise"} href={currentReq ? `/compras/aprovacoes/${currentReq.id}` : undefined} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Itens e condições" },
          { key: "aprovacao", label: "Aprovação", count: requests.length },
          { key: "recebimentos", label: "Recebimentos", count: receipts.length },
          { key: "revisoes", label: "Revisões", count: revisions.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="space-y-4">
          <Card bodyClass="p-0" title="Itens">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Produto</th><th>Cód. fornecedor</th><th className="text-right">Pedido</th><th className="text-right">Recebido</th><th className="text-right">Saldo</th><th className="text-right">Custo unit.</th><th className="text-right">Desconto</th><th className="text-right">IPI</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.productId ? <Link className="text-brand-700 hover:underline" href={`/produtos/${i.productId}`}>{i.description}</Link> : i.description}<span className="block text-xs text-slate-500">{skus.get(i.skuId)?.sku}</span></td>
                      <td className="font-mono text-xs">{i.supplierCode ?? "—"}</td>
                      <td className="tabular text-right">{formatQty(i.qty, i.unitCode)}</td>
                      <td className="tabular text-right">{formatQty(i.receivedQty ?? 0)}</td>
                      <td className="tabular text-right">{remainingQty(i) ? <span className="text-amber-700">{formatQty(remainingQty(i))}</span> : "—"}</td>
                      <td className="tabular text-right">{formatMoney(i.unitCost)}</td>
                      <td className="tabular text-right">{i.discount ? formatMoney(i.discount) : "—"}</td>
                      <td className="tabular text-right">{i.ipi ? formatMoney(i.ipi) : "—"}</td>
                      <td className="tabular text-right">{formatMoney(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Produtos (bruto)</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(o.subtotal)}</td></tr>
                  <tr><td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Descontos</td><td className="tabular px-3 py-1.5 text-right">− {formatMoney(o.discountTotal)}</td></tr>
                  <tr><td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">IPI</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(o.ipiTotal ?? 0)}</td></tr>
                  <tr><td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Frete</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(o.freight)}</td></tr>
                  <tr><td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Seguro</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(o.insurance ?? 0)}</td></tr>
                  <tr><td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Outras despesas</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(o.otherExpenses)}</td></tr>
                  <tr className="font-semibold"><td colSpan={8} className="border-t border-line px-3 py-2 text-right">Total</td><td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(o.total)}</td></tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Fornecedor, entrega e pagamento">
              <DefinitionList
                items={[
                  { label: "Fornecedor", value: <Link className="text-brand-700 hover:underline" href={`/fornecedores/${o.supplierId}`}>{label}</Link> },
                  { label: "CNPJ/CPF", value: formatDoc(o.supplierSnapshot?.doc) || "—" },
                  { label: "Filial / depósito de entrega", value: `${branch?.name ?? "—"} · ${wh?.name ?? "—"}` },
                  { label: "Previsão de entrega", value: formatDate(o.expectedDate) },
                  { label: "Condição de pagamento", value: [o.paymentTermId ? terms.get(o.paymentTermId) : null, o.paymentTermsText].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ") || "—" },
                  { label: "Forma de pagamento / centro de custo", value: [o.paymentMethodId ? methods.get(o.paymentMethodId) : null, o.costCenterId ? costCenters.get(o.costCenterId) : null].filter(Boolean).join(" · ") || "—" },
                  { label: "Parcelas previstas", value: (o.installmentsPlan ?? []).map((p: any) => `${p.days ? `${p.days}d` : "à vista"} ${formatMoney(p.amount)}`).join(" · ") || "—" },
                  { label: "Envio", value: o.sentInfo ? `${formatDateTime(o.sentInfo.at)} · ${o.sentInfo.method === "email" ? `e-mail para ${o.sentInfo.to} (${o.sentInfo.channel})` : `${o.sentInfo.channel}, contato ${o.sentInfo.contact}`} · por ${o.sentInfo.by} (rev. ${o.sentInfo.revision})` : "Não enviado" },
                  { label: "Observações", value: o.notes },
                ]}
              />
            </Card>
            <Card title="Origem">
              {o.origin === "quotation" && quotation ? (
                <DefinitionList
                  items={[
                    { label: "Cotação", value: <Link className="text-brand-700 hover:underline" href={`/compras/cotacoes/${quotation.id}?tab=revisao`}>nº {quotation.number} — {quotation.title}</Link> },
                    { label: "Proposta selecionada", value: `versão ${o.proposalRef?.version ?? 1}` },
                    { label: "Validade da proposta", value: <span>{formatDate(o.proposalRef?.validUntil)} {proposalExpired && <StatusBadge kind="quotation" status="expired" />}</span> },
                    { label: "Frete / pedido mínimo da proposta", value: `${formatMoney(o.proposalRef?.freight)} · mínimo ${formatMoney(o.proposalRef?.minOrderValue)}${o.proposalRef?.belowMinimum ? " (não atingido)" : ""}` },
                    { label: "Prazo da proposta", value: o.proposalRef?.leadTimeDays != null ? `${o.proposalRef.leadTimeDays} dias` : "—" },
                  ]}
                />
              ) : o.origin === "replenishment" ? (
                <div className="overflow-x-auto">
                  <p className="mb-2 text-xs text-slate-500">Cálculo no momento da criação ({formatDateTime(o.originData?.at)}, por {o.originData?.by ?? "—"}).</p>
                  <table className="table-base w-full text-xs">
                    <thead><tr><th>SKU</th><th className="text-right">Disp.</th><th className="text-right">Confirmado</th><th className="text-right">Rascunhos</th><th className="text-right">Alvo</th><th className="text-right">Necess.</th><th className="text-right">Sugerido</th><th className="text-right">Pedido</th></tr></thead>
                    <tbody>
                      {(o.originData?.items ?? []).map((x: any) => (
                        <tr key={x.skuId}>
                          <td><Link className="text-brand-700 hover:underline" href={`/compras/reposicao/${x.skuId}`}>{x.sku ?? x.skuId}</Link></td>
                          <td className="tabular text-right">{formatQty(x.available)}</td>
                          <td className="tabular text-right">{formatQty(x.confirmedInHorizon)}</td>
                          <td className="tabular text-right">{formatQty(x.draftQty)}</td>
                          <td className="tabular text-right">{formatQty(x.target)}</td>
                          <td className="tabular text-right">{formatQty(x.grossNeed)}</td>
                          <td className="tabular text-right">{formatQty(x.suggested)}</td>
                          <td className="tabular text-right">{formatQty(x.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Pedido criado manualmente.</p>
              )}
              {o.originData?.closedShort && <p className="mt-3 text-sm text-amber-800">Saldo encerrado em {formatDateTime(o.originData.closedShort.at)} por {o.originData.closedShort.by}: {o.originData.closedShort.reason}</p>}
            </Card>
          </div>
        </div>
      )}
      {tab === "aprovacao" && (
        <div className="space-y-4">
          {requests.length === 0 && <Card><EmptyState title="Pedido ainda não enviado para análise" /></Card>}
          {requests.map((r) => {
            const ds = decisionsByReq.get(r.id) ?? [];
            return (
              <Card key={r.id} title={<Link className="text-brand-700 hover:underline" href={`/compras/aprovacoes/${r.id}`}>Solicitação nº {r.number} (revisão {r.revision})</Link>} actions={<StatusBadge kind="approval" status={r.status} />} description={`${r.origin === "revision" ? "Nova análise por revisão do pedido" : "Envio para análise"} · ${formatMoney(r.total)} com frete · política: ${r.policySnapshot?.name ?? "—"}`}>
                <ol className="space-y-2 text-sm">
                  {(r.steps ?? []).map((st: any, i: number) => {
                    const ss = stepState(r, i, ds);
                    return (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{i + 1}. {st.name}</span>
                        <StatusBadge kind="approval" status={ss.state} />
                        <span className="text-xs text-slate-500">{ss.decision ? `${users.get(ss.decision.createdBy) ?? ""} em ${formatDateTime(ss.decision.createdAt)}${ss.decision.note ? ` — “${ss.decision.note}”` : ""}` : (st.responsibleNames ?? []).join(", ")}</span>
                      </li>
                    );
                  })}
                  {ds.filter((d) => d.decision === "auto").map((d) => <li key={d.id}><StatusBadge kind="approval" status="auto" /> <span className="text-xs text-slate-500">{d.note}</span></li>)}
                </ol>
              </Card>
            );
          })}
        </div>
      )}
      {tab === "recebimentos" && (
        <Card bodyClass="p-0">
          {receipts.length === 0 ? (
            <EmptyState title="Sem recebimentos" action={["approved", "sent", "partial"].includes(o.status) && canDo(s.user, "purchase.receive") && sameBranch ? <LinkButton href={`/compras/recebimentos/novo?pedido=${id}`} variant="primary">Receber mercadorias</LinkButton> : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Recebimento</th><th>NF-e</th><th>Situação</th><th>Data</th><th>Itens deste pedido</th><th className="text-right">Devido</th><th>Título a pagar</th></tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td><Link className="text-brand-700 hover:underline" href={`/compras/recebimentos/${r.id}`}>nº {r.number}</Link></td>
                      <td>{r.nfeNumber ? `${r.nfeNumber}/${r.nfeSeries ?? ""}` : "—"}</td>
                      <td><StatusBadge kind="receipt" status={r.status} /></td>
                      <td>{formatDateTime(r.confirmedAt ?? r.createdAt)}</td>
                      <td className="text-xs">{items.map((i) => { const q = (r.items ?? []).flatMap((it: any) => it.allocations ?? []).filter((a: any) => a.orderItemId === i.id).reduce((a: number, x: any) => a + x.qty, 0); return q ? <span key={i.id} className="block">{i.description}: {formatQty(q)}</span> : null; })}</td>
                      <td className="tabular text-right">{formatMoney(r.dueTotal)}</td>
                      <td>{r.payableTitleId ? <Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${r.payableTitleId}`}>Ver título</Link> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-line p-3 text-xs text-slate-500">
                Saldo por item:{" "}
                {items.map((i) => <span key={i.id} className="mr-3">{i.description}: recebido {formatQty(i.receivedQty ?? 0)} de {formatQty(i.qty)}{received(i.id).length ? ` (${received(i.id).map((x) => `nº ${x.receipt.number}: ${formatQty(x.qty)}`).join(", ")})` : ""}</span>)}
              </div>
            </div>
          )}
        </Card>
      )}
      {tab === "revisoes" && (
        <Card bodyClass="p-0">
          {revisions.length === 0 ? (
            <EmptyState title="Sem revisões" description="Alterações comerciais após a aprovação geram revisões com a versão anterior preservada." />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Versão preservada</th><th>Data</th><th>Por</th><th>Motivo</th><th className="text-right">Total da versão</th><th>Itens da versão</th><th>Nova análise</th></tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id}>
                    <td>Revisão {r.revision}</td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{users.get(r.createdBy) ?? "—"}</td>
                    <td>{r.reason}</td>
                    <td className="tabular text-right">{formatMoney(r.snapshot?.total)}</td>
                    <td className="text-xs">{(r.snapshot?.items ?? []).map((i: any) => <span key={i.skuId} className="block">{i.description}: {formatQty(i.qty)} × {formatMoney(i.unitCost)}</span>)}</td>
                    <td>{r.requiresReview ? <Badge tone="warn">Exigida</Badge> : <Badge>Dispensada</Badge>}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td>Revisão {o.revision} (vigente)</td>
                  <td colSpan={3} />
                  <td className="tabular text-right font-semibold">{formatMoney(o.total)}</td>
                  <td className="text-xs">{items.map((i) => <span key={i.id} className="block">{i.description}: {formatQty(i.qty)} × {formatMoney(i.unitCost)}</span>)}</td>
                  <td><StatusBadge kind="purchase" status={o.status} /></td>
                </tr>
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={store} refs={[`purchase_order:${id}`]} />
        </Card>
      )}
    </>
  );
}
