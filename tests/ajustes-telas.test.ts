import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import type { Ctx } from "@/lib/core/ctx";
import { setSetting } from "@/lib/core/settings";
import { addDays, today } from "@/lib/dates";
import { QTY } from "@/lib/money";
import { ROLE_TEMPLATES, canDo } from "@/lib/permissions";
import { ACTIONS_ADDED_TO_TEMPLATES } from "@/lib/auth/role-sync";
import { toCtxUser } from "@/lib/auth/users";
import { getAuth } from "@/lib/auth/provider";
import { base32Decode, base32Encode, hashRecoveryCode, hotp, otpauthUri, totp, totpStep, verifyTotp } from "@/lib/auth/totp";
import { openSecret, sealSecret } from "@/lib/auth/secret-box";
import { openSession } from "@/domain/cash";
import { cancelCart, createCart, removeCartItem, saveCart, sessionPdvControls } from "@/domain/carts";
import { finalizeSale, processReturn, returnableItems } from "@/domain/sales";
import { createOrder, registerOrderInTransit, registerOrderSent } from "@/domain/purchases";
import { submitForApproval, decideRequest } from "@/domain/approvals";
import { createManualReceipt } from "@/domain/receipts";
import { effectiveExpectedDate, isInTransit } from "@/domain/purchase-calc";
import { createUser, adminResetTwoFactor } from "@/domain/users";
import {
  MAX_LOGIN_FAILURES, beginTwoFactorSetup, challengeView, completeLoginChallenge, confirmTwoFactorSetup, createLoginChallenge, disableTwoFactor, loadLoginChallenge, loginKeyFor,
  recentLoginFailures, userRequiresTwoFactor,
} from "@/domain/two-factor";

/** §44 — ajustes das telas 01–48: autorização no PDV (04), limite de devolução (11), em trânsito (27) e 2FA (36). */

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let manager: Ctx;
let cashier: Ctx;
let stockist: Ctx;
let terminalId: string;
const PWD = "Intercert@2026";
const SUP = { login: "gerente", password: PWD };

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  manager = await refs.ctxFor("manager", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  terminalId = refs.terminals.cx1.id;
  await openSession(cashier, { terminalId, openingFund: 10000 });
}, 120000);

const item = (key: string, qty = QTY, listPrice = 4490) => ({ skuId: refs.skus[key].id, qty, listPrice, name: key, sku: key });

describe("permissões novas (§44)", () => {
  it("Gerente e Administrador recebem remover item, cancelar atendimento e devolução acima do limite; o Caixa não", () => {
    const tpl = (k: string) => ROLE_TEMPLATES.find((t) => t.key === k)!.actions as string[];
    for (const a of ["pdv.remove_item", "pdv.cancel_cart", "sale.return_over_limit"]) {
      expect(tpl("manager")).toContain(a);
      expect(tpl("admin")).toContain(a);
      expect(tpl("cashier")).not.toContain(a);
      expect(ACTIONS_ADDED_TO_TEMPLATES).toContain(a);
    }
    expect(canDo(manager.user, "pdv.remove_item")).toBe(true);
    expect(canDo(cashier.user, "pdv.remove_item")).toBe(false);
  });
});

describe("Tela 04 — remover item e cancelar atendimento no PDV", () => {
  it("autosalvamento não diminui item já registrado; a remoção exige autorização do supervisor e fica registrada", async () => {
    const cart = await createCart(cashier, terminalId);
    await saveCart(cashier, cart.id, { items: [item("bone-u", 2 * QTY)] });
    await expect(saveCart(cashier, cart.id, { items: [] })).rejects.toMatchObject({ code: "remove_item_required" });
    await expect(saveCart(cashier, cart.id, { items: [item("bone-u", QTY)] })).rejects.toMatchObject({ code: "remove_item_required" });
    // operador sem a permissão: pede autorização; senha errada é recusada (e auditada)
    await expect(removeCartItem(cashier, cart.id, { index: 0, skuId: refs.skus["bone-u"].id, qty: QTY })).rejects.toMatchObject({ code: "approval_required" });
    await expect(removeCartItem(cashier, cart.id, { index: 0, skuId: refs.skus["bone-u"].id, qty: QTY, approval: { login: "gerente", password: "errada" } })).rejects.toMatchObject({ code: "approval_denied" });
    // outro operador sem a permissão não autoriza
    await expect(removeCartItem(cashier, cart.id, { index: 0, skuId: refs.skus["bone-u"].id, qty: QTY, approval: { login: "caixa", password: PWD } })).rejects.toThrow(/não tem a permissão/);
    const r = await removeCartItem(cashier, cart.id, { index: 0, skuId: refs.skus["bone-u"].id, qty: QTY, reason: "leitura em duplicidade", approval: SUP });
    expect(r.cart.items[0].qty).toBe(QTY);
    expect(r.record).toMatchObject({ qty: QTY, remainingQty: QTY, value: 4490, byName: cashier.user.name, approvedByName: "Gustavo Gerente", reason: "leitura em duplicidade" });
    expect(r.cart.total).toBe(4490);
    const audits = await listAll(store, "audit_logs", { filters: [["eq", "action", "cart.item_remove"], ["eq", "entityId", cart.id]] });
    expect(audits).toHaveLength(1);
    expect(audits[0].summary).toMatch(/autorizado por Gustavo Gerente/);
    expect(audits[0].related.some((x: string) => x.startsWith("cash_session:"))).toBe(true);
    // remove a linha inteira
    const r2 = await removeCartItem(cashier, cart.id, { index: 0, skuId: refs.skus["bone-u"].id, approval: SUP });
    expect(r2.cart.items).toHaveLength(0);
    expect(r2.cart.removedItems).toHaveLength(2);
  });

  it("quem tem a permissão remove sem autorização; parâmetro desligado libera; exceção do item recém-lançado", async () => {
    const c1 = await createCart(manager, terminalId);
    await saveCart(manager, c1.id, { items: [item("bone-u")] });
    const r = await removeCartItem(manager, c1.id, { index: 0, skuId: refs.skus["bone-u"].id });
    expect(r.record.approvedById).toBeNull();

    const c2 = await createCart(cashier, terminalId);
    await saveCart(cashier, c2.id, { items: [item("bone-u")] });
    await setSetting(store, refs.company.id, null, "pdv.removeItemGraceSeconds", 30);
    const g = await removeCartItem(cashier, c2.id, { index: 0, skuId: refs.skus["bone-u"].id });
    expect(g.record.graceException).toBe(true);
    // item lançado há mais tempo que a exceção: volta a exigir autorização
    await saveCart(cashier, c2.id, { items: [item("cinto-u")] });
    await store.update("carts", c2.id, { lastAddedAt: { [refs.skus["cinto-u"].id]: new Date(Date.now() - 60000).toISOString() } });
    await expect(removeCartItem(cashier, c2.id, { index: 0, skuId: refs.skus["cinto-u"].id })).rejects.toMatchObject({ code: "approval_required" });
    await setSetting(store, refs.company.id, null, "pdv.removeItemGraceSeconds", 0);
    await setSetting(store, refs.company.id, null, "pdv.removeItemRequiresAuth", false);
    const free = await removeCartItem(cashier, c2.id, { index: 0, skuId: refs.skus["cinto-u"].id });
    expect(free.record.approvedById).toBeNull();
    await setSetting(store, refs.company.id, null, "pdv.removeItemRequiresAuth", true);
  });

  it("cancelar atendimento com itens exige permissão/autorização; vazio não; relatório do caixa conta por operador", async () => {
    const empty = await createCart(cashier, terminalId);
    expect((await cancelCart(cashier, empty.id, null)).status).toBe("cancelled");
    const c = await createCart(cashier, terminalId);
    await saveCart(cashier, c.id, { items: [item("bone-u", 3 * QTY)] });
    await expect(cancelCart(cashier, c.id, "desistiu")).rejects.toMatchObject({ code: "approval_required" });
    const done = await cancelCart(cashier, c.id, "desistiu", { approval: SUP });
    expect(done).toMatchObject({ status: "cancelled", cancelApprovedByName: "Gustavo Gerente", cancelledBy: cashier.user.id });
    // parâmetro desligado: o Caixa cancela sem autorização
    await setSetting(store, refs.company.id, null, "pdv.cancelCartRequiresAuth", false);
    const c2 = await createCart(cashier, terminalId);
    await saveCart(cashier, c2.id, { items: [item("bone-u")] });
    expect((await cancelCart(cashier, c2.id, null)).status).toBe("cancelled");
    await setSetting(store, refs.company.id, null, "pdv.cancelCartRequiresAuth", true);
    const session = (await listAll(store, "cash_sessions", { filters: [["eq", "terminalId", terminalId], ["eq", "status", "open"]] }))[0];
    const ctl = await sessionPdvControls(cashier, session.id);
    expect(ctl.cancelled).toBe(2);
    expect(ctl.cancelledValue).toBe(3 * 4490 + 4490);
    expect(ctl.removed).toBe(5); // 2 + 1 + 2 dos testes anteriores (mesma sessão)
    const carla = ctl.byOperator.find((o) => o.operatorName === cashier.user.name)!;
    expect(carla.cancelled).toBe(2);
    expect(carla.authorized).toBeGreaterThanOrEqual(3);
    expect(ctl.byOperator.find((o) => o.operatorName === manager.user.name)?.removed).toBe(1);
  });
});

describe("Tela 11 — devolução acima do limite exige gerente", () => {
  it("acima do valor máximo: autorização de quem tem a permissão (registrada); abaixo ou com a permissão, livre", async () => {
    const sale = await finalizeSale(cashier, { terminalId, idemKey: "lim-1", customerId: refs.customers.ana.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000 }], payments: [{ methodId: refs.methods.debito.id, amount: 7470, nsu: "1" }] });
    const [line] = await returnableItems(store, sale.id);
    await setSetting(store, refs.company.id, null, "sales.returnMaxWithoutManager", 3000);
    const input = (idemKey: string, qty: number) => ({ saleId: sale.id, idemKey, reason: "sobrou", compensation: "store_credit" as const, items: [{ saleItemId: line.id, qty, condition: "resellable" as const }] });
    // R$ 24,90 ≤ R$ 30,00: sem autorização
    const ok = await processReturn(cashier, input("lim-r1", 1000));
    expect(ok.approvedById ?? null).toBeNull();
    // R$ 49,80 > R$ 30,00
    await expect(processReturn(cashier, input("lim-r2", 2000))).rejects.toMatchObject({ code: "approval_required" });
    await expect(processReturn(cashier, { ...input("lim-r2", 2000), approval: { login: "caixa", password: PWD } })).rejects.toThrow(/não tem a permissão/);
    const r = await processReturn(cashier, { ...input("lim-r2", 2000), approval: SUP });
    expect(r.approvedByName).toBe("Gustavo Gerente");
    const a = (await listAll(store, "audit_logs", { filters: [["eq", "action", "sale.return"], ["eq", "entityId", r.id]] }))[0];
    expect(a.summary).toMatch(/autorizada por Gustavo Gerente/);
    // gerente (com a permissão) não precisa de autorização
    const s2 = await finalizeSale(cashier, { terminalId, idemKey: "lim-2", customerId: refs.customers.ana.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000 }], payments: [{ methodId: refs.methods.debito.id, amount: 7470, nsu: "2" }] });
    const [l2] = await returnableItems(store, s2.id);
    const m = await processReturn(manager, { saleId: s2.id, idemKey: "lim-r3", reason: "sobrou", compensation: "store_credit", items: [{ saleItemId: l2.id, qty: 3000, condition: "resellable" }] });
    expect(m.approvedById ?? null).toBeNull();
    await setSetting(store, refs.company.id, null, "sales.returnMaxWithoutManager", 0);
  });
});

describe("Tela 27 — pedido de compra em trânsito", () => {
  it("registro opcional entre enviado e recebido; previsão do transporte vale para o atraso; recebimento segue igual", async () => {
    const o = await createOrder(admin, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 10000, unitCost: 1000 }], paymentTermId: refs.terms.avista.id, expectedDate: addDays(today(), 10) });
    await submitForApproval(admin, [o.id]);
    const req = (await store.getOrThrow("purchase_orders", o.id)).requestId;
    if (req && (await store.getOrThrow("purchase_orders", o.id)).status === "in_review") await decideRequest(manager, req, "approve", "ok");
    await expect(registerOrderInTransit(admin, o.id, { carrier: "Jadlog" })).rejects.toThrow(/envio ao fornecedor/);
    await registerOrderSent(admin, o.id, { method: "manual", channel: "WhatsApp", contact: "Comercial" });
    await expect(registerOrderInTransit(admin, o.id, { shippedDate: today(), eta: addDays(today(), -1) })).rejects.toThrow(/anterior ao despacho/);
    await expect(registerOrderInTransit(stockist, o.id, { carrier: "X" })).rejects.toThrow(/permissão/);
    const t = await registerOrderInTransit(admin, o.id, { shippedDate: today(), carrier: "Jadlog", tracking: "JD123", eta: addDays(today(), 2) });
    expect(t.status).toBe("sent");
    expect(isInTransit(t)).toBe(true);
    expect(effectiveExpectedDate(t)).toBe(addDays(today(), 2));
    // previsão vencida: a data efetiva é a do transporte
    const late = await registerOrderInTransit(admin, o.id, { shippedDate: addDays(today(), -5), eta: addDays(today(), -1) });
    expect(effectiveExpectedDate(late)! < today()).toBe(true);
    expect(late.transitAt).toBe(t.transitAt);
    expect((await listAll(store, "audit_logs", { filters: [["eq", "entityId", o.id], ["eq", "action", ["purchase_order.in_transit", "purchase_order.transit_update"]]] }))).toHaveLength(2);
    // recebimento a partir do pedido em trânsito
    const r = await createManualReceipt(stockist, { supplierId: refs.suppliers.papel.id, orderIds: [o.id], idemKey: "transit-rc" });
    expect(r.orderIds).toContain(o.id);
  });
});

describe("Tela 36 — autenticação em duas etapas (TOTP)", () => {
  it("TOTP: vetores do RFC 6238 (SHA-1) e Base32", () => {
    const key = Buffer.from("12345678901234567890");
    const vectors: Array<[number, string]> = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
    for (const [t, code] of vectors) expect(hotp(key, totpStep(t * 1000), 8)).toBe(code);
    expect(base32Encode(key)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").toString()).toBe("12345678901234567890");
    // 6 dígitos com janela ±1 e sem reuso
    const secret = base32Encode(key);
    const now = 1111111111 * 1000;
    const code = totp(key, now);
    expect(code).toBe("050471");
    expect(verifyTotp(secret, code, { now })).toBe(totpStep(now));
    expect(verifyTotp(secret, code, { now: now + 30000 })).toBe(totpStep(now));
    expect(verifyTotp(secret, code, { now: now + 90000 })).toBeNull();
    expect(verifyTotp(secret, code, { now, afterStep: totpStep(now) })).toBeNull();
    expect(otpauthUri({ issuer: "Intercert ERP", account: "caixa", secret })).toMatch(/^otpauth:\/\/totp\/Intercert%20ERP:caixa\?secret=GEZD.*&period=30/);
  });

  it("segredo cifrado: abre com a chave, recusa texto adulterado", () => {
    const sealed = sealSecret("SEGREDO");
    expect(sealed).not.toContain("SEGREDO");
    expect(openSecret(sealed)).toBe("SEGREDO");
    expect(openSecret(sealed.slice(0, -2) + "AA")).toBeNull();
  });

  // código do próximo intervalo (janela +1): o intervalo atual já foi usado na confirmação do cadastro (sem reuso)
  const code = (secret: string, ahead = 1) => totp(base32Decode(secret), Date.now() + ahead * 30000);
  async function loginSession(email: string, persistent = true) {
    return getAuth().login(email, PWD, persistent);
  }

  it("sem 2FA o login segue direto; com 2FA a sessão só sai com o código (manter conectado não pula)", async () => {
    const gUser = (await store.get("users", manager.user.id))!;
    expect(await createLoginChallenge(store, { user: gUser, session: await loginSession(gUser.email), persistent: true, loginKey: loginKeyFor(gUser, "gerente") })).toBeNull();
    // cadastro pelo próprio usuário
    const setup = await beginTwoFactorSetup(manager);
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    await expect(confirmTwoFactorSetup(manager, "000000")).rejects.toMatchObject({ code: "invalid_code" });
    const { recoveryCodes } = await confirmTwoFactorSetup(manager, code(setup.secret, 0));
    expect(recoveryCodes).toHaveLength(10);
    const after = (await store.get("users", manager.user.id))!;
    expect(after.totpEnabled).toBe(true);
    expect(after.totpSecretEnc).not.toContain(setup.secret);
    expect(after.totpPendingEnc).toBeNull();
    expect(after.totpRecoveryHashes).toEqual(recoveryCodes.map(hashRecoveryCode));
    // login: senha correta → desafio (verify), sessão retida
    const session = await loginSession(after.email, true);
    const ch = await createLoginChallenge(store, { user: after, session, persistent: true, next: "/caixa", loginKey: loginKeyFor(after, "gerente") });
    expect(ch?.kind).toBe("verify");
    const bad = await completeLoginChallenge(store, ch!.token, "123456");
    expect(bad).toMatchObject({ status: "invalid", left: MAX_LOGIN_FAILURES - 1 });
    const good = await completeLoginChallenge(store, ch!.token, code(setup.secret));
    expect(good.status).toBe("ok");
    if (good.status !== "ok") return;
    expect(good.session.secret).toBe(session.secret);
    expect(good.persistent).toBe(true);
    expect(good.next).toBe("/caixa");
    expect(await loadLoginChallenge(store, ch!.token)).toBeNull();
    // o mesmo código não serve de novo (mesmo intervalo)
    const u2 = (await store.get("users", manager.user.id))!;
    const ch2 = await createLoginChallenge(store, { user: u2, session: await loginSession(u2.email), persistent: false, loginKey: loginKeyFor(u2, "gerente") });
    expect((await completeLoginChallenge(store, ch2!.token, code(setup.secret))).status).toBe("invalid");
    // código de recuperação: uso único
    const rec = await completeLoginChallenge(store, ch2!.token, recoveryCodes[0].toUpperCase());
    expect(rec).toMatchObject({ status: "ok", method: "recovery", remaining: 9 });
    const ch3 = await createLoginChallenge(store, { user: (await store.get("users", manager.user.id))!, session: await loginSession(u2.email), persistent: false, loginKey: loginKeyFor(u2, "gerente") });
    expect((await completeLoginChallenge(store, ch3!.token, recoveryCodes[0])).status).toBe("invalid");
    // desativar exige senha + código
    await expect(disableTwoFactor(manager, "errada", code(setup.secret))).rejects.toThrow(/Senha incorreta/);
    await expect(disableTwoFactor(manager, PWD, "999999")).rejects.toThrow(/Código inválido/);
    await disableTwoFactor(manager, PWD, recoveryCodes[1]);
    expect((await store.get("users", manager.user.id))!.totpEnabled).toBe(false);
  });

  it("códigos errados contam no bloqueio de 5 tentativas", async () => {
    const { user } = await createUser(admin, { name: "Paulo Teste", email: "paulo2fa@teste.local", login: "paulo2fa", roleId: (await store.get("users", manager.user.id))!.roleId, companyIds: [refs.company.id], branchIds: [], mode: "password", password: PWD });
    const ctx: Ctx = { store, companyId: refs.company.id, branchId: refs.branches.matriz.id, user: await toCtxUser(store, user) };
    const setup = await beginTwoFactorSetup(ctx);
    await confirmTwoFactorSetup(ctx, code(setup.secret, 0));
    const u = (await store.get("users", user.id))!;
    const key = loginKeyFor(u, "paulo2fa");
    const ch = await createLoginChallenge(store, { user: u, session: await loginSession(u.email), persistent: false, loginKey: key });
    for (let i = 0; i < MAX_LOGIN_FAILURES - 1; i++) expect((await completeLoginChallenge(store, ch!.token, "000001")).status).toBe("invalid");
    const last = await completeLoginChallenge(store, ch!.token, "000002");
    expect(last.status).toBe("locked");
    expect(await recentLoginFailures(store, key)).toBe(MAX_LOGIN_FAILURES);
    // novo desafio (senha correta de novo) também fica bloqueado, mesmo com o código certo
    const ch2 = await createLoginChallenge(store, { user: u, session: await loginSession(u.email), persistent: false, loginKey: key });
    expect((await completeLoginChallenge(store, ch2!.token, code(setup.secret))).status).toBe("locked");
    // administrador redefine (auditado)
    await adminResetTwoFactor(admin, user.id, "perdeu o celular");
    expect((await store.get("users", user.id))!.totpEnabled).toBe(false);
    expect(await listAll(store, "audit_logs", { filters: [["eq", "action", "user.2fa_reset"], ["eq", "entityId", user.id]] })).toHaveLength(1);
  });

  it("perfil que exige: cadastro obrigatório no login antes de qualquer acesso; não pode desativar", async () => {
    const caixa = (await store.get("users", cashier.user.id))!;
    expect(await userRequiresTwoFactor(store, caixa)).toBe(false);
    await store.update("roles", caixa.roleId, { requireTwoFactor: true });
    expect(await userRequiresTwoFactor(store, caixa)).toBe(true);
    expect((await toCtxUser(store, caixa, refs.company.id)).twoFactorRequired).toBe(true);
    const ch = await createLoginChallenge(store, { user: caixa, session: await loginSession(caixa.email), persistent: false, loginKey: loginKeyFor(caixa, "caixa") });
    expect(ch?.kind).toBe("enroll");
    const view = await challengeView(store, (await loadLoginChallenge(store, ch!.token))!);
    expect(view?.enrollment?.uri).toMatch(/^otpauth:\/\/totp\/Intercert%20ERP:caixa/);
    // nada é gravado no usuário antes da confirmação
    expect((await store.get("users", caixa.id))!.totpEnabled).toBeFalsy();
    const r = await completeLoginChallenge(store, ch!.token, code(view!.enrollment!.secret, 0));
    expect(r).toMatchObject({ status: "ok", method: "enroll" });
    if (r.status !== "ok") return;
    expect(r.recoveryCodes).toHaveLength(10);
    const enrolled = (await store.get("users", caixa.id))!;
    expect(enrolled.totpEnabled).toBe(true);
    const ctx: Ctx = { ...cashier, user: await toCtxUser(store, enrolled) };
    await expect(disableTwoFactor(ctx, PWD, r.recoveryCodes![0])).rejects.toMatchObject({ code: "required_by_role" });
    await store.update("roles", caixa.roleId, { requireTwoFactor: false });
    await store.update("users", caixa.id, { totpEnabled: false, totpSecretEnc: null, totpRecoveryHashes: [] });
  });

  it("acesso rápido da demonstração: usuários demo sem 2FA e perfis padrão sem exigência", async () => {
    const demo = (await listAll(store, "users", { filters: [["eq", "isDemo", true]] })).filter((u) => u.status === "active");
    expect(demo.length).toBeGreaterThan(0);
    for (const u of demo) {
      expect(u.totpEnabled ?? false).toBe(false);
      expect(await userRequiresTwoFactor(store, u)).toBe(false);
    }
  });
});
