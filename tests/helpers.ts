import { MemoryStore } from "@/lib/db/memory-store";
import { setStore } from "@/lib/db";
import { setAuth } from "@/lib/auth/provider";
import { setFileStorage, getFileStorage } from "@/lib/core/files";

/** Banco em memória isolado por teste (autenticação local). */
export function freshStore() {
  const store = new MemoryStore();
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
