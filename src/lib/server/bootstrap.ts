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
  })().catch((e) => {
    booting = null; // falha transitória: a próxima requisição tenta novamente
    throw e;
  });
  return booting;
}

/**
 * Instalação vazia = nenhum usuário com credencial criada. Somente "banco/tabela inexistente" conta como vazio;
 * qualquer outro erro (timeout, 5xx) é propagado — nunca abre a instalação por falha transitória.
 */
export async function isEmptyInstallation() {
  const store = getStore();
  try {
    const res = await store.list("users", { filters: [["notNull", "authId"]], limit: 1 });
    return res.items.length === 0;
  } catch (e) {
    const { AppwriteException } = await import("node-appwrite");
    if (e instanceof AppwriteException && e.code === 404) return true;
    throw e;
  }
}

/** Estado do banco (somente Appwrite): acessível? provisionado? */
export async function installationState() {
  if (configuredBackend() !== "appwrite") return { backend: configuredBackend(), reachable: true, provisioned: true, missing: [] as string[] };
  const { appwriteProvisionState } = await import("../db/provision");
  const { appwriteConfig } = await import("../db");
  return { backend: "appwrite" as const, ...(await appwriteProvisionState(appwriteConfig())) };
}
