import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { today } from "@/lib/dates";
import { NoStockForm } from "./no-stock-form";

export const metadata = { title: "Nota de entrada sem estoque" };

/** Nota de entrada sem estoque (FIS-24): serviço tomado, uso e consumo ou despesa com nota — livro de entradas + contas a pagar. */
export default async function Page() {
  const s = await requireSession("purchases");
  await requireFeaturePage(s, "livroEntradas");
  if (!canDo(s.user, "purchase.receive")) notFound();
  const [suppliers, categories, costCenters, terms, methods] = await Promise.all([lookups.suppliers(s.ctx), lookups.finCategories(s.ctx, "expense"), lookups.costCenters(s.ctx), lookups.paymentTerms(s.ctx), lookups.paymentMethods(s.ctx)]);
  return (
    <>
      <PageHeader
        title="Nota de entrada sem estoque"
        crumbs={[{ label: "Fiscal" }, { label: "Livro de entradas", href: "/fiscal/entradas" }, { label: "Nota sem estoque" }]}
        description="Serviço tomado (NFS-e), material de uso e consumo ou despesa com nota: escriturada no livro de entradas e registrada como recebimento sem estoque, com a conta a pagar. Mercadoria para revenda entra pelo recebimento de mercadorias."
      />
      {!s.ctx.branchId ? (
        <Notice tone="warn">Selecione uma filial específica para lançar a nota (o contexto consolidado é somente consulta).</Notice>
      ) : (
        <Card>
          <NoStockForm suppliers={suppliers} categories={categories} costCenters={costCenters} terms={terms} methods={methods} today={today()} />
        </Card>
      )}
    </>
  );
}
