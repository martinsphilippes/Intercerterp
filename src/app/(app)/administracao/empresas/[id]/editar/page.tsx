import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { CRT_OPTIONS, REGIMES, UFS } from "@/domain/companies";
import { CompanyForm } from "../../forms";
import { companyView } from "../../access";

export const metadata = { title: "Editar empresa" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "edit");
  const { id } = await params;
  const cc = s.companies.some((x) => x.id === id) ? await companyView(s, id, "edit") : null;
  if (!cc) notFound();
  const c = await cc.store.getOrThrow("companies", id);
  return (
    <>
      <PageHeader title={`Editar ${c.tradeName || c.name}`} crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: c.tradeName || c.name, href: `/administracao/empresas/${id}` }, { label: "Editar" }]} />
      <CompanyForm company={c} regimes={REGIMES} crts={CRT_OPTIONS} ufs={UFS} />
    </>
  );
}
