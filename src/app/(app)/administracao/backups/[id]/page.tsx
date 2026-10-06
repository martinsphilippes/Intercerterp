import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { configuredBackend, listAll } from "@/lib/db";
import { COLLECTION_MAP } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { formatDate, formatDateTime } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { backupCode, backupPlan, restorePreview, suggestedDatabaseId } from "@/domain/backup";
import { INTEGRITY_LABEL, formatBytes, integrityOf } from "../queries";
import { verifyBackupAction } from "../actions";
import { RestoreForm } from "../forms";

export const metadata = { title: "Cópia de segurança" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const b = await s.ctx.store.get("backups", id);
  if (!b || b.companyId !== s.ctx.companyId) notFound();
  const [branches, jobs, requester] = await Promise.all([
    listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] }),
    listAll(s.ctx.store, "restore_jobs", { filters: [["eq", "backupId", id], ["eq", "companyId", s.ctx.companyId]], orderBy: [{ field: "createdAt", dir: "desc" }] }),
    b.createdBy ? s.ctx.store.get("users", b.createdBy) : Promise.resolve(null),
  ]);
  const manage = canDo(s.user, "admin.backup");
  const integrity = integrityOf(b);
  const code = backupCode(b);
  const counts: Record<string, number> = b.counts ?? {};
  const vr = b.verifyResult ?? null;
  const usable = ["completed", "verified"].includes(b.status) && (b.fileId || b.scope?.parts?.length);
  const base = `/administracao/backups/${id}`;
  const plan = backupPlan({ includeFiles: Boolean(b.scope?.includeFiles), includeGlobal: b.scope?.includeGlobal !== false });
  const labels = Object.fromEntries(Object.keys(counts).map((k) => [k, COLLECTION_MAP[k]?.label ?? k]));
  return (
    <>
      <PageHeader
        title={code}
        crumbs={[{ label: "Administração" }, { label: "Backup e restauração", href: "/administracao/backups" }, { label: code }]}
        badges={
          <>
            <StatusBadge kind="backup" status={b.status === "verified" ? "completed" : b.status} />
            {integrity !== "none" && <Badge tone={integrity === "verified" ? "good" : integrity === "failed" ? "bad" : "warn"}>Integridade: {INTEGRITY_LABEL[integrity]}</Badge>}
          </>
        }
        description={`${formatDateTime(b.finishedAt ?? b.startedAt)} · ${s.company.tradeName || s.company.name} · ${b.kind === "auto" ? "automática" : "manual"}`}
        actions={
          <>
            {usable && manage && (
              <a href={`${base}/download`} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-slate-50">
                <Download className="size-4" /> Baixar artefato
              </a>
            )}
            {usable && manage && (b.status === "verified" ? <ActionButton action={verifyBackupAction.bind(null, id)} label="Verificação concluída — verificar de novo" variant="ghost" /> : <ActionButton action={verifyBackupAction.bind(null, id)} label="Verificar integridade" variant="primary" />)}
            {usable && manage && <LinkButton href={`${base}?tab=restauracao`}>Preparar restauração</LinkButton>}
          </>
        }
      />
      {b.status === "failed" && (
        <div className="mb-4">
          <Notice tone="bad" title="A cópia falhou">{b.error}</Notice>
        </div>
      )}
      {b.status === "expired" && (
        <div className="mb-4">
          <Notice tone="info" title="Artefato removido pela retenção">Retida até {formatDate(b.retentionUntil)}; removida em {formatDateTime(b.scope?.expiredAt)}. O registro e a evidência de verificação permanecem para auditoria.</Notice>
        </div>
      )}
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Resumo" },
          { key: "conteudo", label: "Conteúdo", count: Object.keys(counts).length },
          { key: "verificacao", label: "Verificação" },
          { key: "restauracao", label: "Restauração", count: jobs.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Cópia">
            <DefinitionList
              items={[
                { label: "Conteúdo", value: b.scope?.includeFiles ? `Dados, XML e anexos (${b.scope?.files?.included ?? 0} arquivos)` : "Dados (sem conteúdo de arquivos)" },
                { label: "Unidades", value: branches.map((x) => x.name).join(", ") },
                { label: "Destino", value: configuredBackend() === "appwrite" ? "Appwrite Storage · bucket “backups” (criptografado)" : "Armazenamento local de arquivos" },
                { label: "Solicitado por", value: b.kind === "auto" ? "Rotina automática" : (requester?.name ?? "—") },
                { label: "Tipo da cópia", value: "Completa da empresa" },
                { label: "Integridade", value: INTEGRITY_LABEL[integrity] },
                { label: "Início", value: formatDateTime(b.startedAt) },
                { label: "Conclusão", value: formatDateTime(b.finishedAt) },
                { label: "Duração", value: b.scope?.durationMs != null ? `${(b.scope.durationMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : "—" },
                { label: "Retida até", value: formatDate(b.retentionUntil) },
              ]}
            />
          </Card>
          <Card title="Artefato">
            <DefinitionList
              cols={1}
              items={[
                { label: "Registros", value: b.scope?.rows != null ? Number(b.scope.rows).toLocaleString("pt-BR") : "—" },
                { label: "Tamanho compactado (gzip)", value: formatBytes(b.sizeBytes) },
                { label: "Tamanho sem compactação", value: formatBytes(b.scope?.rawBytes) },
                { label: "Partes", value: b.scope?.parts?.length ?? (b.fileId ? 1 : 0) },
                { label: "Formato", value: b.scope?.format ?? "—" },
                { label: "SHA-256 do artefato", value: <code className="break-all text-xs">{b.scope?.artifactSha256 ?? "—"}</code> },
                { label: "Checksum dos dados (manifesto)", value: <code className="break-all text-xs">{b.checksum ?? "—"}</code> },
                { label: "Arquivos ausentes no armazenamento", value: b.scope?.files?.missing?.length ? `${b.scope.files.missing.length}` : "Nenhum" },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === "conteudo" && (
        <Card bodyClass="p-0" title="Tabelas incluídas" description="Contagem por tabela registrada no manifesto; sessões e os próprios metadados de backup não entram na cópia.">
          {Object.keys(counts).length === 0 ? (
            <EmptyState title="Sem manifesto (cópia não concluída)" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Tabela</th><th>Critério</th><th className="text-right">Registros</th></tr>
              </thead>
              <tbody>
                {plan
                  .filter((x) => x.id in counts)
                  .map((x) => (
                    <tr key={x.id}>
                      <td>{x.label} <span className="text-xs text-slate-400">({x.id})</span></td>
                      <td className="text-slate-600">{x.rule}</td>
                      <td className="tabular text-right">{counts[x.id].toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "verificacao" && (
        <Card title="Evidência da verificação" description="Restauração em base de teste isolada (MemoryStore nova, descartada após a comparação). A base em uso não é tocada.">
          {!vr ? (
            <EmptyState title="Ainda não verificada" description="A integridade só é considerada comprovada após a restauração em base de teste." action={usable && manage ? <ActionButton action={verifyBackupAction.bind(null, id)} label="Verificar agora" variant="primary" /> : undefined} />
          ) : (
            <div className="space-y-4">
              <Notice tone={vr.ok ? "good" : "bad"} title={vr.ok ? "Restaurável: contagens e checksums iguais" : "Divergência encontrada"}>
                Verificado em {formatDateTime(b.verifiedAt)}{vr.durationMs != null ? ` em ${(vr.durationMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : ""}.{" "}
                {vr.restoredRows != null && `${Number(vr.restoredRows).toLocaleString("pt-BR")} de ${Number(vr.expectedRows).toLocaleString("pt-BR")} registros restaurados.`}
              </Notice>
              <DefinitionList
                cols={2}
                items={[
                  { label: "Destino do teste", value: vr.target },
                  { label: "SHA-256 do artefato", value: vr.artifactSha256Ok === true ? "Confere com o registrado" : vr.artifactSha256Ok === false ? "NÃO confere" : "—" },
                  { label: "Checksum esperado (manifesto)", value: <code className="break-all text-xs">{vr.checksum?.expected ?? "—"}</code> },
                  { label: "Checksum obtido na base de teste", value: <code className="break-all text-xs">{vr.checksum?.actual ?? "—"}</code> },
                  { label: "Arquivos conferidos (SHA-256)", value: vr.files ? `${vr.files.ok} de ${vr.files.checked}` : "—" },
                  { label: "Tabelas divergentes", value: vr.mismatches?.length ? vr.mismatches.map((m: any) => `${m.id} (${m.reason}: ${m.restored}/${m.expected})`).join("; ") : "Nenhuma" },
                  { label: "Erros de gravação", value: vr.errors?.length ? vr.errors.slice(0, 5).join("; ") : "Nenhum" },
                  { label: "Restauração de origem", value: vr.restoreJobId ? <Link className="text-brand-700 hover:underline" href={`${base}?tab=restauracao`}>ver execução</Link> : "—" },
                ]}
              />
            </div>
          )}
        </Card>
      )}
      {tab === "restauracao" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Preparar restauração" description="Escolha o destino, revise o escopo e confirme. Nunca restaura sobre a base em uso.">
            {usable && manage ? (
              <RestoreForm
                backupId={id}
                previews={JSON.parse(JSON.stringify({ test: restorePreview(b, "test", null), appwrite: restorePreview(b, "appwrite_new", suggestedDatabaseId()) }))}
                appwriteAvailable={configuredBackend() === "appwrite"}
                suggestedDb={suggestedDatabaseId()}
                labels={labels}
              />
            ) : (
              <EmptyState title={usable ? "Sem permissão para restaurar" : "Cópia sem artefato disponível"} description={usable ? "Requer a operação “Backup e restauração”." : "Cópias com falha ou expiradas não podem ser restauradas."} />
            )}
          </Card>
          <Card title="Execuções" bodyClass="p-0">
            {jobs.length === 0 ? (
              <EmptyState title="Nenhuma restauração executada" />
            ) : (
              <ul className="divide-y divide-line">
                {jobs.map((j) => (
                  <li key={j.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge kind="restore" status={j.status} />
                      <span className="font-medium">{j.target === "test" ? "Base de teste isolada" : `Nova base Appwrite ${j.preview?.databaseId ?? ""}`}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(j.createdAt)}</span>
                    </div>
                    {j.result?.restoredRows != null && (
                      <p className="text-xs text-slate-600">
                        {Number(j.result.restoredRows).toLocaleString("pt-BR")} de {Number(j.result.expectedRows).toLocaleString("pt-BR")} registros · {j.result.collections?.filter((c: any) => c.checksumOk).length ?? 0} de {j.result.collections?.length ?? 0} tabelas com checksum igual
                        {j.result.files ? ` · arquivos ${j.result.files.ok}/${j.result.files.checked}` : ""}
                        {j.result.files?.reuploaded ? ` · ${j.result.files.reuploaded} reenviado(s)` : ""} · {(Number(j.result.durationMs ?? 0) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s
                      </p>
                    )}
                    {j.error && <p className="text-xs text-red-700">{j.error}</p>}
                    {j.status === "running" && <p className="text-xs text-slate-500">Em execução desde {formatDateTime(j.startedAt)} — atualize a página para acompanhar.</p>}
                    {j.status === "pending" && <p className="text-xs text-slate-500">Na fila de tarefas (executada em instantes ou pela rotina periódica).</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`backup:${id}`]} />
        </Card>
      )}
    </>
  );
}
