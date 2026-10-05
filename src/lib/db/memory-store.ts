import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { getCollection, COLLECTIONS } from "./schema";
import { fromStored, toStored } from "./serialize";
import { ConflictError, Doc, Filter, ListOptions, ListResult, NotFoundError, Store } from "./types";
import { newId } from "./ids";

type Row = Record<string, any> & { id: string; createdAt: string; updatedAt: string; _seq: number };

interface TxState {
  store: MemoryStore;
  undo: Array<() => void>;
}

const txStorage = new AsyncLocalStorage<TxState>();

class Mutex {
  private queue: Promise<void> = Promise.resolve();
  run<R>(fn: () => Promise<R>): Promise<R> {
    const p = this.queue.then(fn, fn);
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}

function norm(v: any): any {
  if (typeof v === "string") return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return v;
}

function matches(row: Row, f: Filter): boolean {
  const [op] = f;
  if (op === "or") return f[1].some((g) => matches(row, g));
  if (op === "and") return f[1].every((g) => matches(row, g));
  const field = f[1] as string;
  const v = row[field];
  switch (op) {
    case "eq": {
      const target = f[2];
      if (Array.isArray(target)) return Array.isArray(v) ? v.some((x) => target.includes(x)) : target.includes(v);
      return Array.isArray(v) ? v.includes(target) : v === target;
    }
    case "ne":
      return v !== f[2];
    case "gt":
      return v != null && v > (f[2] as any);
    case "gte":
      return v != null && v >= (f[2] as any);
    case "lt":
      return v != null && v < (f[2] as any);
    case "lte":
      return v != null && v <= (f[2] as any);
    case "between":
      return v != null && v >= (f[2] as any) && v <= (f[3] as any);
    case "contains":
      if (Array.isArray(v)) return v.includes(f[2]);
      return v != null && String(norm(v)).includes(String(norm(f[2])));
    case "startsWith":
      return v != null && String(norm(v)).startsWith(String(norm(f[2])));
    case "isNull":
      return v == null;
    case "notNull":
      return v != null;
  }
  return false;
}

export class MemoryStore implements Store {
  readonly backend: "local" | "memory";
  private data = new Map<string, Map<string, Row>>();
  private mutex = new Mutex();
  private seq = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private dirty = new Set<string>();

  constructor(private readonly dir?: string) {
    this.backend = dir ? "local" : "memory";
    for (const c of COLLECTIONS) this.data.set(c.id, new Map());
    if (dir) this.load();
  }

  private load() {
    if (!this.dir) return;
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    for (const c of COLLECTIONS) {
      const file = path.join(this.dir, `${c.id}.json`);
      if (!fs.existsSync(file)) continue;
      const rows: Row[] = JSON.parse(fs.readFileSync(file, "utf8"));
      const map = this.data.get(c.id)!;
      for (const r of rows) {
        map.set(r.id, r);
        if (r._seq > this.seq) this.seq = r._seq;
      }
    }
  }

  private markDirty(collection: string) {
    if (!this.dir) return;
    this.dirty.add(collection);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    if (!this.dir) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const c of this.dirty) {
      const rows = [...this.data.get(c)!.values()];
      const file = path.join(this.dir, `${c}.json`);
      fs.writeFileSync(file + ".tmp", JSON.stringify(rows));
      fs.renameSync(file + ".tmp", file);
    }
    this.dirty.clear();
  }

  /** Limpa todos os dados (usado em testes e restauração em base de teste). */
  reset() {
    for (const c of COLLECTIONS) this.data.set(c.id, new Map());
    for (const c of COLLECTIONS) this.markDirty(c.id);
  }

  private coll(collection: string) {
    getCollection(collection);
    return this.data.get(collection)!;
  }

  private toDoc(collection: string, row: Row): Doc {
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, ...fromStored(collection, row) } as Doc;
  }

  private checkUnique(collection: string, row: Row, selfId?: string) {
    const def = getCollection(collection);
    for (const idx of def.indexes ?? []) {
      if (idx.type !== "unique") continue;
      const vals = idx.fields.map((f) => row[f]);
      if (vals.some((v) => v == null || v === "")) continue;
      for (const other of this.coll(collection).values()) {
        if (other.id === selfId) continue;
        if (idx.fields.every((f, i) => other[f] === vals[i])) {
          throw new ConflictError(`Registro duplicado em ${collection} (${idx.key})`, collection, "unique");
        }
      }
    }
  }

  private async write<R>(fn: (tx: TxState | null) => R): Promise<R> {
    const tx = txStorage.getStore();
    if (tx && tx.store === this) return fn(tx);
    return this.mutex.run(async () => fn(null));
  }

  async get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    const row = this.coll(collection).get(id);
    return row ? (this.toDoc(collection, row) as Doc<T>) : null;
  }

  async getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    const d = await this.get<T>(collection, id);
    if (!d) throw new NotFoundError(collection, id);
    return d;
  }

  async list<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    let rows = [...this.coll(collection).values()];
    for (const f of opts.filters ?? []) rows = rows.filter((r) => matches(r, f));
    const order = opts.orderBy?.length ? opts.orderBy : [{ field: "_seq", dir: "asc" as const }];
    rows.sort((a, b) => {
      for (const o of order) {
        const av = a[o.field];
        const bv = b[o.field];
        if (av === bv) continue;
        if (av == null) return o.dir === "desc" ? 1 : -1;
        if (bv == null) return o.dir === "desc" ? -1 : 1;
        const c = av < bv ? -1 : 1;
        return o.dir === "desc" ? -c : c;
      }
      return a._seq - b._seq;
    });
    const total = rows.length;
    let start = opts.offset ?? 0;
    if (opts.cursorAfter) {
      const i = rows.findIndex((r) => r.id === opts.cursorAfter);
      start = i >= 0 ? i + 1 : rows.length;
    }
    const limit = opts.limit ?? 25;
    const page = rows.slice(start, start + limit);
    return { items: page.map((r) => this.toDoc(collection, r) as Doc<T>), total };
  }

  async create<T = any>(collection: string, data: Record<string, any>, id?: string): Promise<Doc<T>> {
    return this.write((tx) => {
      const map = this.coll(collection);
      const docId = id ?? newId();
      if (map.has(docId)) throw new ConflictError(`Registro já existe (${collection}/${docId})`, collection, "duplicate_id");
      const now = new Date().toISOString();
      const stored = toStored(collection, data);
      const def = getCollection(collection);
      for (const [k, f] of Object.entries(def.fields)) if (f.required && (stored[k] == null || stored[k] === "")) throw new Error(`Campo obrigatório ausente: ${collection}.${k}`);
      const row: Row = { ...stored, id: docId, createdAt: now, updatedAt: now, _seq: ++this.seq };
      this.checkUnique(collection, row);
      map.set(docId, row);
      tx?.undo.push(() => map.delete(docId));
      this.markDirty(collection);
      return this.toDoc(collection, row) as Doc<T>;
    });
  }

  async update<T = any>(collection: string, id: string, patch: Record<string, any>): Promise<Doc<T>> {
    return this.write((tx) => {
      const map = this.coll(collection);
      const prev = map.get(id);
      if (!prev) throw new NotFoundError(collection, id);
      const row: Row = { ...prev, ...toStored(collection, patch), updatedAt: new Date().toISOString() };
      this.checkUnique(collection, row, id);
      map.set(id, row);
      tx?.undo.push(() => map.set(id, prev));
      this.markDirty(collection);
      return this.toDoc(collection, row) as Doc<T>;
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.write((tx) => {
      const map = this.coll(collection);
      const prev = map.get(id);
      if (!prev) return;
      map.delete(id);
      tx?.undo.push(() => map.set(id, prev));
      this.markDirty(collection);
    });
  }

  async increment(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }): Promise<Doc> {
    return this.write((tx) => {
      const map = this.coll(collection);
      const prev = map.get(id);
      if (!prev) throw new NotFoundError(collection, id);
      const next = (prev[field] ?? 0) + by;
      if (bounds?.min != null && next < bounds.min) throw new ConflictError(`Limite mínimo violado em ${collection}.${field}`, collection, "bounds");
      if (bounds?.max != null && next > bounds.max) throw new ConflictError(`Limite máximo violado em ${collection}.${field}`, collection, "bounds");
      const row: Row = { ...prev, [field]: next, updatedAt: new Date().toISOString() };
      map.set(id, row);
      tx?.undo.push(() => map.set(id, prev));
      this.markDirty(collection);
      return this.toDoc(collection, row);
    });
  }

  async transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    const current = txStorage.getStore();
    if (current && current.store === this) return fn(this);
    return this.mutex.run(async () => {
      const state: TxState = { store: this, undo: [] };
      try {
        return await txStorage.run(state, () => fn(this));
      } catch (e) {
        for (const u of state.undo.reverse()) u();
        throw e;
      }
    });
  }

  /** Exporta todas as linhas (backup). */
  dump(): Record<string, Row[]> {
    const out: Record<string, Row[]> = {};
    for (const [k, m] of this.data) out[k] = [...m.values()];
    return out;
  }
}
