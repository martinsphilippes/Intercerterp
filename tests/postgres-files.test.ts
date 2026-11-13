import { describe, it, expect, afterEach, vi } from "vitest";

// Vercel Blob simulado: guarda o que o sistema pede ao SDK e pode ser "derrubado" (fora do ar / bloqueado pelo plano)
const blobs = new Map<string, Buffer>();
const blobState = { down: false };
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer) => {
    if (blobState.down) throw new Error("This store has been suspended");
    blobs.set(pathname, Buffer.from(body));
    return { pathname };
  },
  get: async (pathname: string) => {
    const b = blobs.get(pathname);
    return b ? { statusCode: 200, stream: new Response(new Uint8Array(b)).body, headers: new Headers(), blob: { pathname } } : null;
  },
  del: async (pathname: string) => void blobs.delete(pathname),
}));

import { setStore, listAll } from "@/lib/db";
import { getFileStorage, databaseFileUsage, fileStorageLabel, readFile } from "@/lib/core/files";
import { seedDemo } from "@/domain/seed";
import { seedBase } from "@/domain/seed/base";
import { freshPostgresStore } from "./pglite";

/**
 * Arquivos do backend Postgres: sem Blob conectado ficam no próprio banco (a instalação funciona só com o banco); com
 * Blob, vão para ele — e para o banco se o Blob recusar. O identificador diz onde cada arquivo está.
 */
const ENV = ["DATA_BACKEND", "DATABASE_URL", "POSTGRES_URL", "APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY", "VERCEL", "BLOB_READ_WRITE_TOKEN", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const g = globalThis as unknown as { __intercertFiles?: unknown; __intercertStore?: unknown; __intercertAuth?: unknown };

/** Instalação Postgres nova (banco embutido), com ou sem Blob conectado. */
function installation(opts: { blob?: boolean } = {}) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { DATABASE_URL: "postgres://usuario:senha@servidor/banco", VERCEL: "1", ...(opts.blob ? { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" } : {}) });
  g.__intercertFiles = undefined;
  g.__intercertAuth = undefined;
  const store = freshPostgresStore();
  setStore(store);
  return { store, files: getFileStorage() };
}

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  g.__intercertFiles = undefined;
  g.__intercertStore = undefined;
  g.__intercertAuth = undefined;
  blobs.clear();
  blobState.down = false;
});

describe("arquivos no próprio banco (sem Blob conectado)", () => {
  it("grava e lê byte a byte, isola por bucket, remove, e o identificador diz que está no banco", async () => {
    const { files } = installation();
    expect(files.kind).toBe("postgres");
    expect(fileStorageLabel()).toBe("banco de dados da instalação");
    const data = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)); // todos os bytes, inclusive o zero
    const id = await files.put("documents", "nota 123.xml", data, "application/xml");
    expect(id).toMatch(/^db:/);
    expect((await files.get("documents", id)).equals(data)).toBe(true);
    await expect(files.get("backups", id)).rejects.toThrow(/Arquivo não encontrado/); // outro bucket não enxerga
    expect(await databaseFileUsage()).toEqual({ count: 1, mb: 0 });
    await files.remove("documents", id);
    await expect(files.get("documents", id)).rejects.toThrow(/Arquivo não encontrado/);
    expect(await databaseFileUsage()).toEqual({ count: 0, mb: 0 });
    expect(blobs.size).toBe(0);
  });

  it("arquivo gravado dentro de uma transação entra nela: desfeita, não fica para trás; confirmada, fica", async () => {
    const { store, files } = installation();
    let lost = "";
    await expect(
      store.transaction(async () => {
        lost = await files.put("documents", "a.xml", Buffer.from("perdido"), "application/xml");
        expect((await files.get("documents", lost)).toString()).toBe("perdido"); // a própria transação enxerga
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    await expect(files.get("documents", lost)).rejects.toThrow(/Arquivo não encontrado/);
    const kept = await store.transaction(async () => files.put("documents", "b.xml", Buffer.from("gravado"), "application/xml"));
    expect((await files.get("documents", kept)).toString()).toBe("gravado");
    expect((await databaseFileUsage())?.count).toBe(1);
  });

  it("a demonstração inteira carrega só com o banco: XML, certificados e cópia de segurança ficam nele e são lidos de volta", async () => {
    const { store } = installation();
    let r = await seedDemo(store, { historyDays: 1 });
    while (!r.done) r = await seedDemo(store, { historyDays: 1 });
    const usage = await databaseFileUsage();
    const metas = await listAll(store, "files", {});
    expect(metas.length).toBeGreaterThan(10);
    expect(usage?.count).toBe(metas.length); // cada registro tem o seu conteúdo, e nenhum conteúdo ficou sem registro
    expect(metas.every((m) => String(m.storageId).startsWith("db:"))).toBe(true);
    expect(blobs.size).toBe(0);
    // um XML fiscal volta inteiro, com o mesmo tamanho e a mesma soma registrados
    const refs = await seedBase(store);
    const admin = await refs.ctxFor("admin", "matriz");
    const doc = (await listAll(store, "fiscal_documents", { filters: [["eq", "companyId", admin.companyId], ["notNull", "xmlFileId"]] }))[0];
    const { meta, data } = await readFile(admin, doc.xmlFileId);
    expect(data.length).toBe(meta.sizeBytes);
    expect(data.toString("utf8")).toContain("<");
  }, 180_000);
});

describe("Blob conectado ao projeto", () => {
  it("grava no Blob; se o Blob recusar (fora do ar ou bloqueado pelo plano), o arquivo vai para o banco e a operação segue", async () => {
    const { files } = installation({ blob: true });
    expect(files.kind).toBe("blob");
    const inBlob = await files.put("documents", "antes.xml", Buffer.from("no blob"), "application/xml");
    expect(inBlob).not.toMatch(/^db:/);
    expect([...blobs.keys()]).toEqual([`documents/${inBlob}`]);
    blobState.down = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const inDb = await files.put("documents", "durante.xml", Buffer.from("no banco"), "application/xml");
    expect(inDb).toMatch(/^db:/);
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/Blob não aceitou/), expect.anything());
    errors.mockRestore();
    blobState.down = false;
    // os dois destinos convivem: cada arquivo é lido (e removido) de onde está
    expect((await files.get("documents", inBlob)).toString()).toBe("no blob");
    expect((await files.get("documents", inDb)).toString()).toBe("no banco");
    await files.remove("documents", inBlob);
    await files.remove("documents", inDb);
    expect(blobs.size).toBe(0);
    expect((await databaseFileUsage())?.count).toBe(0);
  });

  it("arquivos gravados no banco antes de conectar o Blob continuam legíveis depois; os novos vão para o Blob", async () => {
    const { store, files } = installation();
    const old = await files.put("documents", "antigo.xml", Buffer.from("antes do blob"), "application/xml");
    // o titular conecta o Blob: mesma base, nova publicação
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_x";
    g.__intercertFiles = undefined;
    setStore(store);
    const after = getFileStorage();
    expect(after.kind).toBe("blob");
    expect((await after.get("documents", old)).toString()).toBe("antes do blob");
    const fresh = await after.put("documents", "novo.xml", Buffer.from("depois do blob"), "application/xml");
    expect(fresh).not.toMatch(/^db:/);
    expect(blobs.size).toBe(1);
  });

  it("arquivo que está no Blob, com o Blob desconectado depois: o erro diz onde ele está", async () => {
    const { files } = installation();
    await expect(files.get("documents", "id-de-um-arquivo-no-blob")).rejects.toThrow(/Blob da Vercel, que não está conectado/);
  });
});
