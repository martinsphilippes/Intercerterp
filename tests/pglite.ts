import { PGlite } from "@electric-sql/pglite";
import { pgDriver, type PgConn, type PgDriver } from "@/lib/db/postgres/driver";
import { PostgresStore } from "@/lib/db/postgres/store";

/**
 * Postgres de verdade dentro do processo de teste (PGlite), para exercitar o PostgresStore sem servidor — ou um
 * servidor Postgres, quando `TEST_PG_URL` aponta para um (mesmo cliente e mesmo conjunto de conexões de produção).
 *
 * Um único banco por processo de teste e um ESQUEMA por Store: cada `freshPostgresStore()` é um banco vazio e
 * independente (como cada `new MemoryStore()`), que continua valendo depois de outro ser criado. O PGlite tem uma
 * única sessão: a fila dá a cada comando — ou a cada transação inteira — a vez exclusiva, como uma conexão dedicada,
 * e a troca de esquema acontece dentro dessa vez.
 */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<R>(fn: () => Promise<R>): Promise<R> {
    const p = this.tail.then(fn, fn);
    this.tail = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}

const queue = new Queue();
let database: Promise<PGlite> | null = null;
let currentSchema = "";
let created = 0;

const conn = (db: PGlite): PgConn => ({
  query: async (text, params) => {
    const r = await db.query<Record<string, any>>(text, params as any[] | undefined);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  exec: async (sql) => {
    await db.exec(sql);
  },
});

/** Driver preso a um esquema: toda vez que pega a vez, garante que a sessão está olhando para o esquema dele. */
function schemaDriver(schema: string): PgDriver {
  let exists = false;
  const enter = async (): Promise<PgConn> => {
    database ??= PGlite.create();
    const db = await database;
    if (!exists) {
      await db.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      exists = true;
    }
    if (currentSchema !== schema) {
      await db.exec(`SET search_path TO "${schema}"`);
      currentSchema = schema;
    }
    return conn(db);
  };
  return {
    query: (text, params) => queue.run(async () => (await enter()).query(text, params)),
    exec: (sql) => queue.run(async () => (await enter()).exec(sql)),
    withConnection: (fn) => queue.run(async () => fn(await enter())),
    end: async () => undefined,
  };
}

/**
 * Servidor Postgres de verdade (`TEST_PG_URL`): o mesmo cliente de produção (`pg`, com conjunto de conexões), também
 * com um esquema por Store — o esquema é criado na primeira vez e cada conexão já abre olhando para ele.
 */
function serverDriver(url: string, schema: string): PgDriver {
  let ready: Promise<PgDriver> | null = null;
  const get = () =>
    (ready ??= (async () => {
      const admin = pgDriver(url);
      try {
        await admin.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      } finally {
        await admin.end();
      }
      const u = new URL(url);
      u.searchParams.set("options", `-c search_path=${schema}`);
      return pgDriver(u.toString());
    })());
  return {
    query: async (text, params) => (await get()).query(text, params),
    exec: async (sql) => (await get()).exec(sql),
    withConnection: async (fn) => (await get()).withConnection(fn),
    end: async () => (await get()).end(),
  };
}

/** Store sobre Postgres: banco vazio e isolado (as tabelas são criadas na primeira consulta). */
export function freshPostgresStore(): PostgresStore {
  const server = process.env.TEST_PG_URL;
  if (server) return new PostgresStore(serverDriver(server, `t${process.pid}_${Date.now().toString(36)}_${++created}`));
  return new PostgresStore(schemaDriver(`t${++created}`));
}
