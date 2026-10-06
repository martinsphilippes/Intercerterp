import { COLLECTION_MAP } from "./schema";
import { BusinessError } from "../core/errors";
import type { Doc, Filter, ListOptions, ListResult, Store } from "./types";

/**
 * Isolamento por empresa (defesa em profundidade).
 *
 * Envolve o Store do contexto de uma requisição/tarefa e garante, para toda tabela que tem `companyId`:
 *  - `get`/`getOrThrow`: registro de outra empresa é tratado como inexistente;
 *  - `list`: quando a consulta não restringe `companyId`, acrescenta o filtro da empresa ativa (ou registros globais);
 *  - `create`/`update`: recusa gravar `companyId` de outra empresa.
 * Registros globais (`companyId` nulo — ex.: artigos de ajuda) continuam visíveis. Chamados públicos
 * (tela de login) usam `companyId = "public"` e são visíveis apenas nas tabelas de suporte.
 * Operações deliberadamente multiempresa (criar empresa, administrar outra empresa autorizada)
 * usam `unscoped()` ou `ctxForCompany()` — sempre de forma explícita.
 */

const PUBLIC_OK = new Set(["tickets", "ticket_messages"]);

function hasCompany(collection: string) {
  return Boolean(COLLECTION_MAP[collection]?.fields.companyId);
}

function mentionsCompany(filters: Filter[] | undefined): boolean {
  for (const f of filters ?? []) {
    if (f[0] === "or" || f[0] === "and") {
      if (mentionsCompany(f[1] as Filter[])) return true;
    } else if (f[1] === "companyId") return true;
  }
  return false;
}

export class ScopedStore implements Store {
  constructor(
    readonly base: Store,
    readonly companyId: string,
  ) {}

  get backend() {
    return this.base.backend;
  }

  private visible(collection: string, doc: Doc | null): boolean {
    if (!doc || !hasCompany(collection)) return Boolean(doc);
    const c = (doc as any).companyId;
    return c == null || c === this.companyId || (c === "public" && PUBLIC_OK.has(collection));
  }

  private assertWritable(collection: string, data: Record<string, any>) {
    if (!hasCompany(collection) || !("companyId" in data)) return;
    const c = data.companyId;
    if (c == null || c === this.companyId || (c === "public" && PUBLIC_OK.has(collection))) return;
    throw new BusinessError("Operação bloqueada: o registro pertence a outra empresa.", "cross_company");
  }

  async get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    const d = await this.base.get<T>(collection, id);
    return this.visible(collection, d) ? d : null;
  }

  async getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    const d = await this.get<T>(collection, id);
    if (!d) {
      const { NotFoundError } = await import("./types");
      throw new NotFoundError(collection, id);
    }
    return d;
  }

  list<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    if (!hasCompany(collection) || mentionsCompany(opts.filters)) return this.base.list<T>(collection, opts);
    const scope: Filter = PUBLIC_OK.has(collection)
      ? ["or", [["eq", "companyId", [this.companyId, "public"]], ["isNull", "companyId"]]]
      : ["or", [["eq", "companyId", this.companyId], ["isNull", "companyId"]]];
    return this.base.list<T>(collection, { ...opts, filters: [...(opts.filters ?? []), scope] });
  }

  async create<T = any>(collection: string, data: Partial<T> & Record<string, any>, id?: string): Promise<Doc<T>> {
    this.assertWritable(collection, data);
    return this.base.create<T>(collection, data, id);
  }

  async update<T = any>(collection: string, id: string, patch: Partial<T> & Record<string, any>): Promise<Doc<T>> {
    this.assertWritable(collection, patch);
    return this.base.update<T>(collection, id, patch);
  }

  delete(collection: string, id: string): Promise<void> {
    return this.base.delete(collection, id);
  }

  increment(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }) {
    return this.base.increment(collection, id, field, by, bounds);
  }

  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    return this.base.transaction((t) => fn(t === this.base ? this : new ScopedStore(t, this.companyId)));
  }
}

/** Store restrito à empresa. */
export function scopeStore(store: Store, companyId: string): Store {
  if (!companyId) return store;
  const base = store instanceof ScopedStore ? store.base : store;
  return new ScopedStore(base, companyId);
}

/** Store sem restrição — uso explícito e auditado (ex.: criação de empresa). */
export function unscoped(store: Store): Store {
  return store instanceof ScopedStore ? store.base : store;
}
