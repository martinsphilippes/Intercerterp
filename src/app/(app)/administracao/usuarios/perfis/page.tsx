import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { MODULES } from "@/lib/permissions";
import { can, canDo } from "@/lib/permissions";
import type { SearchParams } from "@/lib/list";
import { queryRoles } from "../queries";
import { UserTabs } from "../user-tabs";
import { companyUsers } from "@/domain/users";

export const metadata = { title: "Perfis e permissões" };

type Row = Awaited<ReturnType<typeof queryRoles>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const rows = await queryRoles(s.ctx);
  const usersTotal = (await companyUsers(s.ctx.store, s.ctx.companyId)).length;
  const manage = can(s.user, "admin", "create") && canDo(s.user, "admin.users");
  const columns: Column<Row>[] = [
    { key: "name", label: "Perfil", fixed: true, cell: (r) => <span>{r.name}{r.system && <Badge className="ml-2">Sistema</Badge>}{r.active === false && <Badge tone="warn" className="ml-2">Inativo</Badge>}</span> },
    { key: "description", label: "Descrição", cell: (r) => <span className="text-slate-600">{r.description ?? "—"}</span> },
    { key: "modules", label: "Módulos visíveis", align: "right", cell: (r) => `${r.modules} de ${MODULES.length}` },
    { key: "writes", label: "Módulos com alteração", align: "right", cell: (r) => r.writes },
    { key: "actions", label: "Operações específicas", align: "right", cell: (r) => r.actions },
    { key: "discount", label: "Desconto máx.", align: "right", cell: (r) => `${((r.discountLimitBps ?? 0) / 100).toLocaleString("pt-BR")}%` },
    { key: "usersCount", label: "Usuários", align: "right", cell: (r) => (r.usersCount ? <a className="text-brand-700 hover:underline" href={`/administracao/usuarios?role=${r.id}`}>{r.usersCount}</a> : "0") },
  ];
  return (
    <>
      <PageHeader
        title="Usuários e permissões"
        crumbs={[{ label: "Administração" }, { label: "Usuários e permissões", href: "/administracao/usuarios" }, { label: "Perfis" }]}
        description="Cada perfil reúne a matriz visualizar/criar/editar/excluir por módulo, as operações específicas e o limite de desconto."
        actions={manage && <LinkButton href="/administracao/usuarios/perfis/novo" variant="primary"><Plus className="size-4" /> Novo perfil</LinkButton>}
      />
      <UserTabs active="perfis" users={usersTotal} roles={rows.length} />
      <div className="mb-4">
        <Notice tone="info">Perfis de sistema (administrador, gerente, caixa, estoquista, financeiro e fiscal) podem ser ajustados, mas não excluídos. Para variações, abra um perfil e use <b>Duplicar</b>.</Notice>
      </div>
      <DataTable id="admin-roles" basePath="/administracao/usuarios/perfis" params={params} columns={columns} rows={rows} rowHref={(r) => `/administracao/usuarios/perfis/${r.id}`} />
    </>
  );
}
