import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Tag } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage, featureOn } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { can, canDo } from "@/lib/permissions";
import { lookups, nameMap } from "@/lib/server/lookups";
import { formatDateTime } from "@/lib/dates";
import { supplierLabel } from "@/domain/suppliers";
import { receiptPricing } from "@/domain/receipt-pricing";
import { ReceiptPricingEditor } from "./pricing-editor";

export const metadata = { title: "Precificação após a entrada" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("purchases");
  await requireFeaturePage(s, "precificacaoEntrada");
  if (!canDo(s.user, "purchase.pricing") || !can(s.user, "products", "view")) redirect("/sem-permissao");
  const { id } = await params;
  const r = await s.ctx.store.get("receipts", id);
  if (!r || r.companyId !== s.ctx.companyId) notFound();
  const crumbs = [{ label: "Recebimentos", href: "/compras/recebimentos" }, { label: `nº ${r.number}`, href: `/compras/recebimentos/${id}` }, { label: "Precificação" }];
  const back = (
    <LinkButton href={`/compras/recebimentos/${id}`}>
      <ArrowLeft className="size-4" /> Voltar ao recebimento
    </LinkButton>
  );
  if (r.status !== "confirmed") {
    return (
      <>
        <PageHeader title={`Precificação — recebimento nº ${r.number}`} crumbs={crumbs} actions={back} />
        <Notice tone="warn" title="Recebimento ainda não concluído">A precificação usa o custo de entrada calculado na conclusão. Conclua a conferência e a entrada do recebimento para precificar.</Notice>
      </>
    );
  }
  const [data, tables, supplier, users, labelsOn] = await Promise.all([
    receiptPricing(s.ctx, id),
    lookups.priceTables(s.ctx),
    s.ctx.store.get("suppliers", r.supplierId),
    nameMap(s.ctx, "users"),
    featureOn(s, "etiquetas"),
  ]);
  const canApply = can(s.user, "products", "edit");
  const up = data.lines.filter((l) => (l.costVariationBps ?? 0) > 0).length;
  const down = data.lines.filter((l) => (l.costVariationBps ?? 0) < 0).length;
  const squeezed = data.lines.filter((l) => l.marginBefore != null && l.marginBeforeEntry != null && l.marginBefore < l.marginBeforeEntry).length;
  const labelsHref = labelsOn ? `/produtos/etiquetas?recebimento=${id}` : null;
  const done = data.receipt.pricingStatus === "done";
  return (
    <>
      <PageHeader
        title={`Precificação — recebimento nº ${r.number}`}
        crumbs={crumbs}
        badges={done ? <Badge tone="good">Precificado</Badge> : <Badge tone="warn">Precificação pendente</Badge>}
        description={`${supplier ? supplierLabel(supplier) : (r.emitter?.name ?? "—")}${r.nfeNumber ? ` · NF-e ${r.nfeNumber}` : ""} · entrada concluída em ${formatDateTime(r.confirmedAt)}${done && data.receipt.pricedAt ? ` · precificado em ${formatDateTime(data.receipt.pricedAt)} por ${users.get(data.receipt.pricedBy ?? "") ?? "—"}` : ""}`}
        actions={
          <>
            {back}
            {labelsHref && (
              <LinkButton href={labelsHref}>
                <Tag className="size-4" /> Imprimir etiquetas
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Itens do recebimento" value={data.lines.length} hint={`Tabela ${data.table.name}`} />
        <Stat label="Custo subiu" value={up} hint="Em relação ao custo anterior" tone={up ? "warn" : "default"} />
        <Stat label="Custo caiu" value={down} hint="Em relação ao custo anterior" />
        <Stat label="Margem reduzida" value={squeezed} hint="Mantendo o preço atual" tone={squeezed ? "bad" : "default"} />
      </div>
      <ReceiptPricingEditor
        receiptId={id}
        initial={{ lines: JSON.parse(JSON.stringify(data.lines)), settings: data.settings, tableId: data.table.id }}
        tables={tables}
        canApply={canApply}
        labelsHref={labelsHref}
      />
    </>
  );
}
