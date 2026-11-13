import crypto from "node:crypto";
import { COLLECTIONS, type CollectionDef, type FieldDef } from "../schema";
import { normText } from "../norm";
import type { PgConn, PgDriver } from "./driver";

/**
 * Tabelas do ERP no Postgres, geradas do esquema único (src/lib/db/schema.ts) — uma tabela por coleção:
 *  - "id" (chave), "createdAt"/"updatedAt" (ISO-8601 UTC, texto) e "_seq" (ordem de inserção, a ordenação padrão);
 *  - texto, datas e instantes: `text COLLATE "C"` — comparação e ordenação por código do caractere, iguais às do
 *    armazenamento em memória usado nos testes (datas ISO e identificadores ordenam corretamente);
 *  - inteiros, centavos e milésimos: `bigint`; booleanos: `boolean`; listas de texto: `jsonb`;
 *  - JSON: texto serializado (mesma forma gravada antes; `coluna::jsonb` quando uma consulta precisar olhar dentro).
 * Índice único ignora valores nulos e vazios (como no armazenamento em memória).
 *
 * A criação é idempotente e só acrescenta (tabela, coluna e índice que faltam): roda sozinha na primeira consulta de
 * cada versão do esquema, dentro de uma transação com trava — duas instâncias subindo juntas não se atropelam.
 */

/** Muda quando a forma de gerar as tabelas muda (força nova conferência em instalações existentes). */
const DDL_VERSION = 2; // 2: tabela de arquivos guardados no próprio banco
export const META_TABLE = "_intercert_meta";
/**
 * Conteúdo dos arquivos (XML, anexos, cópias de segurança) quando não há Blob conectado: `src/lib/core/files.ts`.
 * Fica fora das coleções do ERP — o registro do arquivo (nome, tamanho, dono) continua na coleção `files`.
 */
export const FILES_TABLE = "_intercert_files";

export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export type ColumnKind = "text" | "int" | "bool" | "strings";

export function columnKind(f: FieldDef): ColumnKind {
  switch (f.type) {
    case "int":
    case "money":
    case "qty":
      return "int";
    case "bool":
      return "bool";
    case "strings":
      return "strings";
    default:
      return "text";
  }
}

const SQL_TYPE: Record<ColumnKind, string> = { text: 'text COLLATE "C"', int: "bigint", bool: "boolean", strings: "jsonb" };

/** Nome de índice: único no banco inteiro e limitado a 63 bytes pelo Postgres. */
export function indexName(table: string, key: string): string {
  const name = `${table}__${key}`;
  if (Buffer.byteLength(name) <= 63) return name;
  return `${table.slice(0, 40)}__${crypto.createHash("sha1").update(name).digest("hex").slice(0, 16)}`;
}

function kindOf(c: CollectionDef, field: string): ColumnKind {
  const f = c.fields[field];
  return f ? columnKind(f) : "text"; // id, createdAt e updatedAt
}

function createTable(c: CollectionDef): string {
  const cols = Object.entries(c.fields).map(([k, f]) => `${ident(k)} ${SQL_TYPE[columnKind(f)]}`);
  return `CREATE TABLE IF NOT EXISTS ${ident(c.id)} ("id" text COLLATE "C" PRIMARY KEY, "createdAt" text COLLATE "C" NOT NULL, "updatedAt" text COLLATE "C" NOT NULL, "_seq" bigserial${cols.length ? ", " + cols.join(", ") : ""})`;
}

function createIndexes(c: CollectionDef): string[] {
  const out = [`CREATE INDEX IF NOT EXISTS ${ident(indexName(c.id, "_seq"))} ON ${ident(c.id)} ("_seq")`];
  for (const ix of c.indexes ?? []) {
    const cols = ix.fields.map(ident).join(", ");
    if (ix.type !== "unique") {
      out.push(`CREATE INDEX IF NOT EXISTS ${ident(indexName(c.id, ix.key))} ON ${ident(c.id)} (${cols})`);
      continue;
    }
    // único só entre valores preenchidos: nulo ou vazio em qualquer campo deixa a linha fora do índice
    const filled = ix.fields.map((f) => (kindOf(c, f) === "text" ? `${ident(f)} IS NOT NULL AND ${ident(f)} <> ''` : `${ident(f)} IS NOT NULL`)).join(" AND ");
    out.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${ident(indexName(c.id, ix.key))} ON ${ident(c.id)} (${cols}) WHERE ${filled}`);
  }
  return out;
}

/**
 * Mapa das letras latinas (U+00C0–U+024F) para a forma usada nas buscas "contém"/"começa com": gerado da própria
 * `normText`, para a coluna (no banco) e o termo (na aplicação) seguirem exatamente a mesma regra — sem acento e em
 * minúscula. As letras ASCII ficam por conta do `lower()`, que não depende da localidade do banco.
 */
function accentMap(): { from: string; to: string } {
  let from = "";
  let to = "";
  for (let cp = 0x00c0; cp <= 0x024f; cp++) {
    const ch = String.fromCodePoint(cp);
    const base = String(normText(ch));
    if (base !== ch && [...base].length === 1 && base !== "'" && base !== "\\") {
      from += ch;
      to += base;
    }
  }
  return { from, to };
}

const ACCENTS = accentMap();

const NORM_FUNCTION = `CREATE OR REPLACE FUNCTION ic_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $ic$ SELECT lower(translate(t, '${ACCENTS.from}', '${ACCENTS.to}')) $ic$`;

/** Texto de conferência da busca sem acento: maiúsculas e minúsculas acentuadas do português e vizinhos. */
const SEARCH_PROBE = "ÁÉÍÓÚÂÊÔÃÕÀÇÜÑ áéíóúâêôãõàçüñ Conceição & Cia";

/**
 * A busca sem acento do banco dá o mesmo resultado que a da aplicação? `ic_norm` (coluna, no banco) e `normText`
 * (termo, na aplicação) têm de concordar, senão “contém” e “começa com” deixam de achar nomes com acento sem avisar.
 * Só concordam em banco UTF-8: em outra codificação o banco trata cada byte como uma letra.
 */
export async function searchNormalizationWorks(conn: PgConn): Promise<boolean> {
  const r = await conn.query("SELECT ic_norm($1::text) AS n", [SEARCH_PROBE]);
  return r.rows[0]?.n === normText(SEARCH_PROBE);
}

/** Codificação do banco (o sistema exige UTF8). */
export async function serverEncoding(conn: PgConn): Promise<string> {
  const r = await conn.query("SELECT current_setting('server_encoding') AS enc");
  return String(r.rows[0]?.enc ?? "");
}

/** Identidade do esquema desta versão do sistema (tabelas, colunas, tipos e índices). */
export function schemaSignature(): string {
  const shape = COLLECTIONS.map((c) => [c.id, Object.entries(c.fields).map(([k, f]) => [k, columnKind(f)]), (c.indexes ?? []).map((i) => [i.key, i.type, i.fields])]);
  return crypto.createHash("sha256").update(JSON.stringify([DDL_VERSION, ACCENTS, shape])).digest("hex").slice(0, 32);
}

/**
 * Cria o que falta (função de busca, tabelas, colunas e índices). Tudo numa transação: ou o esquema desta versão fica
 * completo, ou nada muda. Pode ser reexecutada à vontade.
 */
export async function provisionPostgres(driver: PgDriver, log: (m: string) => void = console.log): Promise<{ done: true; tables: number; total: number; addedColumns: number }> {
  return driver.withConnection(async (conn) => {
    await conn.query("BEGIN");
    try {
      // trava da transação: outra instância que esteja criando o esquema termina antes desta começar
      await conn.query("SELECT pg_advisory_xact_lock(727410, 1)");
      // o sistema grava e busca texto em UTF-8: recusa o banco antes de criar qualquer coisa nele
      const encoding = await serverEncoding(conn);
      if (encoding.toUpperCase() !== "UTF8") throw new Error(`O banco Postgres está na codificação "${encoding}" e o sistema exige UTF8 (nomes com acento e as buscas sem acento dependem disso). Crie o banco com a codificação UTF8.`);
      await conn.exec(
        `${NORM_FUNCTION}; CREATE TABLE IF NOT EXISTS ${ident(META_TABLE)} ("key" text PRIMARY KEY, "value" text NOT NULL); ` +
          `CREATE TABLE IF NOT EXISTS ${ident(FILES_TABLE)} ("id" text PRIMARY KEY, "bucket" text NOT NULL, "data" bytea NOT NULL, "createdAt" text NOT NULL)`,
      );
      if (!(await searchNormalizationWorks(conn))) throw new Error("A busca sem acento do banco não deu o mesmo resultado que a da aplicação: o esquema não foi criado. Confira a codificação do banco (UTF8) e a da conexão.");
      const existing = await conn.query(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()`);
      const have = new Map<string, Set<string>>();
      for (const r of existing.rows) (have.get(r.t) ?? have.set(r.t, new Set()).get(r.t)!).add(r.c);
      const ddl: string[] = [];
      let addedColumns = 0;
      for (const c of COLLECTIONS) {
        const cols = have.get(c.id);
        if (!cols) ddl.push(createTable(c));
        else {
          for (const [k, f] of Object.entries(c.fields)) {
            if (cols.has(k)) continue;
            ddl.push(`ALTER TABLE ${ident(c.id)} ADD COLUMN IF NOT EXISTS ${ident(k)} ${SQL_TYPE[columnKind(f)]}`);
            addedColumns++;
          }
        }
        ddl.push(...createIndexes(c));
      }
      // em lotes: uma ida ao banco para cada grupo de comandos
      for (let i = 0; i < ddl.length; i += 200) await conn.exec(ddl.slice(i, i + 200).join(";\n"));
      await conn.query(`INSERT INTO ${ident(META_TABLE)} ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`, [`schema:${schemaSignature()}`, new Date().toISOString()]);
      await conn.query("COMMIT");
      const created = COLLECTIONS.filter((c) => !have.has(c.id)).length;
      log(`esquema Postgres pronto: ${COLLECTIONS.length} tabelas (${created} criadas, ${addedColumns} colunas acrescentadas)`);
      return { done: true as const, tables: COLLECTIONS.length, total: COLLECTIONS.length, addedColumns };
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  });
}

/** O esquema desta versão já foi aplicado neste banco? (uma consulta curta por instância) */
export async function schemaApplied(driver: PgDriver): Promise<boolean> {
  try {
    const r = await driver.query(`SELECT 1 FROM ${ident(META_TABLE)} WHERE "key" = $1`, [`schema:${schemaSignature()}`]);
    return r.rows.length > 0;
  } catch (e) {
    if ((e as { code?: unknown })?.code === "42P01") return false; // tabela de controle ainda não existe: banco novo
    throw e;
  }
}

/** Garante o esquema antes da primeira consulta: confere a assinatura e cria o que faltar. */
export async function ensureSchema(driver: PgDriver): Promise<void> {
  if (await schemaApplied(driver)) return;
  await provisionPostgres(driver, (m) => console.log(`[postgres] ${m}`));
}
