import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatDoc } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { queryCompanies } from "./queries";

export const metadata = { title: "Empresas e filiais" };

type Row = Awaited<ReturnType<typeof queryCompanies>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const all = await queryCompanies(s, p);
  const { rows, total } = paginate(all, p);
  const columns: Column<Row>[] = [
    { key: "name", label: "Razão social", sortable: true, fixed: true, cell: (r) => <span>{r.name}{r.current && <Badge tone="brand" className="ml-2">Em uso</Badge>}{r.isDemo && <Badge tone="sim" className="ml-2">Demonstração</Badge>}</span> },
    { key: "tradeName", label: "Nome fantasia", sortable: true, cell: (r) => r.tradeName ?? "—" },
    { key: "cnpj", label: "CNPJ", cell: (r) => (r.cnpj ? formatDoc(r.cnpj) : "—") },
    { key: "regimeLabel", label: "Regime", sortable: true, cell: (r) => <span>{r.regimeLabel} <span className="text-xs text-slate-500">CRT {r.crt ?? "—"}</span></span> },
    { key: "city", label: "Município", cell: (r) => r.city },
    { key: "branchesCount", label: "Filiais", align: "right", sortable: true, cell: (r) => (r.activeBranches === r.branchesCount ? r.branchesCount : `${r.activeBranches} ativas de ${r.branchesCount}`) },
    { key: "terminalsCount", label: "Terminais", align: "right", sortable: true, hidden: true, cell: (r) => r.terminalsCount },
    { key: "usersCount", label: "Usuários vinculados", align: "right", sortable: true, cell: (r) => r.usersCount },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status ?? "active"} /> },
  ];
  return (
    <>
      <PageHeader
        title="Empresas e filiais"
        crumbs={[{ label: "Administração" }, { label: "Empresas" }]}
        description="Identificação, dados fiscais, filiais e vínculos de usuários. Alterações cadastrais não alteram documentos já emitidos."
        actions={can(s.user, "admin", "create") && <LinkButton href="/administracao/empresas/nova" variant="primary"><Plus className="size-4" /> Nova empresa</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Empresas" value={all.length} hint={`${all.filter((c) => (c.status ?? "active") === "active").length} ativas`} />
        <Stat label="Filiais" value={all.reduce((a, c) => a + c.branchesCount, 0)} hint={`${all.reduce((a, c) => a + c.activeBranches, 0)} ativas`} />
        <Stat label="Terminais ativos" value={all.reduce((a, c) => a + c.terminalsCount, 0)} href="/administracao/terminais" />
        <Stat label="Empresa em uso" value={s.company.tradeName || s.company.name} href={`/administracao/empresas/${s.ctx.companyId}`} />
      </div>
      <FilterBar
        basePath="/administracao/empresas"
        values={params}
        filters={[
          { type: "search", placeholder: "Razão social, fantasia ou CNPJ" },
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Ativa" }, { value: "inactive", label: "Inativa" }] },
        ]}
      />
      <DataTable id="admin-companies" basePath="/administracao/empresas" params={params} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey="admin.companies" rowHref={(r) => `/administracao/empresas/${r.id}`} />
    </>
  );
}
