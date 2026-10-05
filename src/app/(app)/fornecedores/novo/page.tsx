import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { lookups } from "@/lib/server/lookups";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Novo fornecedor" };

export default async function Page() {
  const s = await requireSession("suppliers", "create");
  const terms = await lookups.paymentTerms(s.ctx);
  return (
    <>
      <PageHeader title="Novo fornecedor" crumbs={[{ label: "Fornecedores", href: "/fornecedores" }, { label: "Novo" }]} description="Salve como rascunho para completar depois. Os produtos fornecidos são vinculados no detalhe do fornecedor." />
      <SupplierForm terms={terms} />
    </>
  );
}
