import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { canDo } from "@/lib/permissions";
import { UserForm } from "../../user-form";
import { userFormOptions } from "../../form-data";

export const metadata = { title: "Editar usuário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "edit");
  if (!canDo(s.user, "admin.users")) redirect("/sem-permissao");
  const { id } = await params;
  const u = await s.ctx.store.get("users", id);
  if (!u || !(u.isAdmin || (u.companyIds ?? []).includes(s.ctx.companyId))) notFound();
  const o = await userFormOptions(s);
  return (
    <>
      <PageHeader title={`Editar ${u.name}`} crumbs={[{ label: "Administração" }, { label: "Usuários", href: "/administracao/usuarios" }, { label: u.name, href: `/administracao/usuarios/${id}` }, { label: "Editar" }]} />
      <UserForm user={u} roles={o.roles} companies={o.companies} branches={o.branches} canGrantAdmin={o.canGrantAdmin} currentCompanyId={s.ctx.companyId} />
    </>
  );
}
