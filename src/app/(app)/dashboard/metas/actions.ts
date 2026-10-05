"use server";

import { runAction, fint, fopt, fstr } from "@/lib/server/action";
import { copyGoals, createGoal, deleteGoal, updateGoal, type GoalInput, type GoalMetric } from "@/domain/goals";

function parse(fd: FormData): GoalInput {
  const branch = fstr(fd, "branchId");
  return {
    branchId: branch === "*" || branch === "" ? null : branch,
    period: fstr(fd, "period"),
    metric: fstr(fd, "metric") as GoalMetric,
    target: fint(fd, "target"),
    notes: fopt(fd, "notes"),
  };
}

export async function saveGoalAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "dashboard", op: id ? "edit" : "create", revalidate: ["/dashboard", "/dashboard/metas"] }, async (s) => {
    const input = parse(fd);
    const g = id ? await updateGoal(s.ctx, id, input) : await createGoal(s.ctx, input);
    return { ok: true as const, data: { id: g.id }, message: id ? "Meta atualizada." : "Meta cadastrada.", redirect: `/dashboard/metas?mes=${input.period}` };
  });
}

export async function deleteGoalAction(id: string, fd: FormData) {
  return runAction({ module: "dashboard", op: "delete", revalidate: ["/dashboard", "/dashboard/metas"] }, async (s) => {
    await deleteGoal(s.ctx, id, fopt(fd, "reason"));
    return { ok: true as const, message: "Meta excluída." };
  });
}

export async function copyGoalsAction(from: string, to: string, branchIds: string[] | null, _fd: FormData) {
  return runAction({ module: "dashboard", op: "create", revalidate: ["/dashboard", "/dashboard/metas"] }, async (s) => {
    const r = await copyGoals(s.ctx, from, to, branchIds);
    return { ok: true as const, message: r.created ? `${r.created} meta(s) copiada(s)${r.skipped ? `; ${r.skipped} já existiam` : ""}.` : r.source ? "Todas as metas já existem no mês de destino." : "Não há metas no mês de origem." };
  });
}
