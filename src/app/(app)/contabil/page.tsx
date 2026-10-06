import Link from "@/components/ui/link";
import { CheckCircle2, Inbox, Plus, Users } from "lucide-react";
import { requireFirmSession } from "./guard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { BarList } from "@/components/charts/bars";
import { can, canDo } from "@/lib/permissions";
import { formatDateTime, formatMonth } from "@/lib/dates";
import { CLIENT_STATUS } from "@/domain/accounting";
import { portfolioOverview } from "./queries";

export const metadata = { title: "Painel da carteira" };

const STATUS_TONE: Record<string, "default" | "good" | "bad" | "warn"> = { onboarding: "warn", active: "good", offboarding: "warn", closed: "default" };

/** "1 obrigação atrasada" / "3 obrigações atrasadas" — sem ficar no "(s)". */
const n = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;

export default async function Page() {
  const s = await requireFirmSession();
  const o = await portfolioOverview(s.ctx);
  // carteira restrita: quem não vê toda a carteira enxerga só os clientes em que é responsável ou tem atribuição
  const wholePortfolio = s.user.isAdmin || canDo(s.user, "accounting.all_clients");
  const withRegime = o.byRegime.reduce((a, r) => a + r.count, 0);
  const withoutRegime = o.total - withRegime;
  const activeCount = o.total - (o.byStatus.closed ?? 0);
  return (
    <>
      <PageHeader
        title="Painel da carteira"
        crumbs={[{ label: "Gestão" }, { label: "Painel da carteira" }]}
        description={
          <>
            Visão geral da carteira do escritório: situação dos clientes, vínculos com o ERP, alertas fiscais das empresas vinculadas e as entregas que chegam sozinhas na caixa de entrada.
            {!wholePortfolio && <span className="block text-xs">Você vê apenas os clientes da sua carteira (responsável ou com atribuição ativa).</span>}
          </>
        }
        actions={
          <>
            <LinkButton href="/contabil/entregas">
              <Inbox className="size-4" aria-hidden /> Caixa de entrada
            </LinkButton>
            {can(s.user, "accounting", "create") && (
              <LinkButton href="/contabil/clientes/novo" variant="primary">
                <Plus className="size-4" aria-hidden /> Novo cliente
              </LinkButton>
            )}
          </>
        }
      />

      <section aria-label="Indicadores da carteira" className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Clientes na carteira" value={o.total.toLocaleString("pt-BR")} href="/contabil/clientes" hint={n(activeCount, "cliente em atividade", "clientes em atividade")} />
        <Stat label="Vinculados ao ERP" value={o.linkedCount.toLocaleString("pt-BR")} href="/contabil/clientes?vinculo=active" hint="Situação fiscal visível e pacote mensal automático" tone={o.linkedCount ? "good" : "default"} />
        <Stat label="Códigos de vínculo pendentes" value={o.pendingLinks.toLocaleString("pt-BR")} href="/contabil/clientes?vinculo=pending" hint="Aguardando a empresa aceitar no ERP" tone={o.pendingLinks ? "warn" : "default"} />
        <Stat label="Entregas a conferir" value={o.deliveriesToReview.toLocaleString("pt-BR")} href="/contabil/entregas?status=received" hint="Pacotes recebidos das empresas vinculadas" tone={o.deliveriesToReview ? "warn" : "default"} />
        <Stat label="Clientes sem responsável" value={o.withoutResponsible.length.toLocaleString("pt-BR")} href="/contabil/clientes?responsavel=none" hint="Em atividade, sem responsável geral nem atribuição" tone={o.withoutResponsible.length ? "bad" : "good"} />
      </section>
      <section aria-label="Clientes por situação" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CLIENT_STATUS.map((st) => {
          const count = o.byStatus[st.value] ?? 0;
          return <Stat key={st.value} label={st.label} value={count.toLocaleString("pt-BR")} href={`/contabil/clientes?status=${st.value}`} tone={count ? STATUS_TONE[st.value] : "default"} />;
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Alertas fiscais dos clientes vinculados"
            description="Lidos da situação fiscal de cada empresa vinculada (somente leitura). Clique para abrir a aba fiscal do cliente."
            actions={
              <Link href="/contabil/clientes?vinculo=active" className="text-xs text-brand-700 hover:underline">
                Ver vinculados
              </Link>
            }
          >
            {o.linkedCount === 0 ? (
              <EmptyState icon={<Users className="size-10" aria-hidden />} title="Nenhum cliente vinculado ao ERP" description="Emita um código de vínculo na ficha do cliente. Quando a empresa aceitar o código no ERP, a situação fiscal dela passa a aparecer aqui." />
            ) : o.alerts.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="size-10 text-emerald-500" aria-hidden />} title="Nenhum alerta" description={`${n(o.linkedCount, "cliente vinculado", "clientes vinculados")} sem obrigações atrasadas ou a vencer, certificados a vencer ou documentos parados.`} />
            ) : (
              <ul className="divide-y divide-line">
                {o.alerts.map((a) => (
                  <li key={a.clientId}>
                    <Link href={`/contabil/clientes/${a.clientId}?tab=fiscal`} className="focus-ring block rounded px-1 py-2.5 hover:bg-brand-50/60">
                      <span className="block text-sm font-medium text-ink">{a.clientName}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {a.lateObligations > 0 && <Badge tone="bad">{n(a.lateObligations, "obrigação atrasada", "obrigações atrasadas")}</Badge>}
                        {a.dueSoon > 0 && <Badge tone="warn">{n(a.dueSoon, "obrigação a vencer", "obrigações a vencer")}</Badge>}
                        {a.certificateDaysLeft != null && a.certificateDaysLeft <= 30 && (
                          <Badge tone={a.certificateDaysLeft < 0 ? "bad" : "warn"}>{a.certificateDaysLeft < 0 ? "Certificado digital vencido" : a.certificateDaysLeft === 0 ? "Certificado digital vence hoje" : `Certificado digital vence em ${n(a.certificateDaysLeft, "dia", "dias")}`}</Badge>
                        )}
                        {a.stuckDocs > 0 && <Badge tone="warn">{n(a.stuckDocs, "documento parado na fila", "documentos parados na fila")}</Badge>}
                        {a.pending > 0 && <Badge tone="warn">{n(a.pending, "documento pendente ou rejeitado", "documentos pendentes ou rejeitados")}</Badge>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Últimas entregas"
            description="Pacotes mensais (XMLs e relatórios) recebidos automaticamente das empresas vinculadas."
            bodyClass="p-0"
            actions={
              <Link href="/contabil/entregas" className="text-xs text-brand-700 hover:underline">
                Abrir caixa de entrada
              </Link>
            }
          >
            {o.recentDeliveries.length === 0 ? (
              <EmptyState title="Nenhuma entrega recebida" description="Quando uma empresa vinculada gera o pacote mensal no ERP, ele aparece aqui sem que ninguém precise enviar nada." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Período</th>
                      <th>Arquivo</th>
                      <th>Recebida em</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.recentDeliveries.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <Link href={`/contabil/entregas?cliente=${d.clientId}`} className="font-medium text-brand-700 hover:underline">
                            {d.clientName}
                          </Link>
                        </td>
                        <td>{formatMonth(d.period)}</td>
                        <td>
                          <span className="block max-w-[260px] truncate" title={d.fileName}>
                            {d.fileName}
                          </span>
                          {d.missingXml > 0 && <Badge tone="warn">{n(d.missingXml, "XML ausente", "XMLs ausentes")}</Badge>}
                        </td>
                        <td className="whitespace-nowrap">{formatDateTime(d.receivedAt)}</td>
                        <td>
                          <StatusBadge kind="delivery" status={d.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={`Pacote de ${formatMonth(o.prevPeriod)} ainda não recebido`} description="Clientes vinculados cuja empresa ainda não gerou o pacote do mês anterior no ERP.">
            {o.linkedCount === 0 ? (
              <p className="text-sm text-slate-500">Sem clientes vinculados: o pacote mensal só chega automaticamente das empresas vinculadas ao ERP.</p>
            ) : o.missingPrevPackage.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-800">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {o.linkedCount === 1 ? "O cliente vinculado já entregou" : `Todos os ${o.linkedCount} clientes vinculados já entregaram`} o pacote de {formatMonth(o.prevPeriod)}.
              </p>
            ) : (
              <ul className="space-y-2">
                {o.missingPrevPackage.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                    <Link href={`/contabil/clientes/${c.id}?tab=fiscal`} className="font-medium text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                    <Link href={`/contabil/entregas?cliente=${c.id}`} className="text-xs text-slate-500 hover:text-brand-700 hover:underline">
                      entregas anteriores
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Clientes sem responsável"
            description="Clientes em atividade sem responsável geral nem atribuição ativa por departamento."
            actions={
              canDo(s.user, "accounting.manage_team") && (
                <Link href="/contabil/equipe" className="text-xs text-brand-700 hover:underline">
                  Equipe
                </Link>
              )
            }
          >
            <div id="sem-responsavel" className="scroll-mt-20">
              {o.withoutResponsible.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden /> Todos os clientes em atividade têm responsável definido.
                </p>
              ) : (
                <ul className="space-y-2">
                  {o.withoutResponsible.map((c) => (
                    <li key={c.id} className="text-sm">
                      <Link href={`/contabil/clientes/${c.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.name}
                      </Link>
                      {c.code && <span className="ml-2 text-xs text-slate-500">{c.code}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card title="Clientes por regime tributário" description="Cada barra abre a carteira filtrada pelo regime.">
            {o.byRegime.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum cliente com regime tributário informado.</p>
            ) : (
              <BarList
                ariaLabel="Clientes por regime tributário"
                rows={o.byRegime.map((r) => ({
                  key: r.regime,
                  label: r.label,
                  value: r.count,
                  valueText: `${r.count.toLocaleString("pt-BR")} · ${Math.round((r.count / Math.max(1, withRegime)) * 100)}%`,
                  href: `/contabil/clientes?regime=${r.regime}`,
                }))}
              />
            )}
            {withoutRegime > 0 && <p className="mt-3 text-xs text-slate-500">{n(withoutRegime, "cliente sem regime informado", "clientes sem regime informado")} (pessoas físicas ou cadastro incompleto).</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
