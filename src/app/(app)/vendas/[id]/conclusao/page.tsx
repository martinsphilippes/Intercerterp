import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Eye, LogOut, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { nameMap } from "@/lib/server/lookups";
import { EmailReceipt, FiscalStatus, NewSaleShortcut, ReceiptAutomation, WhatsAppLink } from "../../sale-widgets";

export const metadata = { title: "Venda concluída" };
export const dynamic = "force-dynamic";

/** Venda concluída (Tela 8): situação comercial e fiscal separadas, comprovantes e início do próximo atendimento. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ comprovante?: string }> }) {
  const s = await requireSession("sales");
  const { id } = await params;
  const { comprovante } = await searchParams;
  const store = s.ctx.store;
  const sale = await store.get("sales", id);
  if (!sale || sale.companyId !== s.ctx.companyId) notFound();
  const [items, payments, users, terminals, branches] = await Promise.all([
    listAll(store, "sale_items", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    listAll(store, "sale_payments", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    nameMap(s.ctx, "users"),
    nameMap(s.ctx, "terminals"),
    nameMap(s.ctx, "branches"),
  ]);
  const doc = sale.fiscalDocumentId ? await store.get("fiscal_documents", sale.fiscalDocumentId) : ((await listAll(store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", id]] }))[0] ?? null);
  const c = sale.customerSnapshot;
  const deferredTitles = payments.filter((p) => p.titleId && ["crediario", "boleto"].includes(p.methodKind)).map((p) => p.titleId);
  const installments = deferredTitles.length ? await listAll(store, "installments", { filters: [["eq", "titleId", deferredTitles]], orderBy: [{ field: "dueDate" }] }) : [];
  const company = await store.get("companies", sale.companyId);
  const units = items.reduce((a, i) => a + i.qty, 0);
  const waText = `${company?.tradeName || company?.name}: comprovante da compra nº ${sale.number} (${formatDateTime(sale.completedAt)}) — total ${formatMoney(sale.total)}. ${items.map((i) => `${formatQty(i.qty)} × ${i.description}`).join("; ")}.${doc?.status === "authorized" && doc.accessKey ? ` NFC-e chave ${doc.accessKey}.` : ""} Obrigado!`;
  return (
    <>
      <ReceiptAutomation saleId={id} mode={comprovante ?? null} email={c?.email ?? null} />
      <PageHeader
        title={`Venda nº ${sale.number}`}
        crumbs={[{ label: "PDV", href: "/pdv" }, { label: "Vendas", href: "/vendas" }, { label: `nº ${sale.number}`, href: `/vendas/${id}` }, { label: "Conclusão" }]}
        badges={<><StatusBadge kind="sale" status={sale.status} /><StatusBadge kind="payment" status={sale.paymentStatus} /></>}
        description={`${formatDateTime(sale.completedAt)} · ${branches.get(sale.branchId) ?? ""} · ${sale.terminalId ? terminals.get(sale.terminalId) : ""} · operador ${users.get(sale.operatorId) ?? "—"}`}
        actions={
          <>
            <LinkButton href={`/vendas/${id}/recibo?print=1`} target="_blank"><Printer className="size-4" /> Imprimir recibo</LinkButton>
            <LinkButton href={`/vendas/${id}`}><Eye className="size-4" /> Consultar esta venda</LinkButton>
            <LinkButton href="/vendas" variant="ghost"><LogOut className="size-4" /> Sair do PDV</LinkButton>
          </>
        }
      />
      {sale.status === "completed" ? (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <div className="min-w-[240px] flex-1">
            <p className="text-lg font-semibold text-emerald-900">Venda concluída — {formatMoney(sale.total)}</p>
            <p className="text-sm text-emerald-800">
              Pagamento registrado{sale.paymentStatus === "pending" ? " (parte a prazo, em contas a receber)" : ""} e estoque baixado na {branches.get(sale.branchId)}.{" "}
              {doc?.status === "authorized" ? `${doc.model === "nfce" ? "NFC-e" : "NF-e"} autorizada${doc.isSimulated ? " (simulação, sem validade fiscal)" : ""}.` : "Documento fiscal ainda não autorizado — veja a situação ao lado."}
            </p>
          </div>
          {sale.changeAmount > 0 && (
            <div className="rounded-lg bg-white px-5 py-3 text-right shadow-sm">
              <p className="text-xs font-medium text-slate-500">Troco a entregar</p>
              <p className="tabular text-3xl font-bold text-brand-800">{formatMoney(sale.changeAmount)}</p>
            </div>
          )}
          <NewSaleShortcut />
        </div>
      ) : (
        <Notice tone="bad" title="Venda cancelada">{sale.cancelReason}</Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Resumo da venda" description={`${items.length} produto(s) • ${formatQty(units)} unidade(s)`} className="lg:col-span-2" bodyClass="p-0">
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
            <DefinitionList
              cols={1}
              items={[
                { label: "Cliente", value: c ? (c.id ? <Link className="text-brand-700 hover:underline" href={`/clientes/${c.id}`}>{c.name}</Link> : c.name) : "Consumidor final" },
                { label: "CPF/CNPJ", value: c?.doc ? formatDoc(c.doc) : "Não informado" },
              ]}
            />
            <DefinitionList
              cols={1}
              items={[
                { label: "Vendedor", value: sale.sellerId ? users.get(sale.sellerId) : `${users.get(sale.operatorId) ?? "—"} (operador)` },
                { label: "Filial / caixa", value: `${branches.get(sale.branchId) ?? "—"} · ${sale.terminalId ? terminals.get(sale.terminalId) : "—"}` },
              ]}
            />
          </div>
          <table className="table-base w-full text-sm">
            <thead><tr><th>Item</th><th className="text-right">Qtd × unitário</th><th className="text-right">Desc.</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}<span className="block font-mono text-xs text-slate-500">{i.sku}</span></td>
                  <td className="tabular text-right">{formatQty(i.qty, i.unitCode)} × {formatMoney(i.unitPrice)}</td>
                  <td className="tabular text-right">{i.itemDiscount + i.globalDiscount ? formatMoney(i.itemDiscount + i.globalDiscount) : "—"}</td>
                  <td className="tabular text-right">{formatMoney(i.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td colSpan={2} className="px-3 py-2">Bruto {formatMoney(sale.subtotal)} · descontos {formatMoney(sale.discountTotal)} · acréscimos {formatMoney(sale.surchargeTotal)}</td><td className="px-3 py-2 text-right">Total</td><td className="tabular px-3 py-2 text-right">{formatMoney(sale.total)}</td></tr>
            </tfoot>
          </table>
          <table className="table-base w-full border-t border-line text-sm">
            <thead><tr><th>Pagamento</th><th>Detalhe</th><th className="text-right">Recebido</th><th className="text-right">Troco</th><th className="text-right">Aplicado</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.methodName}{p.installments > 1 ? ` · ${p.installments}x` : ""} {p.manual && ["pix", "debit", "credit"].includes(p.methodKind) && <span className="text-xs text-slate-500">(manual)</span>}</td>
                  <td className="text-xs text-slate-500">{[p.nsu && `NSU ${p.nsu}`, p.authCode && `Aut. ${p.authCode}`, p.cardBrand, p.providerRef && `Ref. ${p.providerRef}`].filter(Boolean).join(" · ")}{p.titleId && <Link className="ml-2 text-brand-700 hover:underline" href={`/financeiro/receber/${p.titleId}`}>título</Link>}</td>
                  <td className="tabular text-right">{formatMoney(p.received)}</td>
                  <td className="tabular text-right">{p.change ? formatMoney(p.change) : "—"}</td>
                  <td className="tabular text-right">{formatMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {installments.length > 0 && (
            <div className="border-t border-line p-3 text-sm">
              <p className="mb-1 font-medium">Vencimentos a prazo</p>
              <ul className="grid gap-1 sm:grid-cols-3">{installments.map((t) => <li key={t.id} className="tabular text-slate-600">{t.number}ª · {formatDate(t.dueDate)} · {formatMoney(t.amount)}</li>)}</ul>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Documento fiscal" description="Situação independente da conclusão comercial">
            <FiscalStatus
              saleId={id}
              model={doc?.model ?? null}
              auto
              initial={{ status: doc?.status ?? sale.fiscalStatus, message: doc?.statusMessage ?? null, documentId: doc?.id ?? null, number: doc?.number ?? null, simulated: Boolean(doc?.isSimulated), series: doc?.series ?? null, protocol: doc?.protocol ?? null, authorizedAt: doc?.authorizedAt ?? null, accessKey: doc?.accessKey ?? null, xmlFileId: doc?.xmlFileId ?? null }}
            />
          </Card>
          <Card title="Enviar ou baixar comprovantes">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <LinkButton size="sm" href={`/vendas/${id}/recibo?print=1`} target="_blank"><Printer className="size-4" /> Recibo (impressora do caixa)</LinkButton>
                <WhatsAppLink phone={c?.phone ?? null} text={waText} />
              </div>
              {c?.phone && <p className="text-xs text-slate-500">WhatsApp: {formatPhone(c.phone)} — mensagem enviada pelo próprio operador (sem integração automática).</p>}
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">E-mail ({c?.email ? "cliente cadastrado" : "informe o endereço"})</p>
                <EmailReceipt saleId={id} defaultEmail={c?.email ?? null} />
              </div>
              {sale.fiscalStatus !== "authorized" && sale.fiscalStatus !== "not_required" && (
                <p className="flex gap-1 text-xs text-amber-800"><AlertTriangle className="size-4 shrink-0" />DANFE NFC-e e XML ficam disponíveis após a autorização.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
