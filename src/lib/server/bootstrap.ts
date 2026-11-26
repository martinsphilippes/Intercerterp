import "server-only";
import { configuredBackend, getStore, listAll, type Backend } from "../db";

/**
 * Inicialização: no modo memória (demonstração volátil, pedida com DATA_BACKEND=memory),
 * carrega a demonstração automaticamente. Em Postgres/local, nada é criado sem comando explícito
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
 * Instalação vazia = nenhum usuário com credencial criada. Erro de leitura (tempo esgotado, banco fora do ar) é
 * propagado — nunca abre a instalação por falha transitória. No Postgres as tabelas que faltam são criadas na primeira
 * consulta, então banco novo responde "vazio" sem erro.
 */
export async function isEmptyInstallation() {
  const res = await getStore().list("users", { filters: [["notNull", "authId"]], limit: 1 });
  return res.items.length === 0;
}

/** Estado do banco: acessível? (no Postgres as tabelas são criadas sozinhas na primeira consulta) */
export async function installationState(): Promise<{ backend: Backend; reachable: boolean; error?: string }> {
  const backend = configuredBackend();
  if (backend !== "postgres") return { backend, reachable: true };
  try {
    await getStore().list("companies", { limit: 1, total: false });
    return { backend, reachable: true };
  } catch (e) {
    return { backend, reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
}
