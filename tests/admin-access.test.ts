import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser, unitBlockReason } from "@/lib/auth/users";
import { safeNextPath } from "@/lib/auth/redirect";
import { syncSystemRoles } from "@/lib/auth/role-sync";
import { DEFAULT_TZ } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import type { Ctx } from "@/lib/core/ctx";
import { createRole, updateRole, roleUsers, actionModule } from "@/domain/roles";
import { createUser, updateUser, setUserStatus, adminSetPassword, authenticate } from "@/domain/users";
import { createCompany, updateCompany, setCompanyStatus, createBranch, updateBranch, setBranchStatus, setCompanyUsers } from "@/domain/companies";
import { createTicket, replyTicket } from "@/domain/support";
import { createRestoreJob, runRestoreJob } from "@/domain/backup";
import { createTerminal, recordConnectorNotConfigured } from "@/domain/terminals";
import { saveParameters, loadParameters } from "@/app/(app)/administracao/parametros/params";
import { PARAM_MAP } from "@/app/(app)/administracao/parametros/catalog";
import { DEFAULT_SETTINGS } from "@/lib/core/settings";

/** CNPJ válido a partir de 12 dígitos. */
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
let gid: string; // administrador global

/** Contexto como numa requisição real: Store restrito à empresa ativa e perfil daquela empresa. */
async function req(userId: string, companyId: string, branchId: string | null = null): Promise<Ctx> {
  const u = (await store.get("users", userId))!;
  return { store: scopeStore(store, companyId), companyId, branchId, user: await toCtxUser(store, u, companyId) };
}

async function roleOf(companyId: string, key: string) {
  return (await listAll(store, "roles", { filters: [["eq", "companyId", companyId], ["eq", "key", key]] }))[0];
}

async function directUser(key: string, data: Record<string, any>) {
  return store.create("users", { status: "active", isAdmin: false, branchIds: [], ...data, name: data.name ?? key, email: `${key}@teste.local` }, detId("t-user", key));
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  A = refs.company.id;
  const g = await directUser("global", { name: "Gabriel Global", isAdmin: true, companyIds: [] });
  gid = g.id;
  const gA = await req(gid, A, refs.branches.matriz.id);
  const r = await createCompany(gA, { name: "Empresa B Ltda", cnpj: cnpj("457231740002"), regime: "simples", address: { uf: "SP", cityName: "Campinas", cityCode: "3509502" } });
  B = r.company.id;
  bB1 = r.branch.id;
});

describe("administração de outra empresa autorizada (contexto restrito à empresa ativa)", () => {
  it("administrador com empresa ativa A edita a empresa B, cria/edita/inativa filial em B e ajusta vínculos de B", async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const up = await updateCompany(gA, B, { name: "Empresa B Renomeada Ltda", cnpj: cnpj("457231740002"), regime: "simples" });
    expect(up.name).toBe("Empresa B Renomeada Ltda");
    const b2 = await createBranch(gA, B, { code: "02", name: "Filial B2", address: { uf: "SP" } });
    expect(b2.companyId).toBe(B);
    expect((await listAll(store, "warehouses", { filters: [["eq", "branchId", b2.id]] })).length).toBe(2);
    expect(b2.timezone).toBe(DEFAULT_TZ);
    const b2u = await updateBranch(gA, b2.id, { code: "02", name: "Filial B2 — Centro", timezone: "America/Manaus" });
    expect(b2u.name).toBe("Filial B2 — Centro");
    expect(b2u.timezone).toBe(DEFAULT_TZ); // fuso único da instalação: campo do formulário ignorado
    expect((await setBranchStatus(gA, b2.id, "inactive", "teste")).status).toBe("inactive");
    const x = await directUser("vinc-x", { name: "Xavier", companyIds: [A], roleId: (await roleOf(A, "cashier")).id });
    expect(await setCompanyUsers(gA, B, [x.id])).toEqual(["+Xavier"]);
    const xb = (await store.get("users", x.id))!;
    expect(xb.companyIds).toEqual([A, B]);
    // perfil equivalente da empresa B (perfil de sistema de mesma chave) definido no vínculo
    expect(xb.roleByCompany[B]).toBe((await roleOf(B, "cashier")).id);
  });

  it("usuário sem acesso à empresa B (ou sem perfil de administração nela) é bloqueado em todas as ações sobre B", async () => {
    const outsider = await directUser("outsider", { name: "Otávio", companyIds: [A], roleId: (await roleOf(A, "admin")).id });
    const o = await req(outsider.id, A, refs.branches.matriz.id);
    expect(can(o.user, "admin", "edit")).toBe(true); // administra a empresa A
    await expect(updateCompany(o, B, { name: "Invasão" })).rejects.toThrow(/acesso/);
    await expect(setCompanyStatus(o, B, "inactive")).rejects.toThrow(/acesso/);
    await expect(createBranch(o, B, { code: "09", name: "Filial invasora" })).rejects.toThrow(/acesso/);
    await expect(updateBranch(o, bB1, { code: "01", name: "Invasão" })).rejects.toThrow(/acesso/);
    await expect(setBranchStatus(o, bB1, "inactive")).rejects.toThrow(/acesso/);
    await expect(setCompanyUsers(o, B, [outsider.id])).rejects.toThrow(/acesso/);
    expect((await store.get("companies", B))!.name).toBe("Empresa B Renomeada Ltda");
    // acesso à B, mas com perfil de Caixa em B: também bloqueado (perfil por empresa)
    const both = await directUser("both", { name: "Bia", companyIds: [A, B], roleId: (await roleOf(A, "admin")).id, roleByCompany: { [A]: (await roleOf(A, "admin")).id, [B]: (await roleOf(B, "cashier")).id } });
    const bA = await req(both.id, A, refs.branches.matriz.id);
    await expect(updateCompany(bA, B, { name: "Tentativa" })).rejects.toThrow(/permissão/);
    await expect(createBranch(bA, B, { code: "08", name: "Tentativa" })).rejects.toThrow(/permissão/);
  });

  it("nova empresa com CNPJ usado antes por outra (depois corrigido) nunca sobrescreve a existente", async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const c1 = cnpj("112223330003");
    const c2 = cnpj("112223330004");
    const first = await createCompany(gA, { name: "Primeira Ltda", cnpj: c1 });
    await updateCompany(gA, first.company.id, { name: "Primeira Ltda", cnpj: c2 });
    const second = await createCompany(gA, { name: "Segunda Ltda", cnpj: c1 });
    expect(second.company.id).not.toBe(first.company.id);
    expect(second.branch.id).not.toBe(first.branch.id);
    const f = (await store.get("companies", first.company.id))!;
    expect(f.name).toBe("Primeira Ltda");
    expect(f.cnpj).toBe(c2);
    await expect(createCompany(gA, { name: "Terceira", cnpj: c1 })).rejects.toThrow(/CNPJ/);
  });
});

describe("usuários: alcance de quem gerencia usuários sem ser administrador", () => {
  let rita: Ctx;
  let ritaId: string;
  beforeAll(async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const rh = await createRole(gA, { name: "Supervisor RH", permissions: { admin: { view: true, create: true, edit: true } } as any, actions: ["admin.users"], discountLimitBps: 0 });
    const r = await createUser(gA, { name: "Rita RH", email: "rita@teste.local", roleId: rh.id, companyIds: [A], branchIds: [], mode: "password", password: "Senha@1234" });
    ritaId = r.user.id;
    rita = await req(ritaId, A, refs.branches.matriz.id);
  });

  it("não redefine senha, não suspende e não altera um administrador global", async () => {
    const g = (await store.get("users", gid))!;
    await expect(adminSetPassword(rita, gid, "Tomada@1234")).rejects.toThrow(/Somente administradores/);
    await expect(setUserStatus(rita, gid, "suspended", "golpe")).rejects.toThrow(/Somente administradores/);
    await expect(updateUser(rita, gid, { name: "x", email: g.email, isAdmin: true, companyIds: [], branchIds: [] })).rejects.toThrow(/Somente administradores/);
    expect((await store.get("users", gid))!.status).toBe("active");
  });

  it("não se vincula nem vincula usuários a empresa alheia; ações sobre usuário de outra empresa são recusadas", async () => {
    const me = (await store.get("users", ritaId))!;
    await expect(updateUser(rita, ritaId, { name: me.name, email: me.email, roleId: me.roleId, companyIds: [A, B], branchIds: [] })).rejects.toThrow(/Empresa fora do seu acesso|próprio vínculo/);
    await expect(createUser(rita, { name: "Fantasma", email: "fantasma@teste.local", roleId: (await roleOf(A, "cashier")).id, companyIds: [A, B], branchIds: [], mode: "password", password: "Senha@1234" })).rejects.toThrow(/Empresa fora do seu acesso/);
    expect((await store.get("users", ritaId))!.companyIds).toEqual([A]);
    const onlyB = await directUser("only-b", { name: "Beto B", companyIds: [B], roleId: (await roleOf(B, "cashier")).id });
    await expect(setUserStatus(rita, onlyB.id, "suspended", "x")).rejects.toThrow(/não encontrado/);
    await expect(adminSetPassword(rita, onlyB.id, "Senha@9999")).rejects.toThrow(/não encontrado/);
    await expect(setCompanyUsers(rita, B, [ritaId])).rejects.toThrow(/acesso/);
    // perfil de outra empresa não é aceito
    const target = await directUser("alvo-a", { name: "Alvo", companyIds: [A], roleId: (await roleOf(A, "cashier")).id });
    await expect(updateUser(rita, target.id, { name: "Alvo", email: target.email, roleId: (await roleOf(B, "admin")).id, companyIds: [A], branchIds: [] })).rejects.toThrow(/Perfil de outra empresa/);
    // não altera o próprio perfil/limite
    await expect(updateUser(rita, ritaId, { name: me.name, email: me.email, roleId: (await roleOf(A, "admin")).id, companyIds: [A], branchIds: [] })).rejects.toThrow(/próprio vínculo/);
  });

  it("editar usuário de várias empresas preserva vínculos e filiais das empresas que o editor não enxerga", async () => {
    const u = await directUser("multi", { name: "Mateus Multi", companyIds: [A, B], branchIds: [bB1], roleId: (await roleOf(A, "cashier")).id });
    const after = await updateUser(rita, u.id, { name: "Mateus Multi", email: u.email, phone: "11999990000", roleId: (await roleOf(A, "cashier")).id, companyIds: [A], branchIds: [] });
    expect(after.companyIds.sort()).toEqual([A, B].sort());
    expect(after.branchIds).toEqual([bB1]);
    expect(after.phone).toBe("11999990000");
  });
});

describe("perfil por empresa", () => {
  it("o perfil de uma empresa não vale nem é trocado na outra", async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const gB = await req(gid, B, bB1);
    const cashierA = await roleOf(A, "cashier");
    const cashierB = await roleOf(B, "cashier");
    const stockB = await roleOf(B, "stockist");
    const { user } = await createUser(gA, { name: "Úrsula Duas", email: "ursula@teste.local", roleId: cashierA.id, companyIds: [A, B], branchIds: [], mode: "password", password: "Senha@1234" });
    expect((await toCtxUser(store, user, A)).roleId).toBe(cashierA.id);
    expect((await toCtxUser(store, user, B)).roleId).toBe(cashierB.id);
    // gerente da B troca o perfil de Úrsula na B: na A nada muda
    await updateUser(gB, user.id, { name: user.name, email: user.email, roleId: stockB.id, companyIds: [A, B], branchIds: [] });
    let u = (await store.get("users", user.id))!;
    expect((await toCtxUser(store, u, A)).roleId).toBe(cashierA.id);
    expect((await toCtxUser(store, u, B)).roleId).toBe(stockB.id);
    // e o gerente da A troca o perfil na A: na B continua o da B
    await updateUser(gA, user.id, { name: user.name, email: user.email, roleId: (await roleOf(A, "finance")).id, companyIds: [A, B], branchIds: [] });
    u = (await store.get("users", user.id))!;
    expect((await toCtxUser(store, u, A)).roleKey).toBe("finance");
    expect((await toCtxUser(store, u, B)).roleId).toBe(stockB.id);
    // Store restrito: o contexto da requisição usa o perfil da empresa do Store
    expect((await toCtxUser(scopeStore(store, B), u)).roleId).toBe(stockB.id);
    expect((await roleUsers(store, stockB.id)).map((x) => x.id)).toContain(user.id);
    expect((await roleUsers(store, cashierB.id)).map((x) => x.id)).not.toContain(user.id);
    // perfil personalizado da A não tem equivalente na B → sem permissões na B
    const custom = await createRole(gA, { name: "Conferente A", permissions: { stock: { view: true } } as any, actions: [], discountLimitBps: 0 });
    const v = await directUser("custom", { name: "Vera", companyIds: [A, B], roleId: custom.id });
    const vB = await toCtxUser(store, v, B);
    expect(vB.permissions).toEqual({});
    expect(can(vB, "stock", "view")).toBe(false);
  });
});

describe("vínculos de usuários por empresa (setCompanyUsers)", () => {
  it("valida todos antes de gravar: nenhum vínculo muda quando um usuário ficaria sem empresa; sucesso é auditado", async () => {
    const gA = await req(gid, A, refs.branches.matriz.id);
    const x = await directUser("sc-x", { name: "Xênia Duas", companyIds: [A, B], branchIds: [refs.branches.matriz.id, bB1], roleId: (await roleOf(A, "cashier")).id });
    const y = await directUser("sc-y", { name: "Yuri Só A", companyIds: [A], roleId: (await roleOf(A, "cashier")).id });
    const linked = (await listAll(store, "users")).filter((u) => !u.isAdmin && (u.companyIds ?? []).includes(A)).map((u) => u.id);
    await expect(setCompanyUsers(gA, A, linked.filter((id) => id !== x.id && id !== y.id))).rejects.toThrow(/Yuri Só A ficaria/);
    expect((await store.get("users", x.id))!.companyIds).toEqual([A, B]); // nada gravado
    const changes = await setCompanyUsers(gA, A, linked.filter((id) => id !== x.id));
    expect(changes).toEqual(["−Xênia Duas"]);
    const xa = (await store.get("users", x.id))!;
    expect(xa.companyIds).toEqual([B]);
    expect(xa.branchIds).toEqual([bB1]);
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "action", "company.users"], ["eq", "entityId", A]] });
    expect(logs.some((l) => l.summary.includes("Xênia Duas"))).toBe(true);
  });
});

describe("último administrador sob concorrência", () => {
  it("suspensões e rebaixamentos cruzados simultâneos deixam ao menos um administrador ativo", async () => {
    const s = new MemoryStore();
    const company = await s.create("companies", { name: "Solo", status: "active" }, "co");
    const role = await s.create("roles", { companyId: company.id, key: "admin", name: "Administrador", permissions: {}, actions: [], system: true, active: true }, "ro");
    const mk = async (id: string) => s.create("users", { name: `Admin ${id}`, email: `${id}@solo.local`, status: "active", isAdmin: true, companyIds: [company.id], branchIds: [] }, id);
    const ctxOf = async (id: string): Promise<Ctx> => ({ store: scopeStore(s, company.id), companyId: company.id, branchId: null, user: await toCtxUser(s, (await s.get("users", id))!, company.id) });
    await mk("x");
    await mk("y");
    const [cx, cy] = [await ctxOf("x"), await ctxOf("y")];
    const r1 = await Promise.allSettled([setUserStatus(cx, "y", "suspended", "cruzado"), setUserStatus(cy, "x", "suspended", "cruzado")]);
    const active1 = (await listAll(s, "users", { filters: [["eq", "isAdmin", true], ["eq", "status", "active"]] })).length;
    expect(active1).toBeGreaterThanOrEqual(1);
    expect(r1.some((r) => r.status === "rejected" && /último administrador/.test(String((r as PromiseRejectedResult).reason?.message)))).toBe(true);
    // volta ao estado inicial e repete com rebaixamento cruzado
    await s.update("users", "x", { status: "active", isAdmin: true });
    await s.update("users", "y", { status: "active", isAdmin: true });
    const [dx, dy] = [await ctxOf("x"), await ctxOf("y")];
    const input = (id: string) => ({ name: `Admin ${id}`, email: `${id}@solo.local`, roleId: role.id, isAdmin: false, companyIds: [company.id], branchIds: [] });
    const r2 = await Promise.allSettled([updateUser(dx, "y", input("y")), updateUser(dy, "x", input("x"))]);
    const active2 = (await listAll(s, "users", { filters: [["eq", "isAdmin", true], ["eq", "status", "active"]] })).length;
    expect(active2).toBeGreaterThanOrEqual(1);
    expect(r2.some((r) => r.status === "rejected")).toBe(true);
  });
});

describe("chamados de suporte: anexos e notificações", () => {
  it("anexo inválido não cria chamado órfão; reenvio com a mesma chave cria o chamado completo; chamado sem mensagem é completado", async () => {
    const cashier = await refs.ctxFor("cashier");
    const before = (await listAll(store, "tickets")).length;
    const base = { category: "erro", priority: "normal", subject: "Erro ao imprimir", message: "A impressora travou ao concluir a venda.", context: { route: "/pdv" }, idemKey: "anexo-1" };
    await expect(createTicket(cashier, { ...base, attachments: [{ name: "log.exe", mime: "application/x-msdownload", data: Buffer.from("MZ") }] })).rejects.toThrow(/não aceito/);
    expect((await listAll(store, "tickets")).length).toBe(before);
    const t = await createTicket(cashier, { ...base, attachments: [{ name: "log.txt", mime: "text/plain", data: Buffer.from("ok") }] });
    const msgs = await listAll(store, "ticket_messages", { filters: [["eq", "ticketId", t.id]] });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].attachments).toHaveLength(1);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "action", "ticket.create"], ["eq", "entityId", t.id]] })).length).toBe(1);
    expect((await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `ticket:${t.id}:triage`]] })).length).toBeGreaterThan(0);
    // chamado gravado sem a mensagem inicial (falha no meio): o reenvio completa, sem duplicar
    const orphanId = detId("ticket", A, "orfao-1");
    await store.create("tickets", { companyId: A, number: 999, userId: refs.users.cashier.id, category: "erro", priority: "normal", subject: "Órfão", status: "open", context: {} }, orphanId);
    const again = await createTicket(cashier, { ...base, subject: "Órfão", idemKey: "orfao-1" });
    expect(again.id).toBe(orphanId);
    expect(await listAll(store, "ticket_messages", { filters: [["eq", "ticketId", orphanId]] })).toHaveLength(1);
    await createTicket(cashier, { ...base, subject: "Órfão", idemKey: "orfao-1" });
    expect(await listAll(store, "ticket_messages", { filters: [["eq", "ticketId", orphanId]] })).toHaveLength(1);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "action", "ticket.create"], ["eq", "entityId", orphanId]] })).length).toBe(1);
  });

  it("cada nova mensagem do solicitante notifica o atendente, também depois de respostas do suporte", async () => {
    const cashier = await refs.ctxFor("cashier");
    const agent = await refs.ctxFor("admin");
    const t = await createTicket(cashier, { category: "duvida", priority: "normal", subject: "Dúvida sobre sangria", message: "Como registrar sangria parcial?", context: {}, idemKey: "notif-1" });
    await replyTicket(agent, t.id, { body: "Use Caixa → Sangria.", idemKey: "a1" });
    await replyTicket(cashier, t.id, { body: "Ainda falha 1", idemKey: "c1" });
    await replyTicket(agent, t.id, { body: "Tente de novo.", idemKey: "a2" });
    await replyTicket(cashier, t.id, { body: "Ainda falha 2", idemKey: "c2" });
    const ns = (await listAll(store, "notifications", { filters: [["eq", "originId", t.id], ["eq", "userId", refs.users.admin.id]] })).filter((n) => String(n.occurrenceKey).includes("awaiting-support"));
    const open = ns.filter((n) => n.occurrenceStatus === "open");
    expect(open).toHaveLength(1);
    expect(open[0].body).toBe("Ainda falha 2");
    expect(ns.filter((n) => n.occurrenceStatus === "resolved").map((n) => n.body)).toEqual(["Ainda falha 1"]);
  });
});

describe("cópias de segurança: empresa da cópia", () => {
  it("restauração/verificação recusa cópia ou tarefa de outra empresa", async () => {
    const admin = await refs.ctxFor("admin");
    const bkB = await store.create("backups", { companyId: B, number: 1, kind: "manual", status: "completed", fileId: "f", scope: { parts: [] }, startedAt: new Date().toISOString() });
    await expect(createRestoreJob(admin, bkB, "test", null)).rejects.toThrow(/outra empresa/);
    const jobB = await store.create("restore_jobs", { companyId: B, backupId: bkB.id, target: "test", status: "pending" });
    await expect(runRestoreJob(admin, jobB.id)).rejects.toThrow(/outra empresa/);
    const jobA = await store.create("restore_jobs", { companyId: A, backupId: bkB.id, target: "test", status: "pending" });
    await expect(runRestoreJob(admin, jobA.id)).rejects.toThrow(/outra empresa/);
    expect((await store.get("backups", bkB.id))!.status).toBe("completed");
  });
});

describe("terminais: sem requisições do servidor ao conector", () => {
  it("o servidor nunca busca a URL do conector; URL com credenciais ou parâmetros é recusada", async () => {
    const admin = await refs.ctxFor("admin");
    const spy = vi.spyOn(globalThis, "fetch");
    const t = await createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX77", name: "Caixa 77", printerMode: "connector", connectorUrl: "http://169.254.169.254/latest/meta-data", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false });
    const r = await recordConnectorNotConfigured(admin, t.id);
    expect(r.verified).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/body/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await expect(createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX78", name: "Caixa 78", printerMode: "connector", connectorUrl: "http://user:pw@127.0.0.1:9100", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false })).rejects.toThrow(/usuário ou senha/);
    await expect(createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX79", name: "Caixa 79", printerMode: "connector", connectorUrl: "http://127.0.0.1:9100/?x=1", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false })).rejects.toThrow(/sem parâmetros/);
  });
});

describe("login, unidades inativas e fuso", () => {
  it("next do login só aceita caminho relativo interno", () => {
    expect(safeNextPath("/vendas?x=1")).toBe("/vendas?x=1");
    expect(safeNextPath("https://phishing.example")).toBe("/dashboard");
    expect(safeNextPath("//phishing.example/x")).toBe("/dashboard");
    expect(safeNextPath("/\\phishing.example")).toBe("/dashboard");
    expect(safeNextPath("/%2F%2Fphishing")).toBe("/%2F%2Fphishing");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeNextPath("/ok\nset-cookie")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it("empresa ou filial inativa não é contexto de trabalho (mensagem clara)", () => {
    expect(unitBlockReason({ status: "active", name: "A" }, { status: "active", name: "Matriz" })).toBeNull();
    expect(unitBlockReason({ status: "inactive", name: "Empresa B" }, null)).toMatch(/Empresa B inativa/);
    expect(unitBlockReason({ status: "active", name: "A" }, { status: "inactive", name: "Filial 2" })).toMatch(/Filial 2 inativa.*consolidado/);
  });

  it("fuso horário é da instalação: parâmetro somente leitura com o valor efetivo", async () => {
    const admin = await refs.ctxFor("admin");
    const tz = (await loadParameters(store, A, null)).find((p) => p.def.key === "timezone")!;
    expect(tz.effective).toBe(DEFAULT_TZ);
    expect(tz.source).toBe("instalação");
    await expect(saveParameters(admin, null, { timezone: "America/Manaus" })).rejects.toThrow(/APP_TIMEZONE/);
    // tolerância de valor no recebimento de compras aparece no catálogo, com padrão
    expect(PARAM_MAP["purchase.receiptValueTolerance"].type).toBe("money");
    expect(DEFAULT_SETTINGS["purchase.receiptValueTolerance"]).toBe(0);
    expect(await saveParameters(admin, null, { "purchase.receiptValueTolerance": "500" })).toEqual(["purchase.receiptValueTolerance"]);
  });
});

describe("perfis de sistema: operações novas do modelo padrão", () => {
  it("acrescenta a operação nova sem remover nada configurado; idempotente; respeita retirada posterior; agrupada no módulo certo", async () => {
    expect(actionModule("customer.credit_limit")).toBe("customers");
    const manager = await roleOf(A, "manager");
    // perfil gravado antes da operação existir (sem registro do modelo aplicado) e com uma operação retirada pelo administrador
    await store.update("roles", manager.id, { actions: manager.actions.filter((a: string) => a !== "customer.credit_limit" && a !== "sale.cancel"), templateActions: null });
    expect(await syncSystemRoles(store, A)).toBe(1);
    let r = (await store.get("roles", manager.id))!;
    expect(r.actions).toContain("customer.credit_limit");
    expect(r.actions).not.toContain("sale.cancel"); // retirada pelo administrador: não volta
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "action", "role.template_sync"], ["eq", "entityId", manager.id]] });
    expect(logs).toHaveLength(1);
    expect(await syncSystemRoles(store, A)).toBe(0);
    // o administrador retira a operação nova: a sincronização não a devolve
    const gA = await req(gid, A, refs.branches.matriz.id);
    await updateRole(gA, manager.id, { name: r.name, permissions: r.permissions, actions: r.actions.filter((a: string) => a !== "customer.credit_limit"), discountLimitBps: r.discountLimitBps });
    expect(await syncSystemRoles(store, A)).toBe(0);
    r = (await store.get("roles", manager.id))!;
    expect(r.actions).not.toContain("customer.credit_limit");
    // contexto do usuário (perfil carregado) também aplica a sincronização pendente
    await store.update("roles", manager.id, { actions: r.actions, templateActions: null });
    const gu = await toCtxUser(store, refs.users.manager, A);
    expect(canDo(gu, "customer.credit_limit")).toBe(true);
  });

  it("autenticação continua funcionando para o administrador global (senha não foi trocada por terceiros)", async () => {
    await expect(authenticate(store, "global@teste.local", "Tomada@1234")).rejects.toThrow(/inválidos/);
  });
});
