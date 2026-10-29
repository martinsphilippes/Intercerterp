import Link from "@/components/ui/link";
import { ChevronRight, RefreshCcw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { FilterBar } from "@/components/ui/filters";
import { formatDate, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { BusinessError } from "@/lib/core/errors";
import { certificationSettings } from "@/domain/accounting";
import { CONTACT_CHANNEL_LABEL, CONTACT_RESULT_LABEL, NETWORK_LEVELS, RENEWAL_SITUATIONS, idleCandidate, networkSettings, renewalPanel, type LayerNode, type RenewalTotals } from "@/domain/network";
import { requireNetworkSession } from "../shared";
import { ContactForm } from "./contact-form";

export const metadata = { title: "Renovações da rede" };

const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const TONE = Object.fromEntries(RENEWAL_SITUATIONS.map((s) => [s.value, s.tone]));
const LABEL = Object.fromEntries(RENEWAL_SITUATIONS.map((s) => [s.value, s.label]));

function Cells({ t }: { t: RenewalTotals }) {
  return (
    <>
      <td className="tabular px-3 py-2 text-right">{t.total}</td>
      <td className="tabular px-3 py-2 text-right text-emerald-700">{t.renewed}</td>
      <td className="tabular px-3 py-2 text-right">{t.pending}</td>
      <td className="tabular px-3 py-2 text-right text-slate-500">{t.lost}</td>
      <td className="tabular px-3 py-2 text-right font-medium">{pct(t.rate)}</td>
      <td className="tabular px-3 py-2 text-right">{t.byIdle ? <span className="text-red-700">{t.byIdle}</span> : "0"}</td>
    </>
  );
}

/** Visão por camada: cada nó com os totais dele + descendentes; expande para os filhos e para os vendedores do nó. */
function LayerRows({ n, depth, labels }: { n: LayerNode; depth: number; labels: Record<string, string> }) {
  return (
    <>
      <tr className={depth === 0 ? "bg-slate-50 font-medium" : undefined}>
        <td className="px-3 py-2" style={{ paddingLeft: `${12 + depth * 18}px` }}>
          <span className="mr-1 text-xs text-slate-500">{labels[n.level] ?? n.level}</span>
          <Link href={`/rede/renovacoes?no=${n.nodeId}`} className="text-brand-700 hover:underline">{n.name}</Link>
        </td>
        <Cells t={n.all} />
      </tr>
      {n.sellers.length > 0 && n.children.length > 0 && (
        <tr>
          <td className="px-3 py-1 text-xs text-slate-500" style={{ paddingLeft: `${30 + depth * 18}px` }}>vendas do próprio nó</td>
          <Cells t={n.own} />
        </tr>
      )}
      {n.sellers.map((s) => (
        <tr key={`${n.nodeId}:${s.sellerUserId ?? "-"}`} className="text-xs text-slate-600">
          <td className="px-3 py-1" style={{ paddingLeft: `${30 + depth * 18}px` }}>vendedor · {s.sellerName}</td>
          <Cells t={s.totals} />
        </tr>
      ))}
      {n.children.map((c) => <LayerRows key={c.nodeId} n={c} depth={depth + 1} labels={labels} />)}
    </>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireNetworkSession();
  const sp = await searchParams;
  const crumbs = [{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Renovações" }];
  let panel;
  try {
    panel = await renewalPanel(s.ctx, { level: sp.nivel, nodeId: sp.no, sellerUserId: sp.vendedor, productKey: sp.produto, situation: sp.situacao, from: sp.de, to: sp.ate });
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    return (
      <>
        <PageHeader title="Renovações" crumbs={crumbs} />
        <Notice tone="warn">{e.message}</Notice>
      </>
    );
  }
  const [{ levelLabels }, settings] = await Promise.all([networkSettings(s.ctx.store), certificationSettings(s.ctx.store)]);
  const { viewer: v, rows, totals, layers, nodes, idleAlertDays, period } = panel;
  const ref = today();
  const sellers = [...new Map(rows.filter((r) => r.sellerUserId).map((r) => [r.sellerUserId!, r.sellerName ?? "—"])).entries()].map(([value, label]) => ({ value, label }));
  const focus = sp.cert ? rows.find((r) => r.id === sp.cert) : null;
  return (
    <>
      <PageHeader
        title="Renovações"
        crumbs={crumbs}
        description={`Certificados que vencem entre ${formatDate(period.from)} e ${formatDate(period.to)} (vencidos há até 30 dias ainda são recuperáveis; depois disso, perdidos). Alerta “ninguém agiu”: ${idleAlertDays} dia(s) antes do vencimento sem contato nem renovação aberta.`}
      />
      <section aria-label="Totais" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="A renovar no período" value={totals.total.toLocaleString("pt-BR")} />
        <Stat label="Renovados" value={totals.renewed.toLocaleString("pt-BR")} tone="good" />
        <Stat label="Taxa de renovação" value={pct(totals.rate)} hint="renovados ÷ total do período" />
        <Stat label="Pendentes" value={totals.pending.toLocaleString("pt-BR")} tone={totals.pending ? "warn" : "default"} />
        <Stat label="Ninguém agiu" value={totals.byIdle.toLocaleString("pt-BR")} tone={totals.byIdle ? "bad" : "default"} hint={`≤ ${idleAlertDays} dia(s), sem contato`} />
      </section>
      <FilterBar
        basePath="/rede/renovacoes"
        values={sp}
        filters={[
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "pending", label: "Pendentes (a vencer e vencidos)" }, ...RENEWAL_SITUATIONS.filter((x) => x.value !== "ok").map((x) => ({ value: x.value, label: x.label }))] },
          { type: "select", name: "nivel", label: "Nível", options: NETWORK_LEVELS.map((l) => ({ value: l, label: levelLabels[l] })) },
          ...(nodes.length > 1 ? [{ type: "select" as const, name: "no", label: "Parceiro", options: nodes.map((n) => ({ value: n.id, label: n.name })) }] : []),
          ...(sellers.length > 1 ? [{ type: "select" as const, name: "vendedor", label: "Vendedor", options: sellers }] : []),
          { type: "select", name: "produto", label: "Produto", options: settings.catalog.map((p) => ({ value: p.key, label: p.label })) },
          { type: "date", name: "de", label: "Vence de" },
          { type: "date", name: "ate", label: "Vence até" },
        ]}
      />
      {layers.length > 0 && (
        <Card title="Visão por camada" description="Totais do nó e de todos os parceiros abaixo dele; vendedores do nó em seguida. Clique num parceiro para filtrar a lista." bodyClass="p-0" className="mb-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr><th className="px-3 py-2 text-left font-medium">Parceiro / vendedor</th><th className="px-3 py-2 text-right font-medium">A renovar</th><th className="px-3 py-2 text-right font-medium">Renovados</th><th className="px-3 py-2 text-right font-medium">Pendentes</th><th className="px-3 py-2 text-right font-medium">Perdidos</th><th className="px-3 py-2 text-right font-medium">Taxa</th><th className="px-3 py-2 text-right font-medium">Ninguém agiu</th></tr>
              </thead>
              <tbody className="divide-y divide-line">{layers.map((n) => <LayerRows key={n.nodeId} n={n} depth={0} labels={levelLabels} />)}</tbody>
            </table>
          </div>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<RefreshCcw className="size-8" aria-hidden />} title="Nenhum certificado no período" description="Ajuste o período ou os filtros." />
      ) : (
        <Card title={`Certificados (${rows.length})`} bodyClass="p-0">
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const own = r.nodeId === v.myNode?.id;
              const idle = idleCandidate(r, idleAlertDays);
              return (
                <li key={r.id} id={`c-${r.id}`} className={`p-3 text-sm ${focus?.id === r.id ? "bg-amber-50" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.holderName}</span>
                        <span className="text-xs text-slate-500">{formatDoc(r.holderDoc)}</span>
                        <Badge tone={TONE[r.situation]}>{LABEL[r.situation]}</Badge>
                        {idle && <Badge tone="bad">ninguém agiu</Badge>}
                        {r.openRequest && <Badge tone="info">renovação aberta {r.openRequest.protocol}</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {r.productLabel} · vence {formatDate(r.validTo)} ({r.daysLeft < 0 ? `há ${-r.daysLeft} dia(s)` : `em ${r.daysLeft} dia(s)`}) · {own ? "seu nó" : r.nodeName}{r.sellerName ? ` · ${r.sellerName}` : ""}
                        {r.renewedBy ? ` · renovado até ${formatDate(r.renewedBy.validTo)}` : ""}
                      </p>
                      {r.lastContact && <p className="text-xs text-slate-500">Último contato {formatDate(r.lastContact.date)} · {CONTACT_CHANNEL_LABEL[r.lastContact.channel] ?? r.lastContact.channel} · {CONTACT_RESULT_LABEL[r.lastContact.result] ?? r.lastContact.result}{r.lastContact.nextAction ? ` · próxima: ${r.lastContact.nextAction}` : ""}{r.lastContact.userName ? ` (${r.lastContact.userName})` : ""} — {r.contacts} contato(s)</p>}
                    </div>
                    {own && r.situation !== "renewed" && !r.openRequest && v.canContact && <LinkButton href={r.renewHref} size="sm" variant="primary">Renovar <ChevronRight className="size-3.5" aria-hidden /></LinkButton>}
                  </div>
                  {own && v.canContact && r.situation !== "renewed" && (
                    <details className="mt-2" open={focus?.id === r.id}>
                      <summary className="cursor-pointer text-xs text-brand-700">Registrar contato</summary>
                      <div className="mt-2"><ContactForm certificateId={r.id} today={ref} /></div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
