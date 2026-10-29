import Link from "@/components/ui/link";
import { Plus, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { FilterBar } from "@/components/ui/filters";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { unscoped } from "@/lib/db/scoped-store";
import { certificationSettings } from "@/domain/accounting";
import { listNetworkSales, networkSettings, networkViewer, salesSummary } from "@/domain/network";
import { requireNetworkSession } from "../shared";
import { SaleProgress } from "./components";

export const metadata = { title: "Vendas de certificados" };

const STATUS_OPTIONS = [
  { value: "open", label: "Em andamento" },
  { value: "awaiting_payment", label: "Aguardando pagamento" },
  { value: "overdue", label: "Cobrança vencida" },
  { value: "validation", label: "Validação do titular" },
  { value: "issued", label: "Emitidas" },
  { value: "cancelled", label: "Canceladas" },
];

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireNetworkSession();
  const sp = await searchParams;
  const v = await networkViewer(s.ctx);
  const crumbs = [{ label: "Rede de certificação", href: v.platform ? "/rede" : "/rede/minha" }, { label: "Vendas" }];
  const canRead = v.platform || canDo(s.user, "network.sell") || canDo(s.user, "network.sales_all");
  if (!canRead || (!v.platform && !v.myNode)) {
    return (
      <>
        <PageHeader title="Vendas de certificados" crumbs={crumbs} />
        <Notice tone="warn" title="Sem acesso às vendas da rede">As vendas de certificados são dos parceiros da rede (operação “Vender certificados pela rede” ou “Ver todas as vendas do nó”).</Notice>
      </>
    );
  }
  const [rows, settings, { levelLabels }] = await Promise.all([
    listNetworkSales(s.ctx, { status: sp.status, nodeId: sp.no, sellerUserId: sp.vendedor, productKey: sp.produto, q: sp.q, from: sp.de, to: sp.ate }),
    certificationSettings(s.ctx.store),
    networkSettings(s.ctx.store),
  ]);
  const sum = salesSummary(rows);
  const canSell = Boolean(v.myNode && v.myNode.level !== "contador" && canDo(s.user, "network.sell"));
  const sellerIds = [...new Set(rows.map((r) => r.request.sellerUserId).filter(Boolean))];
  const sellers = (await Promise.all(sellerIds.map((id) => unscoped(s.ctx.store).get("users", id)))).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const nodeOptions = v.nodes.filter((n) => v.visible.has(n.id)).map((n) => ({ value: n.id, label: `${levelLabels[n.level as keyof typeof levelLabels] ?? n.level} · ${n.name}` }));
  return (
    <>
      <PageHeader
        title="Vendas de certificados"
        crumbs={crumbs}
        description={v.platform ? "Todas as vendas da rede (parceiros e escritórios-contadores), com o retrato completo da cascata." : canDo(s.user, "network.sales_all") ? "Vendas do seu nó e, em consulta, dos parceiros abaixo. Os custos dos níveis acima do seu parceiro não aparecem." : "As suas vendas de certificados."}
        actions={canSell ? <LinkButton href="/rede/vendas/nova" variant="primary"><Plus className="size-4" aria-hidden /> Nova venda</LinkButton> : undefined}
      />
      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Vendas" value={sum.count.toLocaleString("pt-BR")} hint="sem as canceladas" />
        <Stat label="Valor ao cliente" value={formatMoney(sum.total)} />
        <Stat label="Aguardando pagamento" value={sum.awaitingPayment.toLocaleString("pt-BR")} tone={sum.awaitingPayment ? "warn" : "default"} />
        <Stat label="Em validação/emissão" value={sum.validation.toLocaleString("pt-BR")} />
        <Stat label="Emitidas" value={sum.issued.toLocaleString("pt-BR")} tone="good" />
      </section>
      <FilterBar
        basePath="/rede/vendas"
        values={sp}
        filters={[
          { type: "search", placeholder: "Titular, CPF/CNPJ ou protocolo" },
          { type: "select", name: "status", label: "Situação", options: STATUS_OPTIONS },
          ...(nodeOptions.length > 1 ? [{ type: "select" as const, name: "no", label: "Parceiro", options: nodeOptions }] : []),
          ...(sellers.length > 1 ? [{ type: "select" as const, name: "vendedor", label: "Vendedor", options: sellers.map((u) => ({ value: u.id, label: u.name })) }] : []),
          { type: "select", name: "produto", label: "Produto", options: settings.catalog.map((p) => ({ value: p.key, label: p.label })) },
          { type: "date", name: "de", label: "De" },
          { type: "date", name: "ate", label: "Até" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<ShoppingCart className="size-8" aria-hidden />} title="Nenhuma venda encontrada" description={canSell ? "Registre a primeira venda: produto, cliente, preço (com cupom ou voucher) e confirmação." : "Ajuste os filtros."} action={canSell ? <LinkButton href="/rede/vendas/nova" variant="primary">Nova venda</LinkButton> : undefined} />
      ) : (
        <Card bodyClass="p-0">
          <ul className="divide-y divide-line md:hidden">
            {rows.map(({ request: r, displayStatus, nodeName, own, masked }) => (
              <li key={r.id} className="p-3">
                <Link href={`/rede/vendas/${r.id}`} className="block">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-brand-700">{r.holderName}</span>
                    <span className="tabular font-medium">{formatMoney(r.amount)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{r.protocol} · {r.productLabel} · {formatDate(r.createdAt)}{!own ? ` · ${nodeName}` : ""}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge kind="certificate_request" status={displayStatus} /><SaleProgress r={r} compact />{masked?.sellerMargin != null && own && <span className="text-xs text-emerald-700">margem {formatMoney(masked.sellerMargin)}</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Protocolo</th>
                  <th className="px-3 py-2 text-left font-medium">Titular</th>
                  <th className="px-3 py-2 text-left font-medium">Produto</th>
                  <th className="px-3 py-2 text-left font-medium">Parceiro / vendedor</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-right font-medium">Margem do vendedor</th>
                  <th className="px-3 py-2 text-left font-medium">Situação</th>
                  <th className="px-3 py-2 text-left font-medium">Progresso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ request: r, displayStatus, nodeName, own, masked }) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2">
                      <Link href={`/rede/vendas/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.protocol}</Link>
                      <span className="block text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                    </td>
                    <td className="px-3 py-2">{r.holderName}<span className="block text-xs text-slate-500">{formatDoc(r.holderDoc)}</span></td>
                    <td className="px-3 py-2">
                      {r.productLabel}
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {r.free && <Badge tone="good">gratuito</Badge>}
                        {r.couponCode && <Badge tone="accent">{r.couponCode}</Badge>}
                        {r.voucherRedemptionId && <Badge tone="info">{r.gift ? "presente" : "voucher"}</Badge>}
                        {r.kind === "renewal" && <Badge>renovação</Badge>}
                        {r.channel !== "network" && <Badge>contador</Badge>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{own ? "Seu nó" : nodeName}<span className="block text-slate-500">{r.sellerName ?? "—"}</span></td>
                    <td className="tabular px-3 py-2 text-right">{formatMoney(r.amount)}</td>
                    <td className="tabular px-3 py-2 text-right text-emerald-700">{masked?.sellerMargin != null ? formatMoney(masked.sellerMargin) : "—"}</td>
                    <td className="px-3 py-2"><StatusBadge kind="certificate_request" status={displayStatus} /></td>
                    <td className="px-3 py-2"><SaleProgress r={r} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
