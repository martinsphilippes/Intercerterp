import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { canDo } from "@/lib/permissions";
import { UserForm } from "../../user-form";
import { userFormOptions } from "../../form-data";
import { userRoleIn } from "@/lib/auth/users";

export const metadata = { title: "Editar usuário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "edit");
  if (!canDo(s.user, "admin.users")) redirect("/sem-permissao");
  const { id } = await params;
  const u = await s.ctx.store.get("users", id);
  if (!u || !(u.isAdmin || (u.companyIds ?? []).includes(s.ctx.companyId))) notFound();
  // quem não é administrador não gerencia o cadastro de um administrador
  if (u.isAdmin && !s.user.isAdmin) redirect("/sem-permissao");
  const o = await userFormOptions(s);
  const role = u.isAdmin ? null : await userRoleIn(s.ctx.store, u, s.ctx.companyId);
  // vínculos com empresas/filiais fora do alcance do editor: exibidos e preservados no servidor
  const visibleCompanies = new Set(o.companies.map((c) => c.value));
  const visibleBranches = new Set(o.branches.map((b) => b.value));
  const keptCompanies = (u.companyIds ?? []).filter((c: string) => !visibleCompanies.has(c)).length;
  const keptBranches = (u.branchIds ?? []).filter((b: string) => !visibleBranches.has(b)).length;
  return (
    <>
      <PageHeader title={`Editar ${u.name}`} crumbs={[{ label: "Administração" }, { label: "Usuários", href: "/administracao/usuarios" }, { label: u.name, href: `/administracao/usuarios/${id}` }, { label: "Editar" }]} />
      <UserForm user={{ ...u, roleId: role?.id ?? null }} roles={o.roles} companies={o.companies} branches={o.branches} canGrantAdmin={o.canGrantAdmin} currentCompanyId={s.ctx.companyId} kept={{ companies: keptCompanies, branches: keptBranches }} self={!s.user.isAdmin && u.id === s.user.id} />
    </>
  );
}
