import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { orderItems, revisionMode, EDITABLE, REVISABLE, ORDER_STATUS_LABEL } from "@/domain/purchases";
import { orderFormData } from "../../queries";
import { OrderForm } from "../../order-form";

export const metadata = { title: "Editar pedido de compra" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("purchases", "edit");
  const { id } = await params;
  const o = await s.ctx.store.get("purchase_orders", id);
  if (!o || o.companyId !== s.ctx.companyId) notFound();
  const crumbs = [{ label: "Pedidos de compra", href: "/compras/pedidos" }, { label: `nº ${o.number}`, href: `/compras/pedidos/${id}` }, { label: "Editar" }];
  const editable = EDITABLE.includes(o.status);
  const revising = REVISABLE.includes(o.status);
  if (!editable && !revising)
    return (
      <>
        <PageHeader title={`Pedido nº ${o.number}`} crumbs={crumbs} />
        <Notice tone="warn">Pedido {ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL]?.toLowerCase()} não pode ser alterado.</Notice>
      </>
    );
  if (s.ctx.branchId !== o.branchId)
    return (
      <>
        <PageHeader title={`Pedido nº ${o.number}`} crumbs={crumbs} />
        <Notice tone="warn">Selecione a filial do pedido para editá-lo.</Notice>
      </>
    );
  const [data, items, mode] = await Promise.all([orderFormData(s.ctx), orderItems(s.ctx.store, id), revisionMode(s.ctx.store, s.ctx.companyId)]);
  const skus = new Map((await Promise.all(items.map((i) => s.ctx.store.get("skus", i.skuId)))).filter(Boolean).map((k) => [k!.id, k!]));
  // o fornecedor do pedido pode estar inativo hoje: mantém na lista
  if (!data.suppliers.some((x) => x.value === o.supplierId)) data.suppliers.push({ value: o.supplierId, label: o.supplierSnapshot?.tradeName || o.supplierSnapshot?.name || "Fornecedor", leadTimeDays: null, paymentTermId: null, minOrderValue: 0, email: null });
  return (
    <>
      <PageHeader title={revising ? `Revisar pedido nº ${o.number} (revisão ${(o.revision ?? 1) + 1})` : `Editar pedido nº ${o.number}`} crumbs={crumbs} />
      <OrderForm
        order={o}
        items={items.map((i) => ({ skuId: i.skuId, sku: skus.get(i.skuId)?.sku ?? "", name: i.description, unitCode: i.unitCode ?? "UN", supplierCode: i.supplierCode ?? null, qty: i.qty, unitCost: i.unitCost, discount: i.discount ?? 0 }))}
        suppliers={data.suppliers}
        warehouses={data.warehouses}
        terms={data.terms}
        revising={revising}
        revisionMode={mode}
      />
    </>
  );
}
