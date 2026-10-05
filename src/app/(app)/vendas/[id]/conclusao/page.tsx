import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Download, Eye, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { nameMap } from "@/lib/server/lookups";
import { EmailReceipt, FiscalStatus, NewSaleShortcut } from "../../sale-widgets";

export const metadata = { title: "Venda concluída" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("sales");
  const { id } = await params;
  const store = s.ctx.store;
  const sale = await store.get("sales", id);
  if (!sale || sale.companyId !== s.ctx.companyId) notFound();
  const [items, payments, users, terminals] = await Promise.all([
    listAll(store, "sale_items", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    listAll(store, "sale_payments", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    nameMap(s.ctx, "users"),
    nameMap(s.ctx, "terminals"),
  ]);
  const doc = sale.fiscalDocumentId ? await store.get("fiscal_documents", sale.fiscalDocumentId) : (await listAll(store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", id]] }))[0] ?? null;
  const c = sale.customerSnapshot;
  const titles = payments.some((p) => p.titleId) ? await listAll(store, "installments", { filters: [["eq", "titleId", payments.map((p) => p.titleId).filter(Boolean)]], orderBy: [{ field: "dueDate" }] }) : [];
  return (
    <>
      <PageHeader
        title={`Venda nº ${sale.number}`}
        crumbs={[{ label: "PDV", href: "/pdv" }, { label: "Vendas", href: "/vendas" }, { label: `nº ${sale.number}`, href: `/vendas/${id}` }, { label: "Conclusão" }]}
        badges={<><StatusBadge kind="sale" status={sale.status} /><StatusBadge kind="payment" status={sale.paymentStatus} /></>}
        description={`${formatDateTime(sale.completedAt)} · ${sale.terminalId ? terminals.get(sale.terminalId) : ""} · operador ${users.get(sale.operatorId) ?? "—"}`}
        actions={
          <>
            <LinkButton href={`/vendas/${id}/recibo?print=1`} target="_blank"><Printer className="size-4" /> Imprimir recibo</LinkButton>
            <LinkButton href={`/vendas/${id}`}><Eye className="size-4" /> Consultar venda</LinkButton>
          </>
        }
      />
      {sale.status === "completed" ? (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <div className="flex-1">
            <p className="text-lg font-semibold text-emerald-900">Venda concluída — {formatMoney(sale.total)}</p>
            <p className="text-sm text-emerald-800">Estoque, caixa e financeiro registrados. A situação fiscal é exibida separadamente abaixo.</p>
          </div>
          {sale.changeAmount > 0 && (
            <div className="rounded-lg bg-white px-5 py-3 text-right shadow-sm">
              <p className="text-xs font-medium text-slate-500">Troco</p>
              <p className="tabular text-3xl font-bold text-brand-800">{formatMoney(sale.changeAmount)}</p>
            </div>
          )}
          <NewSaleShortcut />
        </div>
      ) : (
        <Notice tone="bad" title="Venda cancelada">{sale.cancelReason}</Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Resumo" className="lg:col-span-2" bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Item</th><th className="text-right">Qtd</th><th className="text-right">Preço</th><th className="text-right">Desc.</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}<span className="block font-mono text-xs text-slate-500">{i.sku}</span></td>
                  <td className="tabular text-right">{formatQty(i.qty, i.unitCode)}</td>
                  <td className="tabular text-right">{formatMoney(i.unitPrice)}</td>
                  <td className="tabular text-right">{i.itemDiscount + i.globalDiscount ? formatMoney(i.itemDiscount + i.globalDiscount) : "—"}</td>
                  <td className="tabular text-right">{formatMoney(i.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td colSpan={3} className="px-3 py-2">Bruto {formatMoney(sale.subtotal)} · descontos {formatMoney(sale.discountTotal)} · acréscimos {formatMoney(sale.surchargeTotal)}</td><td className="px-3 py-2 text-right">Total</td><td className="tabular px-3 py-2 text-right">{formatMoney(sale.total)}</td></tr>
            </tfoot>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title="Situação fiscal" description="Independente da conclusão comercial">
            <FiscalStatus saleId={id} status={doc?.status ?? sale.fiscalStatus} model={doc?.model ?? null} documentId={doc?.id ?? null} number={doc?.number ?? null} message={doc?.statusMessage ?? null} simulated={Boolean(doc?.isSimulated)} auto />
            {doc?.xmlFileId && doc.status === "authorized" && (
              <a className="mt-2 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href={`/api/files/${doc.xmlFileId}`}><Download className="size-4" /> Baixar XML</a>
            )}
          </Card>
          <Card title="Cliente">
            <DefinitionList cols={1} items={[{ label: "Identificação", value: c ? (c.id ? <Link className="text-brand-700 hover:underline" href={`/clientes/${c.id}`}>{c.name}</Link> : c.name) : "Consumidor final" }, { label: "CPF/CNPJ na nota", value: c?.doc ? formatDoc(c.doc) : "Não informado" }]} />
          </Card>
          <Card title="Enviar comprovante por e-mail">
            <EmailReceipt saleId={id} defaultEmail={c?.email ?? null} />
          </Card>
        </div>
        <Card title="Pagamentos" className="lg:col-span-2" bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Meio</th><th>Detalhe</th><th className="text-right">Recebido</th><th className="text-right">Troco</th><th className="text-right">Aplicado</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.methodName}{p.installments > 1 ? ` · ${p.installments}x` : ""} {p.manual && ["pix", "debit", "credit"].includes(p.methodKind) && <span className="text-xs text-slate-500">(manual)</span>}</td>
                  <td className="text-xs text-slate-500">{[p.nsu && `NSU ${p.nsu}`, p.authCode && `Aut. ${p.authCode}`, p.cardBrand, p.providerRef && `Ref. ${p.providerRef}`, p.titleId && <Link key="t" className="text-brand-700 hover:underline" href={`/financeiro/receber/${p.titleId}`}>título</Link>].filter(Boolean).map((x, i) => <span key={i} className="mr-2">{x}</span>)}</td>
                  <td className="tabular text-right">{formatMoney(p.received)}</td>
                  <td className="tabular text-right">{p.change ? formatMoney(p.change) : "—"}</td>
                  <td className="tabular text-right">{formatMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {titles.length > 0 && (
            <div className="border-t border-line p-3 text-sm">
              <p className="mb-1 font-medium">Vencimentos</p>
              <ul className="grid gap-1 sm:grid-cols-3">{titles.map((t) => <li key={t.id} className="tabular text-slate-600">{t.number}ª · {formatDate(t.dueDate)} · {formatMoney(t.amount)}</li>)}</ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
