import Link from "next/link";
import { Play, AlertTriangle } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/empty";
import { ActionButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { formatDateTime } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { INTEGRATION_CATALOG, integrationJobs, type IntegrationKind } from "@/domain/integrations";
import { allOverviews, CATEGORIES } from "./queries";
import { requeueJobAction, runJobsAction } from "./actions";

export const metadata = { title: "Central de integrações" };

const ENV: Record<string, string> = { homologacao: "Homologação", producao: "Produção" };

export default async function Page({ searchParams }: { searchParams: Promise<{ cat?: string; view?: string; tarefa?: string }> }) {
  const s = await requireSession("admin");
  const { cat = "", view = "", tarefa } = await searchParams;
  const all = await allOverviews(s.ctx);
  const list = all.filter((o) => !cat || o.category === cat);
  const canManage = canDo(s.user, "admin.integrations");
  const configured = all.filter((o) => o.configured && o.enabled).length;
  const pending = all.filter((o) => o.enabled && !["operational", "simulated"].includes(o.status)).length;
  const disabled = all.filter((o) => o.configured && !o.enabled).length;
  const jobs = view === "pendencias" || tarefa ? (await Promise.all((Object.keys(INTEGRATION_CATALOG) as IntegrationKind[]).map(async (k) => (await integrationJobs(s.ctx, k, ["retry", "dead", "pending"])).map((j) => ({ ...j, kind: k }))))).flat() : [];
  const uniqueJobs = [...new Map(jobs.map((j) => [j.id, j])).values()];
  const tab = (label: string, value: string, count?: number) => (
    <Link key={label} href={`/administracao/integracoes${value ? `?cat=${encodeURIComponent(value)}` : ""}`} className={cn("rounded-full px-3 py-1 text-sm", cat === value && view !== "pendencias" ? "bg-brand-800 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50")}>
      {label}{count != null && <span className="ml-1 text-xs opacity-80">{count}</span>}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Central de integrações"
        crumbs={[{ label: "Administração" }, { label: "Integrações" }]}
        description="Conexões usadas por cada filial: configuração, teste real, pendências e histórico. Configuração preenchida não equivale a conexão operacional."
        actions={
          canManage && (
            <ActionButton action={runJobsAction} label="Executar tarefas pendentes agora" variant="primary" icon={<Play className="size-4" />} confirm="Executar agora as tarefas pendentes e em retentativa desta empresa?" />
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tab("Todas", "", all.length)}
        {CATEGORIES.map((c) => tab(c, c, all.filter((o) => o.category === c).length))}
        <Link href="/administracao/integracoes?view=pendencias" className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm", view === "pendencias" ? "bg-accent-500 text-white" : "bg-white text-slate-700 ring-1 ring-line hover:bg-slate-50")}>
          <AlertTriangle className="size-4" /> Ver pendências ({all.reduce((a, o) => a + o.pendingJobs, 0)} tarefas)
        </Link>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        {s.consolidated ? "Empresa (todas as filiais)" : s.branch?.name} · {configured} configurada(s) · {pending} pendente(s) (sem teste, com erro ou indisponível) · {disabled} desativada(s) — <span className="text-slate-500">{list.length} de {all.length} integrações</span>
      </p>
      {(view === "pendencias" || tarefa) && (
        <Card title="Pendências — tarefas em retentativa, com falha definitiva ou aguardando" className="mb-4" bodyClass="p-0">
          {uniqueJobs.length === 0 ? (
            <EmptyState title="Nenhuma tarefa pendente" description="Todas as tarefas desta empresa foram concluídas." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Tarefa</th><th>Integração</th><th>Situação</th><th className="text-right">Tentativas</th><th>Próxima execução</th><th>Último erro</th><th /></tr></thead>
                <tbody>
                  {uniqueJobs.map((j: any) => (
                    <tr key={j.id} className={tarefa === j.id ? "bg-amber-50" : undefined}>
                      <td className="font-mono text-xs">{j.type}{j.document && <Link className="ml-1 text-brand-700 hover:underline" href={`/fiscal/${j.document.model}/${j.document.id}`}>{j.document.model.toUpperCase()} {j.document.number ?? j.document.ref}</Link>}</td>
                      <td>{INTEGRATION_CATALOG[j.kind as IntegrationKind].label}</td>
                      <td><Badge tone={j.status === "dead" ? "bad" : j.status === "retry" ? "warn" : "info"}>{j.status === "dead" ? "Falha definitiva" : j.status === "retry" ? "Retentativa" : "Aguardando"}</Badge></td>
                      <td className="tabular text-right">{j.attempts ?? 0}/{j.maxAttempts ?? 8}</td>
                      <td className="text-xs">{j.status === "dead" ? "—" : formatDateTime(j.runAt)}</td>
                      <td className="max-w-sm truncate text-xs text-red-800" title={j.lastError ?? ""}>{j.lastError ?? "—"}</td>
                      <td>{canManage && j.status !== "running" && <ActionButton action={requeueJobAction.bind(null, j.id)} label="Reprocessar" size="sm" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {list.map((o) => (
          <section key={o.kind} className="flex flex-col rounded-lg border border-line bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-50 text-sm font-bold text-brand-800">{o.abbr}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">{o.label}</h2>
                  <span className="text-xs text-slate-500">{o.category}</span>
                </div>
                <p className="text-xs text-slate-600">{o.description}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge kind="integration" status={o.status} />
              {!o.enabled && o.configured && <Badge>Desativada</Badge>}
              {o.environment && !o.simulated && o.configured && <Badge tone={o.environment === "producao" ? "brand" : "info"}>{ENV[o.environment] ?? o.environment}</Badge>}
              {o.providerLabel && <span className="text-xs text-slate-600">{o.providerLabel}</span>}
              {o.scope && <span className="text-xs text-slate-400">· {o.scope === "branch" ? "configuração da filial" : "configuração da empresa"}</span>}
              {o.pendingJobs > 0 && <Link href={`/administracao/integracoes/${o.kind}?tab=pendencias`}><Badge tone="warn">{o.pendingJobs} tarefa(s) com falha</Badge></Link>}
            </div>
            <p className="mt-2 text-xs text-slate-700">{o.message ?? (o.configured ? "Sem teste registrado." : "Integração não configurada.")}</p>
            <p className="mt-1 text-xs text-slate-500">{o.diagnosis}</p>
            <p className="mt-1 text-xs text-slate-500">Usada por: {INTEGRATION_CATALOG[o.kind].consumers.map((c, i) => <span key={c.href + i}>{i > 0 && ", "}<Link className="text-brand-700 hover:underline" href={c.href}>{c.label}</Link></span>)}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-slate-500">
              <span>Último teste: {o.lastTestAt ? formatDateTime(o.lastTestAt) : "nunca"}{o.lastRunAt ? ` · última execução ${formatDateTime(o.lastRunAt)} (${o.lastRunStatus === "success" ? "ok" : o.lastRunStatus === "failure" ? "falha" : o.lastRunStatus})` : ""}</span>
              <span className="flex gap-2">
                <Link href={`/administracao/integracoes/${o.kind}?tab=atividade`} className={buttonClass("ghost", "sm")}>Atividade</Link>
                <Link href={`/administracao/integracoes/${o.kind}`} className={buttonClass(o.configured ? "secondary" : "accent", "sm")}>{o.configured ? "Gerenciar" : "Configurar"}</Link>
              </span>
            </div>
          </section>
        ))}
      </div>
      {s.company.isDemo && <div className="mt-4"><Notice tone="sim">Empresa de demonstração: integrações de Pix e fiscal usam provedores de simulação (sem transação ou documento real).</Notice></div>}
    </>
  );
}
