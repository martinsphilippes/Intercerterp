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
import { dbOutageOf, outageLogLine } from "@/lib/db/outage";
import { getFileStorage } from "@/lib/core/files";
import fs from "node:fs";
import { missingDeploymentConfig, functionsNearDatabase, vercelRegionFor } from "@/lib/server/deploy-config";
import { indexName, schemaSignature, provisionPostgres } from "@/lib/db/postgres/ddl";
import { postgresEndpoint, type PgConn, type PgDriver } from "@/lib/db/postgres/driver";
import { normText } from "@/lib/db/norm";
import { openSecret, sealSecret, secretKeySource } from "@/lib/auth/secret-box";

const ENV = ["DATA_BACKEND", "DATABASE_URL", "POSTGRES_URL", "APPWRITE_ENDPOINT", "APPWRITE_PROJECT_ID", "APPWRITE_API_KEY", "VERCEL", "BLOB_READ_WRITE_TOKEN", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID", "AUTH_ENCRYPTION_KEY"] as const;
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

  it("sem Blob conectado o destino é o próprio banco, na Vercel e fora dela (detalhes em tests/postgres-files.test.ts)", () => {
    env({ DATABASE_URL: "postgres://u:s@host/db", VERCEL: "1" });
    expect(getFileStorage().kind).toBe("postgres");
    env({ DATABASE_URL: "postgres://u:s@host/db" });
    expect(getFileStorage().kind).toBe("postgres");
    env({ DATA_BACKEND: "memory", VERCEL: "1" }); // demonstração em memória guarda os arquivos na memória
    expect(getFileStorage().kind).toBe("memory");
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

describe("monitor diário do banco", () => {
  it("o registro da falha diz onde olhar conforme o banco em uso (não manda ao Appwrite quem está no Postgres)", () => {
    const quota = { kind: "quota" as const, detail: "x" };
    expect(outageLogLine(quota, "postgres")).toMatch(/LIMITADO.*Vercel/);
    expect(outageLogLine(quota, "postgres")).not.toMatch(/Appwrite/);
    expect(outageLogLine(quota, "appwrite")).toMatch(/LIMITADO.*Appwrite/);
    expect(outageLogLine({ kind: "credentials", detail: "x" }, "postgres")).toMatch(/RECUSADO.*Vercel/);
    expect(outageLogLine({ kind: "paused", detail: "x" }, "appwrite")).toMatch(/PAUSADO.*Appwrite/);
    expect(outageLogLine({ kind: "unreachable", detail: "x" }, "postgres")).toMatch(/SEM RESPOSTA/);
    expect(outageLogLine(null, "postgres")).toMatch(/não é de indisponibilidade/);
  });
});

describe("diagnóstico da instalação", () => {
  it("do endereço do banco saem só a região e o uso do agrupador de conexões — nunca usuário, senha ou nome do servidor", () => {
    const at = (host: string) => postgresEndpoint(`postgresql://dono:segredo-forte@${host}/neondb?sslmode=require`);
    expect(at("ep-cool-night-a1b2c3-pooler.sa-east-1.aws.neon.tech")).toEqual({ region: "sa-east-1", pooled: true });
    expect(at("ep-cool-night-a1b2c3.sa-east-1.aws.neon.tech")).toEqual({ region: "sa-east-1", pooled: false });
    expect(at("ep-x-123-pooler.c-2.us-east-1.aws.neon.tech")).toEqual({ region: "us-east-1", pooled: true });
    expect(at("ep-y-456.eastus2.azure.neon.tech")).toEqual({ region: "eastus2", pooled: false });
    expect(at("aws-0-eu-central-1.pooler.supabase.com:6543")).toEqual({ region: "eu-central-1", pooled: true });
    expect(at("banco.cluster-abc.ap-southeast-2.rds.amazonaws.com")).toEqual({ region: "ap-southeast-2", pooled: false });
    expect(at("localhost:5432")).toEqual({ region: null, pooled: false });
    expect(postgresEndpoint("")).toEqual({ region: null, pooled: false });
    expect(postgresEndpoint("isto não é um endereço")).toEqual({ region: null, pooled: false });
    for (const host of ["ep-cool-night-a1b2c3-pooler.sa-east-1.aws.neon.tech", "localhost:5432"]) expect(JSON.stringify(at(host))).not.toMatch(/dono|segredo|ep-cool|neondb/);
  });
});

describe("chave de cifra dos segredos (autenticação em duas etapas)", () => {
  it("publicação com banco de verdade nunca cifra com a chave de desenvolvimento; a chave herdada do Appwrite só vale enquanto existir", () => {
    const mode = process.env.NODE_ENV;
    const setMode = (v: string | undefined) => (v === undefined ? delete (process.env as Record<string, string | undefined>).NODE_ENV : Object.assign(process.env, { NODE_ENV: v }));
    const banco = "postgres://usuario:senha@servidor/banco";
    try {
      // desenvolvimento e testes: chave fixa de desenvolvimento
      env({});
      expect(secretKeySource()).toBe("dev");
      expect(openSecret(sealSecret("A"))).toBe("A");
      // produção com a demonstração em memória também (nada ali é de verdade)
      setMode("production");
      env({ DATA_BACKEND: "memory" });
      expect(secretKeySource()).toBe("dev");

      // publicação no Postgres que veio do Appwrite: a chave herdada vale enquanto a variável existir
      env({ DATABASE_URL: banco, APPWRITE_API_KEY: "chave-antiga" });
      expect(secretKeySource()).toBe("appwrite");
      const legacy = sealSecret("SEGREDO");
      expect(openSecret(legacy)).toBe("SEGREDO");

      // variáveis do Appwrite removidas sem a chave própria: nada é cifrado com chave conhecida, e o que existia não abre
      env({ DATABASE_URL: banco });
      expect(secretKeySource()).toBe("missing");
      expect(() => sealSecret("X")).toThrow(/AUTH_ENCRYPTION_KEY/);
      expect(openSecret(legacy)).toBeNull();

      // chave própria: tem prioridade sobre a herdada, e remover as variáveis do Appwrite depois não muda nada
      env({ DATABASE_URL: banco, AUTH_ENCRYPTION_KEY: "chave-propria-bem-longa", APPWRITE_API_KEY: "chave-antiga" });
      expect(secretKeySource()).toBe("own");
      const own = sealSecret("SEGREDO");
      expect(own).not.toContain("SEGREDO");
      expect(openSecret(legacy)).toBeNull(); // trocar a chave invalida o que foi cifrado com a anterior
      env({ DATABASE_URL: banco, AUTH_ENCRYPTION_KEY: "chave-propria-bem-longa" });
      expect(openSecret(own)).toBe("SEGREDO");
    } finally {
      setMode(mode);
    }
  });
});

describe("região das funções e do banco", () => {
  it("reconhece funções na mesma região do banco, longe dele e quando não dá para saber", () => {
    expect(functionsNearDatabase("gru1", "sa-east-1")).toBe(true);
    expect(functionsNearDatabase("GRU1", "SA-EAST-1")).toBe(true);
    expect(functionsNearDatabase("fra1", "sa-east-1")).toBe(false); // Frankfurt ↔ São Paulo: ~200 ms por consulta
    expect(functionsNearDatabase("iad1", "us-east-1")).toBe(true);
    expect(functionsNearDatabase(undefined, "sa-east-1")).toBeNull(); // fora da Vercel
    expect(functionsNearDatabase("gru1", null)).toBeNull(); // banco sem região no endereço
    expect(functionsNearDatabase("xyz9", "sa-east-1")).toBeNull();
    expect(vercelRegionFor("sa-east-1")).toBe("gru1");
    expect(vercelRegionFor("eu-central-1")).toBe("fra1");
    expect(vercelRegionFor("eastus2")).toBeNull();
  });

  it("a publicação fixa UMA região para as funções (o plano gratuito só aceita uma), em São Paulo, junto do banco", () => {
    const config = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { regions?: string[] };
    expect(config.regions).toEqual(["gru1"]);
    expect(functionsNearDatabase(config.regions![0], "sa-east-1")).toBe(true);
  });
});

describe("criação das tabelas: banco fora do padrão", () => {
  // banco de mentira: responde só o que a criação do esquema pergunta e anota os comandos recebidos
  function fakeDatabase(answers: { encoding: string; norm: (text: string) => string }) {
    const commands: string[] = [];
    const conn: PgConn = {
      query: async (text, params) => {
        commands.push(text);
        if (text.includes("server_encoding")) return { rows: [{ enc: answers.encoding }], rowCount: 1 };
        if (text.includes("ic_norm($1")) return { rows: [{ n: answers.norm(String(params?.[0])) }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      exec: async (sql) => void commands.push(sql),
    };
    const driver: PgDriver = { ...conn, withConnection: (fn) => fn(conn), end: async () => undefined };
    return { driver, commands };
  }

  it("banco que não é UTF-8 é recusado antes de qualquer tabela, dizendo o que corrigir", async () => {
    const { driver, commands } = fakeDatabase({ encoding: "SQL_ASCII", norm: (t) => t.toLowerCase() });
    await expect(provisionPostgres(driver, () => undefined)).rejects.toThrow(/SQL_ASCII.*UTF8/);
    expect(commands.some((c) => /CREATE (TABLE|OR REPLACE FUNCTION)/.test(c))).toBe(false);
    expect(commands.at(-1)).toBe("ROLLBACK");
  });

  it("busca sem acento que discorda da aplicação desfaz a criação (nada fica pela metade)", async () => {
    const { driver, commands } = fakeDatabase({ encoding: "UTF8", norm: (t) => t.toLowerCase() }); // minúscula, mas com acento
    await expect(provisionPostgres(driver, () => undefined)).rejects.toThrow(/busca sem acento/);
    expect(commands.some((c) => c.includes("CREATE TABLE IF NOT EXISTS \"users\""))).toBe(false);
    expect(commands.at(-1)).toBe("ROLLBACK");
  });

  it("banco UTF-8 com a busca conferida segue até o fim", async () => {
    const { driver, commands } = fakeDatabase({ encoding: "UTF8", norm: (t) => String(normText(t)) });
    const r = await provisionPostgres(driver, () => undefined);
    expect(r.done).toBe(true);
    expect(commands.at(-1)).toBe("COMMIT");
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
