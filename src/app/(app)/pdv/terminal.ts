import "server-only";
import { cookies } from "next/headers";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { SessionInfo } from "@/lib/server/session";
import { currentSession } from "@/domain/cash";

/** Cookie com o terminal escolhido neste navegador (por filial): "<filialId>:<terminalId>". */
export const TERMINAL_COOKIE = "ic_pdv_terminal";

/**
 * Terminal ativo do navegador: parâmetro explícito → escolha gravada no navegador → terminal onde o operador
 * tem caixa aberto → primeiro terminal ativo da filial.
 */
export async function resolveTerminal(s: SessionInfo, explicit?: string | null): Promise<{ terminal: Doc | null; terminals: Doc[]; session: Doc | null }> {
  const branchId = s.ctx.branchId;
  if (!branchId) return { terminal: null, terminals: [], session: null };
  const terminals = (await listAll(s.ctx.store, "terminals", { filters: [["eq", "branchId", branchId], ["eq", "companyId", s.ctx.companyId]] })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const active = terminals.filter((t) => t.status === "active");
  const jar = await cookies();
  const saved = jar.get(TERMINAL_COOKIE)?.value ?? "";
  const [savedBranch, savedTerminal] = saved.split(":");
  let terminal = (explicit && active.find((t) => t.id === explicit)) || (savedBranch === branchId && active.find((t) => t.id === savedTerminal)) || null;
  if (!terminal) {
    const mine = await s.ctx.store.list("cash_sessions", { filters: [["eq", "branchId", branchId], ["eq", "operatorId", s.user.id], ["eq", "status", ["open", "reopened"]]], limit: 1 });
    if (mine.items[0]) terminal = active.find((t) => t.id === mine.items[0].terminalId) ?? null;
  }
  terminal ??= active[0] ?? null;
  const session = terminal ? await currentSession(s.ctx, terminal.id) : null;
  return { terminal, terminals, session };
}
