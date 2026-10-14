import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { getSetting } from "@/lib/core/settings";
import { addDays, today } from "@/lib/dates";
import type { SalesDocType } from "@/domain/sales-documents";
import { DocumentForm } from "./document-form";

/** Novo orçamento / pedido de venda (filial ativa; preços e limites pela regra da venda). */
export async function NewDocumentPage({ type, searchParams }: { type: SalesDocType; searchParams: Promise<{ cliente?: string }> }) {
  const s = await requireSession("sales");
  await requireFeaturePage(s, "documentoComercial");
  const quote = type === "quote";
  const list = quote ? "/vendas/orcamentos" : "/vendas/pedidos";
  if (!canDo(s.user, quote ? "sales_doc.quote" : "sales_doc.order")) redirect("/sem-permissao");
  const { cliente } = await searchParams;
  const header = <PageHeader title={quote ? "Novo orçamento" : "Novo pedido de venda"} crumbs={[{ label: quote ? "Orçamentos" : "Pedidos de venda", href: list }, { label: "Novo" }]} description={quote ? "Proposta ao cliente com validade. Não reserva estoque nem gera títulos." : "Pedido com reserva de estoque. O faturamento (PDV ou NF-e) é que movimenta estoque e financeiro."} />;
  if (!s.branch)
    return (
      <>
        {header}
        <Notice tone="warn">Selecione uma filial específica no topo da tela: o contexto consolidado é somente consulta.</Notice>
      </>
    );
  const [customers, sellers, priceTables, terms] = await Promise.all([lookups.customers(s.ctx), lookups.users(s.ctx), lookups.priceTables(s.ctx), lookups.paymentTerms(s.ctx)]);
  const days = Number(await getSetting<number>(s.ctx.store, s.ctx.companyId, s.ctx.branchId, "sales.quoteValidityDays", 10)) || 10;
  return (
    <>
      {header}
      <DocumentForm
        initial={{ type, customerId: customers.some((c) => c.value === cliente) ? cliente : null, sellerId: s.user.id, priceTableId: s.branch.defaultPriceTableId ?? null, items: [] }}
        customers={customers}
        sellers={sellers}
        priceTables={priceTables}
        terms={terms}
        defaultValidUntil={quote ? addDays(today(), days) : null}
        discountLimitBps={s.user.discountLimitBps ?? 0}
        canOverLimit={canDo(s.user, "sale.discount_over_limit")}
      />
    </>
  );
}
