import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll, findOne } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { toCtxUser } from "@/lib/auth/users";
import { can, canDo } from "@/lib/permissions";
import { requireAction } from "@/lib/core/ctx";
import { PermissionError } from "@/lib/core/errors";
import { createRole, updateRole, deleteRole, duplicateRole, normalizeMatrix } from "@/domain/roles";
import { createUser, acceptInvite, authenticate, setUserStatus, updateUser, cancelInvite, resendInvite } from "@/domain/users";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { markNotifications, archiveNotifications, setNotificationPrefs, queryNotifications } from "@/domain/notifications";
import { createTicket, replyTicket, updateTicket, ticketMessages, queryTickets } from "@/domain/support";
import { createBranch, createCompany, updateBranch } from "@/domain/companies";
import { createTerminal, checkConnectorFromServer, recordBrowserPrintPage } from "@/domain/terminals";
import { ensureHelpArticles, HELP_ARTICLES, articlesForRoute, searchArticles } from "@/domain/help-content";
import type { Ctx } from "@/lib/core/ctx";

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin");
});

async function ctxOfUser(id: string, branchKey = "matriz"): Promise<Ctx> {
  const u = (await store.get("users", id))!;
  return { store, companyId: refs.company.id, branchId: refs.branches[branchKey].id, user: await toCtxUser(store, u) };
}

describe("perfis e permissões (matriz + ações especiais)", () => {
  it("aplica a matriz por módulo/operação e as operações específicas via can/canDo", async () => {
    const role = await createRole(admin, {
      name: "Conferente",
      permissions: { stock: { create: true }, products: { view: true }, finance: { delete: true } } as any,
      actions: ["stock.adjust", "acao.inexistente"],
      discountLimitBps: 300,
    });
    // qualquer operação implica visualizar; ações desconhecidas são descartadas
    expect(role.permissions.stock).toEqual({ view: true, create: true });
    expect(role.permissions.finance.view).toBe(true);
    expect(role.actions).toEqual(["stock.adjust"]);
    const { user } = await createUser(admin, { name: "Rui Conferente", email: "rui@teste.local", login: "rui", roleId: role.id, companyIds: [refs.company.id], branchIds: [], mode: "password", password: "Senha@1234" });
    const ctx = await ctxOfUser(user.id);
    expect(can(ctx.user, "stock", "view")).toBe(true);
    expect(can(ctx.user, "stock", "create")).toBe(true);
    expect(can(ctx.user, "stock", "delete")).toBe(false);
    expect(can(ctx.user, "sales", "view")).toBe(false);
    expect(canDo(ctx.user, "stock.adjust")).toBe(true);
    expect(canDo(ctx.user, "sale.cancel")).toBe(false);
    expect(() => requireAction(ctx, "sale.cancel")).toThrow(PermissionError);
    expect(ctx.user.discountLimitBps).toBe(300);
    // limite individual substitui o do perfil
    await updateUser(admin, user.id, { name: user.name, email: user.email, login: "rui", roleId: role.id, companyIds: [refs.company.id], branchIds: [], discountLimitBps: 750 });
    expect((await ctxOfUser(user.id)).user.discountLimitBps).toBe(750);
    // alteração da matriz vale para os próximos acessos
    await updateRole(admin, role.id, { name: "Conferente", permissions: { ...role.permissions, sales: { view: true } }, actions: ["stock.adjust", "sale.cancel"], discountLimitBps: 300 });
    const ctx2 = await ctxOfUser(user.id);
    expect(can(ctx2.user, "sales", "view")).toBe(true);
    expect(canDo(ctx2.user, "sale.cancel")).toBe(true);
    // administrador ignora a matriz
    expect(can(admin.user, "fiscal", "delete") && canDo(admin.user, "admin.backup")).toBe(true);
    // usuário sem "admin.users" não gerencia perfis
    const cashier = await refs.ctxFor("cashier");
    await expect(createRole(cashier, { name: "X", permissions: {}, actions: [], discountLimitBps: 0 })).rejects.toThrow(PermissionError);
  });

  it("perfis de sistema são editáveis mas não excluíveis; perfil em uso não é excluído; duplicação", async () => {
    const roles = await listAll(store, "roles", { filters: [["eq", "companyId", refs.company.id]] });
    const sys = roles.find((r) => r.key === "cashier")!;
    await updateRole(admin, sys.id, { name: sys.name, permissions: sys.permissions, actions: sys.actions, discountLimitBps: 800 });
    expect((await store.get("roles", sys.id))!.discountLimitBps).toBe(800);
    await expect(deleteRole(admin, sys.id)).rejects.toThrow(/sistema/);
    const copy = await duplicateRole(admin, sys.id);
    expect(copy.name).toContain("cópia");
    expect(copy.system).toBe(false);
    expect(normalizeMatrix(copy.permissions)).toEqual(normalizeMatrix(sys.permissions));
    await deleteRole(admin, copy.id);
    expect(await store.get("roles", copy.id)).toBeNull();
  });
});

describe("convite → primeiro acesso → login local", () => {
  it("gera link com token e validade, ativa no primeiro acesso e permite login", async () => {
    const roleId = (await findOne(store, "roles", [["eq", "key", "cashier"]]))!.id;
    const r = await createUser(admin, { name: "Paula Nova", email: "paula@teste.local", login: "paula", roleId, companyIds: [refs.company.id], branchIds: [refs.branches.matriz.id], mode: "invite", origin: "http://localhost:3000" });
    expect(r.user.status).toBe("invited");
    expect(r.invite!.delivered).toBe(false); // canal de e-mail não configurado → link exibido
    expect(r.invite!.link).toMatch(/^http:\/\/localhost:3000\/convite\/[0-9a-f]{48}$/);
    expect(r.user.inviteDelivery).toMatch(/Não enviado/);
    // token não fica gravado em claro
    const token = r.invite!.link.split("/").pop()!;
    expect(JSON.stringify(await store.get("users", r.user.id))).not.toContain(token);
    // login antes de aceitar é bloqueado
    await expect(authenticate(store, "paula", "Senha@1234")).rejects.toThrow(/Convite pendente/);
    const active = await acceptInvite(store, token, "Senha@1234");
    expect(active.status).toBe("active");
    expect(active.firstAccessAt).toBeTruthy();
    const { user, session } = await authenticate(store, "paula", "Senha@1234");
    expect(user.id).toBe(r.user.id);
    expect(session.secret).toHaveLength(64);
    await expect(authenticate(store, "paula", "errada123")).rejects.toThrow(/inválidos/);
    // token não pode ser reutilizado
    await expect(acceptInvite(store, token, "Outra@1234")).rejects.toThrow(/inválido/);
  });

  it("reenvio invalida o token anterior; cancelamento invalida o link; convite vencido é recusado", async () => {
    const roleId = (await findOne(store, "roles", [["eq", "key", "stockist"]]))!.id;
    const r = await createUser(admin, { name: "Tiago Temp", email: "tiago@teste.local", roleId, companyIds: [refs.company.id], branchIds: [], mode: "invite", origin: "http://x" });
    const t1 = r.invite!.link.split("/").pop()!;
    const again = await resendInvite(admin, r.user.id, "http://x");
    const t2 = again.invite.link.split("/").pop()!;
    expect(t2).not.toBe(t1);
    await expect(acceptInvite(store, t1, "Senha@1234")).rejects.toThrow(/inválido/);
    await store.update("users", r.user.id, { inviteExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(acceptInvite(store, t2, "Senha@1234")).rejects.toThrow(/expirado/);
    const again2 = await resendInvite(admin, r.user.id, "http://x");
    await cancelInvite(admin, r.user.id);
    await expect(acceptInvite(store, again2.invite.link.split("/").pop()!, "Senha@1234")).rejects.toThrow(/inválido/);
    expect((await store.get("users", r.user.id))!.status).toBe("inactive");
  });
});

describe("suspensão e último administrador", () => {
  it("suspensão com motivo bloqueia o login e encerra sessões; reativação libera", async () => {
    const cashier = refs.users.cashier;
    const { session } = await authenticate(store, "caixa", "Intercert@2026");
    expect(await store.list("sessions", { filters: [["eq", "userId", cashier.id]] }).then((r) => r.total)).toBeGreaterThan(0);
    await expect(setUserStatus(admin, cashier.id, "suspended", "")).rejects.toThrow(/motivo/);
    await setUserStatus(admin, cashier.id, "suspended", "Divergência de caixa em apuração");
    await expect(authenticate(store, "caixa", "Intercert@2026")).rejects.toThrow(/suspenso: Divergência de caixa/);
    expect((await store.list("sessions", { filters: [["eq", "userId", cashier.id]] })).total).toBe(0);
    const { getAuth } = await import("@/lib/auth/provider");
    expect(await getAuth().verify(session.secret)).toBeNull();
    await setUserStatus(admin, cashier.id, "active");
    const ok = await authenticate(store, "caixa", "Intercert@2026");
    expect(ok.user.status).toBe("active");
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityId", cashier.id], ["eq", "action", "user.suspend"]] });
    expect(logs[0].reason).toBe("Divergência de caixa em apuração");
  });

  it("ninguém altera o próprio acesso e o último administrador ativo é protegido", async () => {
    const a = refs.users.admin;
    await expect(setUserStatus(admin, a.id, "inactive")).rejects.toThrow(/próprio acesso/);
    await expect(updateUser(admin, a.id, { name: a.name, email: a.email, login: a.login, roleId: a.roleId, isAdmin: false, companyIds: a.companyIds, branchIds: [] })).rejects.toThrow(/último administrador/);
    // gestor de usuários (sem ser administrador) também não consegue suspender o último administrador
    const mgrRole = await createRole(admin, { name: "Gestor de acessos", permissions: { admin: { view: true, create: true, edit: true } } as any, actions: ["admin.users"], discountLimitBps: 0 });
    const { user: mgr } = await createUser(admin, { name: "Gestor", email: "gestor@teste.local", roleId: mgrRole.id, companyIds: [refs.company.id], branchIds: [], mode: "password", password: "Senha@1234" });
    const mctx = await ctxOfUser(mgr.id);
    await expect(setUserStatus(mctx, a.id, "suspended", "teste")).rejects.toThrow(/último administrador/);
    // e não pode conceder acesso de administrador
    await expect(updateUser(mctx, mgr.id, { name: mgr.name, email: mgr.email, roleId: mgrRole.id, isAdmin: true, companyIds: [refs.company.id], branchIds: [] })).rejects.toThrow(/Somente administradores/);
    // com um segundo administrador ativo, o primeiro pode ser rebaixado
    const { user: a2 } = await createUser(admin, { name: "Admin Dois", email: "admin2@teste.local", isAdmin: true, companyIds: [refs.company.id], branchIds: [], mode: "password", password: "Senha@1234" });
    const a2ctx = await ctxOfUser(a2.id);
    const demoted = await updateUser(a2ctx, a.id, { name: a.name, email: a.email, login: a.login, roleId: a.roleId, isAdmin: false, companyIds: a.companyIds, branchIds: [] });
    expect(demoted.isAdmin).toBe(false);
    await expect(updateUser(a2ctx, a2.id, { name: a2.name, email: a2.email, isAdmin: false, roleId: a.roleId, companyIds: [refs.company.id], branchIds: [] })).rejects.toThrow(/último administrador/);
    await updateUser(a2ctx, a.id, { name: a.name, email: a.email, login: a.login, roleId: a.roleId, isAdmin: true, companyIds: a.companyIds, branchIds: [] });
  });
});

describe("central de notificações", () => {
  it("ler não resolve a ocorrência; arquivar só informativa/resolvida; preferências silenciam o tipo", async () => {
    const a = refs.users.admin;
    await notify(store, { companyId: refs.company.id, type: "stock_min", title: "Carregador USB-C abaixo do mínimo", link: "/estoque", occurrenceKey: "stockmin:teste", audience: { userIds: [a.id] } });
    const [n] = (await queryNotifications(admin, { type: "stock_min" })).filter((x) => x.occurrenceKey === "stockmin:teste");
    expect(n.occurrenceStatus).toBe("open");
    const r = await markNotifications(admin, [n.id], true);
    expect(r.changed).toBe(1);
    expect(r.stillOpen).toBe(1);
    const after = (await store.get("notifications", n.id))!;
    expect(after.readAt).toBeTruthy();
    expect(after.occurrenceStatus).toBe("open"); // leitura não resolve
    expect(await archiveNotifications(admin, [n.id])).toEqual({ archived: 0, blocked: 1 });
    await resolveOccurrence(store, "stockmin:teste");
    expect(await archiveNotifications(admin, [n.id])).toEqual({ archived: 1, blocked: 0 });
    // outro usuário não manipula notificação alheia
    const cashier = await refs.ctxFor("cashier");
    await expect(markNotifications(cashier, [n.id], false)).rejects.toThrow(/não encontrada/);
    // silenciar tipo
    await setNotificationPrefs(admin, ["stock_min"]);
    expect(await notify(store, { companyId: refs.company.id, type: "stock_min", title: "x", occurrenceKey: "stockmin:2", audience: { userIds: [a.id] } })).toBe(0);
    expect(await notify(store, { companyId: refs.company.id, type: "stock_min", priority: "critical", title: "x", occurrenceKey: "stockmin:3", audience: { userIds: [a.id] } })).toBe(1);
    await setNotificationPrefs(admin, []);
    expect(await notify(store, { companyId: refs.company.id, type: "stock_min", title: "x", occurrenceKey: "stockmin:4", audience: { userIds: [a.id] } })).toBe(1);
  });
});

describe("chamados de suporte", () => {
  it("chamado com resposta do suporte, nota interna, reabertura pelo solicitante e histórico", async () => {
    const cashier = await refs.ctxFor("cashier");
    const t = await createTicket(cashier, { category: "pdv", priority: "high", subject: "Impressora não imprime cupom", message: "Ao concluir a venda a impressora não imprime o cupom.", context: { route: "/pdv", userAgent: "vitest" }, attachments: [{ name: "erro.txt", mime: "text/plain", data: Buffer.from("log do erro") }], idemKey: "k1" });
    expect(t.number).toBe(1);
    expect(t.status).toBe("open");
    // idempotente
    expect((await createTicket(cashier, { category: "pdv", priority: "high", subject: "Impressora não imprime cupom", message: "Ao concluir a venda a impressora não imprime o cupom.", context: {}, idemKey: "k1" })).id).toBe(t.id);
    // suporte recebeu notificação de triagem
    const triage = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `ticket:${t.id}:triage`]] });
    expect(triage.length).toBeGreaterThan(0);
    await replyTicket(admin, t.id, { body: "Verifique se o modo de impressão do terminal está como navegador.", idemKey: "r1" });
    await replyTicket(admin, t.id, { body: "Nota: possível driver.", internal: true });
    let cur = (await store.get("tickets", t.id))!;
    expect(cur.status).toBe("waiting");
    expect(cur.assigneeId).toBe(refs.users.admin.id);
    expect(cur.externalStatus).toBe("e-mail: canal não configurado");
    expect((await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `ticket:${t.id}:triage`]] })).every((n) => n.occurrenceStatus === "resolved")).toBe(true);
    const reply = await listAll(store, "notifications", { filters: [["eq", "userId", refs.users.cashier.id], ["eq", "originId", t.id]] });
    expect(reply.length).toBe(1);
    // solicitante não vê nota interna e não registra nota interna
    expect((await ticketMessages(store, t.id, false)).length).toBe(2);
    expect((await ticketMessages(store, t.id, true)).length).toBe(3);
    await expect(replyTicket(cashier, t.id, { body: "x interno", internal: true })).rejects.toThrow(/suporte/);
    await replyTicket(cashier, t.id, { body: "Ainda não funciona." });
    cur = (await store.get("tickets", t.id))!;
    expect(cur.status).toBe("open");
    await updateTicket(admin, t.id, { status: "resolved" });
    await updateTicket(cashier, t.id, { status: "closed" });
    await expect(replyTicket(cashier, t.id, { body: "mais uma" })).rejects.toThrow(/encerrado/);
    const history = await listAll(store, "audit_logs", { filters: [["eq", "entityType", "ticket"], ["eq", "entityId", t.id]] });
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["ticket.create", "ticket.reply", "ticket.note", "ticket.message", "ticket.update"]));
    // outro usuário sem support.manage não enxerga o chamado
    const stock = await refs.ctxFor("stockist");
    expect((await queryTickets(stock, {})).some((x) => x.id === t.id)).toBe(false);
    expect((await queryTickets(admin, { scope: "all" })).some((x) => x.id === t.id)).toBe(true);
    const files = await listAll(store, "files", { filters: [["eq", "entityType", "ticket"], ["eq", "entityId", t.id]] });
    expect(files).toHaveLength(1);
  });
});

describe("empresas, filiais e terminais", () => {
  it("nova filial cria depósitos e conta caixa; nova empresa recebe parametrização inicial", async () => {
    const b = await createBranch(admin, refs.company.id, { code: "03", name: "Filial — Bairro", cnpj: "11222333000343", address: { uf: "SP", cityName: "Campinas", cityCode: "3509502" }, timezone: "America/Sao_Paulo" });
    const whs = await listAll(store, "warehouses", { filters: [["eq", "branchId", b.id]] });
    expect(whs.map((w) => w.kind).sort()).toEqual(["available", "damaged"]);
    expect(b.defaultWarehouseId).toBe(whs.find((w) => w.kind === "available")!.id);
    expect(b.defaultPriceTableId).toBe(refs.priceTables.varejo.id);
    expect((await listAll(store, "financial_accounts", { filters: [["eq", "branchId", b.id]] })).length).toBe(1);
    await expect(createBranch(admin, refs.company.id, { code: "03", name: "Dup" })).rejects.toThrow(/código 03/);
    await expect(updateBranch(admin, b.id, { code: "03", name: "Filial — Bairro", defaultWarehouseId: refs.warehouses["matriz-main"].id })).rejects.toThrow(/pertencer à filial/);
    const { company, branch } = await createCompany(admin, { name: "Nova Loja Ltda", cnpj: "45723174000110", regime: "presumido", address: { uf: "RJ", cityName: "Rio de Janeiro", cityCode: "3304557" } });
    expect(company.crt).toBe("3");
    expect(branch.companyId).toBe(company.id);
    expect((await listAll(store, "roles", { filters: [["eq", "companyId", company.id]] })).length).toBe(6);
    await expect(createCompany(admin, { name: "Outra", cnpj: "45723174000110" })).rejects.toThrow(/CNPJ/);
  });

  it("terminal: série NFC-e única por filial; teste de impressão registra só a abertura; conector sem URL = não verificado; falha real registrada", async () => {
    await expect(createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX09", name: "Caixa 09", nfceSeries: 1, printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false })).rejects.toThrow(/série NFC-e 1/);
    const t = await createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX09", name: "Caixa 09", nfceSeries: 9, printerMode: "browser", paperWidth: 58, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false });
    const msg = await recordBrowserPrintPage(admin, t.id, { userAgent: "vitest" });
    expect(msg).toMatch(/não confirma a impressão física/);
    const nv = await checkConnectorFromServer(admin, t.id);
    expect(nv.verified).toBe(false);
    expect(nv.message).toMatch(/Não verificado/);
    await expect(createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX10", name: "Caixa 10", printerMode: "connector", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false })).rejects.toThrow(/URL do conector/);
    const t2 = await createTerminal(admin, { branchId: refs.branches.matriz.id, code: "CX10", name: "Caixa 10", printerMode: "connector", connectorUrl: "http://127.0.0.1:9", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false });
    const fail = await checkConnectorFromServer(admin, t2.id);
    expect(fail.verified).toBe(true);
    expect(fail.ok).toBe(false);
    expect((await store.get("terminals", t2.id))!.lastPrinterTestResult).toMatch(/Conector com falha/);
  });
});

describe("ajuda", () => {
  it("sincroniza artigos (≥ 15), é idempotente e encontra por rota e por termo", async () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(15);
    const r1 = await ensureHelpArticles(store);
    expect(r1.created).toBe(HELP_ARTICLES.length);
    const r2 = await ensureHelpArticles(store);
    expect(r2).toEqual({ created: 0, updated: 0 });
    const arts = await listAll(store, "help_articles");
    expect(articlesForRoute(arts, "/financeiro/receber/abc")[0].slug).toBe("contas-a-receber-e-pagar");
    expect(searchArticles(arts, "sangria")[0].slug).toBe("caixa-abertura-sangria-fechamento");
  });
});
