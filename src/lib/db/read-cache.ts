import { cache } from "react";
import type { Doc, ListOptions, ListResult, Store } from "./types";

/**
 * Camada de leitura rápida sobre o Store, sem mudar o resultado das regras de negócio:
 *
 * 1. Memória por requisição (React `cache`): durante a montagem de uma tela, a mesma consulta (mesma tabela e mesmos
 *    filtros) vai ao banco uma única vez — sessão, cabeçalho e página costumam repetir empresas, filiais, usuário e
 *    configurações. Fora da renderização do servidor (scripts, testes, tarefas) o `cache` do React não memoriza nada.
 * 2. Memória curta entre requisições (15 s, por instância) só para cadastros quase estáticos usados em toda tela.
 *
 * Qualquer gravação (create/update/delete/increment/transação) limpa a memória da requisição e as entradas da tabela
 * alterada; os resultados são entregues como cópias, para que um chamador não altere o objeto de outro.
 */
const SHARED_TTL_MS = 15_000;
const SHARED = new Set(["companies", "branches", "roles", "settings", "payment_methods"]);

const requestMemo = cache(() => new Map<string, Promise<unknown>>());
const shared = new Map<string, { until: number; value: Promise<unknown> }>();

function currentMemo(): Map<string, Promise<unknown>> | null {
  try {
    return requestMemo();
  } catch {
    return null;
  }
}

const copyDoc = <T>(d: Doc<T> | null): Doc<T> | null => (d ? { ...d } : d);
const copyList = <T>(r: ListResult<Doc<T>>): ListResult<Doc<T>> => ({ ...r, items: r.items.map((d) => ({ ...d })) });

function invalidate(collection?: string) {
  currentMemo()?.clear();
  if (!collection) return shared.clear();
  for (const k of shared.keys()) if (k.startsWith(`${collection}|`)) shared.delete(k);
}

function remember<R>(key: string, collection: string, load: () => Promise<R>): Promise<R> {
  const memo = currentMemo();
  const hit = memo?.get(key);
  if (hit) return hit as Promise<R>;
  let p: Promise<R>;
  const s = SHARED.has(collection) ? shared.get(key) : undefined;
  if (s && s.until > Date.now()) p = s.value as Promise<R>;
  else {
    p = load();
    if (SHARED.has(collection)) shared.set(key, { until: Date.now() + SHARED_TTL_MS, value: p });
    // falha não fica guardada
    p.catch(() => {
      memo?.delete(key);
      shared.delete(key);
    });
  }
  memo?.set(key, p);
  return p;
}

export class ReadCachedStore implements Store {
  constructor(readonly inner: Store) {}

  get backend() {
    return this.inner.backend;
  }

  async get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    return copyDoc(await remember(`${collection}|get|${id}`, collection, () => this.inner.get<T>(collection, id)));
  }

  async getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    const d = await this.get<T>(collection, id);
    if (d) return d;
    return this.inner.getOrThrow<T>(collection, id); // lança o erro padrão de "não encontrado"
  }

  async list<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    return copyList(await remember(`${collection}|list|${JSON.stringify(opts)}`, collection, () => this.inner.list<T>(collection, opts)));
  }

  async create<T = any>(collection: string, data: Partial<T> & Record<string, any>, id?: string) {
    invalidate(collection);
    try {
      return await this.inner.create<T>(collection, data, id);
    } finally {
      invalidate(collection);
    }
  }

  async update<T = any>(collection: string, id: string, patch: Partial<T> & Record<string, any>) {
    invalidate(collection);
    try {
      return await this.inner.update<T>(collection, id, patch);
    } finally {
      invalidate(collection);
    }
  }

  async delete(collection: string, id: string) {
    invalidate(collection);
    try {
      return await this.inner.delete(collection, id);
    } finally {
      invalidate(collection);
    }
  }

  async increment(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }) {
    invalidate(collection);
    try {
      return await this.inner.increment(collection, id, field, by, bounds);
    } finally {
      invalidate(collection);
    }
  }

  async transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    // dentro da transação as leituras vão direto ao banco; ao terminar, tudo o que estava em memória é descartado
    invalidate();
    try {
      return await this.inner.transaction(fn);
    } finally {
      invalidate();
    }
  }
}
