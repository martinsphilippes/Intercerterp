import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState } from "@/components/ui/empty";
import { can, canDo } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { roleUsers } from "@/domain/roles";
import { companyUsers, inviteState } from "@/domain/users";
import { RoleForm } from "../role-form";
import { roleFormOptions } from "../role-options";
import { RoleList } from "../role-list";
import { UserTabs } from "../../user-tabs";
import { queryRoles } from "../../queries";
import { duplicateRoleAction, deleteRoleAction } from "../../actions";

export const metadata = { title: "Perfil" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { tab = "permissoes" } = await searchParams;
  const role = await s.ctx.store.get("roles", id);
  if (!role || role.companyId !== s.ctx.companyId) notFound();
  const [users, roles, usersTotal] = await Promise.all([roleUsers(s.ctx.store, id), queryRoles(s.ctx), companyUsers(s.ctx.store, s.ctx.companyId)]);
  const manage = canDo(s.user, "admin.users");
  const base = `/administracao/usuarios/perfis/${id}`;
  return (
    <>
      <PageHeader
        title="Usuários e permissões"
        crumbs={[{ label: "Administração" }, { label: "Usuários e permissões", href: "/administracao/usuarios" }, { label: "Perfis", href: "/administracao/usuarios/perfis" }, { label: role.name }]}
        description="Revise o alcance das ações de cada perfil: matriz por módulo, operações sensíveis e limite de desconto."
        actions={
          <>
            {manage && can(s.user, "admin", "create") && <ActionButton action={duplicateRoleAction.bind(null, id)} label="Duplicar perfil" />}
            {manage && can(s.user, "admin", "delete") && !role.system && users.length === 0 && <ActionButton action={deleteRoleAction.bind(null, id)} label="Excluir" variant="danger" confirm="Excluir este perfil?" />}
          </>
        }
      />
      <UserTabs active="perfis" users={usersTotal.length} roles={roles.length} />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <RoleList roles={roles} activeId={id} canCreate={manage && can(s.user, "admin", "create")} />
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Perfil: {role.name}</h2>
            {role.system && <Badge>Perfil de sistema</Badge>}
            {role.active === false && <Badge tone="warn">Inativo</Badge>}
            {role.description && <span className="basis-full text-sm text-slate-500">{role.description} · permissões compartilhadas por todos os usuários do perfil</span>}
          </div>
          <LinkTabs
            basePath={base}
            active={tab}
            tabs={[
              { key: "permissoes", label: "Permissões" },
              { key: "usuarios", label: "Usuários", count: users.length },
              { key: "historico", label: "Histórico" },
            ]}
          />
          {tab === "permissoes" && <RoleForm key={role.updatedAt} role={role} {...roleFormOptions} usersCount={users.length} readOnly={!manage || !can(s.user, "admin", "edit")} />}
          {tab === "usuarios" && (
            <Card bodyClass="p-0">
              {users.length === 0 ? (
                <EmptyState title="Nenhum usuário com este perfil" />
              ) : (
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr><th>Usuário</th><th>E-mail</th><th>Situação</th><th>Último acesso</th></tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td><Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/${u.id}`}>{u.name}</Link></td>
                        <td>{u.email}</td>
                        <td><StatusBadge kind="user" status={inviteState(u) === "expired" ? "invite_expired" : u.status} /></td>
                        <td>{formatDateTime(u.lastAccessAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
          {tab === "historico" && (
            <Card title="Alterações do perfil (antes/depois no histórico de auditoria)">
              <Timeline store={s.ctx.store} refs={[`role:${id}`]} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
