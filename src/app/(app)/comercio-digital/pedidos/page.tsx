import Link from "@/components/ui/link";
import { PackageCheck } from "lucide-react";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { searchable } from "@/lib/core/text";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_STATUS_LABEL, PAY_METHOD_LABEL, type OrderStatus, type PaymentStatus } from "@/domain/ecommerce/common";
import { expirePendingOrders, operationLabel } from "@/domain/ecommerce/orders";
import { brDateTime, ecomStorePage } from "../_lib";

export const metadata = { title: "Pedidos on-line" };

const PAY_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "info"> = { paid: "good", pending: "warn", authorized: "info", failed: "bad", expired: "neutral", cancelled: "neutral", refund_pending: "warn", refunded: "neutral" };

/** Tela 54 — Pedidos on-line: busca, situação e acesso ao detalhe (pagamento, fiscal, reserva e atendimento). */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.orders", "ecommerce.cancel", "ecommerce.finance", "ecommerce.manage"]);
  const params = await searchParams;
  await expirePendingOrders(s.ctx.store, s.ctx.companyId).catch(() => 0);
  const q = (sp(params, "q") || "").trim();
  const status = sp(params, "status") || "";
  const all = (await listAll(unscoped(s.ctx.store), "online_orders", { filters: [["eq", "storeId", st.id]] }, 5000)).sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  const needle = searchable(q);
  const rows = all.filter((o) => (!status || o.status === status) && (!needle || String(o.searchText ?? "").includes(needle) || String(o.code).toLowerCase().includes(q.toLowerCase()))).slice(0, 300);
  const count = (x: OrderStatus) => all.filter((o) => o.status === x).length;
  return (
    <>
      <PageHeader
        title="Pedidos on-line"
        crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Pedidos on-line" }]}
        description="Acompanhe cada venda, da confirmação ao pós-venda. A expedição exige pagamento aprovado e NF-e autorizada."
        actions={<Link href="/comercio-digital/expedicao" className={buttonClass("secondary")}><PackageCheck className="size-4" aria-hidden /> Expedição</Link>}
      />
      <section aria-label="Resumo dos pedidos" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Aguardando pagamento" value={count("pending_payment")} href="/comercio-digital/pedidos?status=pending_payment" />
        <Stat label="Pagos — a faturar" value={count("paid")} href="/comercio-digital/pedidos?status=paid" tone={count("paid") ? "warn" : "default"} />
        <Stat label="Nota emitida — a preparar" value={count("invoiced")} href="/comercio-digital/pedidos?status=invoiced" />
        <Stat label="Prontos para retirada" value={count("ready_for_pickup")} href="/comercio-digital/pedidos?status=ready_for_pickup" />
        <Stat label="Devoluções solicitadas" value={count("return_requested")} href="/comercio-digital/pedidos?status=return_requested" tone={count("return_requested") ? "warn" : "default"} />
      </section>
      <Card bodyClass="p-0">
        <form className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3" role="search">
          <Field label="Buscar pedido ou cliente" htmlFor="q" className="min-w-[220px] flex-1"><Input id="q" name="q" defaultValue={q} placeholder={`Ex.: ${st.orderPrefix ?? "PED"}-1048, nome, e-mail ou CPF`} /></Field>
          <Field label="Situação" htmlFor="status"><Select id="status" name="status" defaultValue={status} options={[{ value: "", label: "Todas" }, ...Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} /></Field>
          <button type="submit" className={buttonClass("secondary")}>Buscar</button>
        </form>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Pedido / cliente</th>
                  <th>Origem</th>
                  <th>Pagamento</th>
                  <th>Operação</th>
                  <th>Entrega</th>
                  <th className="text-right">Total</th>
                  <th className="text-right"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="block font-semibold text-ink">{o.code}</span>
                      <span className="block text-xs text-slate-500">{o.customer?.name} · {brDateTime(o.createdAt)}</span>
                    </td>
                    <td>{o.origin === "store" ? "Loja virtual" : o.origin}</td>
                    <td>
                      <Badge tone={PAY_TONE[o.paymentStatus] ?? "neutral"}>{PAYMENT_STATUS_LABEL[o.paymentStatus as PaymentStatus] ?? o.paymentStatus}</Badge>
                      <span className="mt-0.5 block text-xs text-slate-500">{PAY_METHOD_LABEL[o.payment?.method as keyof typeof PAY_METHOD_LABEL] ?? ""}</span>
                    </td>
                    <td>
                      <Badge tone={ORDER_STATUS_TONE[o.status as OrderStatus] ?? "neutral"}>{operationLabel(o)}</Badge>
                    </td>
                    <td className="text-xs text-slate-600">{o.delivery?.label}</td>
                    <td className="tabular text-right font-medium">{formatMoney(o.total)}</td>
                    <td className="text-right"><Link href={`/comercio-digital/pedidos/${o.id}`} className={buttonClass("secondary", "sm")}>Detalhes</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nenhum pedido encontrado" description={all.length ? "Ajuste a busca ou a situação." : "Os pedidos da loja virtual aparecem aqui assim que os clientes concluírem o checkout."} />
        )}
      </Card>
    </>
  );
}
