import { describe, it, expect, afterEach, vi } from "vitest";

// Vercel Blob simulado: guarda o que o sistema pede ao SDK
const blobs = new Map<string, { data: Buffer; options: Record<string, unknown> }>();
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer, options: Record<string, unknown>) => {
    blobs.set(pathname, { data: Buffer.from(body), options });
    return { pathname, url: `https://loja.private.blob.vercel-storage.com/${pathname}` };
  },
  get: async (pathname: string, options: Record<string, unknown>) => {
    const b = blobs.get(pathname);
    if (!b || options.access !== "private") return null;
    return { statusCode: 200, stream: new Response(new Uint8Array(b.data)).body, headers: new Headers(), blob: { pathname } };
  },
  del: async (pathname: string) => void blobs.delete(pathname),
}));

import { AppwriteException } from "node-appwrite";
import { configuredBackend } from "@/lib/db";
import { dbOutageOf } from "@/lib/db/outage";
import { getFileStorage } from "@/lib/core/files";
import { missingDeploymentConfig } from "@/lib/server/deploy-config";
import { indexName, schemaSignature } from "@/lib/db/postgres/ddl";

const ENV = ["DATA_BACKEND", "DATABASE_URL", "POSTGRES_URL", "APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY", "VERCEL", "BLOB_READ_WRITE_TOKEN", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

function env(values: Partial<Record<(typeof ENV)[number], string>>) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  (globalThis as any).__intercertFiles = undefined;
}

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  (globalThis as any).__intercertFiles = undefined;
  blobs.clear();
});

const APPWRITE = { APPWRITE_ENDPOINT: "https://fra.cloud.appwrite.io/v1", APPWRITE_PROJECT_ID: "p", APPWRITE_API_KEY: "k" };

describe("escolha do armazenamento", () => {
  it("banco Postgres conectado ao projeto tem prioridade sobre o Appwrite; DATA_BACKEND força a escolha", () => {
    env({ ...APPWRITE });
    expect(configuredBackend()).toBe("appwrite");
    env({ ...APPWRITE, DATABASE_URL: "postgres://u:s@host/db" });
    expect(configuredBackend()).toBe("postgres");
    env({ POSTGRES_URL: "postgres://u:s@host/db" });
    expect(configuredBackend()).toBe("postgres");
    env({ ...APPWRITE, DATABASE_URL: "postgres://u:s@host/db", DATA_BACKEND: "appwrite" });
    expect(configuredBackend()).toBe("appwrite");
    env({ VERCEL: "1" });
    expect(configuredBackend()).toBe("memory");
    env({});
    expect(configuredBackend()).toBe("local");
  });

  it("publicação sem banco: a tela de configuração pede o Postgres; Appwrite pela metade lista o que falta", () => {
    env({ VERCEL: "1" });
    expect(missingDeploymentConfig()).toEqual(["DATABASE_URL"]);
    env({ VERCEL: "1", DATABASE_URL: "postgres://u:s@host/db" });
    expect(missingDeploymentConfig()).toEqual([]);
    env({ VERCEL: "1", ...APPWRITE });
    expect(missingDeploymentConfig()).toEqual([]);
    env({ VERCEL: "1", APPWRITE_ENDPOINT: "https://x" });
    expect(missingDeploymentConfig()).toEqual(["APPWRITE_PROJECT_ID", "APPWRITE_API_KEY"]);
    env({ VERCEL: "1", DATA_BACKEND: "memory" });
    expect(missingDeploymentConfig()).toEqual([]);
    env({});
    expect(missingDeploymentConfig()).toEqual([]);
  });
});

describe("arquivos no backend Postgres", () => {
  it("com o Blob conectado: grava privado em <bucket>/<id>, lê direto da origem e remove", async () => {
    env({ DATABASE_URL: "postgres://u:s@host/db", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x", VERCEL: "1" });
    const fsx = getFileStorage();
    expect(fsx.kind).toBe("blob");
    const data = Buffer.from("<nfe>…</nfe>");
    const id = await fsx.put("documents", "nota 123.xml", data, "application/xml");
    expect([...blobs.keys()]).toEqual([`documents/${id}`]); // o nome original não entra no caminho
    expect(blobs.get(`documents/${id}`)!.options).toMatchObject({ access: "private", addRandomSuffix: false, contentType: "application/xml" });
    expect((await fsx.get("documents", id)).equals(data)).toBe(true);
    await fsx.remove("documents", id);
    await expect(fsx.get("documents", id)).rejects.toThrow(/Arquivo não encontrado/);
  });

  it("na Vercel sem Blob conectado: erro que diz o que falta; fora da Vercel: pasta em disco", async () => {
    env({ DATABASE_URL: "postgres://u:s@host/db", VERCEL: "1" });
    await expect(getFileStorage().put("documents", "a.xml", Buffer.from("x"), "application/xml")).rejects.toThrow(/conecte um Blob privado/);
    env({ DATABASE_URL: "postgres://u:s@host/db" });
    expect(getFileStorage().kind).toBe("local");
  });
});

describe("banco indisponível: erros do Postgres", () => {
  const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
  it("classifica acesso recusado, servidor fora do ar e cota do plano; erro de dados não é indisponibilidade", () => {
    expect(dbOutageOf(pgError("28P01", 'password authentication failed for user "x"'))).toMatchObject({ kind: "credentials" });
    expect(dbOutageOf(pgError("3D000", 'database "x" does not exist'))).toMatchObject({ kind: "credentials" });
    expect(dbOutageOf(pgError("57P03", "the database system is starting up"))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(pgError("53300", "sorry, too many clients already"))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(pgError("08006", "connection failure"))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(new Error("timeout exceeded when trying to connect"))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(new Error("Connection terminated unexpectedly"))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(pgError("XX000", "Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits."))).toMatchObject({ kind: "quota" });
    expect(dbOutageOf(new Error("The endpoint has been disabled. Enable it using Neon API and retry."))).toMatchObject({ kind: "quota" });
    // erros de dados e de consulta seguem o tratamento normal
    expect(dbOutageOf(pgError("23505", "duplicate key value violates unique constraint"))).toBeNull();
    expect(dbOutageOf(pgError("42703", 'column "x" does not exist'))).toBeNull();
    expect(dbOutageOf(pgError("40001", "could not serialize access"))).toBeNull();
    // e o Appwrite continua classificado como antes
    expect(dbOutageOf(new AppwriteException("Project is paused", 403, "project_paused"))).toMatchObject({ kind: "paused" });
  });
});

describe("criação das tabelas", () => {
  it("assinatura do esquema é estável; nomes de índice cabem no limite do Postgres e não colidem", async () => {
    expect(schemaSignature()).toBe(schemaSignature());
    expect(schemaSignature()).toMatch(/^[0-9a-f]{32}$/);
    const { COLLECTIONS } = await import("@/lib/db/schema");
    const names = COLLECTIONS.flatMap((c) => ["_seq", ...(c.indexes ?? []).map((i) => i.key)].map((k) => indexName(c.id, k)));
    expect(names.every((n) => Buffer.byteLength(n) <= 63)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
