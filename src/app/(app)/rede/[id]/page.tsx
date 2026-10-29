import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Plus, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/empty";
import { isNotFound } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import {
  NETWORK_LEVELS, blockedAncestor, canCreateUnder, childLevelError, childLevelsOf, countByLevel, descendantsOf, getNode, levelPriceTable, networkSettings, networkViewer, nodeHistory, nodePriceTable,
  nodeRuleHistory, nodeUsers, priceAlerts, type NetworkLevel,
} from "@/domain/network";
import { ClearRuleForm, MoveForm, PriceRuleForm, StatusForm } from "../forms";
import { HistoryList, LevelBadge, LevelTableEditor, PriceTable, requireNetworkSession } from "../shared";

export const metadata = { title: "Parceiro da rede" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireNetworkSession();
  const { id } = await params;
  const node = await getNode(s.ctx, id).catch((e) => {
    if (isNotFound(e)) notFound();
    throw e;
  });
  const tab = sp(await searchParams, "tab") || "dados";
  const v = await networkViewer(s.ctx);
  const { levelLabels } = await networkSettings(s.ctx.store);
  const base = unscoped(s.ctx.store);
  const company = await base.get("companies", node.nodeCompanyId);
  const parent = node.parentNodeId ? v.nodes.find((n) => n.id === node.parentNodeId) ?? null : null;
  const parentVisible = parent ? v.visible.has(parent.id) : false;
  const parentName = parent ? parent.name : "Intercert";
  const children = v.nodes.filter((n) => n.parentNodeId === node.id).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  const desc = descendantsOf(v.nodes, node.id);
  const byLevel = countByLevel(desc.filter((n) => n.status !== "closed"));
  const blocked = blockedAncestor(v.nodes, node);
  // preço deste nó: o pai (com "Definir os preços") ou a plataforma
  const canPriceThis = v.platform || Boolean(v.myNode && node.parentNodeId === v.myNode.id && v.myNode.status === "active" && canDo(s.user, "network.prices"));
  // tabela padrão dos filhos deste nó: o próprio nó (com a operação) ou a plataforma
  const canPriceChildren = node.level !== "contador" && (v.platform || Boolean(v.myNode && v.myNode.id === node.id && node.status === "active" && canDo(s.user, "network.prices")));
  const canAddChild = node.level !== "contador" && node.status === "active" && canCreateUnder(s.ctx, v.myNode, node.id);
  const levelsBelow = childLevelsOf(node.level);

  const tabs = [
    { key: "dados", label: "Dados e filhos", count: children.length },
    { key: "precos", label: "Preços" },
    { key: "usuarios", label: "Usuários" },
    { key: "historico", label: "Histórico" },
  ];
  return (
    <>
      <PageHeader
        title={node.name}
        crumbs={[{ label: "Rede de certificação", href: v.platform ? "/rede" : "/rede/minha" }, ...(parent && parentVisible ? [{ label: parent.name, href: `/rede/${parent.id}` }] : []), { label: node.name }]}
        badges={
          <>
            <LevelBadge level={node.level} labels={levelLabels} />
            <StatusBadge kind="network_node" status={node.status} />
            <span className="font-mono text-xs text-slate-500">{node.code}</span>
          </>
        }
        description={<>Acima: {parent && parentVisible ? <Link href={`/rede/${parent.id}`} className="text-brand-700 hover:underline">{parentName}</Link> : parentName}</>}
        actions={canAddChild ? <LinkButton href={`/rede/novo?pai=${node.id}`} variant="primary"><Plus className="size-4" aria-hidden /> Novo parceiro abaixo</LinkButton> : undefined}
      />
      {node.status !== "active" && node.statusReason && <div className="mb-3"><Notice tone="warn" title={`Parceiro ${node.status === "suspended" ? "suspenso" : "encerrado"}`}>{node.statusReason}</Notice></div>}
      {blocked && <div className="mb-3"><Notice tone="warn">{v.visible.has(blocked.id) ? blocked.name : "Um parceiro acima"} está {blocked.status === "suspended" ? "suspenso" : "encerrado"}: este parceiro continua ativo, mas sinalizado.</Notice></div>}
      <LinkTabs basePath={`/rede/${node.id}`} active={tab} tabs={tabs} />

      {tab === "dados" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Dados do parceiro">
              <DefinitionList
                cols={2}
                items={[
                  { label: "Empresa", value: company ? `${company.name}${company.cnpj ? ` · CNPJ ${formatDoc(company.cnpj)}` : ""}` : "—" },
                  { label: "Tipo da empresa", value: company?.kind === "accounting" ? "Escritório contábil" : "Parceiro da rede de certificação" },
                  { label: "Cidade / UF", value: [node.cityName, node.uf].filter(Boolean).join(" / ") || "—" },
                  { label: "Região", value: node.region || "—" },
                  { label: "Responsável comercial", value: node.commercialResponsible || "—" },
                  { label: "Na rede desde", value: formatDate(node.startedAt) },
                  node.closedAt ? { label: "Encerrado em", value: formatDate(node.closedAt) } : null,
                  node.notes ? { label: "Observações", value: node.notes } : null,
                ]}
              />
            </Card>
            <Card title="Parceiros diretamente abaixo" description={levelsBelow.length ? `Níveis permitidos abaixo: ${levelsBelow.map((l) => levelLabels[l]).join(", ")}.` : `${levelLabels.contador} é sempre o último nível.`}>
              {children.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum parceiro abaixo.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {children.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                      <LevelBadge level={c.level} labels={levelLabels} />
                      <Link href={`/rede/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link>
                      <span className="font-mono text-xs text-slate-500">{c.code}</span>
                      <span className="text-xs text-slate-500">{[c.cityName, c.uf].filter(Boolean).join("/")}</span>
                      {c.status !== "active" && <StatusBadge kind="network_node" status={c.status} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              {NETWORK_LEVELS.filter((l) => childLevelError(node.level, l) === null).map((l) => (
                <Stat key={l} label={`${levelLabels[l]} abaixo`} value={(byLevel[l] ?? 0).toLocaleString("pt-BR")} hint="todos os descendentes" />
              ))}
            </section>
            {v.platform && (
              <>
                <Card title="Mudar de lugar" description="Só a plataforma; o caminho dos parceiros abaixo é recalculado.">
                  {node.status === "closed" ? (
                    <p className="text-sm text-slate-500">Parceiro encerrado.</p>
                  ) : (
                    <MoveForm
                      id={node.id}
                      options={[
                        ...(node.parentNodeId ? [{ value: "__platform", label: "Intercert (direto abaixo da plataforma)" }] : []),
                        ...v.nodes
                          .filter((n) => n.id !== node.id && n.id !== node.parentNodeId && !(n.path ?? []).includes(node.id) && n.status === "active" && childLevelError(n.level, node.level) === null)
                          .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"))
                          .map((n) => ({ value: n.id, label: `${n.name} (${levelLabels[n.level as NetworkLevel]})` })),
                      ]}
                    />
                  )}
                </Card>
                <Card title="Situação">
                  <StatusForm id={node.id} status={node.status} />
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "precos" && <PricesTab nodeId={node.id} node={node} parentName={parentName} canPriceThis={canPriceThis} canPriceChildren={canPriceChildren} levelsBelow={levelsBelow} labels={levelLabels} storeOwner={s.ctx.store} />}

      {tab === "usuarios" && <UsersTab ctx={s.ctx} node={node} />}

      {tab === "historico" && (
        <Card title="Histórico do parceiro" description="Cadastro, mudanças de lugar, situação e preços — com autor, momento e motivo.">
          <HistoryList rows={await nodeHistory(s.ctx, node.id)} />
        </Card>
      )}
    </>
  );
}

async function PricesTab({ nodeId, node, parentName, canPriceThis, canPriceChildren, levelsBelow, labels, storeOwner }: { nodeId: string; node: any; parentName: string; canPriceThis: boolean; canPriceChildren: boolean; levelsBelow: NetworkLevel[]; labels: Record<string, string>; storeOwner: any }) {
  const [table, history, alerts, level] = await Promise.all([
    nodePriceTable(storeOwner, nodeId),
    nodeRuleHistory(storeOwner, nodeId),
    priceAlerts(storeOwner, nodeId),
    levelsBelow.length ? levelPriceTable(storeOwner, nodeId, levelsBelow) : Promise.resolve(null),
  ]);
  return (
    <div className="space-y-4">
      {alerts.length > 0 && <Notice tone="warn" title="Preços a revisar na camada abaixo">{alerts.join(" ")}</Notice>}
      <Card title={`Preços de ${node.name}`} description={`Definidos por ${parentName}: exceção própria ou, sem ela, a tabela padrão de ${parentName} para o nível ${labels[node.level]}.`}>
        <PriceTable rows={table} ownerName={parentName} />
        {canPriceThis && (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Definir exceção para este parceiro</h3>
            {table.map((r) => (
              <details key={r.product.key} className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {r.product.label}
                  {r.override && <Badge tone="info" className="ml-2">exceção</Badge>}
                  {r.price && <span className="ml-2 text-xs text-slate-500">custo atual {formatMoney(r.price.cost)}</span>}
                </summary>
                <div className="mt-3 space-y-2">
                  <PriceRuleForm target="node" nodeId={nodeId} productKey={r.product.key} productLabel={r.product.label} owner={r.owner} ownerName={parentName} current={r.price} />
                  {r.override && <ClearRuleForm nodeId={nodeId} productKey={r.product.key} />}
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
      {level && (
        <Card title={`Tabela padrão de ${node.name} para os parceiros abaixo`} description="Vale para todo filho do nível que não tenha exceção própria.">
          <LevelTableEditor rows={level.rows} labels={labels} ownerNodeId={nodeId} ownerName={node.name} canEdit={canPriceChildren} />
        </Card>
      )}
      <Card title="Histórico de exceções de preço" description="Regras próprias deste parceiro, inclusive encerradas e substituídas (o histórico nunca é reescrito).">
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Sem exceções: vale a tabela padrão do parceiro acima.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-left font-medium">Produto</th>
                  <th className="py-1 text-right font-medium">Custo</th>
                  <th className="py-1 text-right font-medium">Mínimo</th>
                  <th className="py-1 text-right font-medium">Padrão</th>
                  <th className="py-1 text-left font-medium pl-3">Vigência</th>
                  <th className="py-1 text-left font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5">{table.find((t) => t.product.key === r.productKey)?.product.label ?? r.productKey}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(r.cost)}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(r.minPrice)}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(r.defaultPrice)}</td>
                    <td className="py-1.5 pl-3 text-xs">{formatDate(r.validFrom)} {r.validTo ? `a ${formatDate(r.validTo)}` : "em diante"}</td>
                    <td className="py-1.5 text-xs">{r.active === false ? <Badge>substituída</Badge> : r.validTo ? <Badge>encerrada</Badge> : <Badge tone="good">vigente</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

async function UsersTab({ ctx, node }: { ctx: any; node: any }) {
  const users = await nodeUsers(ctx, node);
  return (
    <Card title="Usuários do parceiro" description="Consulta. O administrador do parceiro gerencia os usuários (inclusive vendedores de cidade) em Administração › Usuários da empresa dele.">
      {users.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum usuário.</p>
      ) : (
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{u.name}</span>
              <span className="text-slate-500">{u.email}</span>
              <StatusBadge kind="user" status={u.status} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><AlertTriangle className="size-3.5" aria-hidden /> Quem está acima na rede vê os dados de rede, não opera a empresa do parceiro.</p>
    </Card>
  );
}
