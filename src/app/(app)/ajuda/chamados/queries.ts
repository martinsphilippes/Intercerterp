import "server-only";
import type { Ctx } from "@/lib/core/ctx";
import type { ListParams } from "@/lib/list";
import { queryTickets } from "@/domain/support";

/** Consulta única de chamados (tela e exportação). */
export function ticketsFor(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  return queryTickets(ctx, { scope: (p.f.scope as any) || undefined, status: p.f.status, category: p.f.category, priority: p.f.priority, assignee: p.f.assignee, q: p.q });
}
