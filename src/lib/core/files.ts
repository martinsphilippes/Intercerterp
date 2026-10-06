import fs from "node:fs";
import path from "node:path";
import { Client, Storage, AppwriteException } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { configuredBackend, appwriteConfig, newId, sha256 } from "../db";
import type { Ctx } from "./ctx";

/** Armazenamento de arquivos (XML, DANFE, anexos, backups). Appwrite Storage ou disco local. */
export interface FileStorage {
  readonly kind: "appwrite" | "local" | "memory";
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

const g = globalThis as unknown as { __intercertFiles?: FileStorage };

export function getFileStorage(): FileStorage {
  if (g.__intercertFiles) return g.__intercertFiles;
  const backend = configuredBackend();
  g.__intercertFiles =
    backend === "appwrite"
      ? new AppwriteFileStorage()
      : backend === "local"
        ? new LocalFileStorage(process.env.LOCAL_FILES_DIR ?? path.join(process.cwd(), ".data", "files"))
        : new LocalFileStorage();
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
