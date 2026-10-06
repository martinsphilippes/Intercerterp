import { AppwriteException, Client, IndexType, Query, Storage, TablesDB } from "node-appwrite";
import { COLLECTIONS, type FieldDef } from "./schema";
import { BUCKETS, physicalBucket } from "../core/files";

/**
 * Provisiona (de forma idempotente) banco, tabelas, colunas, índices e buckets no Appwrite
 * a partir do esquema único (src/lib/db/schema.ts). Pode ser reexecutado após mudanças do esquema:
 * cria apenas o que estiver faltando.
 */
export async function provisionAppwrite(
  cfg: { endpoint: string; projectId: string; apiKey: string; databaseId: string },
  log: (m: string) => void = console.log,
  opts: { deadline?: number } = {},
): Promise<{ done: boolean; tables: number; total: number }> {
  const outOfTime = () => opts.deadline != null && Date.now() > opts.deadline;
  let tablesOk = 0;
  const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
  const db = new TablesDB(client);
  const storage = new Storage(client);
  const ignore409 = async <T,>(p: Promise<T>) => {
    try {
      return await p;
    } catch (e) {
      if (e instanceof AppwriteException && e.code === 409) return null;
      throw e;
    }
  };
  // Verifica antes de criar: em planos com limite de bancos (ex.: Appwrite Cloud gratuito, 1 banco), criar de novo um banco
  // já existente devolve "limite de bancos atingido" em vez de 409 — o provisionamento é retomável e não pode falhar aí.
  let dbExists = false;
  try {
    await db.get({ databaseId: cfg.databaseId });
    dbExists = true;
  } catch (e) {
    if (!(e instanceof AppwriteException && e.code === 404)) throw e;
  }
  if (!dbExists) {
    try {
      await ignore409(db.create({ databaseId: cfg.databaseId, name: "Intercert ERP" }));
    } catch (e: any) {
      if (e instanceof AppwriteException && /maximum number of databases/i.test(e.message)) {
        throw new Error(
          `O plano do Appwrite não permite criar outro banco de dados e o banco "${cfg.databaseId}" não existe neste projeto. Use o ID do banco já existente em APPWRITE_DATABASE_ID (Appwrite Console → Databases) ou faça upgrade do plano.`,
        );
      }
      throw e;
    }
  }
  log(`banco ${cfg.databaseId} ok`);
  const BIG = 9007199254740991;
  for (const c of COLLECTIONS) {
    if (outOfTime()) {
      log(`tempo esgotado — ${tablesOk}/${COLLECTIONS.length} tabelas prontas; execute novamente para continuar`);
      return { done: false, tables: tablesOk, total: COLLECTIONS.length };
    }
    await ignore409(db.createTable({ databaseId: cfg.databaseId, tableId: c.id, name: c.label, permissions: [], rowSecurity: false }));
    const existing = await db.listColumns({ databaseId: cfg.databaseId, tableId: c.id, queries: [Query.limit(500)] });
    const have = new Set(existing.columns.map((x: any) => x.key));
    for (const [key, f] of Object.entries(c.fields) as Array<[string, FieldDef]>) {
      if (have.has(key)) continue;
      const base = { databaseId: cfg.databaseId, tableId: c.id, key, required: false };
      switch (f.type) {
        case "string":
          await ignore409(db.createStringColumn({ ...base, size: f.size ?? 255 }));
          break;
        case "date":
          await ignore409(db.createStringColumn({ ...base, size: 10 }));
          break;
        case "text":
          await ignore409(db.createStringColumn({ ...base, size: 65535 }));
          break;
        case "json":
          await ignore409(db.createStringColumn({ ...base, size: 4000000 }));
          break;
        case "strings":
          await ignore409(db.createStringColumn({ ...base, size: 200, array: true }));
          break;
        case "int":
        case "money":
        case "qty":
          await ignore409(db.createIntegerColumn({ ...base, min: -BIG, max: BIG }));
          break;
        case "bool":
          await ignore409(db.createBooleanColumn({ ...base }));
          break;
        case "datetime":
          await ignore409(db.createDatetimeColumn({ ...base }));
          break;
      }
    }
    // aguarda colunas disponíveis antes dos índices
    for (let i = 0; i < 120; i++) {
      const cols = await db.listColumns({ databaseId: cfg.databaseId, tableId: c.id, queries: [Query.limit(500)] });
      const pending = cols.columns.filter((x: any) => x.status !== "available");
      const failed = cols.columns.filter((x: any) => x.status === "failed");
      if (failed.length) throw new Error(`Colunas com falha em ${c.id}: ${failed.map((x: any) => `${x.key} (${x.error})`).join(", ")}`);
      if (!pending.length) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const idx = await db.listIndexes({ databaseId: cfg.databaseId, tableId: c.id, queries: [Query.limit(100)] });
    const haveIdx = new Set(idx.indexes.map((x: any) => x.key));
    for (const ix of c.indexes ?? []) {
      if (haveIdx.has(ix.key)) continue;
      await ignore409(db.createIndex({ databaseId: cfg.databaseId, tableId: c.id, key: ix.key, type: ix.type === "unique" ? IndexType.Unique : IndexType.Key, columns: ix.fields.map((f) => (f === "createdAt" ? "$createdAt" : f)) }));
    }
    log(`tabela ${c.id} ok (${Object.keys(c.fields).length} colunas, ${(c.indexes ?? []).length} índices)`);
    tablesOk++;
  }
  for (const b of new Set(Object.values(BUCKETS).map(physicalBucket))) {
    try {
      await ignore409(storage.createBucket({ bucketId: b, name: b, permissions: [], fileSecurity: false, enabled: true, maximumFileSize: 30000000, encryption: true, antivirus: false }));
    } catch (e) {
      if (/maximum number of buckets/i.test(String((e as Error).message)))
        throw new Error("O plano do Appwrite não permite mais buckets. Defina APPWRITE_BUCKET_ID com o id de um bucket (existente ou novo) para guardar todos os arquivos nele.");
      throw e;
    }
    log(`bucket ${b} ok`);
  }
  // aguarda índices
  for (const c of COLLECTIONS) {
    for (let i = 0; i < 120; i++) {
      const idx = await db.listIndexes({ databaseId: cfg.databaseId, tableId: c.id, queries: [Query.limit(100)] });
      const failed = idx.indexes.filter((x: any) => x.status === "failed");
      if (failed.length) throw new Error(`Índices com falha em ${c.id}: ${failed.map((x: any) => `${x.key} (${x.error})`).join(", ")}`);
      if (idx.indexes.every((x: any) => x.status === "available")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log("provisionamento concluído");
  return { done: true, tables: tablesOk, total: COLLECTIONS.length };
}

/** Verifica se o banco do Appwrite já foi provisionado (todas as tabelas existem). */
export async function appwriteProvisionState(cfg: { endpoint: string; projectId: string; apiKey: string; databaseId: string }) {
  const db = new TablesDB(new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey));
  try {
    const res = await db.listTables({ databaseId: cfg.databaseId, queries: [Query.limit(500)] });
    const have = new Set(res.tables.map((t: any) => t.$id));
    const missing = COLLECTIONS.filter((c) => !have.has(c.id)).map((c) => c.id);
    return { reachable: true, provisioned: missing.length === 0, missing };
  } catch (e) {
    if (e instanceof AppwriteException && e.code === 404) return { reachable: true, provisioned: false, missing: COLLECTIONS.map((c) => c.id) };
    return { reachable: false, provisioned: false, missing: [], error: e instanceof Error ? e.message : String(e) };
  }
}
