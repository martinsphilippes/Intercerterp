import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { CRT_OPTIONS, REGIMES, UFS } from "@/domain/companies";
import { CompanyForm } from "../forms";

export const metadata = { title: "Nova empresa" };

export default async function Page() {
  await requireSession("admin", "create");
  return (
    <>
      <PageHeader title="Nova empresa" crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: "Nova" }]} description="Cria a empresa com a filial matriz e a parametrização inicial editável." />
      <CompanyForm regimes={REGIMES} crts={CRT_OPTIONS} ufs={UFS} />
    </>
  );
}
