import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
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
vi.mock("@/lib/server/bootstrap", async (original) => ({ ...(await original<typeof import("@/lib/server/bootstrap")>()), ensureBootstrap: async () => undefined }));

import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { DEMO_PASSWORD, seedBase, type DemoRefs } from "@/domain/seed/base";
import { findOne, setStore } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { getAuth } from "@/lib/auth/provider";
import { DEMO_SECTORS, isQuickAccessUser, quickAccessPinned } from "@/lib/auth/quick-access";
import { demoAccess, loginScreenState } from "@/app/(auth)/login/access";
import { adminSetPassword, setUserStatus, updateUser } from "@/domain/users";
import { beginTwoFactorSetup, createLoginChallenge, userRequiresTwoFactor } from "@/domain/two-factor";
import { createCompanyWithDefaults } from "@/domain/setup";
import { loginAction, requestRecoveryAction } from "@/app/actions/session";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";

/**
 * Decisão do titular (13/11/2026): os logins de acesso ficam na tela inicial até ele mandar tirar. Com o acesso rápido
 * ligado (`SHOW_DEMO_LOGIN=1`) a senha está na tela e qualquer visitante entra como Administração — e mesmo assim nenhum
 * dos usuários da lista pode sair dela nem deixar de entrar pelo botão. Desligado o acesso rápido, tudo volta ao normal.
 */

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

let store: Store;
let refs: DemoRefs;
let admin: Ctx; // "Administração" da demonstração — o que um visitante usa
const saved = { show: process.env.SHOW_DEMO_LOGIN, backend: process.env.DATA_BACKEND };
const user = async (login: string) => (await findOne(store, "users", [["eq", "login", login]])) as Doc;

beforeAll(async () => {
  store = freshStore();
  await seedDemo(store, { historyDays: 1 });
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
}, 180_000);

beforeEach(() => {
  setStore(store);
  process.env.SHOW_DEMO_LOGIN = "1";
});

afterEach(() => {
  jar.clear();
  process.env.DATA_BACKEND = saved.backend;
  if (saved.show === undefined) delete process.env.SHOW_DEMO_LOGIN;
  else process.env.SHOW_DEMO_LOGIN = saved.show;
});

describe("acesso rápido fixo na tela de login (decisão do titular)", () => {
  it("só os usuários da lista ficam protegidos: da demonstração, com login da lista e sem ser administrador geral", async () => {
    expect(quickAccessPinned()).toBe(true);
    const listed = await demoAccess(store);
    expect(listed).toHaveLength(Object.keys(DEMO_SECTORS).length);
    for (const u of listed) expect(isQuickAccessUser(await user(u.login))).toBe(true);
    expect(isQuickAccessUser({ isDemo: false, login: "caixa" })).toBe(false); // conta real com o mesmo login
    expect(isQuickAccessUser({ isDemo: true, login: "joana.real" })).toBe(false); // fora da lista
    expect(isQuickAccessUser({ isDemo: true, isAdmin: true, login: "admin" })).toBe(false); // administrador geral não aparece na lista
    expect(isQuickAccessUser({ isDemo: true, login: "constructor" })).toBe(false); // nome herdado de objeto não conta
    expect(isQuickAccessUser(null)).toBe(false);
  });

  it("inativar ou suspender um usuário da lista é recusado — e a lista continua inteira", async () => {
    const caixa = await user("caixa");
    await expect(setUserStatus(admin, caixa.id, "inactive")).rejects.toMatchObject({ code: "quick_access", message: expect.stringMatching(/acesso rápido.*decisão do titular/) });
    await expect(setUserStatus(admin, caixa.id, "suspended", "teste de visitante")).rejects.toMatchObject({ code: "quick_access" });
    expect((await user("caixa")).status).toBe("active");
    expect(await demoAccess(store)).toHaveLength(Object.keys(DEMO_SECTORS).length);
  });

  it("trocar a senha é recusado; voltar para a senha da demonstração (a da tela) é aceito", async () => {
    const gerente = await user("gerente");
    await expect(adminSetPassword(admin, gerente.id, "SenhaDeVisitante#1")).rejects.toMatchObject({ code: "quick_access" });
    await getAuth().logout((await getAuth().login(gerente.email, DEMO_PASSWORD, false)).secret); // a da tela continua valendo
    await adminSetPassword(admin, gerente.id, DEMO_PASSWORD);
    await getAuth().logout((await getAuth().login(gerente.email, DEMO_PASSWORD, false)).secret);
  });

  it("“Esqueci minha senha” não gera link de troca para os usuários da lista: a senha é a da tela", async () => {
    const res = await requestRecoveryAction(form({ login: "vendedora" }));
    expect(res).toMatchObject({ ok: true, message: expect.stringMatching(/senha é a exibida no acesso rápido/) });
    expect((await user("vendedora")).resetTokenHash ?? null).toBeNull();
    // fora da lista o fluxo segue o normal (sem canal de e-mail: orienta procurar o administrador)
    delete process.env.SHOW_DEMO_LOGIN;
    expect((await requestRecoveryAction(form({ login: "vendedora" }))).ok).toBe(true);
    expect((await user("vendedora")).resetTokenHash ?? null).not.toBeNull();
  });

  it("e-mail e login não mudam; o resto do cadastro continua editável", async () => {
    const estoque = await user("estoque");
    const base = { name: estoque.name, email: estoque.email, login: estoque.login, phone: estoque.phone ?? null, roleId: estoque.roleId ?? null, companyIds: estoque.companyIds ?? [], branchIds: estoque.branchIds ?? [] };
    await expect(updateUser(admin, estoque.id, { ...base, email: "outro.endereco@exemplo.com" })).rejects.toMatchObject({ code: "quick_access" });
    await expect(updateUser(admin, estoque.id, { ...base, login: "estoque2" })).rejects.toMatchObject({ code: "quick_access" });
    // nem o administrador geral (o dono) muda — nem promove a administrador geral, que não aparece na lista
    const dono = await store.create("users", { name: "Dono Geral", email: "dono.geral@empresa-real.com.br", login: "dono.geral", status: "active", isAdmin: true, companyIds: [admin.companyId], branchIds: [] });
    const donoCtx: Ctx = { store: scopeStore(store, admin.companyId), companyId: admin.companyId, branchId: admin.branchId, user: await toCtxUser(store, dono, admin.companyId) };
    await expect(updateUser(donoCtx, estoque.id, { ...base, email: "trocado.pelo.dono@exemplo.com" })).rejects.toMatchObject({ code: "quick_access" });
    await expect(updateUser(donoCtx, estoque.id, { ...base, isAdmin: true })).rejects.toMatchObject({ code: "quick_access" });
    expect(await user("estoque")).toMatchObject({ email: estoque.email, login: "estoque" });
    expect((await user("estoque")).isAdmin ?? false).toBe(false);
    const after = await updateUser(admin, estoque.id, { ...base, phone: "85999990000" });
    expect(after).toMatchObject({ login: "estoque", email: estoque.email, phone: "85999990000" });
  });

  it("autenticação em duas etapas: o cadastro é recusado e nem o perfil que exige trava o botão", async () => {
    const fiscal = await user("fiscal");
    const fiscalCtx = await refs.ctxFor("fiscal", "matriz");
    await expect(beginTwoFactorSetup(fiscalCtx)).rejects.toMatchObject({ code: "quick_access", message: expect.stringMatching(/senha deles está na tela/) });
    // um visitante liga a exigência no perfil do usuário — o botão continua entrando direto
    const roleId = fiscalCtx.user.roleId!;
    const role = (await store.get("roles", roleId))!;
    await store.update("roles", roleId, { requireTwoFactor: true });
    try {
      expect(await userRequiresTwoFactor(store, fiscal)).toBe(false);
      expect(await createLoginChallenge(store, { user: fiscal, session: { secret: "s", expiresAt: new Date(Date.now() + 60000).toISOString() }, persistent: false, loginKey: "k" })).toBeNull();
      // e com um autenticador já cadastrado (de antes da regra), também
      expect(await createLoginChallenge(store, { user: { ...fiscal, totpEnabled: true, totpSecretEnc: "v1.x.y.z" }, session: { secret: "s", expiresAt: new Date(Date.now() + 60000).toISOString() }, persistent: false, loginKey: "k" })).toBeNull();
      const res = await loginAction(form({ login: "fiscal", password: DEMO_PASSWORD }));
      expect(res).toMatchObject({ ok: true });
      expect(res.ok && res.redirect).not.toBe("/login/duas-etapas");
    } finally {
      await store.update("roles", roleId, { requireTwoFactor: role.requireTwoFactor ?? false });
    }
  });

  it("tentativas erradas não trancam o botão: depois de várias, a senha da tela entra", async () => {
    for (let i = 0; i < 7; i++) {
      const wrong = await loginAction(form({ login: "financeiro", password: `errada-${i}` }));
      expect(wrong).toMatchObject({ ok: false });
      expect(wrong.ok === false && wrong.error).toMatch(/é a da demonstração, exibida no acesso rápido/);
    }
    expect(await loginAction(form({ login: "financeiro", password: DEMO_PASSWORD }))).toMatchObject({ ok: true });
  });

  it("com usuários e empresa reais na instalação, a tela de login continua com a lista inteira", async () => {
    const { company } = await createCompanyWithDefaults(store, { name: "Empresa Real Ltda", key: "real-pin" });
    const owner = await store.create("users", { name: "Dono", email: "dono@empresa-real.com.br", login: "dono", status: "active", isAdmin: true, companyIds: [company.id], branchIds: [] });
    await store.update("users", owner.id, { authId: await getAuth().createUser(owner.email, "SenhaDoDono#2026", owner.name) });
    const st = await loginScreenState();
    expect(st).toMatchObject({ empty: false, outage: null, quickLive: true });
    expect(st.quick.map((u) => u.login)).toEqual(Object.keys(DEMO_SECTORS));
    expect(st.quick.some((u) => u.login === "dono")).toBe(false); // conta real nunca entra na lista
  });

  it("quando o titular desliga o acesso rápido (sem SHOW_DEMO_LOGIN), a proteção sai junto", async () => {
    delete process.env.SHOW_DEMO_LOGIN;
    process.env.DATA_BACKEND = "local"; // publicação com banco de verdade
    expect(quickAccessPinned()).toBe(false);
    const diretoria = await user("diretoria");
    expect(isQuickAccessUser(diretoria)).toBe(false);
    await setUserStatus(admin, diretoria.id, "inactive");
    expect((await user("diretoria")).status).toBe("inactive");
    await setUserStatus(admin, diretoria.id, "active");
    expect((await user("diretoria")).status).toBe("active");
  });
});
