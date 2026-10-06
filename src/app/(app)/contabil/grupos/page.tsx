import Link from "@/components/ui/link";
import { Layers, Pencil, Plus } from "lucide-react";
import { requireFirmSession } from "../guard";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/empty";
import { normalizeSearch, paginate, parseList, sp, type SearchParams } from "@/lib/list";
import { can, canDo } from "@/lib/permissions";
import { GROUP_KIND, listGroups } from "@/domain/accounting";
import { queryPortfolio } from "../queries";
import { GroupForm, type GroupData } from "./group-form";

export const metadata = { title: "Grupos de clientes" };

const KIND_LABEL: Record<string, string> = Object.fromEntries(GROUP_KIND.map((k) => [k.value, k.label]));
const KIND_OPTIONS = GROUP_KIND.map((k) => ({ value: k.value, label: k.label }));

interface Row extends GroupData {
  kindLabel: string;
  /** clientes da carteira visível que apontam para o grupo */
  clients: number;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireFirmSession();
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const editId = sp(params, "editar").trim();
  const creating = sp(params, "novo") === "1";
  const canCreate = can(s.user, "accounting", "create");
  const canEdit = can(s.user, "accounting", "edit");
  const seesAll = s.user.isAdmin || canDo(s.user, "accounting.all_clients");

  const [groups, portfolio] = await Promise.all([listGroups(s.ctx), queryPortfolio(s.ctx, { q: "", f: {} })]);
  const byGroup = new Map<string, number>();
  for (const c of portfolio) if (c.groupId) byGroup.set(c.groupId, (byGroup.get(c.groupId) ?? 0) + 1);
  const all: Row[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind ?? "other",
    kindLabel: KIND_LABEL[g.kind] ?? KIND_LABEL.other,
    notes: g.notes ?? null,
    active: g.active !== false,
    clients: byGroup.get(g.id) ?? 0,
  }));

  // filtros em memória (a lista de grupos é curta); "editar"/"novo" não são filtros
  const q = normalizeSearch(p.q);
  const kindFilter = p.f.tipo ?? "";
  const activeFilter = p.f.situacao ?? "";
  let rows = all;
  if (q) rows = rows.filter((r) => normalizeSearch(`${r.name} ${r.notes ?? ""}`).includes(q));
  if (kindFilter) rows = rows.filter((r) => r.kind === kindFilter);
  if (activeFilter) rows = rows.filter((r) => (activeFilter === "ativo" ? r.active : !r.active));
  const filtered = Boolean(q || kindFilter || activeFilter);
  const { rows: pageRows, total } = paginate(rows, p);

  const editing = editId ? (all.find((r) => r.id === editId) ?? null) : null;
  const showForm = (creating && canCreate) || (editing && canEdit);
  const grouped = portfolio.filter((c) => c.groupId).length;
  const ungrouped = portfolio.filter((c) => !c.groupId && c.status !== "closed").length;
  const activeCount = all.filter((r) => r.active).length;

  const columns: Column<Row>[] = [
    {
      key: "name", label: "Grupo", sortable: true, fixed: true, className: "min-w-[200px]",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    { key: "kindLabel", label: "Tipo", sortable: true, cell: (r) => r.kindLabel },
    {
      key: "clients", label: "Clientes", sortable: true, align: "right",
      cell: (r) =>
        r.clients ? (
          <span className="whitespace-nowrap">
            <span className="tabular">{r.clients.toLocaleString("pt-BR")}</span>{" "}
            <Link href={`/contabil/clientes?grupo=${r.id}`} className="text-xs text-brand-700 hover:underline">
              ver clientes
            </Link>
          </span>
        ) : (
          <span className="text-xs text-slate-400">Nenhum</span>
        ),
    },
    { key: "active", label: "Situação", sortable: true, cell: (r) => <StatusBadge kind="generic" status={r.active ? "active" : "inactive"} /> },
    {
      key: "notes", label: "Observações", className: "max-w-[320px]",
      cell: (r) => (r.notes ? <span className="block truncate text-slate-600" title={r.notes}>{r.notes}</span> : <span className="text-slate-400">—</span>),
    },
    {
      key: "actions", label: "Ações", fixed: true,
      cell: (r) =>
        canEdit ? (
          <Link href={`/contabil/grupos?editar=${r.id}`} title="Editar grupo" aria-current={r.id === editId ? "true" : undefined} className="inline-flex items-center gap-1 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700 aria-[current=true]:text-brand-700">
            <Pencil className="size-4" aria-hidden /> <span className="text-xs">Editar</span>
          </Link>
        ) : (
          <span className="text-xs text-slate-400">Somente consulta</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Grupos de clientes"
        crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Grupos de clientes" }]}
        description={
          <>
            Agrupe clientes do mesmo grupo econômico, dos mesmos sócios ou de um agrupamento comercial para filtrar a carteira e organizar o atendimento. O grupo de cada cliente é escolhido no cadastro dele.
            {!seesAll && <span className="block text-xs">A contagem de clientes considera apenas os clientes da sua carteira.</span>}
          </>
        }
        actions={
          canCreate && (
            <LinkButton href="/contabil/grupos?novo=1" variant="primary" aria-current={creating ? "true" : undefined}>
              <Plus className="size-4" aria-hidden /> Novo grupo
            </LinkButton>
          )
        }
      />

      <section aria-label="Resumo dos grupos" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Grupos" value={all.length.toLocaleString("pt-BR")} hint={`${activeCount.toLocaleString("pt-BR")} ${activeCount === 1 ? "ativo" : "ativos"}`} href="/contabil/grupos" />
        <Stat label="Grupos inativos" value={(all.length - activeCount).toLocaleString("pt-BR")} hint="Não aparecem para seleção no cadastro" href="/contabil/grupos?situacao=inativo" />
        <Stat label="Clientes em grupos" value={grouped.toLocaleString("pt-BR")} hint={`de ${portfolio.length.toLocaleString("pt-BR")} na carteira`} href="/contabil/clientes" />
        <Stat label="Clientes sem grupo" value={ungrouped.toLocaleString("pt-BR")} hint="Em atividade; defina o grupo no cadastro do cliente" href="/contabil/clientes?grupo=none" tone={ungrouped ? "warn" : "default"} />
      </section>

      {editId && !editing && (
        <div className="mb-4">
          <Notice tone="warn">Grupo não encontrado: pode ter sido removido ou o endereço está incorreto.</Notice>
        </div>
      )}
      {editing && !canEdit && (
        <div className="mb-4">
          <Notice tone="warn">Você não tem permissão para alterar grupos (é preciso “editar” no módulo de Gestão contábil).</Notice>
        </div>
      )}
      {creating && !canCreate && (
        <div className="mb-4">
          <Notice tone="warn">Você não tem permissão para criar grupos (é preciso “criar” no módulo de Gestão contábil).</Notice>
        </div>
      )}
      {showForm && (
        <div className="mb-4">
          <GroupForm key={editing?.id ?? "novo"} group={editing} kinds={KIND_OPTIONS} cancelHref="/contabil/grupos" clientsCount={editing?.clients} />
        </div>
      )}

      <FilterBar
        basePath="/contabil/grupos"
        values={params}
        filters={[
          { type: "search", placeholder: "Nome ou observações" },
          { type: "select", name: "tipo", label: "Tipo", options: KIND_OPTIONS },
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "ativo", label: "Ativos" }, { value: "inativo", label: "Inativos" }], all: "Todas" },
        ]}
      />
      <DataTable
        id="accounting-groups"
        basePath="/contabil/grupos"
        params={params}
        columns={columns}
        rows={pageRows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(r) => (r.clients ? `/contabil/clientes?grupo=${r.id}` : null)}
        empty={
          all.length === 0 ? (
            <EmptyState
              icon={<Layers className="size-10" aria-hidden />}
              title="Nenhum grupo cadastrado"
              description="Crie um grupo para reunir clientes relacionados (grupo econômico, mesmos sócios, agrupamento comercial) e filtrar a carteira por ele."
              action={canCreate && !creating ? <LinkButton href="/contabil/grupos?novo=1" variant="primary"><Plus className="size-4" aria-hidden /> Novo grupo</LinkButton> : undefined}
            />
          ) : (
            <EmptyState title="Nenhum grupo no recorte" description="Ajuste a busca ou os filtros." action={filtered ? <LinkButton href="/contabil/grupos">Limpar filtros</LinkButton> : undefined} />
          )
        }
      />
    </>
  );
}
