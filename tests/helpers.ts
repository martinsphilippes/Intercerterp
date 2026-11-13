import { MemoryStore } from "@/lib/db/memory-store";
import { setStore } from "@/lib/db";
import { setAuth } from "@/lib/auth/provider";
import { setFileStorage, getFileStorage } from "@/lib/core/files";
import { freshPostgresStore } from "./pglite";

/**
 * Banco isolado por teste (autenticação local). Padrão: memória. Com `TEST_STORE=postgres` a suíte inteira roda sobre o
 * PostgresStore (Postgres embutido) — a conferência de que o ERP se comporta igual no banco de produção.
 */
export function freshStore() {
  const store = process.env.TEST_STORE === "postgres" ? (freshPostgresStore() as unknown as MemoryStore) : new MemoryStore();
  setStore(store);
  // força provedores locais
  (globalThis as any).__intercertAuth = undefined;
  (globalThis as any).__intercertFiles = undefined;
  process.env.DATA_BACKEND = "memory";
  void setAuth;
  void setFileStorage;
  getFileStorage();
  return store;
}
