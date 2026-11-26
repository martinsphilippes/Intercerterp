import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { isolationMode } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { CRT_OPTIONS, REGIMES, UFS } from "@/domain/companies";
import { CompanyForm } from "../forms";

export const metadata = { title: "Nova empresa" };

export default async function Page() {
  const s = await requireSession("admin", "create");
  // multiempresa: empresa nova é contratada pelo Interos ou criada pela plataforma (o domínio também recusa)
  if (!s.user.isAdmin && isolationMode() === "estrito") redirect("/sem-permissao");
  return (
    <>
      <PageHeader title="Nova empresa" crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: "Nova" }]} description="Cria a empresa com a filial matriz e a parametrização inicial editável." />
      <CompanyForm regimes={REGIMES} crts={CRT_OPTIONS} ufs={UFS} />
    </>
  );
}
