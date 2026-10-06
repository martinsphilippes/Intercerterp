import Link from "@/components/ui/link";
import { ShieldCheck, Users } from "lucide-react";
import { requireFirmSession } from "../guard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { listAll } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { DEPARTMENT_KIND, listDepartments, listDepartmentMembers } from "@/domain/accounting";
import { portfolioRefs, queryPortfolio } from "../queries";
import { DepartmentForm, type DepartmentData } from "./department-form";
import { MemberForm, RemoveMemberForm } from "./member-form";

export const metadata = { title: "Departamentos e equipe" };

const KIND_LABEL: Record<string, string> = Object.fromEntries(DEPARTMENT_KIND.map((k) => [k.value, k.label]));
const KIND_OPTIONS = DEPARTMENT_KIND.map((k) => ({ value: k.value, label: k.label }));
const ROLE_LABEL: Record<string, string> = { manager: "Gestor", member: "Membro" };

/** "1 cliente" / "3 clientes" */
const n = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;

interface Member {
  id: string;
  userId: string;
  name: string;
  role: "manager" | "member";
  /** usuário ainda ativo no escritório */
  userActive: boolean;
}

interface WorkRow {
  id: string;
  name: string;
  userActive: boolean;
  departments: string;
  responsible: number;
  titular: number;
  substituto: number;
  clients: number;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireFirmSession();
  const params = await searchParams;
  const p = parseList(params, { sort: "name", dir: "asc" });
  const canManage = canDo(s.user, "accounting.manage_team");
  const seesAll = s.user.isAdmin || canDo(s.user, "accounting.all_clients");

  const [departments, members, refs, assignments, portfolio] = await Promise.all([
    listDepartments(s.ctx),
    listDepartmentMembers(s.ctx),
    portfolioRefs(s.ctx),
    listAll(s.ctx.store, "accounting_client_assignments", { filters: [["eq", "companyId", s.ctx.companyId]] }),
    queryPortfolio(s.ctx, { q: "", f: {} }),
  ]);

  // contagens sobre clientes em atividade da carteira visível (mesma regra das demais telas da área)
  const working = portfolio.filter((c) => c.status !== "closed");
  const workingIds = new Set(working.map((c) => c.id));
  const activeAssignments = assignments.filter((a) => a.active !== false && workingIds.has(a.clientId));
  // por departamento conta-se exatamente o que o link "ver clientes" (/contabil/clientes?departamento=) lista:
  // clientes visíveis com atribuição ativa no departamento, em qualquer situação (encerrar um cliente não encerra atribuições)
  const visibleIds = new Set(portfolio.map((c) => c.id));
  const visibleAssignments = assignments.filter((a) => a.active !== false && visibleIds.has(a.clientId));
  const activeUserIds = new Set(refs.users.map((u) => u.value));
  const userName = (id: string) => refs.userName.get(id) ?? "Usuário removido";

  const deps = departments.map((d) => {
    const ms: Member[] = members
      .filter((m) => m.departmentId === d.id)
      .map((m) => ({ id: m.id, userId: m.userId, name: userName(m.userId), role: m.role === "manager" ? ("manager" as const) : ("member" as const), userActive: activeUserIds.has(m.userId) }))
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, "pt-BR") : a.role === "manager" ? -1 : 1));
    const data: DepartmentData = { id: d.id, name: d.name, kind: d.kind ?? "custom", key: d.key ?? null, managerUserId: d.managerUserId ?? null, active: d.active !== false };
    return {
      ...data,
      kindLabel: KIND_LABEL[data.kind] ?? KIND_LABEL.custom,
      managerName: data.managerUserId ? userName(data.managerUserId) : null,
      managerActive: data.managerUserId ? activeUserIds.has(data.managerUserId) : true,
      members: ms,
      clients: new Set(visibleAssignments.filter((a) => a.departmentId === d.id).map((a) => a.clientId)).size,
    };
  });

  // carteira por colaborador: usuários ativos do escritório + quem ainda aparece em atribuições/departamentos
  const userIds = new Set<string>(refs.users.map((u) => u.value));
  for (const a of activeAssignments) userIds.add(a.userId);
  for (const c of working) if (c.responsibleUserId) userIds.add(c.responsibleUserId);
  for (const m of members) userIds.add(m.userId);
  for (const d of departments) if (d.managerUserId) userIds.add(d.managerUserId);
  const workRows: WorkRow[] = [...userIds].map((id) => {
    const mine = activeAssignments.filter((a) => a.userId === id);
    const resp = working.filter((c) => c.responsibleUserId === id);
    const depLabels = new Map<string, string>();
    for (const d of departments) if (d.managerUserId === id) depLabels.set(d.id, `${d.name} (gestor)`);
    for (const m of members) {
      if (m.userId !== id) continue;
      const d = departments.find((x) => x.id === m.departmentId);
      if (d && !depLabels.has(d.id)) depLabels.set(d.id, m.role === "manager" ? `${d.name} (gestor)` : d.name);
    }
    return {
      id,
      name: userName(id),
      userActive: activeUserIds.has(id),
      departments: [...depLabels.values()].join(", "),
      responsible: resp.length,
      titular: mine.filter((a) => a.role === "titular").length,
      substituto: mine.filter((a) => a.role !== "titular").length,
      clients: new Set([...mine.map((a) => a.clientId), ...resp.map((c) => c.id)]).size,
    };
  });
  const { rows: pageRows, total } = paginate(workRows, p);

  const assignedClients = new Set(activeAssignments.map((a) => a.clientId)).size;
  const withoutResponsible = working.filter((c) => !c.responsibleUserId && !activeAssignments.some((a) => a.clientId === c.id)).length;
  const activeDeps = deps.filter((d) => d.active).length;

  const columns: Column<WorkRow>[] = [
    {
      key: "name", label: "Colaborador", sortable: true, fixed: true, className: "min-w-[180px]",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-ink">{r.name}</span>
          {!r.userActive && <Badge tone="warn" title="Usuário inativo ou sem acesso ao escritório: redistribua a carteira dele">usuário inativo</Badge>}
        </span>
      ),
    },
    { key: "departments", label: "Departamentos", cell: (r) => (r.departments ? <span className="text-slate-600">{r.departments}</span> : <span className="text-slate-400">—</span>) },
    { key: "responsible", label: "Responsável geral", sortable: true, align: "right", cell: (r) => r.responsible.toLocaleString("pt-BR") },
    { key: "titular", label: "Titular", sortable: true, align: "right", cell: (r) => r.titular.toLocaleString("pt-BR") },
    { key: "substituto", label: "Substituto", sortable: true, align: "right", cell: (r) => r.substituto.toLocaleString("pt-BR") },
    {
      key: "clients", label: "Clientes distintos", sortable: true, align: "right",
      cell: (r) =>
        r.clients ? (
          <Link href={`/contabil/clientes?responsavel=${r.id}`} className="text-brand-700 hover:underline" title="Abre a carteira em que o colaborador é responsável geral, titular ou substituto">
            {r.clients.toLocaleString("pt-BR")}
          </Link>
        ) : (
          <span className="text-slate-400">0</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Departamentos e equipe"
        crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Departamentos e equipe" }]}
        description={
          <>
            Departamentos do escritório, quem faz parte de cada um e a carteira de cada colaborador. Os responsáveis por cliente (titular e substituto) são definidos na página de cada cliente.
            {!canManage && <span className="block text-xs">Somente consulta: para criar departamentos ou mexer na equipe é preciso a permissão “Gerir departamentos e responsáveis da carteira”.</span>}
            {!seesAll && <span className="block text-xs">As contagens consideram apenas os clientes da sua carteira.</span>}
          </>
        }
        actions={canManage && <DepartmentForm kinds={KIND_OPTIONS} users={refs.users} />}
      />

      <section aria-label="Resumo da equipe" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Departamentos ativos" value={activeDeps.toLocaleString("pt-BR")} hint={deps.length - activeDeps ? n(deps.length - activeDeps, "inativo", "inativos") : "Todos em uso"} href="#departamentos" />
        <Stat label="Colaboradores" value={refs.users.length.toLocaleString("pt-BR")} hint="Usuários ativos do escritório" href="#carteira" />
        <Stat label="Clientes com atribuição" value={assignedClients.toLocaleString("pt-BR")} hint={`de ${n(working.length, "cliente em atividade", "clientes em atividade")}`} href="/contabil/clientes" />
        <Stat label="Clientes sem responsável" value={withoutResponsible.toLocaleString("pt-BR")} hint="Em atividade, sem responsável geral nem atribuição" href="/contabil#sem-responsavel" tone={withoutResponsible ? "bad" : "good"} />
      </section>

      <section id="departamentos" aria-label="Departamentos" className="mb-6 scroll-mt-20">
        <h2 className="mb-2 text-sm font-semibold text-ink">Departamentos</h2>
        {deps.length === 0 ? (
          <div className="rounded-lg border border-line bg-white">
            <EmptyState
              icon={<ShieldCheck className="size-10" aria-hidden />}
              title="Nenhum departamento cadastrado"
              description="Departamentos organizam a equipe por frente de trabalho (fiscal, contábil, pessoal, societário…) e permitem atribuir titular e substituto por departamento em cada cliente."
              action={canManage ? <DepartmentForm kinds={KIND_OPTIONS} users={refs.users} /> : undefined}
            />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {deps.map((d) => (
              <Card
                key={d.id}
                className={d.active ? undefined : "opacity-80"}
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {d.name}
                    {!d.active && <StatusBadge kind="generic" status="inactive" />}
                  </span>
                }
                description={`${d.kindLabel}${d.key ? ` · ${d.key}` : ""}`}
                actions={canManage && <DepartmentForm department={d} kinds={KIND_OPTIONS} users={refs.users} />}
              >
                <DefinitionList
                  cols={2}
                  items={[
                    {
                      label: "Gestor",
                      value: d.managerName ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {d.managerName}
                          {!d.managerActive && <Badge tone="warn">usuário inativo</Badge>}
                        </span>
                      ) : (
                        <span className="text-slate-400">Sem gestor</span>
                      ),
                    },
                    {
                      label: "Clientes atribuídos",
                      value: d.clients ? (
                        <span>
                          <span className="tabular">{d.clients.toLocaleString("pt-BR")}</span>{" "}
                          <Link href={`/contabil/clientes?departamento=${d.id}`} className="text-xs text-brand-700 hover:underline">
                            ver clientes
                          </Link>
                        </span>
                      ) : (
                        <span className="text-slate-400">Nenhum</span>
                      ),
                    },
                  ]}
                />
                <div className="mt-4">
                  <p className="text-xs text-slate-500">Membros ({d.members.length.toLocaleString("pt-BR")})</p>
                  {d.members.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-500">Nenhum membro ainda.</p>
                  ) : (
                    <ul className="mt-1 divide-y divide-line">
                      {d.members.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="text-ink">{m.name}</span>
                            {!m.userActive && <Badge tone="warn">usuário inativo</Badge>}
                          </span>
                          {/* div (não span): o botão Remover é um <form>, que não pode ficar dentro de conteúdo de frase */}
                          <div className="inline-flex items-center gap-2">
                            <Badge tone={m.role === "manager" ? "brand" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                            {canManage && <RemoveMemberForm departmentId={d.id} departmentName={d.name} userId={m.userId} userName={m.name} />}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {canManage && (
                    <div className="mt-3">
                      <MemberForm departmentId={d.id} departmentName={d.name} users={refs.users} memberIds={d.members.map((m) => m.userId)} />
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section id="carteira" aria-label="Carteira por colaborador" className="scroll-mt-20">
        <h2 className="mb-2 text-sm font-semibold text-ink">Carteira por colaborador</h2>
        <p className="mb-3 text-xs text-slate-500">Responsável geral = definido no cadastro do cliente; titular e substituto = atribuições ativas por departamento (página do cliente, aba Responsáveis). Só clientes em atividade.</p>
        <DataTable
          id="accounting-team-workload"
          basePath="/contabil/equipe"
          params={params}
          columns={columns}
          rows={pageRows}
          total={total}
          page={p.page}
          pageSize={p.pageSize}
          rowHref={(r) => `/contabil/clientes?responsavel=${r.id}`}
          empty={<EmptyState icon={<Users className="size-10" aria-hidden />} title="Nenhum colaborador" description="Cadastre os usuários do escritório em Administração → Usuários; eles passam a aparecer aqui para compor departamentos e receber clientes." />}
        />
      </section>
    </>
  );
}
