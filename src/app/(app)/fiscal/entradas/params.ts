import { sp, type SearchParams } from "@/lib/list";
import { monthStart, today } from "@/lib/dates";
import type { Ctx } from "@/lib/core/ctx";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros do livro de entradas (tela, impressão e CSV): de, ate (padrão: mês corrente) e filial (só no consolidado). */
export function entriesParams(ctx: Ctx, params: SearchParams) {
  const t = today();
  const de = sp(params, "de");
  const ate = sp(params, "ate");
  let from = DATE_RE.test(de) ? de : monthStart(t);
  let to = DATE_RE.test(ate) ? ate : t;
  if (from > to) [from, to] = [to, from];
  const filial = sp(params, "filial");
  return { from, to, branchId: ctx.branchId ? null : filial || null };
}
