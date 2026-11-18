import Link from "@/components/ui/link";
import { RefreshCcw, Send } from "lucide-react";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { PAY_METHOD_LABEL, type PayMethod } from "@/domain/ecommerce/common";
import { GATEWAY_TX_LABEL, bankOverview, gatewayTransactions, type GatewayTxStatus } from "@/domain/ecommerce/bank";
import { preparePayoutAction, reconcileAction, setSettlementAccountAction, simulateCreditsAction } from "../actions";
import { brDate, brDateTime, ecomStorePage } from "../_lib";

export const metadata = { title: "Banco Intercert e repasses" };

const TONE: Record<GatewayTxStatus, "warn" | "info" | "good" | "neutral" | "bad"> = { awaiting_credit: "neutral", credited: "warn", partial: "info", reconciled: "good", refunded: "neutral", divergent: "bad" };

/** Tela 57 — Banco Intercert e repasses: bruto, taxa, líquido, crédito e conciliação do recebível do pedido. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s } = await ecomStorePage(["ecommerce.finance", "ecommerce.manage"]);
  const params = await searchParams;
  const canFin = canDo(s.user, "ecommerce.finance");
  const filter = (sp(params, "exibir") || "all") as "all" | GatewayTxStatus;
  const [ov, rows, accounts] = await Promise.all([
    bankOverview(s.ctx),
    gatewayTransactions(s.ctx, filter),
    listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId]] }).catch(() => [] as any[]),
  ]);
  const usable = accounts.filter((a: any) => a.active !== false && a.kind !== "cash");
  const accountOptions = usable.map((a: any) => ({ value: a.id, label: a.name }));
  const defaultAccount = ov.accountId ?? usable[0]?.id ?? "";
  return (
    <>
      <PageHeader title="Banco Intercert e repasses" crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Banco Intercert" }]} description="Vincule os recebimentos aos pedidos e acompanhe os valores conciliados no financeiro." />
      {ov.provider.simulated && <div className="mb-4"><Notice tone="warn">Conta não conectada. Saldos, taxas e créditos abaixo vêm da simulação (prazos e taxas estimados de cada meio); nenhum valor real é movimentado.</Notice></div>}
      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entradas creditadas (líquido)" value={formatMoney(ov.creditedNet)} hint="Valores líquidos de taxas" />
        <Stat label="Conciliado no ERP" value={formatMoney(ov.reconciledNet)} hint={`${ov.reconciledCount} lançamento(s) vinculado(s)`} tone="good" />
        <Stat label="Crédito previsto" value={formatMoney(ov.expectedNet)} hint={`Taxas do período: ${formatMoney(ov.fees)}`} />
        <Stat label="Conta Banco Intercert" value={ov.provider.simulated ? "Vínculo pendente" : ov.provider.label} hint="API, titularidade e regras a validar" tone={ov.provider.simulated ? "warn" : "good"} />
      </section>
      <div className="grid gap-4 2xl:grid-cols-3 [&>*]:min-w-0">
        <Card title="Conciliação de recebimentos" className="2xl:col-span-2" bodyClass="p-0" actions={canFin && ov.provider.simulated ? <ActionButton action={simulateCreditsAction} label="Atualizar créditos (simulação)" size="sm" icon={<RefreshCcw className="size-4" aria-hidden />} /> : undefined}>
          <form className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3">
            <Field label="Exibir" htmlFor="exibir"><Select id="exibir" name="exibir" defaultValue={filter} options={[{ value: "all", label: "Todos" }, ...Object.entries(GATEWAY_TX_LABEL).map(([value, label]) => ({ value, label }))]} /></Field>
            <button type="submit" className={buttonClass("secondary")}>Filtrar</button>
          </form>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Origem / referência</th><th>Pedido</th><th className="text-right">Bruto</th><th className="text-right">Taxa</th><th className="text-right">Líquido</th><th>Crédito</th><th>Situação</th><th className="text-right"><span className="sr-only">Ações</span></th></tr></thead>
                <tbody>
                  {rows.map(({ tx, order }) => (
                    <tr key={tx.id}>
                      <td><span className="block font-medium text-ink">{PAY_METHOD_LABEL[tx.method as PayMethod] ?? tx.method} · {tx.provider === "simulated" ? "Gateway (simulação)" : "Gateway Intercert"}</span><span className="block font-mono text-xs text-slate-500">{tx.providerRef ?? "—"}</span></td>
                      <td>{order ? <Link className="text-brand-700 hover:underline" href={`/comercio-digital/pedidos/${order.id}`}>{order.code}</Link> : "—"}</td>
                      <td className="tabular text-right">{formatMoney(tx.gross)}</td>
                      <td className="tabular text-right">{formatMoney(tx.fee)}</td>
                      <td className="tabular text-right font-medium">{formatMoney(tx.net)}</td>
                      <td className="text-xs">{tx.creditedAt ? `Creditado ${brDate(tx.creditedAt)}` : `Previsto ${brDate(tx.expectedAt)}`}</td>
                      <td><Badge tone={TONE[tx.status as GatewayTxStatus] ?? "neutral"}>{GATEWAY_TX_LABEL[tx.status as GatewayTxStatus] ?? tx.status}</Badge></td>
                      <td>
                        {canFin && ["credited", "partial"].includes(tx.status) && accountOptions.length > 0 && (
                          <ActionForm action={reconcileAction.bind(null, tx.id)} className="flex items-center justify-end gap-1" confirm="Confirmar a conciliação? As parcelas creditadas do recebível serão baixadas na conta escolhida, com a taxa do gateway.">
                            <select name="accountId" defaultValue={defaultAccount} className="h-8 rounded border border-slate-300 px-1 text-xs" aria-label="Conta do crédito">
                              {accountOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                            <button type="submit" className={buttonClass("secondary", "sm")}>Conciliar</button>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nenhum recebimento" description="Cada pagamento aprovado na loja gera aqui uma transação do gateway ligada ao recebível do pedido." />
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Conta dos créditos da loja">
            {canFin ? (
              <ActionForm action={setSettlementAccountAction} className="space-y-2">
                <Field label="Conta financeira (Banco Intercert)" htmlFor="accountId"><Select id="accountId" name="accountId" defaultValue={defaultAccount} options={accountOptions} placeholder="Escolha a conta" /></Field>
                <button type="submit" className={buttonClass("secondary", "sm")}>Salvar conta padrão</button>
              </ActionForm>
            ) : (
              <p className="text-sm text-slate-600">Somente consulta.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">Cadastre a conta do Banco Intercert em Financeiro › Cadastros (contas financeiras). O vínculo bancário e a titularidade são definidos na integração.</p>
          </Card>
          <Card title="Repasses">
            <p className="text-sm text-slate-600">Disponível conciliado para repasse: <strong className="text-ink">{formatMoney(ov.available)}</strong></p>
            {canFin && (
              <ActionForm action={preparePayoutAction} className="mt-2 space-y-2" resetOnSuccess>
                <Field label="Valor"><MoneyInput name="amount" defaultValue={ov.available} ariaLabel="Valor do repasse" /></Field>
                <Field label="Observação" htmlFor="notes"><Input id="notes" name="notes" /></Field>
                <button type="submit" className={buttonClass("secondary", "sm")}><Send className="size-4" aria-hidden /> Preparar solicitação de repasse</button>
              </ActionForm>
            )}
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {ov.payouts.slice(0, 10).map((p: any) => (
                <li key={p.id} className="py-2">
                  <span className="font-medium">{formatMoney(p.amount)}</span> · <Badge tone={p.status === "draft" ? "warn" : "info"}>{p.status === "draft" ? "Rascunho" : p.status}</Badge>
                  <span className="block text-xs text-slate-500">{p.requestedBy} · {brDateTime(p.requestedAt)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Preparar o repasse não movimenta dinheiro.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
