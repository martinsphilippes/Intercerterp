import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUS } from "@/domain/support";
import { ticketsFor } from "./queries";

export const metadata = { title: "Chamados" };

type Row = Awaited<ReturnType<typeof ticketsFor>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("support");
  const params = await searchParams;
  const p = parseList(params, { sort: "lastMessageAt", dir: "desc" });
  const all = await ticketsFor(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const agent = canDo(s.user, "support.manage");
  const users = await lookups.users(s.ctx);
  const uname = new Map(users.map((u) => [u.value, u.label]));
  const columns: Column<Row>[] = [
    { key: "number", label: "Nº", sortable: true, fixed: true, cell: (r) => <span>{r.isPublic ? `P-${r.number}` : r.number}</span> },
    { key: "subject", label: "Assunto", sortable: true, cell: (r) => <span>{r.subject}{r.isPublic && <Badge tone="warn" className="ml-2">Tela de login</Badge>}</span> },
    { key: "requester", label: "Solicitante", sortable: true, cell: (r) => r.requester },
    { key: "category", label: "Categoria", cell: (r) => TICKET_CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category },
    { key: "priority", label: "Prioridade", sortable: true, cell: (r) => <StatusBadge kind="priority" status={r.priority} /> },
    { key: "assigneeId", label: "Responsável", hidden: !agent, cell: (r) => (r.assigneeId ? (uname.get(r.assigneeId) ?? "—") : <span className="text-amber-700">Sem responsável</span>) },
    { key: "createdAt", label: "Aberto em", sortable: true, hidden: true, cell: (r) => formatDateTime(r.createdAt) },
    { key: "lastMessageAt", label: "Última movimentação", sortable: true, cell: (r) => formatDateTime(r.lastMessageAt) },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="ticket" status={r.status} /> },
  ];
  const open = all.filter((t) => ["open", "in_progress", "waiting"].includes(t.status));
  return (
    <>
      <PageHeader
        title={agent ? "Atendimento de chamados" : "Meus chamados"}
        crumbs={[{ label: "Ajuda", href: "/ajuda" }, { label: "Chamados" }]}
        description={agent ? "Fila de atendimento: chamados da empresa e solicitações públicas feitas na tela de login." : "Acompanhe suas solicitações e responda ao suporte."}
        actions={can(s.user, "support", "create") && <LinkButton href="/ajuda/chamados/novo" variant="accent"><Plus className="size-4" /> Novo chamado</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Em andamento" value={open.length} href="/ajuda/chamados?status=active" />
        <Stat label="Aguardando usuário" value={all.filter((t) => t.status === "waiting").length} href="/ajuda/chamados?status=waiting" />
        {agent ? <Stat label="Sem responsável" value={open.filter((t) => !t.assigneeId).length} tone={open.some((t) => !t.assigneeId) ? "warn" : "default"} href="/ajuda/chamados?status=active&assignee=none" /> : <Stat label="Resolvidos" value={all.filter((t) => t.status === "resolved").length} href="/ajuda/chamados?status=resolved" />}
        {agent ? <Stat label="Públicos (tela de login)" value={all.filter((t) => t.isPublic && ["open", "in_progress", "waiting"].includes(t.status)).length} href="/ajuda/chamados?scope=public&status=active" /> : <Stat label="Total" value={all.length} />}
      </div>
      <FilterBar
        basePath="/ajuda/chamados"
        values={params}
        filters={[
          { type: "search", placeholder: "Número, assunto ou solicitante" },
          ...(agent ? [{ type: "select" as const, name: "scope", label: "Origem", all: "Empresa + públicos", options: [{ value: "company", label: "Somente da empresa" }, { value: "public", label: "Tela de login (públicos)" }, { value: "mine", label: "Abertos por mim" }] }] : []),
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Em andamento (abertos)" }, ...TICKET_STATUS] },
          { type: "select", name: "category", label: "Categoria", options: TICKET_CATEGORIES },
          { type: "select", name: "priority", label: "Prioridade", options: TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label.split(" —")[0] })) },
          ...(agent ? [{ type: "select" as const, name: "assignee", label: "Responsável", options: [{ value: "me", label: "Comigo" }, { value: "none", label: "Sem responsável" }] }] : []),
        ]}
      />
      <DataTable id="support-tickets" basePath="/ajuda/chamados" params={params} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey="support.tickets" rowHref={(r) => `/ajuda/chamados/${r.id}`} />
    </>
  );
}
