import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CheckCircle2, Circle, Clock, XCircle, KeyRound, Truck } from "lucide-react";
import { CopyButton } from "@/app/(app)/comercio-digital/_components/copy-button";
import { ORDER_CLOSED, PAY_METHOD_LABEL, WITHDRAWAL_DAYS } from "@/domain/ecommerce/common";
import { orderByToken, orderSteps, orderTimeline, withdrawalDeadline } from "@/domain/ecommerce/orders";
import { shippingOf } from "@/domain/ecommerce/store";
import { StoreActionButton } from "../../_components/cart-controls";
import { ReturnForm } from "../../_components/return-form";
import { cancelByCustomerAction, requestReturnAction, retryChargeCustomerAction, simulatePayAction } from "../../actions";
import { money, requireStore } from "../../_lib";

export const metadata = { title: "Acompanhamento do pedido", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const CUSTOMER_KINDS = ["status", "payment", "fiscal", "fulfillment", "return"];

/** Tela 64 (detalhe) — confirmação e acompanhamento: pagamento, fiscal, preparo e entrega como etapas distintas. */
export default async function OrderPage({ params }: { params: Promise<{ store: string; token: string }> }) {
  const { store: raw, token } = await params;
  const ref = decodeURIComponent(raw);
  const s = await requireStore(ref);
  const o = await orderByToken(s.store, s.st, token);
  if (!o) notFound();
  const { basePath } = s;
  const steps = orderSteps(o);
  const events = (await orderTimeline(s.store, o.id)).filter((e) => CUSTOMER_KINDS.includes(e.kind));
  const pending = o.status === "pending_payment";
  const paid = ["paid", "refund_pending", "refunded"].includes(o.paymentStatus);
  const closed = ORDER_CLOSED.includes(o.status);
  const sim = o.payment?.simulated !== false;
  const pix = pending && o.payment?.pix?.copyPaste ? o.payment.pix : null;
  const qr = pix ? await QRCode.toString(pix.copyPaste, { type: "svg", margin: 1, width: 200 }) : null;
  const boleto = pending && o.payment?.boleto ? o.payment.boleto : null;
  const pickup = o.delivery?.mode === "pickup";
  const ship = shippingOf(s.st);
  const deadline = withdrawalDeadline(o);
  const canReturn = ["shipped", "delivered"].includes(o.status);
  const items = (o.items ?? []) as Array<{ skuId: string; title: string; variant?: string; qty: number; total: number }>;
  const fmtDT = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className={`rounded-xl border p-5 ${paid ? "border-emerald-200 bg-emerald-50" : closed ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50"}`} aria-live="polite">
        <p className={`text-lg font-semibold ${paid ? "text-emerald-900" : closed ? "text-slate-900" : "text-amber-900"}`}>
          {paid ? (sim ? "Pagamento confirmado na simulação" : "Pagamento confirmado") : o.status === "cancelled" ? "Pedido cancelado" : o.status === "returned" ? "Pedido devolvido" : o.payment?.status === "error" ? "Não foi possível gerar a cobrança" : "Pedido registrado — aguardando pagamento"}
        </p>
        <p className="mt-1 text-sm text-slate-700">{o.code} · {o.customer?.name} · {money(o.total)}</p>
        {o.status === "cancelled" && o.cancelReason && <p className="mt-1 text-sm text-slate-600">Motivo: {o.cancelReason}{o.refundStatus === "pending" ? " · estorno em andamento" : o.refundStatus === "done" ? " · valor estornado" : ""}</p>}
        {paid && <p className="mt-1 text-xs text-slate-600">Pagamento aprovado ainda não significa nota emitida, produto entregue ou valor liquidado: acompanhe as etapas abaixo.</p>}
      </section>

      <ol className="grid gap-2 sm:grid-cols-5" aria-label="Andamento do pedido">
        {steps.map((st) => (
          <li key={st.key} className={`rounded-lg border p-3 ${st.state === "done" ? "border-emerald-200 bg-white" : st.state === "current" ? "border-[var(--store-accent)] bg-white" : st.state === "blocked" ? "border-red-200 bg-white" : "border-slate-200 bg-slate-50"}`}>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {st.state === "done" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : st.state === "current" ? <Clock className="size-4 text-[var(--store-accent)]" aria-hidden /> : st.state === "blocked" ? <XCircle className="size-4 text-red-600" aria-hidden /> : <Circle className="size-4 text-slate-300" aria-hidden />}
              {st.label}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{st.detail}</p>
          </li>
        ))}
      </ol>

      {pix && (
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[auto,1fr]" aria-labelledby="pix">
          {/* QR gerado no servidor a partir do código da cobrança */}
          <div className="mx-auto size-[200px]" dangerouslySetInnerHTML={{ __html: qr! }} aria-hidden />
          <div>
            <h2 id="pix" className="text-lg font-semibold text-slate-900">Pague com Pix</h2>
            <p className="mt-1 text-sm text-slate-600">Escaneie o QR Code ou copie o código. Prazo: até {fmtDT(pix.expiresAt)}; depois disso o pedido é cancelado e os produtos voltam ao estoque.</p>
            <p className="mt-2 break-all rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">{pix.copyPaste}</p>
            <CopyButton text={pix.copyPaste} label="Copiar código Pix" />
            {sim && <p className="mt-2 text-xs text-amber-800">Código de simulação, sem valor: use os botões abaixo para simular o retorno do banco.</p>}
          </div>
        </section>
      )}
      {boleto && (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="boleto">
          <h2 id="boleto" className="text-lg font-semibold text-slate-900">Boleto bancário</h2>
          <p className="mt-1 text-sm text-slate-600">Vencimento em {boleto.dueDate.split("-").reverse().join("/")}. O pedido é confirmado após a compensação (até 2 dias úteis).</p>
          <p className="mt-2 break-all rounded bg-slate-50 p-2 font-mono text-sm text-slate-800">{boleto.line}</p>
          <CopyButton text={boleto.line} label="Copiar linha digitável" />
          {sim && <p className="mt-2 text-xs text-amber-800">Boleto de simulação, sem validade bancária.</p>}
        </section>
      )}
      {pending && (
        <div className="flex flex-wrap gap-2">
          {sim && o.payment?.status !== "error" && (
            <>
              <StoreActionButton action={simulatePayAction.bind(null, ref, o.token, "approved")} label="Simular pagamento aprovado" />
              <StoreActionButton action={simulatePayAction.bind(null, ref, o.token, "failed")} label="Simular recusa" tone="plain" />
            </>
          )}
          {o.payment?.status === "error" && <StoreActionButton action={retryChargeCustomerAction.bind(null, ref, o.token)} label="Gerar a cobrança novamente" />}
          <StoreActionButton action={cancelByCustomerAction.bind(null, ref, o.token)} label="Cancelar pedido" tone="danger" confirm="Cancelar este pedido? Os produtos voltam ao estoque e nenhuma cobrança é feita." />
        </div>
      )}

      {pickup && o.pickupCode && !closed && (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="retirada">
          <h2 id="retirada" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><KeyRound className="size-5 text-[var(--store-accent)]" aria-hidden /> Código de retirada</h2>
          <p className="mt-2 text-4xl font-bold tracking-[0.3em] text-slate-900">{o.pickupCode}</p>
          <p className="mt-2 text-sm text-slate-600">{o.status === "ready_for_pickup" ? "Seu pedido está pronto para retirada." : o.status === "delivered" ? "Pedido retirado." : "Avisaremos quando o pedido estiver pronto."} {ship.modes.pickup.instructions}</p>
          <p className="mt-1 text-xs text-slate-500">{o.delivery?.label}</p>
        </section>
      )}
      {!pickup && o.delivery?.trackingCode && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Truck className="size-5 text-[var(--store-accent)]" aria-hidden /> Entrega</h2>
          <p className="mt-1 text-sm text-slate-700">{o.delivery?.label} · código {o.delivery.trackingCode}</p>
          {o.delivery?.labelNote && <p className="text-xs text-slate-500">{o.delivery.labelNote}</p>}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="resumo">
        <h2 id="resumo" className="text-lg font-semibold text-slate-900">Resumo</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {items.map((i) => (
            <li key={i.skuId} className="flex justify-between py-2"><span>{Math.round(i.qty / 1000)} × {i.title}{i.variant ? ` — ${i.variant}` : ""}</span><span className="tabular-nums">{money(i.total)}</span></li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Produtos</dt><dd className="tabular-nums">{money(o.subtotal)}</dd></div>
          {o.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Cupom {o.couponCode}</dt><dd className="tabular-nums">− {money(o.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-slate-600">Frete ({o.delivery?.label})</dt><dd className="tabular-nums">{o.shippingAmount ? money(o.shippingAmount) : "Grátis"}</dd></div>
          <div className="flex justify-between text-lg font-bold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{money(o.total)}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">{PAY_METHOD_LABEL[o.payment?.method as keyof typeof PAY_METHOD_LABEL] ?? ""}{o.payment?.installments > 1 ? ` em ${o.payment.installments}x` : ""} · {o.shippingAddress?.street}, {o.shippingAddress?.number} — {o.shippingAddress?.cityName}/{o.shippingAddress?.uf}</p>
      </section>

      {canReturn && (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="devolucao">
          <h2 id="devolucao" className="text-lg font-semibold text-slate-900">Trocas e devoluções</h2>
          <p className="mt-1 text-sm text-slate-600">Você pode desistir da compra em até {WITHDRAWAL_DAYS} dias do recebimento{deadline ? ` (até ${deadline.split("-").reverse().join("/")})` : ""}, conforme o Código de Defesa do Consumidor. Para produto com defeito, os prazos são de 30 ou 90 dias.</p>
          <ReturnForm action={requestReturnAction.bind(null, ref, o.token)} />
        </section>
      )}
      {o.status === "return_requested" && <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Devolução solicitada: a loja vai entrar em contato com as instruções.</p>}

      {events.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="historico">
          <h2 id="historico" className="text-lg font-semibold text-slate-900">Histórico</h2>
          <ol className="mt-2 space-y-1.5 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3"><span className="w-28 shrink-0 text-xs text-slate-500">{fmtDT(e.at ?? e.createdAt)}</span><span className="text-slate-700">{e.summary}</span></li>
            ))}
          </ol>
        </section>
      )}
      <p className="text-center text-xs text-slate-500">Guarde este endereço para acompanhar o pedido. <Link href={basePath || "/"} className="font-semibold text-[var(--store-accent)] hover:underline">Voltar à loja</Link></p>
    </div>
  );
}
