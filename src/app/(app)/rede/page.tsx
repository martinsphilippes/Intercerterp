import { redirect } from "next/navigation";
import { Plus, BadgePercent, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { sp, normalizeSearch, type SearchParams } from "@/lib/list";
import { UFS } from "@/domain/companies";
import { NETWORK_LEVELS, NODE_STATUS, countByLevel, networkSettings, networkViewer } from "@/domain/network";
import { NodeTree, requireNetworkSession } from "./shared";

export const metadata = { title: "Rede de certificação" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  if (!v.platform) redirect("/rede/minha");
  const params = await searchParams;
  const { levelLabels } = await networkSettings(s.ctx.store);
  const q = normalizeSearch(sp(params, "q"));
  const level = sp(params, "nivel");
  const uf = sp(params, "uf");
  const status = sp(params, "situacao");
  const filtered = Boolean(q || level || uf || status);
  const match = (n: any) =>
    (!q || normalizeSearch(`${n.name} ${n.code} ${n.cityName ?? ""} ${n.region ?? ""} ${n.commercialResponsible ?? ""}`).includes(q)) && (!level || n.level === level) && (!uf || n.uf === uf) && (!status || n.status === status);
  // com filtro: os nós que atendem e os ancestrais deles (para manter a árvore navegável)
  const show = new Set<string>();
  for (const n of v.nodes) {
    if (!filtered || match(n)) {
      show.add(n.id);
      for (const a of n.path ?? []) show.add(a);
    }
  }
  const matched = filtered ? v.nodes.filter(match).length : v.nodes.length;
  const counts = countByLevel(v.nodes.filter((n) => n.status !== "closed"));
  const suspended = v.nodes.filter((n) => n.status === "suspended").length;
  return (
    <>
      <PageHeader
        title="Rede de certificação"
        crumbs={[{ label: "Rede de certificação" }, { label: "Plataforma" }]}
        description="Hierarquia comercial da Intercert: Master → Regional → Revenda → Contador. Cada parceiro é uma empresa com usuários, financeiro e preços próprios; o nível de cima vê os de baixo."
        actions={
          <>
            <LinkButton href="/rede/parametros"><SlidersHorizontal className="size-4" aria-hidden /> Rótulos</LinkButton>
            <LinkButton href="/rede/precos"><BadgePercent className="size-4" aria-hidden /> Preços e catálogo</LinkButton>
            <LinkButton href="/rede/novo" variant="primary"><Plus className="size-4" aria-hidden /> Novo parceiro</LinkButton>
          </>
        }
      />
      <section aria-label="Parceiros por nível" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {NETWORK_LEVELS.map((l) => (
          <Stat key={l} label={levelLabels[l]} value={(counts[l] ?? 0).toLocaleString("pt-BR")} href={`/rede?nivel=${l}`} hint="ativos e suspensos" />
        ))}
        <Stat label="Suspensos" value={suspended.toLocaleString("pt-BR")} href="/rede?situacao=suspended" tone={suspended ? "warn" : "default"} hint="filhos continuam ativos, sinalizados" />
      </section>
      <FilterBar
        basePath="/rede"
        values={params}
        filters={[
          { type: "search", name: "q", placeholder: "Nome, código, cidade, região ou responsável" },
          { type: "select", name: "nivel", label: "Nível", options: NETWORK_LEVELS.map((l) => ({ value: l, label: levelLabels[l] })), all: "Todos" },
          { type: "select", name: "uf", label: "UF", options: UFS.map((u) => ({ value: u, label: u })), all: "Todas" },
          { type: "select", name: "situacao", label: "Situação", options: NODE_STATUS.map((x) => ({ value: x.value, label: x.label })), all: "Todas" },
        ]}
      />
      <Card title="Intercert (plataforma)" description={filtered ? `${matched.toLocaleString("pt-BR")} parceiro(s) no filtro — os parceiros acima deles aparecem para manter o caminho.` : `${v.nodes.length.toLocaleString("pt-BR")} parceiro(s) na rede.`}>
        {v.nodes.length === 0 ? (
          <EmptyState title="Nenhum parceiro na rede" description="Cadastre o primeiro Master (ou qualquer nível) diretamente abaixo da Intercert." action={<LinkButton href="/rede/novo" variant="primary">Novo parceiro</LinkButton>} />
        ) : show.size === 0 ? (
          <p className="text-sm text-slate-500">Nenhum parceiro no filtro.</p>
        ) : (
          <NodeTree nodes={v.nodes} all={v.nodes} rootId={null} labels={levelLabels} show={show} openAll={filtered} />
        )}
      </Card>
    </>
  );
}
