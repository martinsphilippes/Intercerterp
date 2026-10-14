import type { Store } from "@/lib/db/types";
import { formatDate, nowIso, today } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { featureDefault, getSetting, isFeatureOn, setSetting } from "@/lib/core/settings";

/**
 * FIN-21 — Fechamento de período financeiro (por empresa).
 *
 * Parâmetro `finance.closedUntil` (empresa): data AAAA-MM-DD até a qual (inclusive) o financeiro está fechado.
 * Com o recurso `feature.fechamentoPeriodo` ligado (desligado por padrão), TODA gravação financeira datada até essa data
 * é recusada no servidor por uma única função (`assertPeriodOpen`), chamada em `postEntry` (todo lançamento em conta:
 * baixas, estornos, vendas à vista, transferências, avulsos, conciliação), `createTitle` (data de competência),
 * `settleInstallment` (data da baixa), `reverseSettlement`/`reverseEntry` (data do lançamento original),
 * `updateTitle` (competência/classificação de título do período) e `changeInitialBalance`.
 * Fechar ou reabrir exige a permissão "Fechar e reabrir período financeiro" (`finance.close_period`) e é auditado.
 * Recurso desligado ou sem data: nenhuma verificação (comportamento anterior).
 */

export const CLOSE_KEY = "finance.closedUntil";
export const CLOSE_HISTORY_KEY = "finance.closeHistory";
export const CLOSE_HISTORY_MAX = 100;

export interface CloseEvent {
  action: "close" | "reopen";
  from: string | null;
  to: string | null;
  at: string;
  userId: string;
  userName: string;
  reason: string | null;
}

export interface PeriodCloseState {
  enabled: boolean;
  closedUntil: string | null;
}

/** Recurso ligado na empresa (parâmetro de empresa, desligado por padrão). */
export function periodCloseEnabled(store: Store, companyId: string) {
  return isFeatureOn(store, companyId, null, "fechamentoPeriodo", featureDefault("fechamentoPeriodo"));
}

export async function periodCloseState(store: Store, companyId: string): Promise<PeriodCloseState> {
  const enabled = await periodCloseEnabled(store, companyId);
  const closedUntil = enabled ? await getSetting<string | null>(store, companyId, null, CLOSE_KEY, null) : null;
  return { enabled, closedUntil: typeof closedUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(closedUntil) ? closedUntil : null };
}

/** Data efetivamente fechada (null = nada fechado ou recurso desligado). */
export async function closedUntil(store: Store, companyId: string): Promise<string | null> {
  return (await periodCloseState(store, companyId)).closedUntil;
}

/** Mensagem padrão (servidor e tela). */
export function periodClosedMessage(until: string, date: string, what: string) {
  return `Período financeiro fechado até ${formatDate(until)}: ${what} com data ${formatDate(date)} não pode ser gravado(a). Peça a reabertura do período em Financeiro › Fechamento de período (permissão "Fechar e reabrir período financeiro").`;
}

/** Verificação pura (sem leitura): recusa data ≤ fechamento. */
export function checkPeriodOpen(state: PeriodCloseState | null | undefined, date: string | null | undefined, what: string) {
  if (!state?.enabled || !state.closedUntil || !date) return;
  const d = String(date).slice(0, 10);
  if (d <= state.closedUntil) throw new BusinessError(periodClosedMessage(state.closedUntil, d, what), "period_closed");
}

// cache por transação (o Map de contas do postEntry): vários lançamentos da mesma transação leem o parâmetro uma vez
const txCache = new WeakMap<object, Promise<PeriodCloseState>>();

/**
 * Função ÚNICA de verificação do fechamento. `cacheKey` (opcional) reaproveita a leitura dentro da mesma operação.
 * Nunca lê nada além do parâmetro da empresa; recurso desligado = 1 leitura e nenhuma recusa.
 */
export async function assertPeriodOpen(store: Store, companyId: string, date: string | null | undefined, what: string, cacheKey?: object) {
  if (!date) return;
  let state: Promise<PeriodCloseState>;
  if (cacheKey) {
    state = txCache.get(cacheKey) ?? periodCloseState(store, companyId);
    txCache.set(cacheKey, state);
  } else state = periodCloseState(store, companyId);
  checkPeriodOpen(await state, date, what);
}

/** Histórico de fechamentos/reaberturas (mais recente primeiro). */
export async function closeHistory(store: Store, companyId: string): Promise<CloseEvent[]> {
  const h = await getSetting<CloseEvent[] | null>(store, companyId, null, CLOSE_HISTORY_KEY, null);
  return Array.isArray(h) ? h : [];
}

async function recordHistory(ctx: Ctx, ev: CloseEvent) {
  const h = await closeHistory(ctx.store, ctx.companyId);
  await setSetting(ctx.store, ctx.companyId, null, CLOSE_HISTORY_KEY, [ev, ...h].slice(0, CLOSE_HISTORY_MAX), ctx.user.id);
}

/**
 * Fecha o período até `date` (inclusive). Só datas passadas (até ontem): o dia corrente continua aberto para o PDV
 * e as baixas do dia. Avançar o fechamento é "fechar"; recuar é "reabrir" (exige motivo) — ambos exigem a permissão.
 */
export async function setClosedUntil(ctx: Ctx, input: { date: string | null; reason?: string | null }): Promise<{ changed: boolean; closedUntil: string | null; action: "close" | "reopen" | null }> {
  requireAction(ctx, "finance.close_period");
  assert(await periodCloseEnabled(ctx.store, ctx.companyId), "O fechamento de período está desligado em Administração › Parâmetros › Recursos.", "feature_off");
  const cur = await getSetting<string | null>(ctx.store, ctx.companyId, null, CLOSE_KEY, null);
  const next = input.date ? String(input.date).slice(0, 10) : null;
  if (next) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(next), "Informe uma data válida.");
    assert(next < today(), "Só é possível fechar dias já encerrados (até ontem): o dia de hoje continua aberto para o caixa e as baixas.", "invalid_close_date");
  }
  if ((cur ?? null) === next) return { changed: false, closedUntil: next, action: null };
  const reopening = !next || (cur != null && next < cur);
  const reason = input.reason?.trim() || null;
  if (reopening) assert(reason, "Informe o motivo da reabertura do período.", "reason_required");
  await setSetting(ctx.store, ctx.companyId, null, CLOSE_KEY, next, ctx.user.id);
  const ev: CloseEvent = { action: reopening ? "reopen" : "close", from: cur ?? null, to: next, at: nowIso(), userId: ctx.user.id, userName: ctx.user.name, reason };
  await recordHistory(ctx, ev);
  await audit(ctx, {
    module: "finance",
    action: reopening ? "period.reopen" : "period.close",
    entityType: "finance_period",
    entityId: ctx.companyId,
    summary: reopening
      ? next
        ? `Período financeiro reaberto: fechamento recuado de ${formatDate(cur)} para ${formatDate(next)}`
        : `Período financeiro reaberto: fechamento até ${formatDate(cur)} removido`
      : `Período financeiro fechado até ${formatDate(next)}${cur ? ` (antes: ${formatDate(cur)})` : ""}`,
    before: { closedUntil: cur ?? null },
    after: { closedUntil: next },
    reason,
  });
  return { changed: true, closedUntil: next, action: ev.action };
}

export const closePeriod = (ctx: Ctx, date: string, reason?: string | null) => setClosedUntil(ctx, { date, reason });
export const reopenPeriod = (ctx: Ctx, date: string | null, reason: string) => setClosedUntil(ctx, { date, reason });

/** Erro de período fechado (para telas que mostram o motivo sem quebrar). */
export function isPeriodClosedError(e: unknown) {
  return e instanceof BusinessError && e.code === "period_closed";
}
