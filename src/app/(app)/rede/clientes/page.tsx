import Link from "@/components/ui/link";
import { Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { FilterBar } from "@/components/ui/filters";
import { formatDate } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { listCertCustomers, nodeOfCompany } from "@/domain/network";
import { requireNetworkSession } from "../shared";

export const metadata = { title: "Clientes de certificado" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireNetworkSession();
  const sp = await searchParams;
  const crumbs = [{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Clientes" }];
  const node = await nodeOfCompany(s.ctx.store, s.ctx.companyId);
  if (!node || node.level === "contador" || (!canDo(s.user, "network.sell") && !canDo(s.user, "network.sales_all"))) {
    return (
      <>
        <PageHeader title="Clientes de certificado" crumbs={crumbs} />
        <Notice tone="warn">Os clientes de certificado são dos parceiros da rede (Master, Regional e Revenda). O escritório contador usa a carteira de clientes.</Notice>
      </>
    );
  }
  const rows = await listCertCustomers(s.ctx, { q: sp.q });
  const canSell = canDo(s.user, "network.sell");
  return (
    <>
      <PageHeader
        title="Clientes de certificado"
        crumbs={crumbs}
        description={canDo(s.user, "network.sales_all") ? "Todos os titulares do seu parceiro." : "Os titulares que você cadastrou ou para quem já vendeu."}
        actions={canSell ? <LinkButton href="/rede/clientes/novo" variant="primary"><Plus className="size-4" aria-hidden /> Novo cliente</LinkButton> : undefined}
      />
      <FilterBar basePath="/rede/clientes" values={sp} filters={[{ type: "search", placeholder: "Nome, CPF/CNPJ ou código" }]} />
      {rows.length === 0 ? (
        <EmptyState icon={<Users className="size-8" aria-hidden />} title="Nenhum cliente" description="Cadastre o titular antes da venda (PF ou PJ, com documento válido)." action={canSell ? <LinkButton href="/rede/clientes/novo" variant="primary">Novo cliente</LinkButton> : undefined} />
      ) : (
        <Card bodyClass="p-0">
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <Link href={`/rede/clientes/${c.id}`} className="min-w-0">
                  <span className="block font-medium text-brand-700">{c.name}</span>
                  <span className="block text-xs text-slate-500">{c.code} · {c.personType === "PJ" ? "CNPJ" : "CPF"} {formatDoc(c.doc)}{c.phone ? ` · ${formatPhone(c.phone)}` : ""}{c.email ? ` · ${c.email}` : ""}</span>
                </Link>
                <span className="flex flex-wrap items-center gap-2">
                  {c.hasBirdId && <Badge tone="good">BirdID{c.birdIdValidTo ? ` até ${formatDate(c.birdIdValidTo)}` : ""}</Badge>}
                  {canSell && <LinkButton href={`/rede/vendas/nova?cliente=${c.id}`} size="sm">Vender</LinkButton>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
