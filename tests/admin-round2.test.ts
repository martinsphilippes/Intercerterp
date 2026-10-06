import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));

// cookies/cabeçalhos da requisição (getSession) — controlados pelo teste
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/bootstrap", () => ({ ensureBootstrap: async () => undefined }));

import { NextResponse } from "next/server";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import type { Doc, ListOptions } from "@/lib/db/types";
import { toCtxUser } from "@/lib/auth/users";
import { getAuth } from "@/lib/auth/provider";
import { safeNextPath } from "@/lib/auth/redirect";
import { syncRoleTemplate } from "@/lib/auth/role-sync";
import { notify } from "@/lib/core/notify";
import type { Ctx } from "@/lib/core/ctx";
import { roleUsers, createRole } from "@/domain/roles";
import { updateUser, setUserStatus, adminSetPassword, resendInvite, cancelInvite } from "@/domain/users";
import { createCompany, setBranchStatus, setCompanyUsers } from "@/domain/companies";
import { requireApiSession, SESSION_COOKIE, UNIT_COOKIE } from "@/lib/server/session";
import { queryRoles } from "@/app/(app)/administracao/usuarios/queries";
import { fileAccessDenial } from "@/app/api/files/[id]/access";

function cnpj(base12: string) {
  const d = base12.split("").map(Number);
  const dv = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = w.reduce((a, x, i) => a + d[i] * x, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  d.push(dv(12));
  d.push(dv(13));
  return d.join("");
}

let store: MemoryStore;
let refs: DemoRefs;
let A: string;
let B: string;
let bB1: string;
let gid: string;

async function req(userId: string, companyId: string, branchId: string | null = null): Promise<Ctx> {
  const u = (await store.get("users", userId))!;
  return { store: scopeStore(store, companyId), companyId, branchId, user: await toCtxUser(store, u, companyId) };
}
async function roleOf(companyId: string, key: string) {
  return (await listAll(store, "roles", { filters: [["eq", "companyId", companyId], ["eq", "key", key]] }))[0];
}
async function directUser(key: string, data: Record<string, any>) {
  return store.create("users", { status: "active", isAdmin: false, branchIds: [], ...data, name: data.name ?? key, email: `${key}@r2.local` }, detId("r2-user", key));
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  A = refs.company.id;
  gid = (await directUser("global", { name: "Gabriel Global", isAdmin: true, companyIds: [] })).id;
  const r = await createCompany(await req(gid, A, refs.branches.matriz.id), { name: "Empresa B R2 Ltda", cnpj: cnpj("457231740009"), regime: "simples", address: { uf: "SP", cityName: "Campinas", cityCode: "3509502" } });
  B = r.company.id;
  bB1 = r.branch.id;
});

/** Gestor de usuários em A; em B tem acesso, mas perfil de Caixa (não administra usuários em B). */
async function partialManager(key: string) {
  const m = await directUser(key, { name: `Gestor ${key}`, companyIds: [A, B], roleByCompany: { [A]: (await roleOf(A, "admin")).id, [B]: (await roleOf(B, "cashier")).id } });
  return req(m.id, A, refs.branches.matriz.id);
}

describe("gestor parcial: senha, situação e convite exigem administrar usuários em TODAS as empresas do alvo", () => {
  it("alvo com empresa fora do alcance: redefinir senha, suspender/inativar, reenviar e cancelar convite são recusados", async () => {
    const g = await partialManager("pm1");
    const t = await directUser("alvo-ab", { name: "Tânia AB", companyIds: [A, B], roleId: (await roleOf(A, "cashier")).id, authId: "local:alvo-ab@r2.local" });
    await expect(adminSetPassword(g, t.id, "NovaSenha@123")).rejects.toThrow(/não administra usuários.*Empresa B R2/);
    await expect(setUserStatus(g, t.id, "suspended", "teste")).rejects.toThrow(/não administra usuários/);
    await expect(setUserStatus(g, t.id, "inactive")).rejects.toThrow(/não administra usuários/);
    expect((await store.get("users", t.id))!.status).toBe("active");
    const inv = await directUser("conv-ab", { name: "Convidado AB", companyIds: [A, B], status: "invited", roleId: (await roleOf(A, "cashier")).id, inviteTokenHash: "x", inviteExpiresAt: "2999-01-01T00:00:00.000Z" });
    await expect(resendInvite(g, inv.id, "http://localhost")).rejects.toThrow(/não administra usuários/);
    await expect(cancelInvite(g, inv.id)).rejects.toThrow(/não administra usuários/);
    expect((await store.get("users", inv.id))!.status).toBe("invited");
  });

  it("alvo só nas empresas do alcance (ou gestor que administra usuários em todas): permitido", async () => {
    const g = await partialManager("pm2");
    const onlyA = await directUser("alvo-a", { name: "Ana A", companyIds: [A], roleId: (await roleOf(A, "cashier")).id, authId: "local:alvo-a@r2.local" });
    expect((await setUserStatus(g, onlyA.id, "suspended", "teste")).status).toBe("suspended");
    const full = await directUser("gestor-full", { name: "Gestor Total", companyIds: [A, B], roleByCompany: { [A]: (await roleOf(A, "admin")).id, [B]: (await roleOf(B, "admin")).id } });
    const gf = await req(full.id, A, refs.branches.matriz.id);
    const t = await directUser("alvo-ab2", { name: "Téo AB", companyIds: [A, B], roleId: (await roleOf(A, "cashier")).id, authId: "local:alvo-ab2@r2.local" });
    expect((await setUserStatus(gf, t.id, "inactive")).status).toBe("inactive");
  });
});

describe("gestor parcial: edição preserva filiais/limite das empresas fora do alcance", () => {
  it("filiais de B (sem admin.users em B) preservadas; incluir filial de B, mudar limite de desconto ou e-mail é recusado", async () => {
    const g = await partialManager("pm3");
    const cashierA = (await roleOf(A, "cashier")).id;
    const t = await directUser("alvo-fil", { name: "Fábio Filiais", companyIds: [A, B], branchIds: [refs.branches.matriz.id, bB1], roleId: cashierA, roleByCompany: { [A]: cashierA, [B]: (await roleOf(B, "cashier")).id } });
    const base = { name: "Fábio Filiais", email: t.email, roleId: cashierA, companyIds: [A, B] };
    // gestor desmarca a filial de B e troca a de A: a de B é preservada, a de A muda
    const after = await updateUser(g, t.id, { ...base, branchIds: [refs.branches.shopping.id] });
    expect([...after.branchIds].sort()).toEqual([refs.branches.shopping.id, bB1].sort());
    // incluir outra filial de B: recusado
    const bB2 = (await listAll(store, "branches", { filters: [["eq", "companyId", B]] })).find((b) => b.id !== bB1);
    if (bB2) await expect(updateUser(g, t.id, { ...base, branchIds: [refs.branches.shopping.id, bB2.id] })).rejects.toThrow(/não administra usuários/);
    // limite de desconto vale em todas as empresas do usuário: recusado
    await expect(updateUser(g, t.id, { ...base, branchIds: [refs.branches.shopping.id], discountLimitBps: 5000 })).rejects.toThrow(/limite de desconto.*não administra usuários/);
    // e-mail (recuperação de senha) também
    await expect(updateUser(g, t.id, { ...base, email: "outro@r2.local", branchIds: [refs.branches.shopping.id] })).rejects.toThrow(/e-mail ou login.*não administra usuários/);
    const final = (await store.get("users", t.id))!;
    expect(final.discountLimitBps ?? null).toBeNull();
    expect(final.email).toBe(t.email);
    expect([...final.branchIds].sort()).toEqual([refs.branches.shopping.id, bB1].sort());
  });

  it("alvo só na empresa do alcance: limite de desconto alterado normalmente", async () => {
    const g = await partialManager("pm4");
    const cashierA = (await roleOf(A, "cashier")).id;
    const t = await directUser("alvo-desc", { name: "Dora Desconto", companyIds: [A], roleId: cashierA });
    const after = await updateUser(g, t.id, { name: "Dora Desconto", email: t.email, roleId: cashierA, companyIds: [A], branchIds: [], discountLimitBps: 700 });
    expect(after.discountLimitBps).toBe(700);
  });
});

describe("destino após login (next)", () => {
  it("caminho que normaliza para protocolo relativo é recusado", () => {
    expect(safeNextPath("/.//evil.example/x")).toBe("/dashboard");
    expect(safeNextPath("/..//evil.example/x")).toBe("/dashboard");
    expect(safeNextPath("/a/..//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/vendas/./123?x=1")).toBe("/vendas/123?x=1");
  });
});

describe("rotas /api exigem contexto de trabalho completo (requireApiSession)", () => {
  it("filial em uso inativada: 409 (nunca opera com Store sem escopo/branchId nulo); filial ativa: sessão", async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const email = "api-user@r2.local";
    const u = await store.create("users", { name: "Api User", email, status: "active", isAdmin: false, companyIds: [A], branchIds: [], roleId: (await roleOf(A, "manager")).id, authId: `local:${email}` }, detId("r2-user", "api"));
    await getAuth().createUser(email, "Senha@12345", u.name);
    const { secret } = await getAuth().login(email, "Senha@12345", false);
    jar.set(SESSION_COOKIE, secret);
    // filial ativa: contexto completo
    jar.set(UNIT_COOKIE, `${A}:${refs.branches.shopping.id}`);
    const ok = await requireApiSession();
    expect(ok).not.toBeInstanceOf(NextResponse);
    expect((ok as any).ctx.branchId).toBe(refs.branches.shopping.id);
    // filial em uso inativada: contexto incompleto → recusado
    await setBranchStatus(gA, refs.branches.shopping.id, "inactive", "teste");
    const bad = await requireApiSession("text");
    expect(bad).toBeInstanceOf(NextResponse);
    expect((bad as NextResponse).status).toBe(409);
    const badJson = (await requireApiSession()) as NextResponse;
    expect(badJson.status).toBe(409);
    expect((await badJson.json()).error).toMatch(/Selecione a empresa e a filial/);
    // as rotas recusam antes de consultar (ex.: vale-crédito do PDV)
    const { GET } = await import("@/app/api/pdv/vouchers/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://localhost/api/pdv/vouchers?code=X"));
    expect(res.status).toBe(409);
    // sem sessão: 401
    jar.delete(SESSION_COOKIE);
    expect(((await requireApiSession()) as NextResponse).status).toBe(401);
    await setBranchStatus(gA, refs.branches.shopping.id, "active");
  });
});

describe("arquivos: pacote contábil exige data.export", () => {
  it("fiscal/consultar sem data.export → 403; com data.export → permitido", () => {
    const meta = { entityType: "fiscal_export", kind: "accounting_package", bucket: "documents" };
    const viewer = { isAdmin: false, permissions: { fiscal: { view: true } }, actions: [] as string[] };
    expect(fileAccessDenial(viewer as any, meta)).toMatch(/exportar dados/);
    expect(fileAccessDenial({ ...viewer, actions: ["data.export"] } as any, meta)).toBeNull();
    expect(fileAccessDenial({ isAdmin: false, permissions: {}, actions: ["data.export"] } as any, meta)).toMatch(/Sem permissão/);
    // demais arquivos fiscais seguem a consulta do módulo
    expect(fileAccessDenial(viewer as any, { entityType: "fiscal_document", bucket: "documents" })).toBeNull();
  });
});

describe("perfis", () => {
  it("notificação por módulo alcança usuário com perfil legado de outra empresa (perfil de sistema equivalente)", async () => {
    // perfil legado de B (sistema "manager"), vinculado a A sem perfil explícito → perfil "manager" de A
    const u = await directUser("legado-b", { name: "Lúcia Legado", companyIds: [A, B], roleId: (await roleOf(B, "manager")).id });
    const n = await notify(scopeStore(store, A), { companyId: A, type: "info", title: "Teste R2", occurrenceKey: "r2:legacy", audience: { module: "finance" } });
    expect(n).toBeGreaterThan(0);
    const mine = await listAll(store, "notifications", { filters: [["eq", "userId", u.id]] });
    expect(mine.some((x) => x.title === "Teste R2")).toBe(true);
  });

  it("sincronização concorrente do modelo audita uma única vez", async () => {
    const manager = await roleOf(A, "manager");
    await store.update("roles", manager.id, { actions: manager.actions.filter((a: string) => a !== "customer.credit_limit"), templateActions: null });
    const r = (await store.get("roles", manager.id))!;
    await Promise.all([syncRoleTemplate(store, r), syncRoleTemplate(store, r), syncRoleTemplate(scopeStore(store, A), r)]);
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "action", "role.template_sync"], ["eq", "entityId", manager.id]] });
    expect(logs).toHaveLength(1);
    expect((await store.get("roles", manager.id))!.actions).toContain("customer.credit_limit");
  });

  it("listagem de perfis conta usuários lendo usuários uma única vez (mesmo resultado de roleUsers)", async () => {
    let usersLists = 0;
    // Store base com contador de varreduras de "users" (o contexto é restrito à empresa sobre ele)
    const counting = new Proxy(store, {
      get(target, prop) {
        if (prop === "list") return (c: string, o?: ListOptions) => (c === "users" && usersLists++, target.list(c, o));
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const gA = await req(gid, A, refs.branches.matriz.id);
    const rows = await queryRoles({ ...gA, store: scopeStore(counting as any, A) });
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      const expected = (await roleUsers(store, r.id)).filter((u: Doc) => u.status !== "inactive").length;
      expect(r.usersCount).toBe(expected);
    }
    // usuários lidos uma única vez, não uma vez por perfil
    expect(usersLists).toBe(1);
  });
});

describe("vínculo com empresa sem perfil equivalente", () => {
  it("setCompanyUsers devolve quem ficou sem perfil (a tela avisa)", async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const custom = await createRole(gA, { name: "Conferente R2", permissions: { stock: { view: true } } as any, actions: [], discountLimitBps: 0 });
    const v = await directUser("sem-perfil", { name: "Vito Sem Perfil", companyIds: [A], roleId: custom.id });
    const linkedB = (await listAll(store, "users")).filter((u) => !u.isAdmin && (u.companyIds ?? []).includes(B)).map((u) => u.id);
    const r = await setCompanyUsers(await req(gid, B, bB1), B, [...linkedB, v.id]);
    expect(r.changes).toEqual(["+Vito Sem Perfil"]);
    expect(r.noRole).toEqual(["Vito Sem Perfil"]);
  });
});
