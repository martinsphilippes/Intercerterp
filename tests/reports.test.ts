import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { addReturn, addSale, at, baseRefs, BR1, BR2, COMPANY } from "./report-fixtures";
import { branchOperations, commercialOverview, managerialReport, paymentBreakdown, previousPeriod, reportTotals, resolvePeriod, periodFromPreset, totalsOf, loadFacts } from "@/domain/reports";
import { createGoal, deleteGoal, goalsProgress, updateGoal } from "@/domain/goals";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";

const scope = (from: string, to: string, branchIds: string[] | null = null) => ({ companyId: COMPANY, branchIds, from, to });

function adminCtx(store: Store, branchId: string | null = BR1): Ctx {
  return { store, companyId: COMPANY, branchId, user: { id: "op-1", name: "Admin", email: "a@t", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [COMPANY] } };
}

describe("métricas comerciais (serviço único)", () => {
  let store: Store;
  beforeEach(async () => {
    store = freshStore();
    await baseRefs(store);
  });

  it("margem agregada usa os totais, nunca a média simples das margens", async () => {
    // Filial 1: receita 1.000,00 custo 900,00 → margem 10%
    await addSale(store, { id: "a", branchId: BR1, at: at("2026-09-05"), items: [{ skuId: "x", qty: 1000, unitPrice: 100000, cost: 90000 }] });
    // Filial 2: receita 100,00 custo 10,00 → margem 90%
    await addSale(store, { id: "b", branchId: BR2, at: at("2026-09-05"), items: [{ skuId: "y", qty: 1000, unitPrice: 10000, cost: 1000 }] });
    const r = await managerialReport(store, scope("2026-09-01", "2026-09-30"), { compare: false });
    const b1 = r.byBranch.find((b) => b.id === BR1)!;
    const b2 = r.byBranch.find((b) => b.id === BR2)!;
    expect(b1.marginBps).toBe(1000);
    expect(b2.marginBps).toBe(9000);
    // (1.100 − 910) / 1.100 = 17,27% — a média simples (50%) seria errada
    expect(r.totals.netRevenue).toBe(110000);
    expect(r.totals.cmv).toBe(91000);
    expect(r.totals.marginBps).toBe(1727);
    expect(r.totals.marginBps).not.toBe((b1.marginBps! + b2.marginBps!) / 2);
    // ticket agregado = receita / vendas (não média dos tickets)
    expect(r.totals.ticket).toBe(55000);
  });

  it("receita ≤ 0 resulta em estado 'sem receita' (sem divisão por zero)", async () => {
    await addSale(store, { id: "old", at: at("2026-08-30"), items: [{ skuId: "x", qty: 1000, unitPrice: 5000, cost: 2000 }] });
    await addReturn(store, { id: "r", saleId: "old", at: at("2026-09-02"), items: [{ seq: 1, skuId: "x", qty: 1000, total: 5000, cost: 2000 }] });
    const t = await reportTotals(store, scope("2026-09-01", "2026-09-30"));
    expect(t.netRevenue).toBe(-5000);
    expect(t.marginBps).toBeNull();
    expect(t.salesCount).toBe(0);
    expect(t.ticket).toBeNull();
    const empty = await reportTotals(store, scope("2026-07-01", "2026-07-31"));
    expect(empty.marginBps).toBeNull();
    expect(empty.ticket).toBeNull();
  });

  it("receita líquida = bruto − descontos + acréscimos − devoluções; canceladas não entram", async () => {
    await addSale(store, { id: "s1", at: at("2026-09-10"), items: [{ skuId: "x", qty: 2000, unitPrice: 5000, discount: 1000, surcharge: 300, cost: 4000 }] });
    await addSale(store, { id: "s2", status: "cancelled", at: at("2026-09-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 5000, cost: 2000 }] });
    await addReturn(store, { id: "r1", saleId: "s1", at: at("2026-09-11"), items: [{ seq: 1, skuId: "x", qty: 1000, total: 4650, cost: 2000 }] });
    const t = await reportTotals(store, scope("2026-09-01", "2026-09-30"));
    expect(t).toMatchObject({ gross: 10000, discounts: 1000, surcharges: 300, salesNet: 9300, returns: 4650, netRevenue: 4650, costSold: 4000, costReturned: 2000, cmv: 2000, grossProfit: 2650, salesCount: 1, returnsCount: 1 });
    expect(t.marginBps).toBe(5699);
    // devoluções reduzem a receita, mas não o número de vendas
    expect(t.ticket).toBe(4650);
  });

  it("devolução de venda anterior ao período entra na data do movimento da devolução", async () => {
    await addSale(store, { id: "aug", at: at("2026-08-28"), items: [{ skuId: "x", qty: 2000, unitPrice: 5000, cost: 4000 }] });
    await addSale(store, { id: "sep", at: at("2026-09-03"), items: [{ skuId: "y", qty: 1000, unitPrice: 20000, cost: 8000 }] });
    await addReturn(store, { id: "ret", saleId: "aug", at: at("2026-09-04", 15), items: [{ seq: 1, skuId: "x", qty: 1000, total: 5000, cost: 2000 }] });
    const aug = await reportTotals(store, scope("2026-08-01", "2026-08-31"));
    expect(aug).toMatchObject({ netRevenue: 10000, returns: 0, cmv: 4000 });
    const sep = await reportTotals(store, scope("2026-09-01", "2026-09-30"));
    expect(sep).toMatchObject({ salesNet: 20000, returns: 5000, netRevenue: 15000, cmv: 6000, salesCount: 1, returnsCount: 1 });
    // na quebra diária a devolução cai no dia 04/09, com a origem (venda de agosto) identificada
    const r = await managerialReport(store, scope("2026-09-01", "2026-09-30"), { compare: false });
    expect(r.byDay.find((d) => d.id === "2026-09-04")!.netRevenue).toBe(-5000);
    const ops = await branchOperations(store, scope("2026-09-01", "2026-09-30", [BR1]));
    expect(ops.returns).toHaveLength(1);
    expect(ops.returns[0]).toMatchObject({ saleId: "aug", priorSale: true, total: 5000, cost: 2000 });
    // limite do dia: devolução às 23h do último dia entra; à 00h do dia seguinte, não (fuso America/Sao_Paulo)
    await addReturn(store, { id: "late", saleId: "sep", at: at("2026-09-30", 23.5), items: [{ seq: 1, skuId: "y", qty: 100, total: 2000, cost: 800 }] });
    await addReturn(store, { id: "next", saleId: "sep", at: at("2026-10-01", 0), items: [{ seq: 1, skuId: "y", qty: 100, total: 2000, cost: 800 }] });
    const sep2 = await reportTotals(store, scope("2026-09-01", "2026-09-30"));
    expect(sep2.returns).toBe(7000);
  });

  it("devolução em processamento de estorno conta; devolução cancelada não", async () => {
    await addSale(store, { id: "s", at: at("2026-09-03"), items: [{ skuId: "x", qty: 3000, unitPrice: 1000, cost: 1500 }] });
    await addReturn(store, { id: "p", saleId: "s", at: at("2026-09-04"), status: "processing", compensation: "refund", refundMethod: "card_reversal", items: [{ seq: 1, skuId: "x", qty: 1000, total: 1000, cost: 500 }] });
    await addReturn(store, { id: "c", saleId: "s", at: at("2026-09-04"), status: "cancelled", items: [{ seq: 1, skuId: "x", qty: 1000, total: 1000, cost: 500 }] });
    const t = await reportTotals(store, scope("2026-09-01", "2026-09-30"));
    expect(t.returns).toBe(1000);
    expect(t.returnsCount).toBe(1);
  });

  it("resumo gerencial = soma do detalhe por filial = soma das operações", async () => {
    await addSale(store, { id: "1", branchId: BR1, operatorId: "op-1", at: at("2026-09-01", 9), items: [{ skuId: "x", qty: 1000, unitPrice: 12345, discount: 345, cost: 6000, categoryId: "cat-x" }, { skuId: "y", qty: 2500, unitPrice: 999, cost: 1200, categoryId: "cat-y" }] });
    await addSale(store, { id: "2", branchId: BR1, operatorId: "op-2", at: at("2026-09-02", 18), items: [{ skuId: "y", qty: 1000, unitPrice: 999, surcharge: 100, cost: 480, categoryId: "cat-y" }] });
    await addSale(store, { id: "3", branchId: BR2, operatorId: "op-2", at: at("2026-09-02", 11), items: [{ skuId: "x", qty: 3000, unitPrice: 12345, discount: 1000, cost: 18000, categoryId: "cat-x" }] });
    await addSale(store, { id: "old", branchId: BR2, at: at("2026-08-15"), items: [{ skuId: "x", qty: 1000, unitPrice: 12345, cost: 6000 }] });
    await addReturn(store, { id: "r1", saleId: "old", branchId: BR2, at: at("2026-09-02", 12), items: [{ seq: 1, skuId: "x", qty: 1000, total: 12345, cost: 6000 }] });
    await addReturn(store, { id: "r2", saleId: "1", branchId: BR1, at: at("2026-09-03", 12), items: [{ seq: 2, skuId: "y", qty: 500, total: 499, cost: 240 }] });
    const sc = scope("2026-09-01", "2026-09-30");
    const report = await managerialReport(store, sc, { compare: false });
    const keys = ["gross", "discounts", "surcharges", "returns", "netRevenue", "costSold", "costReturned", "cmv", "salesCount", "returnsCount"] as const;
    for (const k of keys) {
      expect(report.byBranch.reduce((a, b) => a + (b[k] as number), 0)).toBe(report.totals[k]);
      expect(report.byDay.reduce((a, b) => a + (b[k] as number), 0)).toBe(report.totals[k]);
      // nº de vendas por categoria conta as vendas que contêm a categoria (uma venda pode ter várias)
      if (k !== "salesCount" && k !== "returnsCount") expect(report.byCategory.reduce((a, b) => a + (b[k] as number), 0)).toBe(report.totals[k]);
      expect(report.byOperator.reduce((a, b) => a + (b[k] as number), 0)).toBe(report.totals[k]);
    }
    for (const b of report.byBranch) {
      const det = await branchOperations(store, scope(sc.from, sc.to, [b.id]));
      // detalhe da filial = linha da filial no resumo (mesmo critério)
      expect(det.totals.netRevenue).toBe(b.netRevenue);
      expect(det.totals.cmv).toBe(b.cmv);
      expect(det.totals.salesCount).toBe(b.salesCount);
      // operações listadas somam o total
      const salesSum = det.sales.reduce((a, s) => a + s.total, 0);
      const retSum = det.returns.reduce((a, r) => a + r.total, 0);
      expect(salesSum - retSum).toBe(b.netRevenue);
      expect(det.sales.reduce((a, s) => a + s.cost, 0) - det.returns.reduce((a, r) => a + r.cost, 0)).toBe(b.cmv);
      expect(det.sales).toHaveLength(b.salesCount);
      expect(det.returns).toHaveLength(b.returnsCount);
    }
    // meios de pagamento: pagamentos − devoluções = receita líquida
    const pay = await paymentBreakdown(store, sc);
    expect(pay.paymentsTotal - pay.returnsTotal).toBe(report.totals.netRevenue);
  });

  it("comparação com o período anterior usa a mesma quantidade de dias", () => {
    const ref = "2026-10-05";
    const mes = periodFromPreset("mes", ref);
    expect(mes).toMatchObject({ from: "2026-10-01", to: "2026-10-05", days: 5 });
    expect(previousPeriod(mes)).toMatchObject({ from: "2026-09-26", to: "2026-09-30", days: 5 });
    const ant = periodFromPreset("mes-anterior", ref);
    expect(ant).toMatchObject({ from: "2026-09-01", to: "2026-09-30", days: 30 });
    expect(previousPeriod(ant)).toMatchObject({ from: "2026-08-02", to: "2026-08-31", days: 30 });
    const d7 = periodFromPreset("7d", ref);
    expect(d7).toMatchObject({ from: "2026-09-29", to: "2026-10-05", days: 7 });
    expect(previousPeriod(d7)).toMatchObject({ from: "2026-09-22", to: "2026-09-28", days: 7 });
    expect(previousPeriod(periodFromPreset("hoje", ref))).toMatchObject({ from: "2026-10-04", to: "2026-10-04", days: 1 });
    // fevereiro (28 dias) → janela anterior de 28 dias
    const feb = resolvePeriod({ de: "2027-02-01", ate: "2027-02-28" }).period;
    expect(previousPeriod(feb)).toMatchObject({ from: "2027-01-04", to: "2027-01-31", days: 28 });
    expect(resolvePeriod({ de: "05/10/2026", ate: "01/10/2026" }).error).toBeTruthy();
    expect(resolvePeriod({ de: "01/10/2026", ate: "05/10/2026" }).period).toMatchObject({ from: "2026-10-01", to: "2026-10-05", preset: "personalizado" });
  });

  it("comparação no gerencial usa a janela anterior de mesma duração", async () => {
    await addSale(store, { id: "cur", at: at("2026-10-03"), items: [{ skuId: "x", qty: 1000, unitPrice: 20000, cost: 1 }] });
    await addSale(store, { id: "prev", at: at("2026-09-27"), items: [{ skuId: "x", qty: 1000, unitPrice: 10000, cost: 1 }] });
    await addSale(store, { id: "out", at: at("2026-09-25"), items: [{ skuId: "x", qty: 1000, unitPrice: 99900, cost: 1 }] });
    const r = await managerialReport(store, scope("2026-10-01", "2026-10-05"));
    expect(r.previousScope).toMatchObject({ from: "2026-09-26", to: "2026-09-30" });
    expect(r.previous!.netRevenue).toBe(10000);
    expect(r.series.points).toHaveLength(5);
    expect(r.series.points.find((p) => p.date === "2026-10-03")).toMatchObject({ current: 20000 });
    expect(r.series.points.find((p) => p.previousDate === "2026-09-27")).toMatchObject({ previous: 10000 });
  });

  it("painel e gerenciais retornam o mesmo faturamento para o mesmo recorte", async () => {
    await addSale(store, { id: "1", branchId: BR1, at: at("2026-10-02"), items: [{ skuId: "x", qty: 1000, unitPrice: 12345, discount: 45, cost: 6000 }] });
    await addSale(store, { id: "2", branchId: BR2, at: at("2026-10-03"), items: [{ skuId: "y", qty: 2000, unitPrice: 777, cost: 600 }] });
    await addSale(store, { id: "old", branchId: BR1, at: at("2026-09-20"), items: [{ skuId: "x", qty: 1000, unitPrice: 12345, cost: 6000 }] });
    await addReturn(store, { id: "r", saleId: "old", at: at("2026-10-04"), items: [{ seq: 1, skuId: "x", qty: 1000, total: 12345, cost: 6000 }] });
    for (const branchIds of [null, [BR1], [BR2]]) {
      const sc = scope("2026-10-01", "2026-10-05", branchIds);
      const dash = await commercialOverview(store, sc);
      const rep = await managerialReport(store, sc);
      expect(dash.totals.netRevenue).toBe(rep.totals.netRevenue);
      expect(dash.totals.salesCount).toBe(rep.totals.salesCount);
      expect(dash.totals.ticket).toBe(rep.totals.ticket);
      expect(dash.previous.netRevenue).toBe(rep.previous!.netRevenue);
      expect(dash.series.points.reduce((a, p) => a + p.current, 0)).toBe(rep.totals.netRevenue);
    }
  });

  it("totais pelas linhas batem com os totais das vendas", async () => {
    await addSale(store, { id: "1", at: at("2026-10-02"), items: [{ skuId: "x", qty: 1500, unitPrice: 3333, discount: 10, surcharge: 7, cost: 2000 }, { skuId: "z", qty: 1000, unitPrice: 100, cost: 50 }] });
    const facts = await loadFacts(store, scope("2026-10-01", "2026-10-05"));
    const t = totalsOf(facts.lines);
    expect(t.salesNet).toBe(facts.sales.reduce((a, s) => a + s.total, 0));
  });
});

describe("metas", () => {
  let store: Store;
  beforeEach(async () => {
    store = freshStore();
    await baseRefs(store);
  });

  it("CRUD com auditoria, unicidade por filial/mês/métrica e progresso pelo serviço único", async () => {
    const ctx = adminCtx(store);
    const g = await createGoal(ctx, { branchId: BR1, period: "2026-09", metric: "revenue", target: 100000 });
    await expect(createGoal(ctx, { branchId: BR1, period: "2026-09", metric: "revenue", target: 5 })).rejects.toThrow(/Já existe/);
    await createGoal(ctx, { branchId: BR1, period: "2026-09", metric: "sales_count", target: 4 });
    await createGoal(ctx, { branchId: null, period: "2026-09", metric: "ticket", target: 30000 });
    await expect(createGoal(ctx, { branchId: BR1, period: "2026-13", metric: "revenue", target: 1 })).rejects.toThrow(/mês/);
    await expect(createGoal(ctx, { branchId: BR1, period: "2026-10", metric: "revenue", target: 0 })).rejects.toThrow(/maior que zero/);

    await addSale(store, { id: "s1", branchId: BR1, at: at("2026-09-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 30000, cost: 1 }] });
    await addSale(store, { id: "s2", branchId: BR2, at: at("2026-09-11"), items: [{ skuId: "x", qty: 1000, unitPrice: 50000, cost: 1 }] });
    const prog = await goalsProgress(ctx, "2026-09", { ref: "2026-10-05" });
    const rev = prog.find((p) => p.metric === "revenue")!;
    expect(rev).toMatchObject({ actual: 30000, progressBps: 3000, status: "closed_missed", elapsedDays: 30, monthDays: 30 });
    expect(prog.find((p) => p.metric === "ticket")).toMatchObject({ branchName: "Empresa (todas as filiais)", actual: 40000, status: "achieved" });
    // realizado da meta = mesmo número dos gerenciais para o mês
    const t = await reportTotals(store, scope("2026-09-01", "2026-09-30", [BR1]));
    expect(rev.actual).toBe(t.netRevenue);
    // ritmo: meio do mês
    const mid = await goalsProgress(ctx, "2026-09", { ref: "2026-09-15" });
    expect(mid.find((p) => p.metric === "revenue")).toMatchObject({ expected: 50000, status: "behind", elapsedDays: 15 });

    await updateGoal(ctx, g.id, { branchId: BR1, period: "2026-09", metric: "revenue", target: 25000 });
    expect((await store.get("goals", g.id))!.target).toBe(25000);
    await deleteGoal(ctx, g.id, "Meta revista");
    await deleteGoal(ctx, g.id); // repetição não falha
    expect(await store.get("goals", g.id)).toBeNull();
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "entityType", "goal"]] });
    expect(logs.map((l) => l.action).sort()).toEqual(["goal.create", "goal.create", "goal.create", "goal.delete", "goal.update"]);
    expect(logs.every((l) => (l.related ?? []).includes(`goals:${COMPANY}`))).toBe(true);
  });

  it("usuário sem permissão de edição do painel não altera metas", async () => {
    const ctx = adminCtx(store);
    ctx.user = { ...ctx.user, isAdmin: false, permissions: { dashboard: { view: true } } };
    await expect(createGoal(ctx, { branchId: BR1, period: "2026-09", metric: "revenue", target: 100 })).rejects.toThrow(/permissão/);
  });
});

describe("integração com o fluxo real de vendas (seed de demonstração)", () => {
  it("receita do painel = vendas concluídas − devoluções do dia; devolução de venda anterior identificada", async () => {
    const { seedDemo } = await import("@/domain/seed");
    const { today } = await import("@/lib/dates");
    const store = freshStore();
    const r = await seedDemo(store, { historyDays: 3 });
    const companyId = r.companyId;
    const d = today();
    const sc = { companyId, branchIds: null, from: d, to: d };
    const t = await reportTotals(store, sc);
    const facts = await loadFacts(store, sc);
    const sales = facts.sales;
    expect(sales.length).toBeGreaterThan(0);
    const returns = await listAll(store, "returns", { filters: [["eq", "companyId", companyId]] });
    expect(t.salesNet).toBe(sales.reduce((a, s) => a + s.total, 0));
    expect(t.returns).toBe(returns.reduce((a, x) => a + x.itemsTotal, 0));
    expect(t.cmv).toBe(sales.reduce((a, s) => a + s.costTotal, 0) - returns.reduce((a, x) => a + x.costTotal, 0));
    // a venda cancelada do dia não entra
    expect(facts.cancelled.length).toBe(1);
    // devolução de venda de dia anterior criada pelo seed do módulo
    const modules = (r as any).modules.reports;
    expect(modules.priorReturn).toBeTruthy();
    const branchId = (await store.get("returns", modules.priorReturn))!.branchId;
    const ops = await branchOperations(store, { ...sc, branchIds: [branchId] });
    expect(ops.returns.some((x) => x.id === modules.priorReturn && x.priorSale)).toBe(true);
    // repetível
    const again = await seedDemo(store, { historyDays: 3 });
    expect((again as any).modules.reports.priorReturn).toBe(modules.priorReturn);
    expect((await listAll(store, "returns")).length).toBe(returns.length);
  });
});

describe("painel — resumo fiscal e detalhamento", () => {
  let store: Store;
  beforeEach(async () => {
    store = freshStore();
    await baseRefs(store);
  });

  it("documentos de simulação não contam como autorizados e vêm marcados", async () => {
    const { fiscalSnapshot, latestSales } = await import("@/app/(app)/dashboard/queries");
    const doc = (id: string, over: Record<string, unknown>) => store.create("fiscal_documents", { companyId: COMPANY, branchId: BR1, model: "nfce", status: "authorized", ref: id, total: 1000, issuedAt: at("2026-09-10"), authorizedAt: at("2026-09-10"), isSimulated: false, ...over }, id);
    await doc("real-1", { total: 2500 });
    await doc("sim-1", { isSimulated: true, total: 698000 });
    await doc("sim-2", { isSimulated: true, total: 2000 });
    await doc("nfe-rej", { model: "nfe", status: "rejected", authorizedAt: null });
    const snap = await fiscalSnapshot(adminCtx(store), [BR1, BR2], { from: "2026-09-01", to: "2026-09-30" });
    const nfce = snap.grid.find((g) => g.model === "nfce")!;
    expect(nfce).toMatchObject({ authorizedCount: 1, authorizedTotal: 2500, simulatedCount: 2, simulatedTotal: 700000 });
    expect(snap.simulatedCount).toBe(2);
    expect(snap.totals.rejected).toBe(1);
    expect(snap.grid.find((g) => g.model === "nfe")!.counts.rejected).toBe(1);

    await addSale(store, { id: "v1", branchId: BR1, at: at("2026-09-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 1000, cost: 1 }] });
    await store.update("sales", "v1", { fiscalDocumentId: "sim-1" });
    await addSale(store, { id: "v2", branchId: BR1, at: at("2026-09-11"), items: [{ skuId: "x", qty: 1000, unitPrice: 1000, cost: 1 }] });
    await store.update("sales", "v2", { fiscalDocumentId: "real-1" });
    const latest = await latestSales(adminCtx(store), [BR1]);
    expect(latest.find((x) => x.id === "v1")).toMatchObject({ documentModel: "nfce", documentSimulated: true });
    expect(latest.find((x) => x.id === "v2")).toMatchObject({ documentModel: "nfce", documentSimulated: false });
  });

  it("links de detalhamento só apontam para a listagem quando ela abre o mesmo recorte", async () => {
    const { salesListHref, commercialOpsHref, contextShowsScope, fiscalShowsScope, moduleQs } = await import("@/app/(app)/relatorios/params");
    const period = { from: "2026-09-01", to: "2026-09-30" };
    const inBranch1 = { ctx: adminCtx(store, BR1), user: adminCtx(store).user };
    const consolidated = { ctx: adminCtx(store, null), user: adminCtx(store).user };
    const b2 = { period, single: true, filial: BR2 };
    const b1 = { period, single: true, filial: BR1 };
    const all = { period, single: false, filial: "todas" };
    // contexto Filial 1: a listagem de vendas só abre a Filial 1
    expect(salesListHref(inBranch1, b1, { situacao: "completed" })).toBe(`/vendas${moduleQs(b1, { situacao: "completed" })}`);
    expect(salesListHref(inBranch1, b2)).toBeNull();
    expect(salesListHref(inBranch1, all)).toBeNull();
    // → detalhamento pelas operações da filial / resultado por unidade (mesmo período)
    expect(commercialOpsHref(inBranch1, b2, period)).toBe(`/relatorios/gerenciais/filial/${BR2}?de=2026-09-01&ate=2026-09-30`);
    expect(commercialOpsHref(inBranch1, all, period)).toBe("/relatorios/gerenciais?de=2026-09-01&ate=2026-09-30&filial=todas");
    const noReports = { user: { ...adminCtx(store).user, isAdmin: false, permissions: { dashboard: { view: true } } } };
    expect(commercialOpsHref(noReports, b2, period)).toBeNull();
    // consolidado: filial explícita ou todas
    expect(salesListHref(consolidated, b2)).toBe(`/vendas?de=2026-09-01&ate=2026-09-30&filial=${BR2}`);
    expect(salesListHref(consolidated, all)).toBe("/vendas?de=2026-09-01&ate=2026-09-30");
    expect(contextShowsScope(consolidated, all)).toBe(true);
    // fiscal: filial explícita vale em qualquer contexto; "todas" só no consolidado
    expect(fiscalShowsScope(inBranch1, b2)).toBe(true);
    expect(fiscalShowsScope(inBranch1, all)).toBe(false);
    expect(fiscalShowsScope(consolidated, all)).toBe(true);
  });
});
