import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { BusinessError } from "@/lib/core/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { FIN_KIND_LABEL, readClosing } from "@/domain/network";
import { requireNetworkSession } from "../../shared";

export const metadata = { title: "Fechamento da rede" };

/** §46 — detalhe de um fechamento: período, partes, título gerado e as vendas incluídas (CSV/XLSX). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireNetworkSession();
  const { id } = await params;
  let data;
  try {
    data = await readClosing(s.ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const { closing: c, entries } = data;
  const myTitle = c.payableCompanyId === s.ctx.companyId ? { id: c.payableTitleId, href: `/financeiro/pagar/${c.payableTitleId}`, label: "Título a pagar no seu financeiro" } : c.receivableCompanyId === s.ctx.companyId ? { id: c.receivableTitleId, href: `/financeiro/receber/${c.receivableTitleId}`, label: "Título a receber no seu financeiro" } : null;
  const exportable = canDo(s.user, "data.export");
  return (
    <>
      <PageHeader
        title={`Fechamento ${c.code}`}
        crumbs={[{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Resultado da rede", href: "/rede/financeiro" }, { label: c.code }]}
        badges={<><Badge tone={c.status === "closed" ? "good" : "warn"}>{c.status === "closed" ? "fechado" : "título pendente"}</Badge>{c.manual && <Badge>fechado manualmente</Badge>}</>}
        description={`${FIN_KIND_LABEL[c.kind] ?? c.kind}: ${c.payerName} → ${c.payeeName} · ${formatDate(c.periodFrom)} a ${formatDate(c.periodTo)}`}
        actions={exportable ? (
          <>
            <a href={`/api/export/network-closing?id=${c.id}`} className={buttonClass("ghost", "sm")}><Download className="size-4" aria-hidden /> CSV</a>
            <a href={`/api/export/network-closing?id=${c.id}&formato=xlsx`} className={buttonClass("ghost", "sm")}><FileSpreadsheet className="size-4" aria-hidden /> XLSX</a>
          </>
        ) : undefined}
      />
      {c.notes && <div className="mb-4"><Notice tone="warn">{c.notes}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Vendas incluídas" description="Vendas pagas até o corte e estornos (crédito) ainda não faturados.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Pagamento</th><th className="py-1 text-left font-medium">Venda</th><th className="py-1 text-left font-medium">Produto</th><th className="py-1 text-left font-medium">Evento</th><th className="py-1 text-right font-medium">Valor</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="py-1.5 text-xs">{formatDate(e.date)}</td>
                      <td className="py-1.5"><Link href={`/rede/vendas/${e.requestId}`} className="text-brand-700 hover:underline">{e.protocol}</Link></td>
                      <td className="py-1.5 text-xs">{e.productLabel}</td>
                      <td className="py-1.5 text-xs">{e.event === "reversal" ? <Badge tone="warn">estorno (crédito)</Badge> : "venda paga"}</td>
                      <td className={`tabular py-1.5 text-right ${Number(e.amount) < 0 ? "text-red-700" : ""}`}>{formatMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={4} className="py-1.5 text-right text-xs font-semibold">Total</td><td className="tabular py-1.5 text-right font-semibold">{formatMoney(c.total)}</td></tr></tfoot>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Resumo">
          <DefinitionList cols={1} items={[
            { label: "Quem paga", value: c.payerName },
            { label: "Quem recebe", value: c.payeeName },
            { label: "Total", value: formatMoney(c.total) },
            { label: "Lançamentos", value: String(c.count) },
            { label: "Vencimento", value: formatDate(c.dueDate) },
            { label: "Fechado em", value: `${formatDateTime(c.closedAt)} · ${c.byName ?? "rotina diária"}` },
            myTitle?.id ? { label: myTitle.label, value: <Link href={myTitle.href} className="text-brand-700 hover:underline">abrir o título</Link> } : null,
          ]} />
        </Card>
      </div>
    </>
  );
}
