import Link from "next/link";
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
import { userStats } from "@/domain/users";
import { queryUsers } from "./queries";
import { UserTabs, Avatar } from "./user-tabs";
import { listRoles } from "@/domain/roles";

export const metadata = { title: "Usuários e permissões" };

type Row = Awaited<ReturnType<typeof queryUsers>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const all = await queryUsers(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const [roles, branches, stats] = await Promise.all([lookups.roles(s.ctx), lookups.branches(s.ctx), userStats(s.ctx.store, s.ctx.companyId)]);
  const manage = can(s.user, "admin", "create") && canDo(s.user, "admin.users");
  const manageUsers = can(s.user, "admin", "edit") && canDo(s.user, "admin.users");
  const rolesCount = (await listRoles(s.ctx.store, s.ctx.companyId)).length;
  const accessDetail = (r: Row) =>
    r.status === "suspended" ? "Acesso bloqueado" : r.status === "inactive" ? "Sem acesso" : r.status === "invited" ? (r.invite === "expired" ? "Convite vencido" : "Sem primeiro acesso") : r.lastAccessAt ? formatDateTime(r.lastAccessAt) : "Nunca acessou";
  const columns: Column<Row>[] = [
    {
      key: "name",
      label: "Usuário",
      sortable: true,
      fixed: true,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={r.name} />
          <span className="min-w-0">
            <span className="block">
              {r.name}
              {r.id === s.user.id && <span className="ml-1 text-xs font-normal text-slate-500">(você)</span>}
            </span>
            <span className="block text-xs font-normal text-slate-500">{r.email}{r.login && ` · ${r.login}`}</span>
          </span>
        </span>
      ),
    },
    { key: "roleName", label: "Perfil", sortable: true, cell: (r) => <Badge tone={r.isAdmin ? "brand" : "info"}>{r.isAdmin ? "Administrador" : r.roleName}</Badge> },
    { key: "branchesLabel", label: "Filiais", cell: (r) => <span className="text-slate-600">{r.branchesLabel}</span> },
    { key: "effectiveDiscountBps", label: "Desc. máx.", align: "right", sortable: true, hidden: true, cell: (r) => <span title={`Limite do ${r.discountSource}`}>{(r.effectiveDiscountBps / 100).toLocaleString("pt-BR")}%{r.discountSource === "usuário" && "*"}</span> },
    { key: "lastAccessAt", label: "Acesso", sortable: true, cell: (r) => <span className="flex flex-col items-start gap-0.5"><StatusBadge kind="user" status={r.statusKey} /><span className="text-xs text-slate-500">{accessDetail(r)}</span></span> },
    { key: "firstAccessAt", label: "Primeiro acesso", sortable: true, hidden: true, cell: (r) => formatDateTime(r.firstAccessAt) },
    { key: "inviteExpiresAt", label: "Convite expira", sortable: true, hidden: true, cell: (r) => (r.status === "invited" ? formatDateTime(r.inviteExpiresAt) : "—") },
    { key: "actions", label: "Ações", align: "right", cell: (r) => (manageUsers && (!r.isAdmin || s.user.isAdmin) ? <Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/${r.id}/editar`}>Editar</Link> : <Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/${r.id}`}>Abrir</Link>) },
  ];
  const count = (st: string) => all.filter((u) => u.statusKey === st).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <>
      <PageHeader
        title="Usuários e permissões"
        crumbs={[{ label: "Administração" }, { label: "Usuários" }]}
        description="Defina quem acessa o ERP e o que cada pessoa pode fazer: convites, situação, perfil, filiais e limites."
        actions={
          <>
            {manage && (
              <LinkButton href="/administracao/usuarios/novo" variant="primary">
                <Plus className="size-4" /> Novo usuário
              </LinkButton>
            )}
          </>
        }
      />
      <UserTabs active="usuarios" users={stats.total} roles={rolesCount} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Ativos" value={stats.active} hint={`${stats.admins} administrador(es)`} href="/administracao/usuarios?status=active" />
        <Stat label="Convites pendentes" value={stats.invited} hint={stats.expired ? `${stats.expired} expirado(s)` : "Nenhum expirado"} tone={stats.expired ? "warn" : "default"} href="/administracao/usuarios?status=invited" />
        <Stat label="Suspensos" value={stats.suspended} tone={stats.suspended ? "bad" : "default"} href="/administracao/usuarios?status=suspended" />
        <Stat label="Inativos" value={stats.inactive} href="/administracao/usuarios?status=inactive" />
        <Stat label="Ativos sem nenhum acesso" value={stats.neverAccessed} hint="Nenhum login registrado" href="/administracao/usuarios?access=never" />
      </div>
      <FilterBar
        basePath="/administracao/usuarios"
        values={params}
        filters={[
          { type: "search", placeholder: "Nome, e-mail, login ou telefone" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Ativo" }, { value: "invited", label: "Convite pendente" }, { value: "invite_expired", label: "Convite expirado" }, { value: "suspended", label: "Suspenso" }, { value: "inactive", label: "Inativo" }] },
          { type: "select", name: "role", label: "Perfil", options: roles },
          { type: "select", name: "branch", label: "Filial", options: branches },
          { type: "select", name: "admin", label: "Acesso", options: [{ value: "1", label: "Somente administradores" }] },
        ]}
      />
      <DataTable
        id="admin-users"
        basePath="/administracao/usuarios"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="admin.users"
        rowHref={(r) => `/administracao/usuarios/${r.id}`}
        footer={
          <div className="flex flex-wrap justify-between gap-2 border-t border-line px-3 py-2 text-xs text-slate-500">
            <span>{total} de {stats.total} usuários</span>
            <span>
              {plural(count("active"), "ativo", "ativos")} · {plural(count("invited"), "convite pendente", "convites pendentes")}
              {count("invite_expired") ? ` · ${plural(count("invite_expired"), "convite vencido", "convites vencidos")}` : ""} · {plural(count("suspended"), "suspenso", "suspensos")} · {plural(count("inactive"), "inativo", "inativos")}
            </span>
          </div>
        }
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum usuário no recorte. {manage && <Link className="text-brand-700 underline" href="/administracao/usuarios/novo">Cadastrar usuário</Link>}</div>}
      />
      <p className="mt-2 text-xs text-slate-500">Horários em horário de Brasília (UTC−3). * Coluna opcional “Desc. máx.”: limite próprio do usuário (substitui o do perfil).</p>
    </>
  );
}
