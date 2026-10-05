import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { lookups } from "@/lib/server/lookups";
import { SupplierForm } from "../../supplier-form";

export const metadata = { title: "Editar fornecedor" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("suppliers", "edit");
  const { id } = await params;
  const c = await s.ctx.store.get("suppliers", id);
  if (!c || c.companyId !== s.ctx.companyId) notFound();
  const terms = await lookups.paymentTerms(s.ctx);
  const label = c.tradeName || c.name;
  return (
    <>
      <PageHeader title={`Editar ${label}`} crumbs={[{ label: "Fornecedores", href: "/fornecedores" }, { label, href: `/fornecedores/${c.id}` }, { label: "Editar" }]} />
      <SupplierForm supplier={c} terms={terms} />
    </>
  );
}
