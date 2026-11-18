import Link from "@/components/ui/link";
import { CheckCircle2, Circle, Clock, PackageCheck, Tag, Truck, KeyRound } from "lucide-react";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatQty } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { DELIVERY_LABEL, type DeliveryMode } from "@/domain/ecommerce/common";
import { operationLabel } from "@/domain/ecommerce/orders";
import { confirmDeliveryAction, confirmPickingAction, confirmPickupAction, dispatchOrderAction, generateLabelAction } from "../actions";
import { brDateTime, ecomStorePage } from "../_lib";

export const metadata = { title: "Expedição e rastreamento" };

/** Tela 59 — Expedição e rastreamento: separação/conferência, etiqueta, despacho ou retirada e conclusão. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.orders", "ecommerce.manage"]);
  const params = await searchParams;
  const canOp = canDo(s.user, "ecommerce.orders");
  const all = await listAll(unscoped(s.ctx.store), "online_orders", { filters: [["eq", "storeId", st.id], ["eq", "status", ["paid", "invoiced", "ready_for_pickup", "shipped"]]] }, 2000);
  const queue = all.sort((a, b) => String(a.paidAt ?? a.createdAt).localeCompare(String(b.paidAt ?? b.createdAt)));
  const selectedId = sp(params, "pedido") || (queue.find((o) => o.status === "invoiced")?.id ?? queue[0]?.id ?? null);
  const o = selectedId ? await unscoped(s.ctx.store).get("online_orders", selectedId) : null;
  const order = o && o.companyId === s.ctx.companyId && o.storeId === st.id ? o : null;
  const pickup = order?.delivery?.mode === "pickup";
  const fiscalOk = order?.fiscalStatus === "authorized" && order?.paymentStatus === "paid";
  const picked = Boolean(order?.delivery?.pickedAt);
  const left = Boolean(order?.dispatchedAt);
  const delivered = Boolean(order?.deliveredAt);
  const step = (done: boolean, current: boolean) => (done ? <CheckCircle2 className="size-5 text-emerald-600" aria-label="Concluído" /> : current ? <Clock className="size-5 text-brand-600" aria-label="Em andamento" /> : <Circle className="size-5 text-slate-300" aria-label="Aguardando" />);

  return (
    <>
      <PageHeader title="Expedição e rastreamento" crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Expedição e rastreio" }]} description="Separe, confira e acompanhe cada volume até a entrega ou a retirada." actions={<Link href="/comercio-digital/pedidos" className={buttonClass("secondary")}>Pedidos on-line</Link>} />
      <Card title="Fila de expedição" bodyClass="p-0" className="mb-4">
        {queue.length ? (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Pedido / cliente</th><th>Volumes</th><th>Entrega</th><th>Etapa</th><th className="text-right"><span className="sr-only">Abrir</span></th></tr></thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id} className={q.id === order?.id ? "bg-brand-50/60" : undefined}>
                    <td><span className="block font-semibold text-ink">{q.code}</span><span className="block text-xs text-slate-500">{q.customer?.name}</span></td>
                    <td>{q.delivery?.volumes ? `${q.delivery.volumes} volume(s)` : "—"}</td>
                    <td>{q.delivery?.label}</td>
                    <td><Badge tone={q.status === "paid" ? "warn" : q.status === "shipped" ? "info" : "brand"}>{q.status === "paid" ? "Aguardando NF-e" : operationLabel(q)}</Badge></td>
                    <td className="text-right"><Link href={`/comercio-digital/expedicao?pedido=${q.id}`} className={buttonClass("secondary", "sm")} scroll={false}>Abrir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Fila vazia" description="Pedidos pagos aparecem aqui; a separação é liberada quando a NF-e é autorizada." />
        )}
      </Card>
      {order && (
        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card title={`Conferência · ${order.code}`} actions={<Badge tone={fiscalOk ? "good" : "warn"}>{fiscalOk ? "Pagamento e fiscal conferidos" : "Aguardando pagamento ou NF-e"}</Badge>}>
            <ul className="divide-y divide-slate-100">
              {(order.items ?? []).map((i: any) => (
                <li key={i.skuId} className="flex items-center justify-between py-2 text-sm">
                  <span><span className="block font-medium text-ink">{i.title}</span><span className="block text-xs text-slate-500">{[i.sku, i.variant || "Único"].filter(Boolean).join(" · ")}</span></span>
                  <span className="tabular font-semibold">{formatQty(i.qty, "un.", 0)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">{DELIVERY_LABEL[order.delivery?.mode as DeliveryMode]} — {order.delivery?.label} · {order.delivery?.detail}</p>
            {!fiscalOk && <div className="mt-3"><Notice tone="warn">A expedição exige pagamento aprovado e NF-e autorizada. <Link className="font-medium underline" href={`/comercio-digital/pedidos/${order.id}`}>Abrir o pedido</Link> para emitir a nota.</Notice></div>}
            {canOp && fiscalOk && (
              <div className="mt-4 space-y-3">
                {!picked && order.status === "invoiced" && (
                  <ActionForm action={confirmPickingAction.bind(null, order.id)} className="flex flex-wrap items-end gap-2">
                    <Field label="Volumes" htmlFor="volumes"><Input id="volumes" name="volumes" type="number" min={1} max={50} defaultValue={1} className="w-24" /></Field>
                    <Field label="Observação" htmlFor="note" className="flex-1"><Input id="note" name="note" placeholder="Opcional" /></Field>
                    <button type="submit" className={buttonClass("accent")}><PackageCheck className="size-4" aria-hidden /> Confirmar separação e conferência</button>
                  </ActionForm>
                )}
                {!pickup && picked && !left && (
                  <div className="flex flex-wrap gap-2">
                    {!order.delivery?.trackingCode && <ActionButton action={generateLabelAction.bind(null, order.id)} label={order.delivery?.mode === "own" ? "Gerar romaneio" : "Gerar etiqueta"} icon={<Tag className="size-4" aria-hidden />} />}
                    <ActionButton action={dispatchOrderAction.bind(null, order.id)} label="Registrar despacho" variant="primary" icon={<Truck className="size-4" aria-hidden />} confirm={`Registrar o despacho do pedido ${order.code}? O estoque é baixado agora.`} />
                  </div>
                )}
                {pickup && order.status === "ready_for_pickup" && (
                  <ActionForm action={confirmPickupAction.bind(null, order.id)} className="flex flex-wrap items-end gap-2">
                    <Field label="Código de retirada informado pelo cliente" htmlFor="code"><Input id="code" name="code" inputMode="numeric" autoComplete="off" required className="w-40 tabular" /></Field>
                    <button type="submit" className={buttonClass("primary")}><KeyRound className="size-4" aria-hidden /> Confirmar retirada</button>
                  </ActionForm>
                )}
                {order.status === "shipped" && (
                  <ActionForm action={confirmDeliveryAction.bind(null, order.id)} className="flex flex-wrap items-end gap-2">
                    <Field label="Observação da entrega" htmlFor="dnote" className="flex-1"><Input id="dnote" name="note" placeholder="Ex.: recebido pelo porteiro" /></Field>
                    <button type="submit" className={buttonClass("secondary")}>Confirmar entrega concluída</button>
                  </ActionForm>
                )}
                {order.delivery?.trackingCode && <p className="text-sm text-slate-700">{order.delivery?.mode === "own" ? "Romaneio" : "Etiqueta / rastreio"}: <strong className="font-mono">{order.delivery.trackingCode}</strong> <span className="block text-xs text-slate-500">{order.delivery.labelNote}</span></p>}
              </div>
            )}
          </Card>
          <Card title="Acompanhamento">
            <ol className="space-y-4">
              <li className="flex gap-3">{step(fiscalOk, !fiscalOk)}<div><p className="font-medium text-ink">Pagamento e documento fiscal</p><p className="text-sm text-slate-500">{fiscalOk ? "Validados" : "Aguardando pagamento e NF-e autorizada"}</p></div></li>
              <li className="flex gap-3">{step(picked, fiscalOk && !picked)}<div><p className="font-medium text-ink">Separação e conferência</p><p className="text-sm text-slate-500">{picked ? `${order.delivery.volumes ?? 1} volume(s) · ${order.delivery.pickedBy ?? ""} · ${brDateTime(order.delivery.pickedAt)}` : "Aguardando conferência"}</p></div></li>
              <li className="flex gap-3">{step(left, picked && !left)}<div><p className="font-medium text-ink">{pickup ? "Retirada" : "Despacho"}</p><p className="text-sm text-slate-500">{left ? brDateTime(order.dispatchedAt) : pickup ? (order.status === "ready_for_pickup" ? "Pronto: aguardando o cliente com o código" : "Aguardando preparo") : "Aguardando preparo"}</p></div></li>
              <li className="flex gap-3">{step(delivered, left && !delivered)}<div><p className="font-medium text-ink">Entrega concluída</p><p className="text-sm text-slate-500">{delivered ? brDateTime(order.deliveredAt) : "Aguardando confirmação"}</p></div></li>
            </ol>
            <p className="mt-4 text-xs text-slate-500">Etiqueta e código de rastreio são demonstrativos enquanto a logística estiver em simulação (sem validade para postagem). Eventos reais de transporte serão recebidos do conector logístico.</p>
          </Card>
        </div>
      )}
    </>
  );
}
