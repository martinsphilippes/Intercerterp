import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Acesso ao Postgres por uma interface mínima, para o Store não depender do cliente usado:
 *  - produção e desenvolvimento: `pg` (node-postgres) com um conjunto de conexões por instância;
 *  - testes: Postgres embutido (PGlite), em `tests/pglite.ts`.
 */
export interface PgResult {
  rows: Record<string, any>[];
  rowCount: number;
}

export interface PgConn {
  query(text: string, params?: unknown[]): Promise<PgResult>;
  /** Vários comandos sem parâmetros numa única ida ao banco (criação de tabelas e índices). */
  exec(sql: string): Promise<void>;
}

export interface PgDriver extends PgConn {
  /** Conexão dedicada enquanto `fn` roda (transações: BEGIN … COMMIT na mesma conexão). */
  withConnection<R>(fn: (conn: PgConn) => Promise<R>): Promise<R>;
  /** Encerra as conexões (roteiros e troca de configuração em desenvolvimento). */
  end(): Promise<void>;
}

const result = (r: { rows?: unknown[]; rowCount?: number | null } | unknown[]): PgResult => {
  // comando múltiplo devolve uma lista de resultados: vale o último
  const one = Array.isArray(r) ? (r[r.length - 1] as { rows?: unknown[]; rowCount?: number | null }) : r;
  const rows = (one?.rows ?? []) as Record<string, any>[];
  return { rows, rowCount: one?.rowCount ?? rows.length };
};

/** URL do banco: a Vercel cria `DATABASE_URL` (e `POSTGRES_URL`) ao conectar um Postgres ao projeto. */
export function postgresUrl(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

/**
 * Do endereço do banco, só o que não é segredo: a região do provedor (ex.: `sa-east-1`) e se a conexão passa pelo
 * agrupador de conexões dele. Serve ao diagnóstico da instalação — banco longe da região das funções deixa cada tela
 * lenta, porque uma tela faz várias consultas em sequência.
 */
export function postgresEndpoint(url: string = postgresUrl()): { region: string | null; pooled: boolean } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // sem endereço (ou endereço inválido): nada a informar
  }
  const region =
    host.match(/\.([a-z0-9-]+)\.(?:aws|azure|gcp)\.neon\.tech$/)?.[1] ?? // Neon: <id>[-pooler].<região>.<nuvem>.neon.tech
    host.match(/(?:^|[.-])((?:us|eu|sa|ap|ca|me|af|il|mx)-(?:[a-z]+-)+\d)(?=[.-]|$)/)?.[1] ?? // demais: região no padrão da AWS em qualquer ponto
    null;
  return { region, pooled: /(^|[.-])pooler([.-]|$)/.test(host) };
}

/**
 * Conjunto de conexões do `pg`. Poucas conexões por instância e descarte rápido das ociosas: em funções da Vercel as
 * instâncias são suspensas entre requisições (`attachDatabasePool` fecha as ociosas antes da suspensão) e o banco
 * recomendado (Neon) já tem o seu próprio agrupador de conexões no endereço padrão.
 */
export function pgDriver(connectionString: string): PgDriver {
  const pool = new Pool({
    connectionString,
    max: Math.max(1, Number(process.env.PG_POOL_MAX ?? 5)),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });
  // conexão ociosa derrubada pelo servidor não pode virar exceção solta do processo
  pool.on("error", (e) => console.error("[postgres] conexão ociosa encerrada", e.message));
  if (process.env.VERCEL) attachDatabasePool(pool);
  const wrap = (c: Pool | PoolClient): PgConn => ({
    query: async (text, params) => result(await c.query(text, params as unknown[] | undefined)),
    exec: async (sql) => {
      await c.query(sql);
    },
  });
  return {
    ...wrap(pool),
    async withConnection(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        return await fn(wrap(client));
      } catch (e) {
        // erro de transporte no meio da conversa: a conexão não volta para o conjunto
        broken = typeof (e as { code?: unknown })?.code === "string" && /^(E[A-Z]+|08)/.test(String((e as { code: string }).code));
        throw e;
      } finally {
        client.release(broken);
      }
    },
    end: () => pool.end(),
  };
}
