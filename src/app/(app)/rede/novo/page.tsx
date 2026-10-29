import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { sp, type SearchParams } from "@/lib/list";
import { canCreateUnder, childLevelsOf, networkSettings, networkViewer } from "@/domain/network";
import { NewNodeForm, type ParentOption } from "../forms";
import { requireNetworkSession } from "../shared";

export const metadata = { title: "Novo parceiro da rede" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  const { levelLabels } = await networkSettings(s.ctx.store);
  const wanted = sp(await searchParams, "pai");
  const parents: ParentOption[] = [];
  if (v.platform) parents.push({ value: "", label: "Intercert (direto abaixo da plataforma)", levels: childLevelsOf(null) });
  for (const n of [...v.nodes].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || String(a.name).localeCompare(String(b.name), "pt-BR"))) {
    if (n.level === "contador" || n.status !== "active" || !canCreateUnder(s.ctx, v.myNode, n.id)) continue;
    parents.push({ value: n.id, label: `${n.name} (${levelLabels[n.level as keyof typeof levelLabels]})`, levels: childLevelsOf(n.level) });
  }
  if (!parents.length) redirect("/rede/minha");
  const defaultParent = parents.some((p) => p.value === wanted) ? wanted : v.platform ? "" : parents[0].value;
  return (
    <>
      <PageHeader
        title="Novo parceiro da rede"
        crumbs={[{ label: "Rede de certificação", href: v.platform ? "/rede" : "/rede/minha" }, { label: "Novo parceiro" }]}
        description="Master, Regional e Revenda nascem como empresas de parceiro (perfis próprios, financeiro e categorias de certificação); o Contador é um escritório contábil — novo ou já existente. O administrador recebe o convite de acesso; quem cadastra não ganha acesso à empresa nova."
      />
      <Card>
        <div className="mb-4"><Notice tone="info">O nível do parceiro precisa ser inferior ao do parceiro acima (pode pular níveis, ex.: Master → Revenda). Cada empresa ocupa um único lugar na rede.</Notice></div>
        <NewNodeForm parents={parents} labels={levelLabels} defaultParent={defaultParent} />
      </Card>
    </>
  );
}
