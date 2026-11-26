import Link from "@/components/ui/link";
import { CreditCard, Repeat, Send } from "lucide-react";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatBps, formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/domain/ecommerce/common";
import { checkoutOf, paymentsOf } from "@/domain/ecommerce/store";
import { INTEGRATION_CATALOG, STATUS_LABEL, getIntegration } from "@/domain/integrations";
import { saveCheckoutAction, savePaymentsAction, simulateEventAction } from "../actions";
import { ecomStorePage } from "../_lib";

export const metadata = { title: "Gateway e checkout" };

const EVENTS = [
  { value: "approved", label: "Pagamento aprovado" },
  { value: "pending", label: "Pagamento em espera (análise)" },
  { value: "failed", label: "Pagamento recusado" },
  { value: "expired", label: "Cobrança expirada" },
];

/** Tela 56 — Gateway e checkout: meios de pagamento da loja própria e simulador dos retornos do Gateway Intercert. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.manage", "ecommerce.finance", "ecommerce.orders"]);
  const params = await searchParams;
  const manage = canDo(s.user, "ecommerce.manage");
  const pay = paymentsOf(st);
  const co = checkoutOf(st);
  const integ = await getIntegration(s.ctx.store, s.ctx.companyId, null, "store_gateway");
  const simulated = !integ || integ.provider === "simulated";
  const orders = (await listAll(unscoped(s.ctx.store), "online_orders", { filters: [["eq", "storeId", st.id]] }, 2000)).filter((o) => o.payment?.simulated !== false).sort((a, b) => (b.number ?? 0) - (a.number ?? 0)).slice(0, 40);
  const selected = sp(params, "pedido") || (orders.find((o) => o.status === "pending_payment")?.id ?? orders[0]?.id ?? "");
  const lastEvent = selected ? (await listAll(unscoped(s.ctx.store), "commerce_events", { filters: [["eq", "orderId", selected], ["eq", "companyId", s.ctx.companyId]] })).filter((e) => e.area === "payment" && e.externalKey).sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0] : null;
  const canSim = canDo(s.user, "ecommerce.manage") || canDo(s.user, "ecommerce.finance");

  return (
    <>
      <PageHeader title="Gateway e checkout" crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Gateway e checkout" }]} description="Configure a cobrança da loja e acompanhe a confirmação de pagamento." actions={<Link href="/comercio-digital/ver-loja" target="_blank" className={buttonClass("secondary")}>Ver checkout</Link>} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><CreditCard className="size-5" aria-hidden /></span>
            <div>
              <p className="text-lg font-semibold text-ink">Gateway Intercert</p>
              <p className="text-sm text-slate-500">Integração nativa prevista para a loja própria — {INTEGRATION_CATALOG.store_gateway.providers.find((p) => p.id === (integ?.provider ?? "simulated"))?.label}</p>
            </div>
          </div>
          <Badge tone={simulated ? "warn" : "info"}>{simulated ? "Documentação e homologação pendentes" : (STATUS_LABEL[integ!.status] ?? integ!.status)}</Badge>
        </div>
        <p className="mt-3 text-sm text-slate-600">Credenciais, taxas, parcelamento, antifraude, estorno e assinatura de eventos dependem da API e das regras do gateway. A loja já usa a interface do provedor: com a ligação (Administração › <Link className="text-brand-700 hover:underline" href="/administracao/integracoes/store_gateway">Central de integrações</Link>), as cobranças passam a ser reais sem mudar o checkout.</p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Meios de pagamento">
          <ActionForm action={savePaymentsAction} className="space-y-4">
            <fieldset disabled={!manage} className="space-y-4">
              <div className="space-y-2">
                <Checkbox name="pix" defaultChecked={pay.methods.pix.enabled} label="Pix" />
                <Field label="Prazo para pagar o Pix (minutos)" htmlFor="pixMinutes" className="ml-6 max-w-xs"><Input id="pixMinutes" name="pixMinutes" type="number" min={5} max={1440} defaultValue={pay.methods.pix.expiresMinutes} /></Field>
              </div>
              <div className="space-y-2">
                <Checkbox name="card" defaultChecked={pay.methods.card.enabled} label="Cartão de crédito" />
                <FormGrid cols={2} className="ml-6">
                  <Field label="Parcelamento máximo planejado" htmlFor="maxInstallments"><Select id="maxInstallments" name="maxInstallments" defaultValue={String(pay.methods.card.maxInstallments)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}x` }))} /></Field>
                  <Field label="Parcela mínima"><MoneyInput name="minInstallment" defaultValue={pay.methods.card.minInstallment ?? 0} ariaLabel="Parcela mínima" /></Field>
                </FormGrid>
              </div>
              <div className="space-y-2">
                <Checkbox name="boleto" defaultChecked={pay.methods.boleto.enabled} label="Boleto bancário" />
                <Field label="Vencimento do boleto (dias)" htmlFor="boletoDays" className="ml-6 max-w-xs"><Input id="boletoDays" name="boletoDays" type="number" min={1} max={10} defaultValue={pay.methods.boleto.dueDays} /></Field>
              </div>
              <Checkbox name="autoInvoice" defaultChecked={pay.autoInvoice} label="Emitir a NF-e automaticamente quando o pagamento for aprovado" />
              <p className="text-xs text-slate-500">Taxas estimadas (até a ligação do gateway): Pix {formatBps(pay.feeBps.pix)}, cartão {formatBps(pay.feeBps.card)}, boleto R$ 3,49 · crédito previsto em {pay.settlementDays.pix} dia(s) (Pix), {pay.settlementDays.card} dias (cartão) e {pay.settlementDays.boleto} dias (boleto). Condições e disponibilidade serão validadas no gateway.</p>
              {manage && <button type="submit" className={buttonClass("accent", "md", "w-full")}>Salvar meios de pagamento</button>}
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Simulador de retorno" description="Teste como um evento de pagamento atualiza o pedido no ERP.">
          {simulated ? (
            orders.length ? (
              <div className="space-y-3">
                <form className="flex flex-wrap items-end gap-2">
                  <Field label="Pedido da loja" htmlFor="pedido" className="min-w-[240px] flex-1">
                    <Select id="pedido" name="pedido" defaultValue={selected} options={orders.map((o) => ({ value: o.id, label: `${o.code} · ${formatMoney(o.total)} · ${PAYMENT_STATUS_LABEL[o.paymentStatus as PaymentStatus] ?? o.paymentStatus}` }))} />
                  </Field>
                  <button type="submit" className={buttonClass("secondary")}>Selecionar</button>
                </form>
                {canSim && (
                  <ActionForm action={simulateEventAction} className="space-y-3">
                    <input type="hidden" name="orderId" value={selected} />
                    <Field label="Evento de exemplo" htmlFor="type"><Select id="type" name="type" defaultValue="approved" options={EVENTS} /></Field>
                    <button type="submit" className={buttonClass("primary", "md", "w-full")}><Send className="size-4" aria-hidden /> Simular retorno ao ERP</button>
                  </ActionForm>
                )}
                {canSim && lastEvent && (
                  <ActionForm action={simulateEventAction}>
                    <input type="hidden" name="orderId" value={selected} />
                    <input type="hidden" name="type" value={String(lastEvent.action).replace("payment.", "")} />
                    <input type="hidden" name="repeatOf" value={lastEvent.externalKey} />
                    <button type="submit" className={buttonClass("secondary", "md", "w-full")}><Repeat className="size-4" aria-hidden /> Repetir o último evento (mesma chave)</button>
                  </ActionForm>
                )}
                <Notice tone="info">Eventos repetidos não geram outra baixa. Pedidos já pagos não retrocedem por um evento antigo. Aprovação não é liquidação bancária.</Notice>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nenhum pedido da loja ainda. Faça um pedido de teste na vitrine.</p>
            )
          ) : (
            <p className="text-sm text-slate-600">O gateway real está ligado: os retornos chegam pelo aviso assinado do Gateway Intercert e aparecem no monitor.</p>
          )}
        </Card>
        <Card title="Regras do checkout">
          <ActionForm action={saveCheckoutAction} className="space-y-3">
            <fieldset disabled={!manage} className="space-y-3">
              <Checkbox name="requireDoc" defaultChecked={co.requireDoc} label="Exigir CPF/CNPJ (recomendado: a NF-e identifica o comprador)" />
              <FormGrid cols={3}>
                <Field label="Pedido mínimo (produtos)"><MoneyInput name="minOrder" defaultValue={co.minOrder} ariaLabel="Pedido mínimo" /></Field>
                <Field label="Prefixo do pedido" htmlFor="orderPrefix"><Input id="orderPrefix" name="orderPrefix" defaultValue={st.orderPrefix ?? "PED"} maxLength={6} /></Field>
                <Field label="Estoque de segurança (un.)" hint="Reservado à loja física." htmlFor="safetyUnits"><Input id="safetyUnits" name="safetyUnits" type="number" min={0} defaultValue={Math.round((st.safetyStockQty ?? 0) / 1000)} /></Field>
              </FormGrid>
              {manage && <button type="submit" className={buttonClass("primary")}>Salvar regras</button>}
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Fluxo financeiro por origem">
          <ul className="divide-y divide-slate-100">
            <li className="flex items-center justify-between py-3">
              <div><p className="font-medium text-ink">Loja própria</p><p className="text-sm text-slate-500">Checkout → Gateway Intercert → pedido → conciliação</p></div>
              <Link href="/comercio-digital/banco" className="text-sm font-medium text-brand-700 hover:underline">Conciliação</Link>
            </li>
            <li className="flex items-center justify-between py-3">
              <div><p className="font-medium text-ink">Marketplaces</p><p className="text-sm text-slate-500">Checkout do canal → repasse do canal → conciliação no ERP</p></div>
              <Link href="/comercio-digital/canais" className="text-sm font-medium text-brand-700 hover:underline">Canais</Link>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
