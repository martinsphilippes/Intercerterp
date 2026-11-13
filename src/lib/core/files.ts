import fs from "node:fs";
import path from "node:path";
import { Client, Storage, AppwriteException } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { configuredBackend, appwriteConfig, newId, sha256, postgresStore } from "../db";
import { FILES_TABLE } from "../db/postgres/ddl";
import type { Ctx } from "./ctx";

/**
 * Armazenamento de arquivos (XML, DANFE, anexos, backups). No Postgres: Vercel Blob privado quando conectado ao projeto
 * e, sem ele, o próprio banco — a instalação funciona só com o banco. Instalações antigas: Appwrite Storage.
 * Desenvolvimento e testes: disco local ou memória.
 */
export interface FileStorage {
  readonly kind: "blob" | "postgres" | "appwrite" | "local" | "memory";
  put(bucket: string, name: string, data: Buffer, mime: string): Promise<string>;
  get(bucket: string, storageId: string): Promise<Buffer>;
  remove(bucket: string, storageId: string): Promise<void>;
}

export const BUCKETS = { documents: "documents", attachments: "attachments", backups: "backups", images: "images" } as const;

/**
 * Bucket físico no Appwrite. Planos com limite de buckets (o gratuito permite um) definem APPWRITE_BUCKET_ID e todos os
 * buckets lógicos passam a usar esse único bucket; o metadado do arquivo continua guardando o bucket lógico.
 */
export function physicalBucket(bucket: string) {
  return process.env.APPWRITE_BUCKET_ID?.trim() || bucket;
}

class LocalFileStorage implements FileStorage {
  readonly kind: "local" | "memory";
  private mem = new Map<string, Buffer>();
  constructor(private dir?: string) {
    this.kind = dir ? "local" : "memory";
  }
  async put(bucket: string, _name: string, data: Buffer) {
    const id = newId();
    if (!this.dir) this.mem.set(`${bucket}/${id}`, data);
    else {
      const d = path.join(this.dir, bucket);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, id), data);
    }
    return id;
  }
  async get(bucket: string, id: string) {
    if (!this.dir) {
      const b = this.mem.get(`${bucket}/${id}`);
      if (!b) throw new Error("Arquivo não encontrado");
      return b;
    }
    return fs.readFileSync(path.join(this.dir, bucket, id));
  }
  async remove(bucket: string, id: string) {
    if (!this.dir) this.mem.delete(`${bucket}/${id}`);
    else fs.rmSync(path.join(this.dir, bucket, id), { force: true });
  }
}

class AppwriteFileStorage implements FileStorage {
  readonly kind = "appwrite" as const;
  private storage: Storage;
  constructor() {
    const cfg = appwriteConfig();
    this.storage = new Storage(new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey));
  }
  async put(bucket: string, name: string, data: Buffer) {
    const id = newId();
    await this.storage.createFile({ bucketId: physicalBucket(bucket), fileId: id, file: InputFile.fromBuffer(data, name) });
    return id;
  }
  async get(bucket: string, id: string) {
    const ab = await this.storage.getFileDownload({ bucketId: physicalBucket(bucket), fileId: id });
    return Buffer.from(ab as ArrayBuffer);
  }
  async remove(bucket: string, id: string) {
    try {
      await this.storage.deleteFile({ bucketId: physicalBucket(bucket), fileId: id });
    } catch (e) {
      if (!(e instanceof AppwriteException && e.code === 404)) throw e;
    }
  }
}

/** O projeto tem um Blob conectado? (a Vercel cria `BLOB_READ_WRITE_TOKEN` ao conectar o armazenamento ao projeto) */
export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

/**
 * Vercel Blob em modo PRIVADO: o arquivo só sai pelo servidor, com a credencial do projeto — nunca por endereço público.
 * As telas continuam baixando por `/api/files/[id]`, que confere empresa e permissão antes de ler daqui.
 * Caminho: `<bucket lógico>/<id>` (o nome original fica só no registro de metadados, tabela `files`).
 */
class VercelBlobStorage implements FileStorage {
  readonly kind = "blob" as const;
  private path = (bucket: string, id: string) => `${bucket}/${id}`;
  async put(bucket: string, _name: string, data: Buffer, mime: string) {
    const { put } = await import("@vercel/blob");
    const id = newId();
    await put(this.path(bucket, id), data, { access: "private", addRandomSuffix: false, contentType: mime || "application/octet-stream" });
    return id;
  }
  async get(bucket: string, id: string) {
    const { get } = await import("@vercel/blob");
    // direto da origem: documento fiscal e cópia de segurança não passam por cache
    const r = await get(this.path(bucket, id), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) throw new Error("Arquivo não encontrado");
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  async remove(bucket: string, id: string) {
    const { del } = await import("@vercel/blob");
    await del(this.path(bucket, id));
  }
}

/**
 * Arquivos no próprio banco Postgres (tabela `_intercert_files`): o destino quando não há Blob conectado. Grava pelo
 * mesmo caminho das operações do Store — dentro de uma transação o arquivo entra nela: se a transação for desfeita, o
 * arquivo não fica para trás; se for confirmada, o registro em `files` nunca aponta para um arquivo que não existe.
 */
class PostgresFileStorage implements FileStorage {
  readonly kind = "postgres" as const;
  private db() {
    const store = postgresStore();
    if (!store) throw new Error("Arquivos no banco exigem o armazenamento Postgres.");
    return store;
  }
  async put(bucket: string, _name: string, data: Buffer) {
    const id = newId();
    await this.db().sql(`INSERT INTO "${FILES_TABLE}" ("id", "bucket", "data", "createdAt") VALUES ($1, $2, $3, $4)`, [id, bucket, data, new Date().toISOString()]);
    return id;
  }
  async get(bucket: string, id: string) {
    const r = await this.db().sql(`SELECT "data" FROM "${FILES_TABLE}" WHERE "id" = $1 AND "bucket" = $2`, [id, bucket]);
    if (!r.rows[0]) throw new Error("Arquivo não encontrado");
    return Buffer.from(r.rows[0].data as Uint8Array);
  }
  async remove(bucket: string, id: string) {
    await this.db().sql(`DELETE FROM "${FILES_TABLE}" WHERE "id" = $1 AND "bucket" = $2`, [id, bucket]);
  }
}

/** Identificador de arquivo guardado no banco: o prefixo diz onde o conteúdo está (sem prefixo: Blob). */
const IN_DATABASE = "db:";

/**
 * Arquivos do backend Postgres. Com Blob privado conectado ao projeto, grava no Blob; sem ele, no próprio banco. Se o
 * Blob recusar a gravação (fora do ar, ou bloqueado pelo limite do plano gratuito — 30 dias), o arquivo vai para o
 * banco: uma venda ou uma nota não param por causa do armazenamento de arquivos. A leitura e a remoção seguem o
 * identificador, então arquivos dos dois destinos convivem (antes e depois de conectar o Blob).
 */
class PostgresBackendFileStorage implements FileStorage {
  private blob = new VercelBlobStorage();
  private database = new PostgresFileStorage();
  get kind() {
    return blobConfigured() ? ("blob" as const) : ("postgres" as const);
  }
  async put(bucket: string, name: string, data: Buffer, mime: string) {
    if (blobConfigured()) {
      try {
        return await this.blob.put(bucket, name, data, mime);
      } catch (e) {
        console.error(`[arquivos] o Blob não aceitou a gravação de ${bucket}/${name}; o arquivo foi guardado no banco`, e);
      }
    }
    return IN_DATABASE + (await this.database.put(bucket, name, data));
  }
  private inBlob() {
    if (!blobConfigured()) throw new Error("Este arquivo está no Blob da Vercel, que não está conectado ao projeto (Storage → Blob).");
    return this.blob;
  }
  async get(bucket: string, id: string) {
    return id.startsWith(IN_DATABASE) ? this.database.get(bucket, id.slice(IN_DATABASE.length)) : this.inBlob().get(bucket, id);
  }
  async remove(bucket: string, id: string) {
    return id.startsWith(IN_DATABASE) ? this.database.remove(bucket, id.slice(IN_DATABASE.length)) : this.inBlob().remove(bucket, id);
  }
}

/** Onde os arquivos estão sendo gravados, em palavras (telas de cópias de segurança e diagnóstico). */
export function fileStorageLabel(): string {
  switch (getFileStorage().kind) {
    case "blob":
      return "Vercel Blob privado";
    case "postgres":
      return "banco de dados da instalação";
    case "appwrite":
      return "Appwrite Storage";
    case "local":
      return "armazenamento local de arquivos";
    default:
      return "memória (demonstração volátil)";
  }
}

/** Quantos arquivos (e megabytes) estão guardados no próprio banco — para o diagnóstico da instalação. */
export async function databaseFileUsage(): Promise<{ count: number; mb: number } | null> {
  const store = postgresStore();
  if (!store) return null;
  const r = await store.sql(`SELECT count(*) AS "n", COALESCE(sum(octet_length("data")), 0) AS "bytes" FROM "${FILES_TABLE}"`);
  return { count: Number(r.rows[0]?.n ?? 0), mb: Math.round((Number(r.rows[0]?.bytes ?? 0) / 1048576) * 100) / 100 };
}

const g = globalThis as unknown as { __intercertFiles?: FileStorage };

export function getFileStorage(): FileStorage {
  if (g.__intercertFiles) return g.__intercertFiles;
  const backend = configuredBackend();
  const disk = () => new LocalFileStorage(process.env.LOCAL_FILES_DIR ?? path.join(process.cwd(), ".data", "files"));
  // Postgres: Blob privado quando conectado; sem ele, o próprio banco (também em desenvolvimento com um Postgres local)
  if (backend === "postgres") g.__intercertFiles = new PostgresBackendFileStorage();
  else g.__intercertFiles = backend === "appwrite" ? new AppwriteFileStorage() : backend === "local" ? disk() : new LocalFileStorage();
  return g.__intercertFiles;
}

export function setFileStorage(fsx: FileStorage) {
  g.__intercertFiles = fsx;
}

export interface SaveFileInput {
  bucket: keyof typeof BUCKETS;
  name: string;
  mime: string;
  data: Buffer;
  entityType?: string;
  entityId?: string;
  kind?: string;
  branchId?: string | null;
}

/** Grava arquivo e seu registro de metadados; devolve o id do registro em `files`. */
export async function saveFile(ctx: Ctx, input: SaveFileInput) {
  const storage = getFileStorage();
  const storageId = await storage.put(BUCKETS[input.bucket], input.name, input.data, input.mime);
  return ctx.store.create("files", {
    companyId: ctx.companyId,
    branchId: input.branchId ?? ctx.branchId,
    createdBy: ctx.user.id,
    name: input.name,
    mime: input.mime,
    sizeBytes: input.data.length,
    sha256: sha256(input.data),
    storageId,
    bucket: BUCKETS[input.bucket],
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    kind: input.kind ?? null,
  });
}

export async function readFile(ctx: Ctx, fileId: string) {
  const meta = await ctx.store.getOrThrow("files", fileId);
  if (meta.companyId !== ctx.companyId) throw new Error("Arquivo de outra empresa");
  const data = await getFileStorage().get(meta.bucket, meta.storageId);
  return { meta, data };
}
