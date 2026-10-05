import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { orderFormData } from "../queries";
import { OrderForm } from "../order-form";

export const metadata = { title: "Novo pedido de compra" };

export default async function Page({ searchParams }: { searchParams: Promise<{ fornecedor?: string }> }) {
  const s = await requireSession("purchases", "create");
  const { fornecedor } = await searchParams;
  if (!s.ctx.branchId)
    return (
      <>
        <PageHeader title="Novo pedido de compra" crumbs={[{ label: "Pedidos de compra", href: "/compras/pedidos" }, { label: "Novo" }]} />
        <Notice tone="warn" title="Selecione uma filial">O pedido é emitido para a filial/depósito de entrega. O contexto consolidado é somente consulta.</Notice>
      </>
    );
  const data = await orderFormData(s.ctx);
  return (
    <>
      <PageHeader
        title="Novo pedido de compra"
        crumbs={[{ label: "Pedidos de compra", href: "/compras/pedidos" }, { label: "Novo" }]}
        description={`Entrega na filial ${s.branch?.name}. Para importar de cotação ou reposição sem redigitar, use Cotações ou Planejamento de reposição.`}
      />
      <OrderForm suppliers={data.suppliers} warehouses={data.warehouses} terms={data.terms} defaultSupplierId={fornecedor ?? null} />
    </>
  );
}
