import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, Stat } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { paginate, parseList, sp, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { backupSummary, backupCode } from "@/domain/backup";
import { configuredBackend } from "@/lib/db";
import { queryBackups, INTEGRITY_LABEL, formatBytes } from "./queries";
import { NewBackupButton, ScheduleForm } from "./forms";
import { applyRetentionAction } from "./actions";
import { BACKUP_FREQUENCIES, WEEKDAYS, describeSchedule } from "../parametros/catalog";

export const metadata = { title: "Backup e restauração" };

type Row = Awaited<ReturnType<typeof queryBackups>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const tab = sp(params, "tab") || "historico";
  const p = parseList(params, { sort: "startedAt", dir: "desc" });
  const all = await queryBackups(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const sum = await backupSummary(s.ctx.store, s.ctx.companyId);
  const branches = await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] });
  const manage = canDo(s.user, "admin.backup");
  const lastValid = sum.lastValid;
  const integrity = (r: Row) => (r.integrity === "none" ? "—" : <Badge tone={r.integrity === "verified" ? "good" : r.integrity === "failed" ? "bad" : "warn"}>{INTEGRITY_LABEL[r.integrity as keyof typeof INTEGRITY_LABEL]}</Badge>);
  const columns: Column<Row>[] = [
    { key: "startedAt", label: "Data / identificação", sortable: true, fixed: true, cell: (r) => <span>{formatDateTime(r.finishedAt ?? r.startedAt)}<span className="block text-xs font-normal text-slate-500">{r.code}</span></span> },
    { key: "originLabel", label: "Origem", sortable: true, cell: (r) => <span>{r.originLabel}<span className="block text-xs text-slate-500">{r.requestedBy}</span></span> },
    { key: "includeFiles", label: "Conteúdo", cell: (r) => (r.includeFiles ? `Dados + ${r.files} arquivo(s)` : "Somente dados") },
    { key: "rows", label: "Registros", align: "right", sortable: true, cell: (r) => (r.rows != null ? r.rows.toLocaleString("pt-BR") : "—") },
    { key: "sizeBytes", label: "Tamanho", align: "right", sortable: true, cell: (r) => (r.status === "failed" ? "—" : formatBytes(r.sizeBytes)) },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="backup" status={r.status === "verified" ? "completed" : r.status} /> },
    { key: "integrity", label: "Integridade", cell: integrity },
    { key: "retentionUntil", label: "Retida até", sortable: true, hidden: true, cell: (r) => formatDate(r.retentionUntil) },
    { key: "action", label: "Ação", align: "right", cell: (r) => <Link className="text-brand-700 hover:underline" href={`/administracao/backups/${r.id}`}>Detalhes</Link> },
  ];
  return (
    <>
      <PageHeader
        title="Backup e restauração"
        crumbs={[{ label: "Administração" }, { label: "Backup e restauração" }]}
        description="Cópias completas dos dados de cada empresa, com integridade comprovada por restauração em base de teste."
        actions={
          <>
            <LinkButton href="/administracao/backups?tab=programacao">
              <CalendarClock className="size-4" /> Programação
            </LinkButton>
            {manage && <NewBackupButton includeFilesDefault={sum.schedule.includeFiles} />}
          </>
        }
      />
      <Card className="mb-4" bodyClass="grid gap-4 p-4 md:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Última cópia concluída</p>
          {lastValid ? (
            <>
              <p className="mt-1 text-lg font-semibold">
                <Link className="hover:underline" href={`/administracao/backups/${lastValid.id}`}>{formatDateTime(lastValid.finishedAt)}</Link>
              </p>
              <p className="text-xs text-slate-500">
                {backupCode(lastValid)} · {lastValid.status === "verified" ? `integridade verificada em ${formatDateTime(lastValid.verifiedAt)}` : "integridade pendente"}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-amber-700">Nenhuma cópia válida até agora.</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Programação</p>
          <p className="mt-1 text-lg font-semibold">{describeSchedule(sum.schedule)}</p>
          <p className="text-xs text-slate-500">
            Retenção configurada: {sum.schedule.retentionDays} dias · {sum.nextRun ? `próxima: ${formatDateTime(sum.nextRun)}` : "sem próxima execução"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Abrangência</p>
          <p className="mt-1 text-lg font-semibold">{s.company.tradeName || s.company.name}</p>
          <p className="text-xs text-slate-500">Todas as unidades da empresa ({branches.length}): {branches.map((b) => b.name).join(", ")}</p>
        </div>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cópias com artefato" value={sum.storedCount} hint={`${formatBytes(sum.storedBytes)} armazenados`} href="/administracao/backups?status=completed" />
        <Stat label="Verificadas (restauráveis)" value={sum.all.filter((b) => b.status === "verified").length} href="/administracao/backups?integrity=verified" tone="good" />
        <Stat label="Integridade pendente" value={all.filter((b) => b.integrity === "pending").length} tone={all.some((b) => b.integrity === "pending") ? "warn" : "default"} href="/administracao/backups?integrity=pending" />
        <Stat label="Falhas" value={sum.failed} tone={sum.failed ? "bad" : "default"} href="/administracao/backups?status=failed" />
      </div>
      <LinkTabs basePath="/administracao/backups" active={tab} tabs={[{ key: "historico", label: "Histórico de cópias", count: sum.all.length }, { key: "programacao", label: "Programação e retenção" }]} />
      {tab === "historico" && (
        <>
          <FilterBar
            basePath="/administracao/backups"
            values={params}
            filters={[
              { type: "select", name: "status", label: "Situação", options: [{ value: "completed", label: "Concluída" }, { value: "running", label: "Em execução" }, { value: "failed", label: "Falhou" }, { value: "expired", label: "Expirada (removida)" }] },
              { type: "select", name: "integrity", label: "Integridade", options: [{ value: "verified", label: "Verificada" }, { value: "pending", label: "Pendente" }, { value: "failed", label: "Falhou na verificação" }] },
              { type: "select", name: "kind", label: "Origem", options: [{ value: "auto", label: "Automática" }, { value: "manual", label: "Manual" }] },
            ]}
          />
          <DataTable
            id="admin-backups"
            basePath="/administracao/backups"
            params={params}
            columns={columns}
            rows={rows}
            total={total}
            page={p.page}
            pageSize={p.pageSize}
            exportKey="admin.backups"
            rowHref={(r) => `/administracao/backups/${r.id}`}
            footer={<div className="border-t border-line px-3 py-2 text-xs text-slate-500">{total} de {sum.all.length} registros · horários de Brasília (UTC−3)</div>}
            empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma cópia registrada. {manage ? "Use “Nova cópia agora” ou aguarde a rotina programada." : ""}</div>}
          />
        </>
      )}
      {tab === "programacao" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Programação e retenção" className="lg:col-span-2" description="Parâmetro backup.schedule da empresa. A rotina diária agenda a cópia no horário e aplica a retenção.">
            <ScheduleForm schedule={sum.schedule} readOnly={!manage || !can(s.user, "admin", "edit")} weekdays={WEEKDAYS} frequencies={BACKUP_FREQUENCIES} />
          </Card>
          <Card title="Como funciona">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-slate-600">
              <li>A cópia exporta todas as tabelas da empresa e, se marcado, o conteúdo dos arquivos.</li>
              <li>O artefato é compactado (gzip) e tem manifesto com contagens e SHA-256 por tabela.</li>
              <li>Destino: {configuredBackend() === "appwrite" ? "Appwrite Storage, bucket “backups” (criptografado)" : "armazenamento local de arquivos da instalação"}.</li>
              <li>“Verificada” só aparece após restaurar em base de teste isolada e comparar contagens e checksums.</li>
              <li>Retenção: artefatos vencidos são removidos; a cópia válida mais recente nunca é removida.</li>
            </ul>
            {manage && (
              <div className="mt-4">
                <ActionButton action={applyRetentionAction} label="Aplicar retenção agora" confirm="Remover os artefatos de cópias vencidas?" />
              </div>
            )}
          </Card>
          {!sum.schedule.enabled && (
            <div className="lg:col-span-3">
              <Notice tone="warn">Cópia automática desligada: só haverá cópias criadas manualmente.</Notice>
            </div>
          )}
        </div>
      )}
    </>
  );
}
