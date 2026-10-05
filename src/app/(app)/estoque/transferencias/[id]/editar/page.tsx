import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { transferCode } from "@/domain/transfers";
import { TransferForm } from "../../transfer-form";
import { transferFormData } from "../../form-data";

export const metadata = { title: "Editar transferência" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("stock", "edit");
  const { id } = await params;
  const t = await s.ctx.store.get("transfers", id);
  if (!t || t.companyId !== s.ctx.companyId) notFound();
  if (t.status !== "draft" || s.ctx.branchId !== t.fromBranchId) redirect(`/estoque/transferencias/${id}`);
  const data = await transferFormData(s, { items: t.items.map((i: any) => ({ skuId: i.skuId, qty: i.qty })), fromWarehouseId: t.fromWarehouseId });
  return (
    <>
      <PageHeader title={`Editar ${transferCode(t.number)}`} crumbs={[{ label: "Transferências", href: "/estoque/transferencias" }, { label: transferCode(t.number), href: `/estoque/transferencias/${id}` }, { label: "Editar" }]} />
      <TransferForm {...data} transfer={t} />
    </>
  );
}
