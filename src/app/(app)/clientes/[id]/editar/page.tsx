import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { lookups } from "@/lib/server/lookups";
import { CustomerForm } from "../../customer-form";

export const metadata = { title: "Editar cliente" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("customers", "edit");
  const { id } = await params;
  const c = await s.ctx.store.get("customers", id);
  if (!c || c.companyId !== s.ctx.companyId) notFound();
  const [sellers, priceTables, terms] = await Promise.all([lookups.users(s.ctx), lookups.priceTables(s.ctx), lookups.paymentTerms(s.ctx)]);
  return (
    <>
      <PageHeader title={`Editar ${c.name}`} crumbs={[{ label: "Clientes", href: "/clientes" }, { label: c.name, href: `/clientes/${c.id}` }, { label: "Editar" }]} />
      <CustomerForm customer={c} sellers={sellers} priceTables={priceTables} terms={terms} />
    </>
  );
}
