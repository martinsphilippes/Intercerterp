import { requireSession } from "@/lib/server/session";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { canDo } from "@/lib/permissions";
import { UserForm } from "../user-form";
import { userFormOptions } from "../form-data";

export const metadata = { title: "Novo usuário" };

export default async function Page() {
  const s = await requireSession("admin", "create");
  if (!canDo(s.user, "admin.users")) redirect("/sem-permissao");
  const o = await userFormOptions(s);
  return (
    <>
      <PageHeader title="Novo usuário" crumbs={[{ label: "Administração" }, { label: "Usuários", href: "/administracao/usuarios" }, { label: "Novo" }]} description="Crie o acesso com senha inicial ou envie um convite de primeiro acesso com validade." />
      <UserForm roles={o.roles} companies={o.companies} branches={o.branches} canGrantAdmin={o.canGrantAdmin} currentCompanyId={s.ctx.companyId} />
    </>
  );
}
