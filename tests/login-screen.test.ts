import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));

// cookies/cabeçalhos da requisição (loginAction) — controlados pelo teste
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
// a carga automática da demonstração (modo memória) não faz parte destes cenários; o resto do módulo é o real
vi.mock("@/lib/server/bootstrap", async (original) => ({ ...(await original<typeof import("@/lib/server/bootstrap")>()), ensureBootstrap: async () => undefined }));

import { AppwriteException } from "node-appwrite";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { DEMO_PASSWORD } from "@/domain/seed/base";
import { ConflictError, setStore } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { dbOutageOf, outageMessage } from "@/lib/db/outage";
import { DEMO_SECTORS, defaultDemoAccess, loginScreenState } from "@/app/(auth)/login/access";
import { completeRecoveryAction, loginAction, requestRecoveryAction } from "@/app/actions/session";
import { getAuth, setAuth, type AuthProvider } from "@/lib/auth/provider";
import { SESSION_COOKIE } from "@/lib/server/session";

const pausedError = () =>
  new AppwriteException("Project is paused due to inactivity. Please restore it from the console to resume operations.", 403, "project_paused", '{"code":403,"type":"project_paused"}');

/** Banco que recusa toda operação (como o Appwrite com o projeto pausado) ou só as que o teste escolher. */
function failingStore(inner: Store, error: () => unknown, when: (method: string, collection: string) => boolean = () => true): Store {
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return async (...args: unknown[]) => {
        if (when(String(prop), String(args[0]))) throw error();
        return v.apply(target, args);
      };
    },
  });
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("banco indisponível: classificação do erro", () => {
  it("reconhece projeto pausado, acesso recusado e serviço fora do ar; ignora o que não é indisponibilidade", () => {
    expect(dbOutageOf(pausedError())).toMatchObject({ kind: "paused" });
    // mesma forma vinda de outro grafo de módulos (sem instanceof)
    expect(dbOutageOf({ name: "AppwriteException", code: 403, type: "project_paused", message: "Project is paused" })).toMatchObject({ kind: "paused" });
    expect(dbOutageOf(new AppwriteException("missing scope", 401, "general_unauthorized_scope"))).toMatchObject({ kind: "credentials" });
    expect(dbOutageOf(new AppwriteException("forbidden", 403, "general_access_forbidden"))).toMatchObject({ kind: "credentials" });
    expect(dbOutageOf(new AppwriteException("Server Error", 500, "general_unknown"))).toMatchObject({ kind: "unreachable" });
    // cota do plano: o Appwrite limita as operações do banco (429 em chamada do servidor) ou fala de uso/plano na resposta
    expect(dbOutageOf(new AppwriteException("Rate limit for the current endpoint has been exceeded.", 429, "general_rate_limit_exceeded"))).toMatchObject({ kind: "quota" });
    expect(dbOutageOf(new AppwriteException("Your organization has reached the usage limit of the Free plan.", 403, "general_access_forbidden"))).toMatchObject({ kind: "quota" });
    expect(dbOutageOf(new AppwriteException("The requested resource is blocked.", 401, "general_resource_blocked"))).toMatchObject({ kind: "quota" });
    // estado do próprio usuário não é cota do plano
    expect(dbOutageOf(new AppwriteException("The current user has been blocked.", 401, "user_blocked"))).toMatchObject({ kind: "credentials" });
    expect(dbOutageOf(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toMatchObject({ kind: "unreachable" });
    expect(dbOutageOf(Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }))).toMatchObject({ kind: "unreachable" });
    // não é indisponibilidade: registro/tabela inexistente, consulta inválida, concorrência, erro de programação
    expect(dbOutageOf(new AppwriteException("not found", 404, "row_not_found"))).toBeNull();
    expect(dbOutageOf(new AppwriteException("invalid query", 400, "general_query_invalid"))).toBeNull();
    expect(dbOutageOf(new ConflictError("já existe", "users", "unique"))).toBeNull();
    expect(dbOutageOf(Object.assign(new TypeError("x is not a function"), { code: "ERR_INVALID_ARG_TYPE" }))).toBeNull();
    expect(dbOutageOf(new Error("boom"))).toBeNull();
    expect(dbOutageOf(null)).toBeNull();
  });

  it("a mensagem diz que não é a senha, em qualquer motivo", () => {
    for (const kind of ["paused", "quota", "credentials", "unreachable"] as const) {
      expect(outageMessage({ kind, detail: "x" })).toMatch(/Não é problema de usuário nem de senha/);
    }
    expect(outageMessage({ kind: "paused", detail: "x" })).toMatch(/pausado/);
  });
});

describe("tela de login: acessos da demonstração e banco indisponível", () => {
  let seeded: Store;
  const env = { backend: process.env.DATA_BACKEND, show: process.env.SHOW_DEMO_LOGIN };

  // a carga completa da demonstração leva mais que o limite padrão de preparação quando a suíte roda sobre o Postgres
  beforeAll(async () => {
    seeded = freshStore();
    await seedDemo(seeded, { historyDays: 1 });
  }, 180_000);

  afterEach(() => {
    setStore(seeded);
    jar.clear();
    process.env.DATA_BACKEND = env.backend;
    if (env.show === undefined) delete process.env.SHOW_DEMO_LOGIN;
    else process.env.SHOW_DEMO_LOGIN = env.show;
  });

  it("banco no ar: lista os usuários da demonstração — a lista de reserva acompanha a demonstração, nos dois sentidos", async () => {
    const st = await loginScreenState();
    expect(st).toMatchObject({ empty: false, outage: null, quickLive: true });
    const live = st.quick.map((u) => u.login);
    // todo usuário da demonstração tem setor cadastrado (senão cairia fora da lista de reserva)…
    expect(live.filter((l) => !DEMO_SECTORS[l])).toEqual([]);
    // …e a lista de reserva não promete acesso que a demonstração não cria; mesma ordem de apresentação
    expect(defaultDemoAccess().map((u) => u.login)).toEqual(live);
    expect(st.quick.find((u) => u.login === "caixa")).toMatchObject({ sector: "Caixa (PDV)", name: "Carla Caixa", scope: "Matriz — Centro" });
    expect(st.quick.find((u) => u.login === "gerente")).toMatchObject({ scope: "todas as filiais" });
  });

  it("banco pausado: a tela informa o motivo e mantém os acessos visíveis (lista de reserva)", async () => {
    setStore(failingStore(seeded, pausedError));
    const st = await loginScreenState();
    expect(st.empty).toBe(false); // falha não é instalação vazia: nunca abre o primeiro acesso
    expect(st.outage).toMatchObject({ kind: "paused" });
    expect(st.quickLive).toBe(false);
    expect(st.quick.map((u) => u.login)).toEqual(defaultDemoAccess().map((u) => u.login));
    expect(st.quick).toHaveLength(Object.keys(DEMO_SECTORS).length);
    expect(st.quick[0]).toEqual({ login: "admin", name: "", sector: "Administração", scope: "" });
  });

  it("cota do plano atingida (depois de reativar o projeto): motivo próprio, acessos visíveis e login com a mensagem certa", async () => {
    const overQuota = () => new AppwriteException("Rate limit for the current endpoint has been exceeded.", 429, "general_rate_limit_exceeded");
    setStore(failingStore(seeded, overQuota));
    const st = await loginScreenState();
    expect(st).toMatchObject({ empty: false, outage: { kind: "quota" }, quickLive: false });
    expect(st.quick).toHaveLength(Object.keys(DEMO_SECTORS).length);
    const blocked = await loginAction(form({ login: "caixa", password: DEMO_PASSWORD }));
    expect(blocked).toMatchObject({ ok: false, code: "db_quota" });
    expect(blocked.ok === false && blocked.error).toMatch(/limite do plano.*Não é problema de usuário nem de senha/);
  });

  it("fora do ambiente de teste: o motivo aparece, os acessos da demonstração não", async () => {
    process.env.DATA_BACKEND = "local";
    delete process.env.SHOW_DEMO_LOGIN;
    expect(await loginScreenState()).toMatchObject({ empty: false, outage: null, quick: [] });
    setStore(failingStore(seeded, pausedError));
    expect(await loginScreenState()).toMatchObject({ empty: false, outage: { kind: "paused" }, quick: [] });
    // SHOW_DEMO_LOGIN=1 liga o acesso rápido em qualquer armazenamento
    process.env.SHOW_DEMO_LOGIN = "1";
    expect((await loginScreenState()).quick).toHaveLength(Object.keys(DEMO_SECTORS).length);
  });

  it("erro que não é do banco ao listar os acessos: lista de reserva, sem aviso de bloqueio", async () => {
    setStore(failingStore(seeded, () => new Error("falha ao montar a lista"), (method, collection) => method === "list" && collection === "branches"));
    const st = await loginScreenState();
    expect(st).toMatchObject({ empty: false, outage: null, quickLive: false });
    expect(st.quick).toHaveLength(Object.keys(DEMO_SECTORS).length);
  });

  it("erro desconhecido ao ler os usuários: tratado como banco fora do ar (sem ler usuários não há login)", async () => {
    setStore(failingStore(seeded, () => new Error("resposta ilegível"), (method, collection) => method === "list" && collection === "users"));
    expect((await loginScreenState()).outage).toMatchObject({ kind: "unreachable", detail: "resposta ilegível" });
  });

  it("instalação vazia continua indo para o primeiro acesso", async () => {
    freshStore();
    expect(await loginScreenState()).toEqual({ empty: true, outage: null, quick: [], quickLive: true });
  });

  it("login com o banco pausado: mensagem com o motivo em vez de exceção; com o banco no ar, entra", async () => {
    setStore(failingStore(seeded, pausedError));
    const blocked = await loginAction(form({ login: "caixa", password: DEMO_PASSWORD }));
    expect(blocked).toMatchObject({ ok: false, code: "db_paused" });
    expect(blocked.ok === false && blocked.error).toMatch(/pausado.*Não é problema de usuário nem de senha/);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    // recuperação de senha: mesma mensagem, sem exceção
    expect(await requestRecoveryAction(form({ login: "caixa" }))).toMatchObject({ ok: false, code: "db_paused" });

    setStore(seeded);
    const ok = await loginAction(form({ login: "caixa", password: DEMO_PASSWORD }));
    expect(ok).toMatchObject({ ok: true, redirect: "/dashboard" });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    // senha errada continua sendo senha errada (não vira "banco indisponível")
    jar.clear();
    const wrong = await loginAction(form({ login: "caixa", password: "senha-errada" }));
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.ok === false && wrong.error).toMatch(/Usuário ou senha inválidos/);
  });

  it("respostas do provedor de autenticação não são confundidas com banco fora do ar", async () => {
    const real = getAuth();
    const provider = (over: Partial<AuthProvider>): AuthProvider => ({
      kind: "appwrite",
      createUser: (...a) => real.createUser(...a),
      setPassword: (...a) => real.setPassword(...a),
      setBlocked: (...a) => real.setBlocked(...a),
      login: (...a) => real.login(...a),
      verify: (...a) => real.verify(...a),
      logout: (...a) => real.logout(...a),
      requestRecovery: (...a) => real.requestRecovery(...a),
      completeRecovery: (...a) => real.completeRecovery(...a),
      ...over,
    });
    const fails = (e: unknown) => async () => {
      throw e;
    };
    try {
      // limite de tentativas do provedor: continua "serviço de autenticação indisponível"
      setAuth(provider({ login: fails(new AppwriteException("Rate limit for the current endpoint has been exceeded.", 429, "general_rate_limit_exceeded")) }));
      const limited = await loginAction(form({ login: "caixa", password: DEMO_PASSWORD }));
      expect(limited.ok === false && limited.error).toMatch(/Serviço de autenticação indisponível/);
      // pausa no meio do login (depois de ler o usuário): motivo informado
      setAuth(provider({ login: fails(pausedError()) }));
      expect(await loginAction(form({ login: "caixa", password: DEMO_PASSWORD }))).toMatchObject({ ok: false, code: "db_paused" });
      // redefinição de senha: 401 é o link inválido/expirado, não a chave do servidor
      const reset = { userId: "u1", secret: "s1", password: "NovaSenha@2026", confirm: "NovaSenha@2026" };
      setAuth(provider({ completeRecovery: fails(new AppwriteException("Invalid token passed in the request.", 401, "user_invalid_token")) }));
      const badLink = await completeRecoveryAction(form(reset));
      expect(badLink.ok === false && badLink.error).toMatch(/Link inválido ou expirado/);
      setAuth(provider({ completeRecovery: fails(pausedError()) }));
      expect(await completeRecoveryAction(form(reset))).toMatchObject({ ok: false, code: "db_paused" });
    } finally {
      setAuth(real);
    }
  });

  it("falha inesperada no login não vira exceção nem expõe o erro interno", async () => {
    setStore(failingStore(seeded, () => new Error("detalhe interno que não deve aparecer")));
    const r = await loginAction(form({ login: "caixa", password: DEMO_PASSWORD }));
    expect(r).toMatchObject({ ok: false, code: "unexpected" });
    expect(r.ok === false && r.error).not.toMatch(/detalhe interno/);
  });
});
