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
        description="Defina fornecedor, produtos, custos, entrega e condição financeira. O número é atribuído ao salvar o rascunho."
        badges={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Novo rascunho</span>}
      />
      <OrderForm {...data} branchName={s.branch?.name ?? ""} currentUserId={s.user.id} defaultSupplierId={fornecedor ?? null} />
    </>
  );
}
