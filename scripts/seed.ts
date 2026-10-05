import "./env";
import { getStore, configuredBackend } from "../src/lib/db";
import { seedDemo } from "../src/domain/seed";
import { MemoryStore } from "../src/lib/db/memory-store";

(async () => {
  const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 45);
  const store = getStore();
  console.log(`Carregando demonstração (${configuredBackend()}, ${days} dias de histórico)…`);
  const t0 = Date.now();
  const r = await seedDemo(store, { historyDays: days });
  if (store instanceof MemoryStore) store.flush();
  console.log(`Concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(r));
  console.log("Usuários: admin | gerente | caixa | estoque | financeiro | fiscal — senha:", process.env.DEMO_PASSWORD || "Intercert@2026");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
