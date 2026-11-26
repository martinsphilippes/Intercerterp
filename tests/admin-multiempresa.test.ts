import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));

// cookies/cabeçalhos da requisição (getSession nas server actions) — controlados pelo teste
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers({ host: "erp.teste.local" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/server/bootstrap", () => ({ ensureBootstrap: async () => undefined }));

import { freshStore } from "./helpers";
import { detId, listAll, sha256 } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { getAuth } from "@/lib/auth/provider";
import { accessibleUnits, branchScopeOf, toCtxUser, userRoleIn } from "@/lib/auth/users";
import { isQuickAccessUser } from "@/lib/auth/quick-access";
import { createCompanyWithDefaults } from "@/domain/setup";
import { companyAdmins, createRole, deleteRoleChecked, roleChangeImpact, saveRoleChecked, type RoleInput } from "@/domain/roles";
import { ADMIN_RECOVERY_HOURS, adminSetPassword, adminStartRecovery, assertCompanyKeepsAdmin, createUser, listedCompanyUsers, resendInvite, revokeOtherSessions, revokeUserSessions, setUserStatus, updateUser, type UserInput } from "@/domain/users";
import { setCompanyUsers } from "@/domain/companies";
import { lookups } from "@/lib/server/lookups";
import { SESSION_COOKIE, UNIT_COOKIE } from "@/lib/server/session";
import { queryUsers } from "@/app/(app)/administracao/usuarios/queries";
import { previewRoleImpactAction, saveRoleAction, saveUserAction } from "@/app/(app)/administracao/usuarios/actions";
import { revokeOtherSessionsAction } from "@/app/(app)/conta/seguranca/actions";

/**
 * Multiempresa — a empresa contratante administra os próprios usuários, dentro da própria empresa
 * (docs/multiempresa/administracao.md). Cada regra tem a contraprova de que o fluxo permitido continua funcionando.
 */

const PW = "Senha@Teste1";
const ORIGIN = "https://erp.teste";
const saved = { show: process.env.SHOW_DEMO_LOGIN, jobs: process.env.BACKGROUND_JOBS };

let store: MemoryStore;
let A: string; // Alfa (empresa contratante)
let B: string; // Beta (outra empresa contratante)
let P: string; // empresa da plataforma
let A1: string;
let A2: string;
let B1: string;
let P1: string;
const U: Record<string, Doc> = {};

async function req(userId: string, companyId: string, branchId: string | null = null): Promise<Ctx> {
  const u = (await store.get("users", userId))!;
  return { store: scopeStore(store, companyId), companyId, branchId, user: await toCtxUser(store, u, companyId) };
}
async function roleOf(companyId: string, key: string) {
  return (await listAll(store, "roles", { filters: [["eq", "companyId", companyId], ["eq", "key", key]] }))[0];
}
/** Usuário ativo com credencial (senha `PW`). */
async function person(key: string, data: Record<string, any>) {
  const email = `${key}@mt.local`;
  await store.create("users", { status: "active", isAdmin: false, branchIds: [], ...data, name: data.name ?? key, email, authId: `local:${email}` }, detId("mt-user", key));
  await getAuth().createUser(email, PW, data.name ?? key);
  return (await store.get("users", detId("mt-user", key)))!;
}
async function login(u: Record<string, any>) {
  return (await getAuth().login(u.email, PW, false)).secret;
}
async function fresh(id: string) {
  return (await store.get("users", id))!;
}
/** Entrada de edição a partir do cadastro atual (perfil efetivo na empresa informada). */
async function inputOf(id: string, companyId: string, over: Partial<UserInput> = {}): Promise<UserInput> {
  const u = await fresh(id);
  const role = u.isAdmin ? null : await userRoleIn(store, u, companyId);
  return { name: u.name, email: u.email, login: u.login ?? null, phone: u.phone ?? null, roleId: role?.id ?? null, isAdmin: Boolean(u.isAdmin), companyIds: u.companyIds ?? [], branchIds: u.branchIds ?? [], discountLimitBps: u.discountLimitBps ?? null, ...over };
}
function roleInput(r: Doc, over: Partial<RoleInput> = {}): RoleInput {
  return { name: r.name, description: r.description ?? null, permissions: r.permissions, actions: r.actions ?? [], discountLimitBps: r.discountLimitBps ?? 0, active: r.active !== false, requireTwoFactor: Boolean(r.requireTwoFactor), ...over };
}
function linkParts(link: string) {
  const u = new URL(link);
  return { userId: u.searchParams.get("userId")!, secret: u.searchParams.get("secret")! };
}
async function audits(action: string, entityId: string) {
  return listAll(store, "audit_logs", { filters: [["eq", "action", action], ["eq", "entityId", entityId]] });
}

beforeAll(async () => {
  store = freshStore();
  process.env.BACKGROUND_JOBS = "off";
  delete process.env.SHOW_DEMO_LOGIN;
  const a = await createCompanyWithDefaults(store, { name: "Alfa Comércio Ltda", tradeName: "Alfa", key: "mt-alfa", branchName: "Matriz Alfa" });
  const b = await createCompanyWithDefaults(store, { name: "Beta Serviços Ltda", tradeName: "Beta", key: "mt-beta", branchName: "Matriz Beta" });
  const p = await createCompanyWithDefaults(store, { name: "Intercert Plataforma Ltda", tradeName: "Intercert", key: "mt-plat" });
  await store.update("companies", p.company.id, { isPlatform: true });
  [A, B, P] = [a.company.id, b.company.id, p.company.id];
  [A1, B1, P1] = [a.branch.id, b.branch.id, p.branch.id];
  A2 = (await store.create("branches", { companyId: A, code: "02", name: "Alfa Centro", status: "active" })).id;
  const [adminA, adminB, adminP, cashierA, cashierB] = await Promise.all([roleOf(A, "admin"), roleOf(B, "admin"), roleOf(P, "admin"), roleOf(A, "cashier"), roleOf(B, "cashier")]);
  U.root = await person("root", { name: "Raquel Plataforma", isAdmin: true, companyIds: [A, P] });
  U.staff = await person("staff", { name: "Sérgio Equipe Intercert", companyIds: [P], roleId: adminP.id, roleByCompany: { [P]: adminP.id } });
  U.ana = await person("ana", { name: "Ana Alfa", companyIds: [A], roleId: adminA.id, roleByCompany: { [A]: adminA.id } });
  U.bea = await person("bea", { name: "Bea Beta", companyIds: [B], roleId: adminB.id, roleByCompany: { [B]: adminB.id } });
  U.caio = await person("caio", { name: "Caio Caixa", login: "caio.alfa", companyIds: [A], roleId: cashierA.id, roleByCompany: { [A]: cashierA.id } });
  U.beto = await person("beto", { name: "Beto Bastos", login: "beto.beta", companyIds: [B], roleId: cashierB.id, roleByCompany: { [B]: cashierB.id } });
});

afterAll(() => {
  if (saved.jobs === undefined) delete process.env.BACKGROUND_JOBS;
  else process.env.BACKGROUND_JOBS = saved.jobs;
});

afterEach(() => {
  jar.clear();
  if (saved.show === undefined) delete process.env.SHOW_DEMO_LOGIN;
  else process.env.SHOW_DEMO_LOGIN = saved.show;
});

describe("isolamento: o administrador da empresa A só enxerga e administra a empresa A", () => {
  it("listas e seletores: só os usuários da empresa; o administrador da plataforma só para quem é da plataforma", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const listed = (await listedCompanyUsers(anaA)).map((u) => u.id);
    expect(listed).toEqual(expect.arrayContaining([U.ana.id, U.caio.id]));
    expect(listed).not.toContain(U.beto.id);
    expect(listed).not.toContain(U.root.id);
    const rows = (await queryUsers(anaA, { q: "", f: {} })).map((r) => r.id);
    expect(rows).toContain(U.caio.id);
    expect(rows).not.toContain(U.root.id);
    expect(rows).not.toContain(U.bea.id);
    for (const opts of [await lookups.users(anaA), await lookups.sellers(anaA)]) {
      const ids = opts.map((o) => o.value);
      expect(ids).toContain(U.caio.id);
      expect(ids).not.toContain(U.root.id);
      expect(ids).not.toContain(U.beto.id);
    }
    // contraprova: o administrador da plataforma e quem trabalha na empresa da plataforma enxergam a equipe da plataforma
    const rootA = await req(U.root.id, A, A1);
    expect((await listedCompanyUsers(rootA)).map((u) => u.id)).toContain(U.root.id);
    expect((await lookups.users(rootA)).map((o) => o.value)).toContain(U.root.id);
    expect((await lookups.users(await req(U.staff.id, P, P1))).map((o) => o.value)).toContain(U.root.id);
  });

  it("não altera, não suspende, não encerra sessões, não inicia recuperação nem reenvia convite de usuário só da empresa B", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const beto = U.beto;
    const session = await login(beto);
    await expect(updateUser(anaA, beto.id, { name: "Invadido", email: beto.email, roleId: (await roleOf(A, "cashier")).id, companyIds: [A], branchIds: [] })).rejects.toThrow(/não encontrado/);
    await expect(setUserStatus(anaA, beto.id, "suspended", "tentativa")).rejects.toThrow(/não encontrado/);
    await expect(revokeUserSessions(anaA, beto.id)).rejects.toThrow(/não encontrado/);
    await expect(adminStartRecovery(anaA, beto.id, ORIGIN)).rejects.toThrow(/não encontrado/);
    const invitedB = await createUser(await req(U.bea.id, B, B1), { name: "Convidada Beta", email: "convidada.beta@mt.local", roleId: (await roleOf(B, "cashier")).id, companyIds: [B], branchIds: [], mode: "invite", origin: ORIGIN });
    await expect(resendInvite(anaA, invitedB.user.id, ORIGIN)).rejects.toThrow(/não encontrado/);
    // contraprova: nada mudou em B
    const after = await fresh(beto.id);
    expect(after).toMatchObject({ name: beto.name, status: "active" });
    expect(after.resetTokenHash ?? null).toBeNull();
    expect(after.sessionsValidAfter ?? null).toBeNull();
    expect(await getAuth().verify(session)).toBe(beto.authId);
    expect((await fresh(invitedB.user.id)).inviteTokenHash).toBe(invitedB.user.inviteTokenHash);
  });

  it("não convida para outra empresa; e-mail e login duplicados não revelam quem é de outra empresa", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const cashierA = (await roleOf(A, "cashier")).id;
    const novo = (over: Partial<UserInput>) => createUser(anaA, { name: "Nova Pessoa", email: "nova.pessoa@mt.local", roleId: cashierA, companyIds: [A], branchIds: [], mode: "invite", origin: ORIGIN, ...over });
    await expect(novo({ companyIds: [A, B] })).rejects.toThrow(/Empresa fora do seu acesso/);
    await expect(novo({ companyIds: [B] })).rejects.toThrow(/continuar vinculado à empresa em uso/);
    for (const [over, msg, hidden] of [
      [{ email: U.beto.email }, /E-mail já cadastrado no ERP/, U.beto.name],
      [{ email: U.root.email }, /E-mail já cadastrado no ERP/, U.root.name], // o administrador da plataforma também não é revelado
      [{ login: "beto.beta" }, /Login indisponível/, U.beto.name],
    ] as const) {
      const e = await novo(over).catch((x) => x);
      expect(e.message).toMatch(msg);
      expect(e.message).not.toContain(hidden);
      expect(e.code).toBe("duplicate");
    }
    // a unicidade do login vale em TODOS os usuários (o Store da empresa só enxerga os dela) — também na edição
    await expect(updateUser(anaA, U.caio.id, await inputOf(U.caio.id, A, { login: "beto.beta" }))).rejects.toThrow(/Login indisponível/);
    expect((await fresh(U.caio.id)).login).toBe("caio.alfa");
    // contraprova: duplicidade dentro da própria empresa continua dizendo quem é
    await expect(novo({ email: U.caio.email })).rejects.toThrow(/E-mail já usado pelo usuário Caio Caixa/);
    await expect(novo({ login: "caio.alfa" })).rejects.toThrow(/Login já usado pelo usuário Caio Caixa/);
  });

  it("não atribui perfil da empresa B; mensagens não nomeiam empresas fora do acesso do editor", async () => {
    const anaA = await req(U.ana.id, A, A1);
    await expect(updateUser(anaA, U.caio.id, await inputOf(U.caio.id, A, { roleId: (await roleOf(B, "admin")).id }))).rejects.toThrow(/Perfil de outra empresa/);
    const duo = await person("duo-ab", { name: "Duda Duas", companyIds: [A, B], roleId: (await roleOf(A, "cashier")).id, roleByCompany: { [A]: (await roleOf(A, "cashier")).id, [B]: (await roleOf(B, "cashier")).id } });
    const e = await setUserStatus(anaA, duo.id, "suspended", "teste").catch((x) => x);
    expect(e.message).toMatch(/não administra usuários \(outra empresa do ERP\)/);
    expect(e.message).not.toMatch(/Beta/);
    expect((await fresh(duo.id)).status).toBe("active");
  });
});

describe("encerrar sessões", () => {
  it("o administrador encerra todas as sessões de um usuário da empresa (sessionsValidAfter + linhas apagadas, auditado)", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const [s1, s2] = [await login(U.caio), await login(U.caio)];
    expect(await getAuth().verify(s1)).toBe(U.caio.authId);
    const r = await revokeUserSessions(anaA, U.caio.id, "celular perdido");
    expect(r.ended).toBe(2);
    expect(await getAuth().verify(s1)).toBeNull();
    expect(await getAuth().verify(s2)).toBeNull();
    expect((await fresh(U.caio.id)).sessionsValidAfter).toBe(r.at);
    expect(await listAll(store, "sessions", { filters: [["eq", "userId", U.caio.id]] })).toHaveLength(0);
    const [log] = await audits("user.sessions_revoke", U.caio.id);
    expect(log).toMatchObject({ companyId: A, userId: U.ana.id, reason: "celular perdido", result: "success" });
    // contraprova: um login novo vale normalmente
    const s3 = await login(U.caio);
    expect(await getAuth().verify(s3)).toBe(U.caio.authId);
    await getAuth().logout(s3);
    // ninguém encerra as próprias sessões pela tela de usuários (a atual cairia junto)
    await expect(revokeUserSessions(anaA, U.ana.id)).rejects.toThrow(/Minha conta › Segurança/);
    // quem não administra usuários não encerra sessões de ninguém
    await expect(revokeUserSessions(await req(U.caio.id, A, A1), U.ana.id)).rejects.toThrow(/permissão/i);
  });

  it("o próprio usuário encerra as OUTRAS sessões e mantém a atual", async () => {
    const [a, b, c] = [await login(U.caio), await login(U.caio), await login(U.caio)];
    const caioA = await req(U.caio.id, A, A1);
    await expect(revokeOtherSessions(caioA, "segredo-que-nao-existe")).rejects.toThrow(/sessão atual/);
    const r = await revokeOtherSessions(caioA, b);
    expect(r.ended).toBe(2);
    expect(await getAuth().verify(b)).toBe(U.caio.authId);
    expect(await getAuth().verify(a)).toBeNull();
    expect(await getAuth().verify(c)).toBeNull();
    expect(await audits("user.sessions_revoke_others", U.caio.id)).toHaveLength(1);
    await getAuth().logout(b);
  });

  it("Minha conta › Segurança: a ação usa a sessão do cookie e a mantém aberta", async () => {
    const [keep, other] = [await login(U.caio), await login(U.caio)];
    jar.set(SESSION_COOKIE, keep);
    jar.set(UNIT_COOKIE, `${A}:${A1}`);
    expect(await revokeOtherSessionsAction()).toMatchObject({ ok: true, message: expect.stringMatching(/1 outra\(s\) sessão\(ões\) encerrada\(s\)/) });
    expect(await getAuth().verify(keep)).toBe(U.caio.authId);
    expect(await getAuth().verify(other)).toBeNull();
    await getAuth().logout(keep);
  });
});

describe("recuperação de senha iniciada pelo administrador", () => {
  it("link de uso único (só o hash gravado), exibido sem canal de e-mail; ao usar, as sessões anteriores deixam de valer", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const old = await login(U.caio);
    const { recovery } = await adminStartRecovery(anaA, U.caio.id, `${ORIGIN}/`);
    expect(recovery.delivered).toBe(false); // sem canal de e-mail: o link aparece ao administrador (como no convite)
    expect(recovery.link).toMatch(/^https:\/\/erp\.teste\/redefinir-senha\?userId=[^&]+&secret=[0-9a-f]{48}$/);
    const { userId, secret } = linkParts(recovery.link);
    expect(userId).toBe(U.caio.id);
    const stored = await fresh(U.caio.id);
    expect(stored.resetTokenHash).toBe(sha256(secret));
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(Date.parse(stored.resetExpiresAt) - Date.now()).toBeGreaterThan((ADMIN_RECOVERY_HOURS - 1) * 3600000);
    const [log] = await audits("user.recovery_start", U.caio.id);
    expect(log).toMatchObject({ companyId: A, userId: U.ana.id });
    expect(JSON.stringify(log)).not.toContain(secret);
    // a senha atual vale até a nova ser definida
    expect(await getAuth().verify(old)).toBe(U.caio.authId);
    await getAuth().completeRecovery({ userId, secret, password: "NovaSenha@2026" });
    expect(await getAuth().verify(old)).toBeNull();
    expect((await fresh(U.caio.id)).sessionsValidAfter).toBeTruthy();
    await expect(getAuth().login(U.caio.email, PW, false)).rejects.toThrow(/invalid_credentials/);
    const next = await getAuth().login(U.caio.email, "NovaSenha@2026", false);
    expect(await getAuth().verify(next.secret)).toBe(U.caio.authId);
    // uso único
    await expect(getAuth().completeRecovery({ userId, secret, password: "Outra@2026x" })).rejects.toThrow(/invalid_token/);
    await getAuth().logout(next.secret);
    await getAuth().createUser(U.caio.email, PW, U.caio.name); // volta à senha dos demais testes
  });

  it("o link expira; gerar outro invalida o anterior; suspender também invalida", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const first = await adminStartRecovery(anaA, U.caio.id, ORIGIN);
    const second = await adminStartRecovery(anaA, U.caio.id, ORIGIN);
    await expect(getAuth().completeRecovery({ ...linkParts(first.recovery.link), password: "Tentativa@1" })).rejects.toThrow(/invalid_token/);
    await store.update("users", U.caio.id, { resetExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(getAuth().completeRecovery({ ...linkParts(second.recovery.link), password: "Tentativa@1" })).rejects.toThrow(/invalid_token/);
    const third = await adminStartRecovery(anaA, U.caio.id, ORIGIN);
    await setUserStatus(anaA, U.caio.id, "suspended", "apuração");
    await expect(getAuth().completeRecovery({ ...linkParts(third.recovery.link), password: "Tentativa@1" })).rejects.toThrow(/invalid_token/);
    await setUserStatus(anaA, U.caio.id, "active");
    await expect(getAuth().login(U.caio.email, PW, false)).resolves.toBeTruthy();
  });

  it("recusas: convite pendente, o próprio acesso e usuário que também é de empresa fora do alcance", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const inv = await createUser(anaA, { name: "Ivo Convite", email: "ivo.convite@mt.local", roleId: (await roleOf(A, "cashier")).id, companyIds: [A], branchIds: [], mode: "invite", origin: ORIGIN });
    await expect(adminStartRecovery(anaA, inv.user.id, ORIGIN)).rejects.toThrow(/Reenviar convite/);
    await expect(adminStartRecovery(anaA, U.ana.id, ORIGIN)).rejects.toThrow(/Esqueci minha senha/);
    await expect(adminStartRecovery(anaA, detId("mt-user", "duo-ab"), ORIGIN)).rejects.toThrow(/não administra usuários/);
  });
});

describe("último administrador POR EMPRESA (o administrador da plataforma não conta)", () => {
  let C: string;
  let D: string;
  let C1: string;
  let g1: Doc;
  let paC: Ctx;
  beforeAll(async () => {
    const c = await createCompanyWithDefaults(store, { name: "Gama Indústria Ltda", tradeName: "Gama", key: "mt-gama" });
    const d = await createCompanyWithDefaults(store, { name: "Delta Varejo Ltda", tradeName: "Delta", key: "mt-delta" });
    [C, D, C1] = [c.company.id, d.company.id, c.branch.id];
    const [adminC, adminD] = [await roleOf(C, "admin"), await roleOf(D, "admin")];
    // único administrador das duas empresas; o administrador da plataforma também está vinculado (e não conta)
    g1 = await person("g1", { name: "Gil Gama", companyIds: [C, D], roleId: adminC.id, roleByCompany: { [C]: adminC.id, [D]: adminD.id } });
    const pa = await person("pa", { name: "Pedro Plataforma", isAdmin: true, companyIds: [C, D] });
    paC = await req(pa.id, C, C1);
  });

  it("suspender, inativar, trocar o perfil, desvincular ou tornar administrador da plataforma: bloqueado com last_company_admin", async () => {
    expect((await companyAdmins(store, C)).map((u) => u.id)).toEqual([g1.id]);
    const cashierC = (await roleOf(C, "cashier")).id;
    for (const op of [
      () => setUserStatus(paC, g1.id, "suspended", "teste"),
      () => setUserStatus(paC, g1.id, "inactive"),
      async () => updateUser(paC, g1.id, await inputOf(g1.id, C, { roleId: cashierC })),
      async () => updateUser(paC, g1.id, await inputOf(g1.id, C, { companyIds: [C] })), // desvincular de Delta
      async () => updateUser(paC, g1.id, await inputOf(g1.id, C, { isAdmin: true })),
    ]) {
      await expect(op()).rejects.toMatchObject({ code: "last_company_admin", message: expect.stringMatching(/último administrador ativo de (Gama|Delta)/) });
    }
    const g = await fresh(g1.id);
    expect(g.status).toBe("active");
    expect([...g.companyIds].sort()).toEqual([C, D].sort());
    expect(g.isAdmin ?? false).toBe(false);
    expect((await userRoleIn(store, g, C))?.key).toBe("admin");
  });

  it("perfil: retirar administração, desativar ou excluir o perfil do último administrador é bloqueado", async () => {
    const adminC = await roleOf(C, "admin");
    const variants: RoleInput[] = [
      roleInput(adminC, { actions: adminC.actions.filter((a: string) => a !== "admin.users") }),
      roleInput(adminC, { permissions: { ...adminC.permissions, admin: { view: true } } }),
      roleInput(adminC, { active: false }),
    ];
    for (const input of variants) {
      const imp = await roleChangeImpact(paC, adminC.id, input);
      await expect(saveRoleChecked(paC, adminC.id, input, { impactToken: imp.token })).rejects.toMatchObject({ code: "last_company_admin", message: expect.stringMatching(/Gil Gama é o último administrador ativo de Gama/) });
    }
    expect((await store.get("roles", adminC.id))!.actions).toContain("admin.users");
    // perfil próprio de administração usado só pelo último administrador: não pode ser excluído
    const own = await createRole(paC, { name: "Diretoria Gama", permissions: { admin: { view: true, create: true, edit: true } } as any, actions: ["admin.users"], discountLimitBps: 0 });
    await updateUser(paC, g1.id, await inputOf(g1.id, C, { roleId: own.id })); // continua administrador: permitido
    await expect(deleteRoleChecked(paC, own.id)).rejects.toMatchObject({ code: "last_company_admin" });
    expect(await store.get("roles", own.id)).not.toBeNull();
    await updateUser(paC, g1.id, await inputOf(g1.id, C, { roleId: adminC.id }));
  });

  it("auxiliar para desvincular por outro caminho (Empresas › Usuários): recusa tirar o último administrador", async () => {
    await expect(assertCompanyKeepsAdmin(paC, C, [g1.id])).rejects.toMatchObject({ code: "last_company_admin", message: expect.stringMatching(/Gil Gama é o último administrador ativo de Gama/) });
    await expect(assertCompanyKeepsAdmin(paC, C, [detId("mt-user", "outro")])).resolves.toBeUndefined();
    // a tela Empresas › Usuários usa a mesma regra: nada é gravado
    await expect(setCompanyUsers(paC, C, [])).rejects.toMatchObject({ code: "last_company_admin" });
    expect((await fresh(g1.id)).companyIds).toContain(C);
  });

  it("com outro administrador ativo da empresa, as mesmas operações são permitidas", async () => {
    const [adminC, adminD, cashierC] = [await roleOf(C, "admin"), await roleOf(D, "admin"), await roleOf(C, "cashier")];
    await person("g2", { name: "Gina Gama", companyIds: [C, D], roleId: adminC.id, roleByCompany: { [C]: adminC.id, [D]: adminD.id } });
    expect((await setUserStatus(paC, g1.id, "suspended", "férias")).status).toBe("suspended");
    expect((await setUserStatus(paC, g1.id, "active")).status).toBe("active");
    const changed = await updateUser(paC, g1.id, await inputOf(g1.id, C, { roleId: cashierC.id }));
    expect((await userRoleIn(store, changed, C))?.key).toBe("cashier");
    expect((await userRoleIn(store, changed, D))?.key).toBe("admin"); // o perfil na outra empresa não muda
    const input = roleInput(adminC, { discountLimitBps: 9000 });
    expect((await saveRoleChecked(paC, adminC.id, input, { impactToken: (await roleChangeImpact(paC, adminC.id, input)).token })).discountLimitBps).toBe(9000);
  });

  it("concorrência: dois administradores suspendendo ou rebaixando um ao outro deixam a empresa com administrador", async () => {
    const e = await createCompanyWithDefaults(store, { name: "Épsilon Ltda", tradeName: "Épsilon", key: "mt-eps" });
    const E = e.company.id;
    const [adminE, cashierE] = [await roleOf(E, "admin"), await roleOf(E, "cashier")];
    const x = await person("ex", { name: "Xavier Épsilon", companyIds: [E], roleId: adminE.id, roleByCompany: { [E]: adminE.id } });
    const y = await person("ey", { name: "Yara Épsilon", companyIds: [E], roleId: adminE.id, roleByCompany: { [E]: adminE.id } });
    const r1 = await Promise.allSettled([setUserStatus(await req(x.id, E, e.branch.id), y.id, "suspended", "cruzado"), setUserStatus(await req(y.id, E, e.branch.id), x.id, "suspended", "cruzado")]);
    expect((await companyAdmins(store, E)).length).toBeGreaterThanOrEqual(1);
    expect(r1.some((r) => r.status === "rejected" && (r.reason as any)?.code === "last_company_admin")).toBe(true);
    await store.update("users", x.id, { status: "active" });
    await store.update("users", y.id, { status: "active" });
    const [cx, cy] = [await req(x.id, E, e.branch.id), await req(y.id, E, e.branch.id)];
    const r2 = await Promise.allSettled([updateUser(cx, y.id, await inputOf(y.id, E, { roleId: cashierE.id })), updateUser(cy, x.id, await inputOf(x.id, E, { roleId: cashierE.id }))]);
    expect((await companyAdmins(store, E)).length).toBeGreaterThanOrEqual(1);
    expect(r2.some((r) => r.status === "rejected")).toBe(true);
  });
});

describe("perfil só dentro do próprio escopo", () => {
  let rh: Doc;
  let consulta: Doc;
  let rhRole: Doc;
  beforeAll(async () => {
    const rootA = await req(U.root.id, A, A1);
    rhRole = await createRole(rootA, { name: "Gestor de acessos", permissions: { admin: { view: true, create: true, edit: true } } as any, actions: ["admin.users"], discountLimitBps: 0 });
    consulta = await createRole(rootA, { name: "Consulta da administração", permissions: { admin: { view: true } } as any, actions: [], discountLimitBps: 0 });
    rh = await person("rh", { name: "Rita RH", companyIds: [A], roleId: rhRole.id, roleByCompany: { [A]: rhRole.id } });
  });

  it("o editor só atribui perfis cujo acesso ele mesmo tem; não troca o perfil de quem tem acesso maior", async () => {
    const rhA = await req(rh.id, A, A1);
    const cashierA = (await roleOf(A, "cashier")).id;
    const novo = (over: Partial<UserInput>) => createUser(rhA, { name: "Nova Caixa", email: "nova.caixa@mt.local", roleId: cashierA, companyIds: [A], branchIds: [], companyBranchIds: [], mode: "invite", origin: ORIGIN, ...over });
    await expect(novo({})).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/perfil “Caixa”.*Fora do seu perfil: .*PDV/) });
    await expect(novo({ roleId: (await roleOf(A, "admin")).id, email: "nova.adm@mt.local" })).rejects.toMatchObject({ code: "forbidden" });
    // dentro do escopo: permitido (inclusive o próprio perfil do editor)
    const ok = await novo({ name: "Nina Consulta", email: "nina.consulta@mt.local", roleId: consulta.id });
    expect(ok.user.roleByCompany[A]).toBe(consulta.id);
    const promoted = await updateUser(rhA, ok.user.id, await inputOf(ok.user.id, A, { roleId: rhRole.id }));
    expect(promoted.roleByCompany[A]).toBe(rhRole.id);
    // quem já tem acesso maior que o do editor (Caixa) não tem o perfil trocado — nem para menos
    await expect(updateUser(rhA, U.caio.id, await inputOf(U.caio.id, A, { roleId: consulta.id }))).rejects.toThrow(/Trocar o perfil de Caio Caixa: o perfil atual \(“Caixa”\)/);
    expect((await userRoleIn(store, await fresh(U.caio.id), A))?.id).toBe(cashierA);
    // editar outros dados de quem tem acesso maior, sem trocar o perfil, continua permitido
    expect((await updateUser(rhA, U.caio.id, await inputOf(U.caio.id, A, { phone: "85988887777" }))).phone).toBe("85988887777");
    // contraprova: o administrador da empresa e o da plataforma atribuem o Caixa
    const anaA = await req(U.ana.id, A, A1);
    expect((await updateUser(anaA, ok.user.id, await inputOf(ok.user.id, A, { roleId: cashierA }))).roleByCompany[A]).toBe(cashierA);
    expect((await updateUser(await req(U.root.id, A, A1), ok.user.id, await inputOf(ok.user.id, A, { roleId: (await roleOf(A, "admin")).id }))).roleByCompany[A]).toBe((await roleOf(A, "admin")).id);
  });

  it("quem tem acesso maior que o do editor não tem a conta assumida: senha, recuperação e e-mail/login", async () => {
    const rhA = await req(rh.id, A, A1);
    await expect(adminSetPassword(rhA, U.caio.id, "OutraSenha#2026")).rejects.toThrow(/Redefinir a senha: Caio Caixa tem acessos que você não tem nesta empresa \(perfil “Caixa”\)/);
    await expect(adminStartRecovery(rhA, U.caio.id, ORIGIN)).rejects.toThrow(/Iniciar a recuperação de senha: Caio Caixa tem acessos que você não tem/);
    await expect(updateUser(rhA, U.caio.id, await inputOf(U.caio.id, A, { email: "rita.controla@mt.local" }))).rejects.toThrow(/Alterar e-mail ou login: Caio Caixa tem acessos que você não tem/);
    const caio = await fresh(U.caio.id);
    expect(caio.email).toBe("caio@mt.local");
    expect(caio.resetTokenHash ?? null).toBeNull();
    // contraprova: dentro do alcance do editor é permitido; o administrador da empresa assume o caso de quem tem mais acesso
    const leo = await person("leo", { name: "Léo Consulta", companyIds: [A], roleId: consulta.id, roleByCompany: { [A]: consulta.id } });
    await expect(adminSetPassword(rhA, leo.id, "NovaSenha#2026")).resolves.toBeUndefined();
    expect((await adminStartRecovery(await req(U.ana.id, A, A1), U.caio.id, ORIGIN)).recovery.expiresAt).toBeTruthy();
  });

  it("vínculo com outra empresa: o perfil equivalente lá também precisa estar no alcance do editor naquela empresa", async () => {
    const rhB = await createRole(await req(U.root.id, B, B1), { name: "Gestor de acessos Beta", permissions: { admin: { view: true, create: true, edit: true } } as any, actions: ["admin.users"], discountLimitBps: 0 });
    const duo = await person("duo-adm", { name: "Davi Duplo", companyIds: [A, B], roleId: (await roleOf(A, "admin")).id, roleByCompany: { [A]: (await roleOf(A, "admin")).id, [B]: rhB.id } });
    const duoA = await req(duo.id, A, A1);
    const base = { name: "Caixa Dupla", email: "caixa.dupla@mt.local", roleId: (await roleOf(A, "cashier")).id, branchIds: [], mode: "invite" as const, origin: ORIGIN };
    await expect(createUser(duoA, { ...base, companyIds: [A, B] })).rejects.toThrow(/acessos que você mesmo tem em Beta: o perfil “Caixa”/);
    expect((await createUser(duoA, { ...base, companyIds: [A] })).user.companyIds).toEqual([A]);
  });
});

describe("impacto antes de salvar perfil compartilhado", () => {
  it("mostra as pessoas afetadas e a diferença; sem a confirmação do impacto exato, não salva", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const cashier = await roleOf(A, "cashier");
    const input = roleInput(cashier, { permissions: { ...cashier.permissions, stock: { view: true } }, discountLimitBps: 800 });
    const imp = await roleChangeImpact(anaA, cashier.id, input);
    expect(imp.required).toBe(true);
    expect(imp.affected).toEqual(expect.arrayContaining([{ id: U.caio.id, name: "Caio Caixa", email: U.caio.email, status: "active" }]));
    expect(imp.affected.some((p) => p.id === U.beto.id || p.id === U.root.id)).toBe(false); // só pessoas desta empresa
    expect(imp.diff.before).toMatchObject({ "Desconto máximo": "5%", "Estoque · Visualizar": "Não permitido" });
    expect(imp.diff.after).toMatchObject({ "Desconto máximo": "8%", "Estoque · Visualizar": "Permitido" });
    await expect(saveRoleChecked(anaA, cashier.id, input)).rejects.toMatchObject({ code: "impact_confirmation", message: expect.stringMatching(/Confirme o impacto.*Caio Caixa/) });
    await expect(saveRoleChecked(anaA, cashier.id, input, { impactToken: "outro-impacto" })).rejects.toMatchObject({ code: "impact_confirmation" });
    expect((await store.get("roles", cashier.id))!.discountLimitBps).toBe(cashier.discountLimitBps);
    // outra pessoa entrou no perfil depois da prévia: a confirmação anterior não vale mais
    const extra = await person("extra-caixa", { name: "Elisa Extra", companyIds: [A], roleId: cashier.id, roleByCompany: { [A]: cashier.id } });
    await expect(saveRoleChecked(anaA, cashier.id, input, { impactToken: imp.token })).rejects.toThrow(/mudaram desde a confirmação/);
    const again = await roleChangeImpact(anaA, cashier.id, input);
    expect(again.affected.map((p) => p.id)).toContain(extra.id);
    const saved = await saveRoleChecked(anaA, cashier.id, input, { impactToken: again.token, reason: "teste de impacto" });
    expect(saved.discountLimitBps).toBe(800);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "action", "role.update"], ["eq", "entityId", cashier.id]] })).some((l) => l.reason === "teste de impacto")).toBe(true);
    // perfil sem ninguém: salva sem confirmação; nada muda: também
    const lonely = await createRole(anaA, { name: "Perfil sem pessoas", permissions: { dashboard: { view: true } } as any, actions: [], discountLimitBps: 0 });
    expect((await roleChangeImpact(anaA, lonely.id, roleInput(lonely, { discountLimitBps: 100 }))).required).toBe(false);
    expect((await saveRoleChecked(anaA, lonely.id, roleInput(lonely, { discountLimitBps: 100 }))).discountLimitBps).toBe(100);
    const fresher = (await store.get("roles", cashier.id))!;
    expect((await roleChangeImpact(anaA, cashier.id, roleInput(fresher))).required).toBe(false);
  });

  it("a server action recusa salvar sem a confirmação quando há pessoas afetadas", async () => {
    jar.set(SESSION_COOKIE, await login(U.ana));
    jar.set(UNIT_COOKIE, `${A}:${A1}`);
    const role = await roleOf(A, "stockist");
    await person("estoq", { name: "Edu Estoque", companyIds: [A], roleId: role.id, roleByCompany: { [A]: role.id } });
    const form = () => {
      const fd = new FormData();
      fd.set("id", role.id);
      fd.set("name", role.name);
      fd.set("description", role.description ?? "");
      fd.set("discountPct", "3");
      fd.set("active", "1");
      for (const [mod, ops] of Object.entries(role.permissions ?? {})) for (const [op, on] of Object.entries(ops as Record<string, boolean>)) if (on) fd.set(`perm.${mod}.${op}`, "on");
      for (const a of role.actions ?? []) fd.append("action", a);
      return fd;
    };
    expect(await saveRoleAction(form())).toMatchObject({ ok: false, code: "impact_confirmation" });
    expect((await store.get("roles", role.id))!.discountLimitBps).toBe(role.discountLimitBps);
    const preview = await previewRoleImpactAction(form());
    expect(preview.ok).toBe(true);
    const impact = (preview as { data: any }).data;
    expect(impact.affected.map((p: any) => p.name)).toContain("Edu Estoque");
    expect(impact.diff.after["Desconto máximo"]).toBe("3%");
    const confirmed = form();
    confirmed.set("confirmImpact", impact.token);
    expect(await saveRoleAction(confirmed)).toMatchObject({ ok: true });
    expect((await store.get("roles", role.id))!.discountLimitBps).toBe(300);
  });
});

describe("cargo separado de perfil e filial", () => {
  it("cargo por empresa, exibido na lista; não altera perfil nem filiais", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const manager = await roleOf(A, "manager");
    const { user } = await createUser(anaA, { name: "Gabi Gerente", email: "gabi@mt.local", roleId: manager.id, companyIds: [A], branchIds: [], companyBranchIds: [], jobTitle: "  Gerente de loja  ", mode: "password", password: PW });
    expect(user.jobTitleByCompany).toEqual({ [A]: "Gerente de loja" });
    const row = (await queryUsers(anaA, { q: "", f: {} })).find((r) => r.id === user.id)!;
    expect(row).toMatchObject({ jobTitle: "Gerente de loja", roleName: manager.name, branchesLabel: "Todas as filiais" });
    expect((await queryUsers(anaA, { q: "gerente de loja", f: {} })).map((r) => r.id)).toEqual([user.id]);
    await expect(updateUser(anaA, user.id, await inputOf(user.id, A, { jobTitle: "x".repeat(81) }))).rejects.toThrow(/até 80 caracteres/);
    // por empresa: o cargo de uma empresa não muda o da outra
    const multi = await person("multi-cargo", { name: "Mia Multi", companyIds: [A, B], roleId: (await roleOf(A, "cashier")).id, roleByCompany: { [A]: (await roleOf(A, "cashier")).id, [B]: (await roleOf(B, "cashier")).id } });
    await updateUser(await req(U.root.id, B, B1), multi.id, await inputOf(multi.id, B, { jobTitle: "Consultora" }));
    await updateUser(anaA, multi.id, await inputOf(multi.id, A, { jobTitle: "Caixa líder" }));
    expect((await fresh(multi.id)).jobTitleByCompany).toEqual({ [A]: "Caixa líder", [B]: "Consultora" });
    // vazio apaga só o desta empresa; desvincular leva junto o cargo daquela empresa
    await updateUser(anaA, multi.id, await inputOf(multi.id, A, { jobTitle: "" }));
    expect((await fresh(multi.id)).jobTitleByCompany).toEqual({ [B]: "Consultora" });
    await updateUser(await req(U.root.id, A, A1), multi.id, await inputOf(multi.id, A, { companyIds: [A], jobTitle: "Caixa" }));
    expect((await fresh(multi.id)).jobTitleByCompany).toEqual({ [A]: "Caixa" });
    // autoproteção: quem não é administrador não muda o próprio cargo
    const rita = detId("mt-user", "rh");
    await expect(updateUser(await req(rita, A, A1), rita, await inputOf(rita, A, { jobTitle: "Diretora" }))).rejects.toThrow(/próprio vínculo, cargo/);
  });

  it("server action: grava cargo e filiais desta empresa a partir do formulário", async () => {
    jar.set(SESSION_COOKIE, await login(U.ana));
    jar.set(UNIT_COOKIE, `${A}:${A1}`);
    const u = await fresh(U.caio.id);
    const fd = new FormData();
    fd.set("id", u.id);
    fd.set("name", u.name);
    fd.set("email", u.email);
    fd.set("login", u.login);
    fd.set("roleId", (await roleOf(A, "cashier")).id);
    fd.append("companyIds", A);
    fd.set("jobTitle", "Operador de caixa");
    fd.set("branchMode", "some");
    expect(await saveUserAction(fd)).toMatchObject({ ok: false, code: "branch_required" });
    fd.append("companyBranchIds", A2);
    expect(await saveUserAction(fd)).toMatchObject({ ok: true });
    const after = await fresh(U.caio.id);
    expect(after.jobTitleByCompany[A]).toBe("Operador de caixa");
    expect(after.branchIdsByCompany[A]).toEqual([A2]);
    fd.set("branchMode", "all");
    expect(await saveUserAction(fd)).toMatchObject({ ok: true });
    expect(branchScopeOf(await fresh(U.caio.id), A)).toBeNull();
  });
});

describe("filiais por empresa", () => {
  it("o formulário grava as filiais só da empresa em uso (todas = []); filial de outra empresa é recusada sem ser nomeada", async () => {
    const anaA = await req(U.ana.id, A, A1);
    const legacy = (await fresh(U.caio.id)).branchIds;
    const one = await updateUser(anaA, U.caio.id, await inputOf(U.caio.id, A, { companyBranchIds: [A2] }));
    expect(one.branchIdsByCompany[A]).toEqual([A2]);
    expect(one.branchIds).toEqual(legacy); // a lista legada não muda
    expect(branchScopeOf(one, A)).toEqual([A2]);
    expect((await accessibleUnits(store, one)).branches.filter((b) => b.companyId === A).map((b) => b.id)).toEqual([A2]);
    const all = await updateUser(anaA, U.caio.id, await inputOf(U.caio.id, A, { companyBranchIds: [] }));
    expect(all.branchIdsByCompany[A]).toEqual([]);
    expect(branchScopeOf(all, A)).toBeNull();
    const e = await updateUser(anaA, U.caio.id, await inputOf(U.caio.id, A, { companyBranchIds: [B1] })).catch((x) => x);
    expect(e.message).toMatch(/Filial inválida: o cadastro só atribui filiais da empresa em uso/);
    expect(e.message).not.toContain("Matriz Beta");
  });

  it("cada empresa define as filiais dela, sem mexer nas da outra", async () => {
    const duo = await person("filiais-ab", { name: "Fábio Filiais", companyIds: [A, B], roleId: (await roleOf(A, "cashier")).id, roleByCompany: { [A]: (await roleOf(A, "cashier")).id, [B]: (await roleOf(B, "cashier")).id } });
    await updateUser(await req(U.root.id, B, B1), duo.id, await inputOf(duo.id, B, { companyBranchIds: [B1] }));
    await updateUser(await req(U.ana.id, A, A1), duo.id, await inputOf(duo.id, A, { companyBranchIds: [A1] }));
    const u = await fresh(duo.id);
    expect(u.branchIdsByCompany).toEqual({ [A]: [A1], [B]: [B1] });
    expect((await accessibleUnits(store, u)).branches.map((b) => b.id).sort()).toEqual([A1, B1].sort());
  });

  it("quem acessa só algumas filiais só concede filiais dentre as dele", async () => {
    const restr = await person("restr", { name: "Rosa Restrita", companyIds: [A], roleId: (await roleOf(A, "admin")).id, roleByCompany: { [A]: (await roleOf(A, "admin")).id }, branchIdsByCompany: { [A]: [A1] } });
    const rA = await req(restr.id, A, A1);
    expect(rA.user.branchIds).toEqual([A1]);
    const cashierA = (await roleOf(A, "cashier")).id;
    const novo = (over: Partial<UserInput>) => createUser(rA, { name: "Nina Nova", email: "nina.nova@mt.local", roleId: cashierA, companyIds: [A], branchIds: [], mode: "invite", origin: ORIGIN, ...over });
    await expect(novo({ companyBranchIds: [] })).rejects.toThrow(/não pode liberar todas as filiais para Nina Nova/);
    await expect(novo({ companyBranchIds: [A2] })).rejects.toThrow(/Filial fora do seu acesso: Alfa Centro/);
    await expect(novo({})).rejects.toThrow(/não pode liberar todas as filiais/); // modo legado (lista única) também
    expect((await novo({ companyBranchIds: [A1] })).user.branchIdsByCompany).toEqual({ [A]: [A1] });
    // quem acessa todas as filiais não é restringido por quem acessa só algumas
    const todas = await person("todas", { name: "Teo Todas", companyIds: [A], roleId: cashierA, roleByCompany: { [A]: cashierA } });
    await expect(updateUser(rA, todas.id, await inputOf(todas.id, A, { companyBranchIds: [A1] }))).rejects.toThrow(/Teo Todas acessa todas as filiais desta empresa/);
    expect((await updateUser(rA, todas.id, await inputOf(todas.id, A, { companyBranchIds: [], phone: "85999990000" }))).phone).toBe("85999990000");
    // filiais do usuário fora do alcance do editor são mantidas
    const ambas = await person("ambas", { name: "Bia Ambas", companyIds: [A], roleId: cashierA, roleByCompany: { [A]: cashierA }, branchIdsByCompany: { [A]: [A1, A2] } });
    const kept = await updateUser(rA, ambas.id, await inputOf(ambas.id, A, { companyBranchIds: [A1] }));
    expect([...kept.branchIdsByCompany[A]].sort()).toEqual([A1, A2].sort());
  });
});

describe("acesso rápido (isQuickAccessUser) continua protegido", () => {
  it("não encerra sessões nem gera link de recuperação dos usuários da lista; desligado o acesso rápido, a proteção sai", async () => {
    process.env.SHOW_DEMO_LOGIN = "1";
    const finance = await roleOf(A, "finance");
    const demo = await person("demo-fin", { name: "Fernanda Demonstração", login: "financeiro", isDemo: true, companyIds: [A], roleId: finance.id, roleByCompany: { [A]: finance.id } });
    expect(isQuickAccessUser(demo)).toBe(true);
    const anaA = await req(U.ana.id, A, A1);
    const s = await login(demo);
    await expect(revokeUserSessions(anaA, demo.id)).rejects.toMatchObject({ code: "quick_access" });
    await expect(adminStartRecovery(anaA, demo.id, ORIGIN)).rejects.toMatchObject({ code: "quick_access" });
    await expect(revokeOtherSessions(await req(demo.id, A, A1), s)).rejects.toMatchObject({ code: "quick_access" });
    await expect(setUserStatus(anaA, demo.id, "inactive")).rejects.toMatchObject({ code: "quick_access" });
    expect(await getAuth().verify(s)).toBe(demo.authId);
    expect((await fresh(demo.id)).resetTokenHash ?? null).toBeNull();
    delete process.env.SHOW_DEMO_LOGIN;
    expect((await revokeUserSessions(anaA, demo.id)).ended).toBe(1);
    expect(await getAuth().verify(s)).toBeNull();
  });
});
