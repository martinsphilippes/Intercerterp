import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { canDo } from "@/lib/permissions";
import { listAll } from "@/lib/db";
import { UserForm } from "../../user-form";
import { canAssignRole, userFormOptions } from "../../form-data";
import { branchScopeOf, userRoleIn } from "@/lib/auth/users";
import { seesPlatformAdmins } from "@/domain/users";

export const metadata = { title: "Editar usuário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "edit");
  if (!canDo(s.user, "admin.users")) redirect("/sem-permissao");
  const { id } = await params;
  const u = await s.ctx.store.get("users", id);
  // multiempresa: só usuários vinculados a esta empresa; o administrador da plataforma não aparece para a empresa contratante
  const platform = await seesPlatformAdmins(s.ctx);
  if (!u || !(u.isAdmin ? platform : (u.companyIds ?? []).includes(s.ctx.companyId))) notFound();
  // quem não é administrador não gerencia o cadastro de um administrador
  if (u.isAdmin && !s.user.isAdmin) redirect("/sem-permissao");
  const o = await userFormOptions(s);
  const role = u.isAdmin ? null : await userRoleIn(s.ctx.store, u, s.ctx.companyId);
  // vínculos com empresas fora do alcance do editor (sem acesso ou sem administrar usuários nelas): contados e preservados no servidor
  const visibleCompanies = new Set(o.companies.map((c) => c.value));
  const keptCompanies = (u.companyIds ?? []).filter((c: string) => !visibleCompanies.has(c)).length;
  // filiais e cargo DESTA empresa
  const here = new Set((await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] })).map((b) => b.id));
  const scope = branchScopeOf(u, s.ctx.companyId);
  const branchScope = scope === null ? null : scope.filter((b) => here.has(b));
  const jobTitle = ((u.jobTitleByCompany ?? {})[s.ctx.companyId] as string | undefined) ?? null;
  // quem já tem acesso acima do editor não tem o perfil trocado por ele
  const roleLocked = !s.user.isAdmin && !(await canAssignRole(s, role));
  return (
    <>
      <PageHeader title={`Editar ${u.name}`} crumbs={[{ label: "Administração" }, { label: "Usuários", href: "/administracao/usuarios" }, { label: u.name, href: `/administracao/usuarios/${id}` }, { label: "Editar" }]} />
      <UserForm
        user={{ ...u, roleId: role?.id ?? null }}
        roles={o.roles}
        companies={o.companies}
        branches={o.branches}
        canGrantAdmin={o.canGrantAdmin}
        currentCompanyId={s.ctx.companyId}
        kept={{ companies: keptCompanies, branches: 0 }}
        self={!s.user.isAdmin && u.id === s.user.id}
        editorRestricted={o.editorRestricted}
        roleLocked={roleLocked}
        branchScope={branchScope}
        jobTitle={jobTitle}
      />
    </>
  );
}
