import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { runDueJobs } from "@/domain/jobs-registry";
import { runScheduled } from "@/domain/scheduler";

/**
 * Executor de tarefas duráveis. Acionado pelo Vercel Cron (vercel.json) e manualmente pela Central de integrações.
 * Protegido por CRON_SECRET (cabeçalho Authorization: Bearer).
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Em produção o executor exige CRON_SECRET (falha fechada)
  if (!secret && process.env.NODE_ENV === "production") return new NextResponse("Defina CRON_SECRET no servidor.", { status: 503 });
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Não autorizado", { status: 401 });
  const store = getStore();
  const scheduled = await runScheduled(store).catch((e) => ({ error: String(e?.message ?? e) }));
  const results = await runDueJobs(store, { limit: 50, deadlineMs: Date.now() + 240000 });
  return NextResponse.json({ ranAt: new Date().toISOString(), scheduled, jobs: results });
}
