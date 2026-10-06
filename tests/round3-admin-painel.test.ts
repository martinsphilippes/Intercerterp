import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import type { Ctx } from "@/lib/core/ctx";
import "@/domain/jobs-registry";
import { addMonths, monthEnd, monthStart, today } from "@/lib/dates";
import { accessibleUnits, toCtxUser } from "@/lib/auth/users";
import { updateUser } from "@/domain/users";
import { createCompany } from "@/domain/companies";
import { openSession } from "@/domain/cash";
import { finalizeSale, processReturn, returnableItems, type FinalizeSaleInput } from "@/domain/sales";
import { createTitle, settleInstallment } from "@/domain/finance";
import { computeCompetence } from "@/domain/cashflow";
import { paymentBreakdown, type ReportScope } from "@/domain/reports";

/**
 * Rodada 3 (administração / painel / financeiro):
 *  - restrição de filiais (lista única para todas as empresas do usuário) editada por gestor parcial;
 *  - devolução coberta por desconto concedido na baixa ('absorbed') em linha própria na quebra por pagamento;
 *  - detalhamento "parcelas abatidas" da competência: só o abatido no período (e com o centro de custo).
 */

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

describe("gestor parcial: restrição de filiais vale para todas as empresas do usuário", () => {
  let store: MemoryStore;
  let refs: DemoRefs;
  let A: string;
  let B: string;
  let bB1: string;
  let gid: string;
  let branchesA: string[];

  async function req(userId: string, companyId: string, branchId: string | null = null): Promise<Ctx> {
    const u = (await store.get("users", userId))!;
    return { store: scopeStore(store, companyId), companyId, branchId, user: await toCtxUser(store, u, companyId) };
  }
  async function roleOf(companyId: string, key: string) {
    return (await listAll(store, "roles", { filters: [["eq", "companyId", companyId], ["eq", "key", key]] }))[0];
  }
  async function directUser(key: string, data: Record<string, any>) {
    return store.create("users", { status: "active", isAdmin: false, branchIds: [], ...data, name: data.name ?? key, email: `${key}@r3.local` }, detId("r3-user", key));
  }
  /** Gestor de usuários em A; em B tem acesso, mas perfil de Caixa (não administra usuários em B). */
  async function partialManager(key: string) {
    const m = await directUser(key, { name: `Gestor ${key}`, companyIds: [A, B], roleByCompany: { [A]: (await roleOf(A, "admin")).id, [B]: (await roleOf(B, "cashier")).id } });
    return req(m.id, A, refs.branches.matriz.id);
  }
  async function target(key: string, branchIds: string[]) {
    const cashierA = (await roleOf(A, "cashier")).id;
    const t = await directUser(key, { name: `Alvo ${key}`, companyIds: [A, B], branchIds, roleId: cashierA, roleByCompany: { [A]: cashierA, [B]: (await roleOf(B, "cashier")).id } });
    return { t, base: { name: t.name, email: t.email, roleId: cashierA, companyIds: [A, B] } };
  }
  async function unitsIn(userId: string, companyId: string) {
    const u = (await store.get("users", userId))!;
    return (await accessibleUnits(store, u)).branches.filter((b) => b.companyId === companyId).map((b) => b.id).sort();
  }

  beforeAll(async () => {
    store = freshStore();
    refs = await seedBase(store);
    A = refs.company.id;
    gid = (await directUser("global", { name: "Gabriel Global", isAdmin: true, companyIds: [] })).id;
    const r = await createCompany(await req(gid, A, refs.branches.matriz.id), { name: "Empresa B R3 Ltda", cnpj: cnpj("457231740010"), regime: "simples", address: { uf: "SP", cityName: "Campinas", cityCode: "3509502" } });
    B = r.company.id;
    bB1 = r.branch.id;
    branchesA = (await listAll(store, "branches", { filters: [["eq", "companyId", A]] })).map((b) => b.id).sort();
  });

  it("alvo sem restrição (todas as filiais) e com empresa fora do alcance: gestor parcial não inclui restrição", async () => {
    const g = await partialManager("pm-z");
    const { t, base } = await target("alvo-z", []);
    expect(await unitsIn(t.id, B)).toEqual([bB1]);
    await expect(updateUser(g, t.id, { ...base, branchIds: [refs.branches.matriz.id] })).rejects.toThrow(/Restringir filiais.*Empresa B R3/);
    const after = (await store.get("users", t.id))!;
    expect(after.branchIds ?? []).toEqual([]);
    expect(await unitsIn(t.id, B)).toEqual([bB1]);
    // sem mexer nas filiais, a edição segue normal (lista continua vazia)
    const ok = await updateUser(g, t.id, { ...base, name: "Alvo Z Renomeado", branchIds: [] });
    expect(ok.name).toBe("Alvo Z Renomeado");
    expect(ok.branchIds ?? []).toEqual([]);
  });

  it("alvo com restrição: desmarcar todas as filiais de uma empresa do alcance é recusado (sem ampliação nem perda silenciosa); as de fora ficam idênticas", async () => {
    const g = await partialManager("pm-y");
    const { t, base } = await target("alvo-y", [refs.branches.matriz.id, bB1]);
    await expect(updateUser(g, t.id, { ...base, branchIds: [] })).rejects.toThrow(/Marque ao menos uma filial/);
    expect(await unitsIn(t.id, B)).toEqual([bB1]);
    // trocar a filial de A por outra de A continua restringindo A; a de B segue preservada
    const again = await updateUser(g, t.id, { ...base, branchIds: [refs.branches.shopping.id] });
    expect([...again.branchIds].sort()).toEqual([refs.branches.shopping.id, bB1].sort());
    expect(await unitsIn(t.id, B)).toEqual([bB1]);
  });

  it("alvo com restrição só em filiais do alcance: esvaziar a lista removeria a restrição na empresa de fora — recusado", async () => {
    const g = await partialManager("pm-r");
    const { t, base } = await target("alvo-r", [refs.branches.matriz.id]);
    expect(await unitsIn(t.id, B)).toEqual([]);
    await expect(updateUser(g, t.id, { ...base, branchIds: [] })).rejects.toThrow(/Marque ao menos uma filial.*Empresa B R3/);
    expect((await store.get("users", t.id))!.branchIds).toEqual([refs.branches.matriz.id]);
    expect(await unitsIn(t.id, B)).toEqual([]);
    // trocar a filial do alcance é permitido (a restrição continua existindo)
    const ok = await updateUser(g, t.id, { ...base, branchIds: [refs.branches.shopping.id] });
    expect(ok.branchIds).toEqual([refs.branches.shopping.id]);
  });

  it("administrador (alcance total) continua definindo a restrição livremente", async () => {
    const admin = await req(gid, A, refs.branches.matriz.id);
    const { t, base } = await target("alvo-adm", []);
    const after = await updateUser(admin, t.id, { ...base, branchIds: [refs.branches.matriz.id] });
    expect(after.branchIds).toEqual([refs.branches.matriz.id]);
  });
});

describe("quebra por pagamento: devolução coberta por desconto concedido no recebimento", () => {
  let store: MemoryStore;
  let refs: DemoRefs;
  let cashier: Ctx;
  let manager: Ctx;
  let terminalId: string;
  const sale = (input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }) => finalizeSale(cashier, { terminalId, ...input });
  const scopeToday = (): ReportScope => ({ companyId: refs.company.id, branchIds: null, from: today(), to: today() });

  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    manager = await refs.ctxFor("manager", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("reembolso em dinheiro só com o que saiu do caixa; a parte absorvida pelo desconto em linha própria", async () => {
    const s = await sale({ idemKey: "abs-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 5980 }] });
    const title = (await listAll(store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", s.id]] }))[0];
    const [inst] = await listAll(store, "installments", { filters: [["eq", "titleId", title.id]] });
    // quitado por 50,00 com 9,80 de desconto concedido no recebimento
    await settleInstallment(manager, { installmentId: inst.id, date: today(), principal: 5980, discount: 980, accountId: refs.accounts.banco.id, idemKey: "abs-pay" });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "abs-r", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 2000, condition: "resellable" }] });
    expect(r).toMatchObject({ itemsTotal: 5980, abatedAmount: 0, compensatedAmount: 5000 });
    const cashOut = (await listAll(store, "cash_movements", { filters: [["eq", "returnId", r.id]] })).reduce((a, m) => a + m.amount, 0);
    expect(cashOut).toBe(-5000);

    const pay = await paymentBreakdown(store, scopeToday());
    const ret = pay.rows.filter((x) => x.kind === "return");
    expect(ret.find((x) => x.id === "ret:cash")).toMatchObject({ label: "Devolução — reembolso em dinheiro", amount: 5000, count: 1 });
    expect(ret.find((x) => x.id === "ret:absorbed")).toMatchObject({ label: "Devolução — coberta por desconto concedido no recebimento", amount: 980, count: 1 });
    expect(ret.some((x) => x.id === "ret:abatement")).toBe(false);
    expect(pay.returnsTotal).toBe(5980);
    expect(pay.paymentsTotal - pay.returnsTotal).toBe(pay.netRevenue);
  });
});

describe("competência → 'parcelas abatidas': abatido do período e centro de custo", () => {
  let refs: DemoRefs;
  let ctx: Ctx;

  /** Mesmo registro que o módulo de vendas grava ao abater parcela por devolução (ver tests/finance-round2.test.ts). */
  async function abate(instId: string, take: number, date: string) {
    const inst = await ctx.store.getOrThrow("installments", instId);
    const seq = (inst.seq ?? 0) + 1;
    const idem = `r3-return:${inst.id}:${seq}`;
    await ctx.store.transaction(async (t) => {
      await t.create(
        "settlements",
        {
          companyId: ctx.companyId, branchId: inst.branchId, createdBy: ctx.user.id, installmentId: inst.id, titleId: inst.titleId, kind: "abatement", seq, date,
          principal: take, interest: 0, fine: 0, discount: take, fee: 0, total: 0, methodId: null, methodKind: "return", accountId: null, accountEntryId: null,
          reference: "Devolução", notes: "Abatimento por devolução", status: "active", operationId: null, idemKey: idem,
        },
        detId("settle", idem),
      );
      const balance = inst.balance - take;
      await t.update("installments", inst.id, { paid: (inst.paid ?? 0) + take, discount: (inst.discount ?? 0) + take, balance, status: balance === 0 ? "paid" : "partial", seq, lastSettlementAt: date });
      await t.increment("titles", inst.titleId, "balance", -take, { min: 0 });
    });
  }

  beforeEach(async () => {
    const store = freshStore();
    refs = await seedBase(store);
    ctx = await refs.ctxFor("finance", "matriz");
  });

  it("linha da competência do mês = coluna 'Abatido' do detalhamento; filtro de centro de custo aplicado", async () => {
    const { queryInstallments } = await import("@/app/(app)/financeiro/queries");
    const cc = refs.costCenters["loja-matriz"].id;
    const t = await createTitle(ctx, {
      kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: "Venda r3", originType: "sale", originId: "sale-r3", categoryId: null, costCenterId: cc,
      issueDate: addMonths(monthStart(today()), -1), competenceDate: addMonths(monthStart(today()), -1),
      installments: [{ amount: 10000, dueDate: monthEnd(today()) }], idemKey: "r3-ab", branchId: ctx.branchId,
    });
    const [inst] = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", t.id]] });
    await abate(inst.id, 2000, addMonths(monthStart(today()), -1));
    await abate(inst.id, 3000, today());

    const m = today().slice(0, 7);
    const comp = await computeCompetence(ctx, { fromMonth: m, toMonth: m, costCenterId: cc });
    const row = comp.rows.find((r) => r.source === "abatement")!;
    expect(row.total).toBe(-3000);

    const drill = await queryInstallments(ctx, "receivable", { q: "", f: { abFrom: comp.from, abTo: comp.to, category: row.categoryId || "none", costCenter: cc } });
    expect(drill).toHaveLength(1);
    expect(drill[0]).toMatchObject({ id: inst.id, abated: 3000, abatedTotal: 5000, paid: 0, balance: 5000 });
    expect(drill.reduce((a, r) => a + r.abated, 0)).toBe(-row.total);
    // outro centro de custo: a competência não tem a linha e o detalhamento fica vazio
    const other = refs.costCenters.adm.id;
    expect((await computeCompetence(ctx, { fromMonth: m, toMonth: m, costCenterId: other })).rows.some((r) => r.source === "abatement")).toBe(false);
    expect(await queryInstallments(ctx, "receivable", { q: "", f: { abFrom: comp.from, abTo: comp.to, costCenter: other } })).toHaveLength(0);
    // sem recorte de abatimento: a coluna mostra o abatido de sempre
    const all = await queryInstallments(ctx, "receivable", { q: "", f: { title: t.id } });
    expect(all[0]).toMatchObject({ abated: 5000, abatedTotal: 5000 });
  });
});
