import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { BusinessError, PermissionError } from "@/lib/core/errors";
import { formatDate, monthEnd, monthStart, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { listClosings, networkResult, networkSettings, networkViewer } from "@/domain/network";
import { LevelBadge, requireNetworkSession } from "../shared";
import { ClosingsTable } from "./relation-view";

export const metadata = { title: "Resultado da rede" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * §46 — Resultado da rede: para o nó e os parceiros abaixo (a plataforma vê a cascata completa: custo AC → receita
 * Intercert → margem de cada nível), por camada e por produto, no período do pagamento das vendas.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireNetworkSession();
  const q = await searchParams;
  const from = DATE_RE.test(sp(q, "de") ?? "") ? sp(q, "de")! : monthStart(today());
  const to = DATE_RE.test(sp(q, "ate") ?? "") ? sp(q, "ate")! : monthEnd(today());
  const nodeId = sp(q, "no") || null;
  const crumbs = [{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Resultado da rede" }];
  const v = await networkViewer(s.ctx);
  let r;
  try {
    r = await networkResult(s.ctx, { from, to, nodeId });
  } catch (e) {
    if (!(e instanceof PermissionError) && !(e instanceof BusinessError)) throw e;
    return (
      <>
        <PageHeader title="Resultado da rede" crumbs={crumbs} />
        <Notice tone="warn">{e instanceof PermissionError ? "Seu perfil não tem a consulta do financeiro da rede." : e.message}</Notice>
      </>
    );
  }
  const { levelLabels } = await networkSettings(s.ctx.store);
  const closings = (await listClosings(s.ctx)).slice(0, 50);
  const nodeOptions = v.nodes.filter((n) => v.platform || v.visible.has(n.id)).sort((a, b) => Number(a.depth ?? 0) - Number(b.depth ?? 0) || String(a.name).localeCompare(String(b.name), "pt-BR")).map((n) => ({ value: n.id, label: `${"— ".repeat(Number(n.depth ?? 0))}${n.name}` }));
  const nameOf = (k: string) => r.rows.find((x) => x.key === k)?.name ?? (k === "platform" ? "Intercert" : "—");
  return (
    <>
      <PageHeader
        title="Resultado da rede"
        crumbs={crumbs}
        description={r.platform && !r.rootNodeId ? "Cascata completa: o que os clientes pagaram, o custo AC ao fornecedor, a receita da Intercert e a margem de cada nível. Vendas pelo dia da confirmação do pagamento; estornadas ficam fora." : "Seu nó e os parceiros abaixo: vendas, receita, custo pago ao nível acima e margem por camada e por produto. Custos acima do seu parceiro não aparecem."}
        actions={v.myNode ? <LinkButton href="/rede/minha/financeiro">Meu financeiro com o nível acima</LinkButton> : undefined}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
        <Field label="De"><Input type="date" name="de" defaultValue={from} /></Field>
        <Field label="Até"><Input type="date" name="ate" defaultValue={to} /></Field>
        <Field label="A partir do parceiro"><Select name="no" defaultValue={nodeId ?? ""} options={nodeOptions} placeholder={v.platform ? "Toda a rede (plataforma)" : "Meu nó"} /></Field>
        <button type="submit" className={buttonClass("secondary")}>Filtrar</button>
      </form>
      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totais do período">
        <Stat label="Vendas pagas" value={r.totals.sales.toLocaleString("pt-BR")} hint={r.reversed ? `${r.reversed} estornada(s) fora do resultado` : `${formatDate(from)} a ${formatDate(to)}`} />
        <Stat label="Pago pelos clientes" value={formatMoney(r.totals.clientPaid)} hint="nas vendas visíveis a você" />
        <Stat label="Margem das camadas" value={formatMoney(r.totals.sumMargins)} />
        {r.totals.acCost != null ? <Stat label="Custo AC (fornecedor)" value={formatMoney(r.totals.acCost)} hint={r.totals.difference === 0 ? "confere: cliente = Σ margens + custo AC" : `diferença ${formatMoney(r.totals.difference ?? 0)}`} tone={r.totals.difference === 0 ? "good" : "bad"} /> : <Stat label="Camadas" value={r.rows.length.toLocaleString("pt-BR")} />}
      </section>
      <div className="space-y-4">
        <Card title="Por camada" description="Receita = recebido do cliente final + recebido dos parceiros abaixo (o custo deles) + comissões recebidas. Custo = pago ao nível acima + comissões pagas (+ custo AC na plataforma). Com voucher, o custo pré-pago no pacote conta na venda em que foi usado.">
          {r.rows.length === 0 ? <p className="text-sm text-slate-500">Nenhuma venda paga no período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1 text-left font-medium">Camada</th>
                    <th className="py-1 text-right font-medium">Vendas</th>
                    <th className="py-1 text-right font-medium">Do cliente</th>
                    <th className="py-1 text-right font-medium">De baixo</th>
                    <th className="py-1 text-right font-medium">Comissões rec.</th>
                    <th className="py-1 text-right font-medium">Pago acima</th>
                    <th className="py-1 text-right font-medium">Comissões pagas</th>
                    {r.totals.acCost != null && <th className="py-1 text-right font-medium">Custo AC</th>}
                    <th className="py-1 text-right font-medium">Margem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.rows.map((x) => (
                    <tr key={x.key}>
                      <td className="py-1.5" style={{ paddingLeft: `${x.depth * 12}px` }}>
                        <span className="flex flex-wrap items-center gap-1.5">{x.key === "platform" ? <span className="text-xs font-semibold text-brand-700">Intercert</span> : <LevelBadge level={x.level} labels={levelLabels} />}<span>{x.name}</span></span>
                      </td>
                      <td className="tabular py-1.5 text-right">{x.sales || "—"}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(x.clientRevenue)}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(x.belowRevenue)}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(x.commissionIn)}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(x.costUp)}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(x.commissionOut)}</td>
                      {r.totals.acCost != null && <td className="tabular py-1.5 text-right">{formatMoney(x.acCost)}</td>}
                      <td className={`tabular py-1.5 text-right font-semibold ${x.margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatMoney(x.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Por produto" description={r.platform && !r.rootNodeId ? "Custo AC → margem de cada camada." : "Seu custo (pago ao nível acima) → margem de cada camada visível."}>
          {r.products.length === 0 ? <p className="text-sm text-slate-500">Nenhuma venda paga no período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Produto</th><th className="py-1 text-right font-medium">Vendas</th><th className="py-1 text-right font-medium">Pago pelos clientes</th><th className="py-1 pl-3 text-right font-medium">{r.platform && !r.rootNodeId ? "Custo AC" : "Seu custo"}</th><th className="py-1 text-left font-medium pl-3">Margem por camada</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {r.products.map((p) => (
                    <tr key={p.productKey}>
                      <td className="py-1.5">{p.productLabel}</td>
                      <td className="tabular py-1.5 text-right">{p.sales}</td>
                      <td className="tabular py-1.5 text-right">{formatMoney(p.clientPaid)}</td>
                      <td className="tabular py-1.5 pl-3 text-right">{p.rootCost == null ? "—" : formatMoney(p.rootCost)}</td>
                      <td className="py-1.5 pl-3 text-xs">{Object.entries(p.margins).sort((a, b) => b[1] - a[1]).map(([k, val]) => `${nameOf(k)} ${formatMoney(val)}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <ClosingsTable rows={closings} title="Fechamentos recentes" />
      </div>
    </>
  );
}
