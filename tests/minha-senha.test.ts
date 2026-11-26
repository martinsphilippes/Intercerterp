import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { freshStore } from "./helpers";
import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import type { Ctx } from "@/lib/core/ctx";
import { getAuth } from "@/lib/auth/provider";
import { QUICK_ACCESS_LOCKED } from "@/lib/auth/quick-access";
import { toCtxUser } from "@/lib/auth/users";
import { createCompanyWithDefaults } from "@/domain/setup";
import { PASSWORD_CHANGE_MAX_FAILURES, changeOwnPassword } from "@/domain/users";

/**
 * Minha conta › Segurança — a própria pessoa troca a senha (inclusive no primeiro acesso com senha inicial recebida
 * de outra pessoa): confere a atual, grava a nova, encerra as outras sessões e mantém a atual; tentativas erradas
 * bloqueiam por um tempo; o acesso rápido da demonstração não troca.
 */
const PW = "Senha@Inicial1";
const saved = { show: process.env.SHOW_DEMO_LOGIN };
let store: Store;
let companyId: string;

async function person(key: string, data: Record<string, any> = {}): Promise<Doc> {
  const email = `${key}@senha.local`;
  await store.create("users", { status: "active", isAdmin: false, branchIds: [], companyIds: [companyId], name: key, email, authId: `local:${email}`, ...data }, detId("senha-user", key));
  await getAuth().createUser(email, PW, key);
  return (await store.get("users", detId("senha-user", key)))!;
}
async function ctxOf(u: Doc): Promise<Ctx> {
  return { store: scopeStore(store, companyId), companyId, branchId: null, user: await toCtxUser(store, u, companyId) };
}
const tryLogin = (email: string, password: string) => getAuth().login(email, password, false).then(() => true, () => false);

beforeAll(async () => {
  store = freshStore();
  companyId = (await createCompanyWithDefaults(store, { name: "Senha Ltda", key: "senha-empresa" })).company.id;
});

afterEach(() => {
  if (saved.show === undefined) delete process.env.SHOW_DEMO_LOGIN;
  else process.env.SHOW_DEMO_LOGIN = saved.show;
});

describe("troca da própria senha", () => {
  it("confere a senha atual, grava a nova, encerra as outras sessões e mantém a atual", async () => {
    const u = await person("hercules", { name: "Hércules" });
    const atual = await getAuth().login(u.email, PW, false);
    const outra = await getAuth().login(u.email, PW, false);
    const r = await changeOwnPassword(await ctxOf(u), atual.secret, PW, "NovaSenha#2026");
    expect(r.ended).toBe(1);
    expect(await getAuth().verify(atual.secret)).toBe(u.authId);
    expect(await getAuth().verify(outra.secret)).toBeNull();
    expect(await tryLogin(u.email, PW)).toBe(false);
    expect(await tryLogin(u.email, "NovaSenha#2026")).toBe(true);
    const log = await listAll(store, "audit_logs", { filters: [["eq", "entityId", u.id], ["eq", "action", "user.password_change"]] });
    expect(log.length).toBe(1);
    expect(JSON.stringify(log[0])).not.toContain("NovaSenha");
  });

  it("senha atual errada é recusada e registrada; a senha não muda", async () => {
    const u = await person("rita");
    await expect(changeOwnPassword(await ctxOf(u), "", "errada-123", "OutraSenha#1")).rejects.toThrow(/Senha atual incorreta/);
    expect(await tryLogin(u.email, PW)).toBe(true);
    const fails = await listAll(store, "audit_logs", { filters: [["eq", "entityId", u.id], ["eq", "action", "user.password_change_failed"]] });
    expect(fails.length).toBe(1);
  });

  it(`${PASSWORD_CHANGE_MAX_FAILURES} senhas atuais erradas bloqueiam a troca por um tempo, mesmo com a senha certa depois`, async () => {
    const u = await person("tiago");
    const c = await ctxOf(u);
    for (let i = 0; i < PASSWORD_CHANGE_MAX_FAILURES; i++) await expect(changeOwnPassword(c, "", `errada-${i}-xx`, "OutraSenha#1")).rejects.toThrow(/Senha atual incorreta/);
    await expect(changeOwnPassword(c, "", PW, "OutraSenha#1")).rejects.toMatchObject({ code: "password_change_blocked" });
    expect(await tryLogin(u.email, PW)).toBe(true);
  });

  it("regras da nova senha: mínimo de 8 caracteres e diferente da atual", async () => {
    const u = await person("lia");
    const c = await ctxOf(u);
    await expect(changeOwnPassword(c, "", PW, "curta")).rejects.toThrow(/ao menos 8/);
    await expect(changeOwnPassword(c, "", PW, PW)).rejects.toThrow(/diferente da atual/);
  });

  it("acesso rápido da demonstração não troca a senha (é a da tela de login)", async () => {
    process.env.SHOW_DEMO_LOGIN = "1";
    const u = await person("gerente", { login: "gerente", isDemo: true });
    await expect(changeOwnPassword(await ctxOf(u), "", PW, "OutraSenha#1")).rejects.toMatchObject({ code: QUICK_ACCESS_LOCKED });
    expect(await tryLogin(u.email, PW)).toBe(true);
  });
});
