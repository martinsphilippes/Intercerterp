import "server-only";
import { after } from "next/server";

/**
 * Executor oportunista de tarefas duráveis: depois de cada ação de usuário (fora do tempo de resposta), executa as
 * tarefas vencidas — retentativas de efeitos de venda, envio/consulta fiscal, e-mails etc. Complementa o Vercel Cron,
 * que no plano Hobby só pode rodar uma vez por dia. Seguro em concorrência: cada tentativa de tarefa é reivindicada
 * por um registro único (`runDueJobs`), então várias instâncias podem rodar ao mesmo tempo sem efeito duplicado.
 */
const MIN_INTERVAL_MS = 30_000;
const g = globalThis as unknown as { __intercertJobsAt?: number };

export function scheduleBackgroundJobs() {
  if (process.env.BACKGROUND_JOBS === "off") return;
  const now = Date.now();
  if (g.__intercertJobsAt && now - g.__intercertJobsAt < MIN_INTERVAL_MS) return;
  g.__intercertJobsAt = now;
  try {
    after(async () => {
      try {
        const [{ getStore }, { runDueJobs }] = await Promise.all([import("../db"), import("@/domain/jobs-registry")]);
        await runDueJobs(getStore(), { limit: 10, deadlineMs: Date.now() + 20_000 });
      } catch (e) {
        console.error("[jobs] execução em segundo plano falhou", e);
      }
    });
  } catch {
    // fora de um contexto de requisição (ex.: testes): nada a fazer
  }
}
