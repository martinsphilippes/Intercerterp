import { registerJob } from "@/lib/core/jobs";
import { rebuildRunningBalances } from "../finance";

/** Tarefas duráveis do módulo Financeiro. */

// Recalcula o "saldo após" dos lançamentos de uma conta (após alteração do saldo inicial). Idempotente.
registerJob("finance.account.rebuild", async (ctx, payload: { accountId: string }) => rebuildRunningBalances(ctx.store, payload.accountId));
