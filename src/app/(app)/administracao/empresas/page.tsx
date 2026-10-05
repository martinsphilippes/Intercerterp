import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { paginate, parseList, sp, type SearchParams } from "@/lib/list";
import { formatDoc } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { queryBranches, queryCompanies } from "./queries";

export const metadata = { title: "Empresas e filiais" };

type BRow = Awaited<ReturnType<typeof queryBranches>>[number];
type CRow = Awaited<ReturnType<typeof queryCompanies>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const companyId = s.companies.some((c) => c.id === sp(params, "empresa")) ? sp(params, "empresa") : s.ctx.companyId;
  const p = parseList(params, { pageSize: 50 });
  const allCompanies = (await listAll(s.ctx.store, "companies")).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const company = allCompanies.find((c) => c.id === companyId)!;
  const companyNo = String(allCompanies.findIndex((c) => c.id === companyId) + 1).padStart(2, "0");
  const allUnits = await queryBranches(s, companyId);
  const units = await queryBranches(s, companyId, p);
  const { rows, total } = paginate(units, p);
  const companies = await queryCompanies(s, { q: "", f: {} });
  const initials = (company.tradeName || company.name).split(/\s+/).filter((w: string) => w.length > 2).slice(0, 2).map((w: string) => w[0].toUpperCase()).join("");
  const n = (st: string) => allUnits.filter((u) => u.situation === st).length;
  const base = `/administracao/empresas${companyId !== s.ctx.companyId ? `?empresa=${companyId}` : ""}`;
  const columns: Column<BRow>[] = [
    {
      key: "name",
      label: "Unidade",
      fixed: true,
      cell: (r) => (
        <span>
          {r.name}
          <span className="block text-xs font-normal text-slate-500">
            {r.kind} · código {r.code}
            {r.inUse && " · em uso nesta sessão"}
          </span>
        </span>
      ),
    },
    { key: "cnpj", label: "CNPJ", cell: (r) => (r.cnpj ? formatDoc(r.cnpj) : "—") },
    { key: "city", label: "Cidade / UF", cell: (r) => r.city },
    { key: "managerName", label: "Responsável", hidden: true, cell: (r) => r.managerName ?? "—" },
    { key: "priceTableName", label: "Tabela padrão", hidden: true, cell: (r) => r.priceTableName },
    { key: "warehouseName", label: "Depósito padrão", hidden: true, cell: (r) => r.warehouseName },
    { key: "terminalsCount", label: "Terminais", align: "right", cell: (r) => r.terminalsCount },
    { key: "situation", label: "Situação", cell: (r) => <StatusBadge kind="branch" status={r.situation} /> },
    { key: "action", label: "Ação", align: "right", cell: (r) => <Link className="text-brand-700 hover:underline" href={`/administracao/empresas/filiais/${r.id}`}>Abrir</Link> },
  ];
  const ccols: Column<CRow>[] = [
    { key: "name", label: "Razão social", fixed: true, cell: (r) => <span>{r.name}{r.current && <Badge tone="brand" className="ml-2">Em uso</Badge>}{r.isDemo && <Badge tone="sim" className="ml-2">Demonstração</Badge>}</span> },
    { key: "cnpj", label: "CNPJ", cell: (r) => (r.cnpj ? formatDoc(r.cnpj) : "—") },
    { key: "regimeLabel", label: "Regime", cell: (r) => <span>{r.regimeLabel} <span className="text-xs text-slate-500">CRT {r.crt ?? "—"}</span></span> },
    { key: "city", label: "Município", cell: (r) => r.city },
    { key: "branchesCount", label: "Unidades", align: "right", cell: (r) => r.branchesCount },
    { key: "usersCount", label: "Usuários vinculados", align: "right", cell: (r) => r.usersCount },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="generic" status={r.status ?? "active"} /> },
    { key: "view", label: "Ação", align: "right", cell: (r) => <Link className="text-brand-700 hover:underline" href={`/administracao/empresas?empresa=${r.id}`}>Ver unidades</Link> },
  ];
  return (
    <>
      <PageHeader
        title="Empresas e filiais"
        crumbs={[{ label: "Administração" }, { label: "Empresas e filiais" }]}
        description="Organize a matriz e as unidades de cada empresa. Os dados de cada empresa ficam separados; inativar uma unidade não impede consultar seus movimentos e documentos."
        actions={
          can(s.user, "admin", "create") && (
            <>
              <LinkButton href="/administracao/empresas/nova">
                <Building2 className="size-4" /> Nova empresa
              </LinkButton>
              <LinkButton href={`/administracao/empresas/${companyId}/filiais/nova`} variant="primary">
                <Plus className="size-4" /> Nova filial
              </LinkButton>
            </>
          )
        }
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-800 ring-1 ring-brand-100">{initials || "EM"}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">
              {company.name} <StatusBadge kind="generic" status={company.status ?? "active"} className="ml-1" />
              {company.id === s.ctx.companyId && <Badge tone="brand" className="ml-1">Empresa em uso</Badge>}
            </p>
            <p className="text-xs text-slate-500">
              Empresa {companyNo} · {company.cnpj ? `CNPJ ${formatDoc(company.cnpj)} · ` : ""}
              {allUnits.length} unidade(s) cadastrada(s)
            </p>
          </div>
          {s.companies.length > 1 && (
            <form method="get" action="/administracao/empresas" className="flex items-center gap-2">
              <label className="text-xs text-slate-500" htmlFor="empresa">Empresa</label>
              <select id="empresa" name="empresa" defaultValue={companyId} className="h-9 rounded-md border border-line bg-white px-2 text-sm">
                {s.companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.tradeName || c.name}</option>
                ))}
              </select>
              <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-slate-50" type="submit">Ver</button>
            </form>
          )}
          <Link href={`/administracao/empresas/${companyId}`} className="text-sm font-medium text-brand-700 hover:underline">Abrir empresa</Link>
          {can(s.user, "admin", "edit") && <Link href={`/administracao/empresas/${companyId}/editar`} className="text-sm font-medium text-brand-700 hover:underline">Editar empresa</Link>}
        </div>
      </Card>
      <FilterBar
        basePath="/administracao/empresas"
        values={params}
        filters={[
          { type: "search", placeholder: "Nome, cidade ou CNPJ da unidade" },
          { type: "select", name: "status", label: "Situação no ERP", options: [{ value: "active", label: "Ativa" }, { value: "implementation", label: "Em implantação (fiscal pendente)" }, { value: "inactive", label: "Inativa" }] },
        ]}
      >
        {companyId !== s.ctx.companyId && <input type="hidden" name="empresa" value={companyId} />}
      </FilterBar>
      <DataTable
        id="admin-branches"
        basePath="/administracao/empresas"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="admin.branches"
        rowHref={(r) => `/administracao/empresas/filiais/${r.id}`}
        footer={
          <div className="flex flex-wrap justify-between gap-2 border-t border-line px-3 py-2 text-xs text-slate-500">
            <span>{total} de {allUnits.length} unidades</span>
            <span>{n("active")} ativa(s) · {n("implementation")} em implantação · {n("inactive")} inativa(s)</span>
          </div>
        }
      />
      <p className="mb-6 mt-2 text-xs text-slate-500">“Em implantação”: unidade ativa ainda sem configuração fiscal (emissão de documentos indisponível). <Link className="text-brand-700 hover:underline" href={base.includes("?") ? `${base}&status=implementation` : `${base}?status=implementation`}>Ver unidades em implantação</Link></p>
      {(companies.length > 1 || s.user.isAdmin) && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink">Empresas</h2>
          <DataTable id="admin-companies" basePath="/administracao/empresas" columns={ccols} rows={companies} exportKey="admin.companies" rowHref={(r) => `/administracao/empresas/${r.id}`} />
        </>
      )}
    </>
  );
}
