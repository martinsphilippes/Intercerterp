import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, ShoppingCart } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState } from "@/components/ui/empty";
import { supplierSummary } from "@/domain/suppliers";
import { dueState } from "@/domain/finance";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { setSupplierStatusAction, deleteSupplierAction } from "../actions";
import { SupplierProducts, type SpRow } from "./supplier-products";

export const metadata = { title: "Fornecedor" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("suppliers");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const c = await s.ctx.store.get("suppliers", id);
  if (!c || c.companyId !== s.ctx.companyId) notFound();
  const sum = await supplierSummary(s.ctx, id);
  const [terms, quotations] = await Promise.all([nameMap(s.ctx, "payment_terms"), nameMap(s.ctx, "quotations", (q) => `nº ${q.number} — ${q.title ?? ""}`)]);
  const label = c.tradeName || c.name;
  const base = `/fornecedores/${id}`;
  const canEdit = can(s.user, "suppliers", "edit");
  const hasOps = sum.orders.length + sum.receipts.length + sum.titles.length + sum.proposals.length > 0;
  const t = today();
  const spRows: SpRow[] = sum.products
    .map((p) => ({ id: p.id, skuId: p.skuId, sku: p.sku?.sku ?? p.skuId, name: p.sku?.name ?? "—", unitCode: p.sku?.unitCode ?? "UN", productId: p.sku?.productId ?? null, supplierCode: p.supplierCode, supplierDescription: p.supplierDescription, conversionFactor: p.conversionFactor || 1000, lastCost: p.lastCost, lastPurchaseAt: p.lastPurchaseAt, leadTimeDays: p.leadTimeDays, minQty: p.minQty, multiple: p.multiple, preferred: Boolean(p.preferred) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (
    <>
      <PageHeader
        title={label}
        crumbs={[{ label: "Fornecedores", href: "/fornecedores" }, { label }]}
        badges={
          <>
            <StatusBadge kind="generic" status={c.status} />
            <Badge>{c.personType === "PF" ? "Pessoa física" : "Pessoa jurídica"}</Badge>
          </>
        }
        description={[c.doc ? formatDoc(c.doc) : "Sem documento", c.code, c.tradeName && c.name !== c.tradeName ? c.name : null].filter(Boolean).join(" · ")}
        actions={
          <>
            {can(s.user, "purchases", "create") && c.status === "active" && (
              <LinkButton href={`/compras/pedidos/novo?fornecedor=${c.id}`}>
                <ShoppingCart className="size-4" /> Novo pedido
              </LinkButton>
            )}
            {canEdit && (
              <LinkButton href={`${base}/editar`} variant="primary">
                <Pencil className="size-4" /> Editar
              </LinkButton>
            )}
            {canEdit &&
              (c.status === "inactive" ? (
                <ActionButton action={setSupplierStatusAction.bind(null, id, "active")} label="Reativar" />
              ) : (
                <ActionButton action={setSupplierStatusAction.bind(null, id, "inactive")} label="Inativar" askReason="Motivo da inativação (o histórico de pedidos, recebimentos e títulos é preservado):" />
              ))}
            {can(s.user, "suppliers", "delete") && !hasOps && <ActionButton action={deleteSupplierAction.bind(null, id)} label="Excluir" variant="danger" confirm="Excluir definitivamente? Só é permitido sem operações." />}
          </>
        }
      />
      {c.status === "inactive" && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">Fornecedor inativo: não aparece em novas cotações e pedidos. Histórico preservado abaixo.</p>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Produtos fornecidos" value={sum.products.length} href={`${base}?tab=produtos`} />
        <Stat label="Pedidos a receber" value={formatMoney(sum.openOrdersTotal)} hint={`${sum.openOrders.length} pedido(s) aprovados/enviados/parciais`} href={`/compras/pedidos?supplier=${id}&status=open`} />
        <Stat label="Comprado (recebido)" value={formatMoney(sum.purchasedTotal)} hint={`${sum.receipts.filter((r) => r.status === "confirmed").length} recebimento(s) confirmados`} href={`${base}?tab=recebimentos`} />
        <Stat label="A pagar em aberto" value={formatMoney(sum.openBalance)} hint={sum.overdueBalance ? `${formatMoney(sum.overdueBalance)} vencido` : "Nada vencido"} tone={sum.overdueBalance ? "bad" : "default"} href={`${base}?tab=titulos`} />
        <Stat label="Prazo / pedido mínimo" value={`${c.leadTimeDays ?? "—"} d`} hint={c.minOrderValue ? `Mínimo ${formatMoney(c.minOrderValue)}` : "Sem pedido mínimo"} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Cadastro" },
          { key: "produtos", label: "Produtos fornecidos", count: sum.products.length },
          { key: "custos", label: "Custos e prazos recentes", count: sum.recentCosts.length },
          { key: "propostas", label: "Propostas", count: sum.proposals.length },
          { key: "pedidos", label: "Pedidos", count: sum.orders.length },
          { key: "recebimentos", label: "Recebimentos", count: sum.receipts.length },
          { key: "titulos", label: "Títulos", count: sum.installments.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identificação e contato">
            <DefinitionList
              items={[
                { label: c.personType === "PF" ? "Nome" : "Razão social", value: c.name },
                { label: "Nome fantasia", value: c.tradeName },
                { label: c.personType === "PF" ? "CPF" : "CNPJ", value: c.doc ? formatDoc(c.doc) : "—" },
                { label: "Inscrição estadual", value: c.ie },
                { label: "Inscrição municipal", value: c.im },
                { label: "E-mail", value: c.email },
                { label: "Telefone", value: formatPhone(c.phone) || "—" },
                { label: "Contatos", value: (c.contacts ?? []).length ? (c.contacts ?? []).map((ct: any, i: number) => <span key={i} className="block">{ct.name}{ct.role ? ` (${ct.role})` : ""}{ct.email ? ` · ${ct.email}` : ""}{ct.phone ? ` · ${formatPhone(ct.phone)}` : ""}</span>) : "—" },
              ]}
            />
          </Card>
          <Card title="Condições comerciais e endereços">
            <DefinitionList
              items={[
                { label: "Condição de pagamento", value: [c.paymentTermId ? terms.get(c.paymentTermId) : null, c.paymentTermsText].filter(Boolean).join(" · ") || "—" },
                { label: "Prazo de entrega", value: c.leadTimeDays != null ? `${c.leadTimeDays} dias` : "—" },
                { label: "Pedido mínimo", value: c.minOrderValue ? formatMoney(c.minOrderValue) : "—" },
                { label: "Política de frete", value: c.freightPolicy },
                { label: "Endereços", value: (c.addresses ?? []).length ? (c.addresses ?? []).map((a: any, i: number) => <span key={i} className="block">{a.type ? <span className="text-xs text-slate-500">{a.type}: </span> : null}{a.street ?? ""}, {a.number ?? "s/n"} — {a.district ?? ""}, {a.cityName ?? ""}/{a.uf ?? ""} {a.zip ?? ""}</span>) : "—" },
                { label: "Observações", value: c.notes },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === "produtos" && (
        <Card bodyClass="p-0">
          <SupplierProducts supplierId={id} rows={spRows} canEdit={canEdit} defaultLead={c.leadTimeDays ?? null} />
        </Card>
      )}
      {tab === "custos" && (
        <Card bodyClass="p-0" title="Custos e prazos praticados" description="Itens dos recebimentos confirmados (mais recentes primeiro). Prazo = do envio do pedido à confirmação do recebimento.">
          {sum.recentCosts.length === 0 ? (
            <EmptyState title="Sem recebimentos confirmados deste fornecedor" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Recebimento</th><th>Data</th><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Custo unit.</th><th className="text-right">Custo c/ frete</th><th className="text-right">Prazo real</th></tr>
                </thead>
                <tbody>
                  {sum.recentCosts.map((x, i) => (
                    <tr key={i}>
                      <td><Link className="text-brand-700 hover:underline" href={`/compras/recebimentos/${x.receiptId}`}>nº {x.number}</Link></td>
                      <td>{formatDate(x.date)}</td>
                      <td>{x.description}<span className="block text-xs text-slate-500">{x.sku}</span></td>
                      <td className="tabular text-right">{formatQty(x.qty)}</td>
                      <td className="tabular text-right">{formatMoney(x.unitCost)}</td>
                      <td className="tabular text-right">{formatMoney(x.landedUnitCost)}</td>
                      <td className="tabular text-right">{x.leadDays != null ? `${x.leadDays} d` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "propostas" && (
        <Card bodyClass="p-0">
          {sum.proposals.length === 0 ? (
            <EmptyState title="Sem propostas registradas" description="Propostas são registradas nas cotações." />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Cotação</th><th>Recebida em</th><th className="text-right">Itens</th><th className="text-right">Frete</th><th className="text-right">Pedido mínimo</th><th>Prazo</th><th>Validade</th><th>Versão</th></tr>
              </thead>
              <tbody>
                {sum.proposals.map((p) => (
                  <tr key={p.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/compras/cotacoes/${p.quotationId}?tab=propostas`}>{quotations.get(p.quotationId) ?? "Cotação"}</Link></td>
                    <td>{formatDateTime(p.receivedAt)}</td>
                    <td className="tabular text-right">{(p.items ?? []).length}</td>
                    <td className="tabular text-right">{formatMoney(p.freight)}</td>
                    <td className="tabular text-right">{formatMoney(p.minOrderValue)}</td>
                    <td>{p.leadTimeDays != null ? `${p.leadTimeDays} d` : "—"}</td>
                    <td>{formatDate(p.validUntil)} {p.validUntil && p.validUntil < t && <StatusBadge kind="quotation" status="expired" />}</td>
                    <td>v{p.version ?? 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "pedidos" && (
        <Card bodyClass="p-0">
          {sum.orders.length === 0 ? (
            <EmptyState title="Sem pedidos de compra" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Pedido</th><th>Criado em</th><th>Previsão</th><th>Situação</th><th className="text-right">Total</th><th className="text-right">Recebido</th></tr>
              </thead>
              <tbody>
                {sum.orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/compras/pedidos/${o.id}`}>nº {o.number}</Link>{(o.revision ?? 1) > 1 && <span className="ml-1 text-xs text-slate-500">rev. {o.revision}</span>}</td>
                    <td>{formatDate(o.createdAt)}</td>
                    <td>{formatDate(o.expectedDate)}</td>
                    <td><StatusBadge kind="purchase" status={o.status} /></td>
                    <td className="tabular text-right">{formatMoney(o.total)}</td>
                    <td className="tabular text-right">{formatMoney(o.receivedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "recebimentos" && (
        <Card bodyClass="p-0">
          {sum.receipts.length === 0 ? (
            <EmptyState title="Sem recebimentos" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Recebimento</th><th>NF-e</th><th>Data</th><th>Situação</th><th className="text-right">Faturado</th><th className="text-right">Devido</th><th>Título</th></tr>
              </thead>
              <tbody>
                {sum.receipts.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/compras/recebimentos/${r.id}`}>nº {r.number}</Link></td>
                    <td>{r.nfeNumber ? `${r.nfeNumber}${r.nfeSeries ? `/${r.nfeSeries}` : ""}` : "—"}</td>
                    <td>{formatDate(r.confirmedAt ?? r.createdAt)}</td>
                    <td><StatusBadge kind="receipt" status={r.status} /></td>
                    <td className="tabular text-right">{formatMoney(r.invoicedTotal)}</td>
                    <td className="tabular text-right">{formatMoney(r.dueTotal)}</td>
                    <td>{r.payableTitleId ? <Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${r.payableTitleId}`}>Ver título</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "titulos" && (
        <Card bodyClass="p-0">
          {sum.installments.length === 0 ? (
            <EmptyState title="Sem títulos a pagar" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Título / parcela</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th><th className="text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {sum.installments.map((i) => (
                  <tr key={i.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${i.titleId}`}>{i.description} — {i.number}</Link></td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td><StatusBadge kind="title" status={dueState(i)} /></td>
                    <td className="tabular text-right">{formatMoney(i.amount)}</td>
                    <td className="tabular text-right">{formatMoney(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`supplier:${id}`]} />
        </Card>
      )}
    </>
  );
}
