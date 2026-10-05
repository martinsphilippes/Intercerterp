import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { runDueJobs } from "@/domain/jobs-registry";
import { runScheduled } from "@/domain/scheduler";

/**
 * Executor de tarefas duráveis. Acionado pelo Vercel Cron (vercel.json) e manualmente pela Central de integrações.
 * Protegido por CRON_SECRET (cabeçalho Authorization: Bearer).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Não autorizado", { status: 401 });
  const store = getStore();
  const scheduled = await runScheduled(store).catch((e) => ({ error: String(e?.message ?? e) }));
  const results = await runDueJobs(store, { limit: 50 });
  return NextResponse.json({ ranAt: new Date().toISOString(), scheduled, jobs: results });
}
