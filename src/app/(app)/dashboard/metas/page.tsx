import Link from "next/link";
import { ChevronLeft, ChevronRight, Copy, Download, Pencil, Trash2 } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty";
import { Timeline } from "@/components/ui/timeline";
import { Meter } from "@/components/charts/bars";
import { can, canDo } from "@/lib/permissions";
import { formatBps } from "@/lib/money";
import { addMonths, formatMonth, today } from "@/lib/dates";
import { qs, sp, type SearchParams } from "@/lib/list";
import { formatGoalValue, GOAL_METRICS, GOAL_STATUS_LABEL, goalsProgress, type GoalMetric, type GoalProgress } from "@/domain/goals";
import { GoalForm } from "./goal-form";
import { copyGoalsAction, deleteGoalAction } from "./actions";

export const metadata = { title: "Metas comerciais" };

const STATUS_TONE: Record<GoalProgress["status"], "good" | "info" | "warn" | "bad" | "neutral"> = { achieved: "good", on_track: "info", behind: "warn", not_started: "neutral", closed_missed: "bad" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("dashboard");
  const params = await searchParams;
  const mesParam = sp(params, "mes");
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(mesParam) ? mesParam : today().slice(0, 7);
  const accessible = [...s.branches].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  const filialParam = sp(params, "filial");
  const filial = accessible.some((b) => b.id === filialParam) ? filialParam : "";
  const fullAccess = s.user.isAdmin || (s.user.branchIds ?? []).length === 0;
  const all = await goalsProgress(s.ctx, mes, { branchIds: accessible.map((b) => b.id) });
  const goals = filial ? all.filter((g) => g.goal.branchId === filial) : all;
  const editId = sp(params, "editar");
  const editing = editId ? (all.find((g) => g.goal.id === editId)?.goal ?? null) : null;
  const canCreate = can(s.user, "dashboard", "create");
  const canEdit = can(s.user, "dashboard", "edit");
  const canDelete = can(s.user, "dashboard", "delete");
  const prevMonth = addMonths(`${mes}-01`, -1).slice(0, 7);
  const nextMonth = addMonths(`${mes}-01`, 1).slice(0, 7);
  const branchOpts = [...(fullAccess ? [{ value: "*", label: "Empresa — todas as filiais" }] : []), ...accessible.map((b) => ({ value: b.id, label: String(b.name) }))];
  const metrics = (Object.keys(GOAL_METRICS) as GoalMetric[]).map((k) => ({ value: k, label: GOAL_METRICS[k].label, unit: GOAL_METRICS[k].unit, hint: GOAL_METRICS[k].hint }));
  const achieved = goals.filter((g) => g.status === "achieved").length;
  const behind = goals.filter((g) => g.status === "behind" || g.status === "closed_missed").length;
  const ref = goals[0];
  const monthLink = (m: string) => `/dashboard/metas${qs({ mes: m, editar: null }, params)}`;

  return (
    <>
      <PageHeader
        title="Metas comerciais"
        crumbs={[{ label: "Gestão" }, { label: "Painel", href: "/dashboard" }, { label: "Metas" }]}
        description="Metas mensais por filial (ou da empresa) para receita líquida, número de vendas e ticket médio. O realizado usa o mesmo serviço de métricas do painel e dos relatórios gerenciais."
        actions={
          canDo(s.user, "data.export") && (
            <a className={buttonClass("secondary")} href={`/api/export/reports-goals${qs({ mes, filial: filial || "todas" })}`}>
              <Download className="size-4" aria-hidden /> Exportar CSV
            </a>
          )
        }
      />

      <div className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
        <div className="flex items-center gap-1">
          <Link href={monthLink(prevMonth)} className={buttonClass("ghost", "sm")} aria-label={`Mês anterior (${formatMonth(prevMonth)})`}>
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-24 text-center text-sm font-semibold text-ink">{formatMonth(mes)}</span>
          <Link href={monthLink(nextMonth)} className={buttonClass("ghost", "sm")} aria-label={`Próximo mês (${formatMonth(nextMonth)})`}>
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <form method="get" action="/dashboard/metas" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Mês
            <input type="month" name="mes" defaultValue={mes} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          {accessible.length > 1 && (
            <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-slate-600">
              Filial
              <select name="filial" defaultValue={filial} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm">
                <option value="">Todas (inclui metas da empresa)</option>
                {accessible.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className={buttonClass("primary")}>
            Filtrar
          </button>
        </form>
        {canCreate && (
          <div className="ml-auto">
            <ActionButton
              action={copyGoalsAction.bind(null, prevMonth, mes, filial ? [filial] : fullAccess ? null : accessible.map((b) => b.id))}
              label={`Copiar metas de ${formatMonth(prevMonth)}`}
              icon={<Copy className="size-4" aria-hidden />}
              confirm={`Copiar para ${formatMonth(mes)} as metas de ${formatMonth(prevMonth)} que ainda não existem neste mês?`}
              size="sm"
            />
          </div>
        )}
      </div>

      <section aria-label="Resumo das metas" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Metas no mês" value={goals.length} hint={filial ? accessible.find((b) => b.id === filial)?.name : "Todas as filiais"} />
        <Stat label="Atingidas" value={achieved} tone={achieved ? "good" : "default"} />
        <Stat label="Abaixo do ritmo / não atingidas" value={behind} tone={behind ? "warn" : "default"} />
        <Stat label="Realizado até" value={!ref ? "—" : ref.status === "not_started" ? "Não iniciado" : ref.to.split("-").reverse().join("/")} hint={!ref ? "Sem metas no mês" : ref.status === "not_started" ? "O mês ainda não começou" : `dia ${ref.elapsedDays} de ${ref.monthDays} do mês`} />
      </section>

      <div className="grid gap-4 2xl:grid-cols-3">
        <Card className="2xl:col-span-2" title={`Metas de ${formatMonth(mes)}`} bodyClass="p-0">
          {goals.length === 0 ? (
            <EmptyState title="Nenhuma meta cadastrada para o mês" description={canCreate ? "Cadastre ao lado ou copie as metas do mês anterior." : "Solicite ao gestor o cadastro das metas."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Filial</th>
                    <th>Métrica</th>
                    <th className="text-right">Meta</th>
                    <th className="text-right">Realizado</th>
                    <th className="min-w-[160px]">Atingimento</th>
                    <th>Situação</th>
                    <th className="no-print text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map((g) => {
                    const expectedBps = g.metric === "ticket" || !g.target ? null : Math.round(((g.expected ?? 0) * 10000) / g.target);
                    const salesLink = `/vendas?de=${g.from}&ate=${g.to}${g.goal.branchId ? `&filial=${g.goal.branchId}` : ""}`;
                    return (
                      <tr key={g.goal.id} className={editId === g.goal.id ? "bg-brand-50/60" : undefined}>
                        <td>{g.branchName}</td>
                        <td>
                          {GOAL_METRICS[g.metric]?.label ?? g.metric}
                          {g.goal.notes && <span className="block max-w-[220px] truncate text-xs text-slate-500" title={g.goal.notes}>{g.goal.notes}</span>}
                        </td>
                        <td className="tabular whitespace-nowrap text-right">{formatGoalValue(g.metric, g.target)}</td>
                        <td className="tabular whitespace-nowrap text-right">
                          {g.status === "not_started" ? (
                            "—"
                          ) : (
                            <Link href={salesLink} className="text-brand-700 hover:underline" title="Abrir as vendas que compõem o realizado">
                              {formatGoalValue(g.metric, g.actual)}
                            </Link>
                          )}
                          {g.metric !== "ticket" && g.status !== "not_started" && <span className="block text-xs text-slate-500">esperado {formatGoalValue(g.metric, g.expected)}</span>}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Meter bps={g.progressBps} expectedBps={expectedBps} tone={g.status === "achieved" ? "good" : g.status === "behind" ? "warn" : g.status === "closed_missed" ? "bad" : "neutral"} label={`${formatBps(g.progressBps ?? 0, 1)} da meta`} />
                            </div>
                            <span className="tabular w-14 text-right text-xs">{g.progressBps == null ? "—" : formatBps(g.progressBps, 1)}</span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[g.status]}>{GOAL_STATUS_LABEL[g.status]}</Badge>
                        </td>
                        <td className="no-print">
                          <div className="flex justify-end gap-1">
                            {canEdit && (
                              <Link href={`/dashboard/metas${qs({ mes, filial: filial || null, editar: g.goal.id })}#form-meta`} className={buttonClass("ghost", "sm")} aria-label={`Editar meta de ${GOAL_METRICS[g.metric]?.label} — ${g.branchName}`}>
                                <Pencil className="size-4" />
                              </Link>
                            )}
                            {canDelete && (
                              <ActionButton
                                action={deleteGoalAction.bind(null, g.goal.id)}
                                label=""
                                icon={<Trash2 className="size-4" aria-hidden />}
                                askReason={`Excluir a meta de ${GOAL_METRICS[g.metric]?.label} (${g.branchName}, ${formatMonth(g.goal.period)})? Informe o motivo:`}
                                variant="ghost"
                                size="sm"
                                title="Excluir meta"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
            Realizado do 1º dia do mês até hoje (ou até o fim do mês, se encerrado). Ritmo esperado = meta × dias decorridos ÷ dias do mês (traço no medidor). Ticket médio compara diretamente com a meta.
          </p>
        </Card>
        <div id="form-meta" className="grid scroll-mt-20 gap-4 lg:grid-cols-2 2xl:block 2xl:space-y-4">
          {(canCreate || (editing && canEdit)) && (
            <Card title={editing ? "Editar meta" : "Nova meta"} description="Uma meta por filial, mês e métrica.">
              <GoalForm key={editing?.id ?? "new"} goal={editing} branches={branchOpts} metrics={metrics} defaultPeriod={mes} defaultBranch={filial || s.ctx.branchId || accessible[0]?.id || "*"} />
            </Card>
          )}
          <Card title="Histórico de alterações" description="Criações, alterações e exclusões de metas (auditoria).">
            <Timeline store={s.ctx.store} refs={[`goals:${s.ctx.companyId}`]} limit={20} />
          </Card>
        </div>
      </div>
    </>
  );
}
