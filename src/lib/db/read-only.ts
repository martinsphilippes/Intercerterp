import type { Doc, ListOptions, ListResult, Store } from "./types";
import { PermissionError } from "../core/errors";

/**
 * Store SOMENTE LEITURA: qualquer gravação lança erro. Usado quando um contexto consulta dados de outra empresa com
 * autorização limitada à consulta — ex.: o escritório contábil lendo a situação fiscal de um cliente vinculado.
 * Combina-se com o ScopedStore (restrição à empresa consultada) — nunca o substitui.
 */
export class ReadOnlyStore implements Store {
  constructor(readonly inner: Store) {}

  get backend() {
    return this.inner.backend;
  }

  get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    return this.inner.get<T>(collection, id);
  }

  getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    return this.inner.getOrThrow<T>(collection, id);
  }

  list<T = any>(collection: string, opts?: ListOptions): Promise<ListResult<Doc<T>>> {
    return this.inner.list<T>(collection, opts);
  }

  // recusa como promessa rejeitada (nunca lança de forma síncrona): chamadores com await/.catch tratam igual a outro erro
  private deny(): Promise<never> {
    return Promise.reject(new PermissionError("Esta consulta é somente leitura: dados de outra empresa não podem ser alterados daqui."));
  }

  create<T = any>(): Promise<Doc<T>> {
    return this.deny();
  }

  update<T = any>(): Promise<Doc<T>> {
    return this.deny();
  }

  delete(): Promise<void> {
    return this.deny();
  }

  increment(): Promise<Doc> {
    return this.deny();
  }

  transaction<R>(): Promise<R> {
    return this.deny();
  }
}

export function readOnly(store: Store): Store {
  return store instanceof ReadOnlyStore ? store : new ReadOnlyStore(store);
}
