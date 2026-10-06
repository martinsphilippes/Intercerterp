import path from "node:path";
import { AppwriteStore } from "./appwrite-store";
import { MemoryStore } from "./memory-store";
import { ReadCachedStore } from "./read-cache";
import { COLLECTIONS } from "./schema";
import { ConflictError, Doc, Filter, ListOptions, NotFoundError, Store } from "./types";

export * from "./types";
export { detId, newId, sha256 } from "./ids";

type Backend = "appwrite" | "local" | "memory";

export function configuredBackend(): Backend {
  const explicit = process.env.DATA_BACKEND as Backend | undefined;
  if (explicit) return explicit;
  if (process.env.APPWRITE_ENDPOINT && process.env.APPWRITE_PROJECT_ID && process.env.APPWRITE_API_KEY) return "appwrite";
  // Vercel sem Appwrite: o layout raiz mostra "configuração pendente" (src/lib/server/deploy-config.ts);
  // a demonstração em memória só é usada quando pedida explicitamente (DATA_BACKEND=memory).
  if (process.env.VERCEL) return "memory";
  return "local";
}

const g = globalThis as unknown as { __intercertStore?: Store; __intercertSchemaSig?: string };

/** Assinatura do esquema: em desenvolvimento, mudança no schema.ts recria o Store (evita "campo desconhecido" após HMR). */
function schemaSignature() {
  return COLLECTIONS.map((c) => `${c.id}:${Object.keys(c.fields).length}:${(c.indexes ?? []).length}`).join("|");
}

export function appwriteConfig() {
  return {
    endpoint: process.env.APPWRITE_ENDPOINT ?? "",
    projectId: process.env.APPWRITE_PROJECT_ID ?? "",
    apiKey: process.env.APPWRITE_API_KEY ?? "",
    databaseId: process.env.APPWRITE_DATABASE_ID ?? "intercert",
  };
}

export function getStore(): Store {
  if (g.__intercertStore && process.env.NODE_ENV !== "production") {
    const sig = schemaSignature();
    if (g.__intercertSchemaSig && g.__intercertSchemaSig !== sig && g.__intercertStore.backend === "appwrite") g.__intercertStore = undefined;
    g.__intercertSchemaSig = sig;
  }
  if (g.__intercertStore) return g.__intercertStore;
  const backend = configuredBackend();
  let store: Store;
  if (backend === "appwrite") store = new AppwriteStore(appwriteConfig());
  else if (backend === "local") store = new MemoryStore(process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".data", "local"));
  else store = new MemoryStore();
  // leituras repetidas na mesma tela vão ao banco uma vez só (ver read-cache.ts)
  g.__intercertStore = new ReadCachedStore(process.env.STORE_TRACE === "1" ? traced(store) : store);
  return g.__intercertStore;
}

/** Diagnóstico (STORE_TRACE=1): registra cada leitura com a duração, para medir consultas por tela. */
function traced(store: Store): Store {
  return new Proxy(store, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function" || !["get", "getOrThrow", "list"].includes(String(prop))) return typeof v === "function" ? v.bind(target) : v;
      return async (...args: unknown[]) => {
        const t0 = performance.now();
        try {
          return await v.apply(target, args);
        } finally {
          console.log(`[store] ${String(prop)} ${String(args[0])} ${(performance.now() - t0).toFixed(1)}ms`);
        }
      };
    },
  });
}

/** Substitui o armazenamento global (testes). */
export function setStore(store: Store) {
  g.__intercertStore = store;
}

/** Lista todas as páginas de uma consulta (uso em relatórios e tarefas). */
export async function listAll<T = any>(store: Store, collection: string, opts: Omit<ListOptions, "limit" | "offset" | "cursorAfter"> = {}, max = 100000): Promise<Doc<T>[]> {
  const out: Doc<T>[] = [];
  let cursor: string | undefined;
  const pageSize = 1000;
  for (;;) {
    const res = await store.list<T>(collection, { ...opts, limit: pageSize, cursorAfter: cursor, total: false });
    out.push(...res.items);
    if (res.items.length < pageSize || out.length >= max) break;
    cursor = res.items[res.items.length - 1].id;
  }
  return out;
}

export async function findOne<T = any>(store: Store, collection: string, filters: Filter[]): Promise<Doc<T> | null> {
  const res = await store.list<T>(collection, { filters, limit: 1, total: false });
  return res.items[0] ?? null;
}

/**
 * Repete a função quando há conflito de concorrência (sequência ou transação),
 * com recuo exponencial curto. Conflitos de idempotência devem ser tratados pelo chamador.
 */
export async function retryOnConflict<R>(fn: () => Promise<R>, attempts = 6): Promise<R> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ConflictError) || e.reason === "bounds") throw e;
      last = e;
      await new Promise((r) => setTimeout(r, 15 * 2 ** i + Math.random() * 20));
    }
  }
  throw last;
}

// comparação estrutural além do instanceof: em desenvolvimento o store é um singleton em globalThis criado por outro
// grafo de módulos, e a classe lançada lá não é a mesma referência importada aqui
export function isConflict(e: unknown): e is ConflictError {
  return e instanceof ConflictError || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ConflictError");
}

export function isNotFound(e: unknown): e is NotFoundError {
  return e instanceof NotFoundError || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "NotFoundError");
}
