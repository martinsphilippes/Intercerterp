import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { requireNetworkSession } from "../../shared";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Novo cliente de certificado" };

export default async function Page({ searchParams }: { searchParams: Promise<{ back?: string }> }) {
  const s = await requireNetworkSession();
  const sp = await searchParams;
  const crumbs = [{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Clientes", href: "/rede/clientes" }, { label: "Novo cliente" }];
  return (
    <>
      <PageHeader title="Novo cliente de certificado" crumbs={crumbs} />
      {canDo(s.user, "network.sell") ? <Card><CustomerForm back={sp.back === "venda" ? "venda" : null} /></Card> : <Notice tone="warn">Cadastrar clientes exige a operação “Vender certificados pela rede”.</Notice>}
    </>
  );
}
