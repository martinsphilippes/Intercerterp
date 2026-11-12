import { AsyncLocalStorage } from "node:async_hooks";
import { getCollection, type CollectionDef } from "../schema";
import { fromStored, toStored } from "../serialize";
import { ConflictError, type Doc, type Filter, type ListOptions, type ListResult, NotFoundError, type Store } from "../types";
import { newId } from "../ids";
import { normText } from "../norm";
import type { PgConn, PgDriver, PgResult } from "./driver";
import { columnKind, ensureSchema, ident, type ColumnKind } from "./ddl";

/**
 * Store sobre Postgres. Mesmo contrato e mesmo resultado do armazenamento em memória (a referência dos testes):
 * filtros, ordenação com nulos primeiro, paginação por posição ou cursor, índices únicos que ignoram vazio,
 * incremento atômico com limites e transações.
 *
 * Transações: BEGIN … COMMIT numa conexão dedicada, em READ COMMITTED — o modelo de concorrência do ERP é o de
 * contadores atômicos (`increment`), ids determinísticos e índices únicos, que esse nível atende sem abortar
 * transações concorrentes sobre o mesmo contador. Dentro do `fn` da transação, TODA operação do Store (inclusive as
 * feitas pelo Store de fora, e não só pelo `tx` recebido) usa a conexão da transação: enxerga as próprias gravações e
 * nunca espera por uma trava que a própria transação segura.
 */

interface TxState {
  root: PostgresStore;
  conn: PgConn;
  done: boolean;
  savepoints: number;
  /** Fila das operações da transação: uma por vez na conexão dela (ver `step`). */
  queue: Promise<unknown>;
  /** A transação está sendo desfeita: o que ainda espera na fila não começa. */
  closing: boolean;
  /** Erro do banco que abortou a transação (ver `run` e a confirmação em `transaction`). */
  failed: { error: unknown } | null;
}

const txContext = new AsyncLocalStorage<TxState>();
/** Marca o fluxo que já está dentro de uma operação da transação (operação que chama outra não espera por si mesma). */
const stepContext = new AsyncLocalStorage<TxState>();
const noop = () => undefined;

const META_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

interface TableInfo {
  def: CollectionDef;
  kinds: Map<string, ColumnKind>;
  intFields: string[];
  uniqueFields: Set<string>;
}

const tables = new Map<string, TableInfo>();

function table(collection: string): TableInfo {
  let t = tables.get(collection);
  if (t) return t;
  const def = getCollection(collection);
  const kinds = new Map<string, ColumnKind>([...META_FIELDS].map((f) => [f, "text" as ColumnKind]));
  for (const [k, f] of Object.entries(def.fields)) kinds.set(k, columnKind(f));
  t = {
    def,
    kinds,
    intFields: [...kinds].filter(([, kind]) => kind === "int").map(([k]) => k),
    uniqueFields: new Set((def.indexes ?? []).filter((i) => i.type === "unique").flatMap((i) => i.fields)),
  };
  tables.set(collection, t);
  return t;
}

/** Monta o comando com parâmetros numerados ($1, $2, …). */
class Sql {
  readonly params: unknown[] = [];
  p(v: unknown, cast = ""): string {
    this.params.push(v);
    return `$${this.params.length}${cast}`;
  }
}

/** O valor pode ser comparado com a coluna? (igualdade estrita do armazenamento em memória: tipos diferentes nunca casam) */
function fits(kind: ColumnKind, v: unknown): boolean {
  if (kind === "text") return typeof v === "string";
  if (kind === "int") return typeof v === "number" && Number.isFinite(v);
  if (kind === "bool") return typeof v === "boolean";
  return false;
}

/** Parâmetro de comparação: inteiro usa o índice da coluna; número com casas decimais compara como numérico. */
const cmp = (sql: Sql, kind: ColumnKind, v: unknown) => (kind === "int" ? sql.p(v, Number.isInteger(v) ? "::bigint" : "::numeric") : sql.p(v));

const hasElement = (sql: Sql, col: string, v: string) => `${col} @> jsonb_build_array(${sql.p(v, "::text")})`;

function where(t: TableInfo, f: Filter, sql: Sql): string {
  const [op] = f;
  if (op === "or") return f[1].length ? `(${f[1].map((g) => where(t, g, sql)).join(" OR ")})` : "FALSE";
  if (op === "and") return f[1].length ? `(${f[1].map((g) => where(t, g, sql)).join(" AND ")})` : "TRUE";
  const field = f[1] as string;
  const kind = t.kinds.get(field);
  // campo fora do esquema nunca tem valor (como no armazenamento em memória)
  if (!kind) return op === "ne" || op === "isNull" ? "TRUE" : "FALSE";
  const col = ident(field);
  if (op === "isNull") return `${col} IS NULL`;
  if (op === "notNull") return `${col} IS NOT NULL`;

  if (kind === "strings") {
    // lista de textos: "igual"/"contém" = a lista tem o elemento
    switch (op) {
      case "eq": {
        const target = f[2];
        if (Array.isArray(target)) {
          const any = target.filter((x): x is string => typeof x === "string").map((x) => hasElement(sql, col, x));
          return any.length ? `(${any.join(" OR ")})` : "FALSE";
        }
        if (target === null) return `${col} IS NULL`;
        return typeof target === "string" ? hasElement(sql, col, target) : "FALSE";
      }
      case "contains":
        return typeof f[2] === "string" ? hasElement(sql, col, f[2]) : "FALSE";
      case "ne":
        return "TRUE";
      default:
        return "FALSE";
    }
  }

  switch (op) {
    case "eq": {
      const target = f[2];
      if (Array.isArray(target)) {
        const parts: string[] = [];
        const vals = target.filter((x) => fits(kind, x));
        if (vals.length) parts.push(`${col} IN (${vals.map((x) => cmp(sql, kind, x)).join(", ")})`);
        if (target.includes(null)) parts.push(`${col} IS NULL`);
        return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
      }
      if (target === null) return `${col} IS NULL`;
      return fits(kind, target) ? `${col} = ${cmp(sql, kind, target)}` : "FALSE";
    }
    case "ne": {
      const target = f[2];
      if (target === null) return `${col} IS NOT NULL`;
      return fits(kind, target) ? `${col} IS DISTINCT FROM ${cmp(sql, kind, target)}` : "TRUE";
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (!fits(kind, f[2])) return "FALSE";
      const sign = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
      return `${col} ${sign} ${cmp(sql, kind, f[2])}`;
    }
    case "between":
      if (!fits(kind, f[2]) || !fits(kind, f[3])) return "FALSE";
      return `(${col} >= ${cmp(sql, kind, f[2])} AND ${col} <= ${cmp(sql, kind, f[3])})`;
    case "contains":
      // sem acentos e sem diferença de maiúsculas; posição em vez de LIKE (o termo não tem curingas)
      return `strpos(ic_norm(${col}::text), ${sql.p(String(normText(f[2])), "::text")}) > 0`;
    case "startsWith":
      return `starts_with(ic_norm(${col}::text), ${sql.p(String(normText(f[2])), "::text")})`;
  }
  return "FALSE";
}

function mapError(e: unknown, collection: string): never {
  const code = (e as { code?: unknown })?.code;
  const message = String((e as { message?: unknown })?.message ?? e);
  if (code === "23505") throw new ConflictError(`Registro duplicado em ${collection} (${String((e as { constraint?: unknown })?.constraint ?? "índice único")})`, collection, "unique");
  // serialização ou impasse entre transações: quem chamou repete (retryOnConflict)
  if (code === "40001" || code === "40P01") throw new ConflictError(`Conflito na transação: ${message}`, collection, "tx_conflict");
  throw e;
}

export class PostgresStore implements Store {
  readonly backend = "postgres" as const;
  private readyPromise: Promise<void> | null = null;

  constructor(readonly driver: PgDriver) {}

  /** Esquema conferido (e criado, se preciso) antes da primeira consulta desta instância. */
  ready(): Promise<void> {
    this.readyPromise ??= ensureSchema(this.driver).catch((e) => {
      this.readyPromise = null; // falha passageira: a próxima consulta tenta de novo
      throw e;
    });
    return this.readyPromise;
  }

  private activeTx(): TxState | null {
    const tx = txContext.getStore();
    return tx && tx.root === this && !tx.done ? tx : null;
  }

  /** Há uma transação deste Store em andamento neste fluxo? (a camada de memória de leitura não guarda nada nesse caso) */
  inTransaction(): boolean {
    return this.activeTx() !== null;
  }

  private async run(text: string, params?: unknown[]) {
    const tx = this.activeTx();
    if (tx) {
      try {
        return await tx.conn.query(text, params);
      } catch (e) {
        // erro do banco no meio da transação: o Postgres já a abortou, mesmo que quem chamou trate o erro e siga
        tx.failed ??= { error: e };
        throw e;
      }
    }
    await this.ready();
    return this.driver.query(text, params);
  }

  /**
   * Dentro de uma transação todas as operações usam a mesma conexão: passam uma por vez, cada uma até o fim. As que
   * forem disparadas em paralelo (`Promise.all` dentro do `fn`) entram na fila — o banco atende um comando por vez em
   * cada conexão, e uma operação de vários comandos (o ponto de salvamento da atualização de campo único) não pode ser
   * atravessada por outra. Fora de transação cada operação pega a própria conexão do conjunto e nada muda.
   */
  private step<R>(fn: () => Promise<R>): Promise<R> {
    const tx = this.activeTx();
    if (!tx || stepContext.getStore() === tx) return fn();
    const p = tx.queue.then(() => {
      // a transação foi desfeita enquanto esta operação esperava a vez: ela não roda — nem aqui, nem fora da transação
      if (tx.closing) throw new Error("A transação foi desfeita antes de esta operação começar.");
      return stepContext.run(tx, fn);
    });
    tx.queue = p.then(noop, noop);
    return p;
  }

  /** Espera a fila da transação esvaziar (operações em andamento e as que elas ainda enfileirarem). */
  private async drain(tx: TxState): Promise<void> {
    let seen: Promise<unknown>;
    do {
      seen = tx.queue;
      await seen;
    } while (seen !== tx.queue);
  }

  private toDoc(collection: string, row: Record<string, any>): Doc {
    const t = table(collection);
    // bigint chega como texto (pg) ou BigInt (PGlite): os valores do ERP cabem no inteiro seguro do JavaScript
    for (const k of t.intFields) if (row[k] != null && typeof row[k] !== "number") row[k] = Number(row[k]);
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, ...fromStored(collection, row) } as Doc;
  }

  /** Valor na forma gravada (`toStored`) → parâmetro do comando. */
  private param(sql: Sql, t: TableInfo, key: string, value: unknown): string {
    if (value === null) return sql.p(null);
    const kind = t.kinds.get(key)!;
    if (kind === "strings") return sql.p(JSON.stringify(value), "::jsonb");
    if (kind === "text") return sql.p(value instanceof Date ? value.toISOString() : typeof value === "string" ? value : String(value));
    return sql.p(value);
  }

  // Operações do contrato `Store`: cada uma passa pela fila da transação em andamento, quando há uma (`step`).
  get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    return this.step(() => this.readOne<T>(collection, id));
  }

  list<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    return this.step(() => this.readMany<T>(collection, opts));
  }

  create<T = any>(collection: string, data: Record<string, any>, id?: string): Promise<Doc<T>> {
    return this.step(() => this.insertOne<T>(collection, data, id));
  }

  update<T = any>(collection: string, id: string, patch: Record<string, any>): Promise<Doc<T>> {
    return this.step(() => this.updateOne<T>(collection, id, patch));
  }

  delete(collection: string, id: string): Promise<void> {
    return this.step(() => this.deleteOne(collection, id));
  }

  increment(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }): Promise<Doc> {
    return this.step(() => this.incrementOne(collection, id, field, by, bounds));
  }

  private async readOne<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    table(collection);
    const r = await this.run(`SELECT * FROM ${ident(collection)} WHERE "id" = $1`, [id]);
    return r.rows[0] ? (this.toDoc(collection, r.rows[0]) as Doc<T>) : null;
  }

  async getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    const d = await this.get<T>(collection, id);
    if (!d) throw new NotFoundError(collection, id);
    return d;
  }

  private async readMany<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    const t = table(collection);
    const tbl = ident(collection);
    const sql = new Sql();
    const conds = (opts.filters ?? []).map((f) => where(t, f, sql));
    const filter = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
    const filterParams = sql.params.length;
    // nulos primeiro na ordem crescente e por último na decrescente; empate pela ordem de inserção
    const order = (opts.orderBy ?? [])
      .filter((o) => t.kinds.has(o.field) && t.kinds.get(o.field) !== "strings")
      .map((o) => `${ident(o.field)} ${o.dir === "desc" ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`);
    const orderBy = [...order, `"_seq" ASC`].join(", ");
    const limit = sql.p(Math.max(0, Math.trunc(opts.limit ?? 25)), "::bigint");
    const wantTotal = opts.total !== false;
    const totalCol = wantTotal ? `, count(*) OVER() AS "__total"` : "";
    let text: string;
    if (opts.cursorAfter) {
      if (!order.length) {
        // ordem padrão: continua depois da posição do registro do cursor
        text = `SELECT *${totalCol} FROM ${tbl}${filter} ORDER BY ${orderBy}`;
        text = `SELECT * FROM (${text}) AS "page" WHERE "_seq" > (SELECT "_seq" FROM ${tbl} WHERE "id" = ${sql.p(opts.cursorAfter)}) ORDER BY "_seq" ASC LIMIT ${limit}`;
      } else {
        // ordem escolhida: numera o resultado filtrado e continua depois da linha do cursor
        text = `WITH "ordered" AS (SELECT *, row_number() OVER (ORDER BY ${orderBy}) AS "__rn"${totalCol} FROM ${tbl}${filter}) SELECT * FROM "ordered" WHERE "__rn" > (SELECT "__rn" FROM "ordered" WHERE "id" = ${sql.p(opts.cursorAfter)}) ORDER BY "__rn" LIMIT ${limit}`;
      }
    } else {
      const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
      text = `SELECT *${totalCol} FROM ${tbl}${filter} ORDER BY ${orderBy} LIMIT ${limit}${offset ? ` OFFSET ${sql.p(offset, "::bigint")}` : ""}`;
    }
    const r = await this.run(text, sql.params);
    const items = r.rows.map((row) => this.toDoc(collection, row) as Doc<T>);
    if (!wantTotal) return { items, total: items.length };
    if (r.rows.length) return { items, total: Number(r.rows[0].__total) };
    // página vazia não traz o total junto: só conta de novo quando pode haver linhas fora da página
    if (!opts.cursorAfter && !opts.offset && (opts.limit ?? 25) > 0) return { items, total: 0 };
    const c = await this.run(`SELECT count(*) AS "n" FROM ${tbl}${filter}`, sql.params.slice(0, filterParams));
    return { items, total: Number(c.rows[0]?.n ?? 0) };
  }

  private async insertOne<T = any>(collection: string, data: Record<string, any>, id?: string): Promise<Doc<T>> {
    const t = table(collection);
    const stored = toStored(collection, data);
    for (const [k, f] of Object.entries(t.def.fields)) if (f.required && (stored[k] == null || stored[k] === "")) throw new Error(`Campo obrigatório ausente: ${collection}.${k}`);
    const docId = id ?? newId();
    const now = new Date().toISOString();
    const sql = new Sql();
    const cols = ["id", "createdAt", "updatedAt", ...Object.keys(stored)];
    const vals = [sql.p(docId), sql.p(now), sql.p(now), ...Object.entries(stored).map(([k, v]) => this.param(sql, t, k, v))];
    // conflito não vira erro do banco (uma transação continuaria abortada): nenhuma linha gravada = já existe
    const r = await this.run(`INSERT INTO ${ident(collection)} (${cols.map(ident).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING RETURNING *`, sql.params).catch((e) => mapError(e, collection));
    if (!r.rows[0]) {
      const same = await this.run(`SELECT 1 FROM ${ident(collection)} WHERE "id" = $1`, [docId]);
      if (same.rows.length) throw new ConflictError(`Registro já existe (${collection}/${docId})`, collection, "duplicate_id");
      throw new ConflictError(`Registro duplicado em ${collection} (índice único)`, collection, "unique");
    }
    return this.toDoc(collection, r.rows[0]) as Doc<T>;
  }

  private async updateOne<T = any>(collection: string, id: string, patch: Record<string, any>): Promise<Doc<T>> {
    const t = table(collection);
    const stored = toStored(collection, patch);
    const sql = new Sql();
    const sets = Object.entries(stored).map(([k, v]) => `${ident(k)} = ${this.param(sql, t, k, v)}`);
    sets.push(`"updatedAt" = ${sql.p(new Date().toISOString())}`);
    const text = `UPDATE ${ident(collection)} SET ${sets.join(", ")} WHERE "id" = ${sql.p(id)} RETURNING *`;
    const tx = this.activeTx();
    let r: PgResult;
    if (tx && Object.keys(stored).some((k) => t.uniqueFields.has(k))) {
      // dentro da transação, a violação de índice único é desfeita até o ponto de salvamento: a transação continua válida
      const sp = `"u${++tx.savepoints}"`;
      await tx.conn.query(`SAVEPOINT ${sp}`);
      try {
        r = await tx.conn.query(text, sql.params);
        await tx.conn.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e) {
        // desfeito até o ponto de salvamento a transação segue válida; se nem isso der, ela está abortada
        await tx.conn.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch((undo) => void (tx.failed ??= { error: undo }));
        mapError(e, collection);
      }
    } else r = await this.run(text, sql.params).catch((e) => mapError(e, collection));
    if (!r.rows[0]) throw new NotFoundError(collection, id);
    return this.toDoc(collection, r.rows[0]) as Doc<T>;
  }

  private async deleteOne(collection: string, id: string): Promise<void> {
    table(collection);
    await this.run(`DELETE FROM ${ident(collection)} WHERE "id" = $1`, [id]);
  }

  private async incrementOne(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }): Promise<Doc> {
    const t = table(collection);
    if (t.kinds.get(field) !== "int") throw new Error(`Campo ${collection}.${field} não é numérico (incremento)`);
    if (!Number.isInteger(by)) throw new Error(`Incremento de ${collection}.${field} exige inteiro (recebido ${String(by)})`);
    const col = ident(field);
    const sql = new Sql();
    const delta = sql.p(by, "::bigint");
    const next = `COALESCE(${col}, 0) + ${delta}`;
    const conds = [`"id" = ${sql.p(id)}`];
    if (bounds?.min != null) conds.push(`${next} >= ${sql.p(bounds.min, "::numeric")}`);
    if (bounds?.max != null) conds.push(`${next} <= ${sql.p(bounds.max, "::numeric")}`);
    const r = await this.run(`UPDATE ${ident(collection)} SET ${col} = ${next}, "updatedAt" = ${sql.p(new Date().toISOString())} WHERE ${conds.join(" AND ")} RETURNING *`, sql.params);
    if (r.rows[0]) return this.toDoc(collection, r.rows[0]);
    const cur = await this.run(`SELECT ${col} AS "v" FROM ${ident(collection)} WHERE "id" = $1`, [id]);
    if (!cur.rows.length) throw new NotFoundError(collection, id);
    const value = Number(cur.rows[0].v ?? 0) + by;
    if (bounds?.min != null && value < bounds.min) throw new ConflictError(`Limite mínimo violado em ${collection}.${field}`, collection, "bounds");
    throw new ConflictError(`Limite máximo violado em ${collection}.${field}`, collection, "bounds");
  }

  async transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    if (this.activeTx()) return fn(this); // aninhada: faz parte da transação em andamento
    await this.ready();
    return this.driver.withConnection(async (conn) => {
      const state: TxState = { root: this, conn, done: false, savepoints: 0, queue: Promise.resolve(), closing: false, failed: null };
      await conn.query(`BEGIN ISOLATION LEVEL ${ISOLATION}`);
      try {
        const out = await txContext.run(state, () => fn(this));
        await this.drain(state); // operação disparada sem esperar termina antes da confirmação
        // Transação abortada pelo banco não se confirma: o Postgres responderia ao COMMIT desfazendo tudo, sem erro —
        // quem chamou receberia "feito" sem nada gravado. O erro que a abortou sobe, mesmo que tenha sido tratado lá dentro.
        if (state.failed) throw state.failed.error;
        state.done = true; // a partir da confirmação, operação nova (trabalho solto) usa o conjunto de conexões
        await conn.query("COMMIT");
        return out;
      } catch (e) {
        // Nada mais começa nesta transação, e a operação em andamento termina antes de desfazer e devolver a conexão:
        // operação que sobrasse na fila não pode rodar depois, fora da transação, como se fosse avulsa.
        state.closing = true;
        await this.drain(state);
        state.done = true;
        await conn.query("ROLLBACK").catch(noop);
        return mapError(e, "transaction");
      } finally {
        state.done = true; // trabalho solto que sobreviver à transação volta a usar o conjunto de conexões
      }
    });
  }
}

/** READ COMMITTED por padrão; `PG_TX_ISOLATION` aceita REPEATABLE READ ou SERIALIZABLE (conflitos viram nova tentativa). */
const ISOLATION = (() => {
  const v = (process.env.PG_TX_ISOLATION ?? "").trim().toUpperCase();
  return v === "REPEATABLE READ" || v === "SERIALIZABLE" ? v : "READ COMMITTED";
})();
