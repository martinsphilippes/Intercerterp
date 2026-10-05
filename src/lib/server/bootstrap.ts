import "server-only";
import { configuredBackend, getStore, listAll } from "../db";

/**
 * Inicialização: no modo memória (demonstração volátil, ex.: prévia na Vercel sem Appwrite),
 * carrega a demonstração automaticamente. Em Appwrite/local, nada é criado sem comando explícito
 * (npm run seed / tela de primeiro acesso).
 */
let booting: Promise<void> | null = null;

export function ensureBootstrap() {
  if (configuredBackend() !== "memory") return Promise.resolve();
  booting ??= (async () => {
    const store = getStore();
    const companies = await listAll(store, "companies");
    if (companies.length) return;
    const { seedDemo } = await import("@/domain/seed");
    await seedDemo(store, { historyDays: 30 });
  })();
  return booting;
}

export async function isEmptyInstallation() {
  const store = getStore();
  const res = await store.list("users", { limit: 1 });
  return res.items.length === 0;
}
