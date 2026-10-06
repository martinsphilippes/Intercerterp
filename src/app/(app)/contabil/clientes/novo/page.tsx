import { requireFirmSession } from "../../guard";
import { PageHeader } from "@/components/ui/page-header";
import { CRT_OPTIONS, REGIMES, UFS } from "@/domain/companies";
import { today } from "@/lib/dates";
import { portfolioRefs } from "../../queries";
import { ClientForm } from "../client-form";

export const metadata = { title: "Novo cliente contábil" };

export default async function Page() {
  // a consulta de CNPJ exige "criar" — a mesma permissão que esta página já exige
  const s = await requireFirmSession("create");
  const refs = await portfolioRefs(s.ctx);
  return (
    <>
      <PageHeader
        title="Novo cliente"
        crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Clientes", href: "/contabil/clientes" }, { label: "Novo" }]}
        description="Cadastro próprio do escritório. Para pessoa jurídica, consulte o CNPJ para preencher razão social, CNAEs, endereço e situação na Receita; sócios e estabelecimentos entram depois, na página do cliente."
      />
      <ClientForm groups={refs.groups} users={refs.users} regimes={REGIMES} crts={CRT_OPTIONS} ufs={UFS} defaultOnboardedAt={today()} />
    </>
  );
}
