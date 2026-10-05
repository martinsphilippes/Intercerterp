import { AppwriteException, Client, Query, TablesDB } from "node-appwrite";
import { getCollection } from "./schema";
import { fromStored, toStored } from "./serialize";
import { ConflictError, Doc, Filter, ListOptions, ListResult, NotFoundError, Store } from "./types";
import { newId } from "./ids";

const META: Record<string, string> = { id: "$id", createdAt: "$createdAt", updatedAt: "$updatedAt" };
const field = (f: string) => META[f] ?? f;

function toQuery(f: Filter): string {
  const [op] = f;
  switch (op) {
    case "or":
      return Query.or(f[1].map(toQuery));
    case "and":
      return Query.and(f[1].map(toQuery));
    case "eq": {
      const v = f[2];
      return Query.equal(field(f[1]), (Array.isArray(v) ? v : [v]) as any);
    }
    case "ne":
      return Query.notEqual(field(f[1]), f[2] as any);
    case "gt":
      return Query.greaterThan(field(f[1]), f[2]);
    case "gte":
      return Query.greaterThanEqual(field(f[1]), f[2]);
    case "lt":
      return Query.lessThan(field(f[1]), f[2]);
    case "lte":
      return Query.lessThanEqual(field(f[1]), f[2]);
    case "between":
      return Query.between(field(f[1]), f[2], f[3]);
    case "contains":
      return Query.contains(field(f[1]), f[2]);
    case "startsWith":
      return Query.startsWith(field(f[1]), f[2]);
    case "isNull":
      return Query.isNull(field(f[1]));
    case "notNull":
      return Query.isNotNull(field(f[1]));
  }
  throw new Error(`Filtro não suportado: ${String(op)}`);
}

function mapError(e: unknown, collection: string, id?: string): never {
  if (e instanceof AppwriteException) {
    if (e.code === 409 && e.type === "transaction_conflict") throw new ConflictError(e.message, collection, "tx_conflict");
    if (e.code === 409) throw new ConflictError(e.message, collection, "unique");
    if (e.code === 404 && id) throw new NotFoundError(collection, id);
    if (e.code === 400 && (e.type === "column_limit_exceeded" || e.type === "attribute_limit_exceeded")) {
      throw new ConflictError(e.message, collection, "bounds");
    }
    if (e.code === 400 && e.type === "transaction_limit_exceeded") {
      throw new Error("Operação excede o limite de 100 escritas por transação do Appwrite.");
    }
  }
  throw e;
}

export interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
}

export class AppwriteStore implements Store {
  readonly backend = "appwrite" as const;
  private db: TablesDB;

  constructor(
    private readonly cfg: AppwriteConfig,
    private readonly txId?: string,
    client?: Client,
  ) {
    const c = client ?? new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
    this.client = c;
    this.db = new TablesDB(c);
  }

  readonly client: Client;

  private toDoc(collection: string, row: any): Doc {
    return { id: row.$id, createdAt: row.$createdAt, updatedAt: row.$updatedAt, ...fromStored(collection, row) } as Doc;
  }

  async get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    getCollection(collection);
    try {
      const row = await this.db.getRow({ databaseId: this.cfg.databaseId, tableId: collection, rowId: id });
      return this.toDoc(collection, row) as Doc<T>;
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 404) return null;
      throw e;
    }
  }

  async getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    const d = await this.get<T>(collection, id);
    if (!d) throw new NotFoundError(collection, id);
    return d;
  }

  async list<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    getCollection(collection);
    const queries: string[] = (opts.filters ?? []).map(toQuery);
    for (const o of opts.orderBy ?? []) queries.push(o.dir === "desc" ? Query.orderDesc(field(o.field)) : Query.orderAsc(field(o.field)));
    queries.push(Query.limit(Math.min(opts.limit ?? 25, 5000)));
    if (opts.cursorAfter) queries.push(Query.cursorAfter(opts.cursorAfter));
    else if (opts.offset) queries.push(Query.offset(opts.offset));
    const res = await this.db.listRows({ databaseId: this.cfg.databaseId, tableId: collection, queries, total: opts.total !== false });
    return { items: res.rows.map((r) => this.toDoc(collection, r) as Doc<T>), total: res.total };
  }

  async create<T = any>(collection: string, data: Record<string, any>, id?: string): Promise<Doc<T>> {
    const rowId = id ?? newId();
    try {
      const row = await this.db.createRow({
        databaseId: this.cfg.databaseId,
        tableId: collection,
        rowId,
        data: toStored(collection, data),
        transactionId: this.txId,
      });
      if (this.txId) return { id: rowId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...fromStored(collection, toStored(collection, data)) } as Doc<T>;
      return this.toDoc(collection, row) as Doc<T>;
    } catch (e) {
      mapError(e, collection, rowId);
    }
  }

  async update<T = any>(collection: string, id: string, patch: Record<string, any>): Promise<Doc<T>> {
    try {
      const row = await this.db.updateRow({
        databaseId: this.cfg.databaseId,
        tableId: collection,
        rowId: id,
        data: toStored(collection, patch),
        transactionId: this.txId,
      });
      return this.toDoc(collection, row) as Doc<T>;
    } catch (e) {
      mapError(e, collection, id);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    try {
      await this.db.deleteRow({ databaseId: this.cfg.databaseId, tableId: collection, rowId: id, transactionId: this.txId });
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 404) return;
      throw e;
    }
  }

  async increment(collection: string, id: string, column: string, by: number, bounds?: { min?: number; max?: number }): Promise<Doc> {
    try {
      const base = { databaseId: this.cfg.databaseId, tableId: collection, rowId: id, column, transactionId: this.txId };
      const row =
        by >= 0
          ? await this.db.incrementRowColumn({ ...base, value: by, max: bounds?.max })
          : await this.db.decrementRowColumn({ ...base, value: -by, min: bounds?.min });
      return this.toDoc(collection, row);
    } catch (e) {
      mapError(e, collection, id);
    }
  }

  async transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    if (this.txId) return fn(this);
    const tx = await this.db.createTransaction({ ttl: 120 });
    const txStore = new AppwriteStore(this.cfg, tx.$id, this.client);
    try {
      const result = await fn(txStore);
      try {
        await this.db.updateTransaction({ transactionId: tx.$id, commit: true });
      } catch (e) {
        mapError(e, "transaction");
      }
      return result;
    } catch (e) {
      await this.db.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => undefined);
      throw e;
    }
  }
}
