import Link from "@/components/ui/link";
import { Eye, Pencil, Plus } from "lucide-react";
import { requireFirmSession } from "../guard";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMonth } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { REGIMES } from "@/domain/companies";
import { CLIENT_STATUS, SERVICE_CATALOG, LINK_STATUS_LABEL } from "@/domain/accounting";
import { queryPortfolio, portfolioRefs, linkedSummaries, type PortfolioRow } from "../queries";

export const metadata = { title: "Clientes contábeis" };

type Summary = Awaited<ReturnType<typeof linkedSummaries>> extends Map<string, infer V> ? V : never;

/** O último pacote vem como "início:fim" (datas do período) — mostra o mês do início. */
function packageLabel(p: string): string {
  const m = /^(\d{4}-\d{2})-\d{2}/.exec(p);
  return m ? formatMonth(m[1]) : p;
}

function ErpCell({ row, summary }: { row: PortfolioRow; summary?: Summary }) {
  if (!row.linked) return <span className="text-slate-400">—</span>;
  if (!summary) return <span className="text-xs text-slate-500">Sem leitura disponível</span>;
  const certTone = summary.certificateDaysLeft == null ? null : summary.certificateDaysLeft <= 0 ? "bad" : summary.certificateDaysLeft <= 30 ? "warn" : "neutral";
  const calm = !summary.lateObligations && !summary.dueSoon && !summary.stuckDocs && !summary.pending && (certTone === null || certTone === "neutral");
  return (
    <span className="flex flex-wrap gap-1">
      {summary.lateObligations > 0 && <Badge tone="bad" title="Obrigações fiscais atrasadas na empresa">{summary.lateObligations} atrasada{summary.lateObligations === 1 ? "" : "s"}</Badge>}
      {summary.dueSoon > 0 && <Badge tone="warn" title="Obrigações que vencem em breve">{summary.dueSoon} a vencer</Badge>}
      {summary.pending > 0 && <Badge tone="warn" title="Documentos fiscais pendentes ou rejeitados nos últimos meses">{summary.pending} doc. pendente{summary.pending === 1 ? "" : "s"}</Badge>}
      {summary.stuckDocs > 0 && <Badge tone="bad" title="Documentos presos na fila de envio">{summary.stuckDocs} na fila</Badge>}
      {certTone && <Badge tone={certTone} title="Certificado digital da empresa">{summary.certificateDaysLeft! <= 0 ? "Certificado vencido" : `Certificado: ${summary.certificateDaysLeft} dias`}</Badge>}
      {summary.lastPackage ? <Badge tone="info" title="Último pacote mensal de XMLs recebido">Pacote {packageLabel(summary.lastPackage)}</Badge> : <Badge title="Nenhum pacote mensal recebido ainda">Sem pacote</Badge>}
      {calm && <Badge tone="good">Em dia</Badge>}
    </span>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireFirmSession();
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const [all, refs] = await Promise.all([queryPortfolio(s.ctx, p), portfolioRefs(s.ctx)]);
  const { rows, total } = paginate(all, p);
  // resumo da empresa vinculada só para as linhas da página atual (leitura somente-consulta, uma por cliente)
  const summaries = await linkedSummaries(s.ctx, rows.filter((r) => r.linked).map((r) => r.id));
  const filtered = Boolean(p.q) || Object.keys(p.f).length > 0;
  const portfolio = filtered ? await queryPortfolio(s.ctx, { q: "", f: {} }) : all;
  const count = (fn: (r: PortfolioRow) => boolean) => portfolio.filter(fn).length;
  const canCreate = can(s.user, "accounting", "create");
  const canEdit = can(s.user, "accounting", "edit");
  const seesAll = canDo(s.user, "accounting.all_clients");

  const columns: Column<PortfolioRow>[] = [
    { key: "code", label: "Código", sortable: true, fixed: true, cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    {
      key: "name", label: "Cliente", sortable: true, fixed: true, className: "min-w-[220px]",
      cell: (r) => (
        <span className="block">
          <span className="font-medium text-ink">{r.name}</span>
          {r.tradeName && r.tradeName !== r.name && <span className="block text-xs font-normal text-slate-500">{r.tradeName}</span>}
        </span>
      ),
    },
    { key: "doc", label: "CPF/CNPJ", cell: (r) => (r.doc ? <span className="tabular whitespace-nowrap">{formatDoc(r.doc)}</span> : <span className="text-slate-400">—</span>) },
    { key: "personType", label: "Tipo", hidden: true, cell: (r) => (r.personType === "PF" ? "Pessoa física" : "Pessoa jurídica") },
    { key: "regimeLabel", label: "Regime", sortable: true, cell: (r) => r.regimeLabel },
    { key: "servicesLabel", label: "Serviços", className: "max-w-[260px]", cell: (r) => (r.servicesLabel ? <span className="text-slate-600">{r.servicesLabel}</span> : <span className="text-slate-400">—</span>) },
    {
      key: "responsibleName", label: "Responsável", sortable: true,
      cell: (r) => r.responsibleName ?? (r.assignmentsCount ? <span className="text-xs text-slate-500">{r.assignmentsCount} por departamento</span> : <span className="text-xs text-amber-700">Sem responsável</span>),
    },
    { key: "groupName", label: "Grupo", sortable: true, cell: (r) => r.groupName ?? <span className="text-slate-400">—</span> },
    { key: "city", label: "Cidade", hidden: true, cell: (r) => r.city },
    { key: "linkStatus", label: "Vínculo", cell: (r) => <StatusBadge kind="link" status={r.linkStatus ?? "none"} /> },
    { key: "erp", label: "Situação fiscal (ERP)", className: "min-w-[200px]", cell: (r) => <ErpCell row={r} summary={summaries.get(r.id)} /> },
    { key: "status", label: "Situação", sortable: true, cell: (r) => <StatusBadge kind="accounting_client" status={r.status} /> },
    {
      key: "actions", label: "Ações", fixed: true,
      cell: (r) => (
        <span className="flex items-center gap-1">
          <Link href={`/contabil/clientes/${r.id}`} title="Abrir" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Eye className="size-4" /></Link>
          {canEdit && <Link href={`/contabil/clientes/${r.id}/editar`} title="Editar cadastro" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="size-4" /></Link>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clientes contábeis"
        crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Clientes" }]}
        description={seesAll ? "Carteira do escritório: cadastro próprio de cada cliente (PF ou PJ), serviços contratados, responsáveis e vínculo com a empresa que usa o ERP." : "Clientes da sua carteira (aqueles em que você é responsável ou substituto). Para ver toda a carteira é preciso a permissão “Ver toda a carteira de clientes”."}
        actions={canCreate && <LinkButton href="/contabil/clientes/novo" variant="primary"><Plus className="size-4" /> Novo cliente</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clientes na carteira" value={portfolio.length.toLocaleString("pt-BR")} hint={`${count((r) => r.personType === "PJ")} PJ · ${count((r) => r.personType === "PF")} PF`} href="/contabil/clientes" />
        <Stat label="Ativos" value={count((r) => r.status === "active").toLocaleString("pt-BR")} hint="Atendimento em andamento" href="/contabil/clientes?status=active" />
        <Stat label="Em implantação" value={count((r) => r.status === "onboarding").toLocaleString("pt-BR")} hint="Entrando no escritório" href="/contabil/clientes?status=onboarding" tone={count((r) => r.status === "onboarding") ? "warn" : "default"} />
        <Stat label="Vinculados ao ERP" value={count((r) => r.linked).toLocaleString("pt-BR")} hint={`${count((r) => r.linkStatus === "pending")} aguardando a empresa aceitar o código`} href="/contabil/clientes?vinculo=active" />
      </div>
      <FilterBar
        basePath="/contabil/clientes"
        values={params}
        filters={[
          { type: "search", placeholder: "Nome, razão social, fantasia, CPF/CNPJ ou etiqueta" },
          { type: "select", name: "status", label: "Situação", options: CLIENT_STATUS.map((x) => ({ value: x.value, label: x.label })) },
          { type: "select", name: "personType", label: "Tipo", options: [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }] },
          { type: "select", name: "regime", label: "Regime", options: REGIMES.map((r) => ({ value: r.value, label: r.label })) },
          { type: "select", name: "servico", label: "Serviço", options: SERVICE_CATALOG.map((x) => ({ value: x.key, label: x.label })) },
          { type: "select", name: "responsavel", label: "Responsável", options: [{ value: "none", label: "Sem responsável" }, ...refs.users] },
          { type: "select", name: "grupo", label: "Grupo", options: [{ value: "none", label: "Sem grupo" }, ...refs.groups] },
          { type: "select", name: "departamento", label: "Departamento", options: refs.departments },
          { type: "select", name: "vinculo", label: "Vínculo com o ERP", options: Object.entries(LINK_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
        ]}
      />
      <DataTable
        id="accounting-clients"
        basePath="/contabil/clientes"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey={canDo(s.user, "data.export") ? "accounting_clients" : undefined}
        rowHref={(r) => `/contabil/clientes/${r.id}`}
        empty={
          <EmptyState
            title={filtered ? "Nenhum cliente no recorte" : "A carteira ainda está vazia"}
            description={filtered ? "Ajuste os filtros ou limpe a busca." : seesAll ? "Cadastre o primeiro cliente do escritório. Para pessoa jurídica, a consulta do CNPJ preenche o cadastro com os dados públicos da Receita." : "Nenhum cliente foi atribuído a você ainda."}
            action={canCreate && !filtered ? <LinkButton href="/contabil/clientes/novo" variant="primary"><Plus className="size-4" /> Novo cliente</LinkButton> : filtered ? <LinkButton href="/contabil/clientes">Limpar filtros</LinkButton> : undefined}
          />
        }
      />
    </>
  );
}
