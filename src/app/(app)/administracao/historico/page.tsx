import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/dates";
import { MODULES } from "@/lib/permissions";
import { lookups, nameMap } from "@/lib/server/lookups";
import { queryAudit, formatStamp } from "./queries";
import { ENTITY_LABEL } from "./origin";

export const metadata = { title: "Histórico e auditoria" };

type Row = Awaited<ReturnType<typeof queryAudit>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const p = parseList(params, { sort: "occurredAt", dir: "desc", pageSize: 50 });
  const all = await queryAudit(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const [users, branches, branchNames] = await Promise.all([lookups.users(s.ctx), lookups.branches(s.ctx), nameMap(s.ctx, "branches")]);
  const failures = all.counts.failure;
  const distinctUsers = new Set(all.map((r) => r.userId)).size;
  const withChanges = all.filter((r) => r.hasChanges).length;
  const link = (extra: Record<string, string | null>) => `/administracao/historico${qs(extra, params)}`;
  const columns: Column<Row>[] = [
    { key: "occurredAt", label: "Data/hora", sortable: true, fixed: true, cell: (r) => <span className="whitespace-nowrap">{formatStamp(r.occurredAt)}<span className="block text-[11px] font-normal text-slate-400">{r.code}</span></span> },
    { key: "moduleLabel", label: "Módulo · filial", sortable: true, cell: (r) => <span className="text-slate-600">{r.moduleLabel} · {r.branchId ? (branchNames.get(r.branchId) ?? "—") : "Empresa"}</span> },
    { key: "summary", label: "Ação", cell: (r) => <span>{r.summary}{r.sensitive && <Badge tone="accent" className="ml-2">Ação sensível</Badge>}{r.hasChanges && <Badge tone="info" className="ml-1">antes/depois</Badge>}{r.reason && <span className="block text-xs text-slate-500">Motivo: {r.reason}</span>}</span> },
    { key: "userName", label: "Responsável", sortable: true, cell: (r) => <span>{r.userName ?? "—"}{r.userRole && <span className="block text-xs text-slate-500">{r.userRole}</span>}</span> },
    { key: "action", label: "Código da ação", sortable: true, hidden: true, cell: (r) => <code className="text-xs">{r.action}</code> },
    { key: "entityLabel", label: "Registro", sortable: true, hidden: true, cell: (r) => <span className="text-slate-600">{r.entityLabel}</span> },
    { key: "ip", label: "IP", hidden: true, cell: (r) => r.ip ?? "—" },
    { key: "result", label: "Situação", sortable: true, cell: (r) => <StatusBadge kind="audit" status={r.result} /> },
  ];
  return (
    <>
      <PageHeader
        title="Histórico de atividades e auditoria"
        crumbs={[{ label: "Administração" }, { label: "Histórico" }]}
        badges={<Badge tone="info" title="O histórico não pode ser editado nem excluído"><Lock className="size-3" /> Somente consulta</Badge>}
        description={`Acompanhe acessos, alterações, autorizações e tentativas bloqueadas de ${formatDate(all.period.from)} a ${formatDate(all.period.to)}. Senhas, tokens e chaves são mascarados antes do registro.`}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Eventos no recorte" value={all.length.toLocaleString("pt-BR")} hint={`${formatDate(all.period.from)} – ${formatDate(all.period.to)}`} />
        <Stat label="Bloqueados / falhas" value={failures} tone={failures ? "bad" : "default"} href={link({ result: "failure", page: null })} hint="Tentativas sem permissão, logins recusados e falhas" />
        <Stat label="Usuários distintos" value={distinctUsers} />
        <Stat label="Ações sensíveis" value={all.filter((r) => r.sensitive).length.toLocaleString("pt-BR")} hint={`${withChanges.toLocaleString("pt-BR")} com antes/depois`} href={link({ sensitive: "1", page: null })} />
      </div>
      <FilterBar
        basePath="/administracao/historico"
        values={params}
        filters={[
          { type: "search", placeholder: "Resumo, usuário, motivo ou identificador" },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
          { type: "select", name: "user", label: "Usuário", options: users },
          { type: "select", name: "module", label: "Módulo", options: MODULES.map((m) => ({ value: m.key, label: m.label })) },
          { type: "select", name: "action", label: "Ação", options: all.actions.map((a) => ({ value: a, label: a })) },
          { type: "select", name: "entity", label: "Objeto", options: Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")) },
          { type: "select", name: "branch", label: "Filial", options: branches },
        ]}
      >
        <label className="flex h-9 items-center gap-2 self-end text-sm text-slate-700">
          <input type="checkbox" name="sensitive" value="1" defaultChecked={p.f.sensitive === "1"} className="size-4 accent-brand-700" /> Ações sensíveis
        </label>
        {p.f.result && <input type="hidden" name="result" value={p.f.result} />}
      </FilterBar>
      <div role="tablist" className="no-print mb-3 flex gap-1 border-b border-line">
        {[
          { key: "", label: "Todos", n: all.counts.all },
          { key: "success", label: "Concluídos", n: all.counts.success },
          { key: "failure", label: "Bloqueados / falhas", n: all.counts.failure },
        ].map((t) => (
          <Link key={t.key} role="tab" aria-selected={(p.f.result ?? "") === t.key} href={link({ result: t.key || null, page: null })} className={cn("focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium", (p.f.result ?? "") === t.key ? "border-accent-500 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-700")}>
            {t.label} <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.n.toLocaleString("pt-BR")}</span>
          </Link>
        ))}
      </div>
      <DataTable
        id="admin-audit"
        basePath="/administracao/historico"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="admin.audit"
        dense
        rowHref={(r) => `/administracao/historico/${r.id}`}
        footer={<div className="border-t border-line px-3 py-2 text-xs text-slate-500">Horário de Brasília (UTC−3) · {all.length.toLocaleString("pt-BR")} eventos no recorte</div>}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma atividade registrada no recorte. Amplie o período ou remova filtros.</div>}
      />
    </>
  );
}
