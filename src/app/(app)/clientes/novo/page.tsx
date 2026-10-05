import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { lookups } from "@/lib/server/lookups";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Novo cliente" };

export default async function Page() {
  const s = await requireSession("customers", "create");
  const [sellers, priceTables, terms] = await Promise.all([lookups.users(s.ctx), lookups.priceTables(s.ctx), lookups.paymentTerms(s.ctx)]);
  return (
    <>
      <PageHeader title="Novo cliente" crumbs={[{ label: "Clientes", href: "/clientes" }, { label: "Novo" }]} description="Campos acessórios são opcionais: salve como rascunho e complete depois." />
      <CustomerForm sellers={sellers} priceTables={priceTables} terms={terms} />
    </>
  );
}
