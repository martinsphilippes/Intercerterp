import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { configuredBackend, appwriteConfig, getStore, findOne, detId } from "@/lib/db";

/**
 * Instalação automatizada (sem a tela de primeiro acesso), em etapas retomáveis:
 *   ?step=provision — cria tabelas/índices/buckets (repita até done=true)
 *   ?step=demo      — carrega a empresa de demonstração (idempotente; repita se o tempo acabar)
 *   ?step=owner     — cria o administrador geral (e-mail informado; senha gerada e devolvida UMA vez)
 *   ?step=finish    — encerra a instalação: a rota deixa de funcionar (exceto provision e demo-update, idempotentes)
 *   ?step=diagnostico — região, tempo de resposta e tamanho do banco, esquema aplicado, arquivos, chave de cifra e avisos (só leitura)
 * Exige o SETUP_TOKEN (cabeçalho x-setup-token ou ?token=). Depois de "finish" responde 410.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DONE_ID = detId("installation", "completed");

function tokenOk(req: NextRequest) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return false;
  const got = Buffer.from(req.headers.get("x-setup-token") ?? req.nextUrl.searchParams.get("token") ?? "");
  const exp = Buffer.from(expected);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

export async function GET(req: NextRequest) {
  if (!tokenOk(req)) return NextResponse.json({ ok: false, error: "Token de instalação inválido." }, { status: 401 });
  const backend = configuredBackend();
  if (backend !== "appwrite" && backend !== "postgres") return NextResponse.json({ ok: false, error: "Somente com banco Postgres ou Appwrite configurado." }, { status: 400 });
  const step = req.nextUrl.searchParams.get("step") ?? "";
  const started = Date.now();
  try {
    return await runStep(req, backend, step, started);
  } catch (e) {
    // quem instala precisa ler o motivo (banco fora do ar, sem acesso, codificação errada, arquivos sem destino) — não um erro 500 mudo
    const { dbOutageOf } = await import("@/lib/db/outage");
    console.error(`[setup] etapa "${step}" falhou`, e);
    return NextResponse.json({ ok: false, step, outage: dbOutageOf(e)?.kind ?? null, error: String((e as Error)?.message ?? e), ms: Date.now() - started }, { status: 500 });
  }
}

async function runStep(req: NextRequest, backend: "postgres" | "appwrite", step: string, started: number): Promise<NextResponse> {
  const store = getStore();

  if (step === "diagnostico") {
    // Situação da instalação sem expor credenciais: onde o banco está, quanto demora e onde ficam os arquivos.
    // Funciona antes e depois de a instalação ser encerrada (só leitura).
    const { blobConfigured, getFileStorage } = await import("@/lib/core/files");
    const { secretKeySource } = await import("@/lib/auth/secret-box");
    const warnings: string[] = [];
    const out: Record<string, unknown> = { ok: true, step, backend, functionRegion: process.env.VERCEL_REGION ?? null, files: getFileStorage().kind, blobConnected: blobConfigured(), secretKey: secretKeySource(), warnings };
    if (backend === "postgres" && !blobConfigured()) warnings.push("Sem Blob privado conectado: XML, anexos e cópias de segurança não têm onde ser gravados (Storage → Blob, acesso privado).");
    if (out.secretKey === "appwrite") warnings.push("A chave que cifra a autenticação em duas etapas ainda vem da chave do Appwrite: defina AUTH_ENCRYPTION_KEY antes de remover as variáveis APPWRITE_*.");
    if (out.secretKey === "missing") warnings.push("AUTH_ENCRYPTION_KEY não definida: a autenticação em duas etapas não funciona até a variável existir.");
    if (backend === "postgres") {
      const { pgDriver, postgresUrl, postgresEndpoint } = await import("@/lib/db/postgres/driver");
      const { schemaApplied, searchNormalizationWorks } = await import("@/lib/db/postgres/ddl");
      // do endereço só saem a região (ex.: sa-east-1) e se é o endereço com agrupador de conexões
      const endpoint = postgresEndpoint();
      out.dbRegion = endpoint.region;
      out.pooled = endpoint.pooled;
      // funções longe do banco: cada consulta atravessa a distância — a correção é a região em vercel.json ("regions")
      const { functionsNearDatabase, vercelRegionFor } = await import("@/lib/server/deploy-config");
      out.sameRegion = functionsNearDatabase(process.env.VERCEL_REGION, endpoint.region);
      if (out.sameRegion === false) {
        const target = vercelRegionFor(endpoint.region);
        warnings.push(`As funções rodam em ${process.env.VERCEL_REGION} e o banco em ${endpoint.region}: cada consulta paga essa distância.${target ? ` Fixe "regions": ["${target}"] em vercel.json.` : ""}`);
      }
      const driver = pgDriver(postgresUrl());
      try {
        const t0 = Date.now();
        const v = await driver.query("SELECT current_setting('server_version') AS version, current_setting('server_encoding') AS encoding, pg_database_size(current_database()) AS bytes");
        out.firstQueryMs = Date.now() - t0; // inclui abrir a conexão (e acordar o banco, se estava ocioso)
        // ida e volta de uma consulta mínima com a conexão já aberta: mediana de 7 (é o custo fixo de cada consulta de tela)
        const trips: number[] = [];
        for (let i = 0; i < 7; i++) {
          const t = Date.now();
          await driver.query("SELECT 1");
          trips.push(Date.now() - t);
        }
        trips.sort((a, b) => a - b);
        out.queryMs = trips[3];
        out.queryMsRange = [trips[0], trips[6]];
        out.serverVersion = v.rows[0]?.version ?? null;
        out.encoding = v.rows[0]?.encoding ?? null;
        out.dbSizeMb = Math.round((Number(v.rows[0]?.bytes ?? 0) / 1048576) * 10) / 10;
        out.schemaApplied = await schemaApplied(driver);
        if (out.schemaApplied) {
          // a busca sem acento do banco concorda com a da aplicação? (só em banco UTF-8)
          out.searchOk = await searchNormalizationWorks(driver);
          if (!out.searchOk) warnings.push(`A busca sem acento não funciona neste banco (codificação ${out.encoding}; o sistema exige UTF8).`);
        }
      } catch (e) {
        const { dbOutageOf } = await import("@/lib/db/outage");
        out.ok = false;
        out.outage = dbOutageOf(e)?.kind ?? null;
        out.error = (e as Error).message;
      } finally {
        await driver.end().catch(() => undefined);
      }
    }
    return NextResponse.json(out, { status: out.ok ? 200 : 503 });
  }

  if (step === "provision" && backend === "postgres") {
    // Postgres: tabelas, colunas e índices que faltam, numa transação (o mesmo que a primeira consulta de cada versão faz sozinha)
    const { provisionPostgres } = await import("@/lib/db/postgres/ddl");
    const { pgDriver, postgresUrl } = await import("@/lib/db/postgres/driver");
    const log: string[] = [];
    const driver = pgDriver(postgresUrl());
    try {
      const r = await provisionPostgres(driver, (m) => log.push(m));
      return NextResponse.json({ ok: true, step, ...r, log, ms: Date.now() - started });
    } finally {
      await driver.end().catch(() => undefined);
    }
  }

  if (step === "provision") {
    const { provisionAppwrite } = await import("@/lib/db/provision");
    const log: string[] = [];
    const r = await provisionAppwrite(appwriteConfig(), (m) => log.push(m), { deadline: Date.now() + 240000 });
    return NextResponse.json({ ok: true, step, ...r, log: log.slice(-8), ms: Date.now() - started });
  }

  if (step === "demo" || step === "demo-update") {
    // a demonstração grava XML fiscal, certificados e cópias de segurança: sem destino para arquivos ela pararia pela
    // metade (na primeira venda). Recusa antes de gravar qualquer coisa, dizendo o que falta.
    const { fileStorageMissing } = await import("@/lib/core/files");
    const missing = fileStorageMissing();
    if (missing) return NextResponse.json({ ok: false, step, error: missing }, { status: 409 });
  }

  // a partir daqui o banco precisa estar provisionado
  const completed = await store.get("operations", DONE_ID).catch(() => null);

  if (step === "demo-update") {
    // atualização da DEMONSTRAÇÃO após uma nova versão (módulos novos, idempotente): só quando a empresa de demonstração existe
    const { listAll } = await import("@/lib/db");
    const demo = (await listAll(store, "companies", { filters: [["eq", "isDemo", true]] })).find((c) => (c.kind ?? "retail") === "retail"); // a loja de demonstração (não o escritório nem os parceiros da rede)
    if (!demo) return NextResponse.json({ ok: false, error: "Não há empresa de demonstração nesta instalação." }, { status: 404 });
    const { seedDemo } = await import("@/domain/seed");
    const r = await seedDemo(store, { historyDays: 1, deadline: started + 150000 });
    return NextResponse.json({ ok: true, step, done: r.done, companyId: r.companyId, modules: (r as Record<string, unknown>).modules ?? null, ms: Date.now() - started });
  }

  if (completed) return NextResponse.json({ ok: false, error: "Instalação já concluída." }, { status: 410 });

  if (step === "demo") {
    const { seedDemo } = await import("@/domain/seed");
    const days = Math.max(1, Math.min(45, Number(req.nextUrl.searchParams.get("days") ?? process.env.DEMO_HISTORY_DAYS ?? 7)));
    // deixa folga dentro dos 300 s da função; repita a chamada até done=true
    const r = await seedDemo(store, { historyDays: days, deadline: started + 150000 });
    return NextResponse.json({ ok: true, step, done: r.done, companyId: r.companyId, ms: Date.now() - started });
  }

  if (step === "status") {
    const count = async (t: string, filters: any[] = []) => (await store.list(t as any, { filters, limit: 1 })).total;
    return NextResponse.json({
      ok: true, step,
      companies: await count("companies"), users: await count("users"), products: await count("products"),
      sales: await count("sales"), cashSessions: await count("cash_sessions"), openCashSessions: await count("cash_sessions", [["eq", "status", "open"]]),
      fiscalDocuments: await count("fiscal_documents"), settings: await count("settings"),
    });
  }

  if (step === "check-login") {
    // teste de ponta a ponta da autenticação (mesmo provedor da tela de login); a sessão criada é encerrada em seguida
    const who = String(req.nextUrl.searchParams.get("login") ?? "").trim().toLowerCase();
    const pass = String(req.nextUrl.searchParams.get("password") ?? "");
    const u = (await findOne(store, "users", [["eq", "login", who]])) ?? (await findOne(store, "users", [["eq", "email", who]]));
    if (!u?.authId) return NextResponse.json({ ok: false, error: "Usuário não encontrado." }, { status: 404 });
    const { getAuth } = await import("@/lib/auth/provider");
    try {
      const s = await getAuth().login(u.email, pass, false);
      const verified = (await getAuth().verify(s.secret)) === u.authId;
      await getAuth().logout(s.secret);
      return NextResponse.json({ ok: verified, step, login: u.login, verified });
    } catch (e) {
      return NextResponse.json({ ok: false, step, error: (e as Error).message }, { status: 401 });
    }
  }

  if (step === "owner") {
    const email = String(req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
    const name = String(req.nextUrl.searchParams.get("name") ?? "Administrador").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "E-mail inválido." }, { status: 400 });
    const existing = await findOne(store, "users", [["eq", "email", email]]);
    if (existing?.authId) return NextResponse.json({ ok: true, step, existing: true, login: existing.login });
    const companies = (await store.list("companies", { limit: 100 })).items.map((c) => c.id);
    const login = email.split("@")[0].replace(/[^a-z0-9._-]/g, "").slice(0, 40) || "administrador";
    const user =
      existing ??
      (await store.create("users", { name, email, login, status: "active", isAdmin: true, companyIds: companies, branchIds: [], firstAccessAt: new Date().toISOString() }));
    const password = `${randomBytes(9).toString("base64url")}#A9`;
    const { getAuth } = await import("@/lib/auth/provider");
    const authId = await getAuth().createUser(email, password, name);
    await store.update("users", user.id, { authId, isAdmin: true, companyIds: companies });
    return NextResponse.json({ ok: true, step, login, email, password, note: "Senha exibida uma única vez — troque após o primeiro acesso." });
  }

  if (step === "finish") {
    await store.create("operations", { type: "installation", status: "done", entityType: "installation", entityId: "completed" }, DONE_ID).catch(() => undefined);
    return NextResponse.json({ ok: true, step, completed: true });
  }

  return NextResponse.json({ ok: false, error: "Etapa inválida (provision | demo | demo-update | status | check-login | owner | finish | diagnostico)." }, { status: 400 });
}
