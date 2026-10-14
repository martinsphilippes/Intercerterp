import { describe, it, expect, beforeAll } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, addMonths, today } from "@/lib/dates";
import { setSetting } from "@/lib/core/settings";
import { buildSchedule, createManualTitle, LATE_DEFAULTS, lateChargeParams, nonBusinessDayRule, settleInstallment, suggestLateCharges } from "@/domain/finance";
import { batchSettleKey, MAX_BATCH_ITEMS, previewBatchSettlement, SETTLE_ITEMS_PER_TX, SETTLE_OPS_PER_ITEM, settleBatch } from "@/domain/finance-batch";
import { MAX_TX_OPS } from "@/domain/price-adjust";
import { buildCarne, lateInstructions, loadCarne, SLIPS_PER_SHEET } from "@/domain/carne";
import { crc16, pixStaticPayload } from "@/lib/pix";
import { adjustDueDate, fixedHoliday, isBusinessDay, nextBusinessDay } from "@/lib/business-days";
import { previewSchedule } from "@/domain/cart-calc";
import { openSession } from "@/domain/cash";
import { finalizeSale } from "@/domain/sales";
import { PARAM_MAP } from "@/app/(app)/administracao/parametros/catalog";

/** Fase 4 — baixa em lote (FIN-02), carnê (FIN-06) e vencimento em dia útil (FIN-26). */

let store: Store;
let refs: DemoRefs;
let fin: Ctx;
let cashier: Ctx;
let seq = 0;

const T0 = today();
const insts = (titleId: string) => listAll(store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number", dir: "asc" }] });
const account = (key = "banco") => store.getOrThrow("financial_accounts", refs.accounts[key].id);

async function receivable(amounts: number[], firstDue: string, party = "maria") {
  const key = `fb-r-${++seq}`;
  return createManualTitle(fin, {
    kind: "receivable", partyType: "customer", partyId: refs.customers[party].id, description: `Crediário ${key}`, issueDate: addDays(firstDue, -30), competenceDate: addDays(firstDue, -30),
    installments: amounts.map((amount, i) => ({ amount, dueDate: addMonths(firstDue, i) })), idemKey: key,
  });
}

async function payable(amounts: number[], firstDue: string, approved = true) {
  const key = `fb-p-${++seq}`;
  return createManualTitle(fin, {
    kind: "payable", partyType: "supplier", partyId: refs.suppliers.textil.id, description: `Compra ${key}`, issueDate: addDays(firstDue, -30), competenceDate: addDays(firstDue, -30),
    installments: amounts.map((amount, i) => ({ amount, dueDate: addMonths(firstDue, i) })), approved, idemKey: key,
  });
}

const batch = (ctx: Ctx, kind: "receivable" | "payable", ids: string[], idemKey: string, applyLateCharges: boolean, extra: Partial<{ date: string; accountId: string; methodId: string }> = {}) =>
  settleBatch(ctx, { kind, installmentIds: ids, date: extra.date ?? T0, applyLateCharges, accountId: extra.accountId ?? refs.accounts.banco.id, methodId: extra.methodId ?? refs.methods.pix.id, idemKey });

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  fin = await refs.ctxFor("finance", "matriz");
  cashier = await refs.ctxFor("cashier", "matriz");
}, 120000);

describe("baixa em lote (FIN-02)", () => {
  it("lote cabe no limite de 100 escritas por transação do Appwrite", () => {
    expect(SETTLE_ITEMS_PER_TX * SETTLE_OPS_PER_ITEM + 1).toBeLessThanOrEqual(MAX_TX_OPS);
    expect(SETTLE_ITEMS_PER_TX).toBeGreaterThan(1);
  });

  it("contas a receber com multa e juros sugeridos: valores da regra §13, conta, parcelas e títulos atualizados", async () => {
    const due = addDays(T0, -45);
    const a = await receivable([10000, 10000], due);
    const b = await receivable([5000], addDays(T0, -10), "joao");
    const ids = [...(await insts(a.id)).map((i) => i.id), ...(await insts(b.id)).map((i) => i.id)];
    const late = await lateChargeParams(store, fin.companyId, fin.branchId);
    const before = await account();
    const prev = await previewBatchSettlement(fin, { kind: "receivable", installmentIds: ids, date: T0, applyLateCharges: true });
    expect(prev.totals.ok).toBe(3);
    const r = await batch(fin, "receivable", ids, "rec-juros", true);
    expect(r.settled).toBe(3);
    expect(r.errors).toBe(0);
    for (const l of r.lines) {
      const inst = await store.getOrThrow("installments", l.installmentId);
      const sugg = suggestLateCharges(inst.dueDate, T0, inst.amount, late);
      expect(l.fine).toBe(sugg.fine);
      expect(l.interest).toBe(sugg.interest);
      expect(l.total).toBe(inst.amount + sugg.fine + sugg.interest);
      expect(inst.status).toBe("paid");
      expect(inst.balance).toBe(0);
      const st = await store.getOrThrow("settlements", l.settlementId!);
      expect(st.operationId).toBe(r.jobId);
      expect(st.methodKind).toBe("pix");
    }
    // a 2ª parcela do título "a" vence no futuro? não: due−45 + 1 mês ainda é passado → todas com encargos
    expect(r.lines.every((l) => l.fine > 0)).toBe(true);
    expect(r.total).toBe(prev.totals.total);
    const after = await account();
    expect(after.balance - before.balance).toBe(r.total);
    expect(after.seq - before.seq).toBe(3);
    expect((await store.getOrThrow("titles", a.id)).status).toBe("paid");
    expect((await store.getOrThrow("titles", b.id)).status).toBe("paid");
    const sum = (await listAll(store, "audit_logs", { filters: [["eq", "action", "settlement.batch"], ["eq", "entityId", r.jobId]] }))[0];
    expect(sum?.summary).toMatch(/3 parcela\(s\) baixada\(s\)/);
    // histórico do título recebe a baixa (mesmo evento da baixa individual)
    expect((await listAll(store, "audit_logs", { filters: [["eq", "action", "settlement.create"], ["eq", "entityId", a.id]] })).length).toBe(2);
  });

  it("contas a receber sem encargos: baixa pelo saldo, multa e juros zerados", async () => {
    const a = await receivable([7000, 3000], addDays(T0, -70));
    const ids = (await insts(a.id)).map((i) => i.id);
    const r = await batch(fin, "receivable", ids, "rec-sem", false);
    expect(r.settled).toBe(2);
    expect(r.lines.map((l) => [l.fine, l.interest, l.total])).toEqual([[0, 0, 7000], [0, 0, 3000]]);
    expect(r.total).toBe(10000);
  });

  it("contas a pagar: só obrigações autorizadas; com e sem encargos; saída na conta", async () => {
    const ok1 = await payable([20000], addDays(T0, -20));
    const ok2 = await payable([8000], addDays(T0, 5));
    const pend = await payable([9900], addDays(T0, -3), false);
    const ids = [...(await insts(ok1.id)), ...(await insts(ok2.id)), ...(await insts(pend.id))].map((i) => i.id);
    const before = await account();
    const r = await batch(fin, "payable", ids, "pag-1", true);
    expect(r.settled).toBe(2);
    expect(r.errors).toBe(1);
    const failed = r.lines.find((l) => l.status === "error")!;
    expect(failed.titleNumber).toBe(pend.number);
    expect(failed.message).toMatch(/não autorizada/);
    const l1 = r.lines.find((l) => l.titleId === ok1.id)!;
    const sugg = suggestLateCharges(addDays(T0, -20), T0, 20000, await lateChargeParams(store, fin.companyId, fin.branchId));
    expect([l1.fine, l1.interest]).toEqual([sugg.fine, sugg.interest]);
    const l2 = r.lines.find((l) => l.titleId === ok2.id)!;
    expect([l2.fine, l2.interest, l2.total]).toEqual([0, 0, 8000]); // a vencer: sem encargos
    const after = await account();
    expect(before.balance - after.balance).toBe(r.total);
    expect((await insts(pend.id))[0].status).toBe("open");
    // sem encargos
    const ok3 = await payable([4500], addDays(T0, -60));
    const r2 = await batch(fin, "payable", (await insts(ok3.id)).map((i) => i.id), "pag-2", false);
    expect(r2.lines[0]).toMatchObject({ status: "settled", fine: 0, interest: 0, total: 4500 });
  });

  it("parcela de outro tipo, quitada ou de cartão fica fora do lote com o motivo", async () => {
    const pay = await payable([1000], addDays(T0, -1));
    const rec = await receivable([1500], addDays(T0, -1));
    const [ri] = await insts(rec.id);
    await settleInstallment(fin, { installmentId: ri.id, date: T0, principal: 1500, accountId: refs.accounts.banco.id, idemKey: "fb-manual-1" });
    const prev = await previewBatchSettlement(fin, { kind: "receivable", installmentIds: [(await insts(pay.id))[0].id, ri.id, "inexistente"], date: T0, applyLateCharges: true });
    expect(prev.lines.map((l) => l.status)).toEqual(["error", "error", "error"]);
    expect(prev.lines[0].message).toMatch(/não é de contas a receber/);
    expect(prev.lines[1].message).toMatch(/já recebida/);
    expect(prev.lines[2].message).toMatch(/não encontrada/);
    await expect(previewBatchSettlement(fin, { kind: "receivable", installmentIds: [ri.id], date: addDays(T0, 1), applyLateCharges: false })).rejects.toThrow(/futura/);
    await expect(previewBatchSettlement(fin, { kind: "receivable", installmentIds: Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => `x${i}`), date: T0, applyLateCharges: false })).rejects.toThrow(/no máximo/);
  });

  it("idempotência: reenviar o mesmo lote não baixa duas vezes; outro envio das mesmas parcelas é recusado por parcela", async () => {
    const a = await receivable([4000, 4000, 4000], addDays(T0, -5));
    const ids = (await insts(a.id)).map((i) => i.id);
    const before = await account();
    const r1 = await batch(fin, "receivable", ids, "idem-1", true);
    const mid = await account();
    const r2 = await batch(fin, "receivable", ids, "idem-1", true);
    expect(r2.replayed).toBe(true);
    expect(r2.settled).toBe(r1.settled);
    expect(r2.total).toBe(r1.total);
    expect((await account()).balance).toBe(mid.balance);
    expect((await account()).seq).toBe(mid.seq);
    expect(mid.balance - before.balance).toBe(r1.total);
    const r3 = await batch(fin, "receivable", ids, "idem-2", true);
    expect(r3.settled).toBe(0);
    expect(r3.lines.every((l) => /já recebida/.test(l.message ?? ""))).toBe(true);
    expect((await account()).balance).toBe(mid.balance);
    const sts = await listAll(store, "settlements", { filters: [["eq", "titleId", a.id]] });
    expect(sts.length).toBe(3);
  });

  it("falha parcial isolada: parcela baixada por outra operação no meio do lote não impede as demais e não deixa baixa órfã", async () => {
    const a = await receivable([3000, 3000, 3000, 3000], addDays(T0, -15));
    const list = await insts(a.id);
    const ids = list.map((i) => i.id);
    const victim = list[2];
    let fired = false;
    const base = store as any;
    const raced = new Proxy(base, {
      get(target, prop) {
        const v = target[prop];
        if (prop === "transaction") {
          return async (fn: any) => {
            if (!fired) {
              fired = true;
              // concorrente: baixa integral da 3ª parcela depois da prévia e antes do lote
              await settleInstallment(fin, { installmentId: victim.id, date: T0, principal: victim.balance, accountId: refs.accounts["caixa-matriz"].id, idemKey: "fb-race" });
            }
            return v.call(target, fn);
          };
        }
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const ctx: Ctx = { ...fin, store: raced as Store };
    const before = await account();
    const r = await batch(ctx, "receivable", ids, "race-1", false);
    expect(r.settled).toBe(3);
    expect(r.errors).toBe(1);
    const bad = r.lines.find((l) => l.installmentId === victim.id)!;
    expect(bad.status).toBe("error");
    expect(bad.message).toMatch(/saldo/i);
    // nenhuma baixa/lançamento do lote para a parcela recusada; conta = soma das baixadas
    expect(await store.get("settlements", detId("settle", batchSettleKey("race-1", victim.id)))).toBeNull();
    const lotEntries = await listAll(store, "account_entries", { filters: [["eq", "operationId", r.jobId]] });
    expect(lotEntries.length).toBe(3);
    expect(lotEntries.reduce((s, e) => s + e.amount, 0)).toBe(r.total);
    expect((await account()).balance - before.balance).toBe(9000);
    expect((await store.getOrThrow("installments", victim.id)).paid).toBe(3000); // só a baixa concorrente
    expect((await store.getOrThrow("titles", a.id)).status).toBe("paid");
  });

  it("lote com mais de 24 parcelas: várias transações, sequência da conta contínua e saldos corretos", async () => {
    const titles: Doc[] = [];
    for (let k = 0; k < 3; k++) titles.push(await receivable(Array.from({ length: 10 }, () => 1000 + k), addDays(T0, -400)));
    const ids: string[] = [];
    for (const t of titles) ids.push(...(await insts(t.id)).map((i) => i.id));
    expect(ids.length).toBe(30);
    const before = await account();
    const r = await batch(fin, "receivable", ids, "big-1", false);
    expect(r.settled).toBe(30);
    expect(r.total).toBe(10 * 1000 + 10 * 1001 + 10 * 1002);
    const chunks = await listAll(store, "operations", { filters: [["eq", "type", "finance.settle_batch.chunk"], ["eq", "entityId", r.jobId]] });
    expect(chunks.length).toBe(Math.ceil(30 / SETTLE_ITEMS_PER_TX));
    const after = await account();
    expect(after.seq - before.seq).toBe(30);
    expect(after.balance - before.balance).toBe(r.total);
    const entries = (await listAll(store, "account_entries", { filters: [["eq", "accountId", refs.accounts.banco.id]] })).filter((e) => e.seq > before.seq).sort((x, y) => x.seq - y.seq);
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 30 }, (_, i) => before.seq + i + 1));
    let bal = before.balance;
    for (const e of entries) {
      bal += e.amount;
      expect(e.balanceAfter).toBe(bal);
    }
    for (const t of titles) expect((await store.getOrThrow("titles", t.id)).status).toBe("paid");
  });

  it("permissão: sem 'Baixar títulos' ou sem o módulo financeiro a baixa em lote é negada", async () => {
    const a = await receivable([1200], addDays(T0, -2));
    const ids = (await insts(a.id)).map((i) => i.id);
    await expect(batch(cashier, "receivable", ids, "perm-1", false)).rejects.toThrow(/permissão/);
    const noSettle: Ctx = { ...fin, user: { ...fin.user, actions: (fin.user.actions ?? []).filter((x: string) => x !== "finance.settle") } };
    await expect(batch(noSettle, "receivable", ids, "perm-2", false)).rejects.toThrow(/permissão/);
    await expect(previewBatchSettlement(noSettle, { kind: "receivable", installmentIds: ids, date: T0, applyLateCharges: false })).rejects.toThrow(/permissão/);
    const consolidated: Ctx = { ...fin, branchId: null };
    await expect(batch(consolidated, "receivable", ids, "perm-3", false)).rejects.toThrow(/filial/);
    expect((await insts(a.id))[0].status).toBe("open");
  });

  it("parâmetros de recursos ligados por padrão", () => {
    expect(PARAM_MAP["feature.baixaLote"]?.default).toBe(true);
    expect(PARAM_MAP["feature.carne"]?.default).toBe(true);
    expect(PARAM_MAP["finance.dueDateNonBusinessDay"]?.default).toBe("keep");
  });
});

describe("carnê (FIN-06)", () => {
  it("Pix estático: CRC16 do BR Code e montagem do payload", () => {
    expect(crc16("123456789")).toBe("29B1");
    const p = pixStaticPayload({ key: "loja@example.com", merchantName: "Loja São João", merchantCity: "São Paulo", amount: 12345, txid: "T12P3" });
    expect(p.startsWith("000201")).toBe(true);
    expect(p).toContain("0014br.gov.bcb.pix0116loja@example.com");
    expect(p).toContain("5406123.45");
    expect(p).toContain("5913Loja Sao Joao");
    expect(p).toContain("6009Sao Paulo");
    expect(p).toContain("62090505T12P3");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it("monta uma lâmina por parcela ativa, 3 por folha, com encargos informativos e Pix só no que está em aberto", () => {
    const late = { fineBps: 200, interestMonthlyBps: 100, graceDays: 0 };
    const mk = (n: number, status: string, balance: number) => ({ id: `i${n}`, number: n, dueDate: addMonths("2026-01-10", n - 1), amount: 10000, balance, status });
    const input = {
      company: { name: "Loja Exemplo Ltda", tradeName: "Loja Exemplo", cnpj: "11222333000181" },
      title: { id: "t1", number: 77, description: "Venda nº 15", documentNumber: "15", installmentsCount: 6, originType: "sale" },
      installments: [mk(1, "paid", 0), mk(2, "partial", 4000), mk(3, "open", 10000), mk(4, "renegotiated", 10000), mk(5, "open", 10000), mk(6, "cancelled", 10000)],
      late,
      pix: { key: "11222333000181", merchantName: "Loja Exemplo", merchantCity: "Sao Paulo" },
    };
    const all = buildCarne(input);
    expect(all.slips.map((s) => s.number)).toEqual([1, 2, 3, 5]);
    expect(all.sheets.map((s) => s.length)).toEqual([SLIPS_PER_SHEET, 1]);
    const [p1, p2, p3] = all.slips;
    expect(p1).toMatchObject({ paid: true, balance: 0, pixPayload: null, reference: "77/1", documentLabel: "Venda nº 15" });
    expect(p2).toMatchObject({ paid: false, partial: true, balance: 4000, fine: 80, interestPerDay: 1 });
    expect(p3).toMatchObject({ fine: 200, interestPerDay: 3, reference: "77/3" });
    expect(p3.pixPayload).toContain("5406100.00");
    expect(p3.instructions[0]).toMatch(/multa de 2,00% \(R\$\s?2,00\) e juros de 1,00% ao mês \(R\$\s?0,03 por dia\)/);
    const open = buildCarne({ ...input, onlyOpen: true });
    expect(open.slips.map((s) => s.number)).toEqual([2, 3, 5]);
    expect(open.sheets.length).toBe(1);
    expect(buildCarne({ ...input, pix: null }).slips.every((s) => s.pixPayload == null)).toBe(true);
    expect(lateInstructions(10000, { fineBps: 0, interestMonthlyBps: 0, graceDays: 0 }).lines[0]).toMatch(/Sem multa/);
    expect(lateInstructions(10000, { ...LATE_DEFAULTS, graceDays: 5 }).lines[0]).toMatch(/Após 5 dia/);
  });

  it("carrega o título a receber com cliente e a chave Pix da conta", async () => {
    await store.update("financial_accounts", refs.accounts.pix.id, { pixKey: "pix@loja.example.com" });
    const t = await receivable([3000, 3000, 3001], addDays(T0, 30), "joao");
    const c = await loadCarne(fin, t.id);
    expect(c).not.toBeNull();
    expect(c!.slips.length).toBe(3);
    expect(c!.party.name).toBe(refs.customers.joao.name);
    expect(c!.party.doc).toBe(refs.customers.joao.doc);
    expect(c!.slips[2].amount).toBe(3001);
    expect(c!.slips.every((s) => s.pixPayload?.includes("pix@loja.example.com"))).toBe(true);
    expect(c!.pixAccountName).toBe(refs.accounts.pix.name);
    // título a pagar não tem carnê
    const p = await payable([1000], addDays(T0, 10));
    expect(await loadCarne(fin, p.id)).toBeNull();
    await store.update("financial_accounts", refs.accounts.pix.id, { pixKey: null });
  });
});

describe("vencimento em dia não útil (FIN-26)", () => {
  it("fins de semana e feriados nacionais fixos", () => {
    expect(isBusinessDay("2026-10-14")).toBe(true); // quarta
    expect(isBusinessDay("2026-10-17")).toBe(false); // sábado
    expect(fixedHoliday("2026-10-12")).toMatch(/Aparecida/);
    expect(nextBusinessDay("2026-10-17")).toBe("2026-10-19");
    expect(nextBusinessDay("2026-11-20")).toBe("2026-11-23"); // Consciência Negra (sexta) → segunda
    expect(fixedHoliday("2023-11-20")).toBeNull(); // nacional só a partir de 2024
    expect(nextBusinessDay("2026-12-25")).toBe("2026-12-28");
    expect(nextBusinessDay("2027-01-01")).toBe("2027-01-04");
    expect(adjustDueDate("2026-10-17", "keep")).toBe("2026-10-17");
    expect(adjustDueDate("2026-10-17", null)).toBe("2026-10-17");
  });

  it("buildSchedule: padrão inalterado; 'next' leva ao próximo dia útil; prévia do PDV usa a mesma regra", () => {
    const term = { installments: 3, firstDueDays: 30, intervalDays: 30 };
    const base = "2026-09-17"; // 17/10 sábado, 17/11 terça, 17/12 quinta
    const keep = buildSchedule(10000, term, base);
    expect(keep.map((x) => x.dueDate)).toEqual(["2026-10-17", "2026-11-17", "2026-12-17"]);
    expect(buildSchedule(10000, term, base, { nonBusinessDay: "keep" })).toEqual(keep);
    const next = buildSchedule(10000, term, base, { nonBusinessDay: "next" });
    expect(next.map((x) => x.dueDate)).toEqual(["2026-10-19", "2026-11-17", "2026-12-17"]);
    expect(next.map((x) => x.amount)).toEqual(keep.map((x) => x.amount));
    expect(previewSchedule(10000, term, base, "next")).toEqual(next);
    expect(previewSchedule(10000, term, base)).toEqual(keep);
  });

  it("venda a prazo no PDV aplica o parâmetro da empresa (padrão mantém a data)", async () => {
    expect(await nonBusinessDayRule(store, fin.companyId, fin.branchId)).toBe("keep");
    await setSetting(store, fin.companyId, null, "finance.dueDateNonBusinessDay", "next");
    try {
      expect(await nonBusinessDayRule(store, fin.companyId, fin.branchId)).toBe("next");
      await openSession(cashier, { terminalId: refs.terminals.cx1.id, openingFund: 0 });
      const sale = await finalizeSale(cashier, {
        idemKey: "fb-fin26-sale", terminalId: refs.terminals.cx1.id, customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }],
        payments: [{ methodId: refs.methods.crediario.id, amount: 4490, paymentTermId: refs.terms["30-60-90"].id }],
      });
      const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", sale.id]] }))[0];
      const dues = (await insts(title.id)).map((i) => i.dueDate);
      expect(dues).toEqual([1, 2, 3].map((k) => adjustDueDate(addMonths(T0, k), "next")));
      for (const d of dues) expect(isBusinessDay(d)).toBe(true);
    } finally {
      await setSetting(store, fin.companyId, null, "finance.dueDateNonBusinessDay", "keep");
    }
  });
});
