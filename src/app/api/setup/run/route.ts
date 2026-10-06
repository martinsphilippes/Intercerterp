import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { configuredBackend, appwriteConfig, getStore, findOne, detId } from "@/lib/db";

/**
 * Instalação automatizada (sem a tela de primeiro acesso), em etapas retomáveis:
 *   ?step=provision — cria tabelas/índices/buckets (repita até done=true)
 *   ?step=demo      — carrega a empresa de demonstração (idempotente; repita se o tempo acabar)
 *   ?step=owner     — cria o administrador geral (e-mail informado; senha gerada e devolvida UMA vez)
 *   ?step=finish    — encerra a instalação: a rota deixa de funcionar
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
  if (configuredBackend() !== "appwrite") return NextResponse.json({ ok: false, error: "Somente para Appwrite." }, { status: 400 });
  const step = req.nextUrl.searchParams.get("step") ?? "";
  const store = getStore();
  const started = Date.now();

  if (step === "provision") {
    const { provisionAppwrite } = await import("@/lib/db/provision");
    const log: string[] = [];
    const r = await provisionAppwrite(appwriteConfig(), (m) => log.push(m), { deadline: Date.now() + 240000 });
    return NextResponse.json({ ok: true, step, ...r, log: log.slice(-8), ms: Date.now() - started });
  }

  // a partir daqui o banco precisa estar provisionado
  const completed = await store.get("operations", DONE_ID).catch(() => null);
  if (completed) return NextResponse.json({ ok: false, error: "Instalação já concluída." }, { status: 410 });

  if (step === "demo") {
    const { seedDemo } = await import("@/domain/seed");
    const days = Math.max(1, Math.min(45, Number(req.nextUrl.searchParams.get("days") ?? process.env.DEMO_HISTORY_DAYS ?? 7)));
    // deixa folga dentro dos 300 s da função; repita a chamada até done=true
    const r = await seedDemo(store, { historyDays: days, deadline: started + 170000 });
    return NextResponse.json({ ok: true, step, done: r.done, companyId: r.companyId, ms: Date.now() - started });
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

  return NextResponse.json({ ok: false, error: "Etapa inválida (provision | demo | owner | finish)." }, { status: 400 });
}
