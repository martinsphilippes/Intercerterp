import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { canDo } from "@/lib/permissions";
import { companyUsers } from "@/domain/users";
import { RoleForm } from "../role-form";
import { roleFormOptions } from "../role-options";
import { RoleList } from "../role-list";
import { UserTabs } from "../../user-tabs";
import { queryRoles } from "../../queries";

export const metadata = { title: "Novo perfil" };

export default async function Page() {
  const s = await requireSession("admin", "create");
  if (!canDo(s.user, "admin.users")) redirect("/sem-permissao");
  const [roles, users] = await Promise.all([queryRoles(s.ctx), companyUsers(s.ctx.store, s.ctx.companyId)]);
  return (
    <>
      <PageHeader title="Usuários e permissões" crumbs={[{ label: "Administração" }, { label: "Usuários e permissões", href: "/administracao/usuarios" }, { label: "Novo perfil" }]} description="Defina o que o perfil pode ver e alterar em cada módulo e quais operações sensíveis pode executar. Para partir de um perfil existente, abra-o e use “Duplicar perfil”." />
      <UserTabs active="perfis" users={users.length} roles={roles.length} />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <RoleList roles={roles} activeId="novo" canCreate />
        <div className="min-w-0">
          <h2 className="mb-3 text-lg font-semibold">Novo perfil</h2>
          <RoleForm {...roleFormOptions} />
        </div>
      </div>
    </>
  );
}
