import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { addReturn, addSale, at, baseRefs, BR1, BR2, COMPANY } from "./report-fixtures";
import { closeCommission, commissionReport, listClosings, reopenCommission } from "@/domain/commissions";
import { createSeller, setSellerActive, updateSeller } from "@/domain/sellers";
import { createGoal, goalsProgress, goalsScreen } from "@/domain/goals";
import { createTitle } from "@/domain/finance";
import { authenticate, loginBlockReason, setUserStatus } from "@/domain/users";
import { getAuth } from "@/lib/auth/provider";
import { setSetting } from "@/lib/core/settings";
import { listAll } from "@/lib/db";
import { getExport } from "@/lib/exporters";
import type { Store } from "@/lib/db/types";
import type { Ctx, CtxUser } from "@/lib/core/ctx";
import type { SessionInfo } from "@/lib/server/session";
import "@/exports/commissions";

function ctxFor(store: Store, over: Partial<CtxUser> = {}, branchId: string | null = BR1): Ctx {
  return { store, companyId: COMPANY, branchId, user: { id: "op-1", name: "Gestor", email: "g@t", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [COMPANY], ...over } };
}

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const NOV = { from: "2026-11-01", to: "2026-11-30" };

/** Título a prazo da venda + baixas (principal) gravadas diretamente: o que a apuração "recebido" lê. */
async function deferredTitle(ctx: Ctx, saleId: string, amounts: number[], settlements: Array<{ n: number; date: string; principal: number }>) {
  const title = await createTitle(ctx, {
    kind: "receivable", partyType: "customer", partyName: "Cliente", description: `Venda ${saleId}`, originType: "sale", originId: saleId, issueDate: "2026-10-05",
    installments: amounts.map((amount, i) => ({ amount, dueDate: `2026-1${i + 1}-05` })), idemKey: `sale:${saleId}:deferred`, branchId: BR1,
  });
  const insts = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", title.id]] });
  for (const [k, s] of settlements.entries()) {
    const inst = insts.find((i) => i.number === s.n)!;
    await ctx.store.create("settlements", {
      companyId: COMPANY, branchId: BR1, installmentId: inst.id, titleId: title.id, kind: "settlement", seq: k + 1, date: s.date, principal: s.principal, interest: 0, fine: 0, discount: 0, fee: 0,
      total: s.principal, status: "active", idemKey: `st-${saleId}-${k}`,
    });
  }
  return title;
}

describe("comissões de vendedores (VEN-05) e vendedor sem acesso (CAD-05)", () => {
  let store: Store;
  let ctx: Ctx;
  let sellerA: string;
  let sellerB: string;

  beforeEach(async () => {
    store = freshStore();
    await baseRefs(store);
    ctx = ctxFor(store);
    // A: sem acesso, 5% geral e 10% na categoria Y; B: usuário do sistema (op-2) com 2%
    sellerA = (await createSeller(ctx, { name: "Rafael Representante", commissionBps: 500, commissionByCategory: { "cat-y": 1000 }, idemKey: "a" })).id;
    await store.update("users", "op-2", { companyIds: [COMPANY] });
    await updateSeller(ctx, "op-2", { name: "ignorado", commissionBps: 200 });
    sellerB = "op-2";
    // s1 (10/out, A): item X 100,00 − 10,00 desc + 5,00 acréscimo; item Y 50,00 — à vista
    await addSale(store, { id: "s1", at: at("2026-10-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 10000, discount: 1000, surcharge: 500, cost: 1 }, { skuId: "y", qty: 1000, unitPrice: 5000, cost: 1, categoryId: "cat-y" }] });
    // s2 (05/out, A): 200,00 no crediário (2 parcelas)
    await addSale(store, { id: "s2", at: at("2026-10-05"), items: [{ skuId: "x", qty: 1000, unitPrice: 20000, cost: 1 }], payments: [{ methodKind: "crediario", amount: 20000 }] });
    // s3 (12/out, B): 4 un × 25,00
    await addSale(store, { id: "s3", at: at("2026-10-12"), items: [{ skuId: "z", qty: 4000, unitPrice: 2500, cost: 1 }] });
    // s4 (13/out, A): cancelada
    await addSale(store, { id: "s4", at: at("2026-10-13"), status: "cancelled", items: [{ skuId: "x", qty: 1000, unitPrice: 30000, cost: 1 }] });
    // s5 (14/out, sem vendedor): operador op-1 (sem percentual) — não gera comissão para A nem B
    await addSale(store, { id: "s5", at: at("2026-10-14"), items: [{ skuId: "x", qty: 1000, unitPrice: 9900, cost: 1 }] });
    for (const id of ["s1", "s2", "s4"]) await store.update("sales", id, { sellerId: sellerA });
    await store.update("sales", "s3", { sellerId: sellerB });
    await store.update("sales", "s4", { cancelledAt: at("2026-10-13", 15) });
  });

  it("base faturada: líquido dos itens (sem acréscimo), percentual por categoria; cancelada não conta", async () => {
    const r = await commissionReport(ctx, { ...OCT, base: "invoiced" });
    const a = r.sellers.find((s) => s.sellerId === sellerA)!;
    // s1: X base 90,00 × 5% = 4,50; Y 50,00 × 10% = 5,00 → 9,50; s2: 200,00 × 5% = 10,00
    expect(a.lines.map((l) => [l.key, l.base, l.amount])).toEqual([
      ["sale:s2", 20000, 1000],
      ["sale:s1", 14000, 950],
    ]);
    expect(a.openAmount).toBe(1950);
    expect(a.lines.some((l) => l.saleId === "s4")).toBe(false);
    const b = r.sellers.find((s) => s.sellerId === sellerB)!;
    expect(b.openAmount).toBe(200); // 100,00 × 2%
    expect(b.loginDisabled).toBe(false);
    expect(a.loginDisabled).toBe(true);
  });

  it("base recebida: à vista na venda; a prazo só as parcelas recebidas no período (padrão via parâmetro)", async () => {
    await deferredTitle(ctx, "s2", [10000, 10000], [{ n: 1, date: "2026-10-20", principal: 10000 }, { n: 2, date: "2026-11-05", principal: 10000 }]);
    await setSetting(store, COMPANY, null, "commission.base", "received");
    const oct = await commissionReport(ctx, { ...OCT, sellerId: sellerA });
    expect(oct.base).toBe("received");
    const a = oct.sellers[0];
    // s1 à vista 145,00 (inclui acréscimo) → 9,50 integral; s2: 100,00 de 200,00 recebidos → 5,00
    expect(a.lines.map((l) => [l.kind, l.saleId, l.base, l.amount])).toEqual([
      ["receipt", "s1", 14500, 950],
      ["receipt", "s2", 10000, 500],
    ]);
    const nov = await commissionReport(ctx, { ...NOV, sellerId: sellerA });
    expect(nov.sellers[0].lines.map((l) => [l.saleId, l.amount])).toEqual([["s2", 500]]);
  });

  it("devolução parcial abate a comissão proporcional (faturada e recebida)", async () => {
    await addReturn(store, { id: "r1", saleId: "s3", at: at("2026-10-20"), items: [{ seq: 1, skuId: "z", qty: 1000, total: 2500, cost: 0 }] });
    const inv = await commissionReport(ctx, { ...OCT, sellerId: sellerB, base: "invoiced" });
    const b = inv.sellers[0];
    // venda 100,00 × 2% = 2,00; devolução de 1 de 4 un → −0,50
    expect(b.lines.map((l) => [l.kind, l.base, l.amount])).toEqual([
      ["sale", 10000, 200],
      ["return", -2500, -50],
    ]);
    expect(b.openAmount).toBe(150);
    // devolução no mês seguinte abate no mês da devolução
    await addReturn(store, { id: "r2", saleId: "s3", at: at("2026-11-03"), items: [{ seq: 1, skuId: "z", qty: 2000, total: 5000, cost: 0 }] });
    const nov = await commissionReport(ctx, { ...NOV, sellerId: sellerB, base: "invoiced" });
    expect(nov.sellers[0].openAmount).toBe(-100);
    const rec = await commissionReport(ctx, { ...OCT, sellerId: sellerB, base: "received" });
    expect(rec.sellers[0].lines.map((l) => [l.kind, l.amount])).toEqual([
      ["receipt", 200],
      ["return", -50],
    ]);
  });

  it("fechamento gera um único título a pagar (idempotente, sem fechar duas vezes) e reabertura cancela o título em aberto", async () => {
    const [t1, t2] = await Promise.all([
      closeCommission(ctx, { ...OCT, sellerId: sellerA, base: "invoiced", dueDate: "2026-11-10" }),
      closeCommission(ctx, { ...OCT, sellerId: sellerA, base: "invoiced", dueDate: "2026-11-10" }),
    ]);
    expect(t1.id).toBe(t2.id);
    expect(t1).toMatchObject({ kind: "payable", originType: "commission", partyId: sellerA, total: 1950, status: "open" });
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "commission"]] });
    expect(titles).toHaveLength(1);
    expect(titles[0].commissionDetail.lines.map((l: any) => l.key).sort()).toEqual(["sale:s1", "sale:s2"]);
    await expect(closeCommission(ctx, { ...OCT, sellerId: sellerA, base: "invoiced", dueDate: "2026-11-10" })).rejects.toMatchObject({ code: "already_closed" });
    // período sobreposto não recomissiona o que já está fechado
    const over = await commissionReport(ctx, { from: "2026-10-01", to: "2026-11-15", sellerId: sellerA, base: "invoiced" });
    expect(over.sellers[0].openAmount).toBe(0);
    expect(over.sellers[0].closedAmount).toBe(1950);
    await expect(closeCommission(ctx, { from: "2026-10-01", to: "2026-11-15", sellerId: sellerA, base: "invoiced", dueDate: "2026-11-10" })).rejects.toMatchObject({ code: "nothing_to_close" });
    const exact = await commissionReport(ctx, { ...OCT, sellerId: sellerA, base: "invoiced" });
    expect(exact.sellers[0].closing).toMatchObject({ titleId: t1.id, total: 1950 });

    // venda já fechada cancelada em novembro: estorno no período do cancelamento
    await store.update("sales", "s1", { status: "cancelled", cancelledAt: at("2026-11-03") });
    const nov = await commissionReport(ctx, { ...NOV, sellerId: sellerA, base: "invoiced" });
    expect(nov.sellers[0].lines.map((l) => [l.kind, l.amount])).toEqual([["cancel", -950]]);

    // reabertura: título com pagamento não reabre
    await store.update("titles", t1.id, { status: "partial", balance: 950 });
    await expect(reopenCommission(ctx, t1.id, "erro")).rejects.toMatchObject({ code: "has_settlements" });
    await store.update("titles", t1.id, { status: "open", balance: 1950 });
    await store.update("sales", "s1", { status: "completed", cancelledAt: null });
    const reopened = await reopenCommission(ctx, t1.id, "Percentual corrigido");
    expect(reopened.status).toBe("cancelled");
    const again = await commissionReport(ctx, { ...OCT, sellerId: sellerA, base: "invoiced" });
    expect(again.sellers[0]).toMatchObject({ openAmount: 1950, closing: null });
    const t3 = await closeCommission(ctx, { ...OCT, sellerId: sellerA, base: "invoiced", dueDate: "2026-11-10" });
    expect(t3.id).not.toBe(t1.id);
    expect((await listClosings(ctx, OCT)).map((c) => c.status).sort()).toEqual(["cancelled", "open"]);
  });

  it("permissão negada sem a operação sales.commissions (apuração, fechamento e cadastro de vendedor)", async () => {
    const seller = ctxFor(store, { isAdmin: false, permissions: { sales: { view: true, create: true, edit: true } }, actions: [] });
    await expect(commissionReport(seller, OCT)).rejects.toMatchObject({ code: "forbidden" });
    await expect(closeCommission(seller, { ...OCT, sellerId: sellerA, dueDate: "2026-11-10" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createSeller(seller, { name: "Fulano" })).rejects.toMatchObject({ code: "forbidden" });
    const ok = ctxFor(store, { isAdmin: false, permissions: { sales: { view: true } }, actions: ["sales.commissions"] });
    expect((await commissionReport(ok, { ...OCT, base: "invoiced" })).sellers.length).toBe(2);
    // exportação: sem a operação, nenhuma linha
    const s = { ctx: seller, user: seller.user } as unknown as SessionInfo;
    expect(await getExport("sales-commissions")!.rows(s, { de: OCT.from, ate: OCT.to })).toEqual([]);
    const s2 = { ctx: ok, user: ok.user } as unknown as SessionInfo;
    const rows = await getExport("sales-commissions")!.rows(s2, { de: OCT.from, ate: OCT.to, base: "invoiced" });
    expect(rows.filter((r) => r.kind === "Venda").length).toBe(3);
  });

  it("meta por vendedor: realizado × meta, % e projeção na mesma tela de metas", async () => {
    await createGoal(ctx, { branchId: BR1, sellerId: sellerA, period: "2026-10", metric: "revenue", target: 50000 });
    await createGoal(ctx, { branchId: BR1, period: "2026-10", metric: "revenue", target: 100000 });
    await expect(createGoal(ctx, { branchId: BR1, sellerId: sellerA, period: "2026-10", metric: "revenue", target: 1 })).rejects.toThrow(/Já existe/);
    await addSale(store, { id: "s9", branchId: BR2, at: at("2026-10-15"), items: [{ skuId: "x", qty: 1000, unitPrice: 7000, cost: 1 }] });
    await store.update("sales", "s9", { sellerId: sellerA });
    const prog = await goalsProgress(ctx, "2026-10", { ref: "2026-10-15" });
    const seller = prog.find((g) => g.sellerId === sellerA)!;
    // BR1: s1 (145,00) + s2 (200,00) = 345,00 (s9 é de outra filial; s4 cancelada)
    expect(seller).toMatchObject({ actual: 34500, progressBps: 6900, sellerName: "Rafael Representante", projected: Math.round((34500 * 31) / 15) });
    const branch = prog.find((g) => !g.sellerId)!;
    expect(branch.actual).toBe(34500 + 10000 + 9900);
    const only = await goalsScreen(ctx, "2026-10", { accessibleBranchIds: [BR1, BR2], vendedor: "*", ref: "2026-10-15" });
    expect(only.goals.map((g) => g.sellerId)).toEqual([sellerA]);
  });

  it("vendedor sem acesso não consegue login (nem com credencial) e aparece só como vendedor", async () => {
    const v = await createSeller(ctx, { name: "Vera Externa", email: "vera@externa.local", commissionBps: 300, idemKey: "v" });
    expect(v).toMatchObject({ loginDisabled: true, status: "active", roleId: null });
    expect(loginBlockReason(v)).toMatch(/sem acesso/);
    await expect(authenticate(store, "vera@externa.local", "qualquer-senha")).rejects.toMatchObject({ code: "login_blocked" });
    await getAuth().createUser("vera@externa.local", "Senha@12345", "Vera");
    await expect(authenticate(store, "vera@externa.local", "Senha@12345")).rejects.toMatchObject({ code: "login_blocked" });
    // sem e-mail: endereço interno reservado, único
    const w = await createSeller(ctx, { name: "Walter Sem Email", idemKey: "w" });
    expect(w.email).toMatch(/@sem-acesso\.invalid$/);
    // telas de usuário não gerenciam o vendedor sem acesso
    await expect(setUserStatus(ctx, w.id, "suspended", "x")).rejects.toMatchObject({ code: "seller_only" });
    await setSellerActive(ctx, w.id, false);
    expect((await store.get("users", w.id))!.status).toBe("inactive");
  });
});
