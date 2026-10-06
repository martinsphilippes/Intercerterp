import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search, Unlink } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState, Notice } from "@/components/ui/empty";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Checkbox } from "@/components/ui/form";
import { Timeline } from "@/components/ui/timeline";
import { formatDateTime } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { CONFIG_LABEL, cscRefProblem, INTEGRATION_CATALOG, integrationJobs, integrationLogs, providerSecretProblem, SECRET_LABEL, usageSummary, type IntegrationKind } from "@/domain/integrations";
import { REGIME_LABEL } from "@/domain/fiscal/config";
import { integrationOverview } from "../queries";
import { IntegrationForm } from "./integration-form";
import { requeueJobAction, saveFiscalIntegrationAction, testIntegrationAction, unlinkCredentialAction } from "../actions";

export const metadata = { title: "Integração" };

const ENV: Record<string, string> = { homologacao: "Homologação", producao: "Produção" };

export default async function Page({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { kind: k } = await params;
  const { tab = "configuracao" } = await searchParams;
  if (!(k in INTEGRATION_CATALOG)) notFound();
  const kind = k as IntegrationKind;
  const cat = INTEGRATION_CATALOG[kind];
  const o = await integrationOverview(s.ctx, kind);
  const canEdit = canDo(s.user, "admin.integrations");
  const fiscal = kind === "fiscal_nfe" || kind === "fiscal_nfse";
  const scope: "branch" | "company" = s.branch ? "branch" : "company";
  const jobs = await integrationJobs(s.ctx, kind, ["retry", "dead", "pending", "running"]);
  const logs = await integrationLogs(s.ctx, kind, 100);
  const usage = await usageSummary(s.ctx, kind);
  const base = `/administracao/integracoes/${kind}`;
  const cfg = o.fiscalConfig;
  const envNames = new Set<string>();
  // somente nomes permitidos para o provedor são consultados no ambiente (nunca segredos do sistema)
  for (const p of cat.providers) for (const sec of p.secrets) {
    const n = o.record?.secretRefs?.[sec] ?? p.defaultRefs?.[sec] ?? "";
    if (n && !providerSecretProblem(p, sec, n)) envNames.add(n);
  }
  const envDefined = Object.fromEntries([...envNames].map((n) => [n, Boolean(process.env[n])]));
  return (
    <>
      <Link href="/administracao/integracoes" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
        <ArrowLeft className="size-4" /> Voltar às integrações
      </Link>
      <div className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-line bg-white p-4">
        <span className="flex size-12 items-center justify-center rounded-md bg-brand-50 text-base font-bold text-brand-800">{o.abbr}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{o.record?.config?.connectionName || cat.label}</h1>
          <p className="text-sm text-slate-500">{s.branch?.name ?? "Empresa (consolidado)"} · {o.category} · {cat.label}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge kind="integration" status={o.status} />
            {o.simulated && o.status !== "simulated" && <SimBadge />}
            {!o.enabled && o.configured && <Badge>Desativada</Badge>}
            {o.environment && !o.simulated && <Badge tone={o.environment === "producao" ? "brand" : "info"}>{ENV[o.environment] ?? o.environment}</Badge>}
            {o.scope && <span className="text-xs text-slate-500">{o.scope === "branch" ? "Configuração própria da filial" : "Configuração da empresa"}</span>}
          </div>
        </div>
        {o.configured && <ActionButton action={testIntegrationAction.bind(null, kind, scope)} label="Testar conexão" variant="primary" icon={<Search className="size-4" />} />}
      </div>
      <div className="mb-4">
        <Notice tone={["operational"].includes(o.status) ? "good" : o.status === "simulated" ? "sim" : ["error", "unavailable"].includes(o.status) ? "bad" : "warn"} title={`Situação medida: ${o.statusLabel}${o.lastTestAt ? ` (teste em ${formatDateTime(o.lastTestAt)})` : ""}`}>
          {o.message && <p>{o.message}</p>}
          <p className="mt-1 text-xs">{o.diagnosis}</p>
        </Notice>
      </div>
      <LinkTabs basePath={base} active={tab} tabs={[{ key: "configuracao", label: "Configuração" }, { key: "pendencias", label: "Pendências", count: jobs.filter((j) => j.status !== "running").length }, { key: "atividade", label: "Atividade", count: logs.length }]} />
      {tab === "configuracao" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card title={fiscal ? "Configuração da integração fiscal" : "Configuração"}>
            {fiscal ? (
              <ActionForm action={saveFiscalIntegrationAction} className="space-y-4">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="scope" value={scope} />
                <Checkbox name="enabled" label={`Habilitar integração nesta ${s.branch ? "filial" : "empresa"} (${kind === "fiscal_nfe" ? "emissão de NF-e e NFC-e" : "emissão de NFS-e"})`} defaultChecked={o.enabled} disabled={!canEdit} />
                <FormGrid cols={2}>
                  <Field label="Nome da conexão" required><Input name="connectionName" defaultValue={o.record?.config?.connectionName ?? `${cat.label} · ${s.branch?.name ?? "Empresa"}`} required disabled={!canEdit} /></Field>
                  <Field label="Provedor"><Select name="provider" defaultValue={cfg?.provider ?? "simulated"} options={cat.providers.map((p) => ({ value: p.id, label: p.label }))} disabled={!canEdit} /></Field>
                  <Field label="Ambiente · configuração fiscal" hint="Herdado das configurações fiscais da filial (troca com confirmação lá)."><Input value={cfg ? (cfg.provider === "simulated" ? "Simulação" : (ENV[cfg.environment] ?? cfg.environment)) : "Não configurado"} disabled /></Field>
                  <Field label="Perfil fiscal da filial" hint="Regime, CRT e séries vêm das configurações fiscais."><Input value={cfg ? `${REGIME_LABEL[s.company.regime] ?? s.company.regime ?? "—"} · CRT ${s.company.crt ?? "—"} · ${kind === "fiscal_nfe" ? `NF-e série ${cfg.nfeSeries ?? 1} · NFC-e série ${cfg.nfceSeries ?? 1}` : `RPS série ${cfg.nfseSeries ?? 1}`}` : "—"} disabled /></Field>
                  <Field label="Filial vinculada"><Input value={s.branch?.name ?? "Empresa (todas as filiais sem configuração própria)"} disabled /></Field>
                  {kind === "fiscal_nfse" && <Field label="Padrão da NFS-e"><Select name="nfseStandard" defaultValue={cfg?.nfseStandard ?? "municipal"} options={[{ value: "municipal", label: "Municipal (via provedor)" }, { value: "nacional", label: "Nacional (DPS)" }]} disabled={!canEdit} /></Field>}
                </FormGrid>
                <div className="rounded-md border border-line p-3">
                  <p className="text-sm font-semibold">Credencial da integração</p>
                  <p className="mb-2 text-xs text-slate-500">Somente o NOME da variável de ambiente que guarda o token do provedor (o valor nunca é gravado). Simulação não usa credencial.</p>
                  <FormGrid cols={2}>
                    <Field label="Variável do token" hint={cfg?.tokenRef === "" ? <Badge tone="warn">vínculo removido</Badge> : o.secrets[0] ? (o.secrets[0].problem ? <Badge tone="bad">nome não permitido</Badge> : o.secrets[0].defined ? <Badge tone="good">definida no servidor</Badge> : <Badge tone="warn">não definida no servidor</Badge>) : undefined}>
                      <Input name="tokenRef" defaultValue={cfg?.tokenRef === "" ? "" : (cfg?.tokenRef ?? "FOCUSNFE_TOKEN")} placeholder="FOCUSNFE_TOKEN" disabled={!canEdit} />
                    </Field>
                    {kind === "fiscal_nfe" && (
                      <>
                        <Field label="CSC da NFC-e — ID"><Input name="cscId" defaultValue={cfg?.cscId ?? ""} disabled={!canEdit} /></Field>
                        <Field label="CSC da NFC-e — variável do código" hint={cfg?.cscTokenRef ? (cscRefProblem(cfg.cscTokenRef) ? <Badge tone="bad">nome não permitido</Badge> : process.env[cfg.cscTokenRef] ? <Badge tone="good">definida</Badge> : <Badge tone="warn">não definida</Badge>) : undefined}><Input name="cscTokenRef" defaultValue={cfg?.cscTokenRef ?? "NFCE_CSC"} disabled={!canEdit} /></Field>
                      </>
                    )}
                  </FormGrid>
                </div>
                <blockquote className="border-l-4 border-brand-200 bg-brand-50/40 px-3 py-2 text-sm text-slate-700">
                  Uso no ERP: {kind === "fiscal_nfe" ? "vinculada à emissão de NF-e (Fiscal → NF-e) e NFC-e (vendas do PDV)." : "vinculada à emissão de NFS-e (Fiscal → NFS-e)."} Certificado, séries, numeração, contingência e ambiente são definidos nas configurações fiscais.
                </blockquote>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href="/fiscal/configuracoes" className="text-sm text-brand-700 underline">Conferir dados nas configurações fiscais</Link>
                  {canEdit && (
                    <span className="flex gap-2">
                      <button type="reset" className={buttonClass("ghost")}>Descartar</button>
                      <button type="submit" className={buttonClass("primary")}>Salvar</button>
                    </span>
                  )}
                </div>
              </ActionForm>
            ) : (
              <IntegrationForm
                kind={kind}
                providers={cat.providers}
                current={o.record ? { provider: o.record.provider, environment: o.record.environment, config: o.record.config ?? {}, secretRefs: o.record.secretRefs ?? {}, enabled: o.record.enabled !== false, scope: o.record.branchId ? "branch" : "company" } : null}
                secretLabels={SECRET_LABEL}
                configLabels={CONFIG_LABEL}
                envDefined={envDefined}
                branchName={s.branch?.name ?? null}
                canEdit={canEdit}
              />
            )}
          </Card>
          <div className="space-y-4">
            <Card title="Credencial vinculada">
              {o.secrets.length === 0 ? (
                <p className="text-sm text-slate-500">{o.configured ? (o.simulated ? "Provedor de simulação: sem credencial." : "Este provedor não usa credencial.") : "Configure a integração."}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {o.secrets.map((sec) => (
                    <li key={sec.key} className="rounded-md bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">{sec.label}</p>
                      <p className="font-mono text-xs">{sec.envName || "— sem vínculo —"}</p>
                      {sec.envName && <p className="mt-1">{sec.problem ? <Badge tone="bad">nome não permitido</Badge> : sec.defined ? <Badge tone="good">definida no servidor</Badge> : <Badge tone="warn">não definida no servidor</Badge>}</p>}
                      {sec.problem && <p className="mt-1 text-xs text-red-700">{sec.problem}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && o.secrets.some((x) => x.envName) && (
                <div className="mt-3">
                  <ActionButton action={unlinkCredentialAction.bind(null, kind, scope)} label="Remover vínculo" size="sm" variant="ghost" icon={<Unlink className="size-4" />} confirm="Remover o vínculo da credencial? A integração deixa de operar até um novo vínculo." />
                </div>
              )}
            </Card>
            <Card title="Consumidores no ERP">
              <ul className="space-y-1 text-sm">
                {cat.consumers.map((c) => <li key={c.href + c.label}><Link className="text-brand-700 hover:underline" href={c.href}>{c.label}</Link></li>)}
              </ul>
              <p className="mt-3 text-xs font-semibold text-slate-600">Uso real (30 dias)</p>
              {usage.length === 0 ? <p className="text-xs text-slate-500">Nenhuma execução registrada.</p> : (
                <table className="mt-1 w-full text-xs">
                  <thead><tr className="text-left text-slate-500 [&_th]:px-1"><th>Ação</th><th className="text-right">Ok</th><th className="text-right">Falha</th><th>Última</th></tr></thead>
                  <tbody className="[&_td]:px-1">{usage.map((u) => <tr key={u.action}><td className="font-mono">{u.action}</td><td className="tabular text-right">{u.success}</td><td className="tabular text-right">{u.failure}</td><td>{formatDateTime(u.last)}</td></tr>)}</tbody>
                </table>
              )}
            </Card>
            <Card title="Última execução">
              <DefinitionList cols={1} items={[{ label: "Último teste", value: o.lastTestAt ? formatDateTime(o.lastTestAt) : "Nunca" }, { label: "Última chamada", value: logs[0] ? `${formatDateTime(logs[0].occurredAt)} — ${logs[0].action} (${logs[0].status === "success" ? "sucesso" : logs[0].status === "failure" ? "falha" : "informativo"})` : "—" }]} />
            </Card>
          </div>
        </div>
      )}
      {tab === "pendencias" && (
        <Card title="Tarefas pendentes, em retentativa ou com falha" bodyClass="p-0">
          {jobs.length === 0 ? <EmptyState title="Nenhuma pendência" description="Não há tarefas desta integração aguardando ou com falha." /> : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Tarefa</th><th>Situação</th><th className="text-right">Tentativas</th><th>Próxima execução</th><th>Último erro</th><th /></tr></thead>
                <tbody>
                  {jobs.map((j: any) => (
                    <tr key={j.id}>
                      <td className="font-mono text-xs">{j.type}{j.document && <Link className="ml-1 text-brand-700 hover:underline" href={`/fiscal/${j.document.model}/${j.document.id}`}>{j.document.model.toUpperCase()} {j.document.number ?? j.document.ref}</Link>}</td>
                      <td><Badge tone={j.status === "dead" ? "bad" : j.status === "retry" ? "warn" : "info"}>{j.status === "dead" ? "Falha definitiva" : j.status === "retry" ? "Retentativa" : j.status === "running" ? "Executando" : "Aguardando"}</Badge></td>
                      <td className="tabular text-right">{j.attempts ?? 0}/{j.maxAttempts ?? 8}</td>
                      <td className="text-xs">{j.status === "dead" ? "—" : formatDateTime(j.runAt)}</td>
                      <td className="max-w-md truncate text-xs text-red-800" title={j.lastError ?? ""}>{j.lastError ?? "—"}</td>
                      <td>{canEdit && ["retry", "dead", "pending"].includes(j.status) && <ActionButton action={requeueJobAction.bind(null, j.id)} label="Reprocessar" size="sm" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "atividade" && (
        <div className="space-y-4">
          <Card title="Histórico de execuções (testes, envios, falhas)" actions={<a className={buttonClass("ghost", "sm")} href={`/api/export/integration-logs?kind=${kind}`}>Exportar</a>} bodyClass="p-0">
            {logs.length === 0 ? <EmptyState title="Sem execuções registradas" /> : (
              <ul className="divide-y divide-line text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={l.status === "success" ? "good" : l.status === "failure" ? "bad" : "neutral"}>{l.status === "success" ? "Sucesso" : l.status === "failure" ? "Falha" : "Informativo"}</Badge>
                      <span className="font-mono text-xs">{l.action}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(l.occurredAt)}{l.durationMs != null ? ` · ${l.durationMs} ms` : ""}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-700">{l.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Alterações de configuração">
            <Timeline store={s.ctx.store} refs={[`integration:${o.record?.id ?? "-"}`, ...(cfg ? [`fiscal_config:${cfg.id}`] : [])]} />
          </Card>
        </div>
      )}
    </>
  );
}
