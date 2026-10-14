import { describe, it, expect, beforeEach } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import { addDays, today } from "@/lib/dates";
import { pct } from "@/lib/money";
import { setSetting } from "@/lib/core/settings";
import { closeSession, expectedOf, openSession, requiredChecklist, sessionSummary } from "@/domain/cash";
import { createTitle } from "@/domain/finance";
import { assertNotOpenPdvReceipt, openInstallmentsForCustomer, receiveInstallments, reverseReceipt, sessionReceipts } from "@/domain/pdv-receivables";

let store: MemoryStore;
let refs: DemoRefs;
let cashier: Ctx;
let manager: Ctx;
let admin: Ctx;
let terminalId: string;
let sessionId: string;

const balanceOf = async (k: string) => (await store.getOrThrow("financial_accounts", refs.accounts[k].id)).balance;

/** título a receber de um cliente com parcelas (valor, dias desde o vencimento: positivo = vencida) */
async function titleFor(customerKey: string, key: string, parts: Array<[amount: number, daysOverdue: number]>) {
  const c = refs.customers[customerKey];
  const t = await createTitle(admin, {
    kind: "receivable", partyType: "customer", partyId: c.id, partyName: c.name, description: `Crediário ${key}`, originType: "manual", issueDate: addDays(today(), -90), competenceDate: addDays(today(), -90),
    installments: parts.map(([amount, d]) => ({ dueDate: addDays(today(), -d), amount })), idemKey: `test:${key}`, branchId: refs.branches.matriz.id,
  });
  const insts = (await listAll(store, "installments", { filters: [["eq", "titleId", t.id]] })).sort((a, b) => a.number - b.number);
  return { title: t, insts };
}

const movementsOf = async (type = "receivable") => (await listAll(store, "cash_movements", { filters: [["eq", "sessionId", sessionId]] })).filter((m) => m.type === type);

describe("PDV — recebimento de parcelas do crediário (VEN-10)", () => {
  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    admin = await refs.ctxFor("admin", "matriz");
    terminalId = refs.terminals.cx1.id;
    sessionId = (await openSession(cashier, { terminalId, openingFund: 10000 })).id;
  });

  it("lista as parcelas em aberto do cliente com multa/juros, vencidas primeiro", async () => {
    await titleFor("maria", "m1", [[10000, -10], [10000, 30]]);
    const list = await openInstallmentsForCustomer(cashier, refs.customers.maria.id);
    expect(list.map((i) => i.dueDate)).toEqual([addDays(today(), -30), addDays(today(), 10)]);
    // padrão: multa 2% e juros 1% a.m. pro rata (30 dias)
    expect(list[0]).toMatchObject({ overdue: true, daysLate: 30, balance: 10000, fine: 200, interest: 100, updated: 10300 });
    expect(list[1]).toMatchObject({ overdue: false, fine: 0, interest: 0, updated: 10000 });
  });

  it("dinheiro com troco: baixa a parcela (multa/juros), entra no dinheiro esperado e no resumo", async () => {
    const { title, insts } = await titleFor("maria", "m2", [[10000, 30]]);
    const cashBefore = await balanceOf("caixa-matriz");
    const op = await receiveInstallments(cashier, { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, received: 11000, idemKey: "r1" });
    expect(op.status).toBe("done");
    expect(op.result).toMatchObject({ total: 10300, received: 11000, change: 700, fines: 200, interest: 100 });
    const inst = await store.getOrThrow("installments", insts[0].id);
    expect(inst).toMatchObject({ status: "paid", balance: 0, fine: 200, interest: 100 });
    expect((await store.getOrThrow("titles", title.id)).status).toBe("paid");
    const st = (await listAll(store, "settlements", { filters: [["eq", "installmentId", inst.id]] }))[0];
    expect(st).toMatchObject({ principal: 10000, fine: 200, interest: 100, total: 10300, accountId: refs.accounts["caixa-matriz"].id, operationId: op.id, methodKind: "cash" });
    // valor aplicado entra na conta Caixa (troco não é receita)
    expect((await balanceOf("caixa-matriz")) - cashBefore).toBe(10300);
    const movs = await movementsOf();
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ method: "cash", amount: 10300, settlementId: st.id });
    const sum = await sessionSummary(cashier, sessionId);
    expect(sum.expected.cash).toBe(10000 + 10300);
    expect(sum.receivables).toMatchObject({ total: 10300, cash: 10300, count: 1 });
    // fórmula das vendas inalterada (recebimento não é venda)
    expect(sum.totals).toMatchObject({ sales: 0, salesCount: 0, cashSales: 0, change: 0, opening: 10000 });
    expect(expectedOf(sum)).toEqual({ cash: 20300 });
    // fechamento: o previsto em dinheiro inclui o recebimento
    const closed = await closeSession(cashier, { sessionId, counted: { cash: 20300 } });
    expect(closed.differences).toEqual({});
    expect(closed.expected).toEqual({ cash: 20300 });
  });

  it("cartão e Pix entram no previsto do próprio meio (não no dinheiro); cartão com a taxa do meio", async () => {
    await store.update("payment_methods", refs.methods.debito.id, { accountId: refs.accounts.banco.id });
    const a = await titleFor("joao", "j1", [[5000, -5], [8000, -35]]);
    await receiveInstallments(cashier, { terminalId, installmentIds: [a.insts[0].id], methodId: refs.methods.pix.id, idemKey: "pix-1" });
    const card = await receiveInstallments(cashier, { terminalId, installmentIds: [a.insts[1].id], methodId: refs.methods.debito.id, reference: "NSU 123", idemKey: "deb-1" });
    const sum = await sessionSummary(cashier, sessionId);
    expect(sum.expected.cash).toBe(10000);
    expect(sum.byMethod.pix).toMatchObject({ expected: 5000, count: 1 });
    expect(sum.byMethod.debit).toMatchObject({ expected: 8000, count: 1 });
    expect(expectedOf(sum)).toEqual({ cash: 10000, pix: 5000, debit: 8000 });
    expect(requiredChecklist(sum).map((c) => c.key)).toEqual(expect.arrayContaining(["cardsReconciled", "pixReconciled"]));
    const st = await store.getOrThrow("settlements", card.result.items[0].settlementId);
    expect(st).toMatchObject({ total: 8000, fee: pct(8000, refs.methods.debito.feeBps), reference: "NSU 123", accountId: refs.accounts.banco.id });
  });

  it("meio sem conta vinculada (cartão) e meios a prazo são recusados", async () => {
    const a = await titleFor("joao", "j2", [[5000, 0]]);
    await expect(receiveInstallments(cashier, { terminalId, installmentIds: [a.insts[0].id], methodId: refs.methods.credito.id, idemKey: "cred-x" })).rejects.toMatchObject({ code: "invalid_account" });
    await expect(receiveInstallments(cashier, { terminalId, installmentIds: [a.insts[0].id], methodId: refs.methods.crediario.id, idemKey: "cred-y" })).rejects.toMatchObject({ code: "method_not_allowed" });
    expect(await movementsOf()).toHaveLength(0);
  });

  it("várias parcelas de clientes distintos (no mesmo recebimento e em recebimentos separados)", async () => {
    const m = await titleFor("maria", "m3", [[3000, 0], [3000, -30]]);
    const j = await titleFor("joao", "j3", [[4000, 0]]);
    const e = await titleFor("escola", "e3", [[9000, 0]]);
    const op1 = await receiveInstallments(cashier, { terminalId, installmentIds: [m.insts[0].id, m.insts[1].id, j.insts[0].id], methodId: refs.methods.dinheiro.id, received: 10000, idemKey: "multi" });
    expect(op1.result.customers).toEqual(expect.arrayContaining([refs.customers.maria.name, refs.customers.joao.name]));
    expect(op1.result).toMatchObject({ total: 10000, change: 0 });
    await receiveInstallments(cashier, { terminalId, installmentIds: [e.insts[0].id], methodId: refs.methods.pix.id, idemKey: "escola" });
    expect(await movementsOf()).toHaveLength(4);
    const sum = await sessionSummary(cashier, sessionId);
    expect(sum.expected.cash).toBe(20000);
    expect(sum.receivables).toMatchObject({ total: 19000, cash: 10000, count: 4 });
    expect(sum.byMethod.pix.expected).toBe(9000);
    expect((await store.getOrThrow("titles", m.title.id)).status).toBe("paid");
    const receipts = await sessionReceipts(cashier, sessionId);
    expect(receipts.map((r) => r.id).sort()).toEqual([op1.id, (await store.get("operations", receipts.find((r) => r.id !== op1.id)!.id))!.id].sort());
    expect(receipts).toHaveLength(2);
  });

  it("desconto: rateado pelo principal, limitado ao limite do operador (acima exige supervisor)", async () => {
    const a = await titleFor("maria", "m4", [[10000, 30], [10000, 0]]);
    const ids = a.insts.map((i) => i.id);
    // bruto = 10300 + 10000 = 20300; limite do caixa = 5% (1015)
    await expect(receiveInstallments(cashier, { terminalId, installmentIds: ids, methodId: refs.methods.dinheiro.id, discount: 2000, idemKey: "d-over" })).rejects.toMatchObject({ code: "discount_over_limit" });
    await expect(receiveInstallments(cashier, { terminalId, installmentIds: ids, methodId: refs.methods.dinheiro.id, discount: 2000, approval: { login: "caixa", password: "Intercert@2026" }, idemKey: "d-over" })).rejects.toThrow(/permissão/);
    expect(await movementsOf()).toHaveLength(0);
    const op = await receiveInstallments(cashier, { terminalId, installmentIds: ids, methodId: refs.methods.dinheiro.id, discount: 1000, idemKey: "d-ok" });
    expect(op.result.items.map((i: any) => i.discount)).toEqual([500, 500]);
    expect(op.result.total).toBe(19300);
    const insts = await Promise.all(ids.map((id) => store.getOrThrow("installments", id)));
    expect(insts.map((i) => [i.status, i.discount])).toEqual([["paid", 500], ["paid", 500]]);
    expect((await sessionSummary(cashier, sessionId)).expected.cash).toBe(10000 + 19300);
    // supervisor autoriza desconto acima do limite
    const b = await titleFor("joao", "j4", [[10000, 0]]);
    const ok = await receiveInstallments(cashier, { terminalId, installmentIds: [b.insts[0].id], methodId: refs.methods.dinheiro.id, discount: 2000, approval: { login: "gerente", password: "Intercert@2026" }, idemKey: "d-sup" });
    expect(ok.result).toMatchObject({ total: 8000, approvedBy: refs.users.manager.id });
  });

  it("estorno no PDV: recompõe a parcela e lança o movimento inverso na mesma sessão; idempotente", async () => {
    const { title, insts } = await titleFor("maria", "m5", [[10000, 30]]);
    const cashBefore = await balanceOf("caixa-matriz");
    const op = await receiveInstallments(cashier, { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, received: 10300, idemKey: "rev" });
    // caixa sem a permissão de estorno precisa de supervisor
    await expect(reverseReceipt(cashier, { receiptId: op.id, reason: "lançado errado" })).rejects.toMatchObject({ code: "approval_required" });
    const rev = await reverseReceipt(cashier, { receiptId: op.id, reason: "lançado errado", approval: { login: "gerente", password: "Intercert@2026" } });
    expect(rev.status).toBe("reversed");
    expect(rev.result.reversal).toMatchObject({ approvedBy: refs.users.manager.id, total: 10300 });
    const inst = await store.getOrThrow("installments", insts[0].id);
    expect(inst).toMatchObject({ status: "open", balance: 10000, paid: 0, fine: 0, interest: 0 });
    expect((await store.getOrThrow("titles", title.id)).status).toBe("open");
    expect((await store.getOrThrow("settlements", op.result.items[0].settlementId)).status).toBe("reversed");
    expect(await balanceOf("caixa-matriz")).toBe(cashBefore);
    const movs = await movementsOf();
    expect(movs.map((m) => m.amount).sort((a, b) => a - b)).toEqual([-10300, 10300]);
    const sum = await sessionSummary(cashier, sessionId);
    expect(sum.expected.cash).toBe(10000);
    expect(sum.receivables).toMatchObject({ total: 0, cash: 0, count: 0 });
    // repetir o estorno não estorna de novo
    await reverseReceipt(manager, { receiptId: op.id, reason: "de novo" });
    expect(await movementsOf()).toHaveLength(2);
    expect((await listAll(store, "settlements", { filters: [["eq", "installmentId", inst.id]] })).filter((s) => s.kind === "reversal")).toHaveLength(1);
    // a parcela volta a ficar disponível para novo recebimento
    expect((await openInstallmentsForCustomer(cashier, refs.customers.maria.id)).map((i) => i.id)).toEqual([inst.id]);
  });

  it("estorno pelo Financeiro de baixa feita no PDV com o caixa aberto é recusado; com o caixa fechado o PDV recusa", async () => {
    const { insts } = await titleFor("joao", "j6", [[5000, 0]]);
    const op = await receiveInstallments(cashier, { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, idemKey: "fin" });
    await expect(assertNotOpenPdvReceipt(manager, op.result.items[0].settlementId)).rejects.toMatchObject({ code: "pdv_receipt_open" });
    await closeSession(cashier, { sessionId, counted: { cash: 15000 } });
    await expect(assertNotOpenPdvReceipt(manager, op.result.items[0].settlementId)).resolves.toBeUndefined();
    await expect(reverseReceipt(manager, { receiptId: op.id, reason: "x" })).rejects.toMatchObject({ code: "cash_closed" });
  });

  it("idempotência: repetir a mesma chave não baixa duas vezes; parcela já paga é recusada em outra chave", async () => {
    const { insts } = await titleFor("maria", "m6", [[10000, 0]]);
    const input = { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, received: 10000, idemKey: "same" };
    const [a, b] = await Promise.all([receiveInstallments(cashier, input), receiveInstallments(cashier, input)]);
    const c = await receiveInstallments(cashier, input);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(await listAll(store, "settlements", { filters: [["eq", "installmentId", insts[0].id]] })).toHaveLength(1);
    expect(await movementsOf()).toHaveLength(1);
    expect((await sessionSummary(cashier, sessionId)).expected.cash).toBe(20000);
    await expect(receiveInstallments(cashier, { ...input, idemKey: "other" })).rejects.toMatchObject({ code: "installment_not_open" });
  });

  it("caixa fechado bloqueia o recebimento", async () => {
    const { insts } = await titleFor("maria", "m7", [[10000, 0]]);
    await closeSession(cashier, { sessionId, counted: { cash: 10000 } });
    await expect(receiveInstallments(cashier, { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, idemKey: "closed" })).rejects.toMatchObject({ code: "cash_closed" });
    expect((await store.getOrThrow("installments", insts[0].id)).status).toBe("open");
  });

  it("operador diferente segue o parâmetro cash.operatorMismatch (avisar, bloquear, permitir)", async () => {
    const other: Ctx = { ...cashier, user: { ...cashier.user, id: "outro-operador", name: "Otávio Operador" } };
    const { insts } = await titleFor("maria", "m8", [[1000, 0], [1000, -30], [1000, -60]]);
    const receive = (ctx: Ctx, i: number, key: string) => receiveInstallments(ctx, { terminalId, installmentIds: [insts[i].id], methodId: refs.methods.dinheiro.id, idemKey: key });
    const audits = async () => listAll(store, "audit_logs", { filters: [["eq", "action", "receivable.operator_mismatch"]] });
    // padrão: avisa
    await receive(other, 0, "op-warn");
    expect(await audits()).toHaveLength(1);
    // bloquear
    await setSetting(store, refs.company.id, null, "cash.operatorMismatch", "block");
    await expect(receive(other, 1, "op-block")).rejects.toMatchObject({ code: "cash_operator_mismatch" });
    // supervisor continua liberado
    await receive(manager, 1, "op-sup");
    // permitir sem aviso
    await setSetting(store, refs.company.id, null, "cash.operatorMismatch", "allow");
    await receive(other, 2, "op-allow");
    expect(await audits()).toHaveLength(1);
    expect(await movementsOf()).toHaveLength(3);
  });

  it("parâmetro feature.recebimentoPdv desligado bloqueia (nenhum movimento do tipo novo)", async () => {
    const { insts } = await titleFor("maria", "m9", [[1000, 0]]);
    await setSetting(store, refs.company.id, null, "feature.recebimentoPdv", false);
    await expect(receiveInstallments(cashier, { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, idemKey: "off" })).rejects.toMatchObject({ code: "feature_off" });
    expect(await movementsOf()).toHaveLength(0);
    // religado na filial
    await setSetting(store, refs.company.id, refs.branches.matriz.id, "feature.recebimentoPdv", true);
    await receiveInstallments(cashier, { terminalId, installmentIds: [insts[0].id], methodId: refs.methods.dinheiro.id, idemKey: "on" });
    expect(await movementsOf()).toHaveLength(1);
  });

  it("caixa sem recebimentos: previsto idêntico ao de antes (resumo sem recebimentos)", async () => {
    const sum = await sessionSummary(cashier, sessionId);
    expect(sum.receivables).toEqual({ total: 0, cash: 0, count: 0, byMethod: {} });
    expect(expectedOf(sum)).toEqual({ cash: 10000 });
  });
});
