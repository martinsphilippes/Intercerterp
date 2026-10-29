import Link from "@/components/ui/link";
import { Plus, Network } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import {
  NETWORK_LEVELS, blockedAncestor, canCreateUnder, childLevelError, childLevelsOf, countByLevel, descendantsOf, levelPriceTable, networkSettings, networkViewer, nodePriceTable, priceAlerts,
} from "@/domain/network";
import { LevelBadge, LevelTableEditor, NodeTree, PriceTable, requireNetworkSession } from "../shared";

export const metadata = { title: "Minha rede" };

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  const { levelLabels } = await networkSettings(s.ctx.store);
  const me = v.myNode;
  if (!me) {
    return (
      <>
        <PageHeader title="Minha rede" crumbs={[{ label: "Rede de certificação" }, { label: "Minha rede" }]} />
        <EmptyState
          icon={<Network className="size-8" aria-hidden />}
          title={v.platform ? "Esta empresa opera a plataforma da rede" : "Esta empresa não faz parte da rede de certificação"}
          description={v.platform ? "A empresa em uso não é um parceiro: a rede inteira é gerida pela plataforma." : "Quando a Intercert (ou o parceiro acima) cadastrar esta empresa na rede, aqui aparecem o nível, o parceiro acima, os filhos e os preços."}
          action={v.platform ? <LinkButton href="/rede" variant="primary">Abrir a rede (plataforma)</LinkButton> : undefined}
        />
      </>
    );
  }
  const parent = me.parentNodeId ? v.nodes.find((n) => n.id === me.parentNodeId) ?? null : null;
  const parentName = parent?.name ?? "Intercert";
  const children = v.nodes.filter((n) => n.parentNodeId === me.id);
  const desc = descendantsOf(v.nodes, me.id);
  const byLevel = countByLevel(desc.filter((n) => n.status !== "closed"));
  const levelsBelow = childLevelsOf(me.level);
  const canPrices = me.status === "active" && canDo(s.user, "network.prices");
  const canAdd = levelsBelow.length > 0 && canCreateUnder(s.ctx, v.myNode, me.id);
  const [prices, table, alerts] = await Promise.all([nodePriceTable(s.ctx.store, me.id), levelsBelow.length ? levelPriceTable(s.ctx.store, me.id, levelsBelow) : Promise.resolve(null), priceAlerts(s.ctx.store, me.id)]);
  const blocked = blockedAncestor(v.nodes, me);
  const show = new Set(desc.map((n) => n.id));
  return (
    <>
      <PageHeader
        title="Minha rede"
        crumbs={[{ label: "Rede de certificação" }, { label: "Minha rede" }]}
        badges={<><LevelBadge level={me.level} labels={levelLabels} /><StatusBadge kind="network_node" status={me.status} /><span className="font-mono text-xs text-slate-500">{me.code}</span></>}
        description={`${me.name} · acima: ${parentName}. Você vê o seu nó e todos os parceiros abaixo (consulta dos dados de rede).`}
        actions={
          <>
            <LinkButton href={`/rede/${me.id}`}>Detalhes e histórico</LinkButton>
            {(canDo(s.user, "network.finance_view") || canDo(s.user, "network.billing")) && <LinkButton href="/rede/minha/financeiro">Meu financeiro com o nível acima</LinkButton>}
            {canAdd && <LinkButton href={`/rede/novo?pai=${me.id}`} variant="primary"><Plus className="size-4" aria-hidden /> Novo parceiro abaixo</LinkButton>}
          </>
        }
      />
      {me.status !== "active" && <div className="mb-3"><Notice tone="warn" title={me.status === "suspended" ? "Seu nó está suspenso" : "Seu nó está encerrado"}>{me.statusReason ?? ""} Novos parceiros e preços ficam bloqueados.</Notice></div>}
      {blocked && <div className="mb-3"><Notice tone="warn">Um parceiro acima de você está {blocked.status === "suspended" ? "suspenso" : "encerrado"}.</Notice></div>}
      {alerts.length > 0 && <div className="mb-3"><Notice tone="warn" title="Preços a revisar">{alerts.join(" ")}</Notice></div>}
      <section aria-label="Minha rede em números" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Meu nível" value={levelLabels[me.level as keyof typeof levelLabels]} hint={`Acima: ${parentName}`} />
        <Stat label="Diretamente abaixo" value={children.length.toLocaleString("pt-BR")} />
        {NETWORK_LEVELS.filter((l) => childLevelError(me.level, l) === null).map((l) => (
          <Stat key={l} label={`${levelLabels[l]} na minha rede`} value={(byLevel[l] ?? 0).toLocaleString("pt-BR")} hint="todos os descendentes" />
        ))}
      </section>
      <div className="space-y-4">
        <Card title="Meus custos" description={`Quanto você paga a ${parentName} por produto, o mínimo ao cliente final e o preço padrão sugerido — definidos por ${parentName}.`}>
          <PriceTable rows={prices} ownerName={parentName} />
        </Card>
        {levelsBelow.length > 0 && (
          <Card title="Parceiros abaixo" description="Expanda para ver toda a sua rede; clique para os dados, preços e usuários de cada parceiro.">
            {desc.length === 0 ? <p className="text-sm text-slate-500">Nenhum parceiro abaixo ainda.</p> : <NodeTree nodes={v.nodes} all={v.nodes} rootId={me.id} labels={levelLabels} show={show} openAll={false} />}
          </Card>
        )}
        {table && (
          <Card title="Preços dos meus filhos — tabela padrão por nível" description={canPrices ? "Defina uma vez o preço para todos os filhos de um nível; para um filho específico, use a exceção na página dele. Ninguém vende abaixo do próprio custo." : "Consulta (alterar exige a operação “Definir os preços dos parceiros abaixo”)."}>
            <LevelTableEditor rows={table.rows} labels={levelLabels} ownerNodeId={me.id} ownerName={me.name} canEdit={canPrices} />
            {children.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Exceções por filho: {children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/rede/${c.id}?tab=precos`} className="text-brand-700 hover:underline">{c.name}</Link></span>)}
              </p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
