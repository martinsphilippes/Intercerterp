import { notFound } from "next/navigation";
import { requireFirmSession } from "../../../guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { CRT_OPTIONS, REGIMES, UFS } from "@/domain/companies";
import { getClient } from "@/domain/accounting";
import type { Doc } from "@/lib/db/types";
import { can } from "@/lib/permissions";
import { portfolioRefs } from "../../../queries";
import { ClientForm } from "../../client-form";

export const metadata = { title: "Editar cliente contábil" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireFirmSession("edit");
  const { id } = await params;
  let c: Doc;
  try {
    // fora da carteira visível do usuário (ou inexistente): mesma resposta, sem revelar o cadastro
    c = await getClient(s.ctx, id);
  } catch {
    notFound();
  }
  const refs = await portfolioRefs(s.ctx);
  return (
    <>
      <PageHeader
        title={`Editar ${c.name}`}
        crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Clientes", href: "/contabil/clientes" }, { label: c.name, href: `/contabil/clientes/${c.id}` }, { label: "Editar" }]}
        badges={
          <>
            <StatusBadge kind="accounting_client" status={c.status} />
            <StatusBadge kind="link" status={c.linkStatus ?? "none"} />
          </>
        }
        description={`${c.code} · situação e regime mudam pela página do cliente; aqui ficam os dados cadastrais, contatos, serviços e volume.`}
      />
      {/* a consulta pública do CNPJ exige "criar" (lookupClientCnpjAction): quem só edita não vê o botão */}
      <ClientForm client={c} groups={refs.groups} users={refs.users} regimes={REGIMES} crts={CRT_OPTIONS} ufs={UFS} canLookup={can(s.user, "accounting", "create")} />
    </>
  );
}
