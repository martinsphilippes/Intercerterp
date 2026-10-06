import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { diffDays, today } from "@/lib/dates";
import { formatMoney, roundDiv } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { monthBounds, reportTotals, type Totals } from "./reports";

/**
 * Metas comerciais por filial (ou da empresa inteira), mês e métrica.
 * Uma meta por (empresa, filial, mês, métrica). O realizado vem do serviço único de métricas (reports.ts).
 */

export type GoalMetric = "revenue" | "sales_count" | "ticket";

export const GOAL_METRICS: Record<GoalMetric, { label: string; unit: "money" | "count"; hint: string }> = {
  revenue: { label: "Receita líquida", unit: "money", hint: "Vendas concluídas − descontos + acréscimos − devoluções do mês" },
  sales_count: { label: "Número de vendas", unit: "count", hint: "Vendas concluídas no mês (canceladas não contam)" },
  ticket: { label: "Ticket médio", unit: "money", hint: "Receita líquida ÷ número de vendas do mês" },
};

export function formatGoalValue(metric: GoalMetric, v: number | null | undefined) {
  if (v == null) return "—";
  return GOAL_METRICS[metric]?.unit === "count" ? v.toLocaleString("pt-BR") : formatMoney(v);
}

export interface GoalInput {
  branchId: string | null;
  period: string;
  metric: GoalMetric;
  target: number;
  notes?: string | null;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validate(input: GoalInput) {
  assert(PERIOD_RE.test(input.period ?? ""), "Informe o mês da meta (AAAA-MM).");
  assert(input.metric in GOAL_METRICS, "Métrica inválida.");
  assert(Number.isInteger(input.target) && input.target > 0, "A meta deve ser maior que zero.");
  assert(!input.notes || input.notes.length <= 500, "Observações: até 500 caracteres.");
}

/** Acesso a todas as filiais da empresa (administrador ou usuário sem restrição de filial). */
export function hasAllBranches(user: Ctx["user"]) {
  return Boolean(user.isAdmin) || (user.branchIds ?? []).length === 0;
}

async function checkBranch(ctx: Ctx, branchId: string | null) {
  if (!branchId) {
    assert(hasAllBranches(ctx.user), "Somente usuários com acesso a todas as filiais podem definir metas da empresa.");
    return null;
  }
  const b = await ctx.store.get("branches", branchId);
  assert(b && b.companyId === ctx.companyId, "Filial inválida.");
  assert(ctx.user.isAdmin || (ctx.user.branchIds ?? []).length === 0 || ctx.user.branchIds.includes(branchId), "Você não tem acesso a esta filial.");
  return b;
}

async function findDuplicate(store: Store, companyId: string, input: GoalInput, exceptId?: string) {
  const rows = await listAll(store, "goals", { filters: [["eq", "companyId", companyId], ["eq", "period", input.period], ["eq", "metric", input.metric]] });
  return rows.find((g) => (g.branchId ?? null) === (input.branchId ?? null) && g.id !== exceptId) ?? null;
}

/**
 * Id determinístico pela chave (empresa, filial, mês, métrica): criações concorrentes da mesma meta convergem
 * para o mesmo registro. A edição pode mudar a chave mantendo o id; por isso, quando a posição já pertence a uma
 * meta com outra chave, a criação usa a próxima posição determinística da mesma chave (`slot`).
 */
const goalId = (companyId: string, input: GoalInput, slot = 0) =>
  slot === 0 ? detId("goal", companyId, input.branchId ?? "*", input.period, input.metric) : detId("goal", companyId, input.branchId ?? "*", input.period, input.metric, slot);

const sameKey = (g: Doc, companyId: string, input: GoalInput) =>
  g.companyId === companyId && (g.branchId ?? null) === (input.branchId ?? null) && g.period === input.period && g.metric === input.metric;

const MAX_GOAL_SLOTS = 50;

function describe(input: { branchName?: string | null; period: string; metric: GoalMetric; target: number }) {
  return `${GOAL_METRICS[input.metric].label} ${input.period} — ${input.branchName ?? "empresa (todas as filiais)"}: ${formatGoalValue(input.metric, input.target)}`;
}

const auditRefs = (ctx: Ctx, branchId: string | null) => [`goals:${ctx.companyId}`, branchId ? `branch:${branchId}` : ""].filter(Boolean);

export async function createGoal(ctx: Ctx, input: GoalInput): Promise<Doc> {
  requirePerm(ctx, "dashboard", "create");
  validate(input);
  const branch = await checkBranch(ctx, input.branchId);
  const dup = await findDuplicate(ctx.store, ctx.companyId, input);
  assert(!dup, `Já existe meta de ${GOAL_METRICS[input.metric].label.toLowerCase()} para ${branch?.name ?? "a empresa"} em ${input.period}. Edite a meta existente.`, "duplicate");
  const data = { companyId: ctx.companyId, branchId: input.branchId, createdBy: ctx.user.id, period: input.period, metric: input.metric, target: input.target, notes: input.notes ?? null };
  let doc: Doc | null = null;
  for (let slot = 0, attempts = 0; !doc && slot < MAX_GOAL_SLOTS && attempts < MAX_GOAL_SLOTS + 5; attempts++) {
    const id = goalId(ctx.companyId, input, slot);
    try {
      doc = await ctx.store.create("goals", data, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      const again = await ctx.store.get("goals", id);
      // criação concorrente da mesma meta: devolve a existente (idempotente)
      if (again && sameKey(again, ctx.companyId, input)) return again;
      // posição ocupada por meta cuja chave foi alterada na edição: próxima posição da mesma chave
      if (again) slot++;
      // (registro excluído entre a criação e a leitura: tenta a mesma posição de novo)
    }
  }
  if (!doc) throw new BusinessError("Não foi possível gravar a meta agora. Tente novamente.", "conflict");
  await audit(ctx, { module: "dashboard", action: "goal.create", entityType: "goal", entityId: doc.id, summary: `Meta criada: ${describe({ ...input, branchName: branch?.name })}`, after: input, related: auditRefs(ctx, input.branchId), branchId: input.branchId });
  return doc;
}

export async function updateGoal(ctx: Ctx, id: string, input: GoalInput): Promise<Doc> {
  requirePerm(ctx, "dashboard", "edit");
  validate(input);
  const cur = await ctx.store.getOrThrow("goals", id);
  assert(cur.companyId === ctx.companyId, "Meta de outra empresa.");
  await checkBranch(ctx, cur.branchId ?? null);
  const branch = await checkBranch(ctx, input.branchId);
  const dup = await findDuplicate(ctx.store, ctx.companyId, input, id);
  assert(!dup, `Já existe outra meta de ${GOAL_METRICS[input.metric].label.toLowerCase()} para ${branch?.name ?? "a empresa"} em ${input.period}.`, "duplicate");
  const before = { branchId: cur.branchId ?? null, period: cur.period, metric: cur.metric, target: cur.target, notes: cur.notes ?? null };
  const after = { branchId: input.branchId, period: input.period, metric: input.metric, target: input.target, notes: input.notes ?? null };
  if (JSON.stringify(before) === JSON.stringify(after)) return cur;
  const doc = await ctx.store.update("goals", id, after);
  await audit(ctx, {
    module: "dashboard", action: "goal.update", entityType: "goal", entityId: id,
    summary: `Meta alterada: ${describe({ ...input, branchName: branch?.name })} (antes ${formatGoalValue(cur.metric, cur.target)})`,
    before, after, related: [...auditRefs(ctx, input.branchId), cur.branchId && cur.branchId !== input.branchId ? `branch:${cur.branchId}` : ""].filter(Boolean), branchId: input.branchId,
  });
  return doc;
}

export async function deleteGoal(ctx: Ctx, id: string, reason?: string | null) {
  requirePerm(ctx, "dashboard", "delete");
  const cur = await ctx.store.get("goals", id);
  if (!cur) return; // já excluída (repetição)
  assert(cur.companyId === ctx.companyId, "Meta de outra empresa.");
  const branch = await checkBranch(ctx, cur.branchId ?? null);
  await ctx.store.delete("goals", id);
  await audit(ctx, {
    module: "dashboard", action: "goal.delete", entityType: "goal", entityId: id, summary: `Meta excluída: ${describe({ branchName: branch?.name, period: cur.period, metric: cur.metric, target: cur.target })}`,
    before: { branchId: cur.branchId ?? null, period: cur.period, metric: cur.metric, target: cur.target, notes: cur.notes ?? null }, reason: reason ?? null, related: auditRefs(ctx, cur.branchId ?? null), branchId: cur.branchId ?? null,
  });
}

/** Replica as metas de um mês para outro (somente as que ainda não existem no destino). */
export async function copyGoals(ctx: Ctx, fromPeriod: string, toPeriod: string, branchIds: string[] | null) {
  requirePerm(ctx, "dashboard", "create");
  assert(PERIOD_RE.test(fromPeriod) && PERIOD_RE.test(toPeriod), "Meses inválidos.");
  assert(fromPeriod !== toPeriod, "Escolha meses diferentes.");
  const src = await listAll(ctx.store, "goals", { filters: [["eq", "companyId", ctx.companyId], ["eq", "period", fromPeriod]] });
  let created = 0;
  let skipped = 0;
  for (const g of src) {
    if (branchIds && !branchIds.includes(g.branchId ?? "")) continue;
    const input: GoalInput = { branchId: g.branchId ?? null, period: toPeriod, metric: g.metric, target: g.target, notes: g.notes ?? null };
    if (await findDuplicate(ctx.store, ctx.companyId, input)) {
      skipped++;
      continue;
    }
    await createGoal(ctx, input);
    created++;
  }
  return { created, skipped, source: src.length };
}

export interface GoalProgress {
  goal: Doc;
  metric: GoalMetric;
  branchName: string;
  target: number;
  actual: number | null;
  /** atingimento em bps (10000 = 100%) */
  progressBps: number | null;
  /** realizado esperado pelo ritmo linear do mês até a data de referência (receita e nº de vendas) */
  expected: number | null;
  /** dias decorridos / dias do mês */
  elapsedDays: number;
  monthDays: number;
  /** intervalo usado para o realizado */
  from: string;
  to: string;
  /** null quando o mês ainda não começou */
  status: "achieved" | "on_track" | "behind" | "not_started" | "closed_missed";
}

export function actualFor(metric: GoalMetric, t: Totals): number | null {
  if (metric === "revenue") return t.netRevenue;
  if (metric === "sales_count") return t.salesCount;
  return t.ticket;
}

/**
 * Progresso das metas de um mês. Realizado = do 1º dia do mês até min(fim do mês, hoje),
 * pelo serviço único de métricas (mesma receita do painel e dos gerenciais).
 */
export async function goalsProgress(ctx: Ctx, period: string, opts: { branchIds?: string[] | null; ref?: string } = {}): Promise<GoalProgress[]> {
  const ref = opts.ref ?? today();
  const { from, to: end, days } = monthBounds(period);
  const to = end < ref ? end : ref;
  const started = from <= ref;
  // metas da empresa (sem filial) têm realizado de TODAS as filiais: só para quem tem acesso a todas;
  // metas de filial: somente filiais do recorte e permitidas ao usuário
  const fullAccess = hasAllBranches(ctx.user);
  const goals = (await listAll(ctx.store, "goals", { filters: [["eq", "companyId", ctx.companyId], ["eq", "period", period]] })).filter((g) =>
    g.branchId ? (!opts.branchIds || opts.branchIds.includes(g.branchId)) && (fullAccess || (ctx.user.branchIds ?? []).includes(g.branchId)) : fullAccess,
  );
  if (!goals.length) return [];
  const branches = new Map((await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).map((b) => [b.id, b]));
  const cache = new Map<string, Totals>();
  const totalsFor = async (branchId: string | null) => {
    const k = branchId ?? "*";
    if (!cache.has(k)) cache.set(k, await reportTotals(ctx.store, { companyId: ctx.companyId, branchIds: branchId ? [branchId] : null, from, to }));
    return cache.get(k)!;
  };
  const elapsedDays = started ? Math.min(days, diffDays(from, to) + 1) : 0;
  const out: GoalProgress[] = [];
  for (const g of goals) {
    const metric = g.metric as GoalMetric;
    const t = started ? await totalsFor(g.branchId ?? null) : null;
    const actual = t ? actualFor(metric, t) : null;
    const progressBps = actual != null && g.target > 0 ? roundDiv(actual * 10000, g.target) : null;
    const expected = metric === "ticket" ? g.target : started ? roundDiv(g.target * elapsedDays, days) : 0;
    const closed = end < ref;
    let status: GoalProgress["status"] = "not_started";
    if (started) {
      if ((progressBps ?? 0) >= 10000) status = "achieved";
      else if (closed) status = "closed_missed";
      else status = (actual ?? 0) >= expected ? "on_track" : "behind";
    }
    out.push({
      goal: g, metric, branchName: g.branchId ? (branches.get(g.branchId)?.name ?? "Filial removida") : "Empresa (todas as filiais)",
      target: g.target, actual, progressBps, expected, elapsedDays, monthDays: days, from, to, status,
    });
  }
  const order: Record<string, number> = { revenue: 0, sales_count: 1, ticket: 2 };
  return out.sort((a, b) => a.branchName.localeCompare(b.branchName, "pt-BR") || (order[a.metric] ?? 9) - (order[b.metric] ?? 9));
}

/**
 * Metas da tela de metas e da exportação (mesma regra): filiais acessíveis ao usuário (e metas da empresa para quem
 * tem acesso a todas as filiais). `filial` (id de filial acessível) restringe à filial; vazio = todas.
 */
export async function goalsScreen(ctx: Ctx, period: string, opts: { accessibleBranchIds: string[]; filial?: string | null; ref?: string }) {
  const filial = opts.filial && opts.accessibleBranchIds.includes(opts.filial) ? opts.filial : null;
  const all = await goalsProgress(ctx, period, { branchIds: opts.accessibleBranchIds, ref: opts.ref });
  return { filial, all, goals: filial ? all.filter((g) => g.goal.branchId === filial) : all };
}

export const GOAL_STATUS_LABEL: Record<GoalProgress["status"], string> = {
  achieved: "Meta atingida",
  on_track: "No ritmo",
  behind: "Abaixo do ritmo",
  not_started: "Mês não iniciado",
  closed_missed: "Mês encerrado abaixo da meta",
};

